// Archived goal tests from ui/efficiency.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withEnv } from "../../ui/test-server.ts";
// @ts-ignore plain JS shared with the page
import { onTile } from "../../ui/lib.js";
// @ts-ignore plain JS shared with the page
import { fileIssue, issueFor, renderEfficiency, selection } from "../../ui/views/efficiency.js";
// @ts-ignore plain JS shared with the page

let base: string;
let restore: () => void;
let n = 0;
function run(job: string, r: Record<string, unknown>) {
  const dir = join(base, "jobs", `r${String(++n).padStart(3, "0")}`);
  mkdirSync(dir, { recursive: true });
  // Each job is its own issue: g1 is fx-1.
  writeFileSync(join(dir, "state.json"), JSON.stringify({ job, name: `${job}-${n}`, told: true, repo: "fx", on: `fx-${job.slice(1)}`, ...r }));
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

test("the Usage per issue tile drills to the issues list", () => {
  expect(renderEfficiency(D, "all")).toMatch(/data-tile="usage"[^>]*aria-pressed="false"|aria-pressed="false"[^>]*data-tile="usage"/);
  expect(renderEfficiency(D, "usage")).toContain('data-tile="usage" aria-pressed="true"');
  expect(renderEfficiency({ ...D, issues: { ...D.issues, week: null } }, "all")).not.toContain('data-tile="usage"');
  const h = renderEfficiency(D, "usage");
  expect(h).toContain("<h2>Usage per issue, largest first</h2>");
  expect(h).toContain("#/issues/fx/1");
  expect(h).toContain("fx-2");
  expect(h).not.toContain("#/issues/fx/2");
  expect(h).toContain("0.5%");
  expect(h).toContain("0.1%");
  expect(h).not.toContain("File an issue");
  expect(h).not.toContain("undefined");
  expect(issueFor(D, "usage")).toBeNull();
  expect(renderEfficiency({ ...D, issues: { ...D.issues, usage: undefined } }, "usage")).toContain("No issue to show.");
});

test("the Reruns panel describes tests and checks, and keeps a long name whole", () => {
  const long = "ui/a.test.ts > suite > a very long test name that goes on";
  const d = { ...D, flakes: [{ name: long, count: 3 }, { name: "types", count: 1 }] };
  const s = selection(d, "flakes");
  expect(s.causes).toEqual([{ name: long, runs: 3 }, { name: "types", runs: 1 }]);
  expect(s.text.startsWith("Checks that failed")).toBe(false);
  const h = renderEfficiency(d, "flakes");
  expect(h).toContain(`title="${long.replace(/>/g, "&gt;")}"`);
  expect(h).toContain(long.replace(/>/g, "&gt;"));
  expect(h).toContain("rerun");
});

test("the cards trend against the baseline of the window, and show none without one", () => {
  const h = renderEfficiency(WITH, "all");
  expect(h).toMatch(/<span class="tr warn" title="[^"]*">▲ 5%<\/span>/);
  expect(h).toMatch(/<span class="tr warn" title="Previous 60%; baseline 75%, the previous 7 days \(change in percentage points\)">▼ 25%<\/span>/);
  expect(h).toContain("▬ 0%");
  const better = renderEfficiency({ ...WITH, lost: { hours: 1, share: 0.1 }, issues: { ...D.issues, firstPass: 0.9 } }, "all");
  expect(better).toMatch(/tr good[^>]*>▼ 15%/);
  expect(better).toMatch(/tr good[^>]*>▲ 15%/);
  const none = renderEfficiency(D, "all");
  expect(none).not.toContain('class="tr');
  expect(none).not.toContain("▲");
  expect(none).not.toContain("▼");
  const noRerun = renderEfficiency({ ...WITH, baseline: { ...BASE, base: { ...BASE.base, flaky: undefined } } }, "all");
  expect([...noRerun.matchAll(/class="tr/g)].length).toBe(2);
  for (const w of ["hour", "day", "week", "month"]) expect(renderEfficiency({ ...WITH, window: w }, "all")).not.toContain("30-day average");
});
