/**
 * The job transitions: start a job or a plain run, land, recheck, drop, and
 * close a manual check. Each takes explicit arguments, refuses with a
 * `Refusal`, and returns what `aleph` prints as JSON; jobs/cli.ts only parses
 * argv. The factory and the unit call them in-process. Starting the run's unit
 * is the launcher's (launch.ts). See docs/workflow.md.
 */
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { needsOf } from "../asks/ask.ts";
import { allRuns, isWaiting, isAgentRun, isBuild, loadRegistry, onOf, repoOf, type Repo } from "../records/ledger.ts";
import { lock } from "../../../lib/locks.ts";
import { isLive, isRunning, markEnded, stop, unitOf, waitForPid } from "../infra/process.ts";
import { causeOf, failedCheckOf, policyOf, type Fate } from "../records/outcome.ts";
import { addNote, issue as issueOf, lastRun, latestJob, openJob } from "../records/job.ts";
import { counting, getRun, makeJob, patchRun, setState, type NewJob } from "../records/record.ts";
import { keepDiff } from "../records/jobdiff.ts";
import { agentOf, landTerms, removeBranch } from "../land/landing.ts";
import { git } from "../../../lib/git.ts";
import { onMain } from "../records/status.ts";
import { Refusal, refuse } from "../../../lib/refusal.ts";
import { factoryGates } from "../gates/factory-status.ts";
import { liveEntries, onLocal } from "../gates/gpu.ts";
import { readModels } from "../routing/models.ts";
import { logEvent } from "../../../lib/layout.ts";
import { raise, route, type Size } from "../routing/route.ts";
import { heldEvent, type Gate, type Hold } from "../gates/issue-decision.ts";
import { dispatchDetached, startUnit, type Output } from "./launch.ts";
import { detailOf, key, parseId } from "../../../lib/naming.ts";
import * as issues from "../../../issues/lib/todo.ts";
import * as store from "../../../issues/lib/store.ts";
import { jobSeconds, pidWaitMs, startCmd } from "../infra/settings.ts";
import { logTo, runFile } from "../records/run-files.ts";
import { errText } from "../../../lib/errtext.ts";

/** The message of a transition that refused or threw, or null when it went through: the factory's ports answer this. */
export async function refusal(f: () => Promise<unknown>): Promise<string | null> {
  try {
    await f();
    return null;
  } catch (e) {
    return errText(e).trim() || "refused";
  }
}

/** A start refused for a gate: `gate` and `ev` are the hold the dispatch records. */
class Held extends Refusal {
  constructor(why: string, readonly gate: Gate, readonly ev: Hold) { super(why); }
}

const hold = (gate: Gate, ev: Hold, why: string): never => { throw new Held(why, gate, ev); };

/** A refused start as the dispatch records it: the gate, the line, and the log event, whose note is the line. */
export interface Refused { why: string; gate: Gate; ev: Hold }

/** The hold of a start that threw `e`. A refusal with no gate is a job that runs already. */
const refusedBy = (e: unknown): Refused => {
  const why = errText(e).trim() || "refused";
  return e instanceof Held ? { why, gate: e.gate, ev: { ...e.ev, detail: why } } : { why, gate: "job", ev: heldEvent("job", why) };
};

export function checkName(name: string | undefined): string {
  if (!name || !/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*$/.test(name)) refuse("the name must be letters, digits and hyphens");
  return name;
}

const quote = (argv: string[]) => argv.map((a) => /^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replaceAll("'", `'\\''`)}'`).join(" ");

/** What a start prints: the new job (`run`, its key), the work it belongs to (`job`, the first job of its `prev` chain) and its folder. */
interface Started { run: string; job: string; folder: string }

/** A started run, and in the foreground its unit's process, for the caller to wait on after the locks are gone. */
export interface Start { started: Started; child?: ReturnType<typeof Bun.spawn> }

/** How a start is made: the `aleph` argv it is written down as in the `command` section of `log.txt`, who starts it, where a foreground unit writes, and `now` (Run now) to skip the live cap. */
interface StartOpts { command?: string[]; output?: Output; by?: string; now?: boolean }

/**
 * Make the job and start its unit, under the dispatch lock. The lock
 * is held until the unit writes `pid`, so a second dispatch counts this job.
 */
async function dispatch(run: NewJob, cwd: string, command: string[], output: Output | undefined, prep: (folder: string) => void, now?: boolean): Promise<Start> {
  const release = await lock("dispatch", 120_000); // a queue of starts, each holding it until its unit writes pid
  if (!release) refuse("another dispatch holds the lock");
  let child: ReturnType<typeof Bun.spawn> | undefined;
  let id: string, folder: string;
  let gpu: (() => void) | null = null; // a local run holds the GPU slot from its cap check until its job row is written
  try {
    if (isBuild(run.role)) {
      // The run's model, or its size's, names its backend: a backend the factory holds starts no run, whatever the caller.
      const f = factoryGates(undefined, run);
      if (f.waiting) hold("waiting", f.waiting.ev!, f.waiting.why);
      // Run now skips the live cap, but not a local model's: that bound is the GPU slot.
      if (f.full && !(now && !onLocal(run, readModels()))) hold("full", heldEvent("full"), `${f.full.why}: ${liveEntries().map((e) => e.run.name).join(", ")}`);
      if (onLocal(run, readModels())) {
        gpu = await lock("gpu", 0);
        if (!gpu) hold("full", heldEvent("gpu"), "a local call holds the GPU");
      }
    }
    ({ id, folder } = makeJob(run, (dir) => {
      // A plain run keeps the command it runs there instead: the unit reads it from this section.
      if (run.role !== "plain") logTo(dir, "command", quote(["aleph", ...command]));
      prep(dir);
    }));
    gpu?.();
    gpu = null;

    // A factory run's unit is the backstop for its time box: systemd stops the whole cgroup.
    const factory = isBuild(run.role) && run.repo && loadRegistry()[run.repo]?.sandbox;
    const max = factory ? [`--property=RuntimeMaxSec=${jobSeconds() + 3600}`] : [];
    try {
      child = startUnit(["unit", folder], { unit: unitOf(id), cwd, props: max, output, attach: true });
    } catch (e) {
      setState(id, "failed", { reason: errText(e) });
      refuse(errText(e));
    }
    // Wait for `pid`, but not for a unit that cannot write it: one that has exited, or whose folder is gone.
    const wait = pidWaitMs();
    if (!(await waitForPid(folder, wait, () => child?.exitCode != null))) {
      const why = !existsSync(folder) ? "its folder is gone" : child?.exitCode != null ? `the unit exited ${child.exitCode}` : `no pid in ${wait / 1000} s`;
      console.error(`warn: ${id} wrote no pid: ${why}`);
    }
  } finally {
    gpu?.();
    release();
  }
  return { started: { run: id!, job: getRun(id!)!.job, folder: folder! }, child };
}

interface JobArgs {
  /** The repo's key in the registry, as typed: case and spaces do not count. */
  repo: string;
  name: string;
  /** The spec of a new job, or the note of a follow-up. */
  spec: string;
  /** The issue or part the run is on: its number (`7`, or `7.1` for a part). */
  on?: number | string;
  model?: string;
  land?: boolean;
  /** A merge run after a land conflict. */
  merge?: boolean;
}

/** The argv of `aleph job` for these arguments. */
const jobCommand = (a: JobArgs): string[] =>
  ["job", a.repo, a.name, "--spec", "-", ...(a.on !== undefined ? ["--on", String(a.on)] : []), ...(a.land ? ["--land"] : []), ...(a.model ? ["--model", a.model] : [])];

/** `aleph job`: start a new job, or a follow-up of the open one of that name. */
export async function startJob(a: JobArgs, o: StartOpts = {}): Promise<Start> {
  const repo = repoOf(a.repo);
  const name = checkName(a.name);
  let on = a.on;
  if (on !== undefined) {
    const p = parseId(on) ?? parseId(`${repo.key}-${on}`);
    if (p?.repo !== repo.key || p.sub !== undefined) refuse("--on takes an issue number");
    on = p.n;
    let doc: issues.Doc | null = null;
    try { doc = store.readList(repo); } catch (e) { refuse(errText(e)); }
    if (!doc) refuse(`the work store has no list for ${repo.key}`);
    if (!issues.find(doc, on)) refuse(`${repo.key} has no issue ${on}`);
  }

  const release = await lock(`job-${repo.key}-${name}`);
  if (!release) refuse(`job ${name} is busy`);
  try {
    const open = openJob(name);
    const last = open?.at(-1);
    if (last && last.run.repo !== repo.key) refuse(last.run.repo ? `${name} is open in ${last.run.repo}` : `${name} is running as ${last.id}`);
    const live = open?.find(isRunning);
    if (live) refuse(`${name} is running as ${live.id}`);
    const first = open?.[0];
    const item = on ?? (open && issueOf(open));
    const landedAs = onMain(repo, { item: first ? item : undefined, fetch: first !== undefined && item !== undefined })?.commit;
    if (landedAs) hold("done", heldEvent("done"), `${name}: the item already landed as ${landedAs}`);
    const worktree = first?.run.worktree ?? join(repo.path, ".worktrees", `job-${name}`);
    // A follow-up without --on keeps the item the job started with.
    on ??= (open && issueOf(open));
    // A fix round follows the build that came before it; a build of a name whose last work did not land redoes that work.
    const before = open ? counting(open).id : undefined, prior = open ? undefined : latestJob(name, repo.key);
    const retry = prior && !["landed", "done"].includes(counting(prior).run.state) ? counting(prior).id : undefined;
    return await dispatch({
      role: "build", by: o.by, ...(before ? { prev: before } : {}), ...(retry ? { retryOf: retry } : {}), name, repo: repo.key, branch: `${repo.sandbox ? "factory" : "job"}/${name}`, worktree,
      state: "running", phase: "starting", session: crypto.randomUUID(), ...(a.model ? { model: a.model } : {}),
      ...(on !== undefined ? { target: key("issue", Number(on)) } : {}), ...(a.land ? { land: true } : {}), ...(a.merge ? { merge: true as const } : {}), told: false, shown: false,
    }, repo.path, o.command ?? jobCommand(a), o.output, (folder) => {
      if (!first) return writeFileSync(runFile(folder, "spec.md"), a.spec);
      addNote(open!, a.spec);
    }, o.now);
  } finally {
    release();
  }
}

/** `aleph run <name> -- <argv>`: a plain run of a command in `cwd`. */
export async function startPlain(a: { name: string; argv: string[]; cwd: string }, o: StartOpts = {}): Promise<Start> {
  const name = checkName(a.name);
  if (!a.argv.length) refuse("usage: aleph run <name> -- <command> [args...]");
  const release = await lock(`job--${name}`);
  if (!release) refuse(`${name} is busy`);
  try {
    const live = openJob(name);
    if (live) refuse(`${name} is open as ${live.at(-1)!.id}`);
    // A command inside a registered repo gets that repo's env file, as scripts/job gave Sidetone's.
    const home = Object.values(loadRegistry()).find((r) => r.env && (a.cwd === r.path || a.cwd.startsWith(r.path + "/")));
    if (home?.env) process.env.ALEPH_RUN_ENV = home.env;
    return await dispatch({ role: "plain", by: o.by, name, state: "running", phase: "command", told: false }, a.cwd,
      o.command ?? ["run", name, "--", ...a.argv], o.output, (folder) => {
        logTo(folder, "command", quote(a.argv));
      });
  } finally {
    release();
  }
}

/**
 * `aleph land`: start a land run. The latest agent run must have passed, or need Chris for a
 * held path: his land is the review, and the commit says so. A manual check does
 * not gate the land: the land run keeps it open, as an issue, until
 * `aleph checked`. With `checked`, Chris has done the check already.
 * The land unit takes the job lock.
 */
export async function land(name: string, a: { checked?: boolean; lander?: "Chris" | "director" | "timeout" } = {}, o: StartOpts = {}): Promise<Start> {
  checkName(name);
  // Two lands of one job at once (the dispatch's batch pull and the leader's) each pass the live check below: it and the start share a lock.
  const repoKey = openJob(name)?.at(-1)!.run.repo;
  const release = await lock(`land-start-${repoKey}-${name}`, 30_000);
  if (!release) refuse(`${name}: another land is starting`);
  try {
    const runs = openJob(name) ?? refuse(`no open job named ${name}`);
    // A unit that has not written `pid` in the dispatch's wait still counts: a second land here would land the job twice.
    const live = runs.find(isRunning);
    if (live) refuse(`${name} is running as ${live.id}`);
    const agentEntry = agentOf(runs)!, agent = agentEntry.run;
    const terms = landTerms(agent);
    if (!terms) {
      const needs = isWaiting(agent.state) ? needsOf(agent.ask) : undefined;
      refuse(`${name} is ${agent.state}${needs ? ` (${needs})` : ""}, not passed`);
    }
    const { manual, held } = terms;
    const unchecked = manual && !a.checked;
    const repo = repoOf(agent.repo);
    const item = onOf(agent);
    // A land that pushed and died before it closed the item: its own `Job:` commit on main is that land, so the land unit finishes it (landing.ts). Another job's commit, or a commit by hand, that names the item still refuses.
    const found = onMain(repo, { jobs: item !== undefined ? runs.map((e) => e.id) : undefined, item, fetch: item !== undefined });
    const landedAs = found?.how === "Job trailer" ? null : found?.commit;
    if (landedAs) refuse(`${name}: the item already landed as ${landedAs}`);
    return await dispatch({
      role: "land", by: o.by, prev: agentEntry.id, name, repo: agent.repo, branch: agent.branch, worktree: agent.worktree,
      state: "running", phase: "land", told: false, shown: false,
      ...(unchecked ? { check: "open" as const, say: agent.say } : {}),
      ...(held ? { held: true, lander: a.lander ?? "Chris" } : {}),
      ...(agent.checkedBase ? { checkedBase: agent.checkedBase } : {}),
      ...(agent.checkedTip ? { checkedTip: agent.checkedTip } : {}),
      ...(agent.target !== undefined ? { target: agent.target } : {}),
    }, repo.path, o.command ?? ["land", name, ...(a.checked ? ["--checked"] : [])], o.output, () => {});
  } finally {
    release();
  }
}

/** `aleph checked`: close the manual check of a job that landed with it open, and its issue. */
export function checked(name: string): { job: string; name: string; state: "landed"; check: "done" } {
  checkName(name);
  const found = latestJob(name);
  const last = found ? counting(found) : undefined;
  if (!last || last.run.state !== "landed" || last.run.check !== "open") refuse(`${name} has no open check`);
  patchRun(last.id, { check: "done" });
  const repo = last.run.repo ? loadRegistry()[last.run.repo] : undefined;
  const item = last.run.checkItem;
  const why = repo && item !== undefined ? store.close(repo, item, "checked by Chris") : null;
  if (why) console.error(`warn: issue ${item} not closed: ${why}`);
  dispatchDetached();
  return { job: last.run.job, name, state: "landed", check: "done" };
}

/**
 * `aleph recheck`: start a recheck run. The last run of an open job is an agent or recheck run
 * that ended returned or failed, and its branch still exists. The run merges main
 * into the branch and runs the checks and the reviewer again; no worker starts.
 */
export async function recheck(name: string, o: StartOpts = {}): Promise<Start> {
  checkName(name);
  const found = openJob(name) ?? refuse(`no open job named ${name}`);
  const release = await lock(`job-${found.at(-1)!.run.repo ?? ""}-${name}`);
  if (!release) refuse(`job ${name} is busy`);
  let s: Start;
  try {
    const runs = openJob(name) ?? refuse(`no open job named ${name}`);
    const last = lastRun(runs);
    if (isLive(last.folder)) refuse(`${name} is running as ${last.id}`);
    const r = last.run;
    if (!isAgentRun(r.role)) refuse(`${name}: the last job is not an agent job`);
    if (r.state !== "returned" && r.state !== "failed") refuse(`${name} is ${r.state}, not returned or failed`);
    const repo = loadRegistry()[r.repo ?? ""];
    if (!repo?.sandbox) refuse(`${name} is not a factory job`);
    if (!r.branch || !git(repo.path, "rev-parse", "--verify", "-q", `refs/heads/${r.branch}`).ok) refuse(`${name} has no branch: drop it`);
    const on = issueOf(runs);
    // The recheck moves the branch, so it keeps the job's worktree in step, and a drop or a land removes that worktree.
    const worktree = runs.findLast((e) => e.run.worktree)?.run.worktree;
    s = await dispatch({
      role: "recheck", by: o.by, prev: last.id, name, repo: repo.key, branch: r.branch, ...(worktree ? { worktree } : {}), state: "running", phase: "starting",
      ...(on !== undefined ? { target: key("issue", Number(on)) } : {}), ...(runs.some((e) => e.run.land) ? { land: true } : {}), told: false, shown: false,
    }, repo.path, o.command ?? ["recheck", name], o.output, () => {});
  } finally {
    release();
  }
  // The recheck is live now: a dispatch may start what waited on its run.
  dispatchDetached();
  return s;
}

/**
 * `aleph drop`: stop the job's live runs, take its branch, and mark it dropped. With `quiet`,
 * the factory's own drop: it writes the issue note and the news itself, and its dispatch goes on.
 */
export async function drop(name: string, a: { reason?: string; quiet?: boolean; fate?: Fate } = {}): Promise<{ job: string; name: string; state: "dropped"; reason: string }> {
  checkName(name);
  const reason = a.reason || "dropped by Chris";
  const runs = openJob(name) ?? refuse(`no open job named ${name}`);
  const last = lastRun(runs);
  const release = await lock(`job-${last.run.repo ?? ""}-${name}`);
  if (!release) refuse(`job ${name} is busy`);
  try {
    if (runs.some((e) => e.run.role === "land" && isLive(e.folder))) refuse("landing");
    const repo = last.run.repo ? loadRegistry()[last.run.repo] : undefined;
    const live = runs.filter((e) => isLive(e.folder));
    for (const e of live) {
      if (await stop(e)) continue;
      // A run whose process outlives the stop fails as `infra`.
      setState(e.id, "failed", { cause: "infra", reason: "cannot stop: its process still runs", phase: undefined });
      refuse(`cannot stop ${e.id}: its process still runs`);
    }
    if (repo) { keepDiff(repo, last.run.branch, last.folder); removeBranch(repo, last.run); }
    // Chris asked for the drop, so it is not news.
    for (const e of new Set([...live, last])) {
      markEnded(e.folder, 143);
      // The drop replaces the sentence, so a run that has only the sentence gets its cause now.
      setState(e.id, "dropped", { cause: causeOf(e.run), checkName: failedCheckOf(e.run), fate: a.fate, reason, ask: undefined, phase: undefined, told: true });
    }
    // The reviewer runs inside its build's unit, so a stopped unit leaves its job running.
    for (const e of runs) if (e.run.role === "review" && e.run.state === "running") setState(e.id, "dropped", { reason, phase: undefined });
    const todo = issueOf(runs);
    const why = repo && todo !== undefined && !a.quiet ? store.note(repo, todo, `job ${name} dropped: ${reason}`) : null;
    if (why) console.error(`warn: issue ${todo} has no note: ${why}`);
    if (!a.quiet) dispatchDetached();
    return { job: last.run.job, name, state: "dropped", reason };
  } finally {
    release();
  }
}

/**
 * Start the run for an issue: `aleph job` in-process, or `ALEPH_START_CMD` (tests) as a process.
 * A foreground unit is waited for, its output dropped. Returns the refusal, or null. A refusal from
 * `ALEPH_START_CMD` is text from another process, so it names no gate.
 */
export async function startIssue(repo: Repo, name: string, id: number | string, spec: string, size?: Size | null, now?: boolean): Promise<Refused | null> {
  const picked = size !== undefined ? size : await route(spec, name);
  // A rerun of an issue whose build run failed takes the next level up; a run that did no work (credit) or hit the host (infra) does not count.
  const failed = allRuns().some((e) => e.run.name === name && isBuild(e.run.role) && e.run.state === "failed" && policyOf(causeOf(e.run)).countsToCap && causeOf(e.run) !== "infra");
  const routed = picked && failed ? raise(picked) : picked;
  const model = routed ? readModels()[routed].model : null;
  logEvent({ subject: "rule", action: "started", object: name, detail: detailOf("started", "model", model ?? "default"), size: routed });
  const start = startCmd();
  if (start) {
    const p = Bun.spawn([start, repo.key, name, String(id)], { env: process.env, stdin: new Blob([spec]), stdout: "ignore", stderr: "pipe" });
    const code = await p.exited;
    return code === 0 ? null : refusedBy((await new Response(p.stderr).text()).trim() || `exit ${code}`);
  }
  try {
    await (await startJob({ repo: repo.key, name, spec, on: id, land: true, ...(routed ? { model: routed } : {}) }, { output: "ignore", by: "rule", now })).child?.exited;
    return null;
  } catch (e) {
    return refusedBy(e);
  }
}
