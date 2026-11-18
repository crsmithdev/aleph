/**
 * The factory's small steps around the runs: intake, the director, the corrections, the episodes and the hook's lines.
 * Each job of its own has its module: the dispatch (dispatch.ts), the sweep of a list (sweep.ts), main's baseline
 * (baseline.ts), the stall check (stall.ts) and the report (report.ts). What it reads of its state is in
 * factory-status.ts. Its state lives in ~/.aleph/factory. See docs/factory.md.
 */
import { today } from "../../../lib/day.ts";
import { DAILY_HOUR } from "../../../lib/schedule.ts";
import { issueKey } from "../../../lib/naming.ts";
import * as issues from "../../../lib/todo.ts";
import { reader, type Reader } from "../../../lib/store.ts";
import { git } from "../../../lib/git.ts";
import { askOfItem } from "../asks/ask.ts";
import { logEvent } from "../../../lib/layout.ts";
import { intakeIssue, type Counts } from "../roles/intake.ts";
import { isWaiting, loadRegistry, type Entry, type Repo, allJobs, isOpen } from "../records/ledger.ts";
import { holdsWork } from "../infra/process.ts";
import { filing } from "./filing.ts";
import { causeOf } from "../records/outcome.ts";
import { stateOf } from "../records/job.ts";
import { counting, allRuns } from "../records/record.ts";
import { mine, proposals, readStore } from "../learning/corrections.ts";
import { directAll, pendingCases, subjectOfCase, type Decision, type Ports as DirectorPorts } from "../roles/director.ts";
import { writeEpisodes } from "../learning/episode.ts";
import { directorDetached, dispatchDetached, intakeDetached } from "./launch.ts";
import { gates, stallLines } from "../gates/factory-status.ts";
import { paused } from "../gates/pause.ts";
import { sandboxRepos } from "../gates/gpu.ts";
import { redMains } from "../gates/tables.ts";

import { decider } from "../gates/decider.ts";
import { INTAKE_CAP } from "../infra/settings.ts";

/** True from 03:00 local, when the store has not been mined on this local date. */
export function correctionsDue(now = Date.now()): boolean {
  if (new Date(now).getHours() < DAILY_HOUR) return false;
  const at = readStore().minedAt;
  const t = Date.parse(at);
  return !at || Number.isNaN(t) || today(new Date(t)) !== today(new Date(now));
}

/** The daily correction mining (corrections.ts); the maintainer's step gates it. The tick catches and records an error. */
export async function mineCorrections(now = Date.now()): Promise<{ signals: number; lessons: number; proposed: number }> {
  const store = await mine(now, filing);
  const r = {
    signals: store.lessons.reduce((n, l) => n + l.signals.length, 0),
    lessons: store.lessons.length,
    proposed: store.lessons.filter((l) => l.state === "proposed").length,
  };
  // A proposed lesson is an Ask.
  if (r.proposed) directIfNew();
  return r;
}

/** The detached starts that follow a write: an intake of one issue, and the director. Tests replace them. */
export interface Starts { intake(repo: Repo, id: number): void; director(): void }
export const starts: Starts = { intake: intakeDetached, director: directorDetached };


/**
 * The intake queue: an intake for each issue that decideIntake lets in, oldest first, at most `ALEPH_INTAKE_CAP`,
 * each detached. While the live cap binds it starts none: the dispatch at the end of the next run calls it again.
 * Returns the issues it started an intake for.
 */
export function intakeQueued(start: (repo: Repo, id: number) => void = intakeDetached, runs: Entry[] = allRuns(), lists: Reader = reader({ fetch: false }), at = decider({ fresh: false, lists })): string[] {
  if (gates({ only: ["paused", "full"], jobs: [runs] })) return [];
  const queue: { repo: Repo; item: issues.Issue }[] = [];
  for (const repo of sandboxRepos()) {
    const doc = lists.list(repo.key);
    for (const item of doc?.items ?? []) if (at.intake(repo, item, doc!).kind !== "none") queue.push({ repo, item });
  }
  queue.sort((a, b) => (issues.created(a.item) ?? "").localeCompare(issues.created(b.item) ?? "") || a.repo.key.localeCompare(b.repo.key) || a.item.id - b.item.id);
  const started: string[] = [];
  for (const { repo, item } of queue.slice(0, INTAKE_CAP())) {
    const name = issueKey(item.id);
    if (holdsWork(runs, "intake", name)) continue;
    start(repo, item.id);
    started.push(name);
  }
  return started;
}

/**
 * Start the director at once when an Ask has no case text and no director run is on it. A dispatch, an intake, the
 * corrections and the firefighter call it after a write that can set an Ask, so no Ask waits for the tick.
 * Returns whether it started the director.
 */
export function directIfNew(start: () => void = directorDetached, runs: Entry[] = allRuns(), lists: Reader = reader({ fetch: false })): boolean {
  if (paused()) return false;
  if (!pendingCases(sandboxRepos(), runs, lists).some((c) => !holdsWork(runs, "director", subjectOfCase(c)))) return false;
  start();
  return true;
}

/**
 * `aleph director` (director.ts): one run for each new Ask. `directIfNew` starts it where an Ask is set. Under the
 * pause alone: a decision can let an issue start. An error is logged, never thrown.
 */
export async function directorStep(ports?: DirectorPorts): Promise<Decision[]> {
  if (paused()) return [];
  const d = await directAll(sandboxRepos(), ports);
  if (d.some((x) => x.outcome === "decided")) dispatchDetached();
  return d;
}

/** The tick's episode pages for issues that finished (episode.ts), written and failed. The tick catches and records an error. */
export async function episodeStep(): Promise<{ written: string[]; failed: string[] }> {
  if (paused()) return { written: [], failed: [] };
  const r = await writeEpisodes(sandboxRepos());
  for (const f of r.failed) logEvent({ subject: "rule", action: "failed", object: "episodes", detail: f });
  return r;
}

/** How far a checkout is behind origin/<main>, with the diff a pull would bring; with `short`, the key and the count alone. */
export function behind(repo: Repo, short = false): string | null {
  const n = Number(git(repo.path, "rev-list", "--count", `HEAD..origin/${repo.main}`).out || 0);
  if (!n) return null;
  if (short) return `${repo.key} is ${n} commit${n > 1 ? "s" : ""} behind origin/${repo.main}`;
  return `${repo.path} is ${n} commit${n > 1 ? "s" : ""} behind origin/${repo.main}; git pull brings:\n${git(repo.path, "diff", "--stat", "HEAD", `origin/${repo.main}`).out}`;
}

/** The SessionStart hook's lines: a pause, the asks, the alarms and each sandbox checkout that is behind origin as last fetched (the tick fetches; the hook waits for no network). It writes nothing. */
export function hookLines(now = Date.now()): string[] {
  const lines = paused() ? ["factory paused"] : [];
  const jobs = allJobs(), repos = Object.values(loadRegistry()), lists = reader({ fetch: false });
  const refs = jobs.filter((j) => isOpen(j) && isWaiting(stateOf(j)) && counting(j).run.ask).map((j) => j[0].run.name);
  for (const repo of repos) {
    for (const item of lists.list(repo.key)?.items ?? []) {
      if (issues.status(item) === "open" && askOfItem(item)) refs.push(`${repo.key}-${issues.idOf(item)}`);
    }
  }
  refs.push(...proposals().map((l) => l.id));
  if (refs.length) lines.push(`${refs.length} asks wait for Chris: ${refs.slice(0, 5).join(", ")}`);
  lines.push(...redMains().map((r) => r.line), ...stallLines(now, jobs).map((h) => h.text));
  for (const repo of repos.filter((r) => r.sandbox)) lines.push(behind(repo, true) ?? "");
  return lines.filter(Boolean);
}

/**
 * Take in one issue at once, as `aleph issue add`, a note that answers an Ask, a
 * worker's follow-ups, the dispatch for an issue to plan and the intake queue do. The gate is the factory's pause. An
 * issue the live cap holds is started by the queue (`intakeQueued`) when a run ends. A run of this call that ended
 * with no reply starts the retry at once, while decideIntake still lets intake run (after `ALEPH_INTAKE_TRIES`
 * such runs, intake sets the Ask). An Ask that intake set goes to the director at once.
 */
export async function intakeNow(repo: Repo, id: number, p: Starts = starts): Promise<{ counts: Counts; skipped: string[] }> {
  if (paused()) return { counts: {}, skipped: [] };
  const name = issueKey(id);
  const mine = () => allRuns().filter((e) => e.run.role === "intake" && e.run.target === name);
  const before = new Set(mine().map((e) => e.id));
  const at = decider({ fresh: true });
  const t = await intakeIssue(repo, id, at);
  for (const l of t.skipped) logEvent({ subject: "intake", action: "skipped", object: name, detail: l });
  if (t.counts.build) dispatchDetached();
  const failed = mine().some((e) => !before.has(e.id) && causeOf(e.run) === "unanswered");
  const doc = reader({ fetch: false }).list(repo.key);
  const item = doc ? issues.find(doc, id) : undefined;
  // Only an intake of this call that ended with no reply starts the retry.
  if (failed && item && at.intake(repo, item, doc!).kind !== "none") {
    logEvent({ subject: "rule", action: "started", object: name, detail: "no reply; intake again now" });
    p.intake(repo, id);
  }
  directIfNew(p.director);
  return t;
}
