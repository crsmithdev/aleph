import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readEvents } from "../../../lib/layout.ts";
import { startIssue } from "../transitions/transitions.ts";
import { raise, route } from "./route.ts";
import { setModel } from "./models.ts";

let dir: string;
let server: ReturnType<typeof Bun.serve>;
let reply: { status: number; body: unknown };
let asked: any[] = [];

let n = 0;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "aleph-route-"));
  server = Bun.serve({ port: 0, async fetch(req) { asked.push(await req.json()); return Response.json(reply.body, { status: reply.status }); } });
  Object.assign(process.env, { ALEPH_JEV_URL: `http://127.0.0.1:${server.port}/`, OPENROUTER_API_KEY: "k-test" });
});
afterAll(() => { server.stop(true); rmSync(dir, { recursive: true, force: true }); delete process.env.ALEPH_JUDGE; });
beforeEach(() => { asked = []; delete process.env.ALEPH_JUDGE; rmSync(join(dir, "f"), { recursive: true, force: true }); process.env.ALEPH_FACTORY_DIR = join(dir, "f"); process.env.ALEPH_DB = join(dir, `f${++n}.db`); });
const factoryDir = process.env.ALEPH_FACTORY_DIR!, dbFile = process.env.ALEPH_DB!;
afterAll(() => { process.env.ALEPH_FACTORY_DIR = factoryDir; process.env.ALEPH_DB = dbFile; });

test("a Jev 500 gives no model and logs no event", async () => {
  reply = { status: 500, body: { error: { message: "down" } } };
  expect(await route("x")).toBeNull();
  expect(readEvents()).toEqual([]);
});

test("a small pick at p >= 0.6 gives small, medium when small is disabled, and large when both are disabled", async () => {
  reply = { status: 200, body: { answers: { tier: { type: "choice", choice: "small", probabilities: { small: 0.7 } } }, cost: 0, model: "m" } };
  expect(await route("x", "aleph-5")).toBe("small");
  expect(readEvents().find((e) => e.action === "routed")).toMatchObject({ object: "aleph-5", detail: "small by classifier m" });
  expect(setModel("small", { enabled: false })).toBeNull();
  expect(await route("x")).toBe("medium");
  expect(setModel("medium", { enabled: false })).toBeNull();
  expect(await route("x")).toBe("large");
});

test("raise gives the next enabled tier up, skips a disabled one, and stays at the top", () => {
  const on = { enabled: true, model: "m" }, off = { enabled: false, model: "m" };
  const models: any = { small: on, medium: on, large: on };
  expect(raise("small", models)).toBe("medium");
  expect(raise("medium", models)).toBe("large");
  expect(raise("large", models)).toBe("large");
  expect(raise("small", { ...models, medium: off })).toBe("large");
});

test("a start routed to small logs its tier as a field of the started event, not in its detail; a start with no tier logs none", async () => {
  process.env.ALEPH_START_CMD = "true";
  try {
    expect(await startIssue({ key: "aleph" } as any, "aleph-5", 5, "x", "small")).toBeNull();
    expect(await startIssue({ key: "aleph" } as any, "aleph-6", 6, "x", null)).toBeNull();
  } finally { delete process.env.ALEPH_START_CMD; }
  const started = readEvents().filter((e) => e.action === "started");
  expect(started.map((e) => [e.object, e.tier ?? null, e.detail])).toEqual([["aleph-5", "small", "model haiku"], ["aleph-6", null, "model default"]]);
});
