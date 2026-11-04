// Archived goal tests from ui/speed.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withEnv } from "../../ui/test-server.ts";
import { classify, pct, phases, speed } from "../../ui/api/speed.ts";
// @ts-ignore plain JS shared with the page
import { durShort, weekText, xLabel } from "../../ui/views/speed.js";
// @ts-ignore plain JS shared with the page
import { dur } from "../../ui/lib.js";

let base: string;
let restore: () => void;
const now = new Date(2026, 9, 28, 15, 0, 0);
const at = (daysAgo: number, h: number, m = 0) => new Date(2026, 9, 28 - daysAgo, h, m).toISOString();
let n = 0;
function run(r: Record<string, unknown>) {
  const dir = join(base, "jobs", `r${String(++n).padStart(3, "0")}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "state.json"), JSON.stringify({ job: `j${n}`, name: `j${n}`, told: true, ...r }));
}
const secs = (daysAgo: number, h: number, s: number) => ({ started: at(daysAgo, h), ended: new Date(Date.parse(at(daysAgo, h)) + s * 1000).toISOString() });

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-ui-speed-"));
  restore = withEnv({ ALEPH_JOBS_DIR: join(base, "jobs"), ALEPH_FACTORY_DIR: join(base, "factory"), ALEPH_UI_FETCH_TTL: "0", ALEPH_ISSUES: join(base, "issues") });
  // today: agents of 600 s (passed, tests 36), 1200 s (dropped), 1800 s (stuck, model unset), a 5 h broken clock
  run({ kind: "build", condition: "passed", model: "claude-opus-5-5", cost: 1, checks: [{ name: "tests", ok: true, seconds: 36 }, { name: "types", ok: true, seconds: 8 }], ...secs(0, 9, 600) });
  run({ kind: "build", condition: "dropped", model: "claude-opus-5-5", cost: 2, ...secs(0, 10, 1200) });
  run({ kind: "build", condition: "stuck", cost: 3, ...secs(0, 10, 1800) });
  run({ kind: "build", condition: "passed", cost: 9, ...secs(0, 1, 5 * 3600) });
  run({ kind: "land", condition: "landed", ...secs(0, 9, 40) });
  run({ kind: "land", condition: "landed", ...secs(0, 9, 46) }); // both without an issue: one key
  run({ kind: "land", condition: "failed", ...secs(0, 9, 100) });
  run({ kind: "triage", condition: "done", ...secs(0, 11, 20) });
  run({ kind: "build", condition: "running", started: at(0, 14) });
  // three days ago and 20 days ago
  run({ kind: "build", condition: "passed", model: "claude-sonnet-5-5", cost: 0.5, checks: [{ name: "tests", ok: true, seconds: 40 }], ...secs(3, 9, 300) });
  run({ kind: "plan", condition: "done", ...secs(20, 9, 90) });
});
afterAll(() => {
  restore();
  rmSync(base, { recursive: true, force: true });
});

test("percentiles are nearest rank", () => {
  expect(pct([], 0.5)).toBe(0);
  expect([pct([1, 2, 3, 4], 0.5), pct([1, 2, 3, 4], 0.9), pct([5], 0.9)]).toEqual([2, 4, 5]);
});

test("day: counts, medians, wasted share, buckets, slowest, models", () => {
  const d = speed("day", now);
  expect(d.kinds.agent).toEqual({ count: 3, p50: 1200, p90: 1800 }); // the 5 h run and the running one are out
  expect(d.kinds.land).toEqual({ count: 3, p50: 46, p90: 100 });
  expect(d.kinds.triage.count).toBe(1);
  expect(d.kinds.plan.count).toBe(0);
  expect(d.checks).toEqual([{ name: "tests", count: 1, p50: 36, p90: 36 }, { name: "types", count: 1, p50: 8, p90: 8 }]);
  expect("ends" in d || "wasted" in d).toBe(false);
  expect(d.classes.every((c) => c.text.length > 0)).toBe(true);
  expect(d.window).toBe("day");
  expect(d.done).toBe(1); // two land runs with no issue count as one
  expect(d.buckets.length).toBe(24);
  const b = (h: Date) => d.buckets.find((x) => x.at === h.toISOString())!;
  expect(b(new Date(2026, 9, 28, 9))).toMatchObject({ implement: 600, intake: null });
  expect(b(new Date(2026, 9, 28, 10))).toMatchObject({ implement: null });
  expect(d.slowest.map((r) => [r.condition, r.took])).toEqual([["stuck", 1800], ["dropped", 1200], ["passed", 600]]);
  expect(d.slowest[0].model).toBe("unset");
  expect(d.slowest[2]).toMatchObject({ tests: 36, cost: 1 });
  expect(d.models).toEqual([{ model: "claude-opus-5-5", count: 2, p50: 600 }, { model: "unset", count: 1, p50: 1800 }]);
  expect(d.flaky).toBe(0);
});

test("hour: sixty 1-minute buckets over the last hour", () => {
  const h = speed("hour", new Date(2026, 9, 28, 9, 47, 0));
  expect(h.buckets.length).toBe(60);
  expect(h.kinds.agent.count).toBe(1); // the 09:00 run
  const m = speed("hour", new Date(2026, 9, 28, 9, 7, 0));
  expect(m.done).toBe(1);
});

test("week and month: one bucket per local day, wider windows add runs", () => {
  const w = speed("week", now);
  expect(w.buckets.length).toBe(7);
  expect(w.kinds.agent.count).toBe(4);
  expect(w.buckets[3]).toMatchObject({ implement: 300 });
  expect(w.models.map((m) => m.model)).toContain("claude-sonnet-5-5");
  const m = speed("month", now);
  expect(m.buckets.length).toBe(30);
  expect(m.kinds.plan.count).toBe(1);
});

test("classify: a reason over 140 characters ends at a word with an ellipsis; a short one is untouched", () => {
  const t = (h: number) => new Date(2026, 9, 28, h).toISOString();
  const long = "measure per file output of the slow suites before changing the runner so that every worker reports where its time goes " + "and ".repeat(20) + "end";
  const r = (job: string, n: number, reason: string) =>
    ({ kind: "build", job, name: job, repo: "fx", on: `fx-${n}`, condition: "stuck", noCommit: true, reason, started: t(1), ended: t(2) }) as any;
  const out = classify([r("p", 5, "agent run p: " + long), r("q", 6, "Main no")], () => "dropped", new Date(2026, 9, 27).getTime(), new Date(2026, 9, 28, 15).getTime(), null);
  const top = out.classes.find((c) => c.key === "dropped")!.top;
  const a = top.find((e) => e.goal === "fx-5")!.reason, b = top.find((e) => e.goal === "fx-6")!.reason;
  expect(long.length).toBeGreaterThan(140);
  expect(a.length).toBeLessThanOrEqual(140);
  expect(a.endsWith("…")).toBe(true);
  const body = a.slice(0, -1);
  expect(long.startsWith(body)).toBe(true);
  expect(long[body.length]).toBe(" ");
  expect(b).toBe("Main no");
});

test("phases: hist has 7 bins, an edge falls in the upper bin, counts sum to count, worst is the longest", () => {
  const t = (h: number, m = 0, s = 0) => new Date(2026, 9, 28, h, m, s).toISOString();
  const r = (job: string, a: string, b: string) => ({ kind: "build", job, name: job, condition: "passed", started: a, ended: b }) as any;
  const since = new Date(2026, 9, 28, 0).getTime(), end = new Date(2026, 9, 28, 23).getTime();
  // implement times: 30s, 60s (edge), 299s, 15m (edge), 45m, 2h, 3h
  const runs = [r("a", t(1), t(1, 0, 30)), r("b", t(1), t(1, 1)), r("c", t(1), t(1, 4, 59)), r("d", t(1), t(1, 15)), r("e", t(1), t(1, 45)), r("f", t(1), t(3)), r("g", t(1), t(4))];
  const p = phases(runs, { issue: new Map() }, since, end);
  expect(p.implement.hist).toEqual([1, 2, 0, 1, 1, 2, 0]);
  expect(p.implement.hist.reduce((a, b) => a + b, 0)).toBe(p.implement.count);
  expect(p.implement.worst).toBe(10800);
  expect(p.intake.hist).toEqual([0, 0, 0, 0, 0, 0, 0]);
  expect(p.intake.worst).toBe(0);
});

test("classify: the parts of one issue are goals of their own, and a top list links to the part", () => {
  const t = (s: number) => new Date(2026, 9, 28, 8, 0, s).toISOString();
  const b = (job: string, ref: string, s: number, e: number) => ({ kind: "build", job, name: job, repo: "fx", on: `fx-${ref}`, condition: "passed", started: t(s), ended: t(e) }) as any;
  const l = (job: string, ref: string, s: number, e: number) => ({ kind: "land", job, name: job, repo: "fx", on: `fx-${ref}`, condition: "landed", started: t(s), ended: t(e) }) as any;
  const runs = [b("p1", "7.1", 0, 100), b("p4", "7.4", 4, 100), l("p4", "7.4", 110, 120), l("p1", "7.1", 130, 140)];
  const out = classify(runs, () => "open", new Date(2026, 9, 27).getTime(), new Date(2026, 9, 28, 15).getTime(), null);
  const by = (k: string) => out.classes.find((c) => c.key === k)!;
  expect(by("landed").runs).toBe(2);
  expect(by("restarted").runs).toBe(0);
  const d = classify([{ ...b("x", "7.2", 0, 100), condition: "stuck", noCommit: true }], () => "dropped", new Date(2026, 9, 27).getTime(), new Date(2026, 9, 28, 15).getTime(), null);
  expect(d.classes.find((c) => c.key === "dropped")!.top[0]).toMatchObject({ goal: "fx-7.2", href: "#/issues/fx/7.2" });
});

test("averageFigures averages each figure over the spans that have data for it", async () => {
  const { averageFigures } = await import("../../ui/api/speed.ts");
  const none = { lost: null, hours: null, leadP50: null, leadP90: null, queueP50: null, queueP90: null, landed: null, firstPass: null };
  const a = averageFigures([{ ...none, lost: 0.2, landed: 4 }, none, { ...none, lost: 0.4, landed: 0 }]);
  expect(a).toMatchObject({ lost: 0.3, landed: 2, leadP50: null, firstPass: null });
});
