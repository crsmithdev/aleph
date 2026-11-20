import { expect, test } from "bun:test";
import { data, render } from "./status.ts";
import { verdict } from "../lib/status-words.ts";
import { heraldRows } from "../ui/herald.ts";
// @ts-ignore plain JS, shared with the page
import { cardList } from "../ui/views/lib/flow-parts.js";

const ctx = { titles: {}, runs: {}, attempts: {}, reviewed: {} };

const plain = (lines: string[]) => lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, ""));
const LONG = "Make the status panel cut every line that is longer than the pane";
const EVENTS = Array.from({ length: 50 }, (_, i) => ({ time: `2026-10-27T${String(Math.floor(i / 6) + 10).padStart(2, "0")}:${String((i % 6) * 10).padStart(2, "0")}:00Z`, subject: "rule", action: "landed", object: `aleph-${100 + i}`, object_target: null }));
const state: any = {
  now: "2026-10-27T17:00:00Z",
  factory: { paused: false, liveCap: 1, liveRuns: 1, runCap: 1, runStarts: 0, health: [{ text: "judge is down", kind: "alert" }] },
  asks: [{ id: "aleph-27", repo: "aleph", label: "Decide", title: "Digest head and tail", headline: "Digest head and tail" }],
  errored: [{ name: "aleph-30", repo: "aleph", state: "failed", item: { id: 30, title: "Route tiers" } }],
  running: [{ name: "aleph-36", repo: "aleph", started: "2026-10-27T16:00:00Z", item: { id: 36, title: "Run now" } }],
  runningIssues: [], queued: [{ id: 9 }],
  usage: { now: { seven_day: 40, seven_day_resets_at: "2026-10-30T17:00:00Z" } },
  herald: { rows: heraldRows(EVENTS as any, { ...ctx, titles: { "aleph-149": LONG } }) },
};
const flow: any = {
  figures: { lost: 0.38, hours: 6, leadP50: 1570, leadP90: 16560, landed: 7, firstPass: 0.91 },
  baseline: { base: { lost: 0.25, leadP50: 1200, firstPass: 0.8 }, prev: {}, basis: "the previous 7 days" },
  classes: [{ key: "landed", lost: false, hours: 8 }, { key: "failed", lost: true, hours: 2 }],
  stages: { rows: ["intake", "build", "review", "recheck", "land"].map((stage) => ({ stage, runs: 3, items: 2, unusable: 1, p90: 300 })) },
  phases: { queue: { count: 2, p90: 90 } },
  active: [{ intake: 1, queue: 2, running: 3, landed: 4 }],
};
const first = (lines: string[]) => lines.findIndex((l) => /^\d\d:\d\d landed aleph-\d+/.test(l));

test("no line is wider than the pane, and a long title is cut with an ellipsis", () => {
  const lines = plain(render(state, flow, { width: 40, height: 60 }));
  expect(Math.max(...lines.map((l) => Bun.stringWidth(l)))).toBeLessThanOrEqual(40);
  const cut = lines.find((l) => l.includes("Make the status"))!;
  expect(cut.endsWith("…")).toBe(true);
});

test("the first line is the coloured status sentence and the sections follow in the page's order", () => {
  const lines = render(state, flow, { width: 200, height: 60 }), text = plain(lines);
  expect(text[0]).toBe(verdict(state).text);
  expect(lines[0].startsWith("\x1b[31m")).toBe(true);
  const narrow = plain(render(state, flow, { width: 20, height: 60 }))[0];
  expect(narrow.endsWith("…") && verdict(state).text.startsWith(narrow.slice(0, -1))).toBe(true);
  const at = ["Scorecard", "Agent Time", "Pipeline", "Active Issues", "Herald"].map((h) => text.indexOf(h));
  expect(at.every((i) => i > 0)).toBe(true);
  expect(at).toEqual([...at].sort((a, b) => a - b));
});

test("the scorecard has its five labels, and the alerts and running jobs come before the events", () => {
  const text = plain(render(state, flow, { width: 80, height: 60 }));
  const card = text.slice(text.indexOf("Scorecard"), text.indexOf("Agent Time"));
  for (const label of ["Lost time", "Completion", "Landed", "Jobs", "Usage"]) expect(card.some((l) => l.startsWith(label))).toBe(true);
  expect(card.find((l) => l.startsWith("Lost time"))).toContain("▲");
  const herald = text.indexOf("Herald"), ask = text.findIndex((l) => l.includes("aleph-27")), errored = text.findIndex((l) => l.includes("aleph-30")), run = text.findIndex((l) => l.includes("Run now"));
  expect(herald).toBeLessThan(ask);
  expect(ask).toBeLessThan(errored);
  expect(errored).toBeLessThan(run);
  expect(run).toBeLessThan(first(text));
});

test("with null figures the scorecard prints the card values of the page's card list", () => {
  const empty = { ...flow, figures: { lost: null, hours: null, kept: null, leadP50: null, leadP90: null, landed: null, firstPass: null }, baseline: undefined };
  const cards = cardList(state, empty, {});
  expect(data(state, empty).scorecard.map((c) => c.value)).toEqual(cards.map((c: any) => [c.v, c.v2].filter((x) => x !== undefined).join(" / ")));
  expect(data(state, empty).scorecard.map((c) => c.value)).toEqual(["–", "– / –", "–", "1 / 1", "40% / 57%"]);
});

test("the height fills the pane, and the cut drops the oldest events", () => {
  const rows = (h: number) => plain(render(state, flow, { width: 80, height: h }));
  const short = rows(30), tall = rows(60), shown = (t: string[]) => t.filter((l) => first([l]) === 0);
  expect(short.length).toBe(30);
  expect(shown(tall).length).toBeGreaterThan(shown(short).length);
  expect(shown(short).length).toBeGreaterThan(0);
  expect(shown(short)).toEqual(shown(tall).slice(0, shown(short).length));
  expect(shown(short)[0]).toStartWith("18:10 landed aleph-149");
});

test("the data's Herald is one row per issue with its older events folded, and a row for a routine run that changed nothing", () => {
  const ev = (time: string, subject: string, action: string, object: string, extra = {}) => ({ time: `2026-10-27T${time}:00Z`, subject, action, object, object_target: null, ...extra });
  const s = { ...state, herald: { rows: heraldRows([
    ev("10:00", "rule", "filed", "aleph-7"), ev("10:05", "gate", "landed", "aleph-7"),
    ev("10:01", "gate", "running", "job.2"), ev("10:02", "gate", "done", "job.2"),
    ev("10:03", "gate", "running", "job.3"), ev("10:04", "job.3", "changed", "aleph-8", { detail: "retitle: New name" }), ev("10:06", "gate", "done", "job.3"),
  ] as any, { ...ctx, titles: { "aleph-7": "Fold the herald" }, runs: { "job.2": "judge", "job.3": "housekeeper" } }) } };
  const rows = data(s, flow).herald;
  expect(rows.map((r: any) => [r.id, r.word, r.title])).toEqual([["housekeeper j3", "ended", "retitled 1"], ["aleph-7", "landed", "Fold the herald"], ["judge j2", "ended", ""]]);
  expect(rows[0].fold.map((f: any) => [f.label, f.text])).toEqual([["retitled", "aleph-8 New name"]]);
  expect(rows[1].fold.map((f: any) => f.label)).toEqual(["filed"]);
});
