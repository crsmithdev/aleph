import { afterAll, afterEach, beforeAll, expect, setSystemTime, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { endLost, openRun, type Opening } from "./agent-run.ts";
import { allRuns } from "../records/ledger.ts";
import { getRun } from "../records/record.ts";
import { readSection } from "../records/run-files.ts";
import { backendHold } from "../gates/factory-status.ts";
import { lock } from "../infra/locks.ts";

let base: string;
const saved = { ...process.env };
const opening: Opening = { role: "intake", who: "the reviewer", model: "m-1", seconds: 60, flags: ["--tools", "Read"], name: "demo", command: "facts demo", shown: false };
const fake = (body: string) => {
  const path = join(base, "fake");
  writeFileSync(path, `#!/bin/bash\n${body}\n`);
  chmodSync(path, 0o755);
  process.env.ALEPH_INTAKE_CMD = path;
};

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-agent-run-"));
  process.env.ALEPH_JOBS_DIR = join(base, "jobs");
  process.env.ALEPH_DB = join(base, "aleph.db");
  process.env.XDG_RUNTIME_DIR = join(base, "run");
});
afterEach(() => { setSystemTime(); delete process.env.ALEPH_INTAKE_CMD; delete process.env.ALEPH_INTAKE_TIMEOUT; delete process.env.ALEPH_STALL_SECONDS; });
afterAll(() => { rmSync(base, { recursive: true, force: true }); process.env = saved; });

test("a run holds its state, its prompt, its output and its ending", async () => {
  fake(`cat > ${join(base, "stdin")}; echo "$@" > ${join(base, "args")}; echo reply; echo noise >&2`);
  const run = openRun({ ...opening, repo: "r", target: "issue.1" });
  expect(getRun(run.id)).toMatchObject({ role: "intake", name: "demo", job: run.id, repo: "r", target: "issue.1", state: "running", phase: "intake", model: "m-1", shown: false, told: true });
  expect(readSection(run.folder, "command")).toBe("facts demo\n");
  expect(await run.ask("hello")).toBe("reply\n");
  expect(readFileSync(join(run.folder, "prompt.md"), "utf8")).toBe("hello");
  expect(readFileSync(join(base, "stdin"), "utf8")).toBe("hello");
  expect(readFileSync(join(base, "args"), "utf8")).toContain("--model m-1 --output-format stream-json --verbose --tools Read");
  // The role loads no MCP server from the user's config.
  expect(readFileSync(join(base, "args"), "utf8")).toContain("--strict-mcp-config");
  expect(readFileSync(join(base, "args"), "utf8")).toContain("--disable-slash-commands");
  expect(readFileSync(join(run.folder, "transcript.jsonl"), "utf8")).toBe("reply\n");
  expect(readSection(run.folder, "stderr")).toBe("noise\n");
  run.end("ok", { route: "close" });
  const r = getRun(run.id)!;
  expect(r).toMatchObject({ state: "done", reason: "ok", route: "close" });
  expect(r.phase).toBeUndefined();
  expect(typeof r.ended).toBe("string");
});

test("each run gets its own job number, also when processes start runs at once", async () => {
  const script = `import { openRun } from ${JSON.stringify(join(import.meta.dir, "agent-run.ts"))}; openRun(${JSON.stringify({ ...opening, target: "issue.20" })});`;
  const ps = Array.from({ length: 6 }, () => Bun.spawn(["bun", "-e", script], { env: process.env, stdout: "ignore", stderr: "inherit" }));
  expect(await Promise.all(ps.map((p) => p.exited))).toEqual([0, 0, 0, 0, 0, 0]);
  const ids = allRuns().filter((x) => x.run.target === "issue.20").map((x) => x.id);
  expect(new Set(ids).size).toBe(6);
});

test("a run records the cost of its result event, also when the command fails, and has none without one", async () => {
  const result = (cost: number, isError: boolean, text: string) => JSON.stringify({ type: "result", is_error: isError, total_cost_usd: cost, result: text });
  fake(`echo '{"type":"system"}'; echo '${result(0.5, false, "the text")}'`);
  const good = openRun(opening);
  expect(await good.ask("x")).toBe("the text");
  expect(getRun(good.id)!.cost).toBe(0.5);

  fake(`echo '${result(0.25, true, "out of turns")}'; exit 1`);
  const bad = openRun(opening);
  await expect(bad.ask("x")).rejects.toThrow("the reviewer exited 1");
  expect(getRun(bad.id)!.cost).toBe(0.25);

  fake("echo plain");
  const none = openRun(opening);
  await none.ask("x");
  expect(getRun(none.id)!.cost).toBeUndefined();
});

test("a run past its time box is killed and says it timed out", async () => {
  fake("exec tail -f /dev/null");
  process.env.ALEPH_INTAKE_TIMEOUT = "2";
  const run = openRun(opening);
  await expect(run.ask("x")).rejects.toThrow("the reviewer timed out");
  expect(existsSync(join(run.folder, "transcript.jsonl"))).toBe(true);
});

test("a run that ends with the API credit error has cause credit and holds its backend", async () => {
  fake(`echo '{"type":"result","is_error":true,"result":"API Error: 402 no credit"}'; exit 1`);
  const run = openRun(opening);
  await expect(run.ask("x")).rejects.toThrow("the reviewer exited 1");
  run.end("failed: no credit", { cause: "unanswered" });
  expect(getRun(run.id)).toMatchObject({ state: "done", cause: "credit" });
  expect(backendHold()).toMatchObject({ why: "API Error: 402 no credit" });
});

test("a run that prints nothing for the stall time fails with the stall reason", async () => {
  fake("exec tail -f /dev/null");
  process.env.ALEPH_STALL_SECONDS = "1";
  await expect(openRun(opening).ask("x")).rejects.toThrow("stalled: no output for 1 seconds");
});

test("the time box ends the call's children too, so a child that holds the output pipe does not hold the run", async () => {
  fake(`tail -f /dev/null & echo $! > ${join(base, "child")}; exec tail -f /dev/null`);
  process.env.ALEPH_INTAKE_TIMEOUT = "2";
  await expect(openRun(opening).ask("x")).rejects.toThrow("the reviewer timed out");
  const child = Number(readFileSync(join(base, "child"), "utf8"));
  // The pipe closed, so the child is dead; its new parent may take a moment to reap it under load.
  await Bun.spawn(["tail", "--pid", String(child), "-f", "/dev/null"]).exited;
  const alive = () => { try { process.kill(child, 0); return true; } catch { return false; } };
  expect(alive()).toBe(false);
});

test("endLost ends a run when its lock is free, and leaves one whose lock is held or that it does not pick", async () => {
  const free = openRun({ ...opening, name: "free" });
  const held = openRun({ ...opening, name: "held" });
  const other = openRun({ ...opening, name: "other" });
  const done = openRun({ ...opening, name: "free" });
  done.end("kept");
  const release = (await lock("agent-run-held", 0))!;
  try {
    await endLost("intake", (run) => (run.name === "other" ? null : `agent-run-${run.name}`), "a verdict");
  } finally {
    release();
  }
  expect(getRun(free.id)).toMatchObject({ state: "done", reason: "failed: its process ended before a verdict", cause: "unanswered" });
  expect(getRun(held.id)?.state).toBe("running");
  expect(getRun(other.id)?.state).toBe("running");
  expect(getRun(done.id)?.reason).toBe("kept");
});

test("an agent gets no API key and no CLAUDECODE, so it bills the subscription", async () => {
  process.env.ANTHROPIC_API_KEY = "secret";
  process.env.CLAUDECODE = "1";
  fake('echo "key=[$ANTHROPIC_API_KEY] code=[$CLAUDECODE] path=[${PATH:+set}]"');
  expect(await openRun(opening).ask("x")).toBe("key=[] code=[] path=[set]\n");
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.CLAUDECODE;
});

test("a non-chat run records the session of its reply on its run", async () => {
  fake(`echo '{"type":"result","is_error":false,"session_id":"s1","result":"ok"}'`);
  const run = openRun(opening);
  await run.ask("x");
  expect(getRun(run.id)!.session).toBe("s1");
});
