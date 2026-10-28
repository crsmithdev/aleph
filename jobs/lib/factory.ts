/**
 * The factory around the runs: the pause file, the 24-hour cap, the timer's
 * tick, the report and its health line. Its state lives in ~/.aleph/factory,
 * which no sandbox can see. See docs/specs/2026-10-26-seed-factory.md.
 */
import { appendFileSync, closeSync, openSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as todos from "../../todo/lib/todo.ts";
import { goal, goals, note, readLists, reader } from "../../todo/lib/store.ts";
import { fetchOrigin, git } from "./git.ts";
import { takeFresh } from "./deps.ts";
import { normalizeDecision, type Decision } from "./decision.ts";
import { itemOnMain, itemStates, type ItemState } from "./status.ts";
import { countsLine, triageIssue, triageOpen, type Counts } from "./triage.ts";
import { allRuns, expand, isLive, loadRegistry, lock, tell, updateRun, type Entry, type Repo } from "./ledger.ts";
import { allJobs, isOpen, issue as issueOf, jobsNamed, lastReal, markNeedsChris, markRescued, needsChris, openJob, readFile, rescued, tailOf, type Job } from "./job.ts";
import { alreadyMet } from "./gate.ts";

export const factoryDir = () => expand(process.env.ALEPH_FACTORY_DIR ?? "~/.aleph/factory");
const pauseFile = () => join(factoryDir(), "paused");
const probeFile = () => join(factoryDir(), "probe.json");

/** `caps.json` in the factory directory: `{ "day", "live", "waiting" }`. A missing or bad file is empty. */
function capsFile(): Record<string, unknown> {
  try {
    const c = JSON.parse(readFileSync(join(factoryDir(), "caps.json"), "utf8"));
    return c && typeof c === "object" && !Array.isArray(c) ? c : {};
  } catch { return {}; }
}
/** The environment variable first, then caps.json, then the default. */
function cap(envName: string, key: string, dflt: number): number {
  const e = process.env[envName];
  if (e !== undefined && e !== "") return Number(e);
  const f = capsFile()[key];
  return typeof f === "number" && Number.isFinite(f) ? f : dflt;
}

/** Runs that start a worker, in any 24 hours. Checks and probes start none. */
export const DAY_CAP = () => cap("ALEPH_DAY_CAP", "day", 12);
/** The most agent runs live at once. */
export const LIVE_CAP = () => cap("ALEPH_LIVE_CAP", "live", 10);
const DAY = 24 * 3600_000;

export const paused = () => existsSync(pauseFile());

export function setPaused(on: boolean): void {
  mkdirSync(factoryDir(), { recursive: true });
  if (on) writeFileSync(pauseFile(), new Date().toISOString() + "\n");
  else rmSync(pauseFile(), { force: true });
}

export function factoryLog(line: string): void {
  mkdirSync(factoryDir(), { recursive: true });
  appendFileSync(join(factoryDir(), "tick.log"), `${new Date().toISOString()} ${line}\n`);
}

export const WAITING_CAP = () => cap("ALEPH_WAITING_CAP", "waiting", 5);

const sandboxRepos = () => Object.values(loadRegistry()).filter((r) => r.sandbox);

/** Factory agent and triage runs started in the last 24 hours. */
export function runsToday(now = Date.now()): Entry[] {
  const keys = new Set(sandboxRepos().map((r) => r.key));
  return allRuns().filter((e) => (e.run.kind === "agent" || e.run.kind === "triage") && e.run.repo && keys.has(e.run.repo) && now - Date.parse(e.run.started) < DAY);
}

/** Open jobs in factory repos waiting for Chris (`needs-you`; a stuck run needs no answer). */
export function waiting(jobs = allJobs()): number {
  const keys = new Set(sandboxRepos().map((r) => r.key));
  return jobs.filter((j) => isOpen(j) && j.at(-1)!.run.repo && keys.has(j.at(-1)!.run.repo!) && j.at(-1)!.run.state === "needs-you").length;
}

export interface Hold { name: string; state: string; reason?: string; line: string }

/** Whether an open job holds the factory: its last real run is stuck or failed, with no next run pending and no `needs-chris` label. */
function holds(j: Job, keys: Set<string>, except?: string): boolean {
  const last = lastReal(j);
  const r = last.run;
  return isOpen(j) && !!r.repo && keys.has(r.repo) && (r.state === "stuck" || r.state === "failed") && r.job !== except
    && !r.next && !isLive(last.folder) && !needsChris(last);
}

/** The open jobs that hold the factory, in the order given: hold's filter, which rescueStuck uses too. */
const holders = (jobs: Job[], except?: string): Job[] => {
  const keys = new Set(sandboxRepos().map((r) => r.key));
  return jobs.filter((j) => holds(j, keys, except));
};

/**
 * The factory's own hold: on while any open job in a factory repo is `stuck` or
 * `failed`. No run starts or lands by itself until it clears. `except` is a job
 * that does not count (the run asking is that job's own). Separate from the pause.
 * A run with a next run pending (`next` set, or its unit still live) does not count:
 * a conflicted land goes back to its worker by itself, and the hold waits for that.
 * A run the factory labelled `needs-chris` does not count: Chris answers it when he can.
 */
export function hold(jobs = allJobs(), except?: string): Hold | null {
  const bad = holders(jobs, except).sort((a, b) => Date.parse(a[0].run.started) - Date.parse(b[0].run.started));
  if (!bad.length) return null;
  const r = lastReal(bad[0]).run;
  const more = bad.length > 1 ? ` and ${bad.length - 1} more` : "";
  return { name: r.name, state: r.state, reason: r.reason, line: `Held: ${r.name}${more} ${bad.length > 1 ? "are" : "is"} ${r.state}${r.reason ? ` (${r.reason})` : ""}. No run starts or lands until ${bad.length > 1 ? "they are" : "it is"} cleared.` };
}

/** Passed agent runs waiting to land by themselves (`--land` or an autoland repo), oldest first. */
export function waitingToLand(jobs = allJobs()): string[] {
  const repos = loadRegistry();
  return jobs.filter((j) => {
    const last = lastReal(j);
    const r = last.run;
    return isOpen(j) && (r.kind === "agent" || r.kind === "recheck") && r.state === "passed" && !isLive(last.folder) && (r.land || (r.repo && repos[r.repo]?.autoland));
  }).sort((a, b) => Date.parse(a[0].run.started) - Date.parse(b[0].run.started)).map((j) => j.at(-1)!.run.name);
}

/** The open items labelled `goal` in each factory repo. */
export const openGoals = (): { repo: Repo; item: todos.Item }[] => goals(sandboxRepos());

/**
 * Whether `<repo>-<n>` is done, by the derived state `aleph status` gives. A
 * repo outside the registry, or an item the store lacks, is not done.
 */
export function doneChecker(): (ref: string) => boolean {
  const reg = loadRegistry();
  const known = new Map<string, ItemState[]>();
  return (ref) => {
    const r = todos.parseRef(ref);
    const repo = r && reg[r.repo];
    if (!r || !repo) return false;
    if (!known.has(r.repo)) {
      try { known.set(r.repo, itemStates(repo, { fetch: true })); } catch { known.set(r.repo, []); }
    }
    return known.get(r.repo)!.find((s) => s.item === `${r.repo}-${r.id}`)?.state === "done";
  };
}

/** Why an item is not ready to start today, or null: its `due` is after today, or what it waits on is not done. */
export function notReady(item: todos.Item, done: (ref: string) => boolean, now = todos.clock()): string | null {
  const due = item.fm.due;
  if (typeof due === "string" && todos.validDate(due) && due > todos.today(now)) return `due ${due}`;
  const waits = item.fm.waiting_on;
  if (typeof waits === "string" && !done(waits)) return `waiting on ${waits}`;
  return null;
}

/** The job name for a goal item: its store id, as `aleph-28`. */
export const goalJob = (repo: Repo, id: number) => `${repo.key}-${id}`;

/** Agent runs live now. */
export const liveEntries = (): Entry[] => allRuns().filter((e) => e.run.kind === "agent" && isLive(e.folder));
export const liveRuns = (): number => liveEntries().length;

/** The gates, in the order `gates` checks them. */
export const GATES = ["pause", "hold", "probe", "live", "day", "waiting"] as const;
export type Gate = (typeof GATES)[number];

/**
 * The first reason no run may start (or land), or null. The one place the
 * gates are checked, in the order of GATES: the pause, the hold, a failed
 * probe, the live cap, the day cap, the runs waiting for Chris. `only` limits
 * it to some of them (a caller whose other gates are met elsewhere or do not
 * apply); `jobs` and `except` are hold's and the waiting count's.
 */
export function gates(opts: { only?: readonly Gate[]; jobs?: Job[]; except?: string } = {}): { gate: Gate; why: string } | null {
  const on = (g: Gate) => !opts.only || opts.only.includes(g);
  if (on("pause") && paused()) return { gate: "pause", why: "paused" };
  if (on("hold")) {
    const h = hold(opts.jobs, opts.except);
    if (h) return { gate: "hold", why: h.line };
  }
  if (on("probe")) {
    const p = lastProbe();
    if (p && !p.ok) return { gate: "probe", why: `the sandbox probe at ${p.at} failed: ${p.failed.join("; ")}` };
  }
  if (on("live")) {
    const live = liveRuns();
    if (live >= LIVE_CAP()) return { gate: "live", why: `${live} agent runs are live` };
  }
  if (on("day") && runsToday().length >= DAY_CAP()) return { gate: "day", why: `cap of ${DAY_CAP()} runs in 24 hours` };
  if (on("waiting")) {
    const waits = waiting(opts.jobs);
    if (waits >= WAITING_CAP()) return { gate: "waiting", why: `${waits} runs wait for Chris` };
  }
  return null;
}

/** Dispatch is off when `ALEPH_DISPATCH=off`: a run's end and `aleph issue` then start nothing; the tick still does. */
export const dispatchOn = () => process.env.ALEPH_DISPATCH !== "off";

type Start = (repo: Repo, name: string, id: number, spec: string) => Promise<string | null>;
type Checks = (repo: Repo, commit: string, logs: string) => Promise<string | null>;
type Land = (name: string) => Promise<string | null>;
/** What a safe default action does to a run: both return the refusal, or null. */
export interface Rescue {
  /** Drop the job, with the reason; the factory writes the issue note and the news itself. */
  drop: (name: string, reason: string) => Promise<string | null>;
  /** Start a recheck of the job. */
  recheck: (name: string) => Promise<string | null>;
}

/**
 * Start every ready goal, in order, until the live cap: an open goal item with
 * no open job, while the factory is not paused and the other gates allow. It
 * runs when a run ends, when a goal is added or edited, and from the tick as a
 * fallback. Each start holds a lock on its goal and re-reads the jobs under it,
 * so two dispatches at once start a goal once. `start` dispatches the run; it
 * is the CLI's `aleph job`.
 */
export async function dispatchGoals(start: Start, checks?: Checks, land?: Land, rescue?: Rescue): Promise<{ started: string[]; skipped: string[]; paused?: true; held?: string; landed?: string[] }> {
  if (gates({ only: ["pause"] })) {
    factoryLog("paused");
    return { started: [], skipped: [], paused: true };
  }
  if (rescue) await rescueStuck(rescue, land, checks);
  const held = gates({ only: ["hold"] });
  if (held) {
    factoryLog(held.why);
    return { started: [], skipped: [held.why], held: held.why };
  }
  const landed: string[] = [];
  if (land) {
    // All at once: the lands queue on the repo's lock, and the first takes the rest into one batch.
    const names = waitingToLand();
    const whys = await Promise.all(names.map((name) => land(name)));
    names.forEach((name, i) => { if (!whys[i]) landed.push(name); });
    if (landed.length) factoryLog(`landed ${landed.join(", ")}`);
  }
  const started: string[] = [];
  const skipped: string[] = [];
  const reds = new Map<string, string | null>();
  const done = doneChecker();
  // Baselines run for the repos in the list, then the list is read again, until every repo in it has one. The start loop
  // works from that last list, so a goal written during any baseline is in it: a dispatch that skipped with
  // `main baseline running` has its goal started by the one that held the baseline.
  let goals = openGoals();
  if (checks) {
    for (;;) {
      const missing = goals.filter(({ repo }) => !reds.has(repo.key));
      if (!missing.length) break;
      for (const { repo } of missing) if (!reds.has(repo.key)) reds.set(repo.key, await baseline(repo, checks));
      goals = openGoals();
    }
  }
  for (const { repo, item: listed } of goals) {
    const name = goalJob(repo, listed.id);
    const red = reds.get(repo.key);
    if (red) { skipped.push(`${name}: ${red}`); continue; }
    const wait = notReady(listed, done);
    if (wait) { skipped.push(`${name}: ${wait}`); continue; }
    // Wait for a dispatch that holds the goal: it may skip it (an open job a drop is closing right now), and a
    // dispatch that skipped here too would leave the goal until the next tick. Under the lock all is read again.
    const release = await lock(`goal-${name}`);
    if (!release) { skipped.push(`${name}: another dispatch is starting it`); continue; }
    try {
      const jobs = allJobs();
      const open = openJob(name, null, jobs);
      if (open) { skipped.push(`${name}: ${open.at(-1)!.run.state}`); continue; }
      // Read after the jobs: a note added before the last run's drop is in the rerun's spec.
      const item = goal(repo, listed.id);
      if (!item) { skipped.push(`${name}: not a goal`); continue; }
      // The item may have gained a waiting_on or a due date since it was read, while the baseline ran or an earlier goal started.
      const waitNow = notReady(item, done);
      if (waitNow) { skipped.push(`${name}: ${waitNow}`); continue; }
      const gated = gates({ only: ["live", "day", "waiting"], jobs });
      if (gated) { skipped.push(`${name}: ${gated.why}`); continue; }
      const again = rerunNote(name);
      const drops = jobsNamed(name, null, jobs).filter((j) => j.at(-1)!.run.state === "dropped" && j.at(-1)!.run.reason).map((j) => `- ${j.at(-1)!.run.reason}`).reverse();
      const spec = `# ${item.title}\n\n${item.body.trim()}\n${drops.length ? `\n## Reasons of the earlier drops, newest first\n\n${drops.join("\n")}\n` : ""}${item.notes.length ? `\n## Notes on the issue\n\n${item.notes.join("\n")}\n` : ""}${again ? `\n## Note on the last run\n\n${again}\n` : ""}`;
      const why = await start(repo, name, item.id, spec);
      if (why) skipped.push(`${name}: ${why}`);
      else { started.push(name); if (again) rmSync(rerunFile(name), { force: true }); }
    } finally {
      release();
    }
  }
  factoryLog(`started ${started.join(", ") || "none"}${skipped.length ? `; skipped ${skipped.join("; ")}` : ""}`);
  return { started, skipped, ...(landed.length ? { landed } : {}) };
}

const rerunFile = (name: string) => join(factoryDir(), "rerun", `${name}.md`);
const rerunNote = (name: string): string => (existsSync(rerunFile(name)) ? readFileSync(rerunFile(name), "utf8").trim() : "");

const RERUN_OPTIONS = [
  { label: "Rerun", line: "Drop the stuck run and start the goal again as it is" },
  { label: "Another way", line: "Start the goal again, taking a different route than the run that failed" },
];

type Case = "duplicate" | "no-commit" | "claimed" | "time-box" | "infra" | "land-checks";
const INFRA = /^(job lock busy|fetch failed|systemd-run failed|worktree gone|bundle failed)/;
/** A baseline that has not answered yet (see `baseline`): the claim is waited on, not decided. */
const UNCHECKED = /^main (is unchecked|baseline running)/;

/** Which safe case a stuck or failed run is in, or null: not safe. `claim` is the worker's "already met" reason, if it made one. */
function caseOf(r: Entry["run"], onMainOrDone: () => boolean, claim: string | null): Case | null {
  const why = r.reason ?? "";
  if (why === "no commit") return onMainOrDone() ? "duplicate" : claim !== null ? "claimed" : "no-commit";
  if (why === "time box" && r.kind !== "land") return "time-box";
  if (INFRA.test(why)) return "infra";
  if (r.kind === "land" && !r.conflicts?.length && /^timed out: check |^[\w-]+ failed$/.test(why)) return "land-checks";
  return null;
}

/** How long a dispatch waits for a run's rescue lock before it skips the run. */
const RESCUE_WAIT_MS = () => Number(process.env.ALEPH_RESCUE_WAIT_MS ?? 60_000);

/**
 * The safe default actions for stuck and failed runs, taken by the dispatch that sees them: a duplicate
 * is dropped; a no-commit run whose worker says the goal is already met is checked on main, and closed when
 * the checks pass there; no commit, a time box and checks that fail after a land merge drop the run for one rerun
 * of the goal, with a note; an infrastructure failure is rechecked or landed again, once. Each action
 * writes its reason to the run, the issue note and the news. Anything else, or the second time one
 * case hits one goal, labels the issue `needs-chris` with a one-line question; such a run holds nothing.
 */
async function rescueStuck(act: Rescue, land?: Land, checks?: Checks): Promise<void> {
  const pending = (jobs: Job[]) => holders(jobs);
  for (const first of pending(allJobs())) {
    const name = first[0].run.name;
    // Wait: the dispatch that holds it may have read the job before this run ended, and would not act on it.
    const release = await lock(`rescue-${first[0].run.repo}-${name}`, RESCUE_WAIT_MS());
    if (!release) { factoryLog(`rescue of ${name} skipped: the rescue lock stayed busy`); continue; }
    try {
      // Read again under the lock: another dispatch may have acted on it.
      const runs = pending(allJobs()).find((j) => j[0].run.job === first[0].run.job);
      if (runs) await rescueJob(runs, act, land, checks);
    } catch (e: any) {
      factoryLog(`rescue of ${name} failed: ${e?.message ?? e}`);
    } finally {
      release();
    }
  }
}

async function rescueJob(runs: Job, act: Rescue, land?: Land, checks?: Checks): Promise<void> {
  const last = lastReal(runs);
  const r = last.run;
  const repo = loadRegistry()[r.repo!];
  const name = r.name;
  const todo = issueOf(runs) ?? Number(name.match(/-(\d+)$/)?.[1]);
  const issue = Number.isInteger(todo) ? todo : undefined;
  const say = (line: string) => { factoryLog(`${name}: ${line}`); return tell(`${repo.key}/${name}: ${line}`); };
  const record = (text: string, opts: { done?: boolean; label?: string; decision?: Decision } = {}) => {
    const why = issue === undefined ? "no issue" : note(repo, issue, text, opts);
    if (why) factoryLog(`${name}: no issue note: ${why}`);
  };
  const chris = async (question: string, decision?: Decision) => {
    markNeedsChris(last, question);
    record(`needs-chris: ${question}`, { label: "needs-chris", decision });
    await say(`needs-chris: ${question}`);
  };

  let onMain = false;
  const onMainOrDone = () => {
    fetchOrigin(repo.path);
    if (git(repo.path, "log", `origin/${repo.main}`, "-1", "--format=%H", "-E", `--grep=^Job: ${r.job}$`).out) { onMain = true; return true; }
    if (itemOnMain(repo, issue)) return true;
    const item = issue === undefined ? undefined : reader().item(repo.key, issue);
    return !!item && todos.status(item) !== "open";
  };
  const claim = r.reason === "no commit" ? alreadyMet(readFile(last, "result.md") ?? "") : null;
  const key = caseOf(r, onMainOrDone, claim);
  const reason = r.reason ?? r.state;
  const choice = (question: string, why: string[]) => normalizeDecision({ question, options: RERUN_OPTIONS, recommended: "Rerun", why: [`Run: ${name}, ${r.state}`, `Reason: ${reason}`, ...why] })!;
  if (!key) return chris(`${name} is ${r.state} (${reason}); drop it, recheck it, or edit the goal?`, choice(`${name} is ${r.state} (${reason}): how should the factory go on?`, ["No safe default covers this case"]));

  if (key !== "duplicate") {
    const before = allRuns().filter((e) => e.run.repo === r.repo && e.run.name === name && e.folder !== last.folder && rescued(e) === key).length;
    if (before) return chris(`${name} hit the same case again (${key}: ${reason}); a rerun did not clear it. Drop it, or change the goal?`, choice(`${name} hit the same case again (${key}): how should the factory go on?`, ["A rerun did not clear it"]));
  }
  const tryDo = async (why: string | null, what: string) => {
    if (why) { rmSync(rerunFile(name), { force: true }); await chris(`${name}: ${what} failed (${why}); ${reason}. What now?`, choice(`${name}: ${what} failed: how should the factory go on?`, [`Failure: ${why}`])); return false; }
    return true;
  };
  const rerun = (note: string) => { mkdirSync(join(factoryDir(), "rerun"), { recursive: true }); writeFileSync(rerunFile(name), note + "\n"); };
  const quoted = (file: "checks.log" | "result.md") => `\`\`\`\n${tailOf(last, file, 20) || "(empty)"}\n\`\`\``;
  markRescued(last, key);

  if (key === "claimed") {
    // The worker says the goal is met: the repo's checks on origin/<main> decide. Green closes the item; red reruns
    // the goal with the claim as its note. An unchecked main is waited on: the run stays for the next dispatch.
    const red = checks ? await baseline(repo, checks) : "main is unchecked: no checks";
    if (red && UNCHECKED.test(red)) { factoryLog(`${name}: the claim waits: ${red}`); return; }
    if (!red) {
      const text = `${r.kind} run ${last.id} says the goal is already met (${claim}), and the checks pass on origin/${repo.main}: dropped, and the item is done`;
      if (!await tryDo(await act.drop(name, text), "drop")) return;
      record(text, { done: true });
      await say(text);
    } else {
      rerun(`The last run said the goal is already met (${claim}), but the checks do not pass on origin/${repo.main} (${red}). Make the change the goal asks for.`);
      const text = `${r.kind} run ${last.id} says the goal is already met (${claim}), but ${red}; dropped, and the goal reruns once`;
      if (!await tryDo(await act.drop(name, text), "drop")) return;
      record(text);
      await say(text);
    }
  } else if (key === "duplicate") {
    const text = `${r.kind} run ${last.id} ended with no commit and the item is already ${onMain ? "on main" : "done"}: dropped as a duplicate`;
    if (!await tryDo(await act.drop(name, text), "drop")) return;
    record(text, { done: onMain });
    await say(text);
  } else if (key === "infra") {
    const text = `${r.kind} run ${last.id} failed for infrastructure (${reason}): `;
    const branch = !!r.branch && git(repo.path, "rev-parse", "--verify", "-q", `refs/heads/${r.branch}`).ok;
    if (r.kind === "land") {
      if (!await tryDo(land ? await land(name) : "no land", "land again")) return;
      record(`${text}landed again, once`);
      await say(`${text}landing again`);
    } else if (branch) {
      if (!await tryDo(await act.recheck(name), "recheck")) return;
      record(`${text}rechecked, once`);
      await say(`${text}rechecking`);
    } else {
      rerun(`The last run failed before it made a branch: ${reason}.`);
      if (!await tryDo(await act.drop(name, `${text}dropped for one rerun`), "drop")) return;
      record(`${text}dropped; the goal reruns once`);
      await say(`${text}the goal reruns`);
    }
  } else {
    const why = key === "no-commit" ? "the last run made no commit" : key === "time-box" ? "the time box ran out" : `the checks failed after the land merged main (${reason})`;
    rerun(`${why[0].toUpperCase()}${why.slice(1)}. The last 20 lines of its ${key === "land-checks" ? "checks.log" : "result.md"}:\n\n${quoted(key === "land-checks" ? "checks.log" : "result.md")}`);
    const text = `${r.kind} run ${last.id}: ${why}; dropped, and the goal reruns once`;
    if (!await tryDo(await act.drop(name, text), "drop")) return;
    record(text);
    await say(text);
  }
}

/** The tick's triage of open issues that are not goals (triage.ts). */
export async function triageStep(): Promise<{ triaged: Counts; skipped: string[] }> {
  if (gates({ only: ["pause", "hold", "probe"] })) return { triaged: {}, skipped: [] };
  const t = await triageOpen(sandboxRepos(), doneChecker());
  factoryLog(`triaged ${countsLine(t.triaged)}${t.skipped.length ? `; skipped ${t.skipped.join("; ")}` : ""}`);
  if (t.triaged.goal) dispatchDetached();
  return t;
}

/** One tick of the timer: a dispatch, as the fallback. */
export const tick = dispatchGoals;

export interface Flake { repo: string; check: string; run: string; at: string }
const flakyFile = () => join(factoryDir(), "flaky.json");
export const flakes = (): Flake[] => {
  try { return JSON.parse(readFileSync(flakyFile(), "utf8")); } catch { return []; }
};
/** A check that failed, then passed on a rerun of the same tree. */
export function recordFlake(repo: string, check: string, run: string, now = Date.now()): void {
  mkdirSync(factoryDir(), { recursive: true });
  writeFileSync(flakyFile(), JSON.stringify([...flakes(), { repo, check, run, at: new Date(now).toISOString() }], null, 2) + "\n");
}

export interface Baseline { repo: string; commit: string; ok: boolean; failed?: string }
const baselineFile = () => join(factoryDir(), "baseline.json");
const baselines = (): Record<string, Baseline> => {
  try { return JSON.parse(readFileSync(baselineFile(), "utf8")); } catch { return {}; }
};
/** The check that failed, from the gate's reason: `tests failed` is `tests`. */
const failedCheck = (why: string) => why.replace(/^timed out: check /, "").replace(/ failed$/, "");
const redLine = (b: Baseline) => `main is red at ${b.commit.slice(0, 7)}: ${b.failed}`;

/** A baseline that could not run its checks, as against a check that failed: never recorded. */
const infraError = (why: string) => /^(checks did not start|bundle failed|baseline did not run|worktree gone)/.test(why);

/**
 * Whether the repo's checks pass on its current origin/<main>: run once per
 * commit, kept in baseline.json. Returns the red line, or null when green.
 * One baseline runs per repo at a time, under a lock; a dispatch that finds it
 * taken starts nothing. Only a failed check is recorded: an error that kept
 * the checks from running is reported but tried again by the next dispatch.
 */
async function baseline(repo: Repo, checks: (repo: Repo, commit: string, logs: string) => Promise<string | null>): Promise<string | null> {
  if (!fetchOrigin(repo.path).ok) return "main is unchecked: fetch failed";
  const commit = git(repo.path, "rev-parse", `origin/${repo.main}`).out;
  if (!commit) return `main is unchecked: no origin/${repo.main}`;
  const known = () => { const b = baselines()[repo.key]; return b && b.commit === commit ? b : undefined; };
  let b = known();
  if (!b) {
    const release = await lock(`baseline-${repo.key}`, 0);
    if (!release) return "main baseline running";
    try {
      // Another dispatch may have recorded this commit between the read and the lock.
      b = known();
      if (!b) {
        const why = await checks(repo, commit, join(factoryDir(), "baseline", repo.key));
        if (why && infraError(why)) return `main is unchecked: ${why}`;
        b = { repo: repo.key, commit, ok: !why, ...(why ? { failed: failedCheck(why) } : {}) };
        mkdirSync(factoryDir(), { recursive: true });
        writeFileSync(baselineFile(), JSON.stringify({ ...baselines(), [repo.key]: b }, null, 2) + "\n");
      }
    } finally {
      release();
    }
  }
  return b.ok ? null : redLine(b);
}

export interface Probe { at: string; ok: boolean; failed: string[] }
export const lastProbe = (): Probe | null => {
  try { return JSON.parse(readFileSync(probeFile(), "utf8")); } catch { return null; }
};
export function saveProbe(p: Probe): void {
  mkdirSync(factoryDir(), { recursive: true });
  writeFileSync(probeFile(), JSON.stringify(p, null, 2) + "\n");
}
export const probeDue = (now = Date.now()) => { const p = lastProbe(); return !p || now - Date.parse(p.at) > 20 * 3600_000; };

/** The factory's health line, or null: no run in 24 hours with a goal open, or a failed probe. */
export function health(now = Date.now()): string[] {
  const lines: string[] = [];
  const goals = openGoals();
  if (goals.length && !paused() && !runsToday(now).length) lines.push(`health: no factory run started in 24 hours, with ${goals.length} open goal${goals.length > 1 ? "s" : ""}`);
  const w = waiting();
  if (w >= WAITING_CAP()) lines.push(`health: ${w} runs wait for Chris; no new run starts`);
  const p = lastProbe();
  if (p && !p.ok) lines.push(`health: the sandbox probe at ${p.at} failed: ${p.failed.join("; ")}`);
  for (const b of Object.values(baselines())) if (!b.ok) lines.push(`health: ${b.repo} ${redLine(b)}`);
  const counts = new Map<string, number>();
  for (const f of flakes()) if (now - Date.parse(f.at) < 7 * DAY) counts.set(`${f.repo} check ${f.check}`, (counts.get(`${f.repo} check ${f.check}`) ?? 0) + 1);
  for (const [k, n] of counts) if (n >= 2) lines.push(`health: ${k} passed on rerun ${n} times in 7 days`);
  return lines;
}

/** How far a checkout is behind origin/<main>, with the diff a pull would bring. */
export function behind(repo: Repo): string | null {
  const n = Number(git(repo.path, "rev-list", "--count", `HEAD..origin/${repo.main}`).out || 0);
  if (!n) return null;
  return `${repo.path} is ${n} commit${n > 1 ? "s" : ""} behind origin/${repo.main}; git pull brings:\n${git(repo.path, "diff", "--stat", "HEAD", `origin/${repo.main}`).out}`;
}

const money = (n: number) => (n > 0 && n < 0.005 ? "<$0.01" : `$${n.toFixed(2)}`);

/** One run as the report gives it. */
function entry(e: Entry): string {
  const r = e.run;
  const head = `${r.repo}/${r.name} ${r.state}${r.needs ? ` (${r.needs})` : ""}${r.round && r.state !== "stuck" ? ` after ${r.round} fix rounds` : ""}`;
  const lines = [r.reason ? `${head}: ${r.reason}` : head];
  if (r.state === "landed" && r.commit) lines.push(`  commit ${r.commit.slice(0, 7)}`);
  if (r.state === "needs-you" && (r.needs === "held" || r.needs === "review")) {
    if (r.stat) lines.push(...r.stat.split("\n").map((l) => `  ${l}`));
    lines.push(`  aleph land ${r.name}   (lands it, with Held-by: Chris)`, `  aleph drop ${r.name}   (drops it; the item stays open)`);
  }
  for (const d of r.defaults ?? []) lines.push(`  DEFAULT: ${d}`);
  const hidden = r.checks?.find((c) => c.name === "hidden" && c.total);
  if (hidden) lines.push(`  hidden ${hidden.passed}/${hidden.total}`);
  for (const c of r.checks ?? []) if (c.rerun) lines.push(`  ${c.name} passed on rerun`);
  if (r.cost !== undefined) lines.push(`  cost ${money(r.cost)} at the API price`);
  return lines.join("\n");
}

/**
 * The runs the report has not shown, oldest first; each is then marked
 * shown. `told` is Sidetone's flag and the report leaves it alone.
 */
export function report(now = Date.now()): string {
  const lines = runLines(now);
  const due = cameDue();
  if (due.length) lines.unshift(["came due:", ...due.map((d) => `  ${d}`)].join("\n"));
  const proposed = takeFresh();
  if (proposed.length) lines.push(["proposed updates (relabel one `goal` to start it):", ...proposed.map((d) => `  ${d}`)].join("\n"));
  return lines.join("\n");
}

const seenFile = () => join(factoryDir(), "seen");

/**
 * The open items whose `due` is today or earlier, or whose waited-on item is
 * done, that no report has listed; each is then written to the seen file.
 * Comparing with today, not with yesterday, catches every item in a gap.
 */
function cameDue(): string[] {
  const seen = new Set(existsSync(seenFile()) ? readFileSync(seenFile(), "utf8").split("\n").filter(Boolean) : []);
  const day = todos.today(todos.clock());
  const done = doneChecker();
  const lines: string[] = [];
  const ids: string[] = [];
  const repos = Object.values(loadRegistry());
  let docs: (todos.Doc | null)[] = [];
  try { docs = readLists(repos); } catch {}
  for (const [n, repo] of docs.map((_, n) => [n, repos[n]] as const)) {
    for (const item of docs[n]?.items ?? []) {
      const id = `${repo.key}-${item.id}`;
      if (todos.status(item) !== "open" || seen.has(id)) continue;
      const due = item.fm.due;
      const waits = item.fm.waiting_on;
      if ((typeof due === "string" && todos.validDate(due) && due <= day) || (typeof waits === "string" && done(waits))) {
        ids.push(id);
        lines.push(`${id} ${item.title}`);
      }
    }
  }
  if (ids.length) {
    mkdirSync(factoryDir(), { recursive: true });
    appendFileSync(seenFile(), ids.join("\n") + "\n");
  }
  return lines;
}

/** The runs the report has not shown, oldest first; each is then marked shown, and the last line counts the day's runs. */
function runLines(now: number): string[] {
  const fresh = allRuns().filter((e) => e.run.shown === false && e.run.kind !== "plain" && e.run.state !== "running" && !isLive(e.folder));
  const lines = fresh.map(entry);
  for (const e of fresh) updateRun(e.folder, { shown: true });
  const today = runsToday(now);
  const cost = today.reduce((a, e) => a + (e.run.cost ?? 0), 0);
  if (lines.length) lines.push(`runs in the last 24 hours: ${today.length} of ${DAY_CAP()}, ${money(cost)} at the API price${paused() ? "; the factory is paused" : ""}`);
  return lines;
}

/**
 * Triage one issue at once, as `aleph issue add`, a note that answers `needs-chris`, and a
 * worker's follow-ups do. The gates are the dispatch's: paused, the hold, a failed probe, the
 * day cap. A gated issue is left for the tick.
 */
export async function triageNow(repo: Repo, id: number): Promise<{ triaged: Counts; skipped: string[] }> {
  if (gates({ only: ["pause", "hold", "probe"] })) return { triaged: {}, skipped: [] };
  const t = await triageIssue(repo, id, doneChecker());
  factoryLog(`triaged ${repo.key}-${id}: ${countsLine(t.triaged)}${t.skipped.length ? `; skipped ${t.skipped.join("; ")}` : ""}`);
  if (t.triaged.goal) dispatchDetached();
  return t;
}

/**
 * Start `aleph dispatch` detached, for a transition that may free a slot, clear a hold or ready a
 * goal: the caller never waits for the baseline checks, and a failure never reaches it. Off when
 * `ALEPH_DISPATCH=off`; the tick still dispatches.
 */
export function dispatchDetached(): void {
  if (!dispatchOn()) return;
  try {
    mkdirSync(factoryDir(), { recursive: true });
    const log = openSync(join(factoryDir(), "dispatch.log"), "a");
    try {
      Bun.spawn([process.execPath, join(import.meta.dir, "..", "cli.ts"), "dispatch"], { env: process.env, stdin: "ignore", stdout: log, stderr: log, detached: true }).unref();
    } finally {
      closeSync(log);
    }
  } catch {}
}

/** Start `aleph triage <repo>-<id>` detached, for a factory repo's issue; it never fails the caller. */
export function triageDetached(repo: Repo, id: number): void {
  if (!dispatchOn() || !repo.sandbox) return;
  try {
    mkdirSync(factoryDir(), { recursive: true });
    const log = openSync(join(factoryDir(), "dispatch.log"), "a");
    try {
      Bun.spawn([process.execPath, join(import.meta.dir, "..", "cli.ts"), "triage", `${repo.key}-${id}`], { env: process.env, stdin: "ignore", stdout: log, stderr: log, detached: true }).unref();
    } finally {
      closeSync(log);
    }
  } catch {}
}
