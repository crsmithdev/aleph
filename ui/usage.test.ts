import { afterAll, afterEach, beforeAll, beforeEach, expect, setSystemTime, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { currentFit, fit, gainSince, pollOnce, readSnapshots, share, sinceReset, summary, type Snapshot } from "./usage.ts";
// @ts-ignore plain JS, shared with the page
import { costHtml, wkText } from "./lib.js";
import { putRun } from "../jobs/lib/records/record.ts";

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

const snap = (h: number, seven: number, reset = "2026-11-02T00:00:00Z"): Snapshot => ({ at: new Date(T0 + h * H).toISOString(), five_hour: 0, seven_day: seven, seven_day_resets_at: reset });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "usage-"));
  process.env.ALEPH_USAGE_FILE = join(dir, "usage.jsonl");
  process.env.ALEPH_CLAUDE_CREDENTIALS = join(dir, "cred.json");
  writeFileSync(process.env.ALEPH_CLAUDE_CREDENTIALS, JSON.stringify({ claudeAiOauth: { accessToken: TOKEN } }));
  reply = OK;
  server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (req) => reply(req) });
  process.env.ALEPH_USAGE_URL = `http://127.0.0.1:${server.port}/`;
});
afterEach(() => { server.stop(true); rmSync(dir, { recursive: true }); delete process.env.ALEPH_USAGE_URL; });

test("the window starts at the last reset", () => {
  const w = sinceReset([snap(0, 80, "2026-10-26T00:00:00Z"), snap(1, 90, "2026-10-26T00:00:00Z"), snap(2, 1), snap(3, 2)]);
  expect(w.map((s) => s.seven_day)).toEqual([1, 2]);
});

test("under 6 hours of snapshots there is no share", () => {
  expect(fit([snap(0, 0), snap(5, 5)], [{ at: T0 + 2 * H, model: "m", cost: 10 }])).toBeNull();
});

test("r is the rise per dollar, per model when it has $5, pooled otherwise", () => {
  const snaps = [snap(0, 0), snap(4, 4), snap(8, 6), snap(12, 8)];
  // a: 10 $ → 4 %; 5 $ → 1 %... fable burns 2x per dollar
  const spends = [
    { at: T0 + 2 * H, model: "fable", cost: 4 }, { at: T0 + 3 * H, model: "opus", cost: 4 },
    { at: T0 + 6 * H, model: "opus", cost: 4 }, { at: T0 + 10 * H, model: "opus", cost: 4 }, { at: T0 + 11 * H, model: "tiny", cost: 1 },
  ];
  const f = fit(snaps, spends)!;
  expect(f.hours).toBe(12);
  expect(f.byModel.opus).toBeGreaterThan(0);
  expect(f.byModel.fable).toBeUndefined();
  expect(share(f, 2, "opus")).toEqual({ pct: 2 * f.byModel.opus, pooled: false });
  expect(share(f, 2, "fable")).toEqual({ pct: 2 * f.pooled, pooled: true });
  expect(share(null, 2, "opus")).toBeUndefined();
});

test("gainSince: the latest weekly percent minus the snapshot nearest to 5 hours before, in the reset window", () => {
  const t = (h: number) => new Date(Date.UTC(2026, 9, 29, 12) - h * 3600_000).toISOString();
  const snap = (h: number, seven_day: number): Snapshot => ({ at: t(h), five_hour: 1, seven_day, seven_day_resets_at: "2026-11-02T09:00:00Z" });
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

const noFive = (extra: object) => Response.json({ ...extra, seven_day: { utilization: 25, resets_at: nextWeek() } });
for (const [name, body] of [["null", { five_hour: null }], ["missing", {}], ["non-numeric", { five_hour: { utilization: "x" } }]] as const) {
  test(`a reply with ${name} five_hour gives a null five_hour snapshot`, async () => {
    reply = () => noFive(body);
    let snap: Snapshot | null = null;
    const lines = await errors(async () => { snap = await pollOnce(); });
    expect(lines).toEqual([]);
    expect(snap!.seven_day).toBe(25);
    expect(snap!.five_hour).toBeNull();
    expect(readSnapshots().at(-1)!.five_hour).toBeNull();
    expect(summary().now).not.toBeNull();
  });
}

test("readSnapshots keeps a null or missing five_hour as null and a number as is", () => {
  const f = process.env.ALEPH_USAGE_FILE!;
  const row = (m: number, extra: object) => JSON.stringify({ at: new Date(NOW - 900 * H + m * 60_000).toISOString(), seven_day: 3, seven_day_resets_at: null, ...extra });
  require("node:fs").appendFileSync(f, [row(1, { five_hour: null }), row(2, {}), row(3, { five_hour: 12 })].join("\n") + "\n");
  expect(readSnapshots().slice(-3).map((s) => s.five_hour)).toEqual([null, null, 12]);
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
  const past = { at: "2026-11-01T23:20:00Z", five_hour: null, seven_day: 25, seven_day_resets_at: "2026-11-05T00:00:00Z" };
  const future = { at: "2026-11-20T12:00:00Z", five_hour: null, seven_day: 18, seven_day_resets_at: "2026-11-05T00:00:00Z" };
  writeFileSync(process.env.ALEPH_USAGE_FILE!, [past, future].map((s) => JSON.stringify(s)).join("\n") + "\n");
  const s = summary(now);
  expect(s.now?.seven_day).toBe(25);
  expect(s.series.map((p) => p.seven_day)).toEqual([25]);
});

test("under bun test a poll without ALEPH_USAGE_FILE writes no file, so a test cannot leave a row in the real ~/.aleph/usage.jsonl", async () => {
  const saved = { f: process.env.ALEPH_USAGE_FILE, h: process.env.HOME };
  delete process.env.ALEPH_USAGE_FILE;
  process.env.HOME = dir;
  try {
    expect((await pollOnce())?.seven_day).toBe(25);
    expect(existsSync(join(dir, ".aleph"))).toBe(false);
  } finally {
    process.env.ALEPH_USAGE_FILE = saved.f;
    process.env.HOME = saved.h;
  }
});

test("a snapshot dated after the clock does not skew currentFit() or fit()", async () => {
  const jobs = join(dir, "runs");
  const keep = process.env.ALEPH_JOBS_DIR;
  process.env.ALEPH_JOBS_DIR = jobs;
  try {
    const t0 = NOW - 12 * H;
    const at = (h: number) => new Date(t0 + h * H).toISOString();
    const reset = new Date(NOW + 5 * 24 * H).toISOString();
    const good = [0, 4, 8, 12].map((h, i) => ({ at: at(h), five_hour: 0, seven_day: 10 + 4 * i, seven_day_resets_at: reset }));
    const spendsAt = [2, 6, 10];
    spendsAt.forEach((h, i) => {
      mkdirSync(join(jobs, `r${i}`), { recursive: true });
      putRun(`r${i}`, { job: "j", model: "opus", cost: 6, started: at(h), ended: at(h) } as any);
    });
    const write = (rows: object[]) => writeFileSync(process.env.ALEPH_USAGE_FILE!, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    const sp = spendsAt.map((h) => ({ at: t0 + h * H, model: "opus", cost: 6 }));

    write(good);
    const base = await currentFit();
    expect(base).not.toBeNull();
    const baseDirect = fit(good, sp);
    expect(baseDirect).not.toBeNull();

    const future = { at: new Date(NOW + 30 * H).toISOString(), five_hour: 0, seven_day: 1, seven_day_resets_at: new Date(NOW + 12 * 24 * H).toISOString() };
    write([...good, future]);
    expect(await currentFit()).toEqual(base);
    expect(readSnapshots().some((s) => s.at === future.at)).toBe(false);
  } finally {
    if (keep === undefined) delete process.env.ALEPH_JOBS_DIR; else process.env.ALEPH_JOBS_DIR = keep;
  }
});
