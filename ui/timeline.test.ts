import { describe, expect, test } from "bun:test";
// @ts-ignore plain JS, shared with the page
import { axisTimes, compactScale, lifeRows, lifespan, noteEvent, renderLifetime } from "./timeline.js";
// @ts-ignore
import { renderIssue } from "./views/issues.js";

const run = (kind: string, started: string, ended: string | null, extra: object = {}) => ({ kind, name: "fac-1", on: "fac-1", condition: "passed", started, ended, ...extra });
const issue = (over: object = {}) => ({ status: "done", frontmatter: { created: "2026-11-01" }, notes: [], commits: [], timeline: { filed: Date.parse("2026-11-01T10:00:00Z"), runs: [] }, ...over });
const held = () => [
  run("triage", "2026-11-01T10:00:30Z", "2026-11-01T10:02:00Z"),
  run("build", "2026-11-01T10:30:00Z", "2026-11-01T10:40:00Z", { condition: "awaiting", cost: 0.25 }),
  run("land", "2026-11-01T15:00:00Z", "2026-11-01T15:01:00Z", { condition: "landed", cost: 0.05 }),
];

describe("the lifetime rows", () => {
  test("a wait fills each gap: Idle between runs, Awaiting after an awaiting run", () => {
    const { rows } = lifeRows(issue({ timeline: { filed: Date.parse("2026-11-01T10:00:00Z"), runs: held() } }));
    expect(rows.map((r: any) => r.label)).toEqual(["Triage", "Idle", "Build", "Awaiting", "Land"]);
    expect(rows.map((r: any) => r.tone)).toEqual(["agent", "wait", "agent", "chris", "land"]);
  });

  test("a gap of a minute or less draws no wait; a filed issue that waited first shows Queued", () => {
    const filed = Date.parse("2026-11-01T09:00:00Z");
    const { rows } = lifeRows(issue({ timeline: { filed, runs: [run("build", "2026-11-01T10:00:00Z", "2026-11-01T10:05:00Z"), run("land", "2026-11-01T10:05:30Z", "2026-11-01T10:06:00Z")] } }));
    expect(rows.map((r: any) => r.label)).toEqual(["Queued", "Build", "Land"]);
  });

  test("an open issue waits up to now; a live run runs up to now; no run at all is one row", () => {
    const now = Date.parse("2026-11-01T12:00:00Z");
    const open = lifeRows(issue({ status: "open", timeline: { filed: now - 3_600_000, runs: [] } }), now);
    expect(open.rows).toMatchObject([{ label: "Open, no run yet", tone: "wait", end: now }]);
    const live = lifeRows(issue({ status: "open", timeline: { filed: now - 3_600_000, runs: [run("build", "2026-11-01T11:30:00Z", null, { condition: "running" })] } }), now);
    expect(live.rows.at(-1)).toMatchObject({ label: "Build", end: now });
    expect(lifeRows(issue({ status: "open", timeline: { filed: now - 7_200_000, runs: [run("build", "2026-11-01T10:30:00Z", "2026-11-01T10:40:00Z", { condition: "awaiting" })] } }), now).rows.at(-1)).toMatchObject({ label: "Awaiting", end: now });
  });

  test("with no filing time, a run on the created day starts the chart, so midnight draws no false wait", () => {
    const { rows, start } = lifeRows(issue({ timeline: { filed: null, runs: [run("build", "2026-11-01T18:00:00", "2026-11-01T18:10:00")] } }));
    expect(rows.map((r: any) => r.label)).toEqual(["Build"]);
    expect(start).toBe(Date.parse("2026-11-01T18:00:00"));
  });

  test("a failed run is the bad tone and a part's run names its part", () => {
    const { rows } = lifeRows(issue({ timeline: { filed: Date.parse("2026-11-01T10:00:00Z"), runs: [run("build", "2026-11-01T10:00:10Z", "2026-11-01T10:01:00Z", { condition: "failed", on: "fac-1.2" })] } }));
    expect(rows[0]).toMatchObject({ tone: "bad", part: "1.2" });
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

describe("the chart", () => {
  test("it shows the times, links a run to its job and shows notes and commits as points", () => {
    const h = renderLifetime(issue({
      timeline: { filed: Date.parse("2026-11-01T10:00:00Z"), runs: held() },
      notes: ["- 2026-11-01 08:06: job fac-1 landed", "a note with no stamp"],
      commits: [{ date: "2026-11-01T15:00:30Z", subject: "<fix>", commitUrl: "https://x/c/1", hash: "a" }],
    }));
    expect(h).toContain("Lifetime <strong>");
    expect(h).toContain("Awaiting <strong>4 h 20 min</strong>");
    expect(h).toContain("Runs <strong>3</strong>");
    expect(h).toContain("Cost <strong>$0.30</strong>");
    expect(h).toContain('<a href="#/jobs/fac-1">Build</a>');
    expect(h).toContain('<span class="ld">10 min</span>');
    expect(h).toContain("Long spans are compressed");
    expect(h.match(/class="itl-dot"/g)).toHaveLength(2);
    expect(h).toContain('href="https://x/c/1"');
    expect(h).not.toContain("<fix>");
  });

  test("it is empty for nothing to draw; the Issue page puts it above Runs", () => {
    expect(renderLifetime(issue({ status: "done", frontmatter: {}, timeline: { filed: null, runs: [] } }))).toBe("");
    const page = renderIssue({ ...issue({ timeline: { filed: Date.parse("2026-11-01T10:00:00Z"), runs: held() } }), repo: "fac", ref: "1", id: 1, title: "t", labels: [], priority: "low", goals: [], jobs: [], specs: [], request: "r", derived: null });
    expect(page.indexOf("<h2>Lifetime")).toBeGreaterThan(-1);
    expect(page.indexOf("<h2>Lifetime")).toBeLessThan(page.indexOf("<h2>Runs"));
  });

  test("the formats", () => {
    expect(lifespan(42_000)).toBe("42 s");
    expect(lifespan(12 * 60_000)).toBe("12 min");
    expect(lifespan(185 * 60_000)).toBe("3 h 5 min");
    expect(lifespan(50 * 3_600_000)).toBe("2 d 2 h");
    expect(noteEvent("- 2026-11-01 08:06: done it")).toEqual({ at: Date.parse("2026-11-01T08:06"), text: "done it" });
    expect(noteEvent("no stamp")).toBeNull();
  });
});
