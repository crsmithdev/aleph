import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { aleph, seedGoal, seedItem, seedRun, setup, teardown } from "../cli.helpers";
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
const newRun = (id: number, run: Parameters<typeof seedRun>[1]) => { seedRun("fac", { on: ref(id), ...run }); return id; };
const goal = (fm: Record<string, unknown> = {}) => seedItem("fac", `goal ${++jobs}`, { kind: "goal", ...fm });
const issue = (fm: Record<string, unknown> = {}) => seedItem("fac", `issue ${++jobs}`, { kind: "issue", source: "chris", ...fm });

const ISSUES_NEW: Row[] = [
  { name: "new issue: new", stage: "new", build: async () => issue() },
  { name: "new issue: triaged", stage: "triaged", build: async () => issue({ labels: ["triaged"] }) },
  { name: "new issue: planning", stage: "planning", build: async () => newRun(issue(), { kind: "plan", state: "running" }) },
  { name: "new issue: building 1 of 2", stage: "building", of: { n: 1, m: 2 }, build: async () => {
    const a = goal({ status: "done" }), b = goal();
    return issue({ goals: [ref(a), ref(b)] });
  } },
  { name: "new issue: awaiting", stage: "awaiting", why: /approval/, build: async () => issue({ ask: "approval", reason: "review" }) },
  { name: "new issue: awaiting from its goal", stage: "awaiting", why: /input/, build: async () => {
    const g = newRun(goal(), { kind: "build", state: "awaiting", ask: { kind: "input", reason: "question", question: "Which?", options: [], why: [] } });
    return issue({ goals: [ref(g)] });
  } },
  { name: "new issue: stuck", stage: "stuck", build: async () => newRun(issue(), { kind: "plan", state: "stuck" }) },
  { name: "new issue: stuck from its goal", stage: "stuck", build: async () => issue({ goals: [ref(newRun(goal(), { kind: "build", state: "failed" }))] }) },
  { name: "new issue: done", stage: "done", build: async () => issue({ status: "done" }) },
  { name: "new issue: dropped", stage: "dropped", build: async () => issue({ status: "dropped" }) },
];

const GOALS_NEW: Row[] = [
  { name: "new goal: queued", stage: "queued", build: async () => goal() },
  { name: "new goal: blocked", stage: "blocked", why: /after fac-/, build: async () => goal({ after: [ref(goal())] }) },
  { name: "new goal: queued once its after goal is done", stage: "queued", build: async () => goal({ after: [ref(goal({ status: "done" }))] }) },
  { name: "new goal: building", stage: "building", build: async () => newRun(goal(), { kind: "build", state: "running" }) },
  { name: "new goal: planning", stage: "planning", build: async () => newRun(goal(), { kind: "plan", state: "running" }) },
  { name: "new goal: queued once its plan run is done", stage: "queued", build: async () => newRun(goal(), { kind: "plan", state: "done" }) },
  { name: "new goal: landing", stage: "landing", build: async () => newRun(goal(), { kind: "land", state: "running" }) },
  { name: "new goal: awaiting (its ask)", stage: "awaiting", why: /approval: held-path/, build: async () => goal({ ask: "approval", reason: "held-path" }) },
  { name: "new goal: awaiting (its run)", stage: "awaiting", why: /approval: review/, build: async () =>
    newRun(goal(), { kind: "build", state: "awaiting", ask: { kind: "approval", reason: "review", question: "Land it?", options: [], why: [] } }) },
  { name: "new goal: stuck", stage: "stuck", build: async () => newRun(goal(), { kind: "build", state: "stuck" }) },
  { name: "new goal: done", stage: "done", build: async () => goal({ status: "done" }) },
  { name: "new goal: dropped", stage: "dropped", build: async () => goal({ status: "dropped" }) },
];

// Dotted goals: the goal `.k` of an issue, seeded through seedGoal.
const GOALS_DOTTED: Row[] = [
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
    const a = seedGoal("fac", n, 1, { status: "done" }), b = seedGoal("fac", n, 2);
    return seedItem("fac", `issue ${++jobs}`, { kind: "issue", source: "chris", goals: [ref(a), ref(b)] });
  } },
  { name: "dotted goal: building under a run on it", stage: "building", build: async () => {
    const n = seedItem("fac", `parent ${++jobs}`, { kind: "issue", source: "chris" });
    const a = seedGoal("fac", n, 1); seedRun("fac", { on: ref(a), kind: "build", state: "running" }); return a;
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
        expect(text.stdout.trim()).toBe(`${s.id} ${s.stage}: ${s.why}`);
      }, 90_000);
    }
  });
}

describe("subjectOf", () => {
  const item = (id: number, sub?: number): issues.Issue => ({ id, ...(sub === undefined ? {} : { sub }), title: "t", fm: {}, body: "", notes: [], legacy: false });
  test("a dotted goal is keyed by its dotted id, a plain item by its number", () => {
    expect(subjectOf(item(5, 1), "proj").id).toBe("proj-5.1");
    expect(subjectOf(item(5), "proj").id).toBe("proj-5");
  });
});
