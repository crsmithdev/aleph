/**
 * The factory around the runs: the pause file, the 24-hour cap, the timer's
 * tick, the report and its health line. Its state lives in ~/.aleph/factory,
 * which no sandbox can see. See docs/specs/2026-10-26-seed-factory.md.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as todos from "../../todo/lib/todo.ts";
import { readList, readLists } from "../../todo/lib/store.ts";
import { git } from "./git.ts";
import { derive, facts, type Facts } from "./status.ts";
import { allJobs, allRuns, expand, isLive, isOpen, loadRegistry, updateRun, type Entry, type Repo } from "./ledger.ts";

export const factoryDir = () => expand(process.env.ALEPH_FACTORY_DIR ?? "~/.aleph/factory");
const pauseFile = () => join(factoryDir(), "paused");
const probeFile = () => join(factoryDir(), "probe.json");

/** Runs that start a worker, in any 24 hours. Checks and probes start none. */
export const DAY_CAP = () => Number(process.env.ALEPH_DAY_CAP ?? 12);
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

export const WAITING_CAP = () => Number(process.env.ALEPH_WAITING_CAP ?? 5);

const sandboxRepos = () => Object.values(loadRegistry()).filter((r) => r.sandbox);

/** Factory agent runs started in the last 24 hours. */
export function runsToday(now = Date.now()): Entry[] {
  const keys = new Set(sandboxRepos().map((r) => r.key));
  return allRuns().filter((e) => e.run.kind === "agent" && e.run.repo && keys.has(e.run.repo) && now - Date.parse(e.run.started) < DAY);
}

/** Open jobs in factory repos waiting for Chris (`needs-you`; a stuck run needs no answer). */
export function waiting(jobs = allJobs()): number {
  const keys = new Set(sandboxRepos().map((r) => r.key));
  return jobs.filter((j) => isOpen(j) && j.at(-1)!.run.repo && keys.has(j.at(-1)!.run.repo!) && j.at(-1)!.run.state === "needs-you").length;
}

/** The open items labelled `goal` in each factory repo. */
export function openGoals(): { repo: Repo; item: todos.Item }[] {
  const out: { repo: Repo; item: todos.Item }[] = [];
  for (const repo of sandboxRepos()) {
    let doc: todos.Doc | null = null;
    try { doc = readList(repo); } catch { continue; }
    for (const item of doc?.items ?? []) {
      if (todos.status(item) === "open" && ((item.fm.labels as string[]) ?? []).includes("goal")) out.push({ repo, item });
    }
  }
  return out;
}

/**
 * Whether `<repo>-<n>` is done, by the derived state `aleph status` gives. A
 * repo outside the registry, or an item the store lacks, is not done.
 */
export function doneChecker(): (ref: string) => boolean {
  const reg = loadRegistry();
  const known = new Map<string, Facts | null>();
  return (ref) => {
    const r = todos.parseRef(ref);
    const repo = r && reg[r.repo];
    if (!r || !repo) return false;
    if (!known.has(r.repo)) {
      git(repo.path, "fetch", "-q", "origin");
      try { known.set(r.repo, facts(repo)); } catch { known.set(r.repo, null); }
    }
    const f = known.get(r.repo);
    return !!f && derive(repo.path, `refs/remotes/origin/${repo.main}`, f, r.id)?.state === "done";
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

/**
 * One tick of the timer. It starts one run for each open goal item with no
 * open job, while the factory is not paused and the caps allow. `start`
 * dispatches the run; it is the CLI's `aleph job`.
 */
export async function tick(
  start: (repo: Repo, name: string, id: number, spec: string) => Promise<string | null>,
  checks?: (repo: Repo, commit: string, logs: string) => Promise<string | null>,
): Promise<{ started: string[]; skipped: string[]; paused?: true }> {
  if (paused()) {
    factoryLog("paused");
    return { started: [], skipped: [], paused: true };
  }
  const started: string[] = [];
  const skipped: string[] = [];
  const jobs = allJobs();
  const waits = waiting(jobs);
  const reds = new Map<string, string | null>();
  const done = doneChecker();
  for (const { repo, item } of openGoals()) {
    const name = goalJob(repo, item.id);
    if (checks && !reds.has(repo.key)) reds.set(repo.key, await baseline(repo, checks));
    const red = reds.get(repo.key);
    if (red) { skipped.push(`${name}: ${red}`); continue; }
    const open = jobs.find((j) => isOpen(j) && j.at(-1)!.run.name === name);
    if (open) { skipped.push(`${name}: ${open.at(-1)!.run.state}`); continue; }
    const wait = notReady(item, done);
    if (wait) { skipped.push(`${name}: ${wait}`); continue; }
    if (runsToday().length >= DAY_CAP()) {
      skipped.push(`${name}: cap of ${DAY_CAP()} runs in 24 hours`);
      continue;
    }
    if (waits >= WAITING_CAP()) {
      skipped.push(`${name}: ${waits} runs wait for Chris`);
      continue;
    }
    const spec = `# ${item.title}\n\n${item.body.trim()}\n`;
    const why = await start(repo, name, item.id, spec);
    if (why) skipped.push(`${name}: ${why}`);
    else started.push(name);
  }
  factoryLog(`started ${started.join(", ") || "none"}${skipped.length ? `; skipped ${skipped.join("; ")}` : ""}`);
  return { started, skipped };
}

export interface Baseline { repo: string; commit: string; ok: boolean; failed?: string }
const baselineFile = () => join(factoryDir(), "baseline.json");
const baselines = (): Record<string, Baseline> => {
  try { return JSON.parse(readFileSync(baselineFile(), "utf8")); } catch { return {}; }
};
/** The check that failed, from the gate's reason: `tests failed` is `tests`. */
const failedCheck = (why: string) => why.replace(/^timed out: check /, "").replace(/ failed$/, "");
const redLine = (b: Baseline) => `main is red at ${b.commit.slice(0, 7)}: ${b.failed}`;

/**
 * Whether the repo's checks pass on its current origin/<main>: run once per
 * commit, kept in baseline.json. Returns the red line, or null when green.
 */
async function baseline(repo: Repo, checks: (repo: Repo, commit: string, logs: string) => Promise<string | null>): Promise<string | null> {
  if (!git(repo.path, "fetch", "-q", "origin").ok) return "main is unchecked: fetch failed";
  const commit = git(repo.path, "rev-parse", `origin/${repo.main}`).out;
  if (!commit) return `main is unchecked: no origin/${repo.main}`;
  const all = baselines();
  let b = all[repo.key];
  if (!b || b.commit !== commit) {
    const why = await checks(repo, commit, join(factoryDir(), "baseline", repo.key));
    b = { repo: repo.key, commit, ok: !why, ...(why ? { failed: failedCheck(why) } : {}) };
    mkdirSync(factoryDir(), { recursive: true });
    writeFileSync(baselineFile(), JSON.stringify({ ...baselines(), [repo.key]: b }, null, 2) + "\n");
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
  return lines;
}

/** How far a checkout is behind origin/<main>, with the diff a pull would bring. */
export function behind(repo: Repo): string | null {
  const n = Number(git(repo.path, "rev-list", "--count", `HEAD..origin/${repo.main}`).out || 0);
  if (!n) return null;
  return `${repo.path} is ${n} commit${n > 1 ? "s" : ""} behind origin/${repo.main}; git pull brings:\n${git(repo.path, "diff", "--stat", "HEAD", `origin/${repo.main}`).out}`;
}

const money = (n: number) => `$${n.toFixed(4)}`;

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
