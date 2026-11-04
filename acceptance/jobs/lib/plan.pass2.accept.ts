// Archived goal tests from jobs/lib/plan.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, watch, writeFileSync } from "node:fs";
import type { FSWatcher } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { labels as itemLabels, readList, writeList, partsOf } from "../../../todo/lib/store.ts";
import * as issues from "../../../todo/lib/todo.ts";
import { dispatchIssues, planNow } from "../../../jobs/lib/factory.ts";
import { readRun, writeRun } from "../../../jobs/lib/ledger.ts";
import { parsePlan, prompt, runPlan } from "../../../jobs/lib/plan.ts";
import type { Tier } from "../../../jobs/lib/route.ts";
import { factoryRepos } from "../../../tests/git-fixture.ts";

const child = (title: string, oracle = "`bun test jobs/lib/x.test.ts`") =>
  ({ title, body: `## Goal\nDo ${title}.\n## Edit surface\njobs/lib/x.ts\n## Oracle\n${oracle}\n## Time box\n30 minutes` });
const reply = (children: object[]) => JSON.stringify({ children });
const THREE = reply([child("one"), { ...child("two"), waits_on: [1] }, { ...child("three"), waits_on: [1, 2] }]);
const ONE = reply([child("only")]);
const NO_ORACLE = reply([child("one"), { title: "two", body: "## Goal\nx\n## Edit surface\na/b.ts\n## Time box\n1 hour" }]);

// The fake planner: the reply is named by a `PLAN:<word>` line in the goal's body; each call is logged.
const fake = (base: string) => `#!/bin/bash
prompt=$(cat)
echo "$*" >> "${join(base, "calls")}"
case $prompt in
  *PLAN:three*) cat <<'J'
Here is the plan. ${THREE}
J
  ;;
  *PLAN:slow*) for _ in $(seq 600); do { [ -e "${join(base, "release")}" ] || [ ! -d "${base}" ]; } && break; sleep 0.05; done; echo '${THREE}' ;;
  *PLAN:one*) echo '${ONE}' ;;
  *PLAN:nooracle*) echo '${NO_ORACLE}' ;;
  *PLAN:badthengood*) if [ -e "${join(base, "once")}" ]; then echo '${THREE}'; else touch "${join(base, "once")}"; echo '${ONE}'; fi ;;
  *) echo 'no json' ;;
esac
`;

const KEYS = ["ALEPH_ISSUES", "ALEPH_REPOS", "ALEPH_JOBS_DIR", "ALEPH_FACTORY_DIR", "XDG_RUNTIME_DIR", "ALEPH_DAY_CAP", "ALEPH_LIVE_CAP", "SIDETONE_TELL_URL", "ALEPH_PLAN_CMD", "ALEPH_DISPATCH", "ALEPH_VAULT"];
let base: string;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-plan-"));
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  writeFileSync(join(base, "fake"), fake(base));
  chmodSync(join(base, "fake"), 0o755);
  writeFileSync(join(base, "calls"), "");
  // An empty vault, so the planner's recall never reads the real ~/.aleph/vault.
  mkdirSync(join(base, "vault-empty"));
  Object.assign(process.env, {
    ALEPH_ISSUES: join(base, "items"), ALEPH_REPOS: join(base, "repos.json"), ALEPH_JOBS_DIR: join(base, "jobs"),
    ALEPH_FACTORY_DIR: join(base, "factory"), XDG_RUNTIME_DIR: join(base, "run"), ALEPH_DAY_CAP: "100", ALEPH_LIVE_CAP: "5",
    SIDETONE_TELL_URL: "http://127.0.0.1:1/tell", ALEPH_PLAN_CMD: join(base, "fake"), ALEPH_DISPATCH: "off",
    ALEPH_VAULT: join(base, "vault-empty"),
  });
  factoryRepos(base);
  writeFileSync(join(base, "repos.json"), JSON.stringify({ fac: { path: join(base, "repo"), sandbox: true, autoland: false } }));
});

afterEach(() => {
  writeFileSync(join(base, "release"), "");
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(base, { recursive: true, force: true });
});

const body = (marker: string, surface = "jobs/lib/a.ts") => `## Goal\nA big thing. PLAN:${marker}\n## Edit surface\n${surface}\n## Oracle\n\`bun test\`\n## Time box\n40 minutes`;
/** Files an issue with a spec, as `aleph issue add --spec -` does; the issue's number. */
const addGoal = (marker: string, surface?: string, title = "big"): number =>
  writeList({ key: "fac" }, "add a goal", (doc) => {
    return issues.add(doc, title, { labels: ["ui"], spec: body(marker, surface) }).id;
  }, true)!.value;
const item = (id: number | string) => issues.find(readList({ key: "fac" })!, id)!;
const partRefs = (id: number) => { const doc = readList({ key: "fac" })!; return partsOf(doc, issues.find(doc, id)!).map((p) => `fac-${issues.refOf(p)}`); };
const planCalls = () => readFileSync(join(base, "calls"), "utf8").split("\n").filter(Boolean);
const planRuns = () => readdirSync(join(base, "jobs")).filter((d) => d.endsWith("-plan")).map((d) => readRun(join(base, "jobs", d))!);

/** Resolves once the fake planner has logged its call. Fails at once if every plan ends with no call logged. */
async function plannerLogsCall(plans: Promise<unknown>[]): Promise<void> {
  let watcher: FSWatcher | undefined;
  // The watch starts before the check below, so a call logged before it is not missed.
  const logged = new Promise<void>((resolve, reject) => {
    watcher = watch(join(base, "calls"), () => { if (planCalls().length) resolve(); });
    watcher.on("error", reject);
  });
  const ended = Promise.allSettled(plans).then(() => {
    if (!planCalls().length) throw new Error("a plan ended before the fake planner logged its call");
  });
  try {
    if (!planCalls().length) await Promise.race([logged, ended]);
  } finally {
    watcher?.close();
  }
}

/** One dispatch with the router's rating fixed; the names and tiers of the worker starts. The plans it starts run in-process, and are waited for. */
async function dispatch(tier: Tier | null) {
  const starts: [string, Tier | null | undefined][] = [];
  const plans: Promise<{ planned: string[] } | { why: string }>[] = [];
  const out: any = await dispatchIssues(async (_repo, name, _id, _spec, t) => { starts.push([name, t]); return null; }, undefined, undefined, undefined, async () => tier,
    (repo, id) => { plans.push(planNow(repo, id)); });
  const done = await Promise.all(plans);
  const refs = done.flatMap((r, i) => ("planned" in r ? [`${out.planned[i]} into ${r.planned.join(",")}`] : []));
  out.planned = refs.length ? refs : undefined;
  // The plan job's own dispatch, which starts the children or the fallback worker.
  const then: [string, Tier | null | undefined][] = [];
  if (plans.length) await dispatchIssues(async (_repo, name, _id, _spec, t) => { then.push([name, t]); return null; }, undefined, undefined, undefined, async () => tier, () => {});
  return { starts, then, out };
}

test("a goal rated sonnet with one top-level folder starts a worker and no planner run", async () => {
  const id = addGoal("three", "- jobs/lib/a.ts\n- jobs/lib/b.ts");
  const { starts } = await dispatch("sonnet");
  expect(starts).toEqual([[`fac-${id}`, "sonnet"]]);
  expect(planCalls()).toEqual([]);
  expect(itemLabels(item(id))).not.toContain("planned");
});

test("a goal rated opus starts a planner run and no worker; the goals are filed under the issue, the first rewritten in place", async () => {
  const id = addGoal("three");
  const { starts, out } = await dispatch("opus");
  expect(starts).toEqual([]);
  expect(planCalls()).toEqual([expect.stringContaining("--model claude-opus-5-5 --tools Read Grep Glob")]);
  expect(planRuns()).toEqual([expect.objectContaining({ kind: "plan", name: `plan-fac-${id}`, on: `fac-${id}`, condition: "done", reason: "planned" })]);
  const refs = [1, 2, 3].map((k) => `fac-${id}.${k}`);
  expect(out.planned).toEqual([`fac-${id} into ${refs.join(",")}`]);
  for (const k of [1, 2, 3]) {
    expect(item(`${id}.${k}`).spec).toContain("## Oracle");
    expect(item(`${id}.${k}`).spec).not.toContain("Part of");
  }
  expect(item(`${id}.1`).title).toBe("one");
  expect(item(`${id}.1`).fm.after).toEqual([]);
  expect(item(`${id}.2`).fm.after).toEqual([`fac-${id}.1`]);
  expect(item(`${id}.3`).fm.after).toEqual([`fac-${id}.1`, `fac-${id}.2`]);
  expect(partRefs(id)).toEqual(refs);
  expect(item(id).spec).toBe("");
  expect(itemLabels(item(id))).not.toContain("planned");
  expect(item(id).notes.at(-1)).toContain(`planner: split into fac-${id}.1 (one), fac-${id}.2 (two), fac-${id}.3 (three)`);
});

test("an Edit surface in two top-level folders is large whatever the rating", async () => {
  const id = addGoal("three", "jobs/lib/a.ts, `ui/views/now.js`");
  const { starts } = await dispatch("sonnet");
  expect(starts).toEqual([]);
  expect(partRefs(id)).toHaveLength(3);
});

test("an issue with goals is not dispatched, goals wait on their after, and the issue closes as done once all are done", async () => {
  const id = addGoal("three");
  await dispatch("opus");
  const kids = [1, 2, 3].map((k) => `${id}.${k}`);
  const finish = (n: string) => writeList({ key: "fac" }, "done", (doc) => { issues.setStatus(issues.find(doc, n)!, "done"); return true; });
  finish(kids[0]);
  finish(kids[1]);
  let { starts, out } = await dispatch("opus");
  expect(starts.map(([n]) => n)).toEqual([`fac-${kids[2]}`]);
  expect(issues.status(item(id))).toBe("open");
  expect(planCalls().length).toBe(1);
  finish(kids[2]);
  ({ starts, out } = await dispatch("opus"));
  expect(starts).toEqual([]);
  expect(out.skipped).toContain(`fac-${id}: closed as done`);
  expect(issues.status(item(id))).toBe("done");
  expect(item(id).notes.at(-1)).toEndWith(`its parts are done: ${kids.map((k) => `fac-${k} (no commit)`).join(", ")}`);
});

test("a bad reply then a good one plans the goal", async () => {
  const id = addGoal("badthengood");
  const { starts } = await dispatch("opus");
  expect(planCalls().length).toBe(2);
  expect(starts).toEqual([]);
  expect(partRefs(id)).toHaveLength(3);
});

test("a goal that has had a run is not planned", async () => {
  const id = addGoal("three");
  const folder = join(base, "jobs", `20261028-000000-fac-${id}-agent`);
  mkdirSync(folder, { recursive: true });
  writeRun(folder, { kind: "build", job: "x", name: `fac-${id}`, repo: "fac", on: `fac-${id}`, condition: "dropped", told: true, started: new Date().toISOString() });
  await dispatch("opus");
  expect(planCalls()).toEqual([]);
});

test("a dispatch returns before a slow planner replies; the small goal starts, and the large goal is planning", async () => {
  const big = addGoal("slow");
  const small = addGoal("small", undefined, "small");
  const starts: string[] = [];
  const plans: Promise<unknown>[] = [];
  try {
    const out = await dispatchIssues(async (_r, name) => { starts.push(name); return null; }, undefined, undefined, undefined,
      async (spec) => (spec.includes("PLAN:slow") ? "opus" : "sonnet"), (repo, id) => { plans.push(planNow(repo, id)); });
    expect(starts).toEqual([`fac-${small}`]);
    expect(out.planned).toEqual([`fac-${big}`]);
    // Waits for the fake planner to log its call while the plan runs; the test timeout is the only limit.
    await plannerLogsCall(plans);
    expect(planRuns()).toEqual([expect.objectContaining({ kind: "plan", on: `fac-${big}`, condition: "running" })]);

    // A second pass starts no second plan and no worker for the large goal.
    const again: string[] = [];
    const out2 = await dispatchIssues(async (_r, name) => { again.push(name); return null; }, undefined, undefined, undefined,
      async (spec) => (spec.includes("PLAN:slow") ? "opus" : "sonnet"), (repo, id) => { plans.push(planNow(repo, id)); });
    expect(again).not.toContain(`fac-${big}`);
    expect(out2.skipped).toContain(`fac-${big}: planning`);
    expect(plans.length).toBe(1);
    expect(planCalls().length).toBe(1);

    // The planner waits for this file, so the dispatch returned while it was still running, whatever the load.
    writeFileSync(join(base, "release"), "");
    await Promise.all(plans);
    expect(partRefs(big)).toEqual([1, 2, 3].map((k) => `fac-${big}.${k}`));
    expect(planRuns()).toEqual([expect.objectContaining({ condition: "done", reason: "planned" })]);
  } finally {
    // Runs even when an assertion throws: release the planner and let every started plan finish before afterEach removes the folder.
    writeFileSync(join(base, "release"), "");
    await Promise.allSettled(plans);
  }
}, 30000);

test("a plan job left running by a dead process is ended as failed, and the goal is planned again", async () => {
  const id = addGoal("three");
  const folder = join(base, "jobs", `20261028-000000-plan-fac-${id}-plan`);
  mkdirSync(folder, { recursive: true });
  writeRun(folder, { kind: "plan", job: "x", name: `plan-fac-${id}`, repo: "fac", on: `fac-${id}`, condition: "running", phase: "plan", told: true, started: new Date().toISOString() });
  const { out } = await dispatch("opus");
  expect(readRun(folder)).toEqual(expect.objectContaining({ condition: "done", reason: "failed: its process ended before a reply" }));
  expect(planCalls().length).toBe(1);
  expect(planRuns().filter((r) => r.reason === "planned").length).toBe(1);
  expect(out.planned).toEqual([expect.stringContaining(`fac-${id} into`)]);
});

test("the planner prompt limits each child's Goal to 3 sentences with no implementation design", () => {
  const p = prompt({ key: "fac" } as any, { id: 1, title: "t", request: "", spec: "", notes: [], fm: {} } as any);
  expect(p).toContain("the behaviour in at most 3 sentences");
  expect(p).toContain("no implementation design");
  expect(p).toContain("no claim about code on main that you did not read");
});

describe("the planner prompt's similar episodes", () => {
  let vaultSaved: string | undefined;
  beforeEach(() => { vaultSaved = process.env.ALEPH_VAULT; });
  afterEach(() => { if (vaultSaved === undefined) delete process.env.ALEPH_VAULT; else process.env.ALEPH_VAULT = vaultSaved; });

  const bigGoal = (): number => addGoal("three", undefined, "Add a second report line");
  const lastPrompt = () => {
    const d = readdirSync(join(base, "jobs")).filter((x) => x.endsWith("-plan")).sort().at(-1)!;
    return readFileSync(join(base, "jobs", d, "prompt.md"), "utf8");
  };

  test("an empty vault leaves the section out and the planner still runs", async () => {
    const empty = join(base, "empty");
    mkdirSync(empty);
    process.env.ALEPH_VAULT = empty;
    const id = bigGoal();
    expect(await runPlan({ key: "fac", path: join(base, "repo"), main: "main" } as any, id)).toEqual({ planned: expect.any(Array) });
    expect(lastPrompt()).not.toContain("# How similar goals went");
  });

  test("no episodes leaves the prompt as it was", () => {
    const it = { id: 1, title: "t", fm: {}, request: "", spec: "b", notes: ["n"] } as any;
    expect(prompt({ key: "fac" } as any, it)).toBe(prompt({ key: "fac" } as any, it, []));
    expect(prompt({ key: "fac" } as any, it)).not.toContain("How similar goals went");
    expect(prompt({ key: "fac" } as any, it)).toContain("Notes:\nn\n\nSplit it into");
  });
});

test("a child title over 60 characters is cut to 60, and the prompt asks for a short one", () => {
  const long = child(`${"word ".repeat(12)}end`);
  const got = parsePlan(reply([child("one"), long]));
  expect(Array.isArray(got) && got[1].title.length <= 60 && got[1].title.startsWith("word word")).toBe(true);
  expect(prompt({ key: "fac" } as any, { id: 1, title: "t", fm: {}, request: "", spec: "b", notes: [] } as any)).toContain("at most 60 characters");
});
