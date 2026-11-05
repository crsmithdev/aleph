import { describe, expect, test } from "bun:test";
// @ts-ignore plain JS, shared with the page
import { axisTimes, compactScale, gaps, fromTo, laneRow, noteEvent, renderTimeline, runEvent, spans, waitEvent } from "./timeline.js";
// @ts-ignore
import { dur } from "./lib.js";
// @ts-ignore
import { issueSegments, renderIssue } from "./views/issues.js";

const run = (kind: string, started: string, ended: string | null, extra: object = {}) => ({ kind, name: "fac-1", on: "fac-1", condition: "passed", started, ended, ...extra });
const issue = (over: object = {}) => ({ repo: "fac", id: 1, ref: "1", status: "done", frontmatter: { created: "2026-11-01" }, notes: [], commits: [], jobs: [], goals: [], timeline: { filed: Date.parse("2026-11-01T10:00:00Z"), runs: [] }, ...over });
const held = () => [
  run("triage", "2026-11-01T10:00:30Z", "2026-11-01T10:02:00Z"),
  run("build", "2026-11-01T10:30:00Z", "2026-11-01T10:40:00Z", { condition: "waiting", cost: 0.25 }),
  run("land", "2026-11-01T15:00:00Z", "2026-11-01T15:01:00Z", { condition: "landed", cost: 0.05 }),
];
const rowsOf = (d: object, now?: number) => issueSegments(issue(d), now).flatMap((s: any) => s.rows);

describe("the waits", () => {
  test("a wait fills each gap over a minute: the factory's between runs, yours after a run that awaits you", () => {
    const w = gaps(spans(held()), Date.parse("2026-11-01T10:00:00Z"), NaN);
    expect(w.map((x: any) => [dur((x.end - x.start) / 1000), x.chris])).toEqual([["28m 00s", false], ["4h 20m", true]]);
  });

  test("a gap of a minute or less is no wait; a wait runs on to `to`", () => {
    const s = spans([run("build", "2026-11-01T10:00:00Z", "2026-11-01T10:05:00Z"), run("land", "2026-11-01T10:05:30Z", "2026-11-01T10:06:00Z")]);
    expect(gaps(s, Date.parse("2026-11-01T09:59:30Z"), NaN)).toEqual([]);
    expect(gaps(s, NaN, Date.parse("2026-11-01T10:16:00Z")).map((x: any) => x.end - x.start)).toEqual([600_000]);
  });
});

// flaky: tests/flaky.md#timeline
describe.skip("the issue timeline", () => {
  test("without parts it is one Work row: a bar per run, the waits, and the notes as events", () => {
    const [row] = rowsOf({ timeline: { filed: Date.parse("2026-11-01T10:00:00Z"), runs: held() }, notes: ["- 2026-11-01 10:41: triage: asked"] });
    expect(issueSegments(issue({ timeline: { filed: 0, runs: held() } })).map((s: any) => s.title)).toEqual(["Work"]);
    expect(row.bars.map((b: any) => [b.label, b.tone])).toEqual([["triage", "aux"], ["build", "build"], ["land", "land"]]);
    expect(row.bars[1].href).toBe("#/jobs/fac-1");
    expect(row.waits.map((w: any) => w.chris)).toEqual([false, true]);
    expect(row.events.map((e: any) => e.tag)).toEqual(["Waiting", "Awaiting you", "triage"]);
    expect(row.cost).toBe("$0.30");
  });

  test("an open issue waits up to now; a live run runs up to now", () => {
    const now = Date.parse("2026-11-01T12:00:00Z");
    expect(rowsOf({ status: "open", timeline: { filed: now - 3_600_000, runs: [] } }, now)[0].waits).toEqual([{ start: now - 3_600_000, end: now, chris: false }]);
    const live = rowsOf({ status: "open", timeline: { filed: now - 3_600_000, runs: [run("build", "2026-11-01T11:30:00Z", null, { condition: "running" })] } }, now)[0];
    expect(live.bars[0].end).toBe(now);
  });

  test("with no filing time, a run on the created day starts it, so midnight draws no false wait", () => {
    const [row] = rowsOf({ timeline: { filed: null, runs: [run("build", "2026-11-01T18:00:00", "2026-11-01T18:10:00")] } });
    expect(row.waits).toEqual([]);
  });

  test("with parts: before the split, a row per part from its runs' `on`, and after the parts to the close", () => {
    const parts = [{ id: "fac-1.1", title: "one", href: "#/issues/fac/1.1", stage: "done", jobs: [{ name: "fac-1.1" }] }, { id: "fac-1.2", title: "two", href: "#/issues/fac/1.2", stage: "done", jobs: [] }];
    const runs = [
      run("plan", "2026-11-01T10:05:00Z", "2026-11-01T10:06:00Z", { name: "plan-fac-1" }),
      run("build", "2026-11-01T10:07:00Z", "2026-11-01T10:10:00Z", { name: "fac-1.1", on: "fac-1.1", condition: "failed", reason: "it broke" }),
      run("build", "2026-11-01T10:11:00Z", "2026-11-01T10:15:00Z", { name: "fac-1.1", on: "fac-1.1" }),
      run("build", "2026-11-01T10:16:00Z", "2026-11-01T10:20:00Z", { name: "fac-1.2", on: "fac-1.2" }),
    ];
    const notes = ["- 2026-11-01 10:06: planner: split into fac-1.1, fac-1.2", "- 2026-11-01 10:25: its parts are done"];
    const segs = issueSegments(issue({ goals: parts, notes, timeline: { filed: Date.parse("2026-11-01T10:00:00Z"), runs } }));
    expect(segs.map((s: any) => [s.title, s.rows.length])).toEqual([["Before the Split", 1], ["Parts", 2], ["After the Parts", 1]]);
    const [before] = segs[0].rows, [one, two] = segs[1].rows, [after] = segs[2].rows;
    expect(before.bars.map((b: any) => b.label)).toEqual(["plan"]);
    expect(before.events.map((e: any) => e.tag)).toEqual(["Waiting", "planner"]);
    expect(one.bars.map((b: any) => [b.label, b.tone])).toEqual([["build 1", "bad"], ["build 2", "build"]]);
    expect(one.events.find((e: any) => e.tag === "Failed").html).toBe("Build 1: it broke");
    expect(one.head).toContain('href="#/jobs/fac-1.1"');
    expect(two.head).toContain('href="#/issues/fac/1.2"');
    // fac-1.2 waited from the split to its run: 10 min.
    expect(two.waits.map((w: any) => dur((w.end - w.start) / 1000))).toEqual(["10m 00s"]);
    expect(after.marks.map((m: any) => m.tone)).toEqual(["done"]);
    expect(after.events.map((e: any) => e.tag)).toEqual(["Waiting", "note"]);
  });
});

describe("the event tags", () => {
  const iso = (min: number) => new Date(Date.parse("2026-11-01T10:00:00Z") + min * 60_000).toISOString();
  const runTag = (over: object) => runEvent(spans([run("worker", iso(0), iso(5), over)])[0], "build 1");
  const tagTone = (e: any) => [e.tag, e.tone];

  test("a run's tag is its job state: returned for a sent-back run, failed for a broken one", () => {
    expect(tagTone(runTag({ condition: "stuck", failed: "review" }))).toEqual(["returned", "stuck"]);
    expect(tagTone(runTag({ condition: "stuck" }))).toEqual(["failed", "stuck"]);
    expect(tagTone(runTag({ condition: "awaiting" }))).toEqual(["waiting", "need"]);
    expect(tagTone(runTag({ condition: "landed" }))).toEqual(["landed", "done"]);
  });

  test("a wait's tag is waiting, for the factory's wait and yours", () => {
    const w = { start: Date.parse(iso(0)), end: Date.parse(iso(9)) };
    expect(tagTone(waitEvent({ ...w, chris: false }))).toEqual(["waiting", "need"]);
    expect(tagTone(waitEvent({ ...w, chris: true }))).toEqual(["waiting", "need"]);
  });

  test("no event tag of a lane row has an upper-case letter", () => {
    const runs = [
      run("worker", iso(0), iso(5), { condition: "stuck", failed: "review" }),
      run("worker", iso(5.5), iso(10), { condition: "stuck" }),
      run("worker", iso(30), iso(35), { condition: "awaiting", reason: "which one?" }),
      run("worker", iso(60), iso(65), { condition: "failed" }),
      run("worker", iso(65.5), iso(70), { condition: "dropped" }),
    ];
    const row = laneRow({ head: "h", runs: spans(runs), from: Date.parse(iso(0)) });
    expect(row.events.map((e: any) => e.tag)).toEqual(["waiting", "waiting", "returned", "failed", "waiting", "failed", "dropped"]);
    expect(row.events.filter((e: any) => /[A-Z]/.test(e.tag))).toEqual([]);
  });
});

describe("the compact scale", () => {
  test("it keeps the order, spans 0 to 1, and gives a short run room beside a long wait", () => {
    const t0 = 0, run = 180_000, wait = 14 * 86_400_000;
    const x = compactScale([t0, run, run + wait]);
    expect(x(t0)).toBe(0);
    expect(x(run + wait)).toBe(1);
    expect(x(run)).toBeGreaterThan(0.01);
    expect(x(run + wait / 2)).toBeGreaterThan(x(run));
    expect(x(run + wait / 2)).toBeLessThan(1);
  });

  test("one time is at 0 and the axis labels keep apart", () => {
    expect(compactScale([5])(5)).toBe(0);
    const times = [0, 1000, 2000, 1_000_000, 100_000_000];
    const x = compactScale(times), ticks = axisTimes(times, x);
    for (let i = 1; i < ticks.length; i++) expect(x(ticks[i]) - x(ticks[i - 1])).toBeGreaterThanOrEqual(0.24);
  });
});

describe("the timeline panel", () => {
  test("it shows the axis, the segments, the bars as links to their jobs and the events, escaped", () => {
    const h = renderTimeline(issueSegments(issue({ timeline: { filed: Date.parse("2026-11-01T10:00:00Z"), runs: held() }, notes: ["- 2026-11-01 10:41: <b>x</b>"] })));
    expect(h).toContain('<h2 id="h-timeline">Timeline</h2>');
    expect(h).toContain("<h3>Work</h3>");
    expect(h).toContain('<a class="dp-bar t-build" href="#/jobs/fac-1"');
    expect(h).toContain("Long spans are compressed");
    expect(h).not.toContain("dp-key");
    expect(h).toContain('<ul class="legend"><li><i class="t-wait"></i>waiting</li><li><i class="t-chris"></i>');
    expect(h).not.toContain('<i class="t-bad">');
    expect(h).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(h).not.toContain("<b>x");
    expect(renderTimeline([])).toBe("");
  });

  test("the Issue page puts the KPIs, then the Timeline, then the Description, then Notes and Commits", () => {
    const page = renderIssue({ ...issue({ timeline: { filed: Date.parse("2026-11-01T10:00:00Z"), runs: held() } }), title: "t", labels: [], priority: "low", specs: [], request: "r", derived: null });
    const at = (t: string) => page.indexOf(t);
    expect(at("dp-kpis")).toBeGreaterThan(-1);
    expect(at("dp-kpis")).toBeLessThan(at('id="h-timeline"'));
    expect(at('id="h-timeline"')).toBeLessThan(at('id="h-request"'));
    expect(at('id="h-request"')).toBeLessThan(at("<span>Notes</span>"));
    expect(at("<span>Notes</span>")).toBeLessThan(at("<span>Commits</span>"));
    expect(page).toContain("Awaiting you");
  });

  test("the formats", () => {
    expect(noteEvent("- 2026-11-01 08:06: done it")).toEqual({ at: Date.parse("2026-11-01T08:06"), text: "done it" });
    expect(noteEvent("no stamp")).toBeNull();
  });
});

describe("waitEvent", () => {
  const t0 = Date.parse("2026-11-01T08:00:00Z"), min = 60_000;
  const w = { start: t0, end: t0 + 9 * min, chris: false };
  const iso = (m: number) => new Date(t0 + m * min).toISOString();
  test("ends a hold at a started record", () => {
    const e = waitEvent(w, [{ at: iso(-1), name: "a", kind: "held", text: "x" }, { at: iso(3), name: "a", kind: "started", text: "" }]);
    expect(e.html).toBe("Waited 9m 00s: 3m 00s because x.");
  });
  test("reads Waited N min. with no records", () => {
    expect(waitEvent(w).html).toBe("Waited 9m 00s.");
    expect(waitEvent(w, []).html).toBe("Waited 9m 00s.");
    const mapped: any[] = ([w] as any[]).map(waitEvent as any);
    expect(mapped[0].html).toBe("Waited 9m 00s.");
  });
});

describe("the issue page's tidy-up", () => {
  const html = renderIssue(issue({ derived: { stage: "done" }, timeline: { filed: 0, runs: [run("build", "2026-11-01T10:30:00Z", "2026-11-01T14:40:00Z", { model: "claude-sonnet-5-5" }), run("land", "2026-11-01T15:00:00Z", "2026-11-01T15:01:00Z", { condition: "landed" })] }, notes: ["- 2026-11-01 10:00: a note"] }));
  test("the Stage is lower case, no bar or tip names a model, and there is no Detail h2", () => {
    expect(html).toContain('<span class="dp-v">done</span>');
    expect(html).not.toMatch(/sonnet|opus/i);
    expect(html).not.toContain("<h2>Detail</h2>");
  });
  test("a long event is clamped with a button to read the rest; a short one is not", () => {
    const seg = (text: string) => renderTimeline([{ title: "t", rows: [{ head: "h", bars: [], waits: [], events: [{ at: 1, tag: "x", html: text }] }] }]);
    expect(seg("word ".repeat(60))).toContain(`<div class="dp-evt"><div class="clamp">${"word ".repeat(60)}</div><button class="link clamp-btn" type="button" aria-expanded="false">Show more</button></div>`);
    expect(seg("short")).not.toContain("clamp-btn");
  });
});

test("fromTo shows mm/dd hh:mm for two times on one day", () => {
  expect(fromTo(new Date(2026, 9, 28, 14, 5), new Date(2026, 9, 28, 15, 7))).toBe("10/28 14:05 to 10/28 15:07");
});
