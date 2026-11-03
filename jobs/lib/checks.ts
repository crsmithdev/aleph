/**
 * The check runner: one loop for a run's checks, in a worktree or under srt.
 * It owns the choice of checks, the slot, the time limit, the one rerun, the
 * log and the flake record. The caller gives what runs one check.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { factoryDir, flakes, flakyFile, type Flake } from "./factory-status.ts";
import { checkSlot, lock, type Check, type CheckResult, type Repo } from "./ledger.ts";
import { makeRunFolder, removeRunFolder, sandboxed } from "./sandbox.ts";
import type { Stated } from "./outcome.ts";
import { checkSeconds } from "./settings.ts";
import { gitPrelude } from "./agent-call.ts";
import { git } from "./git.ts";

/** Why the checks stopped: the cause and check name that the run states, the sentence for `reason`, and whether a clock ended the check. `null` is a pass. */
export type ChecksStop = Stated & { reason: string; timedOut?: boolean };

/** The fields of a run that a stop sets: the clock flag stays out of the run. */
export const stopFields = ({ timedOut: _, ...fields }: ChecksStop): Stated & { reason: string } => fields;

/** One run of checks. `folder` gets checks.log. `record` gets each check that ran. */
export interface CheckTask { folder: string; repo: Repo; changed: string[]; phase: (p: string) => void; onSpawn?: (p: ReturnType<typeof Bun.spawn>) => void; record?: (c: CheckResult) => void }

/** Runs one check with its output appended to `out`. `timedOut` comes from a clock: a command can return 124 by itself. */
export type CheckExec = (check: Check, out: string, limit: number) => Promise<{ code: number; timedOut: boolean }>;

/** The names on bun's `(fail)` lines, each one once: its summary repeats them. */
const failedTests = (log: string): string[] => [...new Set(log.matchAll(/^\(fail\) (.+?)(?: \[[\d.]+m?s\])?$/gm).map((m) => m[1]))];

/** Add a row to flaky.json under a lock, because runs in other processes add rows too. Returns false when the lock stays busy. */
async function recordFlake(row: Flake): Promise<boolean> {
  const release = await lock("flaky");
  if (!release) return false;
  try {
    mkdirSync(factoryDir(), { recursive: true });
    const tmp = `${flakyFile()}.tmp`;
    writeFileSync(tmp, JSON.stringify([...flakes(), row], null, 2) + "\n");
    renameSync(tmp, flakyFile());
    return true;
  } finally {
    release();
  }
}

/** Run `fn` holding a check slot: the slot is freed when `fn` settles, also when it throws. */
export async function withSlot<T>(fn: () => T | Promise<T>): Promise<T> {
  const free = await checkSlot();
  try {
    return await fn();
  } finally {
    free();
  }
}

const tail = (file: string, n: number) => existsSync(file) ? readFileSync(file, "utf8").trimEnd().split("\n").slice(-n).join("\n") : "";

/** The repo's checks with no `when`, and those whose globs match a changed file. */
const chosen = (t: CheckTask): Check[] => t.repo.checks.filter((c) => !c.when || t.changed.some((f) => c.when!.some((g) => new Bun.Glob(g).match(f))));

/** Whether the checks chosen for a diff are all of the repo's checks: none dropped for a `when` no changed file matches. */
export const coversAll = (repo: Repo, changed: string[]): boolean => chosen({ repo, changed } as CheckTask).length === repo.checks.length;

/** The one loop. A check that fails, not by timeout, runs once more on the same tree; a pass then is a flake. The first failure ends the loop. Returns why. */
async function runAll(t: CheckTask, checks: Check[], exec: CheckExec): Promise<ChecksStop | null> {
  const log = (text: string) => appendFileSync(join(t.folder, "checks.log"), text);
  for (const check of checks) {
    t.phase(`check ${check.name}`);
    const out = join(t.folder, "check.out");
    writeFileSync(out, "");
    // The wait for a slot is outside the time limit and outside the check's seconds.
    const { r, first, seconds } = await withSlot(async () => {
      const limit = checkSeconds();
      const t0 = Date.now();
      let r = await exec(check, out, limit);
      let first: string | undefined;
      if (r.code !== 0 && !r.timedOut) {
        first = readFileSync(out, "utf8");
        log(`## ${check.name}: exit ${r.code}, run again\n${tail(out, 100)}\n\n`);
        writeFileSync(out, "");
        r = await exec(check, out, limit);
      }
      return { r, first, seconds: Math.round((Date.now() - t0) / 1000) };
    });
    const ok = r.code === 0 && !r.timedOut;
    const rerun = first !== undefined && ok;
    if (rerun) {
      const tests = failedTests(first!);
      const row = { repo: t.repo.key, check: check.name, run: basename(t.folder), at: new Date().toISOString(), ...(tests.length ? { tests } : {}) };
      if (!await recordFlake(row)) log(`## ${check.name}: flake not recorded, lock busy\n\n`);
    }
    t.record?.({ name: check.name, ok, seconds, ...(rerun ? { rerun: true } : {}) });
    log(`## ${check.name}: exit ${r.code}${r.timedOut ? " (timed out)" : ""}${first !== undefined ? " (second run)" : ""}\n${tail(out, 100)}\n\n`);
    if (r.timedOut) return { cause: "check", checkName: check.name, reason: `timed out: check ${check.name}`, timedOut: true };
    if (r.code !== 0) return { cause: "check", checkName: check.name, reason: `${check.name} failed` };
  }
  return null;
}

/** The hidden check: last, with no rerun. Its log can show the tests' source, so it goes to its own file and never into checks.log. */
async function runHidden(t: CheckTask, check: Check, exec: CheckExec): Promise<ChecksStop | null> {
  t.phase(`check ${check.name}`);
  const out = join(t.folder, "hidden.log");
  writeFileSync(out, "");
  const { r, seconds } = await withSlot(async () => {
    const t0 = Date.now();
    return { r: await exec(check, out, checkSeconds()), seconds: Math.round((Date.now() - t0) / 1000) };
  });
  const text = readFileSync(out, "utf8");
  const pass = Number(text.match(/^\s*(\d+) pass\s*$/m)?.[1] ?? 0);
  const fail = Number(text.match(/^\s*(\d+) fail\s*$/m)?.[1] ?? 0);
  t.record?.({ name: check.name, ok: r.code === 0 && !r.timedOut, seconds, ...(pass + fail ? { passed: pass, total: pass + fail } : {}) });
  appendFileSync(join(t.folder, "checks.log"), `## ${check.name}: exit ${r.code}${r.timedOut ? " (timed out)" : ""}\n\n`);
  if (r.timedOut) return { cause: "check", checkName: check.name, reason: `timed out: check ${check.name}`, timedOut: true };
  if (r.code !== 0) return { cause: "hidden-check", reason: fail ? `hidden check failed: ${fail} of ${pass + fail} tests` : "hidden check failed" };
  return null;
}

/** The checks that apply to the task, each run by `exec` on a tree the caller set up. */
export const runChecks = (t: CheckTask, exec: CheckExec): Promise<ChecksStop | null> => runAll(t, chosen(t), exec);

/**
 * The script lines that make a fresh clone of `ref` from `bundle` (a path relative to the run folder) and run
 * the repo's setup commands; `after` is the text that follows the setup group, e.g. its redirect.
 */
export function cloneAndSetup(setup: string[], bundle: string, ref: string, after: string): string {
  return [
    "set -e", ...gitPrelude(`../${bundle}`, [`+${ref}:refs/heads/check`]), "git switch -q check", "set +e",
    `{ ${setup.map((c) => `${c} && `).join("")}true; } ${after}`,
  ].join("\n");
}

/**
 * The repo's setup and checks on `ref` of `bundle`, in a fresh clone in
 * `dir/check`: nothing a worker left in work/ runs. Each check is its own srt
 * step, so its exit code comes from outside the sandbox and it cannot write
 * checklog/.
 */
export async function checksInSandbox(t: CheckTask, dir: string, bundle: string, ref: string, hiddenFiles: Record<string, string> = {}): Promise<ChecksStop | null> {
  const script = cloneAndSetup(t.repo.setup, bundle, ref, "> ../checklog/setup.log 2>&1; echo $? > ../checklog/setup.code");
  const noise = join(t.folder, "check.out");
  const step = { cwd: "check", env: { TZ: "UTC" }, hideCiMissing: true, onSpawn: t.onSpawn };
  t.phase("check setup");
  const r = await withSlot(() => sandboxed(dir, script, { ...step, read: [bundle], write: ["check", "checklog", "home", "tmp"], stdout: noise, stderr: noise }));
  const code = join(dir, "checklog", "setup.code");
  if (!existsSync(code)) return { cause: "other", reason: `checks did not start (exit ${r.code})` };
  const setup = readFileSync(code, "utf8").trim();
  if (setup !== "0") {
    appendFileSync(join(t.folder, "checks.log"), `## setup: exit ${setup}\n${tail(join(dir, "checklog", "setup.log"), 100)}\n\n`);
    return { cause: "check", checkName: "setup", reason: "setup failed" };
  }
  const exec = (read: string[]): CheckExec => (check, out, limit) => sandboxed(dir, check.run, { ...step, read, write: ["check", "home", "tmp"], limit, stdout: out, stderr: out });
  const failed = await runAll(t, chosen(t), exec([]));
  if (failed || !Object.keys(hiddenFiles).length) return failed;
  // The hidden files reach the disk only now, after the repo's own checks have passed.
  mkdirSync(join(dir, "hidden"), { recursive: true });
  for (const [name, text] of Object.entries(hiddenFiles)) writeFileSync(join(dir, "hidden", name), text);
  return runHidden(t, { name: "hidden", run: `cp -r ../hidden .hidden; ${t.repo.hiddenRun}` }, exec(["hidden"]));
}

/** The repo's checks, all of them, on `commit` of origin/<main>: null when they pass, else why not. For the factory's baseline. */
export async function baselineChecks(repo: Repo, commit: string, logs: string): Promise<string | null> {
  // The fixed name is safe: baseline() in factory.ts holds lock(`baseline-${repo.key}`) around this.
  const dir = makeRunFolder(`baseline-${repo.key}`);
  const ref = `refs/aleph/baseline/${repo.key}`;
  try {
    rmSync(logs, { recursive: true, force: true });
    mkdirSync(logs, { recursive: true });
    git(repo.path, "update-ref", ref, commit);
    const b = git(repo.path, "bundle", "create", join(dir, "out", "base.bundle"), ref);
    if (!b.ok) return `bundle failed: ${b.out}`;
    const all = git(repo.path, "ls-tree", "-r", "--name-only", commit).out.split("\n").filter(Boolean);
    return (await checksInSandbox({ folder: logs, repo, changed: all, phase: () => {} }, dir, "out/base.bundle", ref))?.reason ?? null;
  } catch (e) {
    return `baseline did not run: ${e instanceof Error ? e.message : e}`;
  } finally {
    git(repo.path, "update-ref", "-d", ref);
    removeRunFolder(dir);
  }
}
