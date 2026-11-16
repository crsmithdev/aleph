import { afterAll, afterEach, beforeAll, beforeEach, expect, setSystemTime, test } from "bun:test";
import { conn } from "../lib/db.ts";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { currentFit, fit, gainSince, pollOnce, off, pollOpenRouter, readSnapshots, runShare, share, sinceReset, summary, type Snapshot } from "./usage.ts";
// @ts-ignore plain JS, shared with the page
import { costHtml, wkText } from "./lib.js";
import { openRouterFactor } from "../jobs/lib/routing/models.ts";
import { memory, use } from "../lib/langfuse.ts";

// The test's clock: the code under test reads it, and the fixtures sit at known distances from it.
const NOW = Date.parse("2026-11-04T12:00:00Z");
beforeAll(() => setSystemTime(NOW));
afterAll(() => setSystemTime());
// @ts-ignore plain JS view

let dir: string, server: ReturnType<typeof Bun.serve>;
/** What the test server answers; a test swaps it to make the endpoint fail. */
let reply: (req: Request) => Response;
/** A reset in the future of the test clock: a poll takes the time of the clock, and a past reset drops its snapshot. */
const nextWeek = () => new Date(NOW + 7 * 24 * 3600_000).toISOString();
const OK = (req: Request) => {
  if (req.headers.get("authorization") !== `Bearer ${TOKEN}` || req.headers.get("anthropic-beta") !== "oauth-2025-04-20") return new Response("no", { status: 401 });
  return Response.json({ five_hour: { utilization: 0, resets_at: "2026-10-28T20:00:00Z" }, seven_day: { utilization: 25, resets_at: nextWeek() } });
};
const TOKEN = "sk-ant-oat-secret-token";
const H = 3600_000;
const T0 = Date.parse("2026-10-26T00:00:00Z");
/** The lines written to console.error while `fn` runs. */
async function errors(fn: () => Promise<unknown>): Promise<string[]> {
  const orig = console.error, lines: string[] = [];
  console.error = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
  try { await fn(); } finally { console.error = orig; }
  return lines;
}

const snap = (h: number, seven: number, reset = "2026-11-02T00:00:00Z"): Snapshot => ({ at: new Date(T0 + h * H).toISOString(), seven_day: seven, seven_day_resets_at: reset });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "usage-"));
  process.env.ALEPH_DB = join(dir, "aleph.db");
  process.env.ALEPH_CLAUDE_CREDENTIALS = join(dir, "cred.json");
  writeFileSync(process.env.ALEPH_CLAUDE_CREDENTIALS, JSON.stringify({ claudeAiOauth: { accessToken: TOKEN } }));
  reply = OK;
  server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (req) => reply(req) });
  process.env.ALEPH_USAGE_URL = `http://127.0.0.1:${server.port}/`;
});
afterEach(() => { server.stop(true); rmSync(dir, { recursive: true }); delete process.env.ALEPH_USAGE_URL; delete process.env.ALEPH_DB; });

/** Rows of the `usage` table, as a poll writes them. */
const insert = (rows: { at: string; seven_day: number; seven_day_resets_at?: string | null }[]) => {
  for (const r of rows) conn().query("INSERT INTO usage (time, seven_day, seven_day_resets_at) VALUES (?, ?, ?)").run(r.at, r.seven_day, r.seven_day_resets_at ?? null);
};

test("the window starts at the last reset", () => {
  const w = sinceReset([snap(0, 80, "2026-10-26T00:00:00Z"), snap(1, 90, "2026-10-26T00:00:00Z"), snap(2, 1), snap(3, 2)]);
  expect(w.map((s) => s.seven_day)).toEqual([1, 2]);
});

/** Snapshots on each hour 0..n, the weekly % rising by `rise(h)` over hour h. */
const hourly = (n: number, rise: (h: number) => number) => {
  const out = [snap(0, 0)];
  for (let h = 0; h < n; h++) out.push(snap(h + 1, out[h].seven_day + rise(h)));
  return out;
};
/** Hour h's dollars: Fable and Opus in turn, so the two columns are not proportional. */
const fable = (h: number) => (h % 2 ? 3 : 1), opus = (h: number) => (h % 3 ? 2 : 5);
const spendOf = (n: number) => Array.from({ length: n }, (_, h) => [
  { at: T0 + h * H, model: "claude-fable-5-1", cost: fable(h) }, { at: T0 + h * H, model: "claude-opus-5-5", cost: opus(h) },
  { at: T0 + h * H, model: "deepseek/deepseek-v4.1-flash", cost: 50 },
]).flat();

test("under 6 hours of snapshots there is no share", () => {
  expect(fit(hourly(5, () => 1), spendOf(5))).toBeNull();
});

test("the fit finds one rate for Fable and one for the other Claude models, and OpenRouter dollars move neither", () => {
  const f = fit(hourly(24, (h) => 0.2 * fable(h) + 0.05 * opus(h)), spendOf(24))!;
  expect(f.pooled).toBe(false);
  expect(f.hours).toBe(24);
  expect(f.fable).toBeCloseTo(0.2, 9);
  expect(f.rest).toBeCloseTo(0.05, 9);
  expect(share(f, 2, "claude-fable-5-1")!.pct).toBeCloseTo(0.4, 9);
  expect(share(f, 2, "sonnet")!.pct).toBeCloseTo(0.1, 9);
  expect(share(f, 2, "unknown")!.pct).toBeCloseTo(0.1, 9);
  expect(share(f, 2, "deepseek-v4.1-flash")).toEqual({ pct: 0, pooled: false });
  expect(share(f, 2, "gpt-oss-20b")).toEqual({ pct: 0, pooled: false });
  expect(share(null, 2, "opus")).toBeUndefined();
});

test("with under $20 of Fable one pooled rate prices every Claude model", () => {
  const f = fit(hourly(6, () => 1), spendOf(6))!;
  expect(f.pooled).toBe(true);
  expect(f.fable).toBe(f.rest);
  expect(share(f, 1, "claude-fable-5-1")).toEqual({ pct: f.rest, pooled: true });
});

test("an hour that holds a reset, or with no snapshot near one end, is not a row", () => {
  const snaps = hourly(12, () => 1);
  snaps[4] = snap(4, 0, "2026-11-09T00:00:00Z");
  snaps[6] = { ...snaps[6], at: new Date(T0 + 6 * H + 20 * 60_000).toISOString() };
  // Hours 3, 4 hold a reset and hours 5, 6 lack the snapshot at 6: 8 of 12 hours are rows.
  expect(fit(snaps, spendOf(12))!.hours).toBe(8);
});

test("a run's share puts its reviewer's dollars on the review's model", () => {
  const f = { fable: 0.2, rest: 0.05, pooled: false, hours: 24 };
  const w = runShare(f, { model: "deepseek-v4.1-flash", cost: 5, review: { model: "claude-fable-5-1", cost: 3 } })!;
  expect(w.pct).toBeCloseTo(0.6, 9);
  expect(runShare(f, { model: "sonnet", cost: 4 })!.pct).toBeCloseTo(0.2, 9);
  expect(runShare(f, { model: "sonnet" })).toBeUndefined();
});

test("off: the 7-day percent less the fitted share of this machine's Claude dollars since the reset", () => {
  // The week starts at 00:00, its reset time a hair under the hour; the polls fall 3 minutes past each hour.
  const start = Date.parse("2026-11-04T00:00:00Z"), reset = new Date(start + 7 * 24 * H - 59).toISOString();
  const rows = (r: string | null) => Array.from({ length: 11 }, (_, h): Snapshot => ({ at: new Date(start + h * H + 3 * 60_000).toISOString(), seven_day: 3 * h, seven_day_resets_at: r }));
  const write = (r: string | null) => { conn().run("DELETE FROM usage"); insert(rows(r)); };
  write(reset);
  const f = { fable: 1.5, rest: 0.125, pooled: false, hours: 24 };
  const spend = Array.from({ length: 10 }, (_, h) => [
    { at: start + h * H, model: "claude-fable-5-1", cost: 1 }, { at: start + h * H, model: "claude-opus-5-5", cost: 4 },
    { at: start + h * H, model: "deepseek/deepseek-v4.1-flash", cost: 50 }, { at: start - H, model: "claude-opus-5-5", cost: 99 },
  ]).flat();
  // Rise of 30 points; 10 x (1 x 1.5 + 4 x 0.125) = 20 of them are this machine's, the first hour's bucket too.
  expect(off(f, summary(), spend)).toBeCloseTo(10, 9);
  expect(off(null, summary(), spend)).toBeNull();
  expect(off(f, summary(), spend.map((x) => ({ ...x, cost: x.cost * 10 })))).toBe(0);
  // With no reset time the week starts at the first snapshot's hour.
  write(null);
  expect(off(f, summary(), spend)).toBeCloseTo(10, 9);
});

test("gainSince: the latest weekly percent minus the snapshot nearest to 5 hours before, in the reset window", () => {
  const t = (h: number) => new Date(Date.UTC(2026, 9, 29, 12) - h * 3600_000).toISOString();
  const snap = (h: number, seven_day: number): Snapshot => ({ at: t(h), seven_day, seven_day_resets_at: "2026-11-02T09:00:00Z" });
  expect(gainSince([snap(6, 20), snap(5.1, 22), snap(2, 25), snap(0, 30)], 5 * 3600_000)).toBe(8);
  expect(gainSince([snap(1, 20), snap(0, 30)], 5 * 3600_000)).toBeNull();
  expect(gainSince([snap(0, 30)], 5 * 3600_000)).toBeNull();
  expect(gainSince([], 5 * 3600_000)).toBeNull();
});

test("a 429 without Retry-After logs the status alone", async () => {
  reply = () => new Response("slow down", { status: 429 });
  const lines = await errors(() => pollOnce());
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain("429");
  expect(lines[0]).not.toContain("Retry-After");
});

test("a credentials file with no token logs one line", async () => {
  writeFileSync(process.env.ALEPH_CLAUDE_CREDENTIALS!, JSON.stringify({ claudeAiOauth: {} }));
  const lines = await errors(() => pollOnce());
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain("no token");
});

test("a body that is not JSON logs one line and not the body", async () => {
  reply = () => new Response("<html>secret-page-text</html>", { status: 200 });
  const lines = await errors(() => pollOnce());
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain("not valid JSON");
  expect(lines[0]).not.toContain("secret-page-text");
});

test("a JSON body with no usage numbers logs one line", async () => {
  reply = () => Response.json({ five_hour: { utilization: 5 }, seven_day: null });
  const lines = await errors(() => pollOnce());
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain("no usage numbers");
});

test("a reply's five_hour is not stored: the snapshot and the stored row have only the seven-day fields", async () => {
  reply = () => Response.json({ five_hour: { utilization: 5 }, seven_day: { utilization: 25, resets_at: nextWeek() } });
  let snap = null as Snapshot | null;
  const lines = await errors(async () => { snap = await pollOnce(); });
  expect(lines).toEqual([]);
  const want = { at: new Date(NOW).toISOString(), seven_day: 25, seven_day_resets_at: nextWeek() };
  expect(snap).toEqual(want);
  expect(readSnapshots().at(-1)).toEqual(want);
  expect(readSnapshots().at(-1)!.seven_day).toBe(25);
});

test("a network failure logs one line", async () => {
  const port = server.port;
  server.stop(true);
  process.env.ALEPH_USAGE_URL = `http://127.0.0.1:${port}/`;
  const lines = await errors(() => pollOnce());
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain("network failure");
  expect(lines[0]).not.toContain(TOKEN);
});

test("summary ignores a row dated after the clock, so a future-dated snapshot does not stick as the latest", () => {
  const now = Date.parse("2026-11-01T23:30:00Z");
  const past = { at: "2026-11-01T23:20:00Z", seven_day: 25, seven_day_resets_at: "2026-11-05T00:00:00Z" };
  const future = { at: "2026-11-20T12:00:00Z", seven_day: 18, seven_day_resets_at: "2026-11-05T00:00:00Z" };
  insert([past, future]);
  const s = summary(now);
  expect(s.now?.seven_day).toBe(25);
  expect(s.series.map((p) => p.seven_day)).toEqual([25]);
});

test("currentFit reads Langfuse's hourly spend, and a snapshot dated after the clock does not skew it", async () => {
  const t0 = Math.floor((NOW - 10 * H) / H) * H;
  const reset = new Date(NOW + 5 * 24 * H).toISOString();
  const good = Array.from({ length: 9 }, (_, h) => ({ at: new Date(t0 + h * H + 60_000).toISOString(), seven_day: 10 + h, seven_day_resets_at: reset }));
  const observations = Array.from({ length: 8 }, (_, h) => ({ id: `o${h}`, traceId: "t", startTime: new Date(t0 + h * H + 5 * 60_000).toISOString(), providedModelName: "claude-opus-5-5", calculatedTotalCost: 4 }));
  const write = (rows: Parameters<typeof insert>[0]) => { conn().run("DELETE FROM usage"); insert(rows); };
  use(memory({ traces: [], observations }));
  try {
    write(good);
    const base = await currentFit();
    expect(base).toEqual({ fable: 0.25, rest: 0.25, pooled: true, hours: 8 });
    const future = { at: new Date(NOW + 30 * H).toISOString(), seven_day: 1, seven_day_resets_at: new Date(NOW + 12 * 24 * H).toISOString() };
    write([...good, future]);
    expect(await currentFit()).toEqual(base);
  } finally {
    use(null);
  }
});

test("the OpenRouter rate is the bill's rise less Jev over the list price Langfuse saw, and a new key starts over", async () => {
  const fetch = globalThis.fetch, keep = { OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY };
  process.env.OPENROUTER_API_KEY = "or-test";
  let usage = 10;
  globalThis.fetch = (async () => Response.json({ data: { usage, usage_daily: 0, usage_weekly: 0, usage_monthly: 0 } })) as any;
  const obs = (h: number, cost: number) => ({ id: `o${h}`, traceId: "t", startTime: new Date(NOW - h * H).toISOString(), providedModelName: "deepseek/deepseek-v4.1-flash", calculatedTotalCost: cost });
  use(memory({ traces: [], observations: [obs(2, 1), obs(1, 1), obs(1.5, 99)].map((o, i) => i === 2 ? { ...o, providedModelName: "claude-opus-5-5" } : o) }));
  try {
    expect(openRouterFactor()).toBe(1);
    await pollOpenRouter(NOW - 3 * H);
    conn().query("INSERT INTO jev (time, cost) VALUES (?, ?)").run(new Date(NOW - H).toISOString(), 0.2);
    usage = 12.8;
    await pollOpenRouter(NOW);
    // (12.8 - 10 - 0.2) / 2 list dollars
    expect(openRouterFactor()).toBeCloseTo(1.3, 9);
    usage = 0.5;
    await pollOpenRouter(NOW);
    const rows = conn().query("SELECT time AS at, usage, factor FROM openrouter ORDER BY seq").all();
    expect(rows.at(-1)).toEqual({ at: new Date(NOW).toISOString(), usage: 0.5, factor: null });
  } finally {
    globalThis.fetch = fetch;
    for (const [k, v] of Object.entries(keep)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    use(null);
  }
});
