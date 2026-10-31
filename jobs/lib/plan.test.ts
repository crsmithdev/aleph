import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, watch, writeFileSync } from "node:fs";
import type { FSWatcher } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { labels as itemLabels, readList, writeList } from "../../todo/lib/store.ts";
import * as todos from "../../todo/lib/todo.ts";
import { dispatchGoals, planNow } from "./factory.ts";
import { readRun, writeRun } from "./ledger.ts";
import { isLarge, parsePlan, prompt, realOracle, runPlan, topFolders } from "./plan.ts";
import type { Tier } from "./route.ts";

const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
function sh(cwd: string, ...args: string[]): void {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
}

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

const KEYS = ["ALEPH_ITEMS", "ALEPH_REPOS", "ALEPH_JOBS_DIR", "ALEPH_FACTORY_DIR", "XDG_RUNTIME_DIR", "ALEPH_DAY_CAP", "ALEPH_LIVE_CAP", "SIDETONE_TELL_URL", "ALEPH_PLAN_CMD", "ALEPH_DISPATCH", "ALEPH_VAULT"];
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
    ALEPH_ITEMS: join(base, "items"), ALEPH_REPOS: join(base, "repos.json"), ALEPH_JOBS_DIR: join(base, "jobs"),
    ALEPH_FACTORY_DIR: join(base, "factory"), XDG_RUNTIME_DIR: join(base, "run"), ALEPH_DAY_CAP: "100", ALEPH_LIVE_CAP: "5",
    SIDETONE_TELL_URL: "http://127.0.0.1:1/tell", ALEPH_PLAN_CMD: join(base, "fake"), ALEPH_DISPATCH: "off",
    ALEPH_VAULT: join(base, "vault-empty"),
  });
  sh(base, "git", "init", "-q", "--bare", "-b", "main", join(base, "repo.git"));
  sh(base, "git", "clone", "-q", join(base, "repo.git"), join(base, "repo"));
  sh(join(base, "repo"), "git", "commit", "-q", "--allow-empty", "-m", "init");
  sh(join(base, "repo"), "git", "push", "-q", "origin", "main");
  sh(base, "git", "init", "-q", "--bare", "-b", "main", join(base, "items.git"));
  sh(base, "git", "clone", "-q", join(base, "items.git"), join(base, "items"));
  sh(join(base, "items"), "git", "commit", "-q", "--allow-empty", "-m", "start");
  sh(join(base, "items"), "git", "push", "-q", "origin", "main");
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
const addGoal = (marker: string, surface?: string): number =>
  writeList({ key: "fac" }, "add a goal", (doc) => todos.add(doc, "big", { labels: ["goal", "ui"], body: body(marker, surface) }).id, true)!.value;
const item = (id: number) => todos.find(readList({ key: "fac" })!, id)!;
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
  const out: any = await dispatchGoals(async (_repo, name, _id, _spec, t) => { starts.push([name, t]); return null; }, undefined, undefined, undefined, async () => tier,
    (repo, id) => { plans.push(planNow(repo, id)); });
  const done = await Promise.all(plans);
  const refs = done.flatMap((r, i) => ("planned" in r ? [`${out.planned[i]} into ${r.planned.join(",")}`] : []));
  out.planned = refs.length ? refs : undefined;
  // The plan job's own dispatch, which starts the children or the fallback worker.
  const then: [string, Tier | null | undefined][] = [];
  if (plans.length) await dispatchGoals(async (_repo, name, _id, _spec, t) => { then.push([name, t]); return null; }, undefined, undefined, undefined, async () => tier, () => {});
  return { starts, then, out };
}

test("a goal rated sonnet with one top-level folder starts a worker and no planner run", async () => {
  const id = addGoal("three", "- jobs/lib/a.ts\n- jobs/lib/b.ts");
  const { starts } = await dispatch("sonnet");
  expect(starts).toEqual([[`fac-${id}`, "sonnet"]]);
  expect(planCalls()).toEqual([]);
  expect(itemLabels(item(id))).not.toContain("planned");
});

test("a goal rated opus starts a planner run and no worker; the children are filed and the parent waits on them", async () => {
  const id = addGoal("three");
  const { starts, out } = await dispatch("opus");
  expect(starts).toEqual([]);
  expect(planCalls()).toEqual([expect.stringContaining("--model claude-fable-5-1 --tools Read Grep Glob")]);
  expect(planRuns()).toEqual([expect.objectContaining({ kind: "plan", name: `plan-fac-${id}`, todo: id, state: "done", reason: "planned" })]);
  const [a, b, c] = [id + 1, id + 2, id + 3];
  expect(out.planned).toEqual([`fac-${id} into fac-${a},fac-${b},fac-${c}`]);
  for (const n of [a, b, c]) {
    expect(itemLabels(item(n))).toEqual(["goal", "ui"]);
    expect(item(n).body.split("\n")[0]).toBe(`Part of fac-${id}.`);
    expect(item(n).body).toContain("## Oracle");
  }
  expect(item(a).fm.waiting_on).toBeUndefined();
  expect(item(b).fm.waiting_on).toBe(`fac-${a}`);
  expect(item(c).fm.waiting_on).toBe(`fac-${a},fac-${b}`);
  expect(itemLabels(item(id))).toEqual(expect.arrayContaining(["goal", "ui", "planned"]));
  expect(item(id).fm.waiting_on).toBe(`fac-${a},fac-${b},fac-${c}`);
  expect(item(id).notes.at(-1)).toContain(`planner: split into fac-${a} (one), fac-${b} (two), fac-${c} (three)`);
});

test("an Edit surface in two top-level folders is large whatever the rating", async () => {
  const id = addGoal("three", "jobs/lib/a.ts, `ui/views/now.js`");
  const { starts } = await dispatch("sonnet");
  expect(starts).toEqual([]);
  expect(itemLabels(item(id))).toContain("planned");
});

test("a planned parent is not dispatched while a child is open, and is closed as done once all are done", async () => {
  const id = addGoal("three");
  await dispatch("opus");
  const kids = [id + 1, id + 2, id + 3];
  const finish = (n: number) => writeList({ key: "fac" }, "done", (doc) => { todos.setStatus(todos.find(doc, n)!, "done"); return true; });
  finish(kids[0]);
  finish(kids[1]);
  let { starts, out } = await dispatch("opus");
  // The children are never planned again; only the open one that waits on nothing open starts.
  expect(starts.map(([n]) => n)).toEqual([`fac-${kids[2]}`]);
  expect(out.skipped).toContain(`fac-${id}: planned; waiting on fac-${kids[2]}`);
  expect(todos.status(item(id))).toBe("open");
  expect(planCalls().length).toBe(1);
  finish(kids[2]);
  ({ starts, out } = await dispatch("opus"));
  expect(starts).toEqual([]);
  expect(out.skipped).toContain(`fac-${id}: planned; closed as done`);
  expect(todos.status(item(id))).toBe("done");
  expect(item(id).notes.at(-1)).toEndWith(`planned: its children are all done: ${kids.map((k) => `fac-${k} (no commit)`).join(", ")}`);
});

for (const bad of ["one", "nooracle"]) {
  test(`a reply that fails the check (${bad}) is retried once; two bad replies start the goal as one worker run with a note`, async () => {
    const id = addGoal(bad);
    const { starts, then } = await dispatch("opus");
    expect(planCalls().length).toBe(2);
    expect(starts).toEqual([]);
    expect(then).toEqual([[`fac-${id}`, "opus"]]);
    expect(planRuns().map((r) => r.reason)).toEqual([expect.stringMatching(/^malformed plan: /), expect.stringMatching(/^malformed plan: /)]);
    expect(item(id).notes.at(-1)).toContain("planner: no plan passed the check in 2 runs");
    expect(itemLabels(item(id))).not.toContain("planned");
    expect(readList({ key: "fac" })!.items.length).toBe(1);
  });
}

test("a bad reply then a good one plans the goal", async () => {
  const id = addGoal("badthengood");
  const { starts } = await dispatch("opus");
  expect(planCalls().length).toBe(2);
  expect(starts).toEqual([]);
  expect(itemLabels(item(id))).toContain("planned");
});

test("a goal that has had a run is not planned", async () => {
  const id = addGoal("three");
  const folder = join(base, "jobs", `20261028-000000-fac-${id}-agent`);
  mkdirSync(folder, { recursive: true });
  writeRun(folder, { kind: "agent", job: "x", name: `fac-${id}`, repo: "fac", todo: id, state: "dropped", told: true, started: new Date().toISOString() });
  await dispatch("opus");
  expect(planCalls()).toEqual([]);
});

test("the check: sections, the oracle, the waits and the count", () => {
  expect(parsePlan(THREE)).toHaveLength(3);
  expect(parsePlan(ONE)).toBe("1 children, not 2 to 6");
  expect(parsePlan(NO_ORACLE)).toBe("child 2 has no Oracle");
  expect(parsePlan(reply([child("a"), { ...child("b"), waits_on: [2] }]))).toBe("child 2 waits on something that is not an earlier child");
  expect(parsePlan(reply([child("a"), child("b", "it works")]))).toBe("child 2's Oracle names no command or test file");
  expect(parsePlan(reply([child("a"), child("b", "`aleph check tests`")]))).toBe("child 2's Oracle names no command or test file");
  expect(realOracle("the new ui/plan.test.ts passes")).toBe(true);
  expect(topFolders("## Edit surface\n- `jobs/lib/plan.ts` (new)\n- ui/views/now.js\n- README.md\n## Oracle\nx/y")).toEqual(["jobs", "ui"]);
  expect(isLarge("sonnet", "## Edit surface\njobs/a.ts and jobs/b.ts")).toBe(false);
  expect(isLarge("opus", "")).toBe(true);
});

test("a dispatch returns before a slow planner replies; the small goal starts, and the large goal is planning", async () => {
  const big = addGoal("slow");
  const small = writeList({ key: "fac" }, "add", (doc) => todos.add(doc, "small", { labels: ["goal"], body: body("small") }).id, true)!.value;
  const starts: string[] = [];
  const plans: Promise<unknown>[] = [];
  try {
    const out = await dispatchGoals(async (_r, name) => { starts.push(name); return null; }, undefined, undefined, undefined,
      async (spec) => (spec.includes("PLAN:slow") ? "opus" : "sonnet"), (repo, id) => { plans.push(planNow(repo, id)); });
    expect(starts).toEqual([`fac-${small}`]);
    expect(out.planned).toEqual([`fac-${big}`]);
    // Waits for the fake planner to log its call while the plan runs; the test timeout is the only limit.
    await plannerLogsCall(plans);
    expect(planRuns()).toEqual([expect.objectContaining({ kind: "plan", todo: big, state: "running" })]);

    // A second pass starts no second plan and no worker for the large goal.
    const again: string[] = [];
    const out2 = await dispatchGoals(async (_r, name) => { again.push(name); return null; }, undefined, undefined, undefined,
      async (spec) => (spec.includes("PLAN:slow") ? "opus" : "sonnet"), (repo, id) => { plans.push(planNow(repo, id)); });
    expect(again).not.toContain(`fac-${big}`);
    expect(out2.skipped).toContain(`fac-${big}: planning`);
    expect(plans.length).toBe(1);
    expect(planCalls().length).toBe(1);

    // The planner waits for this file, so the dispatch returned while it was still running, whatever the load.
    writeFileSync(join(base, "release"), "");
    await Promise.all(plans);
    expect(item(big).fm.waiting_on).toBe(`fac-${big + 2},fac-${big + 3},fac-${big + 4}`);
    expect(itemLabels(item(big))).toContain("planned");
    expect(planRuns()).toEqual([expect.objectContaining({ state: "done", reason: "planned" })]);
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
  writeRun(folder, { kind: "plan", job: "x", name: `plan-fac-${id}`, repo: "fac", todo: id, state: "running", phase: "plan", told: true, started: new Date().toISOString() });
  const { out } = await dispatch("opus");
  expect(readRun(folder)).toEqual(expect.objectContaining({ state: "done", reason: "failed: its process ended before a reply" }));
  expect(planCalls().length).toBe(1);
  expect(planRuns().filter((r) => r.reason === "planned").length).toBe(1);
  expect(out.planned).toEqual([expect.stringContaining(`fac-${id} into`)]);
});

describe("the planner prompt's similar episodes", () => {
  let vaultSaved: string | undefined;
  beforeEach(() => { vaultSaved = process.env.ALEPH_VAULT; });
  afterEach(() => { if (vaultSaved === undefined) delete process.env.ALEPH_VAULT; else process.env.ALEPH_VAULT = vaultSaved; });

  const bigGoal = (): number => writeList({ key: "fac" }, "add a goal", (doc) =>
    todos.add(doc, "Add a second report line", { labels: ["goal"], body: body("three").replace("A big thing.", "Add a second line to the report.") }).id, true)!.value;
  const lastPrompt = () => {
    const d = readdirSync(join(base, "jobs")).filter((x) => x.endsWith("-plan")).sort().at(-1)!;
    return readFileSync(join(base, "jobs", d, "prompt.md"), "utf8");
  };
  const page = ["Goal", "What landed", "How it went", "Cost", "What went wrong"]
    .map((h) => `## ${h}\n${h === "How it went" ? "one agent run dropped: no commit" : `fac ${h.toLowerCase()} text`}\n`).join("\n");

  test("the top episodes are put in the planner's prompt, and only two of their sections", async () => {
    const vault = join(base, "vault");
    process.env.ALEPH_VAULT = vault;
    sh(base, "bun", join(import.meta.dir, "..", "..", "vault", "cli.ts"), "init");
    writeFileSync(join(vault, "wiki/episodes/fac-7 Add a report line.md"),
      `---\nkind: episode\nscope: fac\nconfidence: high\nupdated: 2026-10-01\nsupersedes: []\nsources: []\n---\n# fac-7 Add a report line\n\n${page}`);
    const id = bigGoal();
    expect(await runPlan({ key: "fac", path: join(base, "repo") } as any, id)).toEqual({ planned: expect.any(Array) });
    const p = lastPrompt();
    expect(p).toContain("# How similar goals went");
    expect(p).toContain("fac-7 Add a report line");
    expect(p).toContain("one agent run dropped: no commit");
    expect(p).toContain("fac what went wrong text");
    expect(p).not.toContain("fac cost text");
    expect(p).not.toContain("kind: episode");
  });

  test("an empty vault leaves the section out and the planner still runs", async () => {
    const empty = join(base, "empty");
    mkdirSync(empty);
    process.env.ALEPH_VAULT = empty;
    const id = bigGoal();
    expect(await runPlan({ key: "fac", path: join(base, "repo") } as any, id)).toEqual({ planned: expect.any(Array) });
    expect(lastPrompt()).not.toContain("# How similar goals went");
  });

  test("no episodes leaves the prompt as it was", () => {
    const it = { id: 1, title: "t", body: "b", notes: ["n"] } as any;
    expect(prompt({ key: "fac" } as any, it)).toBe(prompt({ key: "fac" } as any, it, []));
    expect(prompt({ key: "fac" } as any, it)).not.toContain("How similar goals went");
    expect(prompt({ key: "fac" } as any, it)).toContain("Notes:\nn\n\nSplit it into");
  });

  test("the prompt names bun run test for the full suite, not bun test", () => {
    const p = prompt({ key: "fac" } as any, { id: 1, title: "t", body: "b", notes: [] } as any);
    expect(p).toContain("bun run test");
    expect(p).toContain("There is no `aleph check` command");
    expect(p).not.toContain("such as `bun test`");
  });
});

test("a child title over 60 characters fails the check, and the prompt asks for a short one", () => {
  const long = child("x".repeat(61));
  expect(parsePlan(reply([child("one"), long]))).toBe("child 2's title is over 60 characters");
  expect(prompt({ key: "fac" } as any, { id: 1, title: "t", body: "b", notes: [] } as any)).toContain("at most 60 characters");
});
