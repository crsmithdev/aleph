import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readEvents } from "../../../lib/layout.ts";
import { route } from "./route.ts";
import { setModel } from "./models.ts";

let dir: string;
let server: ReturnType<typeof Bun.serve>;
let reply: { status: number; body: unknown };
let asked: any[] = [];

// The preload sets ALEPH_JUDGE_FILE; put it back, not delete it, so later files never reach the live judge file.
const judgeFile = process.env.ALEPH_JUDGE_FILE!;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "aleph-route-"));
  server = Bun.serve({ port: 0, async fetch(req) { asked.push(await req.json()); return Response.json(reply.body, { status: reply.status }); } });
  Object.assign(process.env, { ALEPH_JUDGE_FILE: join(dir, "judge"), ALEPH_JEV_URL: `http://127.0.0.1:${server.port}/`, OPENROUTER_API_KEY: "k-test" });
});
afterAll(() => { server.stop(true); rmSync(dir, { recursive: true, force: true }); delete process.env.ALEPH_JUDGE; process.env.ALEPH_JUDGE_FILE = judgeFile; });
beforeEach(() => { asked = []; delete process.env.ALEPH_JUDGE; rmSync(join(dir, "f"), { recursive: true, force: true }); process.env.ALEPH_FACTORY_DIR = join(dir, "f"); });
const factoryDir = process.env.ALEPH_FACTORY_DIR!;
afterAll(() => { process.env.ALEPH_FACTORY_DIR = factoryDir; });
const noTickLog = () => !existsSync(join(dir, "f", "tick.log"));

test("a Jev 500 gives no model and logs no event", async () => {
  reply = { status: 500, body: { error: { message: "down" } } };
  expect(await route("x")).toBeNull();
  expect(readEvents()).toEqual([]);
});

test("a low pick at p >= 0.6 gives worker-low, worker-medium when worker-low is disabled, and opus when both are disabled", async () => {
  reply = { status: 200, body: { answers: { tier: { type: "choice", choice: "worker-low", probabilities: { "worker-low": 0.7 } } }, cost: 0, model: "m" } };
  expect(await route("x")).toBe("worker-low");
  expect(readEvents().find((e) => e.action === "routed")?.note).toBe("cost 0 model m tier worker-low p 0.7");
  expect(noTickLog()).toBe(true);
  expect(setModel("worker-low", { enabled: false })).toBeNull();
  expect(await route("x")).toBe("worker-medium");
  expect(setModel("worker-medium", { enabled: false })).toBeNull();
  expect(await route("x")).toBe("opus");
});
