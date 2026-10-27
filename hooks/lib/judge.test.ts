import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { judge } from "./judge.ts";

let dir: string;
let server: ReturnType<typeof Bun.serve>;
let reply: { status: number; body: unknown };
let asked: any[] = [];

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "aleph-judge-"));
  // The fake claude denies, and leaves a mark that it ran.
  writeFileSync(join(dir, "claude"), `#!/bin/sh\ntouch ${join(dir, "haiku-ran")}\necho '{"result":"{\\"verdict\\":\\"deny\\",\\"reason\\":\\"no run backs tests pass\\"}"}'\n`, { mode: 0o755 });
  server = Bun.serve({ port: 0, async fetch(req) { asked.push({ auth: req.headers.get("authorization"), body: await req.json() }); return Response.json(reply.body, { status: reply.status }); } });
  Object.assign(process.env, { ALEPH_JUDGE_CMD: join(dir, "claude"), ALEPH_JEV_URL: `http://127.0.0.1:${server.port}/`, OPENROUTER_API_KEY: "k-test" });
});
afterAll(() => { server.stop(true); rmSync(dir, { recursive: true, force: true }); delete process.env.ALEPH_JUDGE; });
beforeEach(() => { asked = []; rmSync(join(dir, "haiku-ran"), { force: true }); process.env.ALEPH_JUDGE = "jev"; });

const jev = (deny: number) => ({ status: 200, body: { model: "typesafe/jev-1.13-x", answers: { verdict: { type: "choice", choice: deny > 0.5 ? "deny" : "pass", probabilities: { pass: 1 - deny, deny } } }, usage: { cost: 0.00002 } } });

test("a turn Jev is sure about passes on Jev's word, and Haiku does not run", async () => {
  reply = jev(0.05);
  const r = await judge("TURN: EDIT a.ts; RUN bun test → 3 pass\nFINAL MESSAGE: fixed, tests pass");
  expect(r).toMatchObject({ by: "jev", verdict: { verdict: "pass" }, jev: { pDeny: 0.05 } });
  expect(existsSync(join(dir, "haiku-ran"))).toBe(false);
  expect(asked[0].auth).toBe("Bearer k-test");
  expect(asked[0].body).toMatchObject({ model: "typesafe/jev-1.13", state: { turn: expect.stringContaining("FINAL MESSAGE") }, questions: { verdict: { type: "choice" } } });
});

test("a turn Jev doubts goes to Haiku, whose verdict and reason stand", async () => {
  reply = jev(0.7);
  const r = await judge("TURN: EDIT a.ts\nFINAL MESSAGE: tests pass");
  expect(r).toMatchObject({ by: "haiku", verdict: { verdict: "deny", reason: "no run backs tests pass" }, jev: { pDeny: 0.7 } });
  expect(existsSync(join(dir, "haiku-ran"))).toBe(true);
});

test("an error from Jev falls through to Haiku", async () => {
  reply = { status: 500, body: { error: { message: "down" } } };
  const r = await judge("x");
  expect(r.by).toBe("haiku");
  expect(r.jev?.error).toContain("jev 500");
  expect(existsSync(join(dir, "haiku-ran"))).toBe(true);
});

test("without ALEPH_JUDGE=jev, Jev is not asked", async () => {
  delete process.env.ALEPH_JUDGE;
  reply = jev(0.01);
  const r = await judge("x");
  expect(r.by).toBe("haiku");
  expect(asked).toEqual([]);
});
