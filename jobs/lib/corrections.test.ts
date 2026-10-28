import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mine } from "./corrections.ts";

const NOW = Date.parse("2026-10-28T12:00:00Z");
const ago = (days: number) => new Date(NOW - days * 86400_000).toISOString();

let base: string;
let lf: ReturnType<typeof Bun.serve>;
let jev: ReturnType<typeof Bun.serve>;
let traces: any[];
let observations: any[];
let noul = 0.9;
let choice = "new";
let pickFirst = false;
let traceFrom: string | null = null;
const KEYS = ["ALEPH_FACTORY_DIR", "ALEPH_JOBS_DIR", "LANGFUSE_BASE_URL", "LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY", "ALEPH_JEV_URL", "OPENROUTER_API_KEY", "HOME"];
let saved: Record<string, string | undefined>;

beforeAll(() => {
  lf = Bun.serve({
    port: 0,
    fetch(req) {
      const u = new URL(req.url);
      if (u.pathname === "/api/public/traces") { traceFrom = u.searchParams.get("fromTimestamp"); return Response.json({ data: traces, meta: { totalPages: 1 } }); }
      if (u.pathname === "/api/public/observations") return Response.json({ data: observations, meta: { totalPages: 1 } });
      return new Response("no", { status: 404 });
    },
  });
  jev = Bun.serve({
    port: 0,
    async fetch(req) {
      const { questions } = (await req.json()) as any;
      const answers: any = {};
      if (questions.correction) answers.correction = { type: "noul", noul };
      if (questions.lesson) answers.lesson = { type: "choice", choice: pickFirst ? Object.keys(questions.lesson.criteria).find((k) => k !== "new") : choice };
      return Response.json({ answers, usage: { cost: 0 } });
    },
  });
});
afterAll(() => { lf.stop(true); jev.stop(true); });

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-corr-"));
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  Object.assign(process.env, {
    ALEPH_FACTORY_DIR: join(base, "factory"), ALEPH_JOBS_DIR: join(base, "jobs"), HOME: base,
    LANGFUSE_BASE_URL: `http://127.0.0.1:${lf.port}`, LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk",
    ALEPH_JEV_URL: `http://127.0.0.1:${jev.port}/`, OPENROUTER_API_KEY: "k",
  });
  mkdirSync(join(base, "jobs"), { recursive: true });
  noul = 0.9; choice = "new"; pickFirst = false; traceFrom = null;
  traces = [
    { id: "t1", sessionId: "s", timestamp: ago(3), input: "start", output: "I did the thing." },
    { id: "t2", sessionId: "s", timestamp: ago(2), input: "No, that is wrong. Do not mock the db.", output: "ok" },
  ];
  observations = [{ id: "o1", traceId: "t1", name: "verify-gate", metadata: { verdict: "deny" }, output: "deny: no run backs tests pass", startTime: ago(1) }];
  const run = (state: string, reason: string) => ({ kind: "agent", job: "aleph-9", name: "aleph-9", state, reason, told: true, started: ago(1), ended: ago(1) });
  const dir = join(base, "jobs", "20261027-aleph-9");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "state.json"), JSON.stringify(run("dropped", "Drops the test it changed.")));
});
afterEach(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  rmSync(base, { recursive: true, force: true });
});

const stored = () => JSON.parse(readFileSync(join(base, "factory", "corrections.json"), "utf8"));

test("three signals Jev groups make one lesson of count 3", async () => {
  // Jev picks the first listed lesson for every signal after the first.
  pickFirst = true;
  await mine(NOW);
  const l = stored().lessons;
  expect(l.length).toBe(1);
  expect(l[0].count).toBe(3);
  expect(l[0].signals.map((x: any) => x.source)).toEqual(["chris", "gate", "drop"]);
  expect(l[0].id).toMatch(/^l-[0-9a-f]{8}$/);
  expect(l[0].signals[0].link).toBe(`http://127.0.0.1:${lf.port}/trace/t2`);
});

test("signals Jev splits make lessons of count 1", async () => {
  await mine(NOW);
  const s = stored();
  expect(s.lessons.map((l: any) => l.count)).toEqual([1, 1, 1]);
  expect(s.lessons[0].sentence).toBe("No, that is wrong.");
});

test("a message Jev answers below 0.7 is not a signal", async () => {
  noul = 0.69;
  await mine(NOW);
  expect(stored().lessons.flatMap((l: any) => l.signals.map((x: any) => x.source)).sort()).toEqual(["drop", "gate"]);
});

test("a second mine with the same data adds no signal", async () => {
  await mine(NOW);
  await mine(NOW + 1000);
  expect(stored().lessons.reduce((n: number, l: any) => n + l.count, 0)).toBe(3);
});

test("a trace older than 14 days is not read", async () => {
  traces = [
    { id: "t0", sessionId: "s", timestamp: ago(20), input: "start", output: "x" },
    { id: "t9", sessionId: "s", timestamp: ago(15), input: "No, wrong.", output: "y" },
  ];
  await mine(NOW);
  expect(traceFrom).toBe(ago(14));
  expect(stored().lessons.flatMap((l: any) => l.signals.map((x: any) => x.id))).not.toContain("t9");
});
