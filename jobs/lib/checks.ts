/**
 * The check runner: one loop for a run's checks, in a worktree or under srt.
 * It owns the choice of checks, the slot, the time limit, the one rerun, the
 * log and the flake record. The caller gives what runs one check.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { recordFlake } from "./factory-status.ts";
import { checkSlot, onOf, type Check, type CheckResult, type Repo, type Run } from "./ledger.ts";
import { SCENARIOS } from "./author.ts";
import { readHidden } from "../../todo/lib/store.ts";
import { makeRunFolder, removeRunFolder, sandboxed } from "./sandbox.ts";
import type { Stated } from "./outcome.ts";
import { checkSeconds } from "./settings.ts";
import { gitPrelude, q } from "./agent-call.ts";
import { git } from "./git.ts";
import { runFile } from "./run-files.ts";

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
  const log = (text: string) => appendFileSync(runFile(t.folder, "checks.log"), text);
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
  const out = runFile(t.folder, "hidden.log");
  writeFileSync(out, "");
  const { r, seconds } = await withSlot(async () => {
    const t0 = Date.now();
    return { r: await exec(check, out, checkSeconds()), seconds: Math.round((Date.now() - t0) / 1000) };
  });
  const text = readFileSync(out, "utf8");
  const pass = Number(text.match(/^\s*(\d+) pass\s*$/m)?.[1] ?? 0);
  const fail = Number(text.match(/^\s*(\d+) fail\s*$/m)?.[1] ?? 0);
  t.record?.({ name: check.name, ok: r.code === 0 && !r.timedOut, seconds, ...(pass + fail ? { passed: pass, total: pass + fail } : {}) });
  appendFileSync(runFile(t.folder, "checks.log"), `## ${check.name}: exit ${r.code}${r.timedOut ? " (timed out)" : ""}\n\n`);
  if (r.timedOut) return { cause: "check", checkName: check.name, reason: `timed out: check ${check.name}`, timedOut: true };
  if (r.code !== 0) return { cause: "hidden-check", reason: fail ? `hidden check failed: ${fail} of ${pass + fail} tests` : "hidden check failed" };
  return null;
}

/** The checks that apply to the task, each run by `exec` on a tree the caller set up. */
export const runChecks = (t: CheckTask, exec: CheckExec): Promise<ChecksStop | null> => runAll(t, chosen(t), exec);

/**
 * The script lines that make a fresh clone of `ref` from `bundle` (a path relative to the run folder) and run
 * the repo's setup commands. The setup's output goes to checklog/setup.log and its exit code to checklog/setup.code.
 */
export function cloneAndSetup(setup: string[], bundle: string, ref: string): string {
  return [
    "set -e", ...gitPrelude(`../${bundle}`, [`+${ref}:refs/heads/check`]), "git switch -q check", "set +e",
    `{ ${setup.map((c) => `${c} && `).join("")}true; } > ../checklog/setup.log 2>&1; echo $? > ../checklog/setup.code`,
  ].join("\n");
}

type Step = Omit<Parameters<typeof sandboxed>[2], "read" | "write">;

/** The setup step in `dir/check`: the setup's exit code as text, or null when the step did not get that far. `code` is the sandbox's own exit code. */
async function setupStep(dir: string, setup: string[], bundle: string, ref: string, step: Step): Promise<{ setup: string | null; code: number }> {
  const r = await sandboxed(dir, cloneAndSetup(setup, bundle, ref), { ...step, read: [bundle], write: ["check", "checklog", "home", "tmp"] });
  const code = join(dir, "checklog", "setup.code");
  return { setup: existsSync(code) ? readFileSync(code, "utf8").trim() : null, code: r.code };
}

/**
 * The repo's setup and checks on `ref` of `bundle`, in a fresh clone in
 * `dir/check`: nothing a worker left in work/ runs. Each check is its own srt
 * step, so its exit code comes from outside the sandbox and it cannot write
 * checklog/.
 */
export async function checksInSandbox(t: CheckTask, dir: string, bundle: string, ref: string, hiddenFiles: Record<string, string> = {}): Promise<ChecksStop | null> {
  const noise = join(t.folder, "check.out");
  const step = { cwd: "check", env: { TZ: "UTC" }, hideCiMissing: true, onSpawn: t.onSpawn };
  t.phase("check setup");
  const s = await withSlot(() => setupStep(dir, t.repo.setup, bundle, ref, { ...step, stdout: noise, stderr: noise }));
  if (s.setup === null) return { cause: "other", reason: `checks did not start (exit ${s.code})` };
  if (s.setup !== "0") {
    appendFileSync(runFile(t.folder, "checks.log"), `## setup: exit ${s.setup}\n${tail(join(dir, "checklog", "setup.log"), 100)}\n\n`);
    return { cause: "check", checkName: "setup", reason: "setup failed" };
  }
  const exec = (read: string[]): CheckExec => (check, out, limit) => sandboxed(dir, check.run, { ...step, read, write: ["check", "home", "tmp"], limit, stdout: out, stderr: out });
  const failed = await runAll(t, chosen(t), exec([]));
  if (failed || !Object.keys(hiddenFiles).length) return failed;
  // The hidden files reach the disk only now, after the repo's own checks have passed.
  writeHidden(dir, hiddenFiles);
  return runHidden(t, { name: "hidden", run: `cp -r ../hidden .hidden; ${t.repo.hiddenRun}` }, exec(["hidden"]));
}

const writeHidden = (dir: string, files: Record<string, string>) => {
  mkdirSync(join(dir, "hidden"), { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, "hidden", name), text);
};

/** The last `n` lines of `text`, on one line (an issue note is one line), each cut to 200 characters. */
export const lastLines = (text: string, n = 40): string =>
  text.replace(/\s+$/, "").split("\n").slice(-n).map((l) => l.slice(0, 200)).join(" ⏎ ");

/** `infra` marks a fault of the sandbox, not a result of the command. */
export interface Ran { code: number; output: string; infra?: boolean }
/** Runs one command on the commit `sha` of the repo. */
export type Runner = (repo: Repo, sha: string, command: string, hidden?: Record<string, string>) => Promise<Ran>;

let calls = 0;
/**
 * One command on `sha`, as the checks run: the commit goes in as a bundle, and the repo's setup and then the
 * command run under srt in a fresh clone, with `hidden` in `.hidden`. A setup that fails or a step that does not
 * start is `infra`, and the command does not run. The command has 1200 seconds.
 */
export const runOnCommit: Runner = async (repo, sha, command, hidden) => {
  // Each call has its own folder and ref, so overlapping runs for one repo cannot remove or overwrite each other's files.
  const uid = `${process.pid}-${++calls}`;
  const dir = makeRunFolder(`accept-${repo.key}-${uid}`);
  const ref = `refs/aleph/accept/${repo.key}/${uid}`;
  try {
    git(repo.path, "update-ref", ref, sha);
    const b = git(repo.path, "bundle", "create", join(dir, "out", "accept.bundle"), ref);
    if (!b.ok) return { code: 1, output: `bundle failed: ${b.out}`, infra: true };
    const logs = join(dir, "stdout.log");
    const at = (f: string) => join(dir, "checklog", f);
    const step = { cwd: "check", env: { TZ: "UTC" }, hideCiMissing: true, stdout: logs, stderr: logs };
    const notStarted = (code: number): Ran => {
      const last = existsSync(logs) ? lastLines(readFileSync(logs, "utf8")) : "";
      return { code: code || 1, output: `the command did not start (exit ${code})${last ? `: ${last}` : ""}`, infra: true };
    };
    // One slot for both steps. The time limit is in the command's script, so the wait does not count against it.
    return await withSlot(async () => {
      const s = await setupStep(dir, repo.setup, "out/accept.bundle", ref, step);
      if (s.setup === null) return notStarted(s.code);
      if (s.setup !== "0") return { code: 1, output: `setup failed\n${readFileSync(at("setup.log"), "utf8")}`, infra: true };
      if (hidden) writeHidden(dir, hidden);
      const script = `${hidden ? "cp -r ../hidden .hidden\n" : ""}timeout -k 30 1200 bash -c ${q(command)} > ../checklog/out.log 2>&1; echo $? > ../checklog/code`;
      const r = await sandboxed(dir, script, { ...step, read: hidden ? ["hidden"] : [], write: ["check", "checklog", "home", "tmp"] });
      if (!existsSync(at("code"))) return notStarted(r.code);
      return { code: Number(readFileSync(at("code"), "utf8").trim()), output: existsSync(at("out.log")) ? readFileSync(at("out.log"), "utf8") : "" };
    });
  } finally {
    git(repo.path, "update-ref", "-d", ref);
    removeRunFolder(dir);
  }
};

/** A test file that a branch adds or changes with new cases: its path, its text on the head and the names of its new cases. */
export interface NewTests { path: string; text: string; names: string[] }

const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

/** The names of the `test(` and `it(` cases that the added lines of a diff open. */
export const newCases = (diff: string): string[] =>
  [...diff.matchAll(/^\+(?!\+\+).*?\b(?:test|it)(?:\.\w+)*\(\s*(["'`])(.+?)\1/gm)].map((m) => m[2]);

/** The test files that the diff from `base` to `tip` adds or changes with a new case. */
export function newTests(cwd: string, base: string, tip: string): NewTests[] {
  const files = git(cwd, "diff", "--name-only", "--diff-filter=AM", base, tip).out.split("\n").filter((f) => TEST_FILE.test(f));
  return files.flatMap((path) => {
    const names = newCases(git(cwd, "diff", base, tip, "--", path).out);
    return names.length ? [{ path, text: git(cwd, "show", `${tip}:${path}`).out + "\n", names }] : [];
  });
}

const unxml = (s: string) => s.replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#10;/g, "\n").replace(/&amp;/g, "&");

/** The cases that passed in bun's junit report: a `testcase` with no child element. */
export const junitPassed = (xml: string): { file: string; name: string }[] =>
  [...xml.matchAll(/<testcase name="([^"]*)"[^>]*?file="([^"]*)"[^>]*\/>/g)].map((m) => ({ file: unxml(m[2]), name: unxml(m[1]) }));

/** Where the keep-gate's command writes its junit report, in the clone. */
const REPORT = ".keep-gate.xml";

/**
 * The keep-gate: each new case of `tests` must pass on `tip` and fail on `base`. The head's text of each file
 * runs against the base code, so a file that is new on the head runs there too. Returns the reason and the
 * lines for checks.log, or null. A sandbox fault is not a failure.
 */
export async function keepGate(repo: Repo, base: string, tip: string, tests: NewTests[], runner: Runner = runOnCommit): Promise<{ reason: string; log: string } | null> {
  if (!tests.length) return null;
  const test = `bun test --reporter=junit --reporter-outfile=${REPORT} ${tests.map((t) => q(`./${t.path}`)).join(" ")}; c=$?; cat ${REPORT}; exit $c`;
  let head = await runner(repo, tip, test);
  if (!head.infra && head.code !== 0) head = await runner(repo, tip, test);
  if (head.infra) return null;
  if (head.code !== 0) return { reason: "keep-gate: the new tests fail on the head", log: `The new tests fail on the head commit:\n${lastLines(head.output.split("<?xml")[0], 40).replaceAll(" ⏎ ", "\n")}` };
  // The head's files reach the base clone in `.hidden`, by index, as runOnCommit gives hidden files.
  const files = Object.fromEntries(tests.map((t, i) => [String(i), t.text]));
  const copy = tests.map((t, i) => `mkdir -p ${q(dirname(t.path))} && cp .hidden/${i} ${q(t.path)}`).join(" && ");
  const onBase = await runner(repo, base, `${copy} && { ${test}; }`, files);
  if (onBase.infra) return null;
  const fresh = new Set(tests.flatMap((t) => t.names));
  const passed = junitPassed(onBase.output).filter((c) => fresh.has(c.name)).map((c) => `${c.file} > ${c.name}`);
  if (!passed.length) return null;
  return {
    reason: `keep-gate: ${passed.length} new test${passed.length > 1 ? "s pass" : " passes"} on the base commit: ${passed.join("; ")}`,
    log: `These new tests pass on the base commit ${base.slice(0, 10)}, without the branch's change, so they do not test it:\n${passed.map((p) => `- ${p}`).join("\n")}\nMake each one fail without the change, or remove it: a committed test needs a lasting reason.`,
  };
}

/** The repo's checks, all of them, on `commit` of origin/<main>: null when they pass, else the stop (`infra` when they could not run). For the factory's baseline. */
export async function baselineChecks(repo: Repo, commit: string, logs: string): Promise<ChecksStop | null> {
  // The fixed name is safe: baseline() in factory.ts holds lock(`baseline-${repo.key}`) around this.
  const dir = makeRunFolder(`baseline-${repo.key}`);
  const ref = `refs/aleph/baseline/${repo.key}`;
  try {
    rmSync(logs, { recursive: true, force: true });
    mkdirSync(logs, { recursive: true });
    git(repo.path, "update-ref", ref, commit);
    const b = git(repo.path, "bundle", "create", join(dir, "out", "base.bundle"), ref);
    if (!b.ok) return { cause: "infra", reason: `bundle failed: ${b.out}` };
    const all = git(repo.path, "ls-tree", "-r", "--name-only", commit).out.split("\n").filter(Boolean);
    const stop = await checksInSandbox({ folder: logs, repo, changed: all, phase: () => {} }, dir, "out/base.bundle", ref);
    return !stop || stop.cause === "check" ? stop : { ...stop, cause: "infra" };
  } catch (e) {
    return { cause: "infra", reason: `baseline did not run: ${e instanceof Error ? e.message : e}` };
  } finally {
    git(repo.path, "update-ref", "-d", ref);
    removeRunFolder(dir);
  }
}

/** The checks on `commit`, in the run's worktree, which is back on its branch after. `exec` runs one check there. */
export async function worktreeChecks(t: CheckTask, exec: CheckExec, run: Run, commit: string): Promise<ChecksStop | null> {
  const wt = run.worktree!;
  if (!existsSync(wt)) return { cause: "infra", reason: `worktree gone: ${wt}` };
  if (!git(wt, "checkout", "-q", "--detach", commit).ok) return { cause: "infra", reason: "checkout failed" };
  try {
    return await runChecks(t, exec);
  } finally {
    git(wt, "checkout", "-q", "-f", run.branch!);
  }
}

export const HIDDEN_UNREADABLE = "hidden checks unreadable";

/** The hidden test files of the run's item, none for a run with no item, or null when the work store cannot be read: such a run must not pass without them. Its scenarios go to the reviewer, not to a check. */
export function hiddenOf(repo: Repo, run: Run): Record<string, string> | null {
  const id = onOf(run);
  if (id === undefined) return {};
  try {
    const { [SCENARIOS]: _, ...tests } = readHidden(repo, id);
    return tests;
  } catch { return null; }
}

/** The checks on a land's squash commit: the commit goes in as a bundle. */
export async function sandboxChecks(t: CheckTask, id: string, commit: string, hidden: Record<string, string>): Promise<ChecksStop | null> {
  const dir = makeRunFolder(id);
  const ref = `refs/aleph/land/${id}`;
  try {
    git(t.repo.path, "update-ref", ref, commit);
    const b = git(t.repo.path, "bundle", "create", join(dir, "out", "land.bundle"), ref);
    if (!b.ok) return { cause: "infra", reason: `bundle failed: ${b.out}` };
    return await checksInSandbox(t, dir, "out/land.bundle", ref, hidden);
  } finally {
    git(t.repo.path, "update-ref", "-d", ref);
    removeRunFolder(dir);
  }
}
