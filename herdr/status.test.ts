import { expect, test } from "bun:test";
import { data, frame, render } from "./status.ts";
import { verdict } from "../lib/status-words.ts";
// @ts-ignore plain JS, shared with the page
import { cardList } from "../ui/views/lib/flow-parts.js";

const plain = (lines: string[]) => lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, ""));
const LONG = "Make the status panel cut every line that is longer than the pane";
/** 50 landed events, newest first as /api/log sends them: aleph-149 at 18:10 down to aleph-100 at 10:00. */
const LOG = Array.from({ length: 50 }, (_, i) => {
  const n = 49 - i;
  return { at: `2026-10-27T${String(Math.floor(n / 6) + 10).padStart(2, "0")}:${String((n % 6) * 10).padStart(2, "0")}:00`, action: "landed", issue: { id: `a${100 + n}` }, job: null, title: n === 49 ? LONG : `Issue ${100 + n}`, by: "rule", took: null };
});
const memory = {
  total: 3, notes: [{ read: "2026-10-26" }, { read: null }, { read: null }], misses: { unoffered_reads: 2 },
  start: { aleph: { bytes: 5900, budget: 6000, core: [1, 2], cut: 0 } }, lint: { refuse: [], warn: [] }, processes: { decay: { stale: [{ over: 40 }] } },
};
const state: any = {
  now: "2026-10-27T17:00:00Z",
  factory: { paused: false, liveCap: 1, liveRuns: 1, runCap: 1, runStarts: 0, health: [{ text: "judge is down", kind: "alert" }] },
  asks: [{ id: "aleph-27", repo: "aleph", label: "Decide", title: "Digest head and tail", headline: "Digest head and tail", situation: "Two shapes fit" }],
  errored: [{ id: "j30", name: "aleph-30", repo: "aleph", state: "failed", cause: "no-commit", item: { id: 30, title: "Route tiers" } }],
  running: [{ id: "j36", name: "aleph-36", repo: "aleph", started: "2026-10-27T16:00:00Z", run: { kind: "build", started: "2026-10-27T16:00:00Z" }, item: { id: 36, title: "Run now" } }],
  runningIssues: [],
  queued: [
    { repo: "aleph", id: 9, title: "Nine", kind: "after", waits: [{ id: "aleph-5" }], heldAt: "2026-10-27T15:00:00Z" },
    { repo: "aleph", id: 10, title: "Ten", kind: "after", waits: [{ id: "aleph-5" }], heldAt: "2026-10-27T16:00:00Z" },
  ],
  usage: { now: { seven_day: 40, seven_day_resets_at: "2026-10-30T17:00:00Z" } },
  memory, log: { rows: LOG, total: 50 },
};
const flow: any = {
  window: "week",
  figures: { lost: 0.38, hours: 2, kept: 8, leadP50: 1570, leadP90: 16560, filed: 9, landed: 7, dropped: 1, firstPass: 0.91 },
  baseline: { base: { lost: 0.25, leadP50: 1200, firstPass: 0.8 }, prev: {}, basis: "the previous 7 days" },
  classes: [{ key: "landed", lost: false, hours: 8, causes: [] }, { key: "failed", lost: true, hours: 2, causes: [{ name: "check", hours: 1.5 }, { name: "timeout", hours: 0.5 }] }],
  stages: { rows: ["intake", "build", "review", "recheck", "land"].map((stage, i) => ({ stage, runs: 3, items: 2, unusable: i % 2, p90: 300, minutes: 1 })) },
  phases: { intake: { count: 1, p90: 60 }, queue: { count: 2, p90: 90 }, implement: { count: 2, p90: 3600 }, land: { count: 0, p90: null } },
  issues: { firstPass: 0.71 }, open: { open: 4, parked: 6 }, asks: { count: 3, manual: 1 },
  buckets: [{ at: "2026-10-26T00:00:00" }, { at: "2026-10-27T00:00:00" }], times: [{ outcome: "landed", filed: "2026-10-27T01:00:00", lead: 3600 }],
};
const HEADS = ["Scorecard", "Problems", "Issues in Motion", "Efficiency", "Flow", "Memory", "Events"];
/** The lines between the head `from` and the next head. */
function section(text: string[], from: string) {
  const rest = text.slice(text.indexOf(from) + 1), end = rest.findIndex((l) => HEADS.includes(l));
  return end < 0 ? rest : rest.slice(0, end);
}

test("no line is wider than the pane, and a long title is cut with an ellipsis", () => {
  const lines = plain(render(state, flow, { width: 40, height: 80 }));
  expect(Math.max(...lines.map((l) => Bun.stringWidth(l)))).toBeLessThanOrEqual(40);
  const cut = lines.find((l) => l.includes("Make the status"))!;
  expect(cut.endsWith("…")).toBe(true);
});

test("the first line is the coloured status sentence and the sections follow in page A's one-column order", () => {
  const lines = render(state, flow, { width: 200, height: 80 }), text = plain(lines);
  expect(text[0]).toBe(verdict(state).text);
  expect(lines[0].startsWith("\x1b[31m")).toBe(true);
  const narrow = plain(render(state, flow, { width: 20, height: 80 }))[0];
  expect(narrow.endsWith("…") && verdict(state).text.startsWith(narrow.slice(0, -1))).toBe(true);
  const at = HEADS.map((h) => text.indexOf(h));
  expect(at.every((i) => i > 0)).toBe(true);
  expect(at).toEqual([...at].sort((a, b) => a - b));
  expect(text.some((l) => /\bOK\b/.test(l))).toBe(false);
});

test("Problems lists the alert, the Ask and the errored job with what stopped it, then the full start context", () => {
  expect(section(plain(render(state, flow, { width: 80, height: 80 })), "Problems")).toEqual([
    "Alert judge is down", "Decide aleph-27 Digest head and tail", "Two shapes fit", "Error j30 Route tiers", "The worker made no commit.",
    "Memory Start context near its budget", "100 B left in aleph",
  ]);
  const calm = { ...state, asks: [], errored: [], factory: { ...state.factory, health: [] }, memory: { ...memory, start: { aleph: { ...memory.start.aleph, bytes: 10 } } } };
  expect(section(plain(render(calm, flow, { width: 80, height: 80 })), "Problems")).toEqual(["No data"]);
});

test("Issues in Motion lists each run, then one Waiting row per hold with its issues and the oldest wait", () => {
  expect(section(plain(render(state, flow, { width: 120, height: 80 })), "Issues in Motion")).toEqual([
    "j36 implement 1h 00m Run now", "Waiting", "after aleph-5 2h 00m: aleph-9 Nine · aleph-10 Ten",
  ]);
});

test("Efficiency, Flow and Memory carry the page's figures", () => {
  const text = plain(render(state, flow, { width: 120, height: 80 }));
  expect(section(text, "Efficiency")).toEqual(["8.0h of 10h reached main", "landed 8.0h · failed 2.0h", "Lost Time by Cause", "check 1.5h", "timeout 0.5h", "Failed Runs by Stage", "Implement 1 of 3", "Recheck 1 of 3"]);
  expect(section(text, "Flow")).toEqual(["Filed 9 · Landed 7 · Dropped 1 · First Pass 71% · Open 4 +6 · Asks 3 1 yours", "Time by Phase, p90", "Intake 0 1m 00s", "Queue 2 1m 30s", "Implement 1 1h 00m", "Land 0 –"]);
  expect(section(text, "Memory")).toEqual(["aleph 2 lines 5,900 / 6,000 B", "Notes 3 · Offered 1 · Never 2 · Unoffered 2 · Refused 0 · Stale 1 1 late"]);
});

test("the data gives the mod each bar's share of the largest and the series of the two column charts", () => {
  const p = data(state, flow);
  expect(p.efficiency.lost.map((r) => r.bar)).toEqual([1, 1 / 3]);
  expect(p.efficiency.failed.map((r) => r.bar)).toEqual([1, 1]);
  expect(p.flow.phases.map((r) => r.bar)).toEqual([1 / 60, 1 / 40, 1, 0]);
  expect([p.flow.per, p.flow.landed]).toEqual(["day", [0, 1]]);
  expect(p.memory!.start.map((r) => [r.share, r.full])).toEqual([[5900 / 6000, true]]);
  expect(p.memory!.offers).toHaveLength(7);
});

test("the scorecard prints the five cards of the page's card list, a three-value card's values and labels each joined by a slash", () => {
  const text = plain(render(state, flow, { width: 80, height: 80 })), card = section(text, "Scorecard");
  for (const label of ["Working", "Efficiency", "Lead Time", "Usage", "Memory"]) expect(card.some((l) => l.startsWith(label))).toBe(true);
  expect(card.find((l) => l.startsWith("Efficiency"))).toContain("▼");
  const working = data(state, flow).scorecard.find((c) => c.name === "Working")!;
  expect([working.value, working.note]).toEqual(["1 / 2 / 1", "running / waiting / error"]);
});

test("with null figures the scorecard prints the card values of the page's card list", () => {
  const empty = { ...flow, figures: { ...flow.figures, lost: null, hours: null, kept: null, leadP50: null, leadP90: null }, baseline: undefined };
  const cards = cardList(state, empty, { memory });
  expect(data(state, empty).scorecard.map((c) => c.value)).toEqual(cards.map((c: any) => [c.v, c.v2].flat().filter((x) => x !== undefined).join(" / ")));
  expect(data(state, empty).scorecard.map((c) => c.value)).toEqual(["1 / 2 / 1", "– / –", "– / –", "40% / 57%", "98%"]);
});

test("the height fills the pane, and the cut drops the oldest events", () => {
  const rows = (h: number) => plain(render(state, flow, { width: 80, height: h }));
  const shown = (t: string[]) => t.filter((l) => /^\d\d:\d\d landed a\d+/.test(l));
  const short = rows(45), tall = rows(90);
  expect(short.length).toBe(45);
  expect(shown(tall).length).toBeGreaterThan(shown(short).length);
  expect(shown(short).length).toBeGreaterThan(0);
  expect(shown(short)).toEqual(shown(tall).slice(0, shown(short).length));
  expect(shown(short)[0]).toStartWith("18:10 landed a149");
});

test("a failed refresh keeps the last data drawn, with a stale note in place of the error", () => {
  const size = { width: 80, height: 80 }, lines = plain(frame([state, flow], "store is down", size));
  expect(lines.length).toBe(size.height);
  expect(lines.slice(0, -1)).toEqual(plain(render(state, flow, { ...size, height: size.height - 1 })));
  expect(lines.at(-1)).toBe("stale");
});

test("a failed refresh with no data yet shows the clipped error line only", () => {
  expect(plain(frame(null, "store is down", { width: 8, height: 80 }))).toEqual(["store…"]);
});

test("a refresh that succeeds draws the status page as render does", () => {
  const size = { width: 80, height: 80 };
  expect(frame([state, flow], "", size)).toEqual(render(state, flow, size));
});

test("the badge takes the worst alert", () => {
  expect(data(state, flow).badge).toEqual({ text: "Not OK", tone: "alert" });
  const calm = { ...state, asks: [], errored: [], factory: { ...state.factory, health: [] }, memory: { ...memory, start: { aleph: { ...memory.start.aleph, bytes: 10 } } } };
  expect(data(calm, flow).badge).toEqual({ text: "OK", tone: "fine" });
});
