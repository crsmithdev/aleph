/**
 * The check runner: one loop for a run's checks, in a git worktree.
 * It owns the choice of checks, the admission, the time limit, the one rerun, the
 * log and the flake record. The caller gives what runs one check.
 */
import { appendFileSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { recordFlake } from "./tables.ts";
import { admit, type Admission, type Check, type CheckResult, type FailedTest, type Repo, type TestRecord } from "../records/ledger.ts";
import type { Stated } from "../records/outcome.ts";
import { checkSeconds } from "../infra/settings.ts";
import { git } from "../../../lib/git.ts";
import { jobOfFolder, logTo } from "../records/run-files.ts";
import { isJsTestFile } from "../../../lib/test-files.ts";
import { errText } from "../../../lib/errtext.ts";

const q = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

/**
 * Why the checks stopped: the cause and check name that the run states, the sentence for `reason`, and whether a clock
 * ended the check. `null` is a pass. A check that a clock or a signal ended gives no verdict: its cause is `infra`.
 */
export type ChecksStop = Stated & { reason: string; timedOut?: boolean };

/** The fields of a run that a stop sets: the clock flag stays out of the run. */
export const stopFields = ({ timedOut: _, ...fields }: ChecksStop): Stated & { reason: string } => fields;

/** One run of checks. `folder` gets checks.log. `record` gets each check that ran. `admission` is for tests. */
export interface CheckTask { folder: string; repo: Repo; changed: string[]; phase: (p: string) => void; onSpawn?: (p: ReturnType<typeof Bun.spawn>) => void; record?: (c: CheckResult & { rerunPassed?: number }) => void; admission?: Admission }

/**
 * Runs one check with its output appended to `out`. `timedOut` comes from a clock: a command can return 124 by itself.
 * `killed`: a signal ended the process.
 */
export type CheckExec = (check: Check, out: string, limit: number) => Promise<{ code: number; timedOut: boolean; killed?: boolean }>;

/** The names on bun's `(fail)` lines, each one once: its summary repeats them. */
export const failedTests = (log: string): string[] => [...new Set(log.matchAll(/^\(fail\) (.+?)(?: \[[\d.]+m?s\])?$/gm).map((m) => m[1]))];

/** The test files on bun's worker-crash lines, each one once: a run whose worker crashed prints no `(fail)` line. */
const crashedFiles = (log: string): string[] => [...new Set(log.matchAll(/^✗ (.+?) \(worker crashed: .+\)$/gm).map((m) => m[1]))];

/** One line, at most 80 characters, on why a check failed: bun's failed tests, else its crashed files, else the first error line, else the last line. */
export function failureLine(log: string): string {
  const text = log.replace(/\x1b\[[0-9;]*m/g, ""), fails = failedTests(text), crashed = crashedFiles(text);
  const line = fails.length ? `${fails.length} fail (${fails[0]})`
    : crashed.length ? `${crashed.length} crash (${crashed[0]})`
    : text.split("\n").map((l) => l.trim()).find((l) => /error|fail/i.test(l)) ?? text.trimEnd().split("\n").at(-1)?.trim() ?? "";
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}

const tail = (file: string, n: number) => existsSync(file) ? readFileSync(file, "utf8").trimEnd().split("\n").slice(-n).join("\n") : "";

/** The repo's checks with no `when`, and those whose globs match a changed file. */
const chosen = (t: CheckTask): Check[] => t.repo.checks.filter((c) => !c.when || t.changed.some((f) => c.when!.some((g) => new Bun.Glob(g).match(f))));

/** A command that runs `bun test`, directly or as a package script such as `test` or `test:all`, with the whole script name. */
const BUN_TEST = /^bun (?:run )?test\b\S*/;

/** The JUnit report of the check `name` in the run folder. */
export const junitFile = (folder: string, name: string): string => join(folder, `junit-${name.replace(/[^\w.-]/g, "-")}.xml`);

/** `cmd` with bun's JUnit reporter writing to `file`, when it runs `bun test`; else `cmd`. `bun run` passes the flags to the script. */
export const withJunit = (cmd: string, file: string): string => cmd.replace(BUN_TEST, (m) => `${m} --reporter=junit --reporter-outfile=${q(file)}`);

/** Whether `cmd` runs `bun test`, so it writes a JUnit report under withJunit. */
export const runsBunTest = (cmd: string): boolean => BUN_TEST.test(cmd);

/** The record of the JUnit report `file`. Bun writes no report when it ran no test, so a missing report ran 0 tests. */
export const testRecord = (file: string): TestRecord =>
  existsSync(file) ? junitRecord(readFileSync(file, "utf8")) : { ran: 0, passed: 0, failed: 0, skipped: 0, failures: [] };

/**
 * The one loop. Each check waits for the admission first. A check that fails runs once more on the same tree; a pass
 * then is a flake. A check that a clock or a signal ends gives no verdict and does not run again here: the rescue
 * runs it again. The first failure or no verdict ends the loop. Returns why.
 */
async function runAll(t: CheckTask, checks: Check[], exec: CheckExec): Promise<ChecksStop | null> {
  const log = (text: string) => logTo(t.folder, "checks", text);
  for (const check of checks) {
    t.phase(`check ${check.name}`);
    const out = join(t.folder, "check.out");
    writeFileSync(out, "");
    // A `bun test` check writes a JUnit report; each run starts without one, as bun writes none when no test ran.
    const report = junitFile(t.folder, check.name);
    const tests = runsBunTest(check.run);
    const run = tests ? { ...check, run: withJunit(check.run, report) } : check;
    const once = (limit: number) => {
      rmSync(report, { force: true });
      return exec(run, out, limit);
    };
    // The wait for the admission is outside the time limit and outside the check's seconds.
    await admit((line) => t.phase(`check ${check.name}: ${line}`), t.admission);
    t.phase(`check ${check.name}`);
    const limit = checkSeconds();
    const t0 = Date.now();
    let r = await once(limit);
    let first: string | undefined;
    if (r.code !== 0 && !r.timedOut && !r.killed) {
      first = readFileSync(out, "utf8");
      log(`## ${check.name}: exit ${r.code}, run again\n${tail(out, 100)}\n\n`);
      writeFileSync(out, "");
      r = await once(limit);
    }
    const seconds = Math.round((Date.now() - t0) / 1000);
    const lost = r.timedOut || !!r.killed;
    const record = tests && !lost ? testRecord(report) : undefined;
    const none = record?.ran === 0;
    const ok = r.code === 0 && !lost && !none;
    const rerun = first !== undefined && ok;
    const failedFirst = rerun ? failedTests(first!) : [];
    if (rerun) {
      const tests = failedFirst.length ? failedFirst : crashedFiles(first!);
      const row = { repo: t.repo.key, check: check.name, run: /^\d+$/.test(basename(t.folder)) ? jobOfFolder(t.folder) : basename(t.folder), at: new Date().toISOString(), ...(tests.length ? { tests } : {}) };
      recordFlake(row);
    }
    t.record?.({ name: check.name, ok, seconds, ...(rerun ? { rerun: true } : {}), ...(lost ? { noVerdict: true as const } : {}), ...(record ? { tests: record } : {}), ...(failedFirst.length ? { rerunPassed: failedFirst.length } : {}) });
    log(`## ${check.name}: exit ${r.code}${r.timedOut ? " (timed out)" : r.killed ? " (killed)" : ""}${first !== undefined ? " (second run)" : ""}\n${tail(out, 100)}\n\n`);
    if (lost) return { cause: "infra", checkName: check.name, reason: `no verdict: check ${check.name} ${r.timedOut ? "timed out" : "was killed"}`, timedOut: r.timedOut };
    if (r.code !== 0) {
      const why = failureLine(readFileSync(out, "utf8"));
      return { cause: "check", checkName: check.name, reason: why ? `${check.name} failed: ${why}` : `${check.name} failed` };
    }
    if (none) return { cause: "check", checkName: check.name, reason: `ran 0 tests: check ${check.name}` };
  }
  return null;
}

/** The checks that apply to the task, each run by `exec` on a tree the caller set up. */
export const runChecks = (t: CheckTask, exec: CheckExec): Promise<ChecksStop | null> => runAll(t, chosen(t), exec);

/** The env of a check: TZ=UTC, and ALEPH_BROWSER_TESTS=1 runs the slow tests that start Chrome, which a plain local `bun run test` skips. */
const CHECK_ENV = { TZ: "UTC", ALEPH_BROWSER_TESTS: "1" };

/** The env a check runs with: `env` (the caller's, else this process's) with CHECK_ENV, and none of an agent's or a job's variables. */
export const checkEnv = (env: Record<string, string | undefined> = process.env): Record<string, string | undefined> =>
  ({ ...env, ...CHECK_ENV, ALEPH_JOB_ID: undefined, CLAUDECODE: undefined, ANTHROPIC_API_KEY: undefined });

/**
 * Run `cmd` with bash in `cwd`, its output appended to `out`. With a `limit` (seconds) it runs under `timeout`, which puts it
 * in a process group of its own and signals the group. Whether it timed out comes from performance.now(), which only moves
 * forward (Date.now() follows the wall clock, which WSL can set back), not from the exit code, which the command can return itself.
 */
export async function shell(cmd: string, o: { cwd: string; env: Record<string, string | undefined>; out: string; limit?: number; onSpawn?: CheckTask["onSpawn"] }): Promise<{ code: number; timedOut: boolean; killed: boolean }> {
  const fd = openSync(o.out, "a");
  const start = performance.now();
  try {
    const p = Bun.spawn(o.limit ? ["timeout", "--kill-after=30", String(o.limit), "bash", "-c", cmd] : ["bash", "-c", cmd], { cwd: o.cwd, env: o.env, stdin: "ignore", stdout: fd, stderr: fd });
    o.onSpawn?.(p);
    const code = await p.exited;
    return { code, timedOut: o.limit !== undefined && performance.now() - start >= o.limit * 1000, killed: p.signalCode !== null };
  } finally {
    closeSync(fd);
  }
}

/**
 * `fn` in a detached worktree of `repo` at `sha`, in a new temp folder; the worktree goes after, also when `fn` throws.
 * Nothing a worker left in its own worktree runs there.
 */
export async function atCommit<T>(repo: Repo, sha: string, fn: (wt: string) => Promise<T>): Promise<T> {
  const wt = mkdtempSync(join(tmpdir(), `aleph-${repo.key}-`));
  const add = git(repo.path, "worktree", "add", "-q", "--detach", wt, sha);
  if (!add.ok) {
    rmSync(wt, { recursive: true, force: true });
    throw new Error(`worktree add failed: ${add.out}`);
  }
  try {
    return await fn(wt);
  } finally {
    git(repo.path, "worktree", "remove", "--force", wt);
    rmSync(wt, { recursive: true, force: true });
    git(repo.path, "worktree", "prune");
  }
}

/** The repo's setup commands in `wt`, their output appended to `out`: the first that fails, and whether a clock or a signal ended it; or null. */
async function setup(repo: Repo, wt: string, env: Record<string, string | undefined>, out: string, onSpawn?: CheckTask["onSpawn"]): Promise<{ cmd: string; lost: boolean } | null> {
  for (const cmd of repo.setup) {
    appendFileSync(out, `$ ${cmd}\n`);
    const r = await shell(cmd, { cwd: wt, env, out, limit: checkSeconds(), onSpawn });
    if (r.code !== 0 || r.timedOut || r.killed) return { cmd, lost: r.timedOut || r.killed };
  }
  return null;
}

/**
 * The repo's setup and checks on `sha`, in a detached worktree at it, with `env` (checkEnv).
 */
export async function checksAt(t: CheckTask, sha: string, env: Record<string, string | undefined>): Promise<ChecksStop | null> {
  try {
    return await atCommit(t.repo, sha, async (wt) => {
      t.phase("check setup");
      const log = join(t.folder, "check.out");
      writeFileSync(log, "");
      await admit((line) => t.phase(`check setup: ${line}`), t.admission);
      t.phase("check setup");
      const bad = await setup(t.repo, wt, env, log, t.onSpawn);
      if (bad !== null) {
        logTo(t.folder, "checks", `## setup: exit 1\n${tail(log, 100)}\n\n`);
        if (bad.lost) return { cause: "infra", checkName: "setup", reason: `no verdict: setup ${bad.cmd} timed out or was killed` };
        return { cause: "check", checkName: "setup", reason: "setup failed" };
      }
      const exec: CheckExec = (check, out, limit) => shell(check.run, { cwd: wt, env, out, limit, onSpawn: t.onSpawn });
      return runAll(t, chosen(t), exec);
    });
  } catch (e) {
    return { cause: "infra", reason: errText(e) };
  }
}

/** The files in `.hidden` of the tree `wt`. */
const writeHidden = (wt: string, files: Record<string, string>) => {
  mkdirSync(join(wt, ".hidden"), { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(wt, ".hidden", name), text);
};

/** The last `n` lines of `text`, each cut to 200 characters. */
export const lastLines = (text: string, n = 40): string =>
  text.replace(/\s+$/, "").split("\n").slice(-n).map((l) => l.slice(0, 200)).join("\n");

/** `infra` marks a fault of the set-up, not a result of the command. */
export interface Ran { code: number; output: string; infra?: boolean }
/** Runs one command on the commit `sha` of the repo. */
export type Runner = (repo: Repo, sha: string, command: string, hidden?: Record<string, string>) => Promise<Ran>;

/**
 * One command on `sha`, as the checks run: the repo's setup and then the command run in a detached worktree at `sha`,
 * with `hidden` in `.hidden`. A setup that fails or a worktree that git cannot add is `infra`, and the command does
 * not run. The command has `ALEPH_CHECK_TIMEOUT` seconds, as a check has; one that a clock or a signal ends is `infra` too.
 */
export const runOnCommit: Runner = async (repo, sha, command, hidden) => {
  await admit();
  // The logs stay out of the tree, so the command sees only the commit and `.hidden`.
  const logs = mkdtempSync(join(tmpdir(), "aleph-oncommit-"));
  try {
    return await atCommit(repo, sha, async (wt) => {
      const env = checkEnv();
      const log = join(logs, "setup.log");
      if (await setup(repo, wt, env, log) !== null) return { code: 1, output: `setup failed\n${readFileSync(log, "utf8")}`, infra: true };
      if (hidden) writeHidden(wt, hidden);
      const out = join(logs, "out.log");
      writeFileSync(out, "");
      const limit = checkSeconds();
      const r = await shell(command, { cwd: wt, env, out, limit });
      const output = readFileSync(out, "utf8");
      if (r.timedOut || r.killed) return { code: r.code, output: `${output}\n${r.timedOut ? `timed out after ${limit} s` : "killed"}`, infra: true };
      return { code: r.code, output };
    });
  } catch (e) {
    return { code: 1, output: errText(e), infra: true };
  } finally {
    rmSync(logs, { recursive: true, force: true });
  }
};

/** A test file that a branch adds or changes with new cases: its path, its text on the head and the names of its new cases. */
interface NewTests { path: string; text: string; names: string[] }


/** A removed or added line of a diff, not a `---` or `+++` file header. */
const CHANGE = /^([+-])(?!\+\+|--)/;

/** The name that a `test(` or `it(` line opens. */
const CASE = /\b(?:test|it)(?:\.\w+)*\(\s*(["'`])(.+?)\1/;

/**
 * The names of the `test(` and `it(` cases that the added lines of a diff open. A case that a block removes and
 * an added case at the same place pairs with is a rename, so the added one is not a new case. The pairs go in order.
 */
export function newCases(diff: string): string[] {
  const names: string[] = [];
  const gone: string[] = [];
  for (const line of diff.split("\n")) {
    const sign = CHANGE.exec(line)?.[1];
    // A line that is not a change line ends the block: the cases after it are at another place.
    if (!sign) { gone.length = 0; continue; }
    const name = CASE.exec(line)?.[2];
    if (name === undefined) continue;
    if (sign === "-") gone.push(name);
    else if (gone.length) gone.shift();
    else names.push(name);
  }
  return names;
}

/** The names of the `test(` and `it(` cases that the removed lines of a diff close. */
const removedCases = (diff: string): string[] =>
  diff.split("\n").filter((line) => CHANGE.exec(line)?.[1] === "-").flatMap((line) => CASE.exec(line)?.[2] ?? []);

/**
 * The test files that the diff from `base` to `tip` adds or changes with a new case. A case whose name the diff
 * also removes from a test file is a move, not a new case: a split, a rename or a delete of its file.
 */
export function newTests(cwd: string, base: string, tip: string): NewTests[] {
  // A renamed test file lists as its new path alone, so `--no-renames` keeps the old path, which holds the moved cases.
  const files = git(cwd, "diff", "--name-only", "--no-renames", base, tip).out.split("\n").filter((f) => isJsTestFile(f));
  const diffs = files.map((path) => ({ path, diff: git(cwd, "diff", base, tip, "--", path).out }));
  const moved = new Set(diffs.flatMap((d) => removedCases(d.diff)));
  return diffs.flatMap(({ path, diff }) => {
    const names = newCases(diff).filter((n) => !moved.has(n));
    return names.length ? [{ path, text: git(cwd, "show", `${tip}:${path}`).out + "\n", names }] : [];
  });
}

const unxml = (s: string) => s.replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#10;/g, "\n").replace(/&amp;/g, "&");

/** The cases that passed in bun's junit report: a `testcase` with no child element. */
const junitPassed = (xml: string): { file: string; name: string }[] =>
  [...xml.matchAll(/<testcase name="([^"]*)"[^>]*?file="([^"]*)"[^>]*\/>/g)].map((m) => ({ file: unxml(m[2]), name: unxml(m[1]) }));

/** The record of bun's JUnit report `xml`. A `testsuite` inside a file's `testsuite` is a `describe`. */
function junitRecord(xml: string): TestRecord {
  const rec: TestRecord = { ran: 0, passed: 0, failed: 0, skipped: 0, failures: [] };
  const attr = (attrs: string, key: string) => unxml(attrs.match(new RegExp(`\\b${key}="([^"]*)"`))?.[1] ?? "");
  const suites: string[] = [];
  let open: FailedTest & { failed: boolean; skipped: boolean } | null = null;
  const close = (c: NonNullable<typeof open>) => {
    if (c.skipped) return void rec.skipped++;
    rec.ran++;
    if (!c.failed) return void rec.passed++;
    rec.failed++;
    if (rec.failures.length < 20) rec.failures.push({ file: c.file, name: c.name, message: c.message });
  };
  for (const m of xml.matchAll(/<(\/?)(testsuite|testcase|failure|skipped)\b([^>]*?)(\/?)>/g)) {
    const [tag, end, kind, attrs, empty] = m;
    if (kind === "testsuite") {
      if (end) suites.pop();
      else if (!empty) suites.push(attr(attrs, "name"));
    } else if (kind === "testcase") {
      if (end) {
        if (open) close(open);
        open = null;
      } else {
        const c = { file: attr(attrs, "file"), name: [...suites.slice(1), attr(attrs, "name")].join(" > "), message: "", failed: false, skipped: false };
        if (empty) close(c);
        else open = c;
      }
    } else if (open && !end && kind === "skipped") open.skipped = true;
    else if (open && !end && kind === "failure") {
      open.failed = true;
      const body = empty ? attr(attrs, "message") : unxml(xml.slice(m.index + tag.length, xml.indexOf("</failure>", m.index)));
      open.message = body.trimEnd().split("\n").slice(0, 20).join("\n");
    }
  }
  return rec;
}

/** Where the keep-gate's command writes its junit report, in the clone. */
const REPORT = ".keep-gate.xml";

/**
 * The keep-gate: the new cases of `tests` that pass on `base`, as `file > name`, so the reviewer can judge each. The
 * head's text of each file runs against the base code, so a file that is new on the head runs there too; a case whose
 * file does not load on the base did not run there and is not listed. A branch with no new case runs nothing.
 * A step that could not run to a verdict (a fault of the set-up, or tests that fail on the head) is no verdict.
 */
export async function keepGate(repo: Repo, base: string, tip: string, tests: NewTests[], runner: Runner = runOnCommit): Promise<string[] | KeepNoVerdict> {
  if (!tests.length) return [];
  const test = `bun test --reporter=junit --reporter-outfile=${REPORT} ${tests.map((t) => q(`./${t.path}`)).join(" ")}; c=$?; cat ${REPORT}; exit $c`;
  let head = await runner(repo, tip, test);
  if (!head.infra && head.code !== 0) head = await runner(repo, tip, test);
  if (head.infra) return noVerdict("the new tests did not run on the head", head);
  if (head.code !== 0) return noVerdict("the new tests fail on the head", { ...head, output: head.output.split("<?xml")[0] });
  // The head's files reach the base clone in `.hidden`, by index, as runOnCommit gives hidden files.
  const files = Object.fromEntries(tests.map((t, i) => [String(i), t.text]));
  const copy = tests.map((t, i) => `mkdir -p ${q(dirname(t.path))} && cp .hidden/${i} ${q(t.path)}`).join(" && ");
  const onBase = await runner(repo, base, `${copy} && { ${test}; }`, files);
  if (onBase.infra) return noVerdict("the new tests did not run on the base", onBase);
  const fresh = new Set(tests.flatMap((t) => t.names));
  return junitPassed(onBase.output).filter((c) => fresh.has(c.name)).map((c) => `${c.file} > ${c.name}`);
}

/** A keep-gate step whose command could not run to a verdict: neither a list nor a failure of the branch. */
export interface KeepNoVerdict { noVerdict: true; reason: string; log: string }
const noVerdict = (what: string, r: Ran): KeepNoVerdict =>
  ({ noVerdict: true, reason: `no verdict: keep-gate: ${what}`, log: `No verdict: ${what}:\n${lastLines(r.output)}` });

/** The repo's checks, all of them, on `commit` of origin/<main>: null when they pass, else the stop (`infra` when they could not run). For the factory's baseline. */
export async function baselineChecks(repo: Repo, commit: string, logs: string, record?: CheckTask["record"]): Promise<ChecksStop | null> {
  rmSync(logs, { recursive: true, force: true });
  mkdirSync(logs, { recursive: true });
  const all = git(repo.path, "ls-tree", "-r", "--name-only", commit).out.split("\n").filter(Boolean);
  const stop = await checksAt({ folder: logs, repo, changed: all, phase: () => {}, record }, commit, checkEnv());
  return !stop || stop.cause === "check" ? stop : { ...stop, cause: "infra" };
}
