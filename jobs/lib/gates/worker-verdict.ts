/**
 * The worker verdict: the policy for a branch after its worker. Two stations run on it. Verify: the checks,
 * the keep-gate and the Oracle. An Oracle with no verdict stops the run as `infra`, never as a pass. Then the reviewer (a reviewer with
 * no verdict runs once more), which gets the keep-gate's finding: the new tests that pass on the base, or that it did not run. A reviewer's pass on a diff that changes a security path or a held path waits
 * for Chris with a held-path Ask. A failure of a check, the Oracle or the reviewer goes back to
 * the worker as a fix round while rounds are left. The ports run each step: `branchPorts` gives the git and worktree
 * ones. `workerVerdict` does no IO.
 */
import { plainAsk, type AskReason } from "../asks/ask.ts";
import { checkEnv as checksEnv, checksAt, junitFile, keepGate, lastLines, newTests, runOnCommit, runsBunTest, stopFields, testRecord, withJunit, type ChecksStop, type Ran, type Runner } from "./checks.ts";
import { buildChecks } from "./related.ts";
import { changedPaths, heldRule, securityChange, testFindings } from "./gate.ts";
import { git } from "../../../lib/git.ts";
import * as jobRecord from "../records/record.ts";
import { jobOfFolder, jobSpecFile, logTo } from "../records/run-files.ts";
import type { CheckResult, Entry, FailedTest, Repo, Run, TestRecord } from "../records/ledger.ts";
import { oracleCommands, oraclePaths, outsideSurface } from "../../../lib/issue-spec.ts";
import { FOREGROUND, skillSection } from "../roles/role-skill.ts";
import { existsSync, readFileSync, rmSync } from "node:fs";

/** The fields of the run that a verdict sets. */
export type Outcome = Pick<Run, "state" | "ask" | "reason" | "cause" | "checkName" | "limit" | "question" | "say" | "commit" | "conflicts" | "checkItem" | "review" | "failed" | "round" | "cost" | "defaults" | "followups" | "alreadyMet" | "stat" | "checkedBase" | "checkedTip">;
export interface Verdict { outcome: Outcome; code: number }

/** One reviewer call: the reason to hold, or null on a pass. `none` is a call that gave no verdict, `credit` its API credit error line when the API refused it, `model` the reviewer model, `session` the session of this call. */
export interface ReviewCall { reason: string | null; cost?: number; none?: boolean; credit?: string; model?: string; session?: string }

/** What runs each step on the branch. */
export interface VerdictPorts {
  /** The repo's checks: why they stopped, or null, and the last check of the run that failed. */
  checks(): Promise<{ stop: ChecksStop | null; failed?: string }>;
  /** Runs the failed tests of `check` on the base and marks each that fails there too: whether every one does. */
  failsOnMain(check: string): Promise<boolean>;
  /** The Ask question when `check` failed with the same failing head-only tests on the run before, else null. */
  repeatedFailure(check: string): { question: string } | null;
  /** The keep-gate: the new tests of the branch that pass on its base, as `file > name`. */
  keepGate(): Promise<string[] | NoVerdict>;
  /** The diff stat, for an Ask. */
  stat(): string;
  /** The security path the diff changes, else null. */
  security(): string | null;
  /** The held rule the diff breaks, else null. */
  heldRule(): string | null;
  /** The reason of the first Oracle command that fails twice, else null. */
  oracle(): Promise<string | NoVerdict | null>;
  /** The reviewer call, given the keep-gate's finding: the new tests that pass on the base, or null when it did not run. */
  review(keep: string[] | null): Promise<ReviewCall>;
}

/** A step that could not run to a verdict (its setup failed, a clock or a signal ended it): neither a pass nor a failure. */
export interface NoVerdict { noVerdict: string }

/** The branch facts the policy reads besides the ports. */
export interface Branch {
  /** The job's runs that were sent back before this one, for what they failed. */
  earlier?: Run[];
  /** The job's fix rounds so far: `rounds` of its job record. Absent for a recheck, which has no fix rounds. */
  done?: number;
  /** The most fix rounds a job gets. */
  rounds: number;
  /** What the run states already, such as its cost. */
  facts: Partial<Outcome>;
  /** The base and the tip that the checks ran on. The run states them once the checks pass. */
  checked: Pick<Outcome, "checkedBase" | "checkedTip">;
}

/** A verdict that waits for Chris: the state `waiting` and the Ask. */
export const waiting = (reason: AskReason, question: string, why: string[] = []): Pick<Outcome, "state" | "ask"> =>
  ({ state: "waiting", ask: plainAsk(reason, question, why.filter(Boolean)) });

/** A stop: `returned` when it goes back to the worker (`failed` is set), else `failed`. */
const stopped = (why: ChecksStop, extra: Partial<Outcome> = {}): Verdict =>
  ({ outcome: { state: extra.failed ? "returned" : "failed", ...stopFields(why), ...extra }, code: 1 });

/**
 * The check that the checks' stop sends back to the worker, or null. `check` is the last check of the run that failed.
 * A time-out does not go back, and neither does a stop that is not that check's own failure.
 */
function backCheck(stop: ChecksStop, check: string | undefined): string | null {
  if (!check || stop.timedOut) return null;
  return stop.cause === "check" && stop.checkName === check ? check : null;
}

/**
 * What a failed check adds to the stopped run: `failed` and `round`, which send it back, while fewer than `cap`
 * rounds are done; after that, a reason that counts the rounds. A run with no fix rounds (a recheck) gets nothing.
 */
function checkBack(done: number | undefined, check: string, reason: string, cap: number): Pick<Run, "failed" | "round"> | Pick<Run, "reason"> | Record<string, never> {
  if (done === undefined) return {};
  if (done < cap) return { failed: check, round: done };
  return cap > 0 ? { reason: `${reason} after ${done} fix rounds` } : {};
}

/** "once", "twice", "3 times". */
const times = (n: number) => n === 1 ? "once" : n === 2 ? "twice" : `${n} times`;
/** The reason of a hold after the reviewer sent the run back `n` times; `SENT_BACK` reads it: the count word, then `why`. */
const sentBack = (n: number, why: string) => `the reviewer sent it back ${times(n)}: ${why}`;
export const SENT_BACK = /^the reviewer sent it back (once|twice|\d+ times):\s*(.*)$/s;

/**
 * What follows a reviewer hold: a fix round (`round`) while fewer than `cap` rounds are done; else the run
 * waits for Chris with `reason`, which says how often the reviewer sent it back when it did.
 */
function reviewHold(done: number | undefined, earlier: Run[] | undefined, reason: string, cap: number): { round: number } | { reason: string } {
  if (done !== undefined && done < cap) return { round: done };
  const back = earlier?.filter((r) => r.failed === "review").length ?? 0;
  return { reason: back ? sentBack(back, reason.replace(/^reviewer:\s*/, "")) : reason };
}

/** The verdict on a branch that its worker or a recheck left. */
export async function workerVerdict(b: Branch, p: VerdictPorts): Promise<Verdict> {
  const { earlier, done, rounds } = b;
  const facts = { ...b.facts };
  const { stop, failed } = await p.checks();
  if (stop) {
    const check = backCheck(stop, failed);
    if (!check) return stopped(stop, facts);
    // A failure that main has too is not the worker's to fix, so no fix round starts.
    if (await p.failsOnMain(check)) return stopped({ ...stop, reason: `${stop.reason} (each failed test fails on main too)` }, facts);
    const same = done !== undefined && done < rounds ? p.repeatedFailure(check) : null;
    if (same) return { outcome: { ...waiting("question", same.question), question: same.question, ...stopFields(stop), ...facts }, code: 0 };
    return stopped(stop, { ...facts, ...checkBack(done, check, stop.reason, rounds) });
  }
  const kept = await p.keepGate();
  const keep = Array.isArray(kept) ? kept : null;
  // An Oracle with no verdict fails as `infra`: not a fix round; the rescue checks the branch again once, then asks.
  Object.assign(facts, b.checked);
  const bad = await p.oracle();
  if (typeof bad === "object" && bad) return stopped({ cause: "infra", checkName: "oracle", reason: bad.noVerdict }, facts);
  if (bad) return stopped({ cause: "check", checkName: "oracle", reason: bad }, { ...facts, ...checkBack(done, "oracle", bad, rounds) });

  const stat = p.stat();
  let ms = 0, spent: number | undefined;
  const sessions: string[] = [];
  const call = async () => {
    const t = Date.now();
    const rv = await p.review(keep);
    ms += Date.now() - t;
    if (rv.session) sessions.push(rv.session);
    // The reviewer is a job of its own: its cost is its job's, not the build's.
    if (rv.cost !== undefined) spent = (spent ?? 0) + rv.cost;
    return rv;
  };
  let rv = await call();
  // A second miss is the reviewer's, not the worker's: it goes to Chris whatever fix rounds are left, since a fix round cannot cure it.
  if (rv.none && !rv.credit) rv = await call();
  // A call the API refused for credit did no work: the run stops as failed with the credit cause, as a worker's does, so it waits for credit and counts no run cap.
  if (rv.credit) return { outcome: { state: "failed", cause: "credit", reason: rv.credit, ...facts }, code: 1 };
  const review = (call: "passed" | "returned" | "waiting" | "failed") => ({ call, ...(rv.reason && { reason: rv.reason }), ...(rv.model && { model: rv.model }), ...(spent !== undefined && { cost: spent }), ...(sessions.length && { sessions }), seconds: Math.round(ms / 1000) });
  if (!rv.reason) {
    // A reviewed diff that changes a security path or a held path waits for Chris.
    const security = p.security();
    const rule = security ? `held path ${security}` : p.heldRule();
    if (rule) return { outcome: { ...waiting("held-path", rule, [stat]), reason: rule, stat, review: review("passed"), ...facts }, code: 0 };
    return { outcome: { state: "passed", review: review("passed"), ...facts }, code: 0 };
  }
  if (rv.none) return { outcome: { ...waiting("review-held", rv.reason, [stat]), cause: "review", reason: rv.reason, stat, review: review("failed"), ...facts }, code: 0 };
  const hold = reviewHold(done, earlier, rv.reason, rounds);
  if ("round" in hold) return { outcome: { state: "returned", cause: "review", reason: rv.reason, stat, review: review("returned"), ...facts, failed: "review", round: hold.round }, code: 1 };
  return { outcome: { ...waiting("review-held", hold.reason, [stat]), cause: "review", reason: hold.reason, stat, review: review("waiting"), ...facts }, code: 0 };
}

/** Why a held run cannot land yet: the reviewer has given no verdict; null once it has (`review` is its review.json). */
export function missingVerdict(review: string | undefined): string | null {
  return review && JSON.parse(review).verdict ? null : "the reviewer has no verdict yet";
}

/** A recorder that starts the run's `checks` over and adds each check that ran. */
export function recorder(folder: string): (c: CheckResult) => void {
  jobRecord.patchRun(jobOfFolder(folder), { checks: [] });
  return (c) => { jobRecord.appendCheck(jobOfFolder(folder), c); };
}

const REVIEW = `You are the reviewer of job \`%NAME%\`. The working directory is a clone of the
branch the worker made for the issue below; read the code there as needed.
Judge whether the diff does what the issue asks, whether the tests cover it, and
whether it breaks anything. Do not change tracked files. The factory ran the checks that this change reaches
on this branch, and they passed. Do not run the full test suite or repeat-run loops: you have a time
box, and a long command ends it with no verdict. Run only a few targeted commands
of your own, each ending in well under a minute. ${FOREGROUND}

Check the whole branch before you give a verdict; do not stop at the first defect.
Check each Oracle clause of the spec and each requirement in the Goal section.
The Oracle is a check stored on the issue, so the issue does not need a new committed test. A committed test
needs a lasting reason: a bug fix gets one regression test at the lowest layer that shows the bug; new lasting
behaviour of a module gets a row in that module's existing test file; a CLI end-to-end test is only for new
command wiring. The keep-gate ran each new test on the base commit, and the section below lists the ones that pass there. Hold such a test
when the issue is a bug fix or a behaviour change, since it does not test the change. Accept it for a refactor, a moved test or a test-only change.
Hold a committed test that has none of these reasons, and one at the wrong layer or in the wrong file.
The "summary" is the verdict in one sentence and the passes as a count, such as \`7 of 9 passed\`, in at most 80 words.
Each failure goes in "failures": its clause, named by a few words without its reason, and what was observed. Do not
list a pass. Say each thing once. The list of failures has no cap: list every failure, not only the first. The verdict is "pass" when nothing
failed, else "hold".

A minor finding does not hold the build. It is a true finding that still meets every Goal clause and Oracle line and
breaks no caller, such as a scope or wording nit. Pass the build and give it in "followups" (recorded as a suggestion) (at most 3), each with a \`path:line\`
location and a score, as a worker's follow-up has. Hold for anything else: a failed clause, a broken caller, or a doubt.`;

const TESTS = `The diff changes tests. Judge each finding below against the issue: hold only
when the issue does not call for the change, or the change weakens a check the
issue keeps. A change the issue calls for passes.`;

const OUTSIDE = `The branch changes these files, and the Edit surface of the issue names none of them. Judge each one
against the issue: hold only when the issue does not need the change. A change the issue needs passes.`;

const MERGE = `This run only merged origin/main into the branch, after a land conflicted. The diff below is the merge
commit against its first parent, the branch before the merge. Judge only the merge: each conflict must keep both the
change on main and this job's change. The job's own work was reviewed in an earlier run.`;

/**
 * The reviewer's prompt: the instructions, the test findings if any, the files outside the Edit surface if any,
 * the issue and the diff. A merge run's diff is the merge commit's only (`merge`).
 */
export function reviewPrompt(name: string, spec: string, diff: string, findings: string[], o: { outside?: string[]; merge?: boolean; keep?: string[] | null } = {}): string {
  const tests = findings.length ? `\n\n## Test changes\n\n${TESTS}\n\n${findings.map((f) => `- The diff ${f}`).join("\n")}` : "";
  const outside = o.outside?.length ? `\n\n## Changes outside the Edit surface\n\n${OUTSIDE}\n\n${o.outside.map((f) => `- ${f}`).join("\n")}` : "";
  const kept = o.keep === undefined ? "" : `\n\n## Keep-gate\n\n${o.keep === null ? "The keep-gate was not run." : o.keep.length ? `These new tests pass on the base commit:\n\n${o.keep.map((t) => `- ${t}`).join("\n")}` : "No new test passes on the base commit."}`;
  const head = o.merge ? `## The merge commit's conflict resolution\n\n${MERGE}` : "## Diff from the merge base";
  return `${REVIEW.replace("%NAME%", name)}\n\nJudge the branch by the method below.\n\n${skillSection("code-review", "Review method")}${tests}${outside}${kept}\n\n## Issue\n\n${spec}\n\n${head}\n\n${diff}\n`;
}

/** One reviewer call on the branch: `review` of roles/unit.ts. */
export type Review = (folder: string, run: Run, repo: Repo, base: string, branch: string, findings: string[], changed: string[], env: Record<string, string | undefined>, keep: string[] | null) => Promise<ReviewCall>;

/**
 * The ports of the worker verdict for `branch` of a run, based on `base`. The checks and the reviewer each run in a
 * detached worktree at the branch's tip. `earlier` is the job's runs that were sent back, `runner` runs the Oracle's commands, `review` is the
 * reviewer call, `onSpawn` gets each check's process so the unit's stop signal reaches it, and `env` is the unit's env.
 */
export function branchPorts(folder: string, run: Run, repo: Repo, base: string, branch: string, o: { changed: string[]; earlier?: Entry[]; runner?: Runner; review: Review; onSpawn?: (p: ReturnType<typeof Bun.spawn>) => void; env?: Record<string, string | undefined> }): VerdictPorts {
  const phase = (p: string) => jobRecord.patchRun(jobOfFolder(folder), { phase: p });
  // Verify is one station: its checks, keep-gate and Oracle all show as the phase `verify`.
  const verify = () => phase("verify");
  const tip = `refs/heads/${branch}`;
  const env = o.env ?? process.env;
  let findings: string[] | undefined;
  return {
    checks: async () => {
      // A build runs only the tests its change reaches; the full suite runs on its own timer (`aleph suite`).
      const build = buildChecks(repo, tip, o.changed);
      const rec = recorder(folder);
      const record = (c: CheckResult) => rec(build.tests.has(c.name) ? { ...c, files: build.tests.get(c.name)!.length } : c);
      for (const [name, files] of build.tests) {
        logTo(folder, "checks", `## ${name}: ${files.length} test file${files.length === 1 ? "" : "s"} that the change reaches\n${files.join("\n")}\n\n`);
        if (!files.length) record({ name, ok: true, seconds: 0 });
      }
      const sha = git(repo.path, "rev-parse", tip).out;
      const stop = await checksAt({ folder, repo: { ...repo, checks: build.checks }, changed: o.changed, phase: verify, record, onSpawn: o.onSpawn }, sha, checksEnv(env));
      return { stop, failed: jobRecord.getRun(jobOfFolder(folder))?.checks?.findLast((c) => !c.ok)?.name };
    },
    failsOnMain: async (check) => {
      const id = jobOfFolder(folder);
      const checks = jobRecord.getRun(id)?.checks ?? [];
      const at = checks.findLastIndex((c) => c.name === check);
      const failures = checks[at]?.tests?.failures ?? [];
      if (!failures.length) return false;
      const report = junitFile(folder, `${check}-base`);
      const command = `bun test ${[...new Set(failures.map((f) => `'./${f.file}'`))].join(" ")}`;
      const r = await (o.runner ?? runOnCommit)(repo, base, withJunit(command, report));
      logTo(folder, "checks", `## ${check} on the base: exit ${r.code}\n$ ${command}\n${lastLines(r.output)}\n\n`);
      // A base run with no verdict marks nothing: each test stays the head's alone.
      if (r.infra) return false;
      const failing = new Set(testRecord(report).failures.map((f) => `${f.file} > ${f.name}`));
      const marked = failures.map((f) => failing.has(`${f.file} > ${f.name}`) ? { ...f, onMain: true as const } : f);
      jobRecord.patchRun(id, { checks: checks.with(at, { ...checks[at], tests: { ...checks[at].tests!, failures: marked } }) });
      // The record keeps at most 20 failures, so a check with more cannot show that each fails on main.
      return marked.length === checks[at].tests!.failed && marked.every((f) => f.onMain);
    },
    repeatedFailure: (check) => repeatedFailure(folder, check, o.earlier ?? []),
    keepGate: async () => {
      verify();
      const head = git(repo.path, "rev-parse", tip).out;
      const start = performance.now();
      const kept = await keepGate(repo, base, head, newTests(repo.path, base, head), o.runner ?? runOnCommit);
      if (Array.isArray(kept)) {
        if (kept.length) logTo(folder, "checks", `## keep-gate: new tests that pass on the base commit\n${kept.map((t) => `- ${t}`).join("\n")}\n\n`);
        return kept;
      }
      logTo(folder, "checks", `## keep-gate: no verdict\n${kept.log}\n\n`);
      // No verdict is a result on the run beside the checks, so the job page shows it.
      jobRecord.appendCheck(jobOfFolder(folder), { name: "keep-gate", ok: false, seconds: Math.round((performance.now() - start) / 1000), noVerdict: true });
      return { noVerdict: kept.reason };
    },
    stat: () => git(repo.path, "diff", "--stat", base, tip).out,
    security: () => securityChange(repo.path, base, tip),
    heldRule: () => heldRule(repo.path, repo.held, base, tip),
    oracle: () => oracleFailure(folder, run, repo, base, branch, o.runner ?? runOnCommit, verify),
    review: (keep) => {
      phase("review");
      findings ??= testFindings(repo.path, base, tip);
      return o.review(folder, run, repo, base, branch, findings, o.changed, env, keep);
    },
  };
}

/**
 * The issue's Oracle commands, run on the branch in a detached worktree, the last step of Verify.
 * Before them, a branch that edits a file the Oracle names, on the base and outside the Edit surface, fails with an `oracle-pin` check.
 * A command the run's checks already ran is skipped; one that fails runs once more.
 * Returns the reason of the first that fails twice, or null. A command that could not run to a verdict (`infra`: its
 * setup failed, or a clock or a signal ended it) stops the Oracle with no verdict: it is neither a pass nor a failure.
 * When a command ran, the run's `checks` gets one result `oracle` beside the repo's checks; checks.log gets each command's section.
 */
async function oracleFailure(folder: string, run: Run, repo: Repo, base: string, branch: string, runner: Runner, phase: () => void): Promise<string | NoVerdict | null> {
  const specFile = jobSpecFile(run);
  if (!existsSync(specFile)) return null;
  const spec = readFileSync(specFile, "utf8");
  const ran = new Set((jobRecord.getRun(jobOfFolder(folder))?.checks ?? []).map((c) => c.name));
  const done = new Set(repo.checks.filter((c) => ran.has(c.name)).map((c) => c.run.trim()));
  const tip = git(repo.path, "rev-parse", `refs/heads/${branch}`).out;
  const start = performance.now();
  let any = false, rerun = false;
  // The `bun test` commands' records, summed.
  let tests: TestRecord | undefined;
  const result = (ok: boolean, none = false) => {
    if (!any && !none) return;
    jobRecord.appendCheck(jobOfFolder(folder), { name: "oracle", ok, seconds: Math.round((performance.now() - start) / 1000), ...(rerun ? { rerun } : {}), ...(none ? { noVerdict: true as const } : {}), ...(tests ? { tests } : {}) });
  };
  const noVerdict = (command: string, r: Ran): NoVerdict => {
    logTo(folder, "checks", `## oracle: no verdict\n$ ${command}\n${lastLines(r.output, 80)}\n\n`);
    result(false, true);
    return { noVerdict: `no verdict: oracle: ${command}` };
  };
  // The worker must not edit a file its Oracle runs that is on the base and outside the Edit surface; a rename edits its old path.
  const pinned = outsideSurface(spec, changedPaths(repo.path, base, tip))
    .filter((f) => oraclePaths(spec).includes(f) && git(repo.path, "cat-file", "-e", `${base}:${f}`).ok);
  if (pinned.length) {
    jobRecord.appendCheck(jobOfFolder(folder), { name: "oracle-pin", ok: false, seconds: 0 });
    return `oracle-pin: the branch edits ${pinned.length === 1 ? "a file" : "files"} the Oracle runs, outside the Edit surface: ${pinned.join(", ")}`;
  }
  const report = junitFile(folder, "oracle");
  const once = (command: string) => {
    rmSync(report, { force: true });
    return runner(repo, tip, withJunit(command, report));
  };
  for (const command of oracleCommands(spec)) {
    if (done.has(command)) continue;
    phase();
    let r = await once(command);
    if (r.infra) return noVerdict(command, r);
    let second = false;
    if (r.code !== 0) { second = true; r = await once(command); if (r.infra) return noVerdict(command, r); }
    any = true;
    // As for a check: `rerun` is a command that failed and then passed.
    rerun ||= second && r.code === 0;
    const rec = runsBunTest(command) ? testRecord(report) : undefined;
    if (rec) tests = !tests ? rec : {
      ran: tests.ran + rec.ran, passed: tests.passed + rec.passed, failed: tests.failed + rec.failed, skipped: tests.skipped + rec.skipped,
      failures: [...tests.failures, ...rec.failures].slice(0, 20),
    };
    const out = `## oracle: exit ${r.code}${second ? " (second run)" : ""}\n$ ${command}\n${lastLines(r.output, 80)}\n\n`;
    logTo(folder, "checks", out);
    if (r.code !== 0) { result(false); return `oracle failed: ${command}`; }
    if (rec?.ran === 0) { result(false); return `oracle ran 0 tests: ${command}`; }
  }
  result(true);
  return null;
}

/** The failed tests in the run's record of the named check: empty when the check ran no `bun test` or no test failed. */
export const failuresOf = (run: Run | null, check: string): FailedTest[] => run?.checks?.findLast((c) => c.name === check)?.tests?.failures ?? [];

/** Each failed test as `- file > name` and its failure, indented. */
export const quoteFailures = (failures: FailedTest[]): string =>
  failures.map((f) => `- ${f.file} > ${f.name}${f.message ? `\n${f.message.split("\n").map((l) => (l ? `    ${l}` : "")).join("\n")}` : ""}`).join("\n");

/**
 * A check that fails unchanged twice: the run before this one also failed `check` with the same failing test
 * names, of the tests that fail on the branch alone. A third fix round would likely fail again, so the Ask names the tests and quotes their failures,
 * and Chris tells a wrong test from a wrong branch. Null when the failures differ, the check's record names no
 * failed test, or there is no run before.
 */
export function repeatedFailure(folder: string, check: string, earlier: { id: string; run: Run }[]): { question: string; names: string[] } | null {
  const prev = earlier.at(-1);
  if (!prev || prev.run.failed !== check) return null;
  const now = failuresOf(jobRecord.getRun(jobOfFolder(folder)), check).filter((f) => !f.onMain);
  const key = (f: FailedTest) => `${f.file} > ${f.name}`;
  const before = failuresOf(prev.run, check).filter((f) => !f.onMain).map(key).sort();
  const names = now.map(key).sort();
  if (!names.length || names.join("\n") !== before.join("\n")) return null;
  const quoted = quoteFailures(now.slice(0, 5));
  return {
    names,
    question: `The check \`${check}\` failed the same way on two runs in a row, so no third fix round starts. The failing test${names.length > 1 ? "s" : ""} and the failure:\n${quoted}\nIs the test wrong, or the branch? Answer to send the worker back with your reading, or drop the run.`,
  };
}
