import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closedWhy, readList, writeList } from "../../../issues/lib/store.ts";
import { askOf } from "../asks/ask.ts";
import * as issues from "../../../issues/lib/todo.ts";
import { dispatchIssues, suiteStep } from "./factory.ts";
import type { Rescue } from "../land/rescue.ts";
import { allJobs, allRuns, type Run } from "../records/ledger.ts";
import { setState } from "../records/record.ts";
import { readEvents } from "../../../lib/layout.ts";
import { seed } from "../../job.testkit.ts";
import type { ChecksStop } from "../gates/checks.ts";
import { factoryRepos } from "../../../tests/git.testkit.ts";
import { writeRepos } from "../../../tests/projects.testkit.ts";
import { issueKey } from "../../../lib/naming.ts";

const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
export function sh(cwd: string, ...args: string[]): void {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
}

const KEYS = ["ALEPH_ITEMS", "ALEPH_JOBS_DIR", "ALEPH_FACTORY_DIR", "ALEPH_DB", "ALEPH_VAULT", "XDG_RUNTIME_DIR", "ALEPH_LIVE_CAP", "SIDETONE_TELL_URL", "ALEPH_DISPATCH"];
let dir: string;
/** The test's clock: the time setup made its temp directory, read once from that directory. mk's runs start at it. */
let now: number;
let saved: Record<string, string | undefined>;

/** The test's temp directory. `dir` is reassigned per test, so tests read it through this getter, never a copy. */
export const ctx = { get base(): string { return dir; } };

// Each test gets its own factory repo, work store and registry, so the baseline and the issue list start empty.
export function setup(): void {
  dir = mkdtempSync(join(tmpdir(), "aleph-factory-"));
  now = statSync(dir).mtimeMs;
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  Object.assign(process.env, {
    ALEPH_ITEMS: join(dir, "items"), ALEPH_JOBS_DIR: join(dir, "jobs"),
    ALEPH_FACTORY_DIR: join(dir, "factory"), ALEPH_DB: join(dir, "aleph.db"), ALEPH_VAULT: join(dir, "vault"), XDG_RUNTIME_DIR: join(dir, "run"), ALEPH_LIVE_CAP: "5", SIDETONE_TELL_URL: "http://127.0.0.1:1/tell", ALEPH_DISPATCH: "off",
  });
  // The factory repo, with an origin the baseline can fetch, and the work store, empty: a list starts with its first item.
  factoryRepos(dir);
  writeRepos({ fac: { path: join(dir, "repo"), sandbox: true, autoland: false } }, join(dir, "items"));
}

export function teardown(): void {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(dir, { recursive: true, force: true });
}


/** A new open issue in the store's factory list `key` (default `fac`), with the given areas; returns its id. */
export const newIssue = (areas: string[] = [], key = "fac"): number =>
  writeList({ key }, "add a goal", (doc) => { const item = issues.add(doc, "ship it", { labels: areas, spec: "Do the thing." }); return item.id; }, true)!.value;

/** Change item `id` in the store, as Chris would while the baseline runs. */
export const change = (id: number, f: (item: issues.Issue) => void) =>
  writeList({ key: "fac" }, "edit", (doc) => { f(issues.find(doc, id)!); return true; });

/**
 * A job in the ledger. `name` is `fac-<n>`: the job works on issue `n`, and its name is the issue key `issue.<n>`. A new work
 * unless `extra.job` names the first job of a work: then it follows that work's last job.
 */
export function mk(name: string, role: Run["role"], state: Run["state"], extra: Partial<Run> = {}, files: Record<string, string> = {}): { folder: string; job: string } {
  const { job: work, ...rest } = extra;
  const prev = work ? allRuns().findLast((e) => e.run.job === work)?.id : undefined;
  const n = name.split("-")[1];
  const made = seed({ role, name: issueKey(n), repo: "fac", target: issueKey(n), state, shown: true, started: new Date(now).toISOString(), ...(prev ? { prev } : {}), ...rest });
  for (const [f, text] of Object.entries(files)) writeFileSync(join(made.folder, f), text);
  return { folder: made.folder, job: made.run.job };
}
export const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
/** What was said of issue `id`: its notes, why it closed, and the `changed` events code logged for it, as code writes no note. */
export const notes = (id: number) => {
  const item = readList({ key: "fac" })!.items.find((i) => i.id === id)!;
  return [...item.notes, closedWhy(item) ?? "", ...readEvents().filter((e) => e.action === "changed" && e.object === issueKey(id)).map((e) => e.detail)].join("\n");
};
export const ask = (id: number) => askOf(issueKey(id));

/** Fake actions that log their calls: a drop marks the run dropped, a recheck starts a passed recheck run. */
export function fakes() {
  const calls: string[] = [];
  const rescue: Rescue = {
    drop: async (name, reason, fate) => {
      calls.push(`drop ${name}`);
      const j = allJobs().find((x) => x.at(-1)!.run.name === name.replace(/^fac-/, "issue.") && x.at(-1)!.run.state !== "dropped")!;
      const last = j.at(-1)!;
      setState(last.id, "dropped", { reason, ...(fate ? { fate } : {}) });
      return null;
    },
    recheck: async (name) => {
      calls.push(`recheck ${name}`);
      const j = allJobs().find((x) => x.at(-1)!.run.name === name.replace(/^fac-/, "issue."))!;
      mk(name.replace(/^issue\./, "fac-"), "recheck", "running", { job: j[0].run.job, branch: j[0].run.branch });
      return null;
    },
  };
  const land = async (name: string) => { calls.push(`land ${name}`); return null; };
  const specs: string[] = [];
  const start = async (_r: unknown, name: string, _id: number | string, spec: string) => { calls.push(`start ${name}`); specs.push(spec); return null; };
  return { calls, rescue, land, specs, start };
}
export const dispatch = (f: ReturnType<typeof fakes>) => dispatchIssues(f.start, f.land, f.rescue);


// A claim that the issue is met is checked on origin/main: a new commit there, so the baseline is run again.
export const claimed = (name: string, evidence: string) => {
  sh(join(ctx.base, "repo"), "git", "commit", "-q", "--allow-empty", "-m", `main for ${name}`);
  sh(join(ctx.base, "repo"), "git", "push", "-q", "origin", "main");
  return mk(name, "build", "failed", { cause: "no-commit", reason: "no commit", alreadyMet: evidence });
};
/** A suite run with these checks, as `aleph suite` does, then a dispatch. */
export const withChecks = async (f: ReturnType<typeof fakes>, checks: (repo: unknown, commit: string, logs: string) => Promise<ChecksStop | null>) => {
  await suiteStep(checks);
  return dispatchIssues(f.start, f.land, f.rescue);
};
