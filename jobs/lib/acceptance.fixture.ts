// The shared setup of the acceptance.*.test.ts files: a factory repo `fac` with an origin, an empty work store, and fake runners.
import { afterEach, beforeEach } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flakeTracker, readList, writeList } from "../../todo/lib/store.ts";
import * as issues from "../../todo/lib/todo.ts";
import type { Runner } from "./checks.ts";

const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
export function sh(cwd: string, ...args: string[]): string {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
  return p.stdout.toString().trim();
}

const KEYS = ["ALEPH_ISSUES", "ALEPH_REPOS", "ALEPH_JOBS_DIR", "ALEPH_FACTORY_DIR", "ALEPH_SANDBOX_DIR", "XDG_RUNTIME_DIR", "ALEPH_LIVE_CAP", "SIDETONE_TELL_URL", "ALEPH_DISPATCH", "ALEPH_SANDBOX_CMD", "ALEPH_QUIET_LOAD", "ALEPH_CHECK_SLOTS"];
export let base: string;
let saved: Record<string, string | undefined>;

export const ran: string[] = [];
export const shas: string[] = [];

/** Registers the hooks: a new repo, store and environment for each test. */
export function useAcceptanceFixture(): void {
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "aleph-accept-"));
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    Object.assign(process.env, {
      ALEPH_ISSUES: join(base, "items"), ALEPH_REPOS: join(base, "repos.json"), ALEPH_JOBS_DIR: join(base, "jobs"), ALEPH_SANDBOX_DIR: join(base, "runs"),
      ALEPH_FACTORY_DIR: join(base, "factory"), XDG_RUNTIME_DIR: join(base, "run"), ALEPH_LIVE_CAP: "5",
      SIDETONE_TELL_URL: "http://127.0.0.1:1/tell", ALEPH_DISPATCH: "off", ALEPH_QUIET_LOAD: "100000",
    });
    sh(base, "git", "init", "-q", "--bare", "-b", "main", join(base, "repo.git"));
    sh(base, "git", "clone", "-q", join(base, "repo.git"), join(base, "repo"));
    writeFileSync(join(base, "repo", "package.json"), JSON.stringify({ scripts: { ok: "true", bad: "echo boom; exit 3" } }));
    mkdirSync(join(base, "repo", "jobs", "lib"), { recursive: true });
    writeFileSync(join(base, "repo", "jobs", "lib", "acceptance.test.ts"), 'test("one", () => {});\n');
    writeFileSync(join(base, "repo", "b.test.ts"), 'test("two", () => {});\n');
    sh(join(base, "repo"), "git", "add", ".");
    sh(join(base, "repo"), "git", "commit", "-q", "-m", "init");
    sh(join(base, "repo"), "git", "push", "-q", "origin", "main");
    sh(base, "git", "init", "-q", "--bare", "-b", "main", join(base, "items.git"));
    sh(base, "git", "clone", "-q", join(base, "items.git"), join(base, "items"));
    sh(join(base, "items"), "git", "commit", "-q", "--allow-empty", "-m", "start");
    sh(join(base, "items"), "git", "push", "-q", "origin", "main");
    writeFileSync(join(base, "repos.json"), JSON.stringify({ fac: { path: join(base, "repo"), sandbox: true, autoland: false } }));
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    rmSync(base, { recursive: true, force: true });
  });

  beforeEach(() => { ran.length = 0; });
  beforeEach(() => { shas.length = 0; });
}

export const repoDir = () => join(base, "repo");
export const item = (id: number) => issues.find(readList({ key: "fac" })!, id)!;
export const notes = (id: number) => item(id).notes.join("\n");

/** A goal whose land is on origin/main (a commit with the Item trailer), with the store saying done. */
export function doneGoal(oracle: string): number {
  const id = writeList({ key: "fac" }, "add a goal", (doc) => { const i = issues.add(doc, "thing", { spec: `## Goal\nx\n## Edit surface\na.ts\n## Oracle\n${oracle}\n## Time box\n40 minutes` }); return i.id; }, true)!.value;
  land(id);
  writeList({ key: "fac" }, "close", (doc) => { issues.setStatus(issues.find(doc, id)!, "done"); return true; });
  return id;
}
export function land(id: number): void {
  sh(repoDir(), "git", "commit", "-q", "--allow-empty", "-m", `work\n\nIssue: fac-${id}`);
  sh(repoDir(), "git", "push", "-q", "origin", "main");
}
export const closeAgain = (id: number) => writeList({ key: "fac" }, "close", (doc) => { issues.setStatus(issues.find(doc, id)!, "done"); return true; });

export const runner = (code: number, output = ""): Runner => async (_repo, _sha, command) => { ran.push(command); return { code, output }; };

/** A landed goal the store says is open again, after an acceptance fail. */
export function reopened(oracle: string): number {
  const id = doneGoal(oracle);
  writeList({ key: "fac" }, "reopen", (doc) => { const i = issues.find(doc, id)!; issues.setStatus(i, "open"); issues.note(i, "acceptance: fail at abc1234: `bun test x` exited 128: the command did not start (exit 128)"); return true; });
  return id;
}

export const FAILED = "jobs/lib/acceptance.test.ts:\n(fail) outer (x) > one [1.00ms]\n\nb.test.ts:\n(fail) two\n 2 fail\n";
export const flakeNotes = () => flakeTracker(readList({ key: "fac" })!)?.notes.join("\n") ?? "";
/** Each call answers with the next result; the last repeats. */
export const answers = (...rs: { code: number; output: string; infra?: boolean }[]): Runner => async (_repo, sha, command) => { ran.push(command); shas.push(sha); return rs.length > 1 ? rs.shift()! : rs[0]; };
/** A commit of the goal that changes `path`. */
export function landFile(id: number, path: string): void {
  appendFileSync(join(repoDir(), path), `\n// ${Date.now()}\n`);
  sh(repoDir(), "git", "add", ".");
  sh(repoDir(), "git", "commit", "-q", "-m", `work\n\nIssue: fac-${id}`);
  sh(repoDir(), "git", "push", "-q", "origin", "main");
}

export const parentOf = (id: number) => sh(repoDir(), "git", "rev-parse", `${sh(repoDir(), "git", "log", "origin/main", "--reverse", "--format=%H", `--grep=Issue: fac-${id}`).split("\n")[0]}^`);
export const RERUN_FAIL = { code: 1, output: "jobs/lib/acceptance.test.ts:\n(fail) one\n 1 fail\n" };
