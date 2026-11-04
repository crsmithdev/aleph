/**
 * The check runner: one loop for a run's checks, in a git worktree.
 * It owns the choice of checks, the admission, the time limit, the one rerun, the
 * log and the flake record. The caller gives what runs one check.
 */
import { appendFileSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { recordFlake } from "./factory-status.ts";
import { admit, type Admission, type Check, type CheckResult, type FailedTest, type Repo, type TestRecord } from "./ledger.ts";
import type { Stated } from "./outcome.ts";
import { checkSeconds } from "./settings.ts";
import { q } from "./agent-call.ts";
import { git } from "./git.ts";
import { runFile } from "./run-files.ts";
import type { Plan } from "./keep-earn.ts";

/**
 * Why the checks stopped: the cause and check name that the run states, the sentence for `reason`, and whether a clock
 * ended the check. `null` is a pass. A check that a clock or a signal ended gives no verdict: its cause is `infra`.
 */
export type ChecksStop = Stated & { reason: string; timedOut?: boolean };

/** The fields of a run that a stop sets: the clock flag stays out of the run. */
export const stopFields = ({ timedOut: _, ...fields }: ChecksStop): Stated & { reason: string } => fields;

/** One run of checks. `folder` gets checks.log. `record` gets each check that ran. `admission` is for tests. */
export interface CheckTask { folder: string; repo: Repo; changed: string[]; phase: (p: string) => void; onSpawn?: (p: ReturnType<typeof Bun.spawn>) => void; record?: (c: CheckResult) => void; admission?: Admission }

/**
 * Runs one check with its output appended to `out`. `timedOut` comes from a clock: a command can return 124 by itself.
 * `killed`: a signal ended the process.
 */
export type CheckExec = (check: Check, out: string, limit: number) => Promise<{ code: number; timedOut: boolean; killed?: boolean }>;

/** The names on bun's `(fail)` lines, each one once: its summary repeats them. */
const failedTests = (log: string): string[] => [...new Set(log.matchAll(/^\(fail\) (.+?)(?: \[[\d.]+m?s\])?$/gm).map((m) => m[1]))];

const tail = (file: string, n: number) => existsSync(file) ? readFileSync(file, "utf8").trimEnd().split("\n").slice(-n).join("\n") : "";

/** The repo's checks with no `when`, and those whose globs match a changed file. */
const chosen = (t: CheckTask): Check[] => t.repo.checks.filter((c) => !c.when || t.changed.some((f) => c.when!.some((g) => new Bun.Glob(g).match(f))));

/** A command that runs `bun test`, directly or as the package's `test` script. */
const BUN_TEST = /^bun (?:run )?test\b/;

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
  const log = (text: string) => appendFileSync(runFile(t.folder, "checks.log"), text);
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
    if (rerun) {
      const tests = failedTests(first!);
      const row = { repo: t.repo.key, check: check.name, run: basename(t.folder), at: new Date().toISOString(), ...(tests.length ? { tests } : {}) };
      if (!await recordFlake(row)) log(`## ${check.name}: flake not recorded, lock busy\n\n`);
    }
    t.record?.({ name: check.name, ok, seconds, ...(rerun ? { rerun: true } : {}), ...(lost ? { noVerdict: true as const } : {}), ...(record ? { tests: record } : {}) });
    log(`## ${check.name}: exit ${r.code}${r.timedOut ? " (timed out)" : r.killed ? " (killed)" : ""}${first !== undefined ? " (second run)" : ""}\n${tail(out, 100)}\n\n`);
    if (lost) return { cause: "infra", checkName: check.name, reason: `no verdict: check ${check.name} ${r.timedOut ? "timed out" : "was killed"}`, timedOut: r.timedOut };
    if (r.code !== 0) return { cause: "check", checkName: check.name, reason: `${check.name} failed` };
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
  ({ ...env, ...CHECK_ENV, ALEPH_JOB_ID: undefined, ALEPH_JOB_RUN: undefined, CLAUDECODE: undefined, ANTHROPIC_API_KEY: undefined });

/**
 * Run `cmd` with bash in `cwd`, its output appended to `out`, under `timeout`, which puts it in a process group of its
 * own and signals the group. Whether it timed out comes from this clock, not from the exit code.
 */
export async function shell(cmd: string, o: { cwd: string; env: Record<string, string | undefined>; out: string; limit: number; onSpawn?: CheckTask["onSpawn"] }): Promise<{ code: number; timedOut: boolean; killed: boolean }> {
  const fd = openSync(o.out, "a");
  const start = performance.now();
  try {
    const p = Bun.spawn(["timeout", "--kill-after=30", String(o.limit), "bash", "-c", cmd], { cwd: o.cwd, env: o.env, stdin: "ignore", stdout: fd, stderr: fd });
    o.onSpawn?.(p);
    const code = await p.exited;
    return { code, timedOut: performance.now() - start >= o.limit * 1000, killed: p.signalCode !== null };
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
        appendFileSync(runFile(t.folder, "checks.log"), `## setup: exit 1\n${tail(log, 100)}\n\n`);
        if (bad.lost) return { cause: "infra", checkName: "setup", reason: `no verdict: setup ${bad.cmd} timed out or was killed` };
        return { cause: "check", checkName: "setup", reason: "setup failed" };
      }
      const exec: CheckExec = (check, out, limit) => shell(check.run, { cwd: wt, env, out, limit, onSpawn: t.onSpawn });
      return runAll(t, chosen(t), exec);
    });
  } catch (e) {
    return { cause: "infra", reason: e instanceof Error ? e.message : String(e) };
  }
}

/** The files in `.hidden` of the tree `wt`. */
const writeHidden = (wt: string, files: Record<string, string>) => {
  mkdirSync(join(wt, ".hidden"), { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(wt, ".hidden", name), text);
};

/** The last `n` lines of `text`, on one line (an issue note is one line), each cut to 200 characters. */
export const lastLines = (text: string, n = 40): string =>
  text.replace(/\s+$/, "").split("\n").slice(-n).map((l) => l.slice(0, 200)).join(" ⏎ ");

/** `infra` marks a fault of the set-up, not a result of the command. */
export interface Ran { code: number; output: string; infra?: boolean }
/** Runs one command on the commit `sha` of the repo. */
export type Runner = (repo: Repo, sha: string, command: string, hidden?: Record<string, string>) => Promise<Ran>;

/**
 * One command on `sha`, as the checks run: the repo's setup and then the command run in a detached worktree at `sha`,
 * with `hidden` in `.hidden`. A setup that fails or a worktree that git cannot add is `infra`, and the command does
 * not run. The command has 1200 seconds.
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
      const r = await shell(command, { cwd: wt, env, out, limit: 1200 });
      return { code: r.code, output: readFileSync(out, "utf8") };
    });
  } catch (e) {
    return { code: 1, output: e instanceof Error ? e.message : String(e), infra: true };
  } finally {
    rmSync(logs, { recursive: true, force: true });
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

/** The cases in bun's junit report that ran, passed or failed, as `file > name`. */
const junitRan = (xml: string): Set<string> =>
  new Set([...xml.matchAll(/<testcase name="([^"]*)"[^>]*?file="([^"]*)"/g)].map((m) => `${unxml(m[2])} > ${unxml(m[1])}`));

/** The record of bun's JUnit report `xml`. A `testsuite` inside a file's `testsuite` is a `describe`. */
export function junitRecord(xml: string): TestRecord {
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

/** A source file that a branch changes: its path, the changed line numbers on the head and its text on the head. */
export interface Source { path: string; lines: number[]; text: string }

const SOURCE = /\.[cm]?[jt]sx?$/;

/** The line numbers on the new side of a `git diff -U0`. */
export const addedLines = (diff: string): number[] =>
  [...diff.matchAll(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/gm)].flatMap((m) => Array.from({ length: m[2] === undefined ? 1 : Number(m[2]) }, (_, i) => Number(m[1]) + i));

/** The JavaScript and TypeScript files, not test files, that the diff from `base` to `tip` adds or changes. */
export function changedSources(cwd: string, base: string, tip: string): Source[] {
  const files = git(cwd, "diff", "--name-only", "--diff-filter=AM", base, tip).out.split("\n").filter((f) => SOURCE.test(f) && !TEST_FILE.test(f));
  return files.flatMap((path) => {
    const lines = addedLines(git(cwd, "diff", "-U0", base, tip, "--", path).out);
    return lines.length ? [{ path, lines, text: git(cwd, "show", `${tip}:${path}`).out }] : [];
  });
}

/** The mutation operators, in order: a comparison, a logical operator, a boolean, a condition, a constant. */
const OPS: [RegExp, (m: string) => string][] = [
  [/===|!==/, (m) => m === "===" ? "!==" : "==="],
  [/ (?:<=|>=|<|>) /, (m) => ({ " <= ": " > ", " >= ": " < ", " < ": " >= ", " > ": " <= " })[m]!],
  [/&&|\|\|/, (m) => m === "&&" ? "||" : "&&"],
  [/\b(?:true|false)\b/, (m) => m === "true" ? "false" : "true"],
  [/\bif \(/, () => "if (!"],
  [/\b\d+\b/, (m) => String(Number(m) + 1)],
];
const CALL = /^\s*(?:await\s+)?[\w$.]+\(.*\);?\s*$/;

/** One mutant of a source line, or null: the first operator that applies, else the line empty when it is a call statement. */
export function mutate(line: string): string | null {
  const t = line.trim();
  if (!t || /^(?:\/\/|\/?\*|import\b|export\b.*\bfrom\b)/.test(t)) return null;
  for (const [re, op] of OPS) {
    const m = re.exec(line);
    if (m) return line.slice(0, m.index) + op(m[0]) + line.slice(m.index + m[0].length);
  }
  return CALL.test(line) ? "" : null;
}

/** At most `max` mutants of the changed lines, one a line, spread evenly over them. */
export function mutants(sources: Source[], max = 10): { path: string; line: number; text: string }[] {
  const all = sources.flatMap((s) => {
    const text = s.text.split("\n");
    return s.lines.flatMap((line) => {
      const m = text[line - 1] === undefined ? null : mutate(text[line - 1]);
      return m === null ? [] : [{ path: s.path, line, text: m }];
    });
  });
  return all.length <= max ? all : Array.from({ length: max }, (_, i) => all[Math.floor((i * all.length) / max)]);
}

/**
 * The keep-gate: each new case of `tests` must pass on `tip` and fail on `base`. The head's text of each file
 * runs against the base code, so a file that is new on the head runs there too. A case that did not run on the
 * base (its file did not load there) must then earn its keep on `sources`, the changed source files: see earnKeep.
 * Returns the reason and the lines for checks.log, or null. A fault of the set-up is not a failure.
 */
export async function keepGate(repo: Repo, base: string, tip: string, tests: NewTests[], sources: Source[], runner: Runner = runOnCommit): Promise<{ reason: string; log: string } | null> {
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
  if (passed.length) return {
    reason: `keep-gate: ${passed.length} new test${passed.length > 1 ? "s pass" : " passes"} on the base commit: ${passed.join("; ")}`,
    log: `These new tests pass on the base commit ${base.slice(0, 10)}, without the branch's change, so they do not test it:\n${passed.map((p) => `- ${p}`).join("\n")}\nMake each one fail without the change, or remove it: a committed test needs a lasting reason.`,
  };
  const ran = junitRan(onBase.output);
  const unran = tests.flatMap((t) => t.names.filter((name) => !ran.has(`${t.path} > ${name}`)).map((name) => ({ file: t.path, name })));
  return earnKeep(repo, tip, tests, unran, sources, runner);
}

let earnScript: string | undefined;

/**
 * The keep-gate's second stage. A case that fails on the base because its file does not load there shows only
 * that the file needs the change: it must also cover a changed line of `sources` that the other cases of the test
 * files do not cover, or fail on a mutant of a changed line. keep-earn.ts runs it on `tip`, with at most 10 mutants.
 * A branch with no changed source line has nothing to earn against, so it passes.
 */
async function earnKeep(repo: Repo, tip: string, tests: NewTests[], cases: Plan["cases"], sources: Source[], runner: Runner): Promise<{ reason: string; log: string } | null> {
  if (!cases.length || !sources.length) return null;
  const plan: Plan = { cases, files: tests.map((t) => t.path), changed: Object.fromEntries(sources.map((s) => [s.path, s.lines])), mutants: mutants(sources) };
  earnScript ??= readFileSync(join(import.meta.dir, "keep-earn.ts"), "utf8");
  const r = await runner(repo, tip, "bun .hidden/earn.ts .hidden/plan.json", { "earn.ts": earnScript, "plan.json": JSON.stringify(plan) });
  const line = r.infra ? undefined : r.output.match(/^KEEP-EARN (.*)$/gm)?.pop();
  if (!line) return null;
  const { unearned, mutants: n } = JSON.parse(line.slice("KEEP-EARN ".length)) as { unearned: string[]; mutants: number };
  if (!unearned.length) return null;
  const one = unearned.length === 1;
  if (!plan.mutants.length) return {
    reason: `keep-gate: ${unearned.length} new test${one ? " covers" : "s cover"} no changed line: ${unearned.join("; ")}`,
    log: `These new tests fail on the base commit only because their file does not load there. The changed lines have no mutant, so a new test must run a changed line, and on the head these run none:\n${unearned.map((u) => `- ${u}`).join("\n")}\nMake each one check what the change does, or remove it: a committed test needs a lasting reason.`,
  };
  return {
    reason: `keep-gate: ${unearned.length} new test${one ? " adds" : "s add"} no coverage of the changed lines and kill${one ? "s" : ""} no mutant: ${unearned.join("; ")}`,
    log: `These new tests fail on the base commit only because their file does not load there. On the head they cover no changed line that the other cases of their files do not cover, and they pass on each of the ${n} mutant${n === 1 ? "" : "s"} of the changed lines:\n${unearned.map((u) => `- ${u}`).join("\n")}\nMake each one check what the change does, or remove it: a committed test needs a lasting reason.`,
  };
}

/** The repo's checks, all of them, on `commit` of origin/<main>: null when they pass, else the stop (`infra` when they could not run). For the factory's baseline. */
export async function baselineChecks(repo: Repo, commit: string, logs: string): Promise<ChecksStop | null> {
  rmSync(logs, { recursive: true, force: true });
  mkdirSync(logs, { recursive: true });
  const all = git(repo.path, "ls-tree", "-r", "--name-only", commit).out.split("\n").filter(Boolean);
  const stop = await checksAt({ folder: logs, repo, changed: all, phase: () => {} }, commit, checkEnv());
  return !stop || stop.cause === "check" ? stop : { ...stop, cause: "infra" };
}
