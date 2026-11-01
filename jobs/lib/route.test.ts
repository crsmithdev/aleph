import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { route } from "./route.ts";
import { jobCommand } from "./transitions.ts";

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
beforeEach(() => { asked = []; delete process.env.ALEPH_JUDGE; rmSync(join(dir, "f"), { recursive: true, force: true }); process.env.ALEPH_FACTORY_DIR = join(dir, "f"); });
afterAll(() => { delete process.env.ALEPH_FACTORY_DIR; });
const logLines = () => { try { return readFileSync(join(dir, "f", "tick.log"), "utf8").trim().split("\n").filter(Boolean); } catch { return []; } };

const answer = (choice: string, p: number) => ({ status: 200, body: { model: "jev-test", usage: { cost: 0.00002 }, answers: { tier: { type: "choice", choice, probabilities: { [choice]: p } } } } });

test("sonnet at 0.9 routes to sonnet, with one choice question over the three tiers", async () => {
  reply = answer("sonnet", 0.9);
  expect(await route("Add a flag")).toBe("sonnet");
  const l = logLines();
  expect(l).toHaveLength(1);
  expect(l[0]).toMatch(/ route cost 0\.00002 model jev-test tier sonnet p 0\.9$/);
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
  expect(logLines()).toHaveLength(1);
  expect(logLines()[0]).toContain("tier opus p 0.5");
});

test("a Jev 500 gives no model and writes no line", async () => {
  reply = { status: 500, body: { error: { message: "down" } } };
  expect(await route("x")).toBeNull();
  expect(logLines()).toEqual([]);
});

test("ALEPH_JUDGE=haiku gives no model and Jev is not asked", async () => {
  process.env.ALEPH_JUDGE = "haiku";
  reply = answer("opus", 0.99);
  expect(await route("x")).toBeNull();
  expect(asked).toEqual([]);
  expect(logLines()).toEqual([]);
});

test("an unwritable factory folder does not change the tier", async () => {
  writeFileSync(join(dir, "file"), "x");
  process.env.ALEPH_FACTORY_DIR = join(dir, "file", "sub");
  reply = answer("sonnet", 0.9);
  expect(await route("x")).toBe("sonnet");
});

test("the job command carries --model only when routed", () => {
  expect(jobCommand({ repo: "r", name: "r-1", spec: "", on: 1, land: true, model: "opus" })).toEqual(["job", "r", "r-1", "--spec", "-", "--on", "1", "--land", "--model", "opus"]);
  expect(jobCommand({ repo: "r", name: "r-1", spec: "", on: 1, land: true })).not.toContain("--model");
});
