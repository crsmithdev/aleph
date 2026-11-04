/**
 * `aleph unit <run-folder>`: the body of one run, inside its systemd unit.
 * An agent run is setup, the worker, then the state rule; a plain run is one
 * command. Both end with state.json, then `exit`, then the news.
 */
import { NO_SKILLS, skillSection } from "./role-skill.ts";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import * as issues from "../../todo/lib/todo.ts";
import { file as fileIssues, note, noteFlake, reader } from "../../todo/lib/store.ts";
import { OPUS_MODEL } from "./agent-call.ts";
import { agentCall, stallReason, stallSeconds } from "./agent-run.ts";
import { addWorktree, fetchOrigin, git } from "./git.ts";
import { heldRule, parseReview, REVIEW_SCHEMA, securityChange, testFindings } from "./gate.ts";
import { schemaFlags, structuredOf } from "./structured.ts";
import { awaiting, workerVerdict, type NoVerdict, type Outcome, type VerdictPorts } from "./worker-verdict.ts";
import { admit, tagged, isAgentRun, onOf, allRuns, loadRegistry, lock, newsLine, readEnvFile, readRun, tell, updateRun, type CheckResult, type Entry, type Repo, type Run, type TestRecord } from "./ledger.ts";
import { markEnded, markStarted } from "./process.ts";
import type { Cause } from "./outcome.ts";
import { allJobs, isOpen, jobById, lastReal, openJob } from "./job.ts";
import { atCommit, changedSources, checkEnv as checksEnv, checksAt, junitFile, keepGate, lastLines, newTests, runOnCommit, type Ran, type Runner, runChecks, runsBunTest, stopFields, testRecord, withJunit, type CheckExec, type CheckTask } from "./checks.ts";
import { gates } from "./factory-status.ts";
import { keepDiff } from "./jobdiff.ts";
import { land, removeBranch, waitingToLand, type LandPorts } from "./landing.ts";
import { buildChecks } from "./related.ts";
import { brief, earlierRounds, FOREGROUND, MERGE_MODEL, MERGE_SECONDS, nextStep, questionOf, repeatedFailure, nextBrief } from "./continuation.ts";
import { oracleCommands, outsideSurface } from "./goal-spec.ts";
import { docClaimProblems } from "../../hooks/lib/docclaims.ts";
import { postTrace } from "./trace.ts";
import { runLogged, runPath, startUnit } from "./launch.ts";
import { land as startLand, startJob } from "./transitions.ts";
import { onMain } from "./status.ts";
import { writeTitle } from "./title.ts";
import { checkSeconds, dispatchOn, fixRounds, jobSeconds, reviewDiffMax, reviewSeconds, reviewerCmd, runEnvFile, workerCmd } from "./settings.ts";
import { jobSpec, jobSpecFile, runFile } from "./run-files.ts";

let child: ReturnType<typeof Bun.spawn> | null = null;


interface Exec { code: number; timedOut: boolean; killed: boolean }

/**
 * Run a command with its output appended to `out`. With a limit, it runs under
 * `timeout`, which puts the command in its own process group and signals the
 * group. Whether it timed out comes from this clock, not from the exit code,
 * which the command can return by itself. The clock is performance.now(), which
 * only moves forward: Date.now() follows the wall clock, which WSL can set back.
 */
async function exec(argv: string[], o: { cwd: string; env: Record<string, string | undefined>; out: string; limit?: number; stdin?: string }): Promise<Exec> {
  const cmd = o.limit ? ["timeout", "--kill-after=30", String(o.limit), ...argv] : argv;
  const fd = openSync(o.out, "a");
  const start = performance.now();
  child = Bun.spawn(cmd, { cwd: o.cwd, env: o.env, stdin: o.stdin === undefined ? "ignore" : new Blob([o.stdin]), stdout: fd, stderr: fd });
  const code = await child.exited;
  const killed = child.signalCode !== null;
  child = null;
  closeSync(fd);
  return { code, timedOut: o.limit !== undefined && performance.now() - start >= o.limit * 1000, killed };
}

/** The `result` of the last result event; else the last assistant text; else empty. */
export function resultText(log: string): string {
  let result: string | undefined;
  let text = "";
  for (const line of log.split("\n")) {
    let ev: any;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev?.type === "result" && typeof ev.result === "string") result = ev.result;
    if (ev?.type === "assistant") {
      for (const block of ev.message?.content ?? []) if (block?.type === "text" && block.text) text = block.text;
    }
  }
  return result ?? text;
}

/** A recorder that starts the run's `checks` over and adds each check that ran. */
function recorder(folder: string): (c: CheckResult) => void {
  let all: CheckResult[] = [];
  updateRun(folder, { checks: all });
  return (c) => { all = [...all, c]; updateRun(folder, { checks: all }); };
}

/**
 * Passed runs of the repo waiting to land that have no land run yet: start
 * `aleph land` for them, so they queue on the lock and join this batch. Not
 * while the factory is paused, as the dispatch would not land them.
 */
async function pullWaiting(repo: Repo, run: Run, room: number): Promise<void> {
  if (gates({ only: ["pause"] })) return;
  const jobs = allJobs();
  const names = waitingToLand(jobs).filter((n) => {
    const last = openJob(n, null, jobs)?.at(-1)!.run;
    return last && last.repo === repo.key && !last.next && last.job !== run.job;
  }).slice(0, room);
  const jobsOf = names.map((n) => openJob(n, null, jobs)![0].run.job);
  // Their own units: a child of this land's unit would die with its cgroup when the leader exits.
  for (const n of names) {
    const unit = `aleph-pull-${repo.key}-${n}-${Date.now()}`.replace(/[^A-Za-z0-9:_.-]/g, "-");
    try { startUnit(["land", n], { unit, cwd: repo.path }); } catch {}
  }
  const deadline = Date.now() + 10_000;
  const queued = (job: string) => allRuns().some((e) => e.run.kind === "land" && e.run.job === job && e.run.condition === "running");
  while (Date.now() < deadline && !jobsOf.every(queued)) await Bun.sleep(100);
}

/** The land's checks, in a detached worktree at the commit. */
function landPorts({ folder, run }: Entry, repo: Repo, env: Record<string, string | undefined>): LandPorts {
  const phase = (p: string) => updateRun(folder, { phase: p });
  const logFile = runFile(folder, "checks.log");
  return {
    pull: (room) => pullWaiting(repo, run, room),
    check: async (commit, _runs, changed, picked) => {
      const before = existsSync(logFile) ? readFileSync(logFile, "utf8").length : 0;
      const task = taskOf(folder, { ...repo, checks: picked.checks }, changed, phase);
      const rec = task.record!;
      task.record = (c) => rec(picked.tests.has(c.name) ? { ...c, files: picked.tests.get(c.name)!.length } : c);
      const why = await checksAt(task, commit, env);
      return { why, checks: readRun(folder)?.checks, log: existsSync(logFile) ? readFileSync(logFile, "utf8").slice(before) : undefined };
    },
  };
}

/** Runs one check in the tree `wt`, with the given environment. */
const inWorktree = (wt: string, env: Record<string, string | undefined>): CheckExec => (check, out, limit) => exec(["bash", "-c", check.run], { cwd: wt, env, out, limit });

/** One run of checks: its steps are recorded in the run, and the process of each is kept in `child`. */
const taskOf = (folder: string, repo: Repo, changed: string[], phase: (p: string) => void): CheckTask =>
  ({ folder, repo, changed, phase, record: recorder(folder), onSpawn: (p) => { child = p; } });

/**
 * Give each of the worker's commits a `Job:` trailer, so work that reaches
 * main by hand is still found (onMain). A branch with a merge keeps its
 * commits as they are, because the rebase would flatten it.
 */
function stampJob(wt: string, base: string, job: string): void {
  const bare = git(wt, "log", "--format=%H", "--invert-grep", "-E", `--grep=^Job: ${job}$`, `${base}..HEAD`).out;
  if (!bare || git(wt, "rev-list", "--merges", `${base}..HEAD`).out) return;
  const amend = `git -c core.hooksPath=/dev/null commit -q --amend --no-edit --no-verify --trailer 'Job: ${job}'`;
  if (!git(wt, "-c", "core.hooksPath=/dev/null", "rebase", "-q", "--exec", amend, base).ok) git(wt, "rebase", "--abort");
}

/**
 * The Stop gate's doc-claim check (hooks/lib/docclaims.ts) on a finished worker run: the run's transcript
 * (output.log, stream-json) against its final message. A failure here goes back to the worker as a fix round. Null when the message makes no such claim or the transcript
 * backs it; else the reason, which also goes into checks.log for the next worker's fix note.
 */
export function docClaims(folder: string, result: string): string | null {
  const log = runFile(folder, "output.log");
  if (!existsSync(log)) return null;
  const entries = readFileSync(log, "utf8").split("\n").flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
  const problems = docClaimProblems(entries, result);
  if (!problems.length) return null;
  appendFileSync(runFile(folder, "checks.log"), `## doc-claims: exit 1\nThe final message says a doc matches the code, and the transcript does not back it:\n${problems.map((p) => `- ${p}`).join("\n")}\nRun a command after the last edit that shows both the doc text and the code values, or drop the claim.\n\n`);
  return `doc claims: ${problems.join("; ")}`;
}


export async function unit(folder: string): Promise<void> {
  // drop sends SIGTERM when no systemd unit is there to stop the cgroup.
  process.on("SIGTERM", () => {
    if (child) {
      try { process.kill(-child.pid, "SIGKILL"); } catch {}
      try { child.kill("SIGKILL"); } catch {}
    }
    process.exit(143);
  });
  markStarted(folder);
  const id = basename(folder);
  let run = readRun(folder)!;
  const repo = run.repo ? loadRegistry()[run.repo] : undefined;
  const dispatcherPath = runPath();
  const env: Record<string, string | undefined> = {
    ...process.env, ...readEnvFile(repo?.env ?? runEnvFile()),
    PATH: dispatcherPath, HOME: homedir(), ALEPH_JOB_ID: run.job, ALEPH_JOB_RUN: id,
  };
  delete env.ANTHROPIC_API_KEY;
  delete env.CLAUDECODE;
  delete env.ALEPH_RUN_ENV;

  // The job variables are for the worker: a check that runs aleph's own tests must not see them.
  // A factory repo's checks also get TZ=UTC and the browser tests, as CI runs them.
  const checkEnv = repo?.sandbox ? checksEnv(env) : { ...env, ALEPH_JOB_ID: undefined, ALEPH_JOB_RUN: undefined };

  let outcome: Outcome;
  let code = 0;
  try {
    // A worker or a land starts only under the load limit: it waits, with the reason as its phase.
    if (run.kind !== "plain") {
      await admit((line) => updateRun(folder, { phase: line }));
      updateRun(folder, { phase: undefined });
    }
    if (run.kind === "plain") {
      const r = await exec(["bash", "-c", readFileSync(runFile(folder, "command.txt"), "utf8")], { cwd: process.cwd(), env, out: runFile(folder, "output.log") });
      code = r.code;
      outcome = code === 0 ? { condition: "done" } : { condition: "failed", cause: "other", reason: `exited ${code}` };
    } else if (run.kind === "land") {
      const entry = { id, folder, run };
      ({ outcome, code } = await land(entry, repo!, landPorts(entry, repo!, checkEnv)));
    } else if (run.kind === "recheck") {
      ({ outcome, code } = await recheck(folder, run, repo!, env));
    } else {
      ({ outcome, code } = await agent(id, folder, run, repo!, env, checkEnv));
    }
  } catch (e: any) {
    outcome = { condition: "failed", cause: "other", reason: `error: ${e?.message ?? e}` };
    code = 1;
  }

  let ended = updateRun(folder, { ...outcome, phase: undefined, ended: new Date().toISOString() });
  const next = nextStep(ended, !!repo?.autoland);
  if (next) ended = updateRun(folder, { next });
  markEnded(folder, code);
  process.exitCode = code;
  if (isAgentRun(run.kind) && repo?.sandbox) await postTrace(folder, id, ended, run.repo!);
  if (await tell(newsLine(ended, repo?.note))) updateRun(folder, { told: true });
  if (next) await start(folder, ended, next);
  if (run.kind !== "plain" && dispatchOn()) await dispatchFree(folder);
}

/** A run ended, so a slot may be free: `aleph dispatch` starts the ready goals. Its output goes to dispatch.log. */
async function dispatchFree(folder: string): Promise<void> {
  await runLogged(["dispatch"], runFile(folder, "dispatch.log"));
}

/** The worker's time limit: a merge run has a short one. */
const workSeconds = (run: Run): number => (run.merge ? MERGE_SECONDS : jobSeconds());

/**
 * The file in a run folder that marks a next step the pause kept: the run keeps `next`, so it does not show as stuck,
 * and the first dispatch after the resume starts the step (`startKept`). A `next` without this file is history.
 */
const PAUSED_NEXT = "paused-next";

/**
 * Start the kept step of each open job whose last real run has the `paused-next` file, and remove the file first.
 * The removal is the claim: of two dispatches at once, only the one whose removal succeeds starts the step.
 * Returns the names of the jobs it started a step for.
 */
export async function startKept(go: typeof start = start): Promise<string[]> {
  const started: string[] = [];
  for (const j of allJobs()) {
    if (!isOpen(j)) continue;
    const { folder, run } = lastReal(j);
    const mark = runFile(folder, PAUSED_NEXT);
    if (!run.next || !existsSync(mark)) continue;
    try { rmSync(mark); } catch { continue; }
    await go(folder, run, run.next);
    started.push(run.name);
  }
  return started;
}

/** Start the next run as `aleph land` or `aleph job` would, in-process. What it prints and its refusal go to next.log. */
async function start(folder: string, run: Run, next: NonNullable<Run["next"]>): Promise<void> {
  if (gates({ only: ["pause"] })) {
    appendFileSync(runFile(folder, "next.log"), `paused: no ${next} started; the first dispatch after the resume starts it\n`);
    writeFileSync(runFile(folder, PAUSED_NEXT), `${next}\n`);
    return;
  }
  const dropped = (jobById(run.job) ?? []).some((e) => e.run.condition === "dropped");
  const repo = run.repo ? loadRegistry()[run.repo] : undefined;
  const there = dropped ? null : onMain(repo, { item: onOf(run), fetch: onOf(run) !== undefined })?.commit;
  if (dropped || there) {
    appendFileSync(runFile(folder, "next.log"), dropped ? `dropped: no ${next} started\n` : `item landed as ${there}: no ${next} started\n`);
    updateRun(folder, { next: undefined });
    return;
  }
  const back = nextBrief(folder, run);
  const merge = next === "worker" && back.merge;
  const log = runFile(folder, "next.log");
  try {
    const s = next === "land"
      ? await startLand(run.name, {}, { output: { file: log } })
      : await startJob({ repo: run.repo!, name: run.name, spec: back.note, land: true, ...(merge ? { merge: true, model: MERGE_MODEL } : {}) }, { output: { file: log } });
    appendFileSync(log, JSON.stringify(s.started, null, 2) + "\n");
    await s.child?.exited;
  } catch (e: any) {
    appendFileSync(log, `${String(e?.message ?? e)}\n`);
    updateRun(folder, { next: undefined });
  }
}

/** The env of an agent that works in a worktree: it cannot push to github or reach gh; see "No push, no gh" in the spec. */
function agentEnv(env: Record<string, string | undefined>, folder: string): Record<string, string | undefined> {
  const ghDir = runFile(folder, "gh");
  mkdirSync(ghDir, { recursive: true });
  return {
    ...env, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "url.aleph-no-push:.pushInsteadOf", GIT_CONFIG_VALUE_0: "git@github.com:",
    GH_CONFIG_DIR: ghDir, GH_TOKEN: undefined, GITHUB_TOKEN: undefined, CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1",
  };
}

/**
 * An agent run: the worker in the job's worktree on its branch. A factory repo's run then gets the worker verdict
 * (factoryVerdict); another repo's run gets the state rule and its checks in that worktree.
 */
async function agent(id: string, folder: string, run: Run, repo: Repo, env: Record<string, string | undefined>, checkEnv: Record<string, string | undefined>): Promise<{ outcome: Outcome; code: number }> {
  const wt = run.worktree!;
  const branch = run.branch!;
  const phase = (p: string) => updateRun(folder, { phase: p });
  const fail = (cause: Cause, reason: string) => ({ outcome: { condition: "failed" as const, cause, reason }, code: 1 });

  // A new job starts from origin/<main>, after it clears what an ended job of that name left.
  // A later run whose worktree is gone gets it back on the job's branch.
  if (run.job === id || !existsSync(wt)) {
    phase("setup");
    // Units of one repo share its .git: a concurrent worktree add fails on the config lock, prune removes another's
    // half-made worktree entry, and fetch can fail on shared files. One unit at a time runs these git writes.
    const release = await lock(`setup-${repo.key}`, 300_000);
    if (!release) return fail("other", "setup lock busy");
    try {
      const fetched = fetchOrigin(repo.path);
      if (!fetched.ok) {
        appendFileSync(runFile(folder, "setup.log"), `## fetch: failed\n${fetched.out}\n`);
        return fail("infra", `fetch failed: ${fetched.out}`);
      }
      const kept = run.job !== id && git(repo.path, "rev-parse", "--verify", "-q", `refs/heads/${branch}`).ok;
      if (kept) {
        git(repo.path, "worktree", "prune");
        const add = git(repo.path, "worktree", "add", "-q", wt, branch);
        if (!add.ok) return fail("other", `worktree add failed: ${add.out}`);
      } else {
        // An ended job of this name is cleared below: its run folder keeps the diff first.
        const old = allRuns().findLast((e) => e.id !== id && e.run.repo === repo.key && e.run.name === run.name && e.run.branch === branch);
        if (old) keepDiff(repo, branch, old.folder);
        const add = addWorktree(repo.path, wt, branch, `origin/${repo.main}`);
        if (!add.ok) return fail("other", `worktree add failed: ${add.out}`);
      }
    } finally {
      release();
    }
  }

  const gitDir = git(wt, "rev-parse", "--absolute-git-dir").out;
  const marker = join(gitDir, "aleph-setup");
  if (!existsSync(marker)) {
    phase("setup");
    for (const cmd of repo.setup) {
      appendFileSync(runFile(folder, "setup.log"), `## ${cmd}\n`);
      const r = await exec(["bash", "-c", cmd], { cwd: wt, env: checkEnv, out: runFile(folder, "setup.log"), limit: checkSeconds() });
      if (r.timedOut) return fail("stalled", `timed out: setup ${cmd}`);
      if (r.code !== 0) return fail("other", `setup failed: ${cmd}`);
    }
    writeFileSync(marker, "");
  }

  const argv = [workerCmd(), "-p", "--strict-mcp-config", NO_SKILLS, "--tools", "Read", "Write", "Edit", "Bash", "Grep", "Glob",
    "--session-id", run.session!, "--output-format", "stream-json", "--verbose", "--permission-mode", "bypassPermissions",
    ...(run.model ? ["--model", run.model] : [])];
  const text = brief(id, folder, run, repo);
  writeFileSync(runFile(folder, "prompt.md"), text);
  phase("worker");
  const w = await agentCall("worker", argv, {
    cwd: wt, env: agentEnv(env, folder), stdin: text, stdout: runFile(folder, "output.log"), stderr: runFile(folder, "stderr.log"),
    limit: workSeconds(run), stall: stallSeconds(), onSpawn: (p) => { child = p; },
  });
  child = null;
  if (repo.sandbox) return factoryVerdict(id, folder, run, repo, w, env);
  const result = resultText(readFileSync(runFile(folder, "output.log"), "utf8"));
  writeFileSync(runFile(folder, "result.md"), result);

  // The state rule: the first match wins.
  if (w.step.stalled) return fail("stalled", stallReason());
  if (w.step.timedOut) return fail("stalled", "timed out: worker");
  if (w.step.code !== 0) return { outcome: { condition: "failed", cause: "other", reason: `worker exited ${w.step.code}` }, code: w.step.code };
  const question = questionOf(result);
  if (question !== undefined) return { outcome: { ...awaiting("question", question), question }, code: 0 };
  const dirty = git(wt, "status", "--porcelain").out;
  if (dirty) return fail("other", `uncommitted: ${dirty.split("\n")[0].slice(3)}`);
  const refetched = fetchOrigin(wt);
  if (!refetched.ok) {
    appendFileSync(runFile(folder, "setup.log"), `## fetch: failed\n${refetched.out}\n`);
    return fail("infra", `fetch failed: ${refetched.out}`);
  }
  const base = git(wt, "merge-base", `origin/${repo.main}`, "HEAD").out;
  if (git(wt, "rev-list", "--count", `${base}..HEAD`).out === "0") {
    removeBranch(repo, run);
    return { outcome: { condition: "done", reason: "no commits" }, code: 0 };
  }
  stampJob(wt, base, run.job);
  const changed = git(wt, "diff", "--name-only", base, "HEAD").out.split("\n").filter(Boolean);
  const failed = await runChecks(taskOf(folder, repo, changed, () => phase("verify")), inWorktree(wt, checkEnv));
  if (failed) return { outcome: { condition: "failed", ...stopFields(failed) }, code: 1 };
  const matches = (globs: string[]) => changed.some((f) => globs.some((g) => new Bun.Glob(g).match(f)));
  // A manual check does not hold the run: it lands with the check open (see land).
  const manual = repo.manual.find((m) => matches(m.when));
  return { outcome: { condition: "passed", checkedBase: base, checkedTip: git(wt, "rev-parse", "HEAD").out, ...(manual ? { say: manual.say } : {}) }, code: 0 };
}

/**
 * A factory worker's run after its worker: the tags of its final message, then the worker verdict on its branch.
 * Only the branch's commits count: what the worker left uncommitted is not checked.
 */
async function factoryVerdict(id: string, folder: string, run: Run, repo: Repo, w: Awaited<ReturnType<typeof agentCall>>, env: Record<string, string | undefined>): Promise<{ outcome: Outcome; code: number }> {
  const tip = `refs/heads/${run.branch!}`;
  const main = `refs/remotes/origin/${repo.main}`;
  const stuck = (cause: Cause, reason: string, extra: Partial<Outcome> = {}) => ({ outcome: { condition: "stuck" as const, cause, reason, ...extra }, code: 1 });
  const o = w.outcome;
  writeFileSync(runFile(folder, "result.md"), o.result);
  const facts: Partial<Outcome> = { ...(o.cost !== undefined ? { cost: o.cost } : {}), defaults: tagged(o.result, "DEFAULT") };
  await fileFollowups(repo, run, tagged(o.result, "FOLLOWUP"));
  noteFlakes(repo, run, tagged(o.result, "FLAKE"));
  if (w.cause) return stuck(w.cause.kind, w.cause.reason, facts);
  { const f = fetchOrigin(repo.path); if (!f.ok) return stuck("infra", `fetch failed: ${f.out}`, facts); }
  if (git(repo.path, "rev-list", "--count", `${main}..${tip}`).out === "0") return stuck("no-commit", "no commit", facts);
  const base = git(repo.path, "merge-base", main, tip).out;

  // Each earlier run of the job that a failed check sent back is a fix round.
  const earlier = earlierRounds(jobById(run.job) ?? [], id);
  if (earlier.length) facts.round = earlier.length;
  const changed = git(repo.path, "diff", "--name-only", base, tip).out.split("\n").filter(Boolean);
  if (changed.length > 0 && changed.every((f) => f === "result.md")) return stuck("no-commit", "no commit", facts);
  const checked = { checkedBase: base, checkedTip: git(repo.path, "rev-parse", tip).out };
  return workerVerdict({ earlier: earlier.map((e) => e.run), rounds: fixRounds(), facts, checked }, branchPorts(folder, run, repo, base, run.branch!, { changed, earlier, result: o.result, env }));
}

/**
 * The ports of the worker verdict for `branch` of a run, based on `base`. The checks and the reviewer each run in a
 * detached worktree at the branch's tip. `earlier` is the job's runs that were sent back, `result` the worker's
 * final message (a recheck has neither), `runner` runs the Oracle's commands, and `env` is the unit's env.
 */
export function branchPorts(folder: string, run: Run, repo: Repo, base: string, branch: string, o: { changed: string[]; earlier?: Entry[]; result?: string; runner?: Runner; review?: typeof review; env?: Record<string, string | undefined> }): VerdictPorts {
  const phase = (p: string) => updateRun(folder, { phase: p });
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
        appendFileSync(runFile(folder, "checks.log"), `## ${name}: ${files.length} test file${files.length === 1 ? "" : "s"} that the change reaches\n${files.join("\n")}\n\n`);
        if (!files.length) record({ name, ok: true, seconds: 0 });
      }
      const sha = git(repo.path, "rev-parse", tip).out;
      const stop = await checksAt({ folder, repo: { ...repo, checks: build.checks }, changed: o.changed, phase: verify, record, onSpawn: (p) => { child = p; } }, sha, checksEnv(env));
      return { stop, failed: readRun(folder)?.checks?.findLast((c) => !c.ok)?.name };
    },
    repeatedFailure: (check) => repeatedFailure(folder, check, o.earlier ?? []),
    docClaims: () => o.result === undefined ? null : docClaims(folder, o.result),
    keepGate: async () => {
      verify();
      const head = git(repo.path, "rev-parse", tip).out;
      const start = performance.now();
      const kept = await keepGate(repo, base, head, newTests(repo.path, base, head), changedSources(repo.path, base, head), o.runner ?? runOnCommit);
      if (!kept) return null;
      appendFileSync(runFile(folder, "checks.log"), `## keep-gate: ${kept.noVerdict ? "no verdict" : "exit 1"}\n${kept.log}\n\n`);
      if (!kept.noVerdict) return kept.reason;
      // No verdict is a result on the run beside the checks, so the job page shows it.
      updateRun(folder, { checks: [...readRun(folder)?.checks ?? [], { name: "keep-gate", ok: false, seconds: Math.round((performance.now() - start) / 1000), noVerdict: true }] });
      return { noVerdict: kept.reason };
    },
    stat: () => git(repo.path, "diff", "--stat", base, tip).out,
    security: () => securityChange(repo.path, base, tip),
    heldRule: () => heldRule(repo.path, repo.held, base, tip),
    oracle: () => oracleFailure(folder, run, repo, branch, o.runner ?? runOnCommit, verify),
    review: () => {
      phase("review");
      findings ??= testFindings(repo.path, base, tip);
      return (o.review ?? review)(folder, run, repo, base, branch, findings, o.changed, env);
    },
  };
}

/**
 * The goal's Oracle commands, run on the branch in a detached worktree, the last step of Verify.
 * A command the run's checks already ran is skipped; one that fails runs once more.
 * Returns the reason of the first that fails twice, or null. A command that could not run to a verdict (`infra`: its
 * setup failed, or a clock or a signal ended it) stops the Oracle with no verdict: it is neither a pass nor a failure.
 * When a command ran, the run's `checks` gets one result `oracle` beside the repo's checks; checks.log gets each command's section.
 */
async function oracleFailure(folder: string, run: Run, repo: Repo, branch: string, runner: Runner, phase: () => void): Promise<string | NoVerdict | null> {
  const specFile = jobSpecFile(folder, run);
  if (!existsSync(specFile)) return null;
  const ran = new Set((readRun(folder)?.checks ?? []).map((c) => c.name));
  const done = new Set(repo.checks.filter((c) => ran.has(c.name)).map((c) => c.run.trim()));
  const tip = git(repo.path, "rev-parse", `refs/heads/${branch}`).out;
  const start = performance.now();
  let any = false, rerun = false;
  // The `bun test` commands' records, summed.
  let tests: TestRecord | undefined;
  const result = (ok: boolean, none = false) => {
    if (!any && !none) return;
    const checks = readRun(folder)?.checks ?? [];
    updateRun(folder, { checks: [...checks, { name: "oracle", ok, seconds: Math.round((performance.now() - start) / 1000), ...(rerun ? { rerun } : {}), ...(none ? { noVerdict: true as const } : {}), ...(tests ? { tests } : {}) }] });
  };
  const noVerdict = (command: string, r: Ran): NoVerdict => {
    appendFileSync(runFile(folder, "checks.log"), `## oracle: no verdict\n$ ${command}\n${lastLines(r.output, 80).replaceAll(" ⏎ ", "\n")}\n\n`);
    result(false, true);
    return { noVerdict: `no verdict: oracle: ${command}` };
  };
  const report = junitFile(folder, "oracle");
  const once = (command: string) => {
    rmSync(report, { force: true });
    return runner(repo, tip, withJunit(command, report));
  };
  for (const command of oracleCommands(readFileSync(specFile, "utf8"))) {
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
    const out = `## oracle: exit ${r.code}${second ? " (second run)" : ""}\n$ ${command}\n${lastLines(r.output, 80).replaceAll(" ⏎ ", "\n")}\n\n`;
    appendFileSync(runFile(folder, "checks.log"), out);
    if (r.code !== 0) { result(false); return `oracle failed: ${command}`; }
    if (rec?.ran === 0) { result(false); return `oracle ran 0 tests: ${command}`; }
  }
  result(true);
  return null;
}

/**
 * A recheck: no worker. The run branch takes origin/<main> by a merge made in
 * memory (a conflict makes the run stuck and names the files), the checks run
 * on the result, then the held rule and the reviewer, as after a worker.
 */
async function recheck(folder: string, run: Run, repo: Repo, env: Record<string, string | undefined>): Promise<{ outcome: Outcome; code: number }> {
  const branch = run.branch!;
  const ref = `refs/heads/${branch}`;
  const main = `refs/remotes/origin/${repo.main}`;
  const phase = (p: string) => updateRun(folder, { phase: p });
  const stuck = (cause: Cause, reason: string, extra: Partial<Outcome> = {}) => ({ outcome: { condition: "stuck" as const, cause, reason, ...extra }, code: 1 });
  phase("setup");
  { const f = fetchOrigin(repo.path); if (!f.ok) return stuck("infra", `fetch failed: ${f.out}`); }
  const tip = git(repo.path, "rev-parse", "--verify", "-q", ref);
  if (!tip.ok) return stuck("other", `branch gone: ${branch}`);
  const upstream = git(repo.path, "rev-parse", main).out;
  phase("merge");
  if (!git(repo.path, "merge-base", "--is-ancestor", upstream, tip.out).ok) {
    const merged = git(repo.path, "merge-tree", "--write-tree", "--name-only", tip.out, upstream);
    const lines = merged.out.split("\n");
    if (!merged.ok) {
      const conflicts = lines.slice(1, lines.indexOf("") < 0 ? undefined : lines.indexOf("")).filter(Boolean);
      return stuck("conflict", `merge conflict: ${conflicts.join(", ")}`, { conflicts });
    }
    const c = git(repo.path, "commit-tree", lines[0], "-p", tip.out, "-p", upstream, "-m", `Merge ${repo.main} into ${branch}`);
    if (!c.ok || !git(repo.path, "update-ref", ref, c.out, tip.out).ok) return stuck("other", `merge failed: ${c.out}`);
    // The job's worktree has the branch checked out: its files follow the moved branch.
    if (run.worktree && existsSync(run.worktree)) git(run.worktree, "reset", "-q", "--hard");
  }
  const base = git(repo.path, "merge-base", main, ref).out;
  if (git(repo.path, "rev-list", "--count", `${main}..${ref}`).out === "0") return stuck("no-commit", "no commit");
  const changed = git(repo.path, "diff", "--name-only", base, ref).out.split("\n").filter(Boolean);
  if (changed.length > 0 && changed.every((f) => f === "result.md")) return stuck("no-commit", "no commit");
  const checked = { checkedBase: base, checkedTip: git(repo.path, "rev-parse", ref).out };
  return workerVerdict({ rounds: fixRounds(), facts: {}, checked }, branchPorts(folder, run, repo, base, branch, { changed, env }));
}

const REVIEW = `You are the reviewer of job \`%NAME%\`. The working directory is a clone of the
branch the worker made for the goal issue below; read the code there as needed.
Judge whether the diff does what the issue asks, whether the tests cover it, and
whether it breaks anything. Do not change tracked files. The factory ran the checks that this change reaches
on this branch, and they passed. Do not run the full test suite or repeat-run loops: you have a time
box, and a long command ends it with no verdict. Run only a few targeted commands
of your own, each ending in well under a minute. ${FOREGROUND}

Check the whole branch before you give a verdict; do not stop at the first defect.
Check each Oracle clause of the spec and each requirement in the Goal section.
The Oracle is a check stored on the issue, so the goal does not need a new committed test. A committed test
needs a lasting reason: a bug fix gets one regression test at the lowest layer that shows the bug; new lasting
behaviour of a module gets a row in that module's existing test file; a CLI end-to-end test is only for new
command wiring. Hold a committed test that has none of these reasons, and one at the wrong layer or in the wrong file.
The "summary" is the verdict in one sentence and the passes as a count, such as \`7 of 9 passed\`, in at most 80 words.
Each failure goes in "failures": its clause, named by a few words without its reason, and what was observed. Do not
list a pass. Say each thing once. The list of failures has no cap: list every failure, not only the first. The verdict is "pass" when nothing
failed, else "hold".`;

const TESTS = `The diff changes tests. Judge each finding below against the goal: hold only
when the goal does not call for the change, or the change weakens a check the
goal keeps. A change the goal calls for passes.`;

const OUTSIDE = `The branch changes these files, and the Edit surface of the goal names none of them. Judge each one
against the goal: hold only when the goal does not need the change. A change the goal needs passes.`;

const MERGE = `This run only merged origin/main into the branch, after a land conflicted. The diff below is the merge
commit against its first parent, the branch before the merge. Judge only the merge: each conflict must keep both the
change on main and this job's change. The job's own work was reviewed in an earlier run.`;

/**
 * The reviewer's prompt: the instructions, the test findings if any, the files outside the Edit surface if any,
 * the goal and the diff. A merge run's diff is the merge commit's only (`merge`).
 */
export function reviewPrompt(name: string, spec: string, diff: string, findings: string[], o: { outside?: string[]; merge?: boolean } = {}): string {
  const tests = findings.length ? `\n\n## Test changes\n\n${TESTS}\n\n${findings.map((f) => `- The diff ${f}`).join("\n")}` : "";
  const outside = o.outside?.length ? `\n\n## Changes outside the Edit surface\n\n${OUTSIDE}\n\n${o.outside.map((f) => `- ${f}`).join("\n")}` : "";
  const head = o.merge ? `## The merge commit's conflict resolution\n\n${MERGE}` : "## Diff from the merge base";
  return `${REVIEW.replace("%NAME%", name)}\n\nJudge the branch by the method below.\n\n${skillSection("code-review", "Review method")}${tests}${outside}\n\n## Goal issue\n\n${spec}\n\n${head}\n\n${diff}\n`;
}

/**
 * The range the reviewer reads: from the merge base to the tip; for a merge run, the newest merge commit
 * ahead of the base, read as its remerge diff (the conflict resolution only). A merge run that made no merge commit reads the whole range.
 */
export function reviewRange(cwd: string, run: Run, base: string, tip: string): { from: string; to: string; merge: boolean } {
  const r = run.merge ? git(cwd, "rev-list", "--merges", "-1", `${base}..${tip}`) : null;
  const m = r?.ok ? r.out : "";
  return m ? { from: `${m}^1`, to: m, merge: true } : { from: base, to: tip, merge: false };
}

/**
 * The diff the reviewer reads, cut at `max` characters with a stat in front. A merge run's own work is how it
 * resolved the merge, so its diff is the remerge diff of the merge commit: the resolution only, not what main brought in.
 */
export function reviewDiff(cwd: string, range: { from: string; to: string; merge: boolean }, max: number): string {
  const show = (...o: string[]) => range.merge ? git(cwd, "show", "--remerge-diff", "--format=", ...o, range.to).out : git(cwd, "diff", ...o, range.from, range.to).out;
  const whole = show() || (range.merge ? "(the merge applied cleanly: it resolved no conflict)" : "");
  return whole.length <= max ? whole
    : `${show("--stat")}\n\n${whole.slice(0, max)}\n\n(diff cut at ${max} of ${whole.length} characters; read the changed files in the working directory)`;
}

/**
 * A fresh reviewer reads the passing run: `claude -p` on Opus 5.5 in a detached worktree at the branch's tip,
 * with the worker's env. Returns the reason to hold, or null on a pass, and the cost. Fails closed.
 */
async function review(folder: string, run: Run, repo: Repo, base: string, branch: string, findings: string[], changed: string[], env: Record<string, string | undefined>): Promise<{ reason: string | null; cost?: number; none?: boolean }> {
  const spec = jobSpec(folder, run);
  const range = reviewRange(repo.path, run, base, `refs/heads/${branch}`);
  const diff = reviewDiff(repo.path, range, reviewDiffMax());
  const text = reviewPrompt(run.name, spec, diff, findings, { outside: outsideSurface(spec, changed), merge: range.merge });
  writeFileSync(runFile(folder, "review-prompt.md"), text);
  const argv = [reviewerCmd(), "-p", "--strict-mcp-config", NO_SKILLS, "--output-format", "stream-json", "--verbose", "--permission-mode", "bypassPermissions",
    "--tools", "Read", "Grep", "Glob", "Bash", "--model", OPUS_MODEL, ...schemaFlags(REVIEW_SCHEMA)];
  const log = runFile(folder, "review.log");
  const err = runFile(folder, "review.err");
  const tip = git(repo.path, "rev-parse", `refs/heads/${branch}`).out;
  try {
    return await atCommit(repo, tip, async (wt) => {
      const w = await agentCall("reviewer", argv, {
        cwd: wt, env: agentEnv(env, folder), stdin: text, stdout: log, stderr: err, limit: reviewSeconds(), stall: stallSeconds(),
        onSpawn: (p) => { child = p; },
      });
      child = null;
      const o = w.outcome;
      const v = parseReview(structuredOf(existsSync(log) ? readFileSync(log, "utf8") : ""));
      writeFileSync(runFile(folder, "review.md"), typeof v === "string" ? o.result : v.text);
      const cost = o.cost;
      const none = (why: string) => ({ reason: `reviewer: no verdict (${why})`, cost, none: true });
      if (w.cause) return none(w.cause.reason);
      if (typeof v === "string") return none(v);
      return { reason: v.pass ? null : `reviewer: ${v.reason}`, cost };
    });
  } catch (e) {
    return { reason: `reviewer: no verdict (${e instanceof Error ? e.message : e})`, none: true };
  }
}

/**
 * A worker's `FOLLOWUP:` lines each become a `task` with `source: worker`: the title writer's title, and the run and the whole line in its request,
 * filed in one store commit. An empty line such as "none" files nothing, and a line on the topic of an open issue is a note on that issue. This reverses the aleph-826 choice (a log and no issue), which the spec supersedes.
 */
export async function fileFollowups(repo: Repo, run: Run, lines: string[]): Promise<void> {
  const lists = reader();
  const open = (lists.list(repo.key)?.items ?? []).filter((i) => issues.status(i) === "open");
  const fresh: string[] = [];
  for (const title of lines) {
    if (/^(none|n\/a|nothing)\.?$/i.test(title.trim())) continue;
    // Chris paused flake follow-ups on 1 Nov 2026: a line about a flake is a tracker note, and files no issue.
    if (/\bflak/i.test(title)) { noteFlakes(repo, run, [title]); continue; }
    if (fresh.some((t) => sameTopic(t, title))) continue;
    const same = open.find((i) => sameTopic(i.title, title));
    if (same) note(repo, issues.refOf(same), `also met in run ${run.name}: ${title}`);
    else fresh.push(title);
  }
  if (!fresh.length) return;
  const on = onOf(run);
  const priority = (on === undefined ? undefined : lists.item(repo.key, on)?.fm.priority as string | undefined) ?? "medium";
  const titles = await Promise.all(fresh.map(writeTitle));
  fileIssues(repo, `followups from ${run.name}`, fresh.map((line, n) => ({ title: titles[n], kind: "task", priority, source: "worker" as const, request: `A follow-up the worker met in run ${run.name}:\n\nFOLLOWUP: ${line}` })));
}

const PATH = /[\w.-]+(?:\/[\w.-]+)+|[\w-]+\.(?:ts|js|md|json)\b/g;
const COMMON = new Set(["the", "and", "for", "from", "with", "that", "this", "not", "but", "are", "was", "its", "into"]);
/**
 * Two titles say the same thing: most of the shorter title's words are in the other, half with a
 * shared file path, 70% without. A shared path alone is not enough: busy files have unrelated issues.
 */
export function sameTopic(a: string, b: string): boolean {
  const paths = (t: string) => new Set(t.match(PATH) ?? []);
  const words = (t: string) => new Set((t.replace(PATH, " ").toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? []).filter((w) => !COMMON.has(w)));
  const [wa, wb] = [words(a), words(b)];
  const [short, long] = wa.size <= wb.size ? [wa, wb] : [wb, wa];
  if (!short.size) return false;
  const pb = paths(b);
  const shared = [...paths(a)].some((p) => pb.has(p));
  return [...short].filter((w) => long.has(w)).length / short.size >= (shared ? 0.5 : 0.7);
}

/** A worker's `FLAKE:` lines become notes on the repo's flake tracker; they file no issue and start no intake. */
function noteFlakes(repo: Repo, run: Run, lines: string[]): void {
  for (const line of lines) noteFlake(repo, `job ${run.name}: ${line}`);
}
