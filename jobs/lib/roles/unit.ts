/**
 * `aleph unit <run-folder>`: the body of one run, inside its systemd unit.
 * An agent run is setup, the worker, then the state rule; a plain run is one
 * command. Both end with the job record, then `exit`, then the news.
 */
import { logEvent } from "../../../lib/layout.ts";
import * as jobRecord from "../records/record.ts";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { callAgent, transcriptOf, type Reply } from "./agent-call.ts";
import { addWorktree } from "../infra/git.ts";
import { fetchOrigin, git, mainRef } from "../../../lib/git.ts";
import { branchFacts, jobGrep, trailerLine } from "../records/status.ts";
import { parseWorker, WORKER_SCHEMA } from "../gates/gate.ts";
import { branchPorts, recorder, waiting, workerVerdict, type Outcome } from "../gates/worker-verdict.ts";
import { admit, isAgentRun, allRuns, loadRegistry, newsLine, readEnvFile, realTell, type Entry, type Repo, type Run, type Tell, allJobs } from "../records/ledger.ts";
import { lock } from "../../../lib/locks.ts";
import { isLive, killGroup, markEnded, markStarted } from "../infra/process.ts";
import type { Cause } from "../records/outcome.ts";
import { jobById, openJob } from "../records/job.ts";
import { checkEnv as checksEnv, checksAt, shell, runChecks, stopFields, type CheckExec, type CheckTask } from "../gates/checks.ts";
import { paused } from "../gates/pause.ts";
import { keepDiff } from "../records/jobdiff.ts";
import { conflictsOf, land, removeBranch, waitingToLand, type LandPorts } from "../land/landing.ts";
import { readModels, SIZE_OF } from "../routing/models.ts";
import { brief, earlierRounds, MERGE_SECONDS, nextStep, questionOf } from "../transitions/continuation.ts";
import { postTrace } from "../learning/trace.ts";
import { runLogged, runPath, startUnit } from "../transitions/launch.ts";
import { start } from "../transitions/kept.ts";
import { agentEnv } from "./agent-run.ts";
import { reviewer } from "./review.ts";
import { fileFollowups } from "./followups.ts";
import { docClaims } from "./docclaims.ts";
import { checkSeconds, dispatchOn, fixRounds, jobSeconds, runEnvFile } from "../infra/settings.ts";
import { jobOfFolder, logStream, logTo, readSection, runFile } from "../records/run-files.ts";
import { errText } from "../../../lib/errtext.ts";

let child: ReturnType<typeof Bun.spawn> | null = null;


/** `shell` with the process kept in `child` while it runs, so the unit's stop signal reaches it. */
async function exec(cmd: string, o: { cwd: string; env: Record<string, string | undefined>; out: string; limit?: number }): Promise<Awaited<ReturnType<typeof shell>>> {
  const r = await shell(cmd, { ...o, onSpawn: (p) => { child = p; } });
  child = null;
  return r;
}

/**
 * Passed runs of the repo waiting to land that have no land run yet: start
 * `aleph land` for them, so they queue on the lock and join this batch. Not
 * while the factory is paused, as the dispatch would not land them.
 */
async function pullWaiting(repo: Repo, run: Run, room: number): Promise<void> {
  if (paused()) return;
  const jobs = allJobs();
  const names = waitingToLand(jobs).filter((n) => {
    const last = openJob(n, null, jobs)?.at(-1)!.run;
    return last && last.repo === repo.key && !last.next && last.job !== run.job;
  }).slice(0, room);
  const jobsOf = names.map((n) => openJob(n, null, jobs)![0].run.job);
  // Their own units: a child of this land's unit would die with its cgroup when the leader exits.
  for (const n of names) {
    const unit = `aleph-pull-${repo.key}-${n}-${Date.now()}`.replace(/[^A-Za-z0-9:_.-]/g, "-");
    try { startUnit(["land", n], { unit, cwd: repo.path }); } catch (e) { logEvent({ subject: "rule", action: "failed", object: "land", detail: errText(e) }); }
  }
  const deadline = Date.now() + 10_000;
  // The land must be live, as queuedLands takes only a live land: one still starting would miss the batch.
  const queued = (job: string) => allRuns().some((e) => e.run.role === "land" && e.run.job === job && e.run.state === "running" && isLive(e.folder));
  while (Date.now() < deadline && !jobsOf.every(queued)) await Bun.sleep(100);
}

/** The land's checks, in a detached worktree at the commit. */
function landPorts({ folder, run }: Entry, repo: Repo, env: Record<string, string | undefined>): LandPorts {
  const phase = (p: string) => jobRecord.patchRun(jobOfFolder(folder), { phase: p });
  const checksOf = () => readSection(folder, "checks") ?? "";
  return {
    pull: (room) => pullWaiting(repo, run, room),
    check: async (commit, _runs, changed, picked) => {
      const before = checksOf().length;
      const task = taskOf(folder, { ...repo, checks: picked.checks }, changed, phase);
      const rec = task.record!;
      task.record = (c) => rec(picked.tests.has(c.name) ? { ...c, files: picked.tests.get(c.name)!.length } : c);
      const why = await checksAt(task, commit, env);
      return { why, checks: jobRecord.getRun(jobOfFolder(folder))?.checks, log: checksOf().slice(before) || undefined };
    },
  };
}

/** Runs one check in the tree `wt`, with the given environment. */
const inWorktree = (wt: string, env: Record<string, string | undefined>): CheckExec => (check, out, limit) => exec(check.run, { cwd: wt, env, out, limit });

/** What `branchPorts` takes from this unit: its reviewer call, and each check's process, kept in `child`. */
const ports = { review: reviewer((p) => { child = p; }), onSpawn: (p: ReturnType<typeof Bun.spawn>) => { child = p; } };

/** One run of checks: its steps are recorded in the run, and the process of each is kept in `child`. */
const taskOf = (folder: string, repo: Repo, changed: string[], phase: (p: string) => void): CheckTask =>
  ({ folder, repo, changed, phase, record: recorder(folder), onSpawn: (p) => { child = p; } });

/**
 * Give each of the worker's commits an `Issue:` and a `Job:` trailer, so work that reaches
 * main by hand is still found (onMain). A branch with a merge keeps its
 * commits as they are, because the rebase would flatten it.
 */
function stampJob(wt: string, base: string, run: Run, id: string): void {
  const bare = git(wt, "log", "--format=%H", "--invert-grep", "-E", jobGrep([id]), `${base}..HEAD`).out;
  if (!bare || git(wt, "rev-list", "--merges", `${base}..HEAD`).out) return;
  const issue = run.target ? ` --trailer '${trailerLine("Issue", run.target)}'` : "";
  const amend = `git -c core.hooksPath=/dev/null commit -q --amend --no-edit --no-verify --trailer '${trailerLine("Job", id)}'${issue}`;
  if (!git(wt, "-c", "core.hooksPath=/dev/null", "rebase", "-q", "--exec", amend, base).ok) git(wt, "rebase", "--abort");
}

export async function unit(folder: string, tell: Tell = realTell): Promise<void> {
  // drop sends SIGTERM when no systemd unit is there to stop the cgroup.
  process.on("SIGTERM", () => {
    if (child) killGroup(child.pid, "SIGKILL");
    process.exit(143);
  });
  markStarted(folder);
  const id = jobOfFolder(folder);
  let run = jobRecord.getRun(id)!;
  const repo = run.repo ? loadRegistry()[run.repo] : undefined;
  const dispatcherPath = runPath();
  const env: Record<string, string | undefined> = {
    ...process.env, ...readEnvFile(repo?.env ?? runEnvFile()),
    PATH: dispatcherPath, HOME: homedir(), ALEPH_JOB_ID: id,
  };
  delete env.ANTHROPIC_API_KEY;
  delete env.CLAUDECODE;
  delete env.ALEPH_RUN_ENV;

  // The job variables are for the worker: a check that runs aleph's own tests must not see them.
  // A factory repo's checks also get TZ=UTC and the browser tests, as CI runs them.
  const checkEnv = repo?.sandbox ? checksEnv(env) : { ...env, ALEPH_JOB_ID: undefined };

  let outcome: Outcome;
  let code = 0;
  try {
    // A worker or a land starts only under the load limit: it waits, with the reason as its phase.
    if (run.role !== "plain") {
      await admit((line) => jobRecord.patchRun(id, { phase: line }));
      jobRecord.patchRun(id, { phase: undefined });
    }
    if (run.role === "plain") {
      const r = await exec(readSection(folder, "command") ?? "", { cwd: process.cwd(), env, out: runFile(folder, "transcript.jsonl") });
      code = r.code;
      outcome = code === 0 ? { state: "done" } : { state: "failed", cause: "other", reason: `exited ${code}` };
    } else if (run.role === "land") {
      const entry = { id, folder, run };
      ({ outcome, code } = await land(entry, repo!, landPorts(entry, repo!, checkEnv)));
    } else if (run.role === "recheck") {
      ({ outcome, code } = await recheck(folder, run, repo!, env));
    } else {
      ({ outcome, code } = await agent(id, folder, run, repo!, env, checkEnv));
    }
  } catch (e) {
    outcome = { state: "failed", cause: "other", reason: `error: ${errText(e)}` };
    code = 1;
  }

  // One write ends the run with its `next`. `told` is a later write: it waits for the reply of Sidetone.
  const ended = jobRecord.endRun(id, { ...outcome, phase: undefined }, (r, lands) => nextStep(r, !!repo?.autoland, lands));
  const next = ended.next;
  markEnded(folder, code);
  jobRecord.copyEnd(id);
  process.exitCode = code;
  if (isAgentRun(run.role) && repo?.sandbox) await postTrace(folder, id, ended, run.repo!);
  if (await tell.send(newsLine({ id, folder, run: ended }, repo?.note))) jobRecord.patchRun(id, { told: true });
  if (next) await start(folder, ended, next);
  if (run.role !== "plain" && dispatchOn()) await dispatchFree(folder);
}

/** A run ended, so a slot may be free: `aleph dispatch` starts the ready issues. Its output goes to dispatch.log. */
async function dispatchFree(folder: string): Promise<void> {
  if (await runLogged(["dispatch"], logStream(folder, "dispatch")) === null) logTo(folder, "dispatch", "dispatch did not start");
}

/** The worker's time limit: a merge run has a short one. */
const workSeconds = (run: Run): number => (run.merge ? MERGE_SECONDS : jobSeconds());

/**
 * An agent run: the worker in the job's worktree on its branch. A factory repo's run then gets the worker verdict
 * (factoryVerdict); another repo's run gets the state rule and its checks in that worktree.
 */
async function agent(id: string, folder: string, run: Run, repo: Repo, env: Record<string, string | undefined>, checkEnv: Record<string, string | undefined>): Promise<{ outcome: Outcome; code: number }> {
  const wt = run.worktree!;
  const branch = run.branch!;
  const phase = (p: string) => jobRecord.patchRun(jobOfFolder(folder), { phase: p });
  const fail = (cause: Cause, reason: string, limit?: number) => ({ outcome: { state: "failed" as const, cause, reason, limit }, code: 1 });

  // A new job starts from origin/<main>, after it clears what an ended job of that name left.
  // A later run whose worktree is gone gets it back on the job's branch.
  if (!run.prev || !existsSync(wt)) {
    phase("setup");
    // Units of one repo share its .git: a concurrent worktree add fails on the config lock, prune removes another's
    // half-made worktree entry, and fetch can fail on shared files. One unit at a time runs these git writes.
    const release = await lock(`setup-${repo.key}`, 300_000);
    if (!release) return fail("other", "setup lock busy");
    try {
      const fetched = fetchOrigin(repo.path);
      if (!fetched.ok) {
        logTo(folder, "setup", `## fetch: failed\n${fetched.out}\n`);
        return fail("infra", `fetch failed: ${fetched.out}`);
      }
      const kept = !!run.prev && git(repo.path, "rev-parse", "--verify", "-q", `refs/heads/${branch}`).ok;
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
      logTo(folder, "setup", `## ${cmd}\n`);
      const r = await exec(cmd, { cwd: wt, env: checkEnv, out: logStream(folder, "setup"), limit: checkSeconds() });
      if (r.timedOut) return fail("stalled", `timed out: setup ${cmd}`);
      if (r.code !== 0) return fail("other", `setup failed: ${cmd}`);
    }
    writeFileSync(marker, "");
  }

  const size = SIZE_OF[run.model ?? ""];
  // A run routed to a size runs on that size's model, and its job row keeps the size word.
  if (size !== undefined) { const pick = readModels()[size].model; jobRecord.patchRun(jobOfFolder(folder), { model: pick, size }); run = { ...run, model: pick }; }
  const text = brief(id, run, repo);
  writeFileSync(runFile(folder, "prompt.md"), text);
  phase("worker");
  // No GPU slot: a worker's run on the local backend counts against LOCAL_CAP itself, and the live cap admitted it.
  const w = await callAgent("worker", text, {
    model: run.model, flags: ["--tools", "Read", "Write", "Edit", "Bash", "Grep", "Glob", "--session-id", run.session!, "--permission-mode", "bypassPermissions"],
    schema: repo.sandbox ? WORKER_SCHEMA : undefined, cwd: wt, env: agentEnv(env, folder), stdout: runFile(folder, "transcript.jsonl"), stderr: logStream(folder, "stderr"),
    limit: workSeconds(run), slot: false, onSpawn: (p) => { child = p; },
  });
  child = null;
  if (w.tokens !== undefined) jobRecord.patchRun(jobOfFolder(folder), { tokens: w.tokens });
  // A run with no --model ran on the CLI's default: record the one its init event names.
  if (!run.model && w.model) { jobRecord.patchRun(jobOfFolder(folder), { model: w.model }); run = { ...run, model: w.model }; }
  if (repo.sandbox) return factoryVerdict(id, folder, run, repo, w, env);
  const result = transcriptOf(readFileSync(runFile(folder, "transcript.jsonl"), "utf8")).text;
  writeFileSync(runFile(folder, "result.md"), result);

  // The state rule: the first match wins.
  if (w.cause?.kind === "stalled") return fail("stalled", w.cause.reason, w.cause.limit);
  if (w.cause?.kind === "timeout") {
    const s = workSeconds(run);
    const last = result.trim() && ` Last message: ${result.trim().slice(0, 500)}`;
    return fail("timeout", `The worker ${w.cause.reason} at its ${s % 60 === 0 ? `${s / 60}-minute` : `${s}-second`} time box and was stopped.${last}`, s);
  }
  if (w.cause?.kind === "credit") return fail("credit", w.cause.reason);
  if (w.step.code !== 0) return { outcome: { state: "failed", cause: "other", reason: `worker exited ${w.step.code}` }, code: w.step.code };
  const question = questionOf(result);
  if (question !== undefined) return { outcome: { ...waiting("question", question), question }, code: 0 };
  const dirty = git(wt, "status", "--porcelain").out;
  if (dirty) return fail("other", `uncommitted: ${dirty.split("\n")[0].slice(3)}`);
  const refetched = fetchOrigin(wt);
  if (!refetched.ok) {
    logTo(folder, "setup", `## fetch: failed\n${refetched.out}\n`);
    return fail("infra", `fetch failed: ${refetched.out}`);
  }
  const bf = branchFacts(repo, mainRef(repo.path, repo.main), `refs/heads/${run.branch!}`);
  if (!bf) {
    removeBranch(repo, run);
    return { outcome: { state: "done", reason: "no commits" }, code: 0 };
  }
  const { base, changed } = bf;
  stampJob(wt, base, run, id);
  const failed = await runChecks(taskOf(folder, repo, changed, () => phase("verify")), inWorktree(wt, checkEnv));
  if (failed) return { outcome: { state: "failed", ...stopFields(failed) }, code: 1 };
  const matches = (globs: string[]) => changed.some((f) => globs.some((g) => new Bun.Glob(g).match(f)));
  // A manual check does not hold the run: it lands with the check open (see land).
  const manual = repo.manual.find((m) => matches(m.when));
  return { outcome: { state: "passed", checkedBase: base, checkedTip: git(wt, "rev-parse", "HEAD").out, ...(manual ? { say: manual.say } : {}) }, code: 0 };
}

/**
 * A factory worker's run after its worker: the fields of its structured output, then the worker verdict on its branch.
 * A reply with no structured output fails. Only the branch's commits count: what the worker left uncommitted is not checked.
 */
async function factoryVerdict(id: string, folder: string, run: Run, repo: Repo, w: Reply, env: Record<string, string | undefined>): Promise<{ outcome: Outcome; code: number }> {
  const tip = `refs/heads/${run.branch!}`;
  const main = mainRef(repo.path, repo.main);
  const stop = (cause: Cause, reason: string, extra: Partial<Outcome> = {}) => ({ outcome: { state: "failed" as const, cause, reason, ...extra }, code: 1 });
  const reply = parseWorker(w.data);
  writeFileSync(runFile(folder, "result.md"), typeof reply === "string" ? w.text : reply.summary);
  const facts: Partial<Outcome> = w.cost !== undefined ? { cost: w.cost } : {};
  if (typeof reply !== "string") {
    Object.assign(facts, { defaults: reply.defaults, followups: reply.followups.map((f) => f.title) }, reply.alreadyMet !== null ? { alreadyMet: reply.alreadyMet } : {}, reply.question !== null ? { question: reply.question } : {});
    await fileFollowups(repo, run, reply.followups, reply.flakes);
  }
  if (w.cause) return stop(w.cause.kind, w.cause.reason, { ...facts, limit: w.cause.limit });
  if (typeof reply === "string") return stop("other", `worker: ${reply}`, facts);
  { const f = fetchOrigin(repo.path); if (!f.ok) return stop("infra", `fetch failed: ${f.out}`, facts); }
  const bf = branchFacts(repo, main, tip);
  if (!bf) return stop("no-commit", "no commit", facts);
  const { base, changed, checked } = bf;

  // The fix rounds so far are those of jobs of this target; the runs sent back say what they failed.
  const done = jobRecord.roundsOf(run.target ?? id);
  if (done) facts.round = done;
  const earlier = earlierRounds(jobById(id) ?? [], id);
  return workerVerdict({ earlier: earlier.map((e) => e.run), done, rounds: fixRounds(), facts, checked }, branchPorts(folder, run, repo, base, run.branch!, { changed, earlier, docClaims: () => docClaims(folder, reply.summary), env, ...ports }));
}

/**
 * A recheck: no worker. The run branch takes origin/<main> by a merge made in
 * memory (a conflict fails the run and names the files), the checks run
 * on the result, then the held rule and the reviewer, as after a worker.
 */
async function recheck(folder: string, run: Run, repo: Repo, env: Record<string, string | undefined>): Promise<{ outcome: Outcome; code: number }> {
  const branch = run.branch!;
  const ref = `refs/heads/${branch}`;
  const main = mainRef(repo.path, repo.main);
  const phase = (p: string) => jobRecord.patchRun(jobOfFolder(folder), { phase: p });
  const stop = (cause: Cause, reason: string, extra: Partial<Outcome> = {}) => ({ outcome: { state: "failed" as const, cause, reason, ...extra }, code: 1 });
  phase("setup");
  { const f = fetchOrigin(repo.path); if (!f.ok) return stop("infra", `fetch failed: ${f.out}`); }
  const tip = git(repo.path, "rev-parse", "--verify", "-q", ref);
  if (!tip.ok) return stop("other", `branch gone: ${branch}`);
  const upstream = git(repo.path, "rev-parse", main).out;
  phase("merge");
  if (!git(repo.path, "merge-base", "--is-ancestor", upstream, tip.out).ok) {
    const merged = git(repo.path, "merge-tree", "--write-tree", "--name-only", tip.out, upstream);
    if (!merged.ok) {
      const conflicts = conflictsOf(merged.out);
      return stop("conflict", `merge conflict: ${conflicts.join(", ")}`, { conflicts });
    }
    const c = git(repo.path, "commit-tree", merged.out.split("\n")[0], "-p", tip.out, "-p", upstream, "-m", `Merge ${repo.main} into ${branch}`);
    if (!c.ok || !git(repo.path, "update-ref", ref, c.out, tip.out).ok) return stop("other", `merge failed: ${c.out}`);
    // The job's worktree has the branch checked out: its files follow the moved branch.
    if (run.worktree && existsSync(run.worktree)) git(run.worktree, "reset", "-q", "--hard");
  }
  const bf = branchFacts(repo, main, ref);
  if (!bf) return stop("no-commit", "no commit");
  const { base, changed, checked } = bf;
  return workerVerdict({ rounds: fixRounds(), facts: {}, checked }, branchPorts(folder, run, repo, base, branch, { changed, env, ...ports }));
}
