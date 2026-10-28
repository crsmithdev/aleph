#!/usr/bin/env bun
/**
 * aleph <job|run|land|checked|recheck|drop|jobs|issue|unit|tick|report|pause|resume|sandbox|status|judge>
 * — detached agent jobs, plain runs, each repo's issues, and the factory.
 * Ledger: $ALEPH_JOBS_DIR or ~/.aleph/jobs. Registry: $ALEPH_REPOS or
 * ~/.aleph/repos.json. JSON on stdout, findings on stderr, exit 1 on refusal.
 * See docs/specs/2026-09-24-agent-jobs.md.
 */
import { jobArgv, route } from "./lib/route.ts";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { allJobs, allRuns, isLive, isLost, isOpen, jobsDir, loadRegistry, lock, newsLine, readReview2, stamp, updateRun, writeRun, type Entry, type Repo, type Run } from "./lib/ledger.ts";
import { baselineChecks, git, onMain, removeBranch, unit, updateTodo } from "./lib/unit.ts";
import { judgeChoice, setJudgeChoice } from "../hooks/lib/jev.ts";
import * as todos from "../todo/lib/todo.ts";
import * as store from "../todo/lib/store.ts";
import { triage } from "../todo/lib/triage.ts";
import { behind, dispatchGoals, dispatchOn, factoryDir, factoryLog, LIVE_CAP, health, hold, lastProbe, paused, probeDue, report, setPaused, triageDetached, triageNow, triageStep } from "./lib/factory.ts";
import { runPath } from "./lib/sandbox.ts";
import { probe } from "./lib/probe.ts";
import { sweep } from "./lib/deps.ts";
import { runReview2 } from "./lib/review2.ts";
import { derive, facts, FACTS_REF, itemOnMain, readFacts, type Facts } from "./lib/status.ts";

const CLI = import.meta.path;
/** The most agent runs live at once; `ALEPH_LIVE_CAP` or `caps.json` changes it. */
const CAP = LIVE_CAP;
const PID_WAIT_MS = 10_000;
const DAY_MS = 24 * 3600_000;
const RECENT_DAYS = 7;

class Refusal extends Error {}
const refuse = (msg: string): never => { throw new Refusal(msg); };
const out = (value: unknown) => console.log(JSON.stringify(value, null, 2));

const [cmd, ...rest] = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
}
// A flag's value is not a positional. Every flag here takes one, so leaving a
// name off this list silently folds its value into the next argument: `todo add
// <repo> "<title>" --labels jobs` put "jobs" on the end of the title.
const VALUED = ["--spec", "--model", "--todo", "--priority", "--labels", "--status", "--label", "--body", "--title", "--due", "--waiting-on"];
const positional = rest.filter((a, i) => !a.startsWith("--") && !VALUED.includes(rest[i - 1]));

function checkName(name: string | undefined): string {
  if (!name || !/^[A-Za-z0-9-]+$/.test(name)) refuse("the name must be letters, digits and hyphens");
  return name!;
}

const quote = (argv: string[]) => argv.map((a) => /^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replaceAll("'", `'\\''`)}'`).join(" ");

/**
 * Create the run folder and start its unit, under the dispatch lock. The lock
 * is held until the unit writes `pid`, so a second dispatch counts this run.
 */
/** Returns the unit's process in foreground mode, for the caller to wait on after it drops its locks. */
async function dispatch(run: Omit<Run, "job"> & { job?: string }, tag: string, cwd: string, prep: (folder: string) => void): Promise<ReturnType<typeof Bun.spawn> | undefined> {
  const release = await lock("dispatch");
  if (!release) refuse("another dispatch holds the lock");
  let child: ReturnType<typeof Bun.spawn> | undefined;
  let id: string;
  try {
    if (run.kind === "agent") {
      const live = allRuns().filter((e) => e.run.kind === "agent" && isLive(e.folder));
      if (live.length >= CAP()) refuse(`${live.length} agent runs are live: ${live.map((e) => e.run.name).join(", ")}`);
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
    writeFileSync(join(folder, "command.txt"), quote(["aleph", ...process.argv.slice(2)]) + "\n");
    prep(folder);
    // `made` orders the land queue: folder names sort by name within a second.
    writeRun(folder, { ...run, job: run.job ?? id, made: Date.now() } as Run);

    if (process.env.ALEPH_JOB_FOREGROUND === "1") {
      child = Bun.spawn([process.execPath, CLI, "unit", folder], { cwd, env: process.env, stdout: "inherit", stderr: "inherit" });
    } else {
      const pass = Object.entries(process.env).filter(([k]) => k.startsWith("ALEPH_") || k.startsWith("SIDETONE_")).map(([k, v]) => `--setenv=${k}=${v}`);
      // A factory run's unit is the backstop for its time box: systemd stops the whole cgroup.
      const factory = run.kind === "agent" && run.repo && loadRegistry()[run.repo]?.sandbox;
      const max = factory ? [`--property=RuntimeMaxSec=${Number(process.env.ALEPH_JOB_TIMEOUT ?? 2400) + 3600}`] : [];
      const p = Bun.spawnSync(["systemd-run", "--user", "--collect", "--quiet", `--unit=aleph-${id}`, `--working-directory=${cwd}`, ...max,
        `--setenv=PATH=${runPath()}`, ...pass, process.execPath, CLI, "unit", folder], { stdout: "pipe", stderr: "pipe" });
      if (p.exitCode !== 0) {
        updateRun(folder, { state: "failed", reason: `systemd-run failed: ${p.stderr.toString().trim()}`, ended: new Date().toISOString() });
        refuse(`systemd-run failed: ${p.stderr.toString().trim()}`);
      }
    }
    const deadline = Date.now() + PID_WAIT_MS;
    while (!existsSync(join(folder, "pid")) && Date.now() < deadline) await Bun.sleep(25);
    if (!existsSync(join(folder, "pid"))) console.error(`warn: ${id} wrote no pid in ${PID_WAIT_MS / 1000} s`);
  } finally {
    release!();
  }
  out({ run: id!, job: run.job ?? id!, folder: join(jobsDir(), id!) });
  return child;
}

async function job(): Promise<void> {
  const [repoArg, nameArg] = positional;
  const registry = loadRegistry();
  const key = (repoArg ?? "").toLowerCase().replace(/\s+/g, "");
  const repo = registry[key] ?? refuse(`unknown repo "${repoArg ?? ""}"; known: ${Object.keys(registry).join(", ")}`);
  const name = checkName(nameArg);
  const specArg = flag("spec") ?? refuse("--spec <file|-> is required");
  const spec = specArg === "-" ? await Bun.stdin.text() : readFileSync(specArg, "utf8");
  const todoArg = flag("todo");
  let todo: number | undefined;
  if (todoArg !== undefined) {
    todo = Number(todoArg);
    if (!Number.isInteger(todo)) refuse("--todo takes an issue number");
    if (!todos.find(readTodo(repo), todo!)) refuse(`${repo.key} has no issue ${todo}`);
  }

  const release = await lock(`job-${repo.key}-${name}`);
  if (!release) refuse(`job ${name} is busy`);
  let child: ReturnType<typeof Bun.spawn> | undefined;
  try {
    const open = allJobs().find((j) => isOpen(j) && j.at(-1)!.run.name === name);
    const last = open?.at(-1);
    if (last && last.run.repo !== repo.key) refuse(last.run.repo ? `${name} is open in ${last.run.repo}` : `${name} is running as ${last.id}`);
    if (last && isLive(last.folder)) refuse(`${name} is running as ${last.id}`);
    const first = open?.[0];
    const item = todo ?? open?.findLast((e) => e.run.todo !== undefined)?.run.todo;
    if (first && item !== undefined) git(repo.path, "fetch", "-q", "origin");
    const landedAs = first ? itemOnMain(repo, item) : null;
    if (landedAs) refuse(`${name}: the item already landed as ${landedAs}`);
    // A factory run has no worktree: its branch comes and goes as a bundle.
    const worktree = repo.sandbox ? undefined : first?.run.worktree ?? join(repo.path, ".worktrees", `job-${name}`);
    const model = flag("model");
    // A follow-up without --todo keeps the item the job started with.
    todo ??= open?.findLast((e) => e.run.todo !== undefined)?.run.todo;
    child = await dispatch({
      kind: "agent", job: first?.id, name, repo: repo.key, branch: `${repo.sandbox ? "factory" : "job"}/${name}`, ...(worktree ? { worktree } : {}),
      state: "running", phase: "starting", session: crypto.randomUUID(), ...(model ? { model } : {}),
      ...(todo !== undefined ? { todo } : {}), ...(rest.includes("--land") ? { land: true } : {}), told: false, shown: false, started: new Date().toISOString(),
    }, `${repo.key}-${name}`, repo.path, (folder) => {
      if (!first) return writeFileSync(join(folder, "spec.md"), spec);
      const notes = join(first.folder, "notes");
      mkdirSync(notes, { recursive: true });
      writeFileSync(join(notes, `${String(readdirSync(notes).length + 1).padStart(3, "0")}.md`), spec);
    });
  } finally {
    release!();
  }
  await child?.exited;
}

async function plain(): Promise<void> {
  const dash = rest.indexOf("--");
  const name = checkName(rest[0]);
  const argv = dash >= 0 ? rest.slice(dash + 1) : [];
  if (!argv.length) refuse("usage: aleph run <name> -- <command> [args...]");
  const release = await lock(`job--${name}`);
  if (!release) refuse(`${name} is busy`);
  let child: ReturnType<typeof Bun.spawn> | undefined;
  try {
    const live = allJobs().find((j) => isOpen(j) && j.at(-1)!.run.name === name);
    if (live) refuse(`${name} is open as ${live.at(-1)!.id}`);
    // A command inside a registered repo gets that repo's env file, as scripts/job gave Sidetone's.
    const cwd = process.cwd();
    const home = Object.values(loadRegistry()).find((r) => r.env && (cwd === r.path || cwd.startsWith(r.path + "/")));
    if (home?.env) process.env.ALEPH_RUN_ENV = home.env;
    child = await dispatch({ kind: "plain", name, state: "running", phase: "command", told: false, started: new Date().toISOString() }, name, cwd, (folder) => {
      writeFileSync(join(folder, "command.txt"), quote(argv) + "\n");
    });
  } finally {
    release!();
  }
  await child?.exited;
}

/**
 * Start a land run. The latest agent run must have passed, or need Chris for a
 * held path: his land is the review, and the commit says so. A manual check does
 * not gate the land: the land run keeps it open, as an issue, until
 * `aleph checked`. With --checked, Chris has done the check already. A run
 * from before this rule, needs-you for a manual check, lands the same way.
 * The land unit takes the job lock.
 */
async function landJob(): Promise<void> {
  const name = checkName(positional[0]);
  const runs = allJobs().find((j) => isOpen(j) && j.at(-1)!.run.name === name) ?? refuse(`no open job named ${name}`);
  const live = runs.find((e) => isLive(e.folder));
  if (live) refuse(`${name} is running as ${live.id}`);
  const agent = runs.filter((e) => e.run.kind === "agent" || e.run.kind === "recheck").at(-1)!.run;
  const manual = (agent.state === "needs-you" && agent.needs === "manual") || (agent.state === "passed" && agent.say !== undefined);
  const unchecked = manual && !rest.includes("--checked");
  const held = agent.state === "needs-you" && (agent.needs === "held" || agent.needs === "review");
  if (agent.state !== "passed" && !manual && !held) refuse(`${name} is ${agent.state}${agent.needs ? ` (${agent.needs})` : ""}, not passed`);
  const repo = loadRegistry()[agent.repo!];
  if (agent.todo !== undefined) git(repo.path, "fetch", "-q", "origin");
  const landedAs = itemOnMain(repo, agent.todo);
  if (landedAs) refuse(`${name}: the item already landed as ${landedAs}`);
  const child = await dispatch({
    kind: "land", job: agent.job, name, repo: agent.repo, branch: agent.branch, worktree: agent.worktree,
    state: "running", phase: "land", told: false, shown: false, started: new Date().toISOString(),
    ...(unchecked ? { check: "open" as const, say: agent.say } : {}),
    ...(held ? { held: true } : {}),
    ...(agent.checkedBase ? { checkedBase: agent.checkedBase } : {}),
    ...(agent.todo !== undefined ? { todo: agent.todo } : {}),
  }, `${repo.key}-${name}`, repo.path, () => {});
  await child?.exited;
}

/** Close the manual check of a job that landed with it open, and its issue. */
function checked(): void {
  const name = checkName(positional[0]);
  const last = allJobs().filter((j) => j.at(-1)!.run.name === name).at(-1)?.at(-1);
  if (!last || last.run.state !== "landed" || last.run.check !== "open") refuse(`${name} has no open check`);
  updateRun(last!.folder, { check: "done" });
  const repo = last!.run.repo ? loadRegistry()[last!.run.repo] : undefined;
  const item = last!.run.checkItem;
  const why = repo && item !== undefined ? updateTodo(repo, item, "checked by Chris", true) : null;
  if (why) console.error(`warn: issue ${item} not closed: ${why}`);
  out({ job: last!.run.job, name, state: "landed", check: "done" });
}

function read(folder: string, file: string): string | undefined {
  const p = join(folder, file);
  return existsSync(p) ? readFileSync(p, "utf8") : undefined;
}

/**
 * The ledger follows git. An open job whose work is on origin/<main> becomes
 * landed, quietly, with its issue done. An open job with no branch and
 * no worktree left is "gone": nothing is left to land. Every other open job
 * is "unlanded". Each repo is fetched once.
 */
function reconcile(all: Entry[][]): Map<string, string> {
  const registry = loadRegistry();
  const fetched = new Set<string>();
  const fates = new Map<string, string>();
  // Only Chris's git pull moves a checkout: the ledger fetches and reads refs.
  for (const runs of all.filter(isOpen)) {
    const last = runs.at(-1)!;
    const repo = last.run.repo ? registry[last.run.repo] : undefined;
    if (!repo || last.run.kind === "plain" || isLive(last.folder)) continue;
    if (!fetched.has(repo.key)) {
      fetched.add(repo.key);
      git(repo.path, "fetch", "-q", "origin");
    }
    const found = onMain(repo, last.run);
    if (found) {
      updateRun(last.folder, { state: "landed", commit: found.commit, reason: `found on main (${found.how})`, needs: undefined, told: true });
      removeBranch(repo, last.run);
      const todo = runs.findLast((e) => e.run.todo !== undefined)?.run.todo;
      const why = todo === undefined ? null : updateTodo(repo, todo, `job ${last.run.name} found on main as ${found.commit.slice(0, 7)}`, true);
      if (why) console.error(`warn: issue ${todo} not closed: ${why}`);
      continue;
    }
    const branch = last.run.branch && git(repo.path, "rev-parse", "--verify", "-q", `refs/heads/${last.run.branch}`).ok;
    fates.set(last.run.job, branch || (last.run.worktree && existsSync(last.run.worktree)) ? "unlanded" : "gone");
  }
  return fates;
}

function summary(runs: Entry[], fates = new Map<string, string>()) {
  const first = runs[0];
  const last = runs.at(-1)!;
  const r = last.run;
  const goal = (read(first.folder, "spec.md") ?? read(first.folder, "command.txt") ?? "").trim().split("\n")[0];
  return {
    name: r.name, repo: r.repo, kind: r.kind, job: r.job, run: last.id, goal, state: r.state, needs: r.needs, phase: r.phase,
    reason: r.reason, say: r.say, review2: readReview2(last.folder), ...(r.state === "landed" && r.check ? { check: r.check } : {}), fate: fates.get(r.job), session: r.session, started: first.run.started, ended: r.ended,
    ...(isLost(last.folder) ? { lost: true } : {}),
  };
}

function jobs(): void {
  if (rest.includes("--news")) {
    const news: { run: string; line: string }[] = [];
    for (const e of allRuns()) {
      if (e.run.state === "running" || e.run.told) continue;
      news.push({ run: e.id, line: newsLine(e.run, e.run.repo ? loadRegistry()[e.run.repo]?.note : undefined) });
      updateRun(e.folder, { told: true });
    }
    return out(news);
  }
  const fates = reconcile(allJobs());
  const all = allJobs();
  const name = positional[0];
  // A job that landed with its check open stays in the list until `aleph checked`.
  // A job that ended in the last 24 hours follows the open ones, the latest first.
  if (!name) {
    const listed = (j: Entry[]) => isOpen(j) || (j.at(-1)!.run.state === "landed" && j.at(-1)!.run.check === "open");
    const ended = (j: Entry[]) => Date.parse(j.at(-1)!.run.ended ?? "");
    const recent = all.filter((j) => !listed(j) && Date.now() - ended(j) < DAY_MS).sort((a, b) => ended(b) - ended(a));
    return out([...all.filter(listed), ...recent].map((j) => summary(j, fates)));
  }
  const runs = all.filter(isOpen).find((j) => j.at(-1)!.run.name === name) ?? all.filter((j) => j.at(-1)!.run.name === name).at(-1);
  if (!runs) refuse(`no job named ${name}`);
  const last = runs!.at(-1)!;
  const checks = read(last.folder, "checks.log");
  out({
    ...summary(runs!, fates), question: last.run.question, result: read(last.folder, "result.md"),
    checks: checks?.trimEnd().split("\n").slice(-40).join("\n"), land: read(last.folder, "land.log"),
  });
}

/**
 * Start a recheck run: the last run of an open job is an agent or recheck run
 * that ended stuck or failed, and its branch still exists. The run merges main
 * into the branch and runs the checks and the reviewer again; no worker starts.
 */
async function recheck(): Promise<void> {
  const name = checkName(positional[0]);
  const found = allJobs().find((j) => isOpen(j) && j.at(-1)!.run.name === name) ?? refuse(`no open job named ${name}`);
  const release = await lock(`job-${found.at(-1)!.run.repo ?? ""}-${name}`);
  if (!release) refuse(`job ${name} is busy`);
  let child: ReturnType<typeof Bun.spawn> | undefined;
  try {
    const runs = allJobs().find((j) => isOpen(j) && j.at(-1)!.run.name === name) ?? refuse(`no open job named ${name}`);
    const last = runs.at(-1)!;
    if (isLive(last.folder)) refuse(`${name} is running as ${last.id}`);
    const r = last.run;
    if (r.kind !== "agent" && r.kind !== "recheck") refuse(`${name}: the last run is a ${r.kind} run, not an agent run`);
    if (r.state !== "stuck" && r.state !== "failed") refuse(`${name} is ${r.state}, not stuck or failed`);
    const repo = loadRegistry()[r.repo ?? ""];
    if (!repo?.sandbox) refuse(`${name} is not a factory job`);
    if (!r.branch || !git(repo.path, "rev-parse", "--verify", "-q", `refs/heads/${r.branch}`).ok) refuse(`${name} has no branch: drop it`);
    const todo = runs.findLast((e) => e.run.todo !== undefined)?.run.todo;
    child = await dispatch({
      kind: "recheck", job: runs[0].id, name, repo: repo.key, branch: r.branch, state: "running", phase: "starting",
      ...(todo !== undefined ? { todo } : {}), ...(runs.some((e) => e.run.land) ? { land: true } : {}), told: false, shown: false, started: new Date().toISOString(),
    }, `${repo.key}-${name}`, repo.path, () => {});
  } finally {
    release!();
  }
  await child?.exited;
}

async function drop(): Promise<void> {
  const name = checkName(positional[0]);
  const reason = positional.slice(1).join(" ") || "dropped by Chris";
  const runs = allJobs().find((j) => isOpen(j) && j.at(-1)!.run.name === name) ?? refuse(`no open job named ${name}`);
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
    if (repo) removeBranch(repo, last.run);
    // Chris asked for the drop, so it is not news.
    for (const e of new Set([...live, last])) {
      if (!existsSync(join(e.folder, "exit"))) writeFileSync(join(e.folder, "exit"), "143");
      updateRun(e.folder, { state: "dropped", reason, needs: undefined, phase: undefined, told: true, ended: new Date().toISOString() });
    }
    const todo = runs.findLast((e) => e.run.todo !== undefined)?.run.todo;
    const why = repo && todo !== undefined ? updateTodo(repo, todo, `job ${name} dropped: ${reason}`, false) : null;
    if (why) console.error(`warn: issue ${todo} has no note: ${why}`);
    out({ job: last.run.job, name, state: "dropped", reason });
  } finally {
    release!();
  }
}

/** After `aleph issue add` or `edit` of an open goal in a factory repo: a dispatch, so the goal starts at once. It never fails the write. */
async function dispatchAfterGoal(repo: Repo, item: todos.Item): Promise<void> {
  if (!dispatchOn() || !repo.sandbox || todos.status(item) !== "open" || !((item.fm.labels as string[]) ?? []).includes("goal")) return;
  try {
    // Detached: the dispatch may run the baseline checks for minutes, and the write must not wait for them.
    mkdirSync(factoryDir(), { recursive: true });
    const log = openSync(join(factoryDir(), "dispatch.log"), "a");
    try {
      Bun.spawn([process.execPath, CLI, "dispatch"], { env: process.env, stdin: "ignore", stdout: log, stderr: log, detached: true }).unref();
    } finally {
      closeSync(log);
    }
  } catch (e: any) { console.error(`warn: dispatch failed: ${e?.message ?? e}`); }
}

/**
 * aleph issue <add|list|show|note|done|drop|lint> <repo> ... — every repo in the
 * registry has a list in the work store (todo/lib/store.ts). Status is a
 * field, so an item never moves and never gets a new number.
 */
async function todoCmd(): Promise<void> {
  const [verb, repoKey, ...args] = positional;
  const sub = verb ?? refuse("usage: aleph issue <add|list|show|note|edit|done|drop|hidden|lint> <repo> ...");
  if (!repoKey && (sub === "list" || sub === "lint")) return todoRecent(sub);
  const repo = loadRegistry()[repoKey ?? ""] ?? refuse(repoKey ? `no repo named ${repoKey}` : "name a repo");

  const pick = (doc: todos.Doc): todos.Item => {
    const id = Number(args[0]);
    if (!Number.isInteger(id)) refuse("name an issue by its number");
    return todos.find(doc, id) ?? refuse(`${repo.key} has no issue ${id}`);
  };
  // Every verb but `add` needs a list on main; `add` starts one.
  const write = <T>(message: string, change: (doc: todos.Doc) => T | null, create = false) => {
    let written;
    try {
      written = store.writeList(repo, message, change, create);
    } catch (e: any) {
      if (e instanceof Refusal) throw e;
      refuse(e?.message ?? String(e));
    }
    if (written?.follow) console.error(`warn: ${written.follow}`);
    return written;
  };
  // `--body -` reads the body from stdin: it is prose of several lines.
  const bodyArg = flag("body");
  const body = bodyArg === undefined ? undefined : (bodyArg === "-" ? await Bun.stdin.text() : bodyArg).trim();
  const labelsArg = flag("labels");
  const labels = labelsArg === undefined ? undefined : labelsArg.split(",").map((s) => s.trim()).filter(Boolean);
  // `none` removes the field; a bad value is refused before anything is written.
  const due = flag("due");
  if (due !== undefined && due !== "none" && !todos.validDate(due)) refuse("--due takes YYYY-MM-DD or none");
  const waitingOn = flag("waiting-on");
  if (waitingOn !== undefined && waitingOn !== "none" && !todos.parseRef(waitingOn)) refuse("--waiting-on takes <repo>-<n> or none");

  switch (sub) {
    case "add": {
      const title = args.join(" ").trim() || refuse("give the item a title");
      let existing: todos.Doc | null = null;
      try { existing = store.readList(repo); } catch {}
      const t = await triage(existing, title, body ?? "");
      const w = write("todo: add an item", (doc) => todos.add(doc, title, { priority: flag("priority"), labels: labels ?? t.labels, body, due, waitingOn }), true)!;
      for (const m of t.maybeSame) console.error(`aleph-${m.id} may be the same task: ${m.title}`);
      out({ repo: repo.key, added: w.value.id, title: w.value.title, commit: w.commit, ...(t.maybeSame.length ? { maybeSame: t.maybeSame } : {}) });
      await dispatchAfterGoal(repo, w.value);
      if (!((w.value.fm.labels as string[]) ?? []).includes("goal")) triageDetached(repo, w.value.id);
      return;
    }
    case "list": {
      const rows = listRows(readTodo(repo));
      if (rest.includes("--json")) { out(rows.map(brief)); return; }
      if (!rows.length) { console.log("no issues"); return; }
      printRows(rows);
      return;
    }
    case "show": {
      const i = pick(readTodo(repo));
      if (rest.includes("--json")) { out({ ...brief(i), body: i.body, notes: i.notes, hidden: hiddenCount(repo, i.id) }); return; }
      console.log(`## ${i.id}. ${i.title}`);
      console.log(`status ${todos.status(i)}   priority ${i.fm.priority ?? "-"}   labels ${(((i.fm.labels as string[]) ?? []).join(", ")) || "-"}   updated ${i.fm.updated ?? "-"}`);
      console.log(`due ${i.fm.due ?? "-"}   waiting_on ${i.fm.waiting_on ?? "-"}`);
      console.log(`hidden checks: ${hiddenCount(repo, i.id)}`);
      if (i.body.trim()) console.log(`\n${i.body}`);
      if (i.notes.length) console.log(`\n### Notes\n${i.notes.join("\n")}`);
      return;
    }
    case "hidden": {
      const i = pick(readTodo(repo));
      const paths = args.slice(1);
      let have: Record<string, string>;
      try {
        if (!paths.length) {
          have = store.readHidden(repo, i.id);
          if (rest.includes("--json")) { out(Object.keys(have)); return; }
          if (!Object.keys(have).length) console.log("no hidden checks");
          for (const n of Object.keys(have)) console.log(n);
          return;
        }
        const files: Record<string, string> = {};
        for (const p of paths) {
          if (!existsSync(p) || !statSync(p).isFile()) refuse(`${p} is not a file`);
          files[basename(p)] = readFileSync(p, "utf8");
        }
        const w = store.writeHidden(repo, i.id, files);
        if (w.follow) console.error(`warn: ${w.follow}`);
        out({ repo: repo.key, id: i.id, hidden: Object.keys(files), commit: w.commit });
      } catch (e: any) {
        if (e instanceof Refusal) throw e;
        refuse(e?.message ?? String(e));
      }
      return;
    }
    case "note": {
      const text = args.slice(1).join(" ").trim() || refuse("give the note some text");
      // Chris's answer to a `needs-chris` issue: not a worker's note (ALEPH_JOB_ID) and not the factory's own.
      const answer = !process.env.ALEPH_JOB_ID && !/^(triage|job \S+ landed)\b/.test(text);
      const w = write(`todo: a note on item ${args[0]}`, (doc) => {
        const i = pick(doc);
        const line = todos.note(i, text);
        const ls = (i.fm.labels as string[]) ?? [];
        const answered = answer && ls.includes("needs-chris");
        if (answered) todos.edit(i, { labels: ls.filter((l) => l !== "needs-chris") });
        return { id: i.id, line, answered };
      })!;
      out({ repo: repo.key, id: w.value.id, note: w.value.line, commit: w.commit });
      if (w.value.answered) triageDetached(repo, w.value.id);
      return;
    }
    case "edit": {
      const title = flag("title")?.trim();
      const priority = flag("priority");
      if (title === undefined && body === undefined && priority === undefined && labels === undefined && due === undefined && waitingOn === undefined) refuse("give --title, --body, --priority, --labels, --due or --waiting-on");
      if (title === "") refuse("the title cannot be empty");
      const w = write(`todo: edit item ${args[0]}`, (doc) => {
        const i = pick(doc);
        todos.edit(i, { title, body, priority, labels, due, waitingOn });
        return i;
      })!;
      out({ repo: repo.key, ...brief(w.value), commit: w.commit });
      await dispatchAfterGoal(repo, w.value);
      return;
    }
    case "done":
    case "drop": {
      const text = args.slice(1).join(" ").trim();
      if (sub === "drop" && !text) refuse("say why it is dropped");
      const w = write(`todo: item ${args[0]} ${sub === "done" ? "done" : "dropped"}`, (doc) => {
        const i = pick(doc);
        todos.setStatus(i, sub === "done" ? "done" : "dropped");
        if (text) todos.note(i, text);
        return i;
      })!;
      out({ repo: repo.key, id: w.value.id, status: todos.status(w.value), title: w.value.title, commit: w.commit });
      return;
    }
    case "lint": {
      if (rest.includes("--fix")) {
        const w = write("todo: lint --fix", (doc) => { const fixed = todos.fix(doc); return fixed.length ? { fixed, left: todos.lint(doc, itemExists(repo.key, doc)) } : null; });
        const left = w?.value.left ?? todos.lint(readTodo(repo), itemExists(repo.key));
        out({ repo: repo.key, fixed: w?.value.fixed ?? [], remaining: left });
        if (left.length) process.exit(1);
        return;
      }
      const doc = readTodo(repo);
      const findings = todos.lint(doc, itemExists(repo.key, doc));
      if (!findings.length) { out({ repo: repo.key, items: doc.items.length, findings: [] }); return; }
      for (const f of findings) console.error(`item ${f.id}: ${f.problem}${f.fixable ? " (--fix repairs this)" : ""}`);
      refuse(`${findings.length} problem${findings.length > 1 ? "s" : ""} in the ${repo.key} list`);
    }
    default: refuse("usage: aleph issue <add|list|show|note|edit|done|drop|hidden|lint> <repo> ...");
  }
}

/** How many hidden check files an item has in the store. */
const hiddenCount = (repo: Repo, id: number): number => Object.keys(store.readHidden(repo, id)).length;

const brief = (i: todos.Item) => ({ id: i.id, title: i.title, status: todos.status(i), priority: i.fm.priority ?? null, labels: i.fm.labels ?? [], updated: i.fm.updated ?? null, due: i.fm.due ?? null, waiting_on: i.fm.waiting_on ?? null, notes: i.notes.length, legacy: i.legacy || undefined });
const ready = (i: todos.Item) => [i.fm.due ? `due ${i.fm.due}` : "", i.fm.waiting_on ? `waits ${i.fm.waiting_on}` : ""].filter(Boolean).join("  ");

/** The items of a list that pass `--status` and `--label`. */
function listRows(doc: todos.Doc): todos.Item[] {
  const want = flag("status");
  if (want && !todos.STATUSES.includes(want as todos.Status)) refuse(`status must be one of ${todos.STATUSES.join(", ")}`);
  const label = flag("label");
  return doc.items
    .filter((i) => (want ? todos.status(i) === want : true))
    .filter((i) => (label ? ((i.fm.labels as string[]) ?? []).includes(label) : true));
}

function printRows(rows: todos.Item[], indent = ""): void {
  const w = String(Math.max(...rows.map((i) => i.id))).length;
  for (const i of rows) console.log(`${indent}${String(i.id).padStart(w)}  ${todos.status(i).padEnd(7)} ${i.title}${ready(i) ? `  (${ready(i)})` : ""}`);
}

/**
 * The registry's repos with a ledger run or an item update in the last 7
 * days, the latest first, each with its list (null when the store has none).
 */
function recentRepos(): { repo: Repo; doc: todos.Doc | null }[] {
  const since = Date.now() - RECENT_DAYS * DAY_MS;
  const last = new Map<string, number>();
  const seen = (key: string, t: number) => { if (t >= since && t > (last.get(key) ?? 0)) last.set(key, t); };
  for (const e of allRuns()) if (e.run.repo) seen(e.run.repo, Date.parse(e.run.started));
  const repos = Object.values(loadRegistry());
  let docs: (todos.Doc | null)[];
  try { docs = store.readLists(repos); } catch (e: any) { refuse(e?.message ?? String(e)); }
  const all = repos.map((repo, n) => {
    for (const i of docs[n]?.items ?? []) if (i.fm.updated) seen(repo.key, Date.parse(String(i.fm.updated)));
    return { repo, doc: docs[n] };
  });
  return all.filter((r) => last.has(r.repo.key)).sort((a, b) => last.get(b.repo.key)! - last.get(a.repo.key)!);
}

/** `aleph issue list` and `aleph issue lint` with no repo: each recent repo. */
function todoRecent(sub: "list" | "lint"): void {
  const lists = recentRepos().filter((r) => r.doc);
  if (sub === "lint") {
    const results = lists.map(({ repo, doc }) => ({ repo: repo.key, items: doc!.items.length, findings: todos.lint(doc!, itemExists(repo.key, doc!)) }));
    for (const r of results) for (const f of r.findings) console.error(`${r.repo} item ${f.id}: ${f.problem}${f.fixable ? " (--fix repairs this)" : ""}`);
    out(results);
    if (results.some((r) => r.findings.length)) process.exit(1);
    return;
  }
  const rows = lists.map(({ repo, doc }) => ({ repo: repo.key, items: listRows(doc!) })).filter((r) => r.items.length);
  if (rest.includes("--json")) { out(rows.map((r) => ({ repo: r.repo, items: r.items.map(brief) }))); return; }
  if (!rows.length) { console.log("no issues"); return; }
  for (const r of rows) { console.log(r.repo); printRows(r.items, "  "); }
}

/** Start the run for a goal: `ALEPH_START_CMD` (tests) or `aleph job`. Returns the refusal, or null. */
async function startRun(repo: Repo, name: string, id: number, spec: string): Promise<string | null> {
  const model = await route(spec);
  factoryLog(`starting ${name} with model ${model ?? "default"}`);
  const argv = process.env.ALEPH_START_CMD ? [process.env.ALEPH_START_CMD, repo.key, name, String(id)] : jobArgv(process.execPath, CLI, repo.key, name, id, model);
  const p = Bun.spawn(argv, { env: process.env, stdin: new Blob([spec]), stdout: "ignore", stderr: "pipe" });
  const code = await p.exited;
  return code === 0 ? null : (await new Response(p.stderr).text()).trim() || `exit ${code}`;
}

/** One dispatch of the ready goals. A failed probe starts no run. */
async function runDispatch() {
  const p = lastProbe();
  if (!paused() && p && !p.ok) {
    factoryLog("the last probe failed; no run started");
    return { started: [], skipped: [`the sandbox probe at ${p.at} failed: ${p.failed.join("; ")}`] };
  }
  return dispatchGoals(startRun, baselineChecks, landRun);
}

/** A land the hold had kept waiting: `aleph land <name>`. Returns the refusal, or null. */
async function landRun(name: string): Promise<string | null> {
  const p = Bun.spawn([process.execPath, CLI, "land", name], { env: process.env, stdin: "ignore", stdout: "ignore", stderr: "pipe" });
  const code = await p.exited;
  return code === 0 ? null : (await new Response(p.stderr).text()).trim() || `exit ${code}`;
}

/** `aleph triage <repo>-<n>`: triage one issue now, under the dispatch's gates. */
async function triageCmd(): Promise<void> {
  const ref = todos.parseRef(rest[0] ?? "") ?? refuse("usage: aleph triage <repo>-<n>");
  const repo = loadRegistry()[ref.repo] ?? refuse(`no repo ${ref.repo}`);
  out(await triageNow(repo, ref.id));
}

/** `aleph dispatch`: start every ready goal up to the live cap. A run's end and `aleph issue` call it. */
async function dispatchCmd(): Promise<void> {
  out(await runDispatch());
}

/**
 * `aleph tick`, from the timer: the nightly probe when due, and the dependency sweep only after a
 * passing probe, then a dispatch as the fallback for what no run's end and no issue write has
 * started. A failed probe starts no run and no sweep.
 */
async function tickCmd(): Promise<void> {
  if (!paused() && probeDue()) {
    const repo = Object.values(loadRegistry()).find((r) => r.sandbox);
    if (repo) {
      mkdirSync(factoryDir(), { recursive: true });
      const p = await probe(repo, join(factoryDir(), "probe.log"));
      factoryLog(`probe ${p.ok ? "passed" : `failed: ${p.failed.join("; ")}`}`);
      if (p.ok) {
        const proposed = await sweep(Object.values(loadRegistry()).filter((r) => r.sandbox), factoryLog);
        if (proposed.length) factoryLog(`proposed ${proposed.join("; ")}`);
      }
    }
  }
  const d = await runDispatch();
  const p = lastProbe();
  const t = !paused() && !(p && !p.ok) && !d.held ? await triageStep() : { triaged: {}, skipped: [] };
  out({ ...d, skipped: [...d.skipped, ...t.skipped], triaged: t.triaged });
}

/**
 * `aleph report`: the runs not yet shown, how far each factory repo's
 * checkout is behind origin, and the health line. With --hook it prints the
 * SessionStart hook's JSON, and nothing when there is nothing to say.
 */
function reportCmd(): void {
  const lines = [report()];
  for (const repo of Object.values(loadRegistry()).filter((r) => r.sandbox)) {
    git(repo.path, "fetch", "-q", "origin");
    lines.push(behind(repo) ?? "");
  }
  const h = hold();
  if (h) lines.push(h.line);
  lines.push(...health());
  const text = lines.filter(Boolean).join("\n\n");
  if (!rest.includes("--hook")) { console.log(text || "nothing new"); return; }
  if (!text) return;
  const msg = `aleph report\n\n${text}`;
  out({ systemMessage: msg, hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: msg } });
}

/**
 * `aleph status <repo>-<n>`: the issue's derived state; with no issue, see statusRecent. In Chris's session the
 * facts come from the store and the ledger; in a sandbox, where neither is,
 * they come from the bundle's snapshot at refs/aleph/facts in the current repo.
 */
function statusCmd(): void {
  if (!positional[0]) return statusRecent();
  const m = (positional[0] ?? "").match(/^(.+)-(\d+)$/) ?? refuse("usage: aleph status [<repo>-<n>] [--json]");
  const [, key, n] = m!;
  const repo = loadRegistry()[key];
  let cwd = process.cwd();
  let f: Facts;
  if (repo) {
    cwd = repo.path;
    git(cwd, "fetch", "-q", "origin");
    try { f = facts(repo); } catch (e: any) { refuse(e?.message ?? String(e)); }
  } else {
    const snap = readFacts(cwd);
    if (!snap || snap.repo !== key) refuse(`no repo named ${key} in the registry, and no ${FACTS_REF} for it here`);
    f = snap!;
  }
  const s = derive(cwd, `refs/remotes/origin/${f!.main}`, f!, Number(n)) ?? refuse(`${key} has no issue ${n}`);
  if (rest.includes("--json")) return out(s);
  console.log(`${s!.item} ${s!.state}: ${s!.why}`);
}

/** `aleph status` with no issue: the derived state of each open issue in each recent repo. */
function statusRecent(): void {
  const states = [];
  for (const { repo, doc } of recentRepos()) {
    const open = (doc?.items ?? []).filter((i) => todos.status(i) === "open");
    if (!open.length) continue;
    git(repo.path, "fetch", "-q", "origin");
    let f: Facts;
    try { f = facts(repo); } catch (e: any) { console.error(`warn: ${repo.key}: ${e?.message ?? e}`); continue; }
    for (const i of open) { const s = derive(repo.path, `refs/remotes/origin/${f.main}`, f, i.id); if (s) states.push(s); }
  }
  if (rest.includes("--json")) return out(states);
  if (!states.length) { console.log("no open items"); return; }
  for (const s of states) console.log(`${s.item} ${s.state}: ${s.why}`);
}

/** Whether `<repo>-<n>` names an item in the work store; `own` is the list already read for `key`. */
function itemExists(key: string, own?: todos.Doc): (repo: string, id: number) => boolean {
  const lists = new Map<string, todos.Doc | null>(own ? [[key, own]] : []);
  return (r, id) => {
    if (!lists.has(r)) {
      let doc: todos.Doc | null = null;
      try { doc = loadRegistry()[r] ? store.readList({ key: r }) : null; } catch {}
      lists.set(r, doc);
    }
    return !!lists.get(r) && todos.find(lists.get(r)!, id) !== undefined;
  };
}

/** The repo's list in the work store; a refusal when the store has none or the fetch fails. */
function readTodo(repo: store.Place): todos.Doc {
  let doc: todos.Doc | null = null;
  try { doc = store.readList(repo); } catch (e: any) { refuse(e?.message ?? String(e)); }
  return doc ?? refuse(`the work store has no list for ${repo.key}`);
}

try {
  switch (cmd) {
    case "job": await job(); break;
    case "run": await plain(); break;
    case "jobs": jobs(); break;
    case "recheck": await recheck(); break;
    case "review2": await runReview2(positional[0] ?? refuse("usage: aleph review2 <run-folder>")); break;
    case "drop": await drop(); break;
    case "unit": await unit(resolve(positional[0])); break;
    case "land": await landJob(); break;
    case "checked": checked(); break;
    case "issue": case "todo": await todoCmd(); break;
    case "tick": await tickCmd(); break;
    case "dispatch": await dispatchCmd(); break;
    case "triage": await triageCmd(); break;
    case "status": statusCmd(); break;
    case "report": reportCmd(); break;
    case "pause": setPaused(true); out({ paused: true }); break;
    case "resume": setPaused(false); out({ paused: false }); break;
    case "judge": {
      const v = positional[0];
      if (v === "jev" || v === "haiku") setJudgeChoice(v);
      else if (v !== undefined) refuse("usage: aleph judge [jev|haiku]");
      out({ judge: judgeChoice() });
      break;
    }
    case "sandbox": {
      if (positional[0] !== "probe") refuse("usage: aleph sandbox probe");
      const repo = Object.values(loadRegistry()).find((r) => r.sandbox) ?? refuse("no repo in the registry has sandbox: true");
      mkdirSync(factoryDir(), { recursive: true });
      const p = await probe(repo, join(factoryDir(), "probe.log"));
      out(p);
      if (!p.ok) process.exit(1);
      break;
    }
    default: refuse("usage: aleph <job|run|land|checked|recheck|drop|jobs|issue|tick|report|pause|resume|sandbox|status|judge|dispatch> ...");
  }
} catch (e) {
  if (!(e instanceof Refusal)) throw e;
  console.error(e.message);
  process.exit(1);
}
