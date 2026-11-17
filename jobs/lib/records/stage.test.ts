import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { aleph, env, repo, seedPart, seedItem, seedRun, setup, sh, teardown } from "../../cli.testkit";
import * as issues from "../../../lib/todo.ts";
import { logEvent } from "../../../lib/layout.ts";
import { loadRegistry } from "./ledger.ts";
import { subjectOf } from "./stage.ts";
import { repoStages } from "./status.ts";

// The rows call repoStages in-process, as `aleph status <ref>` does, under the CLI's environment; one row runs the CLI.
let restore: () => void;
beforeAll(async () => {
  await setup();
  const saved = { ...process.env };
  Object.assign(process.env, env());
  restore = () => { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); };
});
afterAll(() => { restore(); teardown(); });

// One fixture item per stage, each built through the CLI seam of cli.testkit:
// seeded new-shape item and run files.
interface Row { name: string; stage: string; of?: { n: number; m: number }; action?: string; count?: string; on?: RegExp; why?: RegExp; build: () => Promise<number | string> }

const ref = (n: number | string) => `fac-${n}`;
let jobs = 0;
/** A run on its item, as ref(). */
const newRun = <T extends number | string>(id: T, run: Parameters<typeof seedRun>[1]) => { seedRun("fac", { target: `issue.${id}`, ...run }); return id; };
const newIssue = (fm: Record<string, unknown> = {}) => seedItem("fac", `goal ${++jobs}`, { kind: "goal", ...fm });
const issue = (fm: Record<string, unknown> = {}) => seedItem("fac", `issue ${++jobs}`, { kind: "issue", source: "chris", ...fm });

/** A `held` event on issue `n` that waits for another new issue, then the number. */
const held = (n: number, detail = `after: issue.${newIssue()}`) => { logEvent({ subject: "gate", action: "held", object: `issue.${n}`, detail }); return n; };

const ISSUES_NEW: Row[] = [
  { name: "new issue: working 1 of 2", stage: "working", of: { n: 1, m: 2 }, count: "1 / 2", why: /^1 \/ 2$/, build: async () => {
    const n = issue();
    seedPart("fac", n, { status: "done" }); seedPart("fac", n);
    return n;
  } },
  { name: "new issue: parked", stage: "parked", build: async () => issue({ status: "parked" }) },
  { name: "new issue: dropped while a trailer commit on main names it", stage: "dropped", build: async () => {
    const n = issue({ status: "dropped" });
    sh(repo, "git", "commit", "-q", "--allow-empty", "-m", `work\n\nIssue: issue.${n}`);
    sh(repo, "git", "push", "-q", "origin", "main");
    return n;
  } },
  { name: "new issue: open with a spec while a trailer commit on main names it", stage: "queued", action: "starting", build: async () => {
    const n = newIssue();
    sh(repo, "git", "commit", "-q", "--allow-empty", "-m", `work\n\nIssue: issue.${n}`);
    sh(repo, "git", "push", "-q", "origin", "main");
    return n;
  } },
];

const PARTS_NEW: Row[] = [
  { name: "new issue: working", stage: "working", action: "running", on: /^job\.\d+$/, why: /^j\d+ started$/, build: async () => newRun(newIssue(), { role: "build", state: "running" }) },
  // PARTS_NEW[1] is the held issue that the `aleph status` test below reads.
  { name: "new issue: held", stage: "held", action: "held", why: /^issue\.\d+ held: after issue\.\d+$/, build: async () => held(newIssue()) },
  { name: "new issue: a started event after the held event ends the hold", stage: "queued", action: "starting", build: async () => {
    const n = held(newIssue({ after: [`issue.${newIssue()}`] }));
    logEvent({ subject: "rule", action: "started", object: `issue.${n}`, detail: "model default" });
    return n;
  } },
  { name: "new issue: done with a held event", stage: "done", build: async () => held(newIssue({ status: "done" })) },
  { name: "new issue: working while intake splits it", stage: "working", build: async () => newIssue({ plan: "true" }) },
  { name: "new issue: an intake run sorts it, not works it", stage: "queued", action: "starting", build: async () => newRun(newIssue(), { role: "intake", state: "running" }) },
];

const built = new Map<string, Promise<number | string>>();
const idOf = (row: Row) => { if (!built.has(row.name)) built.set(row.name, row.build()); return built.get(row.name)!; };
const statusOf = async (row: Row) => {
  const n = String(await idOf(row));
  return repoStages(loadRegistry().fac, { fetch: true, items: [n.includes(".") ? n : Number(n)] })[0];
};

// The rows run one after another: each writes to the one store.
for (const [title, rows] of [["issues, new shape", ISSUES_NEW], ["parts, new shape", PARTS_NEW]] as const) {
  describe(title, () => {
    for (const row of rows) {
      test(row.name, async () => {
        const s = await statusOf(row);
        expect(s).toMatchObject({ id: ref(await idOf(row)), stage: row.stage, ...(row.action ? { action: row.action } : {}), ...(row.count ? { count: row.count } : {}), ...(row.of ? { of: row.of } : {}) });
        if (!row.of) expect(s.of).toBeUndefined();
        if (row.on) expect(s.on?.join(" ")).toMatch(row.on);
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
  expect(r.json.why).toMatch(/^issue\.\d+ held: after issue\.\d+$/);
  const text = await aleph(["status", ref(id)]);
  const shown = (t: string) => t.replace(/fac-(\d+)/g, (_m, n) => `i${n}`);
  expect(text.stdout.trim()).toBe(`${shown(r.json.id)} ${r.json.stage}: ${shown(r.json.why)}`);
  expect((await aleph(["status", "fac-999"])).stderr).toContain("fac has no issue 999");
}, 90_000);

describe("subjectOf", () => {
  const item = (id: number): issues.Issue => ({ id, title: "t", fm: {}, request: "", spec: "", notes: [] });
  const doc: issues.Doc = { items: [] };
  test("an issue is keyed by its number", () => {
    expect(subjectOf(item(5), "proj", doc).id).toBe("proj-5");
  });
});
