import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { speed } from "./api/speed.ts";
// @ts-ignore plain JS shared with the page
import { fileIssue, issueFor, renderEfficiency, selection } from "./views/efficiency.js";

let base: string;
const saved: Record<string, string | undefined> = {};
const now = new Date(2026, 9, 28, 15, 0, 0);
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
  for (const [k, v] of Object.entries({ ALEPH_JOBS_DIR: join(base, "jobs"), ALEPH_FACTORY_DIR: join(base, "factory"), ALEPH_UI_FETCH_TTL: "0" })) { saved[k] = process.env[k]; process.env[k] = v; }
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
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  rmSync(base, { recursive: true, force: true });
});

test("goal stats: first-pass share, median fix rounds", () => {
  const g = speed("day", now).issues;
  expect(g).toEqual({ landed: 3, firstPass: 0.6667, fixRounds: 0, week: null });
  expect(g).not.toHaveProperty("cost");
});

const cls = (key: string, name: string, h: number, causes: any[], top: any[] = []) => ({ key, name, text: `${name} text.`, hours: h, week: 0, runs: causes.reduce((a, x) => a + x.runs, 0), issues: 2, causes, top });
const D: any = {
  window: "week", flaky: 4, issues: { landed: 2, firstPass: 0.5, fixRounds: 1, week: 0.02 }, lost: { hours: 6, share: 0.3 }, notCounted: { runs: 11, issues: 4, hours: 0.4 },
  classes: [
    cls("landed", "Landed", 10, [{ name: "First run", hours: 10, runs: 5 }]),
    cls("fixed", "Fixed", 4, [{ name: "Checks failed", hours: 4, runs: 3 }]),
    cls("nothing", "Late", 2, [{ name: "Issue had landed", hours: 2, runs: 6 }], [{ goal: "fx-1", href: "#/issues/fx/1", title: "One", reason: "already met", hours: 2, runs: 6 }]),
    cls("restarted", "Restarted", 4, [{ name: "No commit", hours: 3, runs: 2 }, { name: "Issue had landed", hours: 1, runs: 1 }], [{ goal: "fx-2", reason: "", hours: 3, runs: 2 }]),
    cls("dropped", "Dropped", 0, []),
  ],
};
const DAY: any = { ...D, flaky: 1, lost: { hours: 1, share: 0.1 }, issues: { ...D.issues, firstPass: 0.75 } };

test("the tiles and the head come from the data", () => {
  const h = renderEfficiency(D, DAY, "all");
  expect([...h.matchAll(/<span class="k">([^<]+)</g)].map((m) => m[1])).toEqual(["Lost time", "First pass", "Reruns", "Fix rounds", "Usage per issue"]);
  expect(h).toContain('<header class="ph"><h1>Efficiency</h1></header>');
  expect(h).toContain('<span class="good">▼ 10% in the last 24 h</span>');
  expect(h).toContain('<span class="good">▲ 75% in the last 24 h</span>');
  expect(h).toContain("&lt;0.1%");
  expect(h).toContain("20 h counted · 11 runs, 0.4 h, have no outcome yet");
  expect(renderEfficiency({ ...D, issues: { ...D.issues, week: null } }, null, "all")).toContain("needs 6 hours of usage snapshots");
});

test("All lost time: the causes sum to lost.hours, and the button says the same hours", () => {
  const s = selection(D, "all");
  expect(s.causes.map((x: any) => [x.name, x.hours, x.runs])).toEqual([["Issue had landed", 3, 7], ["No commit", 3, 2]]);
  expect(s.causes.reduce((a: number, x: any) => a + x.hours, 0)).toBe(D.lost.hours);
  expect(renderEfficiency(D, null, "all")).toContain("All lost time, 6.0 h");
  expect(s.text).toContain("Late and Restarted together.");
});

test("selecting a class shows its causes; selecting All lost time again restores the merged list", () => {
  const all = renderEfficiency(D, null, "all");
  const one = renderEfficiency(D, null, "fixed");
  expect(one).toContain("<h2>Fixed, largest first</h2>");
  expect(one).toContain('data-class="fixed" style="flex:4" aria-pressed="true"');
  expect(one).not.toContain("No commit");
  expect(renderEfficiency(D, null, "all")).toBe(all);
  expect(all).toContain('data-class="all" aria-pressed="true"');
});

test("Landed is no button, and a class with no hours has no segment", () => {
  const h = renderEfficiency(D, null, "all");
  expect(h).not.toContain('data-class="landed"');
  expect(h).not.toContain('data-class="dropped"');
});

test("an issue with no link shows its id as text, and a run with no reason says so", () => {
  const h = renderEfficiency(D, null, "restarted");
  expect(h).toContain("fx-2");
  expect(h).toContain("No reason recorded.");
  expect(h).not.toContain("undefined");
});

test("File an issue posts the first cause as the title, with the runs and reasons as the body", async () => {
  let sent: any;
  await fileIssue(D, "nothing", async (u: string, o: any) => { sent = { u, o }; return { ok: true, json: async () => ({ id: 5 }) }; });
  expect(sent.u).toBe("/api/issues");
  expect(sent.o.headers["X-Aleph-UI"]).toBe("1");
  const b = JSON.parse(sent.o.body);
  expect(b.title).toBe("Lost time: Issue had landed");
  expect(b.repo).toBe("aleph");
  expect(b.body).toContain("fx-1: 2.0 h, 6 runs. already met");
  expect(issueFor({ ...D, classes: [] }, "all")).toBeNull();
  await expect(fileIssue(D, "nothing", async () => ({ ok: false, status: 422, json: async () => ({ error: "no" }) }) as any)).rejects.toThrow("no");
});
