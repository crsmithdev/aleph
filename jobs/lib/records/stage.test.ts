import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { aleph, env, repo, seedPart, seedItem, seedRun, setup, sh, teardown } from "../../cli.helpers";
import * as issues from "../../../issues/lib/todo.ts";
import { loadRegistry } from "./ledger.ts";
import { subjectOf } from "./stage.ts";
import { repoStages } from "./status.ts";
import { setAsk, plainAsk } from "../asks/ask.ts";

// The rows call repoStages in-process, as `aleph status <ref>` does, under the CLI's environment; one row runs the CLI.
let restore: () => void;
beforeAll(async () => {
  await setup();
  const saved = { ...process.env };
  Object.assign(process.env, env());
  restore = () => { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); };
});
afterAll(() => { restore(); teardown(); });

// One fixture item per stage, each built through the CLI seam of cli.helpers:
// seeded new-shape item and run files.
interface Row { name: string; stage: string; of?: { n: number; m: number }; why?: RegExp; build: () => Promise<number | string> }

const ref = (n: number | string) => `fac-${n}`;
let jobs = 0;
/** A run on its item, as ref(). */
const newRun = <T extends number | string>(id: T, run: Parameters<typeof seedRun>[1]) => { seedRun("fac", { on: ref(id), ...run }); return id; };
const newIssue = (fm: Record<string, unknown> = {}) => seedItem("fac", `goal ${++jobs}`, { kind: "goal", ...fm });
const issue = (fm: Record<string, unknown> = {}) => seedItem("fac", `issue ${++jobs}`, { kind: "issue", source: "chris", ...fm });

const ISSUES_NEW: Row[] = [
  { name: "new issue: working 1 of 2", stage: "working", of: { n: 1, m: 2 }, build: async () => {
    const n = issue();
    seedPart("fac", n, 1, { status: "done" }); seedPart("fac", n, 2);
    return n;
  } },
  { name: "new issue: dropped while a trailer commit on main names it", stage: "dropped", build: async () => {
    const n = issue({ status: "dropped" });
    sh(repo, "git", "commit", "-q", "--allow-empty", "-m", `work\n\nIssue: ${ref(n)}`);
    sh(repo, "git", "push", "-q", "origin", "main");
    return n;
  } },
];

const PARTS_NEW: Row[] = [
  { name: "new goal: working", stage: "working", build: async () => newRun(newIssue(), { kind: "build", condition: "running" }) },
  // PARTS_NEW[1] is the blocked goal that the `aleph status` test below reads.
  { name: "new goal: blocked", stage: "blocked", why: /after fac-/, build: async () => newIssue({ after: [ref(newIssue())] }) },
  { name: "new goal: planning", stage: "planning", build: async () => newIssue({ plan: "true" }) },
];

// A commit on origin/main that names goal `partRef` (`<n>.<k>`) and its issue `n`, as the land of a goal does; returns its sha.
const landPart = (_n: number, partRef: string): string => {
  sh(repo, "git", "commit", "-q", "--allow-empty", "-m", `work\n\nIssue: ${ref(partRef)}`);
  sh(repo, "git", "push", "-q", "origin", "main");
  return sh(repo, "git", "rev-parse", "HEAD");
};

// Dotted goals: the goal `.k` of an issue, seeded through seedPart.
const PARTS_DOTTED: Row[] = [
  { name: "dotted goal: done by its trailer commit while the store holds it open", stage: "done", why: /^commit [0-9a-f]{7} on /, build: async () => {
    const n = seedItem("fac", `parent ${++jobs}`, { kind: "issue", source: "chris" });
    const a = seedPart("fac", n, 1); landPart(n, `${n}.1`); return a;
  } },
  { name: "dotted goal: awaiting its Ask while a trailer commit on main names it", stage: "awaiting", why: /input: run-cap/, build: async () => {
    const n = seedItem("fac", `parent ${++jobs}`, { kind: "issue", source: "chris" });
    const a = seedPart("fac", n, 1); setAsk(`fac-${n}.1`, plainAsk("run-cap", "it looped")); landPart(n, `${n}.1`); return a;
  } },
  { name: "dotted issue: working 1 of 2", stage: "working", of: { n: 1, m: 2 }, build: async () => {
    const n = seedItem("fac", `parent ${++jobs}`, { kind: "issue", source: "chris" });
    seedPart("fac", n, 1, { status: "done" }); seedPart("fac", n, 2);
    return n;
  } },
  { name: "dotted goal: working under a run on it", stage: "working", build: async () => {
    const n = seedItem("fac", `parent ${++jobs}`, { kind: "issue", source: "chris" });
    const a = seedPart("fac", n, 1); seedRun("fac", { on: ref(a), kind: "build", condition: "running" }); return a;
  } },
];

const built = new Map<string, Promise<number | string>>();
const idOf = (row: Row) => { if (!built.has(row.name)) built.set(row.name, row.build()); return built.get(row.name)!; };
const statusOf = async (row: Row) => {
  const n = String(await idOf(row));
  return repoStages(loadRegistry().fac, { fetch: true, items: [n.includes(".") ? n : Number(n)] })[0];
};

// The rows run one after another: each writes to the one store.
for (const [title, rows] of [["issues, new shape", ISSUES_NEW], ["goals, new shape", PARTS_NEW], ["goals, dotted", PARTS_DOTTED]] as const) {
  describe(title, () => {
    for (const row of rows) {
      test(row.name, async () => {
        const s = await statusOf(row);
        expect(s).toMatchObject({ id: ref(await idOf(row)), stage: row.stage, ...(row.of ? { of: row.of } : {}) });
        if (!row.of) expect(s.of).toBeUndefined();
        expect(s.why).toMatch(row.why ?? /./);
      });
    }
  });
}

test("aleph status prints the same stage as JSON and as one line, with the short id of each ref", async () => {
  const id = await idOf(PARTS_NEW[1]);
  const r = await aleph(["status", ref(id), "--json"]);
  expect(r.code, r.stderr).toBe(0);
  expect(r.json).toEqual(JSON.parse(JSON.stringify(await statusOf(PARTS_NEW[1]))));
  expect(r.json.why).toMatch(/after fac-\d/);
  const text = await aleph(["status", ref(id)]);
  expect(text.stdout.trim()).toBe(`${r.json.id} ${r.json.stage}: ${r.json.why}`);
  expect((await aleph(["status", "fac-999"])).stderr).toContain("fac has no issue 999");
}, 90_000);

describe("subjectOf", () => {
  const item = (id: number, sub?: number): issues.Issue => ({ id, ...(sub === undefined ? {} : { sub }), title: "t", fm: {}, request: "", spec: "", notes: [] });
  const doc: issues.Doc = { items: [] };
  test("a dotted goal is keyed by its dotted id, a plain item by its number", () => {
    expect(subjectOf(item(5, 1), "proj", doc).id).toBe("proj-5.1");
    expect(subjectOf(item(5), "proj", doc).id).toBe("proj-5");
  });
});
