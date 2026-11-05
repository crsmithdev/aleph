import { afterAll, afterEach, beforeAll, expect, setSystemTime, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { callAgent, endLost, openRun, type Opening } from "./agent-run.ts";
import { allRuns, jobIdOf, lock, readRun, runsDir, stamp, writeRun } from "../records/ledger.ts";

let base: string;
const saved = { ...process.env };
const opening: Opening = { role: "facts", who: "the reviewer", model: "m-1", seconds: 60, flags: ["--tools", "Read"], name: "demo", command: "facts demo", shown: false };
const fake = (body: string) => {
  const path = join(base, "fake");
  writeFileSync(path, `#!/bin/bash\n${body}\n`);
  chmodSync(path, 0o755);
  process.env.ALEPH_FACTS_CMD = path;
};

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-agent-run-"));
  process.env.ALEPH_JOBS_DIR = join(base, "jobs");
  process.env.XDG_RUNTIME_DIR = join(base, "run");
});
afterEach(() => { setSystemTime(); delete process.env.ALEPH_FACTS_CMD; delete process.env.ALEPH_FACTS_TIMEOUT; });
afterAll(() => { rmSync(base, { recursive: true, force: true }); process.env = saved; });

test("a run holds its state, its prompt, its output and its ending", async () => {
  fake(`cat > ${join(base, "stdin")}; echo "$@" > ${join(base, "args")}; echo reply; echo noise >&2`);
  const run = openRun({ ...opening, repo: "r", on: "r-1", job: "job-1" });
  expect(readRun(run.folder)).toMatchObject({ kind: "facts", name: "demo", job: "job-1", repo: "r", on: "r-1", condition: "running", phase: "facts", model: "m-1", shown: false, told: true });
  expect(readFileSync(join(run.folder, "command.txt"), "utf8")).toBe("facts demo\n");
  expect(await run.ask("hello")).toBe("reply\n");
  expect(readFileSync(join(run.folder, "prompt.md"), "utf8")).toBe("hello");
  expect(readFileSync(join(base, "stdin"), "utf8")).toBe("hello");
  expect(readFileSync(join(base, "args"), "utf8")).toContain("--model m-1 --output-format stream-json --verbose --tools Read");
  // The role loads no MCP server from the user's config.
  expect(readFileSync(join(base, "args"), "utf8")).toContain("--strict-mcp-config");
  expect(readFileSync(join(base, "args"), "utf8")).toContain("--disable-slash-commands");
  expect(readFileSync(join(run.folder, "output.log"), "utf8")).toBe("reply\nnoise\n");
  run.end("ok", { route: "close" });
  const r = readRun(run.folder)!;
  expect(r).toMatchObject({ condition: "done", reason: "ok", route: "close" });
  expect(r.phase).toBeUndefined();
  expect(typeof r.ended).toBe("string");
});

test("a role run that joins a job sorts after the job's earlier runs, even when the clock steps back", () => {
  const later = stamp(new Date(Date.now() + 60_000));
  const earlier = join(runsDir(), `${later}-step-build`);
  mkdirSync(earlier, { recursive: true });
  writeRun(earlier, { kind: "build", job: "step-job", name: "step", condition: "landed", told: true, started: new Date().toISOString() });
  const run = openRun({ ...opening, name: "step", job: "step-job" });
  const ids = allRuns().map((e) => e.folder);
  expect(ids.indexOf(run.folder)).toBeGreaterThan(ids.indexOf(earlier));
});

test("two jobs on one subject are #1 and #2, after the runs from before job IDs, and their folders are <stamp>-<subject>-<n>", () => {
  const old = join(runsDir(), `${stamp(new Date(Date.now() - 60_000))}-intake-r-9-intake`);
  mkdirSync(old, { recursive: true });
  writeRun(old, { kind: "intake", job: "old-9", name: "intake-r-9", on: "r-9", condition: "done", told: true, started: new Date().toISOString() });
  const one = openRun({ ...opening, on: "r-9" });
  const two = openRun({ ...opening, on: "r-9" });
  const e = (f: string) => allRuns().find((x) => x.folder === f)!;
  expect([jobIdOf(e(old)), jobIdOf(e(one.folder)), jobIdOf(e(two.folder))]).toEqual(["r-9#1", "r-9#2", "r-9#3"]);
  expect(one.folder.split("/").at(-1)).toMatch(/^\d{8}-\d{6}-r-9-2$/);
  expect(readRun(two.folder)!.n).toBe(3);
  const first = openRun({ ...opening, on: "r-10" }), second = openRun({ ...opening, on: "r-10" });
  expect([jobIdOf(e(first.folder)), jobIdOf(e(second.folder))]).toEqual(["r-10#1", "r-10#2"]);
});

test("starts on one subject in parallel processes never share a number", async () => {
  const script = `import { openRun } from ${JSON.stringify(join(import.meta.dir, "agent-run.ts"))}; openRun(${JSON.stringify({ ...opening, on: "r-20" })});`;
  const ps = Array.from({ length: 6 }, () => Bun.spawn(["bun", "-e", script], { env: process.env, stdout: "ignore", stderr: "inherit" }));
  expect(await Promise.all(ps.map((p) => p.exited))).toEqual([0, 0, 0, 0, 0, 0]);
  expect(allRuns().filter((x) => x.run.on === "r-20").map((x) => x.run.n).sort()).toEqual([1, 2, 3, 4, 5, 6]);
});

test("a run records the cost of its result event, also when the command fails, and has none without one", async () => {
  const result = (cost: number, isError: boolean, text: string) => JSON.stringify({ type: "result", is_error: isError, total_cost_usd: cost, result: text });
  fake(`echo '{"type":"system"}'; echo '${result(0.5, false, "the text")}'`);
  const good = openRun(opening);
  expect(await good.ask("x")).toBe("the text");
  expect(readRun(good.folder)!.cost).toBe(0.5);

  fake(`echo '${result(0.25, true, "out of turns")}'; exit 1`);
  const bad = openRun(opening);
  await expect(bad.ask("x")).rejects.toThrow("the reviewer exited 1");
  expect(readRun(bad.folder)!.cost).toBe(0.25);

  fake("echo plain");
  const none = openRun(opening);
  await none.ask("x");
  expect(readRun(none.folder)!.cost).toBeUndefined();
});

test("a run past its time box is killed and says it timed out", async () => {
  fake("exec sleep 30");
  process.env.ALEPH_FACTS_TIMEOUT = "0.2";
  const run = openRun(opening);
  await expect(run.ask("x")).rejects.toThrow("the reviewer timed out");
  expect(existsSync(join(run.folder, "output.log"))).toBe(true);
});

test("the time box ends the call's children too, so a child that holds the output pipe does not hold the run", async () => {
  fake(`sleep 30 & echo $! > ${join(base, "child")}; exec sleep 30`);
  process.env.ALEPH_FACTS_TIMEOUT = "0.2";
  const t0 = Date.now();
  await expect(openRun(opening).ask("x")).rejects.toThrow("the reviewer timed out");
  expect(Date.now() - t0).toBeLessThan(10_000);
  const child = Number(readFileSync(join(base, "child"), "utf8"));
  // The pipe closed, so the child is dead; its new parent may take a moment to reap it under load.
  const alive = () => { try { process.kill(child, 0); return true; } catch { return false; } };
  for (const end = Date.now() + 5_000; alive() && Date.now() < end;) await Bun.sleep(20);
  expect(alive()).toBe(false);
});

test("a call with no run gives the text and the cost, and throws on a failure", async () => {
  fake(`echo '${JSON.stringify({ type: "result", is_error: false, total_cost_usd: 1, result: "t" })}'`);
  const call = { role: "facts", who: "the author", model: "m", seconds: 60, flags: [] };
  expect(await callAgent(call, "x")).toEqual({ text: "t", cost: 1 });
  fake("exit 2");
  await expect(callAgent(call, "x")).rejects.toThrow("the author exited 2");
});

test("endLost ends a run when its lock is free, and leaves one whose lock is held or that it does not pick", async () => {
  const free = openRun({ ...opening, name: "free" });
  const held = openRun({ ...opening, name: "held" });
  const other = openRun({ ...opening, name: "other" });
  const done = openRun({ ...opening, name: "free" });
  done.end("kept");
  const release = (await lock("agent-run-held", 0))!;
  try {
    await endLost("facts", (run) => (run.name === "other" ? null : `agent-run-${run.name}`), "a verdict");
  } finally {
    release();
  }
  expect(readRun(free.folder)).toMatchObject({ condition: "done", reason: "failed: its process ended before a verdict", cause: "unanswered" });
  expect(readRun(held.folder)?.condition).toBe("running");
  expect(readRun(other.folder)?.condition).toBe("running");
  expect(readRun(done.folder)?.reason).toBe("kept");
});

test("an agent gets no API key and no CLAUDECODE, so it bills the subscription", async () => {
  process.env.ANTHROPIC_API_KEY = "secret";
  process.env.CLAUDECODE = "1";
  fake('echo "key=[$ANTHROPIC_API_KEY] code=[$CLAUDECODE] path=[${PATH:+set}]"');
  expect((await callAgent(opening, "x")).text).toBe("key=[] code=[] path=[set]\n");
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.CLAUDECODE;
});
