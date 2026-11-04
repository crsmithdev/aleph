import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readList, writeList, partsOf } from "../../todo/lib/store.ts";
import * as issues from "../../todo/lib/todo.ts";
import { dispatchIssues, planNow } from "./factory.ts";
import { readRun, writeRun } from "./ledger.ts";
import { isLarge, parsePlan, realOracle, runPlan, topFolders, type Child } from "./plan.ts";
import type { Tier } from "./route.ts";
import { factoryRepos } from "../../tests/git-fixture.ts";

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
  *PLAN:seen*) if [ -f seen.ts ]; then echo '${THREE}'; else echo 'no seen.ts'; fi ;;
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

test("a large goal whose spec has no Goal section starts one worker run at the rated tier and no planner run", async () => {
  const id = writeList({ key: "fac" }, "add a goal", (doc) => {
    return issues.add(doc, "big", { labels: ["ui"], spec: "## Edit surface\njobs/lib/a.ts\n## Oracle\n`bun test`\n## Time box\n40 minutes" }).id;
  }, true)!.value;
  const { starts, out } = await dispatch("opus");
  expect(starts).toEqual([[`fac-${id}`, "opus"]]);
  expect(out.planned).toBeUndefined();
  expect(planCalls()).toEqual([]);
  expect(existsSync(join(base, "jobs")) ? planRuns() : []).toEqual([]);
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
    expect(partRefs(id)).toEqual([]);
    expect(readList({ key: "fac" })!.items.length).toBe(1);
  });
}

/** An earlier ended plan run of the goal, with the given fields. */
function earlierPlan(id: number, fields: Record<string, unknown>): void {
  const folder = join(base, "jobs", `20261028-000000-plan-fac-${id}-earlier-plan`);
  mkdirSync(folder, { recursive: true });
  writeRun(folder, { kind: "plan", job: "x", name: `plan-fac-${id}`, repo: "fac", on: `fac-${id}`, condition: "done", phase: "plan", told: true, started: new Date().toISOString(), ...fields });
}

test("a plan run with the cause no-answer and a free reason counts as a try", async () => {
  const id = addGoal("one");
  earlierPlan(id, { cause: "no-answer", reason: "something else entirely" });
  await dispatch("opus");
  expect(planCalls().length).toBe(1);
  expect(item(id).notes.at(-1)).toContain("planner: no plan passed the check in 2 runs");
});

test("the check: sections, the oracle, the waits and the count", () => {
  expect(parsePlan(THREE)).toHaveLength(3);
  expect(parsePlan(ONE)).toBe("1 children, not 2 to 6");
  expect(parsePlan(NO_ORACLE)).toBe("child 2 has no Oracle");
  expect(parsePlan(reply([child("a"), { ...child("b"), waits_on: [2] }]))).toBe("child 2 waits on something that is not an earlier child");
  expect(parsePlan(reply([child("a"), child("b", "it works")]))).toBe("child 2's Oracle names no command or test file");
  expect(parsePlan(reply([child("a"), child("b", "`aleph check tests`")]))).toBe("child 2's Oracle names no command or test file");
  // A title that breaks the rule is cut to fit; a child with no Time box passes.
  const cut = parsePlan(reply([child("a"), { ...child("b"), title: "Check foo: bar." }, { ...child("c"), title: `[Group] ${"a ".repeat(30)}` }, { title: "d", body: "## Goal\nx\n## Edit surface\na/b.ts\n## Oracle\n`bun test`" }])) as Child[];
  expect(cut.map((c) => c.title)).toEqual(["a", "bar", `[Group] ${"a ".repeat(25)}a`, "d"]);
  expect(realOracle("the new ui/plan.test.ts passes")).toBe(true);
  expect(topFolders("## Edit surface\n- `jobs/lib/plan.ts` (new)\n- ui/views/now.js\n- README.md\n## Oracle\nx/y")).toEqual(["jobs", "ui"]);
  expect(isLarge("sonnet", "## Edit surface\njobs/a.ts and jobs/b.ts")).toBe(false);
  expect(isLarge("opus", "")).toBe(true);
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
  const page = ["Goal", "What landed", "How it went", "Cost", "What went wrong"]
    .map((h) => `## ${h}\n${h === "How it went" ? "one agent run dropped: no commit" : `fac ${h.toLowerCase()} text`}\n`).join("\n");

  test("the top episodes are put in the planner's prompt, and only two of their sections", async () => {
    const vault = join(base, "vault");
    process.env.ALEPH_VAULT = vault;
    sh(base, "bun", join(import.meta.dir, "..", "..", "vault", "cli.ts"), "init");
    writeFileSync(join(vault, "wiki/episodes/fac-7 Add a report line.md"),
      `---\nkind: episode\nscope: fac\nconfidence: high\nupdated: 2026-10-01\nsupersedes: []\nsources: []\n---\n# fac-7 Add a report line\n\n${page}`);
    const id = bigGoal();
    expect(await runPlan({ key: "fac", path: join(base, "repo"), main: "main" } as any, id)).toEqual({ planned: expect.any(Array) });
    const p = lastPrompt();
    expect(p).toContain("# How similar goals went");
    expect(p).toContain("fac-7 Add a report line");
    expect(p).toContain("one agent run dropped: no commit");
    expect(p).toContain("fac what went wrong text");
    expect(p).not.toContain("fac cost text");
    expect(p).not.toContain("kind: episode");
  });
});

const CLI = join(import.meta.dir, "..", "cli.ts");
async function cli(args: string[], stdin?: string) {
  const p = Bun.spawn(["bun", CLI, ...args], { cwd: base, env: { ...process.env, ...gitEnv }, stdin: stdin === undefined ? "ignore" : new Blob([stdin]), stdout: "pipe", stderr: "pipe" });
  const code = await p.exited;
  return { code, out: await new Response(p.stdout).text(), err: await new Response(p.stderr).text() };
}
const commitCount = () => Number(Bun.spawnSync(["git", "rev-list", "--count", "main"], { cwd: join(base, "items.git") }).stdout.toString().trim());
const fileAt = (path: string) => Bun.spawnSync(["git", "show", `main:${path}`], { cwd: join(base, "items.git") }).stdout.toString();

test("aleph plan on an issue filed with --spec - files parts .1 to .3 in one commit (criterion 3)", async () => {
  const added = await cli(["issue", "add", "fac", "t", "--spec", "-", "--labels", "ui"], body("three"));
  expect(added.code).toBe(0);
  const n = JSON.parse(added.out).added as number;
  const before = commitCount();
  const planned = await cli(["plan", `fac-${n}`]);
  expect(planned.err).toBe("");
  expect(planned.code).toBe(0);
  expect(commitCount()).toBe(before + 1);
  const tree = Bun.spawnSync(["git", "ls-tree", "-r", "--name-only", "main"], { cwd: join(base, "items.git") }).stdout.toString();
  for (const k of [1, 2, 3]) expect(tree).toContain(`fac-${n}.${k}.md`);
  const doc = readList({ key: "fac" })!;
  for (const k of [1, 2, 3]) expect(issues.find(doc, `${n}.${k}`)!.spec).toContain("## Oracle");
  expect(issues.find(doc, `${n}.3`)!.fm.after).toContain(`fac-${n}.1`);
  expect(partsOf(doc, issues.find(doc, n)!).map((p) => issues.refOf(p))).toEqual([`${n}.1`, `${n}.2`, `${n}.3`]);
  expect(fileAt(`fac/backlog/tasks/fac-${n}.md`)).toContain(`fac-${n}.3`);
  expect(planRuns()).toEqual([expect.objectContaining({ kind: "plan", on: `fac-${n}`, condition: "done", reason: "planned" })]);
  const state = JSON.parse(readFileSync(join(base, "jobs", readdirSync(join(base, "jobs")).find((d) => d.endsWith("-plan"))!, "state.json"), "utf8"));
  expect(state).toMatchObject({ on: `fac-${n}`, kind: "plan" });
});

test("the planner reads a clone at origin/main: it sees a commit the checkout does not have, and the clone is gone after", async () => {
  const other = join(base, "other");
  sh(base, "git", "clone", "-q", join(base, "repo.git"), other);
  writeFileSync(join(other, "seen.ts"), "export const seen = 1;\n");
  sh(other, "git", "add", "-A");
  sh(other, "git", "commit", "-q", "-m", "Add seen.ts");
  sh(other, "git", "push", "-q", "origin", "main");
  const head = () => Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: join(base, "repo") }).stdout.toString();
  const before = head();
  const id = addGoal("seen");
  expect(await runPlan({ key: "fac", path: join(base, "repo"), main: "main" } as any, id)).toEqual({ planned: expect.any(Array) });
  expect(existsSync(join(base, "repo", "seen.ts"))).toBe(false);
  expect(head()).toBe(before);
});
