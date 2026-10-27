import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jobArgv, route } from "./route.ts";

let dir: string;
let server: ReturnType<typeof Bun.serve>;
let reply: { status: number; body: unknown };
let asked: any[] = [];

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "aleph-route-"));
  server = Bun.serve({ port: 0, async fetch(req) { asked.push(await req.json()); return Response.json(reply.body, { status: reply.status }); } });
  Object.assign(process.env, { ALEPH_JUDGE_FILE: join(dir, "judge"), ALEPH_JEV_URL: `http://127.0.0.1:${server.port}/`, OPENROUTER_API_KEY: "k-test" });
});
afterAll(() => { server.stop(true); rmSync(dir, { recursive: true, force: true }); delete process.env.ALEPH_JUDGE; delete process.env.ALEPH_JUDGE_FILE; });
beforeEach(() => { asked = []; delete process.env.ALEPH_JUDGE; });

const answer = (choice: string, p: number) => ({ status: 200, body: { answers: { tier: { type: "choice", choice, probabilities: { [choice]: p } } } } });

test("sonnet at 0.9 routes to sonnet, with one choice question over the three tiers", async () => {
  reply = answer("sonnet", 0.9);
  expect(await route("Add a flag")).toBe("sonnet");
  expect(asked).toHaveLength(1);
  expect(asked[0].state).toEqual({ goal: "Add a flag" });
  const qs = Object.values(asked[0].questions) as any[];
  expect(qs).toHaveLength(1);
  expect(qs[0].type).toBe("choice");
  expect(Object.keys(qs[0].criteria)).toEqual(["haiku", "sonnet", "opus"]);
});

test("opus at 0.5 gives no model", async () => {
  reply = answer("opus", 0.5);
  expect(await route("x")).toBeNull();
});

test("a Jev 500 gives no model", async () => {
  reply = { status: 500, body: { error: { message: "down" } } };
  expect(await route("x")).toBeNull();
});

test("ALEPH_JUDGE=haiku gives no model and Jev is not asked", async () => {
  process.env.ALEPH_JUDGE = "haiku";
  reply = answer("opus", 0.99);
  expect(await route("x")).toBeNull();
  expect(asked).toEqual([]);
});

test("the job argv carries --model only when routed", () => {
  expect(jobArgv("bun", "cli.ts", "r", "r-1", 1, "opus").slice(-2)).toEqual(["--model", "opus"]);
  expect(jobArgv("bun", "cli.ts", "r", "r-1", 1, null)).not.toContain("--model");
});
