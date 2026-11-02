import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { askOf, readList, writeList } from "../../todo/lib/store.ts";
import * as issues from "../../todo/lib/todo.ts";
import { dispatchIssues } from "./factory.ts";
import type { Rescue } from "./rescue.ts";
import { allJobs, writeRun, type Run } from "./ledger.ts";

const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
export function sh(cwd: string, ...args: string[]): void {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
}

const KEYS = ["ALEPH_ISSUES", "ALEPH_REPOS", "ALEPH_JOBS_DIR", "ALEPH_FACTORY_DIR", "XDG_RUNTIME_DIR", "ALEPH_DAY_CAP", "ALEPH_LIVE_CAP", "SIDETONE_TELL_URL", "ALEPH_DISPATCH"];
let dir: string;
let saved: Record<string, string | undefined>;

/** The test's temp directory. `dir` is reassigned per test, so tests read it through this getter, never a copy. */
export const ctx = { get base(): string { return dir; } };

// Each test gets its own factory repo, work store and registry, so the baseline and the goal list start empty.
export function setup(): void {
  dir = mkdtempSync(join(tmpdir(), "aleph-factory-"));
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  Object.assign(process.env, {
    ALEPH_ISSUES: join(dir, "items"), ALEPH_REPOS: join(dir, "repos.json"), ALEPH_JOBS_DIR: join(dir, "jobs"),
    ALEPH_FACTORY_DIR: join(dir, "factory"), XDG_RUNTIME_DIR: join(dir, "run"), ALEPH_DAY_CAP: "100", ALEPH_LIVE_CAP: "5", SIDETONE_TELL_URL: "http://127.0.0.1:1/tell", ALEPH_DISPATCH: "off",
  });
  // The factory repo, with an origin the baseline can fetch.
  sh(dir, "git", "init", "-q", "--bare", "-b", "main", join(dir, "repo.git"));
  sh(dir, "git", "clone", "-q", join(dir, "repo.git"), join(dir, "repo"));
  sh(join(dir, "repo"), "git", "commit", "-q", "--allow-empty", "-m", "init");
  sh(join(dir, "repo"), "git", "push", "-q", "origin", "main");
  // The work store, empty: a list starts with its first item.
  sh(dir, "git", "init", "-q", "--bare", "-b", "main", join(dir, "items.git"));
  sh(dir, "git", "clone", "-q", join(dir, "items.git"), join(dir, "items"));
  sh(join(dir, "items"), "git", "commit", "-q", "--allow-empty", "-m", "start");
  sh(join(dir, "items"), "git", "push", "-q", "origin", "main");
  writeFileSync(join(dir, "repos.json"), JSON.stringify({ fac: { path: join(dir, "repo"), sandbox: true, autoland: false } }));
}

export function teardown(): void {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(dir, { recursive: true, force: true });
}


/** A new open goal in the store's factory list `key` (default `fac`), with the given areas; returns its id. */
export const goal = (areas: string[] = [], key = "fac"): number =>
  writeList({ key }, "add a goal", (doc) => { const item = issues.add(doc, "ship it", { labels: areas, spec: "Do the thing." }); return item.id; }, true)!.value;

/** Change item `id` in the store, as Chris would while the baseline runs. */
export const change = (id: number, f: (item: issues.Issue) => void) =>
  writeList({ key: "fac" }, "edit", (doc) => { f(issues.find(doc, id)!); return true; });

let seq = 0;
/** A run folder in the ledger: a new job when `job` is not given. Returns the folder and the job id. */
export function mk(name: string, kind: Run["kind"], state: Run["condition"], extra: Partial<Run> = {}, files: Record<string, string> = {}): { folder: string; job: string } {
  const id = `20261028-0000${String(++seq).padStart(2, "0")}-fac-${name}-${kind}`;
  const folder = join(ctx.base, "jobs", id);
  mkdirSync(folder, { recursive: true });
  for (const [f, text] of Object.entries(files)) writeFileSync(join(folder, f), text);
  writeRun(folder, { kind, job: id, name, repo: "fac", condition: state, on: `fac-${name.split("-")[1]}`, told: true, shown: true, started: new Date().toISOString(), ...extra } as Run);
  return { folder, job: extra.job ?? id };
}
export const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
export const notes = (id: number) => readList({ key: "fac" })!.items.find((i) => i.id === id)!.notes.join("\n");
export const ask = (id: number) => askOf(readList({ key: "fac" })!.items.find((i) => i.id === id)!);

/** Fake actions that log their calls: a drop marks the run dropped, a recheck starts a passed recheck run. */
export function fakes() {
  const calls: string[] = [];
  const rescue: Rescue = {
    drop: async (name, reason, fate) => {
      calls.push(`drop ${name}`);
      const j = allJobs().find((x) => x.at(-1)!.run.name === name && x.at(-1)!.run.condition !== "dropped")!;
      const last = j.at(-1)!;
      writeRun(last.folder, { ...last.run, condition: "dropped", reason, ...(fate ? { fate } : {}) });
      return null;
    },
    recheck: async (name) => {
      calls.push(`recheck ${name}`);
      const j = allJobs().find((x) => x.at(-1)!.run.name === name)!;
      mk(name, "recheck", "running", { job: j[0].run.job, branch: j[0].run.branch });
      return null;
    },
  };
  const land = async (name: string) => { calls.push(`land ${name}`); return null; };
  const specs: string[] = [];
  const start = async (_r: unknown, name: string, _id: number | string, spec: string) => { calls.push(`start ${name}`); specs.push(spec); return null; };
  return { calls, rescue, land, specs, start };
}
export const dispatch = (f: ReturnType<typeof fakes>) => dispatchIssues(f.start, async () => null, f.land, f.rescue);


// A claim that the goal is met is checked on origin/main: a new commit there, so the baseline is run again.
export const claimed = (name: string, result: string) => {
  sh(join(ctx.base, "repo"), "git", "commit", "-q", "--allow-empty", "-m", `main for ${name}`);
  sh(join(ctx.base, "repo"), "git", "push", "-q", "origin", "main");
  return mk(name, "build", "stuck", { reason: "no commit" }, { "result.md": result });
};
export const withChecks = (f: ReturnType<typeof fakes>, checks: (repo: unknown, commit: string, logs: string) => Promise<string | null>) =>
  dispatchIssues(f.start, checks, f.land, f.rescue);
