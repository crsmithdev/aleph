import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { judge } from "./judge.ts";
import { setModel } from "../../jobs/lib/routing/models.ts";
import { judgeChoice, setJudgeChoice } from "../../lib/jev.ts";

let dir: string;
let server: ReturnType<typeof Bun.serve>;
let reply: { status: number; body: unknown };
let asked: any[] = [];

// The preload sets ALEPH_JUDGE_FILE; put it back, not delete it, so later files never reach the live judge file.
const judgeFile = process.env.ALEPH_JUDGE_FILE!;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "aleph-judge-"));
  // The fake claude denies, and leaves a mark that it ran.
  writeFileSync(join(dir, "claude"), `#!/bin/sh\ntouch ${join(dir, "haiku-ran")}\necho '{"type":"result","is_error":false,"result":"{\\"verdict\\":\\"deny\\",\\"reason\\":\\"no run backs tests pass\\"}"}'\n`, { mode: 0o755 });
  server = Bun.serve({ port: 0, async fetch(req) { asked.push({ auth: req.headers.get("authorization"), body: await req.json() }); return Response.json(reply.body, { status: reply.status }); } });
  Object.assign(process.env, { ALEPH_JUDGE_FILE: join(dir, "judge"), ALEPH_JUDGE_CMD: join(dir, "claude"), ALEPH_JEV_URL: `http://127.0.0.1:${server.port}/`, OPENROUTER_API_KEY: "k-test" });
});
afterAll(() => { server.stop(true); rmSync(dir, { recursive: true, force: true }); delete process.env.ALEPH_JUDGE; process.env.ALEPH_JUDGE_FILE = judgeFile; });
beforeEach(() => { asked = []; for (const f of ["haiku-ran", "judge"]) rmSync(join(dir, f), { force: true }); delete process.env.ALEPH_JUDGE; });

const jev = (claim: number) => ({ status: 200, body: { model: "typesafe/jev-1.13-x", answers: { claim: { type: "noul", noul: claim } }, usage: { cost: 0.00002 } } });

test("a final message Jev is sure makes no claim passes on Jev's word, and Haiku does not run", async () => {
  reply = jev(0.02);
  const r = await judge("TURN: RUN git log\nFINAL MESSAGE: The last commit is a1b2c3.", "The last commit is a1b2c3.");
  expect(r).toMatchObject({ by: "jev", verdict: { verdict: "pass" }, jev: { pClaim: 0.02 } });
  expect(existsSync(join(dir, "haiku-ran"))).toBe(false);
  expect(asked[0].auth).toBe("Bearer k-test");
  expect(asked[0].body).toEqual({ model: "typesafe/jev-1.13", state: { final_message: "The last commit is a1b2c3." }, questions: { claim: expect.objectContaining({ type: "noul", criteria: expect.any(Object) }) } });
});

test("a final message that may claim completion goes to Haiku, whose verdict and reason stand", async () => {
  reply = jev(0.3);
  const r = await judge("TURN: EDIT a.ts\nFINAL MESSAGE: tests pass", "tests pass");
  expect(r).toMatchObject({ by: "haiku", verdict: { verdict: "deny", reason: "no run backs tests pass" }, jev: { pClaim: 0.3 } });
  expect(existsSync(join(dir, "haiku-ran"))).toBe(true);
});

test("an error from Jev falls through to Haiku", async () => {
  reply = { status: 500, body: { error: { message: "down" } } };
  const r = await judge("x", "done");
  expect(r.by).toBe("haiku");
  expect(r.jev?.error).toContain("jev 500");
  expect(existsSync(join(dir, "haiku-ran"))).toBe(true);
});

test("an empty final message goes to Haiku without asking Jev", async () => {
  reply = jev(0.01);
  const r = await judge("x", "  ");
  expect(r.by).toBe("haiku");
  expect(asked).toEqual([]);
});

test("with ALEPH_JUDGE=haiku, Jev is not asked", async () => {
  process.env.ALEPH_JUDGE = "haiku";
  reply = jev(0.01);
  const r = await judge("x", "The last commit is a1b2c3.");
  expect(r.by).toBe("haiku");
  expect(asked).toEqual([]);
});

test("aleph judge's file toggles the screen, and ALEPH_JUDGE overrides it", async () => {
  reply = jev(0.01);
  expect(judgeChoice()).toBe("jev");
  setJudgeChoice("haiku");
  expect((await judge("x", "The last commit is a1b2c3.")).by).toBe("haiku");
  expect(asked).toEqual([]);
  process.env.ALEPH_JUDGE = "jev";
  expect((await judge("x", "The last commit is a1b2c3.")).by).toBe("jev");
  delete process.env.ALEPH_JUDGE;
  setJudgeChoice("jev");
  expect(judgeChoice()).toBe("jev");
});

test("a judge slot set to local runs claude on gpt-oss-20b at the local base URL, and a claude slot on haiku", async () => {
  const saved = { cmd: process.env.ALEPH_JUDGE_CMD, factory: process.env.ALEPH_FACTORY_DIR };
  process.env.ALEPH_FACTORY_DIR = join(dir, "factory");
  process.env.ALEPH_JUDGE = "haiku";
  writeFileSync(join(dir, "record"), `#!/bin/sh\necho "$@" > ${join(dir, "args")}\nenv > ${join(dir, "env")}\necho '{"type":"result","is_error":false,"result":"{\\"verdict\\":\\"pass\\",\\"reason\\":\\"ok\\"}"}'\n`, { mode: 0o755 });
  process.env.ALEPH_JUDGE_CMD = join(dir, "record");
  try {
    expect(setModel("judge", { model: "gpt-oss-20b" })).toBeNull();
    await judge("TURN: x", "x");
    expect(readFileSync(join(dir, "args"), "utf8")).toContain("--model gpt-oss-20b");
    expect(readFileSync(join(dir, "env"), "utf8")).toContain("ANTHROPIC_BASE_URL=http://127.0.0.1:8012");
    expect(setModel("judge", { model: "haiku" })).toBeNull();
    await judge("TURN: x", "x");
    expect(readFileSync(join(dir, "args"), "utf8")).toContain("--model haiku");
    expect(readFileSync(join(dir, "env"), "utf8")).not.toContain("ANTHROPIC_BASE_URL");
  } finally {
    process.env.ALEPH_JUDGE_CMD = saved.cmd;
    if (saved.factory === undefined) delete process.env.ALEPH_FACTORY_DIR; else process.env.ALEPH_FACTORY_DIR = saved.factory;
  }
});

test("a judge that outlasts its budget returns no verdict and tries claude once", async () => {
  const saved = process.env.ALEPH_JUDGE_CMD;
  process.env.ALEPH_JUDGE = "haiku";
  writeFileSync(join(dir, "slow"), `#!/bin/sh\necho x >> ${join(dir, "runs")}\nexec tail -f /dev/null\n`, { mode: 0o755 });
  rmSync(join(dir, "runs"), { force: true });
  process.env.ALEPH_JUDGE_CMD = join(dir, "slow");
  try {
    const r = await judge("x", "done", 300);
    expect(r.verdict).toBeNull();
    expect(r.error).toContain("budget");
    expect(r.ms).toBeLessThan(2000);
    expect(readFileSync(join(dir, "runs"), "utf8")).toBe("x\n");
  } finally { process.env.ALEPH_JUDGE_CMD = saved; }
});
