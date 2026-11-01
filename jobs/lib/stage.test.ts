import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { aleph, repo, seedGoal, seedItem, seedRun, setup, sh, teardown } from "../cli.helpers";
import * as issues from "../../todo/lib/todo.ts";
import { subjectOf } from "./stage.ts";

beforeAll(setup);
afterAll(teardown);

// One fixture item per stage, each built through the CLI seam of cli.helpers:
// seeded new-shape item and run files.
interface Row { name: string; stage: string; of?: { n: number; m: number }; why?: RegExp; build: () => Promise<number | string> }

const ref = (n: number | string) => `fac-${n}`;
let jobs = 0;
/** A run on its item, as ref(). */
const newRun = <T extends number | string>(id: T, run: Parameters<typeof seedRun>[1]) => { seedRun("fac", { on: ref(id), ...run }); return id; };
const goal = (fm: Record<string, unknown> = {}) => seedItem("fac", `goal ${++jobs}`, { kind: "goal", ...fm });
const issue = (fm: Record<string, unknown> = {}) => seedItem("fac", `issue ${++jobs}`, { kind: "issue", source: "chris", ...fm });

const ISSUES_NEW: Row[] = [
  { name: "new issue: new", stage: "new", build: async () => issue() },
  { name: "new issue: planning", stage: "planning", build: async () => newRun(issue(), { kind: "plan", condition: "running" }) },
  { name: "new issue: building 1 of 2", stage: "building", of: { n: 1, m: 2 }, build: async () => {
    const n = issue();
    seedGoal("fac", n, 1, { status: "done" }); seedGoal("fac", n, 2);
    return n;
  } },
  { name: "new issue: awaiting", stage: "awaiting", why: /approval/, build: async () => issue({ ask: "approval", reason: "review" }) },
  { name: "new issue: awaiting from its goal", stage: "awaiting", why: /input/, build: async () => {
    const n = issue();
    newRun(seedGoal("fac", n, 1), { kind: "build", condition: "awaiting", ask: { kind: "input", reason: "question", question: "Which?", options: [], why: [] } });
    return n;
  } },
  { name: "new issue: stuck", stage: "stuck", build: async () => newRun(issue(), { kind: "plan", condition: "stuck" }) },
  { name: "new issue: stuck from its goal", stage: "stuck", build: async () => { const n = issue(); newRun(seedGoal("fac", n, 1), { kind: "build", condition: "failed" }); return n; } },
  { name: "new issue: done", stage: "done", build: async () => issue({ status: "done" }) },
  { name: "new issue: dropped", stage: "dropped", build: async () => issue({ status: "dropped" }) },
];

const GOALS_NEW: Row[] = [
  { name: "new goal: queued", stage: "queued", build: async () => goal() },
  { name: "new goal: blocked", stage: "blocked", why: /after fac-/, build: async () => goal({ after: [ref(goal())] }) },
  { name: "new goal: queued once its after goal is done", stage: "queued", build: async () => goal({ after: [ref(goal({ status: "done" }))] }) },
  { name: "new goal: building", stage: "building", build: async () => newRun(goal(), { kind: "build", condition: "running" }) },
  { name: "new goal: planning", stage: "planning", build: async () => newRun(goal(), { kind: "plan", condition: "running" }) },
  { name: "new goal: queued once its plan run is done", stage: "queued", build: async () => newRun(goal(), { kind: "plan", condition: "done" }) },
  { name: "new goal: landing", stage: "landing", build: async () => newRun(goal(), { kind: "land", condition: "running" }) },
  { name: "new goal: awaiting (its ask)", stage: "awaiting", why: /approval: held-path/, build: async () => goal({ ask: "approval", reason: "held-path" }) },
  { name: "new goal: awaiting (its run)", stage: "awaiting", why: /approval: review/, build: async () =>
    newRun(goal(), { kind: "build", condition: "awaiting", ask: { kind: "approval", reason: "review", question: "Land it?", options: [], why: [] } }) },
  { name: "new goal: stuck", stage: "stuck", build: async () => newRun(goal(), { kind: "build", condition: "stuck" }) },
  { name: "new goal: done", stage: "done", build: async () => goal({ status: "done" }) },
  { name: "new goal: dropped", stage: "dropped", build: async () => goal({ status: "dropped" }) },
];

// A commit on origin/main that names goal `goalRef` (`<n>.<k>`) and its issue `n`, as the land of a goal does; returns its sha.
const landGoal = (_n: number, goalRef: string): string => {
  sh(repo, "git", "commit", "-q", "--allow-empty", "-m", `work\n\nIssue: ${ref(goalRef)}`);
  sh(repo, "git", "push", "-q", "origin", "main");
  return sh(repo, "git", "rev-parse", "HEAD");
};
// The revert of commit `sha`, pushed to origin/main. `git revert` refuses an empty commit ("nothing to commit"), so
// this writes the commit it would write: the same subject and `This reverts commit <sha>.` body that landedIndex reads.
const revertOnMain = (sha: string): void => {
  sh(repo, "git", "commit", "-q", "--allow-empty", "-m", `Revert "work"\n\nThis reverts commit ${sha}.`);
  sh(repo, "git", "push", "-q", "origin", "main");
};

// Dotted goals: the goal `.k` of an issue, seeded through seedGoal.
const GOALS_DOTTED: Row[] = [
  { name: "dotted goal: done by its trailer commit while the store holds it open", stage: "done", why: /^commit [0-9a-f]{7} on /, build: async () => {
    const n = seedItem("fac", `parent ${++jobs}`, { kind: "issue", source: "chris" });
    const a = seedGoal("fac", n, 1); landGoal(n, `${n}.1`); return a;
  } },
  { name: "dotted goal: awaiting its Ask while a trailer commit on main names it", stage: "awaiting", why: /input: acceptance-failed/, build: async () => {
    const n = seedItem("fac", `parent ${++jobs}`, { kind: "issue", source: "chris" });
    const a = seedGoal("fac", n, 1, { ask: "input", reason: "acceptance-failed" }); landGoal(n, `${n}.1`); return a;
  } },
  { name: "dotted goal: not done when the store holds it done and its only commit is reverted", stage: "queued", build: async () => {
    const n = seedItem("fac", `parent ${++jobs}`, { kind: "issue", source: "chris" });
    const a = seedGoal("fac", n, 1, { status: "done" }); revertOnMain(landGoal(n, `${n}.1`)); return a;
  } },
  { name: "dotted goal: not landing when its job landed and its commit is reverted", stage: "queued", build: async () => {
    const n = seedItem("fac", `parent ${++jobs}`, { kind: "issue", source: "chris" });
    const a = seedGoal("fac", n, 1); seedRun("fac", { on: ref(a), kind: "build", condition: "landed" }); revertOnMain(landGoal(n, `${n}.1`)); return a;
  } },
  { name: "dotted goal: not blocked by an after goal that a trailer commit landed", stage: "queued", build: async () => {
    const n = seedItem("fac", `parent ${++jobs}`, { kind: "issue", source: "chris" });
    const a = seedGoal("fac", n, 1); landGoal(n, `${n}.1`); return seedGoal("fac", n, 2, { after: [ref(a)] });
  } },
  { name: "dotted goal: blocked while its after goal is open", stage: "blocked", why: /after fac-/, build: async () => {
    const n = seedItem("fac", `parent ${++jobs}`, { kind: "issue", source: "chris" });
    const a = seedGoal("fac", n, 1); return seedGoal("fac", n, 2, { after: [ref(a)] });
  } },
  { name: "dotted goal: queued once its after goal is done", stage: "queued", build: async () => {
    const n = seedItem("fac", `parent ${++jobs}`, { kind: "issue", source: "chris" });
    const a = seedGoal("fac", n, 1, { status: "done" }); return seedGoal("fac", n, 2, { after: [ref(a)] });
  } },
  { name: "dotted issue: building 1 of 2", stage: "building", of: { n: 1, m: 2 }, build: async () => {
    const n = seedItem("fac", `parent ${++jobs}`, { kind: "issue", source: "chris" });
    seedGoal("fac", n, 1, { status: "done" }); seedGoal("fac", n, 2);
    return n;
  } },
  { name: "dotted goal: building under a run on it", stage: "building", build: async () => {
    const n = seedItem("fac", `parent ${++jobs}`, { kind: "issue", source: "chris" });
    const a = seedGoal("fac", n, 1); seedRun("fac", { on: ref(a), kind: "build", condition: "running" }); return a;
  } },
];

const built = new Map<string, Promise<number | string>>();
const idOf = (row: Row) => { if (!built.has(row.name)) built.set(row.name, row.build()); return built.get(row.name)!; };
const statusOf = async (row: Row) => { const r = await aleph(["status", ref(await idOf(row)), "--json"]); expect(r.code, r.stderr).toBe(0); return r.json; };

// The rows run one after another: each writes to the one store.
for (const [title, rows] of [["issues, new shape", ISSUES_NEW], ["goals, new shape", GOALS_NEW], ["goals, dotted", GOALS_DOTTED]] as const) {
  describe(title, () => {
    for (const row of rows) {
      test(row.name, async () => {
        const s = await statusOf(row);
        expect(s).toMatchObject({ id: ref(await idOf(row)), stage: row.stage, ...(row.of ? { of: row.of } : {}) });
        if (!row.of) expect(s.of).toBeUndefined();
        expect(s.why).toMatch(row.why ?? /./);
        const text = await aleph(["status", ref(await idOf(row))]);
        expect(text.stdout.trim()).toBe(`${s.id} ${s.stage}: ${s.why}`.replace(/\bfac-(?=\d)/g, ""));
      }, 90_000);
    }
  });
}

// The open issue with no spec: triage sorts it in a sandbox repo only. `demo` has no `sandbox`; `fac` has it.
describe("an open issue with no spec, by repo", () => {
  test("in a repo without sandbox, the text says the factory does not run for it", async () => {
    const n = seedItem("demo", `plain ${++jobs}`, { kind: "issue", source: "chris" });
    const s = await aleph(["status", `demo-${n}`, "--json"]);
    expect(s.code, s.stderr).toBe(0);
    expect(s.json).toMatchObject({ id: `demo-${n}`, stage: "new" });
    expect(s.json.why).toMatch(/the factory does not run for this repo/);
    expect(s.json.why).not.toMatch(/triage has not sorted it/);
  }, 90_000);
  test("in a sandbox repo, the text stays triage has not sorted it", async () => {
    const n = issue();
    const s = await aleph(["status", ref(n), "--json"]);
    expect(s.code, s.stderr).toBe(0);
    expect(s.json).toMatchObject({ id: ref(n), stage: "new", why: "triage has not sorted it" });
  }, 90_000);
});

describe("subjectOf", () => {
  const item = (id: number, sub?: number): issues.Issue => ({ id, ...(sub === undefined ? {} : { sub }), title: "t", fm: {}, request: "", spec: "", notes: [] });
  const doc: issues.Doc = { items: [] };
  test("a dotted goal is keyed by its dotted id, a plain item by its number", () => {
    expect(subjectOf(item(5, 1), "proj", doc).id).toBe("proj-5.1");
    expect(subjectOf(item(5), "proj", doc).id).toBe("proj-5");
  });
});
