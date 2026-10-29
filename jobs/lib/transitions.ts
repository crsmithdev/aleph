/**
 * The job transitions: start a job or a plain run, land, recheck, drop, and
 * close a manual check. Each takes explicit arguments, refuses with a
 * `Refusal`, and returns what `aleph` prints as JSON; jobs/cli.ts only parses
 * argv. The factory and the unit call them in-process. Starting the run's unit
 * is the launcher's (launch.ts). See docs/specs/2026-09-24-agent-jobs.md.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isLive, jobsDir, loadRegistry, lock, stamp, updateRun, writeRun, type Repo, type Run } from "./ledger.ts";
import { addNote, issue as issueOf, latestJob, openJob } from "./job.ts";
import { baselineChecks, git, removeBranch } from "./unit.ts";
import { fetchOrigin } from "./git.ts";
import { itemOnMain } from "./status.ts";
import { dispatchDetached, dispatchGoals, factoryLog, gates, liveEntries } from "./factory.ts";
import { route, type Tier } from "./route.ts";
import { startUnit, type Output } from "./launch.ts";
import * as todos from "../../todo/lib/todo.ts";
import * as store from "../../todo/lib/store.ts";

/** A transition said no: the message is what `aleph` prints on stderr before it exits 1. */
export class Refusal extends Error {}
export const refuse = (msg: string): never => { throw new Refusal(msg); };

/** The message of a transition that refused or threw, or null when it went through: the factory's ports answer this. */
export async function refusal(f: () => Promise<unknown>): Promise<string | null> {
  try {
    await f();
    return null;
  } catch (e: any) {
    return String(e?.message ?? e).trim() || "refused";
  }
}

export function checkName(name: string | undefined): string {
  if (!name || !/^[A-Za-z0-9-]+$/.test(name)) refuse("the name must be letters, digits and hyphens");
  return name!;
}

export const quote = (argv: string[]) => argv.map((a) => /^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replaceAll("'", `'\\''`)}'`).join(" ");

/** How long a start waits for the unit to write `pid`; `ALEPH_PID_WAIT_MS` changes it. */
const pidWaitMs = () => Number(process.env.ALEPH_PID_WAIT_MS) || 10_000;

/** What a start prints: the new run, its job and its folder. */
export interface Started { run: string; job: string; folder: string }

/** A started run, and in the foreground its unit's process, for the caller to wait on after the locks are gone. */
export interface Start { started: Started; child?: ReturnType<typeof Bun.spawn> }

/** How a start is made: the `aleph` argv it is written down as in `command.txt`, and where a foreground unit writes. */
export interface StartOpts { command?: string[]; output?: Output }

/**
 * Create the run folder and start its unit, under the dispatch lock. The lock
 * is held until the unit writes `pid`, so a second dispatch counts this run.
 */
async function dispatch(run: Omit<Run, "job"> & { job?: string }, tag: string, cwd: string, command: string[], output: Output | undefined, prep: (folder: string) => void): Promise<Start> {
  const release = await lock("dispatch", 120_000); // a queue of starts, each holding it until its unit writes pid
  if (!release) refuse("another dispatch holds the lock");
  let child: ReturnType<typeof Bun.spawn> | undefined;
  let id: string;
  try {
    if (run.kind === "agent") {
      const full = gates({ only: ["live"] });
      if (full) refuse(`${full.why}: ${liveEntries().map((e) => e.run.name).join(", ")}`);
    }
    mkdirSync(jobsDir(), { recursive: true });
    // Runs sort by folder name, so two runs of one job never share a second:
    // a follow-up started in its land's second would sort before that land.
    for (;;) {
      const prefix = `${stamp()}-${tag}-`;
      id = `${prefix}${run.kind}`;
      if (!readdirSync(jobsDir()).some((d) => d.startsWith(prefix))) break;
      await Bun.sleep(200);
    }
    const folder = join(jobsDir(), id);
    mkdirSync(folder);
    writeFileSync(join(folder, "command.txt"), quote(["aleph", ...command]) + "\n");
    prep(folder);
    // `made` orders the land queue: folder names sort by name within a second.
    writeRun(folder, { ...run, job: run.job ?? id, made: Date.now() } as Run);

    // A factory run's unit is the backstop for its time box: systemd stops the whole cgroup.
    const factory = run.kind === "agent" && run.repo && loadRegistry()[run.repo]?.sandbox;
    const max = factory ? [`--property=RuntimeMaxSec=${Number(process.env.ALEPH_JOB_TIMEOUT ?? 2400) + 3600}`] : [];
    try {
      child = startUnit(["unit", folder], { unit: `aleph-${id}`, cwd, props: max, output, attach: true });
    } catch (e: any) {
      updateRun(folder, { state: "failed", reason: e.message, ended: new Date().toISOString() });
      refuse(e.message);
    }
    // Wait for `pid`, but not for a unit that cannot write it: one that has exited, or whose folder is gone.
    const wait = pidWaitMs();
    const deadline = Date.now() + wait;
    while (!existsSync(join(folder, "pid")) && Date.now() < deadline && existsSync(folder) && child?.exitCode == null) await Bun.sleep(25);
    if (!existsSync(join(folder, "pid"))) {
      const why = !existsSync(folder) ? "its folder is gone" : child?.exitCode != null ? `the unit exited ${child.exitCode}` : `no pid in ${wait / 1000} s`;
      console.error(`warn: ${id} wrote no pid: ${why}`);
    }
  } finally {
    release!();
  }
  return { started: { run: id!, job: run.job ?? id!, folder: join(jobsDir(), id!) }, child };
}

export interface JobArgs {
  /** The repo's key in the registry, as typed: case and spaces do not count. */
  repo: string;
  name: string;
  /** The spec of a new job, or the note of a follow-up. */
  spec: string;
  todo?: number;
  model?: string;
  land?: boolean;
}

/** The argv of `aleph job` for these arguments. */
export const jobCommand = (a: JobArgs): string[] =>
  ["job", a.repo, a.name, "--spec", "-", ...(a.todo !== undefined ? ["--todo", String(a.todo)] : []), ...(a.land ? ["--land"] : []), ...(a.model ? ["--model", a.model] : [])];

/** The registry's repo for a key as typed: case and spaces do not count. */
export function repoOf(key: string | undefined): Repo {
  const registry = loadRegistry();
  return registry[(key ?? "").toLowerCase().replace(/\s+/g, "")] ?? refuse(`unknown repo "${key ?? ""}"; known: ${Object.keys(registry).join(", ")}`);
}

/** `aleph job`: start a new job, or a follow-up of the open one of that name. */
export async function startJob(a: JobArgs, o: StartOpts = {}): Promise<Start> {
  const repo = repoOf(a.repo);
  const name = checkName(a.name);
  let todo = a.todo;
  if (todo !== undefined) {
    if (!Number.isInteger(todo)) refuse("--todo takes an issue number");
    let doc: todos.Doc | null = null;
    try { doc = store.readList(repo); } catch (e: any) { refuse(e?.message ?? String(e)); }
    if (!doc) refuse(`the work store has no list for ${repo.key}`);
    if (!todos.find(doc!, todo)) refuse(`${repo.key} has no issue ${todo}`);
  }

  const release = await lock(`job-${repo.key}-${name}`);
  if (!release) refuse(`job ${name} is busy`);
  try {
    const open = openJob(name);
    const last = open?.at(-1);
    if (last && last.run.repo !== repo.key) refuse(last.run.repo ? `${name} is open in ${last.run.repo}` : `${name} is running as ${last.id}`);
    if (last && isLive(last.folder)) refuse(`${name} is running as ${last.id}`);
    const first = open?.[0];
    const item = todo ?? (open && issueOf(open));
    if (first && item !== undefined) fetchOrigin(repo.path);
    const landedAs = first ? itemOnMain(repo, item) : null;
    if (landedAs) refuse(`${name}: the item already landed as ${landedAs}`);
    // A factory run has no worktree: its branch comes and goes as a bundle.
    const worktree = repo.sandbox ? undefined : first?.run.worktree ?? join(repo.path, ".worktrees", `job-${name}`);
    // A follow-up without --todo keeps the item the job started with.
    todo ??= (open && issueOf(open));
    return await dispatch({
      kind: "agent", job: first?.id, name, repo: repo.key, branch: `${repo.sandbox ? "factory" : "job"}/${name}`, ...(worktree ? { worktree } : {}),
      state: "running", phase: "starting", session: crypto.randomUUID(), ...(a.model ? { model: a.model } : {}),
      ...(todo !== undefined ? { todo } : {}), ...(a.land ? { land: true } : {}), told: false, shown: false, started: new Date().toISOString(),
    }, `${repo.key}-${name}`, repo.path, o.command ?? jobCommand(a), o.output, (folder) => {
      if (!first) return writeFileSync(join(folder, "spec.md"), a.spec);
      addNote(open!, a.spec);
    });
  } finally {
    release!();
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
    return await dispatch({ kind: "plain", name, state: "running", phase: "command", told: false, started: new Date().toISOString() }, name, a.cwd,
      o.command ?? ["run", name, "--", ...a.argv], o.output, (folder) => {
        writeFileSync(join(folder, "command.txt"), quote(a.argv) + "\n");
      });
  } finally {
    release!();
  }
}

/**
 * `aleph land`: start a land run. The latest agent run must have passed, or need Chris for a
 * held path: his land is the review, and the commit says so. A manual check does
 * not gate the land: the land run keeps it open, as an issue, until
 * `aleph checked`. With `checked`, Chris has done the check already. A run
 * from before this rule, needs-you for a manual check, lands the same way.
 * The land unit takes the job lock.
 */
export async function land(name: string, a: { checked?: boolean; lander?: "Chris" | "firefighter" } = {}, o: StartOpts = {}): Promise<Start> {
  checkName(name);
  // Two lands of one job at once (the dispatch's batch pull and the leader's) each pass the live check below: it and the start share a lock.
  const repoKey = openJob(name)?.at(-1)!.run.repo;
  const release = await lock(`land-start-${repoKey}-${name}`, 30_000);
  if (!release) refuse(`${name}: another land is starting`);
  try {
    const runs = openJob(name) ?? refuse(`no open job named ${name}`);
    const live = runs.find((e) => isLive(e.folder));
    if (live) refuse(`${name} is running as ${live.id}`);
    const agent = runs.filter((e) => e.run.kind === "agent" || e.run.kind === "recheck").at(-1)!.run;
    const manual = (agent.state === "needs-you" && agent.needs === "manual") || (agent.state === "passed" && agent.say !== undefined);
    const unchecked = manual && !a.checked;
    const held = agent.state === "needs-you" && (agent.needs === "held" || agent.needs === "review");
    if (agent.state !== "passed" && !manual && !held) refuse(`${name} is ${agent.state}${agent.needs ? ` (${agent.needs})` : ""}, not passed`);
    const repo = loadRegistry()[agent.repo!];
    if (agent.todo !== undefined) fetchOrigin(repo.path);
    const landedAs = itemOnMain(repo, agent.todo);
    if (landedAs) refuse(`${name}: the item already landed as ${landedAs}`);
    return await dispatch({
      kind: "land", job: agent.job, name, repo: agent.repo, branch: agent.branch, worktree: agent.worktree,
      state: "running", phase: "land", told: false, shown: false, started: new Date().toISOString(),
      ...(unchecked ? { check: "open" as const, say: agent.say } : {}),
      ...(held ? { held: true, lander: a.lander ?? "Chris" } : {}),
      ...(agent.checkedBase ? { checkedBase: agent.checkedBase } : {}),
      ...(agent.checkedTip ? { checkedTip: agent.checkedTip } : {}),
      ...(agent.todo !== undefined ? { todo: agent.todo } : {}),
    }, `${repo.key}-${name}`, repo.path, o.command ?? ["land", name, ...(a.checked ? ["--checked"] : [])], o.output, () => {});
  } finally {
    release!();
  }
}

/** `aleph checked`: close the manual check of a job that landed with it open, and its issue. */
export function checked(name: string): { job: string; name: string; state: "landed"; check: "done" } {
  checkName(name);
  const last = latestJob(name)?.at(-1);
  if (!last || last.run.state !== "landed" || last.run.check !== "open") refuse(`${name} has no open check`);
  updateRun(last!.folder, { check: "done" });
  const repo = last!.run.repo ? loadRegistry()[last!.run.repo] : undefined;
  const item = last!.run.checkItem;
  const why = repo && item !== undefined ? store.close(repo, item, "checked by Chris") : null;
  if (why) console.error(`warn: issue ${item} not closed: ${why}`);
  dispatchDetached();
  return { job: last!.run.job, name, state: "landed", check: "done" };
}

/**
 * `aleph recheck`: start a recheck run. The last run of an open job is an agent or recheck run
 * that ended stuck or failed, and its branch still exists. The run merges main
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
    const last = runs.at(-1)!;
    if (isLive(last.folder)) refuse(`${name} is running as ${last.id}`);
    const r = last.run;
    if (r.kind !== "agent" && r.kind !== "recheck") refuse(`${name}: the last run is a ${r.kind} run, not an agent run`);
    if (r.state !== "stuck" && r.state !== "failed") refuse(`${name} is ${r.state}, not stuck or failed`);
    const repo = loadRegistry()[r.repo ?? ""];
    if (!repo?.sandbox) refuse(`${name} is not a factory job`);
    if (!r.branch || !git(repo.path, "rev-parse", "--verify", "-q", `refs/heads/${r.branch}`).ok) refuse(`${name} has no branch: drop it`);
    const todo = issueOf(runs);
    s = await dispatch({
      kind: "recheck", job: runs[0].id, name, repo: repo.key, branch: r.branch, state: "running", phase: "starting",
      ...(todo !== undefined ? { todo } : {}), ...(runs.some((e) => e.run.land) ? { land: true } : {}), told: false, shown: false, started: new Date().toISOString(),
    }, `${repo.key}-${name}`, repo.path, o.command ?? ["recheck", name], o.output, () => {});
  } finally {
    release!();
  }
  // The recheck is live now, so the hold it was under no longer counts.
  dispatchDetached();
  return s;
}

/**
 * `aleph drop`: stop the job's live runs, take its branch, and mark it dropped. With `quiet`,
 * the factory's own drop: it writes the issue note and the news itself, and its dispatch goes on.
 */
export async function drop(name: string, a: { reason?: string; quiet?: boolean } = {}): Promise<{ job: string; name: string; state: "dropped"; reason: string }> {
  checkName(name);
  const reason = a.reason || "dropped by Chris";
  const runs = openJob(name) ?? refuse(`no open job named ${name}`);
  const last = runs.at(-1)!;
  const release = await lock(`job-${last.run.repo ?? ""}-${name}`);
  if (!release) refuse(`job ${name} is busy`);
  try {
    if (runs.some((e) => e.run.kind === "land" && isLive(e.folder))) refuse("landing");
    const repo = last.run.repo ? loadRegistry()[last.run.repo] : undefined;
    const live = runs.filter((e) => isLive(e.folder));
    for (const e of live) {
      Bun.spawnSync(["systemctl", "--user", "stop", `aleph-${e.id}`], { stdout: "ignore", stderr: "ignore" });
      if (isLive(e.folder)) process.kill(Number(readFileSync(join(e.folder, "pid"), "utf8")), "SIGTERM");
      const deadline = Date.now() + 35_000;
      while (isLive(e.folder) && Date.now() < deadline) await Bun.sleep(50);
    }
    // A held run's review2 is its own unit: stop it too, and take its scratch clone.
    for (const e of runs) {
      Bun.spawnSync(["systemctl", "--user", "stop", `aleph-${e.id}-review2`], { stdout: "ignore", stderr: "ignore" });
      if (existsSync(join(e.folder, "review2.md"))) rmSync(join(e.folder, "review2"), { recursive: true, force: true });
    }
    if (repo) removeBranch(repo, last.run);
    // Chris asked for the drop, so it is not news.
    for (const e of new Set([...live, last])) {
      if (!existsSync(join(e.folder, "exit"))) writeFileSync(join(e.folder, "exit"), "143");
      const noCommit = e.run.reason === "no commit" || e.run.noCommit ? { noCommit: true as const } : {};
      updateRun(e.folder, { ...noCommit, state: "dropped", reason, needs: undefined, phase: undefined, told: true, ended: new Date().toISOString() });
    }
    const todo = issueOf(runs);
    const why = repo && todo !== undefined && !a.quiet ? store.note(repo, todo, `job ${name} dropped: ${reason}`) : null;
    if (why) console.error(`warn: issue ${todo} has no note: ${why}`);
    if (!a.quiet) dispatchDetached();
    return { job: last.run.job, name, state: "dropped", reason };
  } finally {
    release!();
  }
}

/**
 * Start the run for a goal: `aleph job` in-process, or `ALEPH_START_CMD` (tests) as a process.
 * A foreground unit is waited for, its output dropped. Returns the refusal, or null.
 */
export async function startGoal(repo: Repo, name: string, id: number, spec: string, tier?: Tier | null): Promise<string | null> {
  const model = tier !== undefined ? tier : await route(spec);
  factoryLog(`starting ${name} with model ${model ?? "default"}`);
  if (process.env.ALEPH_START_CMD) {
    const p = Bun.spawn([process.env.ALEPH_START_CMD, repo.key, name, String(id)], { env: process.env, stdin: new Blob([spec]), stdout: "ignore", stderr: "pipe" });
    const code = await p.exited;
    return code === 0 ? null : (await new Response(p.stderr).text()).trim() || `exit ${code}`;
  }
  return refusal(async () => { await (await startJob({ repo: repo.key, name, spec, todo: id, land: true, ...(model ? { model } : {}) }, { output: "ignore" })).child?.exited; });
}

/** The factory's ports onto the transitions, each in-process; each returns the refusal, or null. */
const landGoal = (name: string) => refusal(async () => { await (await land(name, {}, { output: "ignore" })).child?.exited; });
/** A safe default drop: quiet, as the factory writes the issue note and the news. */
const dropGoal = (name: string, reason: string) => refusal(() => drop(name, { reason, quiet: true }));
const recheckGoal = (name: string) => refusal(async () => { await (await recheck(name, { output: "ignore" })).child?.exited; });

/** `aleph dispatch`: one dispatch of the ready goals. A failed probe starts no run. */
export async function runDispatch() {
  const g = gates({ only: ["pause", "probe"] });
  if (g?.gate === "probe") {
    factoryLog("the last probe failed; no run started");
    return { started: [], skipped: [g.why] };
  }
  // `ALEPH_RESCUE=off` leaves a stuck or failed run to hold the factory, as before the safe default actions; for tests of the hold.
  return dispatchGoals(startGoal, baselineChecks, landGoal, process.env.ALEPH_RESCUE === "off" ? undefined : { drop: dropGoal, recheck: recheckGoal }, route);
}
