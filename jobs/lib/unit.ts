/**
 * `aleph unit <run-folder>`: the body of one run, inside its systemd unit.
 * An agent run is setup, the worker, then the state rule; a plain run is one
 * command. Both end with state.json, then `exit`, then the news.
 */
import { SCENARIOS, seal } from "./author.ts";
import { appendFileSync, closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import * as issues from "../../todo/lib/todo.ts";
import { closeAndFile, file as fileIssues, note, noteFlake, readHidden, reader } from "../../todo/lib/store.ts";
import { addWorktree, fetchOrigin, git, jobCommit } from "./git.ts";
import { ALREADY_MET, heldRule, securityChange, testFindings, outcome as agentOutcome, verdict as reviewVerdict } from "./gate.ts";
import { needsOf, plainAsk } from "./ask.ts";
import { tagged, askOf, isAwaiting, isBuild, onOf, readCall, testParallel, allRuns, loadRegistry, lock, newsLine, readEnvFile, readRun, runsDir, tell, updateRun, type Check, type CheckResult, type Entry, type Repo, type Run } from "./ledger.ts";
import type { Cause } from "./outcome.ts";
import { allJobs, jobById, notes, openJob, readFile } from "./job.ts";
import { bridge, sandboxNetnsPid } from "./netns.ts";
import { serveShots } from "./shot.ts";
import { citationFailure, deliver, isResearch, JUDGE_MODEL, judgePrompt, readVerdict, RESEARCH_PROMPT, serveFetches, writeWebServer } from "./research.ts";
import { makeRunFolder, removeRunFolder, runPath, sandboxed, stallReason, stallSeconds, workerToken } from "./sandbox.ts";
import { lastLines, oracleCommands, sandboxRunner, type Runner } from "./acceptance.ts";
import { checksInSandbox, runChecks, stopFields, type ChecksStop } from "./checks.ts";
import { dispatchDetached } from "./factory.ts";
import { gates } from "./factory-status.ts";
import { keepDiff } from "./jobdiff.ts";
import { afterLand, bounceNote, isMergeBounce, land, mergePrompt, MERGE_MODEL, MERGE_SECONDS, removeBranch, waitingToLand, type LandPorts } from "./landing.ts";
import { startReview } from "./review.ts";
import { postTrace } from "./trace.ts";
import { runLogged, startUnit } from "./launch.ts";
import { land as startLand, startJob } from "./transitions.ts";
import { FACTS_REF, itemOnMain, writeFacts } from "./status.ts";
import { checkSeconds, dispatchOn, fixRounds, jobSeconds, reviewDiffMax, reviewerCmd, reviewSeconds, workerCmd } from "./settings.ts";

export { git };
/** srt write-protects .gitmodules with an unreadable placeholder; git warns when it reads it. These settings stop that read. */
export const NO_SUBMODULES = ["git config fetch.recurseSubmodules false", "git config submodule.recurse false"];

let child: ReturnType<typeof Bun.spawn> | null = null;


interface Exec { code: number; timedOut: boolean }

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
  child = null;
  closeSync(fd);
  return { code, timedOut: o.limit !== undefined && performance.now() - start >= o.limit * 1000 };
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

// A worker that backgrounds a command and ends its turn is never woken again in a headless run.
const FOREGROUND = "Run every command in the foreground and wait for it: nothing wakes you after your turn ends.";

const FIXED = (run: Run, main: string) => `You are a worker on job \`${run.name}\` in \`${run.worktree}\`, branch \`${run.branch}\`. Work
only there. Commit every change on the branch; the run fails if anything is
left uncommitted or untracked. Never merge, never push, never touch another
branch. \`aleph issue\` is not your push: it writes the list of issues on main by
itself, so use it for every change to the list. If the previous run was a
failed land, merge \`origin/${main}\` into the branch, resolve the conflicts,
and commit. If you need a decision from Chris, stop
and make your last line \`QUESTION: <one question>\`. ${FOREGROUND} End with a
short summary of what you did and what you ran.`;

/** What the worker runs before it ends: the repo's own checks, else today's sentence. */
function checksSentence(checks: Check[]): string {
  if (!checks.length) return "Run the repo's tests before you end.";
  const list = checks.map((c) => `\n- \`${c.name}\`: \`${c.run}\`${c.when?.length ? ` (when ${c.when.join(", ")} change)` : ""}`).join("");
  return `Run each of the repo's checks before you end, and fix what fails:${list}\n`;
}

const FACTORY = (run: Run, main: string, checks: Check[] = []) => `You are a worker on job \`${run.name}\`, in a git repo on branch \`${run.branch}\`, inside
a sandbox. You see this repo and nothing else of the machine, and the network
reaches only the Anthropic API and npm. Do the goal below. Commit every change
on the branch: only commits leave the sandbox. Never switch to another branch
and never push. If the previous run's land conflicted, merge \`origin/${main}\`
into the branch and resolve the conflicts so that both changes survive. Nobody
answers questions during the run: when you must choose, take the answer you
would recommend and print a line \`DEFAULT: <question> -> <answer>\`. For work
you find but do not do, print a line \`FOLLOWUP: <title>\`. A test that fails or times out and is not the goal's own, and passes again alone or on a rerun, is a flake: print one line \`FLAKE: <test file> > <test name>: <what you saw>\` and no \`FOLLOWUP:\` for it. End the result with zero or more lines
\`FACT: <one sentence> [source: <file:line | commit sha | https URL>]\`, for durable
facts about the repo or its tools that you learned and checked. If the goal already
holds on your branch and no edit is needed, make no commit, run the repo's tests,
and print exactly one line \`${ALREADY_MET}: <evidence>\`, the evidence being the
files, the lines and the commit on \`${main}\` that show it. A worker that
cannot do the goal makes no commit and gives the reason in its final text; it does not commit a note.
${checksSentence(checks)} Chrome cannot start in the sandbox. For a screenshot of a page
served by your own server on 127.0.0.1, run \`aleph-shot <url> <out.png> [--width 1440] [--height 900] [--scheme light|dark] [--click <css selector>] [--wait <ms>]\`:
the factory takes the shot outside the sandbox and writes the PNG at the path, which must be inside the repo, and you commit it.
Only \`http://127.0.0.1:<port>\` URLs of your own server are loaded. ${FOREGROUND} End with a short summary of what you did and what you ran.`;

/** The fixed text, the spec, every note in order, and the previous run's files. */
export function prompt(id: string, folder: string, run: Run, repo: Repo): string {
  const first = join(folder, "..", run.job);
  if (run.merge) {
    const land = (jobById(run.job) ?? []).filter((e) => e.run.kind === "land" && e.id !== id).at(-1)?.run;
    const n = onOf(run);
    return mergePrompt(land ?? run, repo, run.repo && n !== undefined ? reader().item(run.repo, n)?.title : undefined);
  }
  const parts = [(repo.sandbox ? FACTORY(run, repo.main, repo.checks ?? []) : FIXED(run, repo.main)), `## Spec\n\n${readFileSync(join(first, "spec.md"), "utf8").trim()}`];
  const runs = jobById(run.job) ?? [];
  if (runs.length) for (const n of notes(runs)) parts.push(`## Note ${n.name}\n\n${n.text.trim()}`);
  const prev = runs[runs.findIndex((e) => e.id === id) - 1];
  if (prev) {
    const p = prev.run;
    parts.push(`## Previous run: ${p.kind}, ${p.condition}${needsOf(askOf(p)) ? ` (${needsOf(askOf(p))})` : ""}${p.reason ? `: ${p.reason}` : ""}`);
    for (const f of ["result.md", "checks.log", "land.log"] as const) {
      const text = readFile(prev, f);
      if (text !== undefined) parts.push(`### ${f}\n\n${text.trim()}`);
    }
  }
  return parts.join("\n\n") + "\n";
}

/** A recorder that starts the run's `checks` over and adds each check that ran. */
function recorder(folder: string): (c: CheckResult) => void {
  let all: CheckResult[] = [];
  updateRun(folder, { checks: all });
  return (c) => { all = [...all, c]; updateRun(folder, { checks: all }); };
}

/**
 * Where a job's work is on origin/<main>, or null. First a `Job:` trailer: the
 * squash carries one, and so does each worker commit. Then, while the branch
 * exists and has a net change, a merge of it into main that leaves main's tree
 * as it is: the work is already there, however it got there.
 */
export function onMain(repo: Repo, run: Run): { commit: string; how: string } | null {
  const main = `origin/${repo.main}`;
  const trailer = jobCommit(repo.path, repo.main, run.job);
  if (trailer) return { commit: trailer, how: "Job trailer" };
  if (!run.branch) return null;
  const tip = git(repo.path, "rev-parse", "--verify", "-q", `refs/heads/${run.branch}`);
  if (!tip.ok) return null;
  const fork = git(repo.path, "merge-base", tip.out, main).out;
  const treeOf = (rev: string) => git(repo.path, "rev-parse", `${rev}^{tree}`).out;
  if (!fork || treeOf(tip.out) === treeOf(fork)) return null;
  const merged = git(repo.path, "merge-tree", "--write-tree", main, tip.out);
  if (merged.ok && merged.out.split("\n")[0] === treeOf(main)) return { commit: git(repo.path, "rev-parse", main).out, how: "content" };
  return null;
}

/**
 * Passed runs of the repo waiting to land that have no land run yet: start
 * `aleph land` for them, so they queue on the lock and join this batch. Not
 * while the factory is paused or held, as the dispatch would not land them.
 */
async function pullWaiting(repo: Repo, run: Run, room: number): Promise<void> {
  if (gates({ only: ["pause", "hold"], except: run.job })) return;
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

/** The land's checks: in the sandbox for a sandbox repo, else in the worktree of a run that still has one. */
function landPorts({ id, folder, run }: Entry, repo: Repo, env: Record<string, string | undefined>): LandPorts {
  const phase = (p: string) => updateRun(folder, { phase: p });
  const logFile = join(folder, "checks.log");
  return {
    pull: (room) => pullWaiting(repo, run, room),
    check: async (commit, runs, changed) => {
      const before = existsSync(logFile) ? readFileSync(logFile, "utf8").length : 0;
      let why: ChecksStop | null;
      if (repo.sandbox) {
        const hidden: Record<string, string> = {};
        let readable = true;
        for (const r of runs) {
          const files = hiddenOf(repo, r);
          if (!files) { readable = false; break; }
          for (const [name, text] of Object.entries(files)) hidden[name in hidden ? `${r.on ?? onOf(r)}-${name}` : name] = text;
        }
        why = readable ? await sandboxChecks(id, folder, repo, commit, changed, phase, hidden) : { cause: "infra", reason: HIDDEN_UNREADABLE };
      } else {
        const owner = runs.find((r) => r.worktree && existsSync(r.worktree)) ?? runs[0];
        why = await worktreeChecks(folder, owner, repo, env, commit, changed, phase);
      }
      return { why, checks: readRun(folder)?.checks, log: existsSync(logFile) ? readFileSync(logFile, "utf8").slice(before) : undefined };
    },
  };
}

/** The checks on the tree in `wt`, with the given environment. */
const inWorktree = (folder: string, wt: string, repo: Repo, env: Record<string, string | undefined>, changed: string[], phase: (p: string) => void) =>
  runChecks({ folder, repo, changed, phase, record: recorder(folder), onSpawn: (p) => { child = p; } }, (check, out, limit) => exec(["bash", "-c", check.run], { cwd: wt, env, out, limit }));

/** The checks on `commit`, in the job's worktree, which is back on its branch after. */
async function worktreeChecks(folder: string, run: Run, repo: Repo, env: Record<string, string | undefined>, commit: string, changed: string[], phase: (p: string) => void): Promise<ChecksStop | null> {
  const wt = run.worktree!;
  if (!existsSync(wt)) return { cause: "infra", reason: `worktree gone: ${wt}` };
  if (!git(wt, "checkout", "-q", "--detach", commit).ok) return { cause: "infra", reason: "checkout failed" };
  try {
    return await inWorktree(folder, wt, repo, env, changed, phase);
  } finally {
    git(wt, "checkout", "-q", "-f", run.branch!);
  }
}

const HIDDEN_UNREADABLE = "hidden checks unreadable";

/** The hidden test files of the run's item, none for a run with no item, or null when the work store cannot be read: such a run must not pass without them. Its scenarios go to the reviewer, not to a check. */
function hiddenOf(repo: Repo, run: Run): Record<string, string> | null {
  const id = onOf(run);
  if (id === undefined) return {};
  try {
    const { [SCENARIOS]: _, ...tests } = readHidden(repo, id);
    return tests;
  } catch { return null; }
}

/** The checks on a land's squash commit: the commit goes in as a bundle. */
async function sandboxChecks(id: string, folder: string, repo: Repo, commit: string, changed: string[], phase: (p: string) => void, hidden: Record<string, string>): Promise<ChecksStop | null> {
  const dir = makeRunFolder(id);
  const ref = `refs/aleph/land/${id}`;
  try {
    git(repo.path, "update-ref", ref, commit);
    const b = git(repo.path, "bundle", "create", join(dir, "out", "land.bundle"), ref);
    if (!b.ok) return { cause: "infra", reason: `bundle failed: ${b.out}` };
    return await checksInSandbox({ folder, repo, changed, phase, record: recorder(folder), onSpawn: (p) => { child = p; } }, dir, "out/land.bundle", ref, hidden);
  } finally {
    git(repo.path, "update-ref", "-d", ref);
    removeRunFolder(dir);
  }
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

type Outcome = Pick<Run, "condition" | "ask" | "reason" | "cause" | "checkName" | "question" | "say" | "commit" | "conflicts" | "checkItem" | "failed" | "round" | "cost" | "defaults" | "stat" | "checkedBase" | "checkedTip">;

/** A verdict that waits for Chris: the condition `awaiting` and the Ask. */
/** The outcome of a factory run that the check runners stopped. */
const stoppedByChecks = (why: ChecksStop, extra: Partial<Outcome> = {}) => ({ outcome: { condition: "stuck" as const, ...stopFields(why), ...extra }, code: 1 });
const awaiting = (reason: string, question: string, why: string[] = []): Pick<Outcome, "condition" | "ask"> =>
  ({ condition: "awaiting", ask: plainAsk(reason, question, why.filter(Boolean)) });

export async function unit(folder: string): Promise<void> {
  // drop sends SIGTERM when no systemd unit is there to stop the cgroup.
  process.on("SIGTERM", () => {
    if (child) {
      try { process.kill(-child.pid, "SIGKILL"); } catch {}
      try { child.kill("SIGKILL"); } catch {}
    }
    process.exit(143);
  });
  writeFileSync(join(folder, "pid"), String(process.pid));
  const id = basename(folder);
  const run = readRun(folder)!;
  const repo = run.repo ? loadRegistry()[run.repo] : undefined;
  const dispatcherPath = runPath();
  const env: Record<string, string | undefined> = {
    ...process.env, ...readEnvFile(repo?.env ?? process.env.ALEPH_RUN_ENV),
    PATH: dispatcherPath, HOME: homedir(), ALEPH_JOB_ID: run.job, ALEPH_JOB_RUN: id, ALEPH_TEST_PARALLEL: String(testParallel()),
  };
  delete env.ANTHROPIC_API_KEY;
  delete env.CLAUDECODE;
  delete env.ALEPH_RUN_ENV;

  // The job variables are for the worker: a check that runs aleph's own tests must not see them.
  const checkEnv = { ...env, ALEPH_JOB_ID: undefined, ALEPH_JOB_RUN: undefined };

  let outcome: Outcome;
  let code = 0;
  try {
    if (run.kind === "plain") {
      const r = await exec(["bash", "-c", readFileSync(join(folder, "command.txt"), "utf8")], { cwd: process.cwd(), env, out: join(folder, "output.log") });
      code = r.code;
      outcome = code === 0 ? { condition: "done" } : { condition: "failed", cause: "other", reason: `exited ${code}` };
    } else if (run.kind === "land") {
      const entry = { id, folder, run };
      ({ outcome, code } = await land(entry, repo!, landPorts(entry, repo!, checkEnv)));
    } else if (run.kind === "recheck") {
      ({ outcome, code } = await recheck(id, folder, run, repo!));
    } else if (repo!.sandbox && onOf(run) !== undefined && isResearch(reader().item(repo!.key, onOf(run)!))) {
      ({ outcome, code } = await researchAgent(id, folder, run, repo!));
    } else if (repo!.sandbox) {
      ({ outcome, code } = await factoryAgent(id, folder, run, repo!));
    } else {
      ({ outcome, code } = await agent(id, folder, run, repo!, env, checkEnv));
    }
  } catch (e: any) {
    outcome = { condition: "failed", cause: "other", reason: `error: ${e?.message ?? e}` };
    code = 1;
  }

  let ended = updateRun(folder, { ...outcome, phase: undefined, ended: new Date().toISOString() });
  const next = nextStep(ended, repo);
  if (next) ended = updateRun(folder, { next });
  writeFileSync(join(folder, "exit"), String(code));
  process.exitCode = code;
  if (isBuild(run.kind) || run.kind === "recheck") startReview(folder);
  if ((isBuild(run.kind) || run.kind === "recheck") && repo?.sandbox) await postTrace(folder, id, ended, run.repo!);
  if (await tell(newsLine(ended, repo?.note))) updateRun(folder, { told: true });
  if (next) await start(folder, ended, next);
  if (run.kind !== "plain" && dispatchOn()) await dispatchFree(folder);
}

/** A run ended, so a slot may be free: `aleph dispatch` starts the ready goals. Its output goes to dispatch.log. */
async function dispatchFree(folder: string): Promise<void> {
  await runLogged(["dispatch"], join(folder, "dispatch.log"));
}


/**
 * What the unit starts after a run ends. A land follows afterLand; an agent run
 * lands when it passes, when it was started with --land or its repo lands by itself.
 */
function nextStep(run: Run, repo: Repo | undefined): Run["next"] {
  if (isBuild(run.kind) && run.failed) return "worker";
  if (isBuild(run.kind) || run.kind === "recheck") return run.condition === "passed" && (run.land || repo?.autoland) ? "land" : undefined;
  return run.kind === "land" ? afterLand(run) : undefined;
}

/** The worker's time limit: a merge run has a short one. */
const workSeconds = (run: Run): number => (run.merge ? MERGE_SECONDS : jobSeconds());

/** The last 80 lines of the named check's section of the run's checks.log. */
function checkLog(folder: string, name: string): string {
  const file = join(folder, "checks.log");
  if (!existsSync(file)) return "";
  const section = readFileSync(file, "utf8").split(/^## /m).findLast((x) => x.startsWith(`${name}: exit`)) ?? "";
  return section.split("\n").slice(1).join("\n").trimEnd().split("\n").slice(-80).join("\n");
}

/** The failing tests of a run's hidden.log, each with the lines of its failure that precede its `(fail)` line. */
function hiddenFailures(folder: string): { name: string; failure: string }[] {
  const file = join(folder, "hidden.log");
  const lines = (existsSync(file) ? readFileSync(file, "utf8") : "").split("\n");
  const seen = new Map<string, string>();
  let block: string[] = [];
  for (const line of lines) {
    const m = line.match(/^\(fail\) (.*?)(?: \[[\d.]+m?s\])?$/);
    if (m) {
      if (!seen.has(m[1])) seen.set(m[1], block.slice(-10).join("\n").slice(-600));
      block = [];
    } else if (/^\(pass\)/.test(line)) block = [];
    else if (line.trim()) block.push(line.trimEnd());
  }
  return [...seen].map(([name, failure]) => ({ name, failure }));
}

/**
 * A sealed test that fails unchanged twice: the run before this one also failed the hidden check with the same
 * failing names. A third blind fix round would guess again, so the Ask names the tests and quotes their failures,
 * and Chris tells a wrong test from a wrong branch. Null when the failures differ or there is no run before.
 */
function repeatedHidden(folder: string, earlier: { id: string; run: Run }[]): { question: string; names: string[] } | null {
  const prev = earlier.at(-1);
  if (!prev || prev.run.failed !== "hidden") return null;
  const now = hiddenFailures(folder);
  const before = hiddenFailures(join(runsDir(), prev.id)).map((f) => f.name).sort();
  const names = now.map((f) => f.name).sort();
  if (!names.length || names.join("\n") !== before.join("\n")) return null;
  const quoted = now.slice(0, 5).map((f) => `- ${f.name}${f.failure ? `\n${f.failure.split("\n").map((l) => `    ${l}`).join("\n")}` : ""}`).join("\n");
  return {
    names,
    question: `The sealed test${names.length > 1 ? "s" : ""} failed the same way on two runs in a row, so no blind fix round starts. The failing test${names.length > 1 ? "s" : ""} and the failure:\n${quoted}\nIs the test wrong, or the branch? Answer to send the worker back with your reading, or drop the run.`,
  };
}

/**
 * The fix-round note for a failed hidden check: the reason and the names of
 * the failing tests, read from hidden.log. Never the log, never the source.
 */
function hiddenNote(folder: string, run: Run): string {
  const names = hiddenFailures(folder).map((f) => f.name);
  return `${run.reason}\n${names.length ? `\nThe failing tests:\n${names.map((n) => `- ${n}`).join("\n")}\n` : ""}\nThe tests are hidden: their source and log are not available. Fix the cause, run the tests, and commit.`;
}

/** Start the next run as `aleph land` or `aleph job` would, in-process. What it prints and its refusal go to next.log. */
async function start(folder: string, run: Run, next: NonNullable<Run["next"]>): Promise<void> {
  if (gates({ only: ["pause"] })) {
    appendFileSync(join(folder, "next.log"), `paused: no ${next} started\n`);
    updateRun(folder, { next: undefined });
    return;
  }
  const dropped = (jobById(run.job) ?? []).some((e) => e.run.condition === "dropped");
  const repo = run.repo ? loadRegistry()[run.repo] : undefined;
  if (repo && !dropped && onOf(run) !== undefined) fetchOrigin(repo.path);
  const there = dropped ? null : itemOnMain(repo, onOf(run));
  if (dropped || there) {
    appendFileSync(join(folder, "next.log"), dropped ? `dropped: no ${next} started\n` : `item landed as ${there}: no ${next} started\n`);
    updateRun(folder, { next: undefined });
    return;
  }
  const h = next === "land" ? gates({ only: ["hold"], except: run.job }) : null;
  if (h) {
    appendFileSync(join(folder, "next.log"), `held: ${h.why}\n`);
    updateRun(folder, { next: undefined });
    return;
  }
  const note = run.failed === "hidden"
    ? hiddenNote(folder, run)
    : run.failed === "review"
    ? `The reviewer sent this branch back: ${run.reason}\n\nFix what it names, run the tests, and commit.`
    : run.failed
    ? `The check \`${run.failed}\` failed on this branch. The last 80 lines of its log:\n\n${checkLog(folder, run.failed)}\n\nFix the cause, run the tests, and commit.`
    : bounceNote(run);
  const merge = next === "worker" && !run.failed && isMergeBounce(run);
  const log = join(folder, "next.log");
  try {
    const s = next === "land"
      ? await startLand(run.name, {}, { output: { file: log } })
      : await startJob({ repo: run.repo!, name: run.name, spec: note, land: true, ...(merge ? { merge: true, model: MERGE_MODEL } : {}) }, { output: { file: log } });
    appendFileSync(log, JSON.stringify(s.started, null, 2) + "\n");
    await s.child?.exited;
  } catch (e: any) {
    appendFileSync(log, `${String(e?.message ?? e)}\n`);
    updateRun(folder, { next: undefined });
  }
}

async function agent(id: string, folder: string, run: Run, repo: Repo, env: Record<string, string | undefined>, checkEnv: Record<string, string | undefined>): Promise<{ outcome: Outcome; code: number }> {
  const wt = run.worktree!;
  const branch = run.branch!;
  const phase = (p: string) => updateRun(folder, { phase: p });
  const fail = (cause: Cause, reason: string) => ({ outcome: { condition: "failed" as const, cause, reason }, code: 1 });

  // A new job starts from origin/<main>, after it clears what an ended job of that name left.
  if (run.job === id || !existsSync(wt)) {
    phase("setup");
    // Units of one repo share its .git: a concurrent worktree add fails on the config lock, prune removes another's
    // half-made worktree entry, and fetch can fail on shared files. One unit at a time runs these git writes.
    const release = await lock(`setup-${repo.key}`, 300_000);
    if (!release) return fail("other", "setup lock busy");
    try {
      const fetched = fetchOrigin(repo.path);
      if (!fetched.ok) {
        appendFileSync(join(folder, "setup.log"), `## fetch: failed\n${fetched.out}\n`);
        return fail("infra", `fetch failed: ${fetched.out}`);
      }
      // An ended job of this name is cleared below: its run folder keeps the diff first.
      const old = allRuns().findLast((e) => e.id !== id && e.run.repo === repo.key && e.run.name === run.name && e.run.branch === branch);
      if (old) keepDiff(repo, branch, old.folder);
      const add = addWorktree(repo.path, wt, branch, `origin/${repo.main}`);
      if (!add.ok) return fail("other", `worktree add failed: ${add.out}`);
    } finally {
      release();
    }
  }

  const marker = join(git(wt, "rev-parse", "--absolute-git-dir").out, "aleph-setup");
  if (!existsSync(marker)) {
    phase("setup");
    for (const cmd of repo.setup) {
      appendFileSync(join(folder, "setup.log"), `## ${cmd}\n`);
      const r = await exec(["bash", "-c", cmd], { cwd: wt, env: checkEnv, out: join(folder, "setup.log"), limit: checkSeconds() });
      if (r.timedOut) return fail("stalled", `timed out: setup ${cmd}`);
      if (r.code !== 0) return fail("other", `setup failed: ${cmd}`);
    }
    writeFileSync(marker, "");
  }

  // The worker cannot push to github or reach gh; see "No push, no gh" in the spec.
  const ghDir = join(folder, "gh");
  mkdirSync(ghDir, { recursive: true });
  const workerEnv = {
    ...env, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "url.aleph-no-push:.pushInsteadOf", GIT_CONFIG_VALUE_0: "git@github.com:",
    GH_CONFIG_DIR: ghDir, GH_TOKEN: undefined, GITHUB_TOKEN: undefined, CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1",
  };
  const argv = [workerCmd(), "-p", "--tools", "Read", "Write", "Edit", "Bash", "Grep", "Glob", "Skill",
    "--session-id", run.session!, "--output-format", "stream-json", "--verbose", "--permission-mode", "bypassPermissions",
    ...(run.model ? ["--model", run.model] : [])];
  const text = prompt(id, folder, run, repo);
  writeFileSync(join(folder, "prompt.md"), text);
  phase("worker");
  const w = await exec(argv, { cwd: wt, env: workerEnv, out: join(folder, "output.log"), limit: workSeconds(run), stdin: text });
  const result = resultText(readFileSync(join(folder, "output.log"), "utf8"));
  writeFileSync(join(folder, "result.md"), result);

  // The state rule: the first match wins.
  if (w.timedOut) return fail("stalled", "timed out: worker");
  if (w.code !== 0) return { outcome: { condition: "failed", cause: "other", reason: `worker exited ${w.code}` }, code: w.code };
  const question = result.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("QUESTION:")).at(-1);
  if (question) return { outcome: { ...awaiting("question", question.slice("QUESTION:".length).trim()), question: question.slice("QUESTION:".length).trim() }, code: 0 };
  const dirty = git(wt, "status", "--porcelain").out;
  if (dirty) return fail("other", `uncommitted: ${dirty.split("\n")[0].slice(3)}`);
  const refetched = fetchOrigin(wt);
  if (!refetched.ok) {
    appendFileSync(join(folder, "setup.log"), `## fetch: failed\n${refetched.out}\n`);
    return fail("infra", `fetch failed: ${refetched.out}`);
  }
  const base = git(wt, "merge-base", `origin/${repo.main}`, "HEAD").out;
  if (git(wt, "rev-list", "--count", `${base}..HEAD`).out === "0") {
    removeBranch(repo, run);
    return { outcome: { condition: "done", reason: "no commits" }, code: 0 };
  }
  stampJob(wt, base, run.job);
  const changed = git(wt, "diff", "--name-only", base, "HEAD").out.split("\n").filter(Boolean);
  const failed = await inWorktree(folder, wt, repo, checkEnv, changed, phase);
  if (failed) return { outcome: { condition: "failed", ...stopFields(failed) }, code: 1 };
  const matches = (globs: string[]) => changed.some((f) => globs.some((g) => new Bun.Glob(g).match(f)));
  // A manual check does not hold the run: it lands with the check open (see land).
  const manual = repo.manual.find((m) => matches(m.when));
  return { outcome: { condition: "passed", checkedBase: base, checkedTip: git(wt, "rev-parse", "HEAD").out, ...(manual ? { say: manual.say } : {}) }, code: 0 };
}

/**
 * A factory run. The worker gets origin/<main>, and the job's branch when a
 * previous run left one, as a bundle; it runs under srt with an empty home
 * and the worker token as its only secret. A second srt call bundles the
 * branch, aleph fetches it, and a third runs the checks on a fresh clone.
 * The run folder goes when the verdict is known. See the seed spec's "Sandbox".
 */
async function factoryAgent(id: string, folder: string, run: Run, repo: Repo): Promise<{ outcome: Outcome; code: number }> {
  const branch = run.branch!;
  const main = `refs/remotes/origin/${repo.main}`;
  const phase = (p: string) => updateRun(folder, { phase: p });
  const stuck = (cause: Cause, reason: string, extra: Partial<Outcome> = {}) => ({ outcome: { condition: "stuck" as const, cause, reason, ...extra }, code: 1 });
  phase("setup");
  { const f = fetchOrigin(repo.path); if (!f.ok) return stuck("infra", `fetch failed: ${f.out}`); }
  const prev = git(repo.path, "rev-parse", "--verify", "-q", `refs/heads/${branch}`).ok;
  const dir = makeRunFolder(id);
  try {
    // The store and ledger facts ride along, so `aleph status` inside answers as it does outside.
    const b = git(repo.path, "bundle", "create", join(dir, "in.bundle"), main, writeFacts(repo), ...(prev ? [`refs/heads/${branch}`] : []));
    if (!b.ok) return stuck("infra", `bundle failed: ${b.out}`);
    const text = prompt(id, folder, run, repo);
    writeFileSync(join(folder, "prompt.md"), text);
    const goalId = onOf(run);
    let authorCost: number | undefined;
    if (repo.author && !prev && goalId !== undefined) {
      phase("scenarios");
      authorCost = await seal(repo, goalId);
    }
    const argv = [workerCmd(), "-p", "--session-id", run.session!, "--output-format", "stream-json", "--verbose", "--permission-mode", "bypassPermissions",
      ...(run.model ? ["--model", run.model] : [])];
    const q = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;
    // Setup output goes to stderr, so the worker's own stdout ends the transcript.
    const script = [
      "set -e", "exec 3>&1 1>&2", "git init -q .", ...NO_SUBMODULES,
      `git fetch -q ../in.bundle ${q(`+${main}:${main}`)} ${q(`+${FACTS_REF}:${FACTS_REF}`)}${prev ? ` ${q(`+refs/heads/${branch}:refs/heads/${branch}`)}` : ""}`,
      prev ? `git switch -q ${q(branch)}` : `git switch -q -c ${q(branch)} ${q(`origin/${repo.main}`)}`,
      ...repo.setup, "exec 1>&3 3>&-", `exec ${argv.map(q).join(" ")}`,
    ].join("\n");
    phase("worker");
    // Chrome stays outside the sandbox: the worker's shot requests are served here, through a bridge into its network namespace.
    const reach = async (url: string) => {
      const pid = child ? sandboxNetnsPid(child.pid) : null;
      if (pid === null) return { url, stop: async () => {} };
      const u = new URL(url);
      const b = await bridge(pid, Number(u.port));
      return { url: new URL(u.pathname + u.search + u.hash, b.url).href, stop: b.stop, stderr: b.stderr };
    };
    const shots = serveShots(dir, { reach });
    let w: Awaited<ReturnType<typeof sandboxed>>;
    try {
      w = await sandboxed(dir, script, {
        read: ["in.bundle"], write: ["home", "work", "tmp"], cwd: "work", stdin: text,
        env: { CLAUDE_CODE_OAUTH_TOKEN: workerToken(), CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1" },
        stdout: join(folder, "output.log"), stderr: join(folder, "stderr.log"), limit: workSeconds(run),
        stall: stallSeconds(),
        onSpawn: (p) => { child = p; },
      });
    } finally { await shots.stop(); }
    child = null;
    const o = agentOutcome(readFileSync(join(folder, "output.log"), "utf8"));
    writeFileSync(join(folder, "result.md"), o.result);
    const spent = (o.cost ?? 0) + (authorCost ?? 0);
    const facts: Partial<Outcome> = { ...(o.cost !== undefined || authorCost !== undefined ? { cost: spent } : {}), defaults: tagged(o.result, "DEFAULT") };
    fileFollowups(repo, run, tagged(o.result, "FOLLOWUP"));
    noteFlakes(repo, run, tagged(o.result, "FLAKE"));
    if (w.stalled) return stuck("stalled", stallReason(), facts);
    if (w.timedOut) return stuck("time-box", "time box", facts);
    if (!o.ok) return stuck("other", o.line, facts);

    // The worker's processes are gone with its sandbox. Only this step reads work/.
    phase("bundle");
    const out = await sandboxed(dir, `git bundle create -q ../out/out.bundle ${q(`refs/heads/${branch}`)}`, {
      read: ["work"], write: ["out"], cwd: "work", stdout: join(folder, "stderr.log"), stderr: join(folder, "stderr.log"),
    });
    if (out.code !== 0) return stuck("other", `no branch ${branch} to hand back`, facts);
    // The one operation on the worker's data: a fetch of its branch from the bundle.
    const f = git(repo.path, "fetch", "-q", join(dir, "out", "out.bundle"), `+refs/heads/${branch}:refs/heads/${branch}`);
    if (!f.ok) return stuck("other", `fetch of the bundle failed: ${f.out}`, facts);
    const base = git(repo.path, "merge-base", main, `refs/heads/${branch}`).out;
    if (git(repo.path, "rev-list", "--count", `${main}..refs/heads/${branch}`).out === "0") return stuck("no-commit", "no commit", facts);

    // Each earlier run of the job that a failed check sent back is a fix round.
    const earlierRuns = (jobById(run.job) ?? []).filter((e) => e.id !== id && isBuild(e.run.kind) && e.run.failed);
    const earlier = earlierRuns.map((e) => e.run);
    const done = earlier.length;
    if (done) facts.round = done;
    const changed = git(repo.path, "diff", "--name-only", base, `refs/heads/${branch}`).out.split("\n").filter(Boolean);
    if (changed.length > 0 && changed.every((f) => f === "result.md")) return stuck("no-commit", "no commit", facts);
    const hidden = hiddenOf(repo, run);
    if (!hidden) return stuck("infra", HIDDEN_UNREADABLE, facts);
    const failed = await checksInSandbox({ folder, repo, changed, phase, record: recorder(folder), onSpawn: (p) => { child = p; } }, dir, "out/out.bundle", `refs/heads/${branch}`, hidden);
    if (failed) {
      // A check that failed goes back to the worker, at most FIX_ROUNDS times a job.
      const check = readRun(folder)?.checks?.findLast((c) => !c.ok)?.name;
      const sent = !failed.timedOut && (failed.cause === "check" ? failed.checkName === check : check === "hidden" && failed.cause === "hidden-check");
      if (!check || !sent) return stoppedByChecks(failed, facts);
      const rounds = fixRounds();
      const same = check === "hidden" && done < rounds ? repeatedHidden(folder, earlierRuns) : null;
      if (same) return { outcome: { ...awaiting("question", same.question), question: same.question, cause: "hidden-check", reason: failed.reason, ...facts }, code: 0 };
      if (done < rounds) return stoppedByChecks(failed, { ...facts, failed: check, round: done });
      return stoppedByChecks(failed, { ...facts, ...(rounds > 0 ? { reason: `${failed.reason} after ${done} fix rounds` } : {}) });
    }
    facts.checkedBase = base;
    facts.checkedTip = git(repo.path, "rev-parse", `refs/heads/${branch}`).out;
    return await heldAndReview(id, folder, run, repo, dir, base, branch, facts, earlier);
  } finally {
    removeRunFolder(dir);
  }
}

/**
 * A research run (research.ts): no repo goes in and no branch comes out. The worker runs under srt with WebSearch and
 * fetch_page, the judge with no tools; a report that passes is delivered, the issue closes, and the run ends done, which does not land.
 */
async function researchAgent(id: string, folder: string, run: Run, repo: Repo): Promise<{ outcome: Outcome; code: number }> {
  const phase = (p: string) => updateRun(folder, { phase: p });
  const on = onOf(run)!;
  const item = reader().item(repo.key, on);
  if (!item) return { outcome: { condition: "stuck", cause: "other", reason: `no issue ${on}` }, code: 1 };
  const dir = makeRunFolder(id);
  try {
    const q = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;
    const claude = workerCmd();
    const common = ["--output-format", "stream-json", "--verbose", "--permission-mode", "bypassPermissions"];
    const env = { CLAUDE_CODE_OAUTH_TOKEN: workerToken(), CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1", ENABLE_TOOL_SEARCH: "false" };
    const net = { domains: ["api.anthropic.com"], localBinding: false };
    const log = join(folder, "output.log");
    const prior = jobById(run.job) ?? [];
    const before = prior[prior.findIndex((e) => e.id === id) - 1]?.run.reason;
    const goal = readFileSync(join(folder, "..", run.job, "spec.md"), "utf8").trim();
    const text = [RESEARCH_PROMPT, `## The goal\n\n${goal}`,
      ...notes(prior).map((n) => `## Note ${n.name}\n\n${n.text.trim()}`), ...(before ? [`## Why the previous report failed\n\n${before}`] : [])].join("\n\n") + "\n";
    writeFileSync(join(folder, "prompt.md"), text);
    const argv = [claude, "-p", "--session-id", run.session!, ...common, "--tools", "WebSearch", "--strict-mcp-config", "--mcp-config", writeWebServer(dir), ...(run.model ? ["--model", run.model] : [])];
    phase("worker");
    writeFileSync(log, "");
    const fetches = serveFetches(dir, log);
    let w: Awaited<ReturnType<typeof sandboxed>>;
    let pages: Map<string, string>;
    try {
      w = await sandboxed(dir, `exec ${argv.map(q).join(" ")}`, {
        read: [], write: ["home", "work", "tmp"], net, cwd: "work", stdin: text, env,
        stdout: log, stderr: join(folder, "stderr.log"), limit: jobSeconds(), stall: stallSeconds(),
        onSpawn: (p) => { child = p; },
      });
    } finally { pages = await fetches.stop(); }
    child = null;
    const o = agentOutcome(readFileSync(log, "utf8"));
    writeFileSync(join(folder, "result.md"), o.result);
    const facts: Partial<Outcome> = o.cost !== undefined ? { cost: o.cost } : {};
    const stuck = (cause: Cause, reason: string) => ({ outcome: { condition: "stuck" as const, cause, reason, ...facts }, code: 1 });
    if (w.stalled) return stuck("stalled", stallReason());
    if (w.timedOut) return stuck("time-box", "time box");
    if (!o.ok) return stuck("other", o.line);
    const cites = citationFailure(o.result, pages);
    if (cites) return stuck("other", cites);

    phase("judge");
    const judgeLog = join(folder, "judge.log");
    writeFileSync(judgeLog, "");
    const judgeArgv = [claude, "-p", ...common, "--tools", "", "--strict-mcp-config", "--model", JUDGE_MODEL];
    const j = await sandboxed(dir, `exec ${judgeArgv.map(q).join(" ")}`, {
      read: [], write: ["home", "work", "tmp"], net, cwd: "work", stdin: judgePrompt(goal, o.result, pages), env,
      stdout: judgeLog, stderr: join(folder, "stderr.log"), limit: jobSeconds(), stall: stallSeconds(),
      onSpawn: (p) => { child = p; },
    });
    child = null;
    const r = agentOutcome(readFileSync(judgeLog, "utf8"));
    if (r.cost !== undefined) facts.cost = (facts.cost ?? 0) + r.cost;
    if (j.timedOut || j.stalled || !r.ok) return stuck("other", `the judge did not finish: ${r.line}`);
    const v = readVerdict(r.result);
    if (!v.ok) return stuck("other", v.reason);

    const path = deliver(item.title, `${repo.key}-${on}`, o.result);
    const closed = closeAndFile(repo, `todo: research ${run.name} delivered`, on, `report: ${path}; ${v.reason}, ${pages.size} pages read`, []);
    return { outcome: { condition: "done", reason: `report: ${path}; ${v.reason}`, ...facts, ...(closed.todo ? { todo: closed.todo } : {}) }, code: 0 };
  } finally {
    removeRunFolder(dir);
  }
}

/** "once", "twice", "3 times". */
const times = (n: number) => n === 1 ? "once" : n === 2 ? "twice" : `${n} times`;

/**
 * After the checks pass: a security path waits for Chris with no reviewer. Else
 * the reviewer, then the held rule: a held run the reviewer passes gets the second
 * review, and `reviewBack` passes it when that says land. `earlier` is the runs
 * of the job that were sent back (a worker run; a recheck has none): a reviewer
 * finding goes back to the worker like a failed check, while rounds are left.
 */
export async function heldAndReview(id: string, folder: string, run: Run, repo: Repo, dir: string, base: string, branch: string, facts: Partial<Outcome>, earlier?: Run[], ports: { runner?: Runner; review?: typeof review } = {}): Promise<{ outcome: Outcome; code: number }> {
  const reviewer = ports.review ?? review;
  const phase = (p: string) => updateRun(folder, { phase: p });
  const stat = git(repo.path, "diff", "--stat", base, `refs/heads/${branch}`).out;
  const held = (rule: string) => ({ outcome: { ...awaiting("held-path", rule, [stat]), reason: rule, stat, ...facts }, code: 0 });
  const security = securityChange(repo.path, base, `refs/heads/${branch}`);
  if (security) return held(`held path ${security}`);
  const rule = heldRule(repo.path, repo.held, base, `refs/heads/${branch}`);
  const bad = await oracleFailure(folder, run, repo, branch, ports.runner ?? sandboxRunner, phase);
  if (bad) {
    const done = earlier?.length ?? 0;
    const rounds = fixRounds();
    const why = { cause: "check" as const, checkName: "oracle", reason: bad };
    if (earlier && done < rounds) return stoppedByChecks(why, { ...facts, failed: "oracle", round: done });
    return stoppedByChecks(why, { ...facts, ...(earlier && rounds > 0 ? { reason: `${bad} after ${done} fix rounds` } : {}) });
  }
  phase("review");
  const findings = testFindings(repo.path, base, `refs/heads/${branch}`);
  let rv = await reviewer(id, folder, run, repo, dir, base, branch, findings);
  if (rv.cost !== undefined) facts.cost = (facts.cost ?? 0) + rv.cost;
  // A reviewer that gave no verdict runs once more; a second miss is the reviewer's, not the
  // worker's: it goes to Chris whatever fix rounds are left, since a fix round cannot cure it.
  if (rv.none) {
    rv = await reviewer(id, folder, run, repo, dir, base, branch, findings);
    if (rv.cost !== undefined) facts.cost = (facts.cost ?? 0) + rv.cost;
  }
  if (!rv.reason) return rule ? held(rule) : { outcome: { condition: "passed", ...facts }, code: 0 };
  if (rv.none) return { outcome: { ...awaiting("review", rv.reason, [stat]), cause: "reviewer", reason: rv.reason, stat, ...facts }, code: 0 };
  if (earlier) {
    if (earlier.length < fixRounds()) return { outcome: { condition: "stuck", cause: "reviewer", reason: rv.reason, stat, ...facts, failed: "review", round: earlier.length }, code: 1 };
    const back = earlier.filter((r) => r.failed === "review").length;
    if (back) return { outcome: { ...awaiting("review", sentBack(back, rv.reason), [stat]), cause: "reviewer", reason: sentBack(back, rv.reason), stat, ...facts }, code: 0 };
  }
  return { outcome: { ...awaiting("review", rv.reason, [stat]), cause: "reviewer", reason: rv.reason, stat, ...facts }, code: 0 };
}

/**
 * The goal's Oracle commands, run on the branch in the sandbox before the reviewer.
 * A command the run's checks already ran is skipped; one that fails runs once more.
 * Returns the reason of the first that fails twice, or null. A sandbox fault is not a failure.
 */
async function oracleFailure(folder: string, run: Run, repo: Repo, branch: string, runner: Runner, phase: (p: string) => void): Promise<string | null> {
  const specFile = join(folder, "..", run.job, "spec.md");
  if (!existsSync(specFile)) return null;
  const ran = new Set((readRun(folder)?.checks ?? []).map((c) => c.name));
  const done = new Set(repo.checks.filter((c) => ran.has(c.name)).map((c) => c.run.trim()));
  const tip = git(repo.path, "rev-parse", `refs/heads/${branch}`).out;
  const hidden = hiddenOf(repo, run) ?? undefined;
  for (const command of oracleCommands(readFileSync(specFile, "utf8"))) {
    if (done.has(command)) continue;
    phase("check oracle");
    let r = await runner(repo, tip, command, hidden);
    if (r.infra) continue;
    let second = false;
    if (r.code !== 0) { second = true; r = await runner(repo, tip, command, hidden); if (r.infra) continue; }
    const out = `## oracle: exit ${r.code}${second ? " (second run)" : ""}\n$ ${command}\n${lastLines(r.output, 80).replaceAll(" ⏎ ", "\n")}\n\n`;
    appendFileSync(join(folder, "checks.log"), out);
    if (r.code !== 0) return `oracle failed: ${command}`;
  }
  return null;
}

/** The reason of a run that came back from the reviewer after the last fix round. */
const sentBack = (n: number, reason: string) => `the reviewer sent it back ${times(n)}: ${reason.replace(/^reviewer:\s*/, "")}`;

/**
 * A held run whose review says `back` goes to the worker as a fix round, while
 * rounds are left; after the last round it stays with Chris, its reason saying so.
 * A run held for a held path that the reviewer passed and whose review says `land`
 * has passed both reviews, so it passes and lands like any other run. A security
 * path never gets here: it has no reviewer's verdict. Called by `aleph review` when the review ends.
 */
export async function reviewBack(folder: string): Promise<void> {
  const run = readRun(folder);
  const r2 = readCall(folder);
  if (!run || (!isBuild(run.kind) && run.kind !== "recheck") || !isAwaiting(run.condition)) return;
  if (r2?.call === "land" && askOf(run)?.reason === "held-path" && existsSync(join(folder, "review.md")) && reviewVerdict(readFileSync(join(folder, "review.md"), "utf8"))?.pass) {
    updateRun(folder, { condition: "passed", ask: undefined, reason: undefined, cause: undefined });
    dispatchDetached();
    return;
  }
  if (!isBuild(run.kind) || r2?.call !== "back") return;
  const earlier = (jobById(run.job) ?? []).filter((e) => e.id !== basename(folder) && isBuild(e.run.kind) && e.run.failed).map((e) => e.run);
  const reason = r2.reason ?? "no reason given";
  if (earlier.length < fixRounds()) {
    const ended = updateRun(folder, { condition: "stuck", ask: undefined, cause: "reviewer", reason, failed: "review", round: earlier.length, next: "worker" });
    await start(folder, ended, "worker");
    return;
  }
  const back = earlier.filter((r) => r.failed === "review").length;
  if (back) updateRun(folder, { cause: "reviewer", reason: sentBack(back, reason) });
}

/**
 * A recheck: no worker. The run branch takes origin/<main> by a merge made in
 * memory (a conflict makes the run stuck and names the files), the checks run
 * in the sandbox on the result, then the held rule and the reviewer, as after a worker.
 */
async function recheck(id: string, folder: string, run: Run, repo: Repo): Promise<{ outcome: Outcome; code: number }> {
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
  }
  const dir = makeRunFolder(id);
  try {
    const b = git(repo.path, "bundle", "create", join(dir, "out", "out.bundle"), ref);
    if (!b.ok) return stuck("infra", `bundle failed: ${b.out}`);
    const base = git(repo.path, "merge-base", main, ref).out;
    if (git(repo.path, "rev-list", "--count", `${main}..${ref}`).out === "0") return stuck("no-commit", "no commit");
    const changed = git(repo.path, "diff", "--name-only", base, ref).out.split("\n").filter(Boolean);
    if (changed.length > 0 && changed.every((f) => f === "result.md")) return stuck("no-commit", "no commit");
    const hidden = hiddenOf(repo, run);
    if (!hidden) return stuck("infra", HIDDEN_UNREADABLE);
    const failed = await checksInSandbox({ folder, repo, changed, phase, record: recorder(folder), onSpawn: (p) => { child = p; } }, dir, "out/out.bundle", ref, hidden);
    if (failed) return stoppedByChecks(failed);
    return await heldAndReview(id, folder, run, repo, dir, base, branch, { checkedBase: base, checkedTip: git(repo.path, "rev-parse", ref).out });
  } finally {
    removeRunFolder(dir);
  }
}

const REVIEW = `You are the reviewer of job \`%NAME%\`. The working directory is a clone of the
branch the worker made for the goal issue below; read the code there as needed.
Judge whether the diff does what the issue asks, whether the tests cover it, and
whether it breaks anything. Do not change files. The factory already ran the repo's checks on this branch and
they passed. Do not run the full test suite or repeat-run loops: you have a time
box, and a long command ends it with no verdict. Run only a few targeted commands
of your own, each ending in well under a minute. ${FOREGROUND} End with one line:
\`VERDICT: pass\` or \`VERDICT: hold <one-sentence reason>\`.`;

const TESTS = `The diff changes tests. Judge each finding below against the goal: hold only
when the goal does not call for the change, or the change weakens a check the
goal keeps. A change the goal calls for passes.`;

const SEALED = `The worker never saw these scenarios. Check each one by observing behaviour: write throwaway
tests or scripts outside the repo's tracked files and run them. The diff and the branch's own tests are not
evidence, because the worker wrote them. Be sceptical: do not talk yourself out of a defect you found.
Hold when the branch fails a scenario that the goal requires. The hold reason goes to the worker: say what a
user of the code sees that the goal does not allow, and do not quote or mention the scenarios. If a scenario
asks for more than the goal or contradicts it, set it aside and add a line \`SET-ASIDE: <the scenario and why>\`
before the VERDICT line.`;

/** The reviewer's prompt: the instructions, the test findings if any, the sealed scenarios if any, the goal and the diff. */
export function reviewPrompt(name: string, spec: string, diff: string, findings: string[], scenarios = ""): string {
  const tests = findings.length ? `\n\n## Test changes\n\n${TESTS}\n\n${findings.map((f) => `- The diff ${f}`).join("\n")}` : "";
  const sealed = scenarios ? `\n\n## Sealed scenarios\n\n${SEALED}\n\n${scenarios.trim()}` : "";
  return `${REVIEW.replace("%NAME%", name)}${tests}${sealed}\n\n## Goal issue\n\n${spec}\n\n## Diff from the merge base\n\n${diff}\n`;
}

/**
 * A fresh reviewer reads the passing run: `claude -p` on Opus 5.5 under srt,
 * with the worker's profile, in its own run folder with a clone of the branch.
 * Returns the reason to hold, or null on a pass, and the cost. Fails closed.
 */
async function review(id: string, folder: string, run: Run, repo: Repo, dir: string, base: string, branch: string, findings: string[]): Promise<{ reason: string | null; cost?: number; none?: boolean }> {
  const rdir = makeRunFolder(`${id}-review`);
  try {
    copyFileSync(join(dir, "out", "out.bundle"), join(rdir, "out", "out.bundle"));
    const spec = readFileSync(join(folder, "..", run.job, "spec.md"), "utf8").trim();
    const whole = git(repo.path, "diff", base, `refs/heads/${branch}`).out;
    const max = reviewDiffMax();
    const diff = whole.length <= max ? whole
      : `${git(repo.path, "diff", "--stat", base, `refs/heads/${branch}`).out}\n\n${whole.slice(0, max)}\n\n(diff cut at ${max} of ${whole.length} characters; read the changed files in the working directory)`;
    const goal = onOf(run);
    let scenarios = "";
    try { scenarios = goal === undefined ? "" : readHidden(repo, goal)[SCENARIOS] ?? ""; } catch { return { reason: "reviewer: no verdict (the sealed scenarios are unreadable)", none: true }; }
    const text = reviewPrompt(run.name, spec, diff, findings, scenarios);
    writeFileSync(join(folder, "review-prompt.md"), text);
    const q = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;
    const argv = [reviewerCmd(), "-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "bypassPermissions",
      "--tools", "Read", "Grep", "Glob", "Bash", "--model", "claude-opus-5-5"];
    const script = [
      "set -e", "exec 3>&1 1>&2", "git init -q .", ...NO_SUBMODULES,
      `git fetch -q ../out/out.bundle ${q(`+refs/heads/${branch}:refs/heads/${branch}`)}`, `git switch -q ${q(branch)}`,
      // The scenarios need code that runs. A failed setup shows when the reviewer runs it, so it does not stop the review.
      ...(scenarios ? [`{ ${repo.setup.map((c) => `${c} && `).join("")}true; } || true`] : []),
      "exec 1>&3 3>&-", `exec ${argv.map(q).join(" ")}`,
    ].join("\n");
    const log = join(folder, "review.log");
    const w = await sandboxed(rdir, script, {
      read: ["out/out.bundle"], write: ["home", "work", "tmp"], cwd: "work", stdin: text,
      env: { CLAUDE_CODE_OAUTH_TOKEN: workerToken(), CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1" },
      stdout: log, stderr: join(folder, "review.err"), limit: reviewSeconds(), stall: stallSeconds(),
      onSpawn: (p) => { child = p; },
    });
    child = null;
    const o = agentOutcome(existsSync(log) ? readFileSync(log, "utf8") : "");
    writeFileSync(join(folder, "review.md"), o.result);
    const cost = o.cost;
    const none = (why: string) => ({ reason: `reviewer: no verdict (${why})`, cost, none: true });
    if (w.stalled) return none(stallReason());
    if (w.timedOut) return none("time box");
    if (!o.ok) return none(o.line || `exit ${w.code}`);
    const v = reviewVerdict(o.result);
    if (!v) return none("no VERDICT line");
    for (const aside of tagged(o.result, "SET-ASIDE")) note(repo, goal!, `sealed checks: the reviewer set aside: ${aside}`);
    return { reason: v.pass ? null : `reviewer: ${v.reason}`, cost };
  } finally {
    removeRunFolder(rdir);
  }
}

/**
 * A worker's `FOLLOWUP:` lines each become an issue with `source: worker` (the line as the title, the run in its request),
 * filed in one store commit. An empty line such as "none" files nothing, and a line on the topic of an open issue is a note on that issue. This reverses the aleph-826 choice (a log and no issue), which the spec supersedes.
 */
export function fileFollowups(repo: Repo, run: Run, titles: string[]): void {
  const lists = reader();
  const open = (lists.list(repo.key)?.items ?? []).filter((i) => issues.status(i) === "open");
  const fresh: string[] = [];
  for (const title of titles) {
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
  fileIssues(repo, `followups from ${run.name}`, fresh.map((title) => ({ title, priority, source: "worker" as const, request: `A follow-up the worker met in run ${run.name}.` })));
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

/** A worker's `FLAKE:` lines become notes on the repo's flake tracker; they file no issue and start no triage. */
function noteFlakes(repo: Repo, run: Run, lines: string[]): void {
  for (const line of lines) noteFlake(repo, `job ${run.name}: ${line}`);
}
