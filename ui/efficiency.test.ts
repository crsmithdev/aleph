import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { speed } from "./api/speed.ts";
import { withEnv } from "./test-server.ts";
// @ts-ignore plain JS shared with the page
import { onTile } from "./lib.js";
// @ts-ignore plain JS shared with the page
import { renderEfficiency, selection } from "./views/efficiency.js";
import { writeRun } from "../jobs/lib/records/ledger.ts";
// @ts-ignore plain JS shared with the page

let base: string;
let restore: () => void;
const now = new Date(2026, 9, 28, 15, 0, 0);
let n = 0;
function run(job: string, r: Record<string, unknown>) {
  const dir = join(base, "jobs", `r${String(++n).padStart(3, "0")}`);
  mkdirSync(dir, { recursive: true });
  // Each job is its own issue: g1 is fx-1.
  writeRun(join(dir), { job, name: `${job}-${n}`, told: true, repo: "fx", on: `fx-${job.slice(1)}`, ...r } as any);
}
const at = (h: number, m = 0) => new Date(2026, 9, 28, h, m).toISOString();
const span = (h: number, s: number) => ({ started: at(h), ended: new Date(Date.parse(at(h)) + s * 1000).toISOString() });

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-ui-eff-"));
  restore = withEnv({ ALEPH_JOBS_DIR: join(base, "jobs"), ALEPH_FACTORY_DIR: join(base, "factory"), ALEPH_UI_FETCH_TTL: "0" });
  // g1 landed first try; g2 landed after two fix rounds; g3 landed first try; g4 is not landed
  run("g1", { kind: "build", condition: "passed", cost: 1, ...span(8, 600) });
  run("g1", { kind: "land", condition: "landed", ...span(9, 30) });
  run("g2", { kind: "build", condition: "stuck", failed: "tests", cost: 2, ...span(8, 600) });
  run("g2", { kind: "build", condition: "stuck", failed: "review", round: 1, cost: 2, ...span(9, 600) });
  run("g2", { kind: "build", condition: "passed", round: 2, cost: 2, ...span(10, 600) });
  run("g2", { kind: "land", condition: "landed", ...span(11, 30) });
  run("g3", { kind: "build", condition: "passed", cost: 3, ...span(8, 600) });
  run("g3", { kind: "land", condition: "landed", ...span(12, 30) });
  run("g4", { kind: "build", condition: "stuck", failed: "tests", cost: 9, ...span(8, 600) });
});
afterAll(() => {
  restore();
  rmSync(base, { recursive: true, force: true });
});

test("goal stats: first-pass share, median fix rounds", () => {
  const g = speed("day", now).issues;
  expect(g).toEqual({ landed: 3, firstPass: 0.6667, fixRounds: 0, week: null, usage: [] });
  expect(g).not.toHaveProperty("cost");
});

const cls = (key: string, name: string, h: number, causes: any[], top: any[] = []) => ({ key, name, text: `${name} text.`, hours: h, week: 0, runs: causes.reduce((a, x) => a + x.runs, 0), issues: 2, causes, top });
const D: any = {
  window: "week", flaky: 4, issues: { landed: 2, firstPass: 0.5, fixRounds: 1, week: 0.02, usage: [{ goal: "fx-1", href: "#/issues/fx/1", title: "One", week: 0.5, runs: 3 }, { goal: "fx-2", week: 0.1, runs: 1 }] }, lost: { hours: 6, share: 0.3 }, notCounted: { runs: 11, issues: 4, hours: 0.4 },
  classes: [
    cls("landed", "Landed", 10, [{ name: "First run", hours: 10, runs: 5 }]),
    cls("fixed", "Fixed", 4, [{ name: "Checks failed", hours: 4, runs: 3 }]),
    cls("nothing", "Late", 2, [{ name: "Issue had landed", hours: 2, runs: 6 }], [{ goal: "fx-1", href: "#/issues/fx/1", title: "One", reason: "already met", hours: 2, runs: 6 }]),
    cls("restarted", "Restarted", 4, [{ name: "No commit", hours: 3, runs: 2 }, { name: "Issue had landed", hours: 1, runs: 1 }], [{ goal: "fx-2", reason: "", hours: 3, runs: 2 }]),
    cls("dropped", "Dropped", 0, []),
  ],
};

const BASE: any = { prev: { lost: 0.2, firstPass: 0.6, flaky: 2 }, base: { lost: 0.25, firstPass: 0.75, flaky: 4 }, basis: "the previous 7 days" };
const WITH: any = { ...D, baseline: BASE };

test("the tiles and the head come from the data", () => {
  const h = renderEfficiency(WITH, "all");
  expect([...h.matchAll(/<span class="k">([^<]+)</g)].map((m) => m[1])).toEqual(["Lost time", "First pass", "Reruns", "Fix rounds", "Usage per issue"]);
  expect(h).toContain('<b>30%<em> / 6.0h</em></b>');
  expect(h).toContain('<header class="ph"><h1>Efficiency</h1><span class="count">last 7 days</span><div class="aside"><div class="fbar">');
  expect(h).not.toContain("vs 30-day average");
  expect(h).not.toContain("in the last 24h");
  expect(h).toContain("&lt;0.1%");
  expect(h).toContain("20h counted · 11 runs, 0.4h, have no outcome yet");
  expect(renderEfficiency({ ...D, issues: { ...D.issues, week: null } }, "all")).toContain("needs 6 hours of usage snapshots");
});

test("All lost time: the causes sum to lost.hours", () => {
  const s = selection(D, "all");
  expect(s.causes.map((x: any) => [x.name, x.hours, x.runs])).toEqual([["Issue had landed", 3, 7], ["No commit", 3, 2]]);
  expect(s.causes.reduce((a: number, x: any) => a + x.hours, 0)).toBe(D.lost.hours);
  expect(renderEfficiency(D, "all")).toContain("<h2>Lost Time Causes</h2>");
  expect(renderEfficiency(D, "all")).toContain("<h2>Lost Time Issues</h2>");
  for (const k of ["all", "flakes", "usage", "fixed"]) expect(Object.keys(selection(D, k))).toEqual(["title", "causes", "top"]);
});

test("the causes card is a table beside the issues card, with no intro and no File an issue button", () => {
  const h = renderEfficiency(D, "all");
  const causes = h.slice(h.indexOf('aria-label="Lost time causes"'), h.indexOf('aria-label="Lost time issues"'));
  expect([...causes.matchAll(/<th[^>]*>([^<]+)</g)].map((m) => m[1])).toEqual(["Cause", "Time", "Runs", "Bar"]);
  expect([...causes.matchAll(/<tr><td[^>]*>([^<]+)<\/td><td class="num">([^<]+)<\/td><td class="num">(\d+)</g)].map((m) => m.slice(1))).toEqual([["Issue had landed", "3.0h", "7"], ["No commit", "3.0h", "2"]]);
  expect(causes).toMatch(/<td><span class="meter" aria-hidden="true"><i style="width:[\d.]+%"><\/i>/);
  expect(h).toMatch(/<div class="pair"><section class="card"[^>]*aria-label="Lost time causes"/);
  for (const gone of ["together.", "File an issue", "data-file", 'id="filed"']) expect(h).not.toContain(gone);
});

test("selecting a class shows its causes; selecting Lost time again restores the merged list", () => {
  const all = renderEfficiency(D, "all");
  const one = renderEfficiency(D, "fixed");
  expect(one).toContain("<h2>Fixed Causes</h2>");
  expect(one).toContain('data-tile="fixed" style="flex:4" aria-pressed="true"');
  expect(one).not.toContain("No commit");
  expect(renderEfficiency(D, "all")).toBe(all);
  expect(all).toContain('data-tile="all" aria-pressed="true"');
});

test("the First pass tile and the Landed segment select the landed class, and a class with no hours has no segment", () => {
  const h = renderEfficiency(D, "all");
  expect(h.match(/data-tile="landed"/g)).toHaveLength(2);
  expect(h).not.toContain('class="seg-dropped"');
});

test("an issue with no link shows its id as text, and a run with no reason says so", () => {
  const h = renderEfficiency(D, "restarted");
  expect(h).toContain("fx-2");
  expect(h).toContain("No reason recorded.");
  expect(h).not.toContain("undefined");
});

test("a click on a card selects its class", () => {
  const h = renderEfficiency(D, "all");
  expect(h).toMatch(/<button type="button" class="tile sc" data-tile="all" aria-pressed="true"><span class="r1"><span class="k">Lost time/);
  expect(h).toMatch(/data-tile="landed" aria-pressed="false"><span class="r1"><span class="k">First pass/);
  let handler: any;
  const picked: string[] = [];
  onTile({ addEventListener: (_: string, f: any) => { handler = f; } }, (k: string) => picked.push(k));
  const press = (label: string) => {
    const m = h.match(new RegExp(`data-tile="([a-z]+)"[^>]*><span class="r1"><span class="k">${label}`));
    handler({ target: { closest: () => ({ dataset: { tile: m![1] } }) } });
  };
  press("First pass");
  press("Lost time");
  expect(picked).toEqual(["landed", "all"]);
});
