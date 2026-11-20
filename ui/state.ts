/**
 * The `/api/factory` object (docs/ui.md), built read-only from
 * the ledger, the factory directory and the work store. It marks no run
 * `shown` and does not reconcile the ledger with git: both are the CLI's.
 */
import { logEvent, readEvents } from "../lib/layout.ts";
import { type EventRow, issueHref, issueKey, parseId, parseKey, targetOf } from "../lib/naming.ts";
import { judgeChoice } from "../lib/jev.ts";
import { factorySnapshot } from "../jobs/lib/gates/factory-status.ts";
import { decider } from "../jobs/lib/gates/decider.ts";
import { monitorPanel } from "../jobs/lib/learning/monitor-table.ts";
import { pendingWaits, waitsOf, type Hold, type IssueDecision } from "../jobs/lib/gates/issue-decision.ts";
import { isWaiting, issueKeyOf, loadRegistry, onOf, runOfJob, type CheckResult, type Entry, type Repo, allJobs, isOpen } from "../jobs/lib/records/ledger.ts";
import { stateOf, view, type Job as Runs, type JobView } from "../jobs/lib/records/job.ts";
import { counting, isError } from "../jobs/lib/records/record.ts";
import { type Cause } from "../jobs/lib/records/outcome.ts";
import { needsOf, type Ask } from "../jobs/lib/asks/ask.ts";
import { withProjects } from "./api/scope.ts";
import type { Context as HeraldContext } from "./herald.ts";
import { attend, errorBlocker, type AskItem, type Blocker } from "./asks.ts";
import { parentIn, reader } from "../lib/store.ts";
import { created, parentRef, parseIssueRef, status, updated, type Issue, afterOf, byPriority, partsOf, priorityOf, isTracker } from "../lib/todo.ts";
import { summary, type Wk } from "./usage.ts";
import { awaiting, stageOf } from "./issue.ts";
import { verdict } from "../lib/status-words.ts";
import { timer } from "../jobs/lib/infra/systemd.ts";
import { probe } from "../lib/git.ts";
import { dueAt } from "../jobs/lib/asks/timeout.ts";
import { errText } from "../lib/errtext.ts";
import { getJson, putJson } from "../lib/db.ts";

const logged = new Set<string>();

/** Logs a failed UI read once per process and message: the write touches the events source, so a build that logs each time would rebuild and log again. */
export function logOnce(subject: string, e: any) {
  const note = errText(e), key = `${subject} ${note}`;
  if (logged.has(key)) return;
  logged.add(key);
  logEvent({ subject: "rule", action: "failed", object: subject, detail: note });
}

/** A wait that has not ended. `dead` names why it never will: the blocker is dropped, or is a tracker that never closes. */
export interface Wait { id: string; href: string; title: string; state: string | null; dead: "dropped" | "tracker" | null }
const deadWait = (q: { waits?: Wait[] }): boolean => !!q.waits?.some((b) => b.dead);

/** A part of an issue as a flat card says it: "n/m" with a link to the parent. */
interface Part { n: number; m: number; parent: string; href: string }

/** The attempt of each job an issue event names, by its job ID: the first job of its `prev` chain. */
function heraldAttempts(events: EventRow[], runs: Entry[]): Record<string, string> {
  const attempts: Record<string, string> = {};
  for (const e of events) {
    const run = parseKey(e.object)?.kind === "job" && !(e.object in attempts) ? runOfJob(e.object, runs) : undefined;
    if (run) attempts[e.object] = run.run.job;
  }
  return attempts;
}

/** The title of each run an issue event names, by its job ID: the run's kind, or "merge" for a merge-only run. */
export function heraldRuns(events: EventRow[], runs: Entry[]): Record<string, string> {
  const titles: Record<string, string> = {};
  for (const e of events) {
    const run = parseKey(e.object)?.kind === "job" && !(e.object in titles) ? runOfJob(e.object, runs) : undefined;
    if (run) titles[e.object] = run.run.merge ? "merge" : run.run.role;
  }
  return titles;
}

/** The count of issues each housekeeper run reviewed, by its job ID: its job record's tally, for each run a done event names. */
export function heraldReviewed(events: EventRow[], runs: Entry[]): Record<string, number> {
  const reviewed: Record<string, number> = {};
  for (const e of events) {
    const n = e.action === "done" && parseKey(e.object)?.kind === "job" ? runOfJob(e.object, runs)?.run.tally?.reviewed : undefined;
    if (n !== undefined) reviewed[e.object] = n;
  }
  return reviewed;
}

/** The newest HERALD_EVENTS events of the last day at `now` (ms), oldest first, each with its project. */
export const heraldEvents = (now: number): EventRow[] => withProjects(readEvents(now - 86_400_000).slice(-HERALD_EVENTS));

/** What the Herald's rows name besides the events: the title of each issue they target (a project's list gives it), and the run, attempt and reviewed maps. */
export function heraldContext(events: EventRow[], runs: Entry[], lists: ReturnType<typeof reader>): HeraldContext {
  const titles: Record<string, string> = {};
  for (const e of events) {
    const issue = targetOf(e), k = parseKey(issue), p = parseId(issue) ?? (k?.kind === "issue" && e.project ? { repo: e.project, n: k.n, sub: undefined } : null);
    const item = p && !(issue in titles) ? lists.item(p.repo, p.sub === undefined ? p.n : `${p.n}.${p.sub}`) : undefined;
    if (item) titles[issue] = item.title;
  }
  return { titles, runs: heraldRuns(events, runs), attempts: heraldAttempts(events, runs), reviewed: heraldReviewed(events, runs) };
}

export interface Job {
  /** The job ID of the run that counts, `a1430#2`: the Job page's address and the one an action acts on. */
  id: string;
  name: string; repo: string; item: { id: number | string; title: string; priority?: string } | null;
  state: string; phase?: string; reason?: string; question?: string;
  started: string;
  /** The current (last) run: its kind and start. `started` is the job's first. */
  run: { id: string; kind: string; started: string };
  ended?: string; cost?: number; model?: string; size?: string;
  /** The cost as an estimated share of the weekly plan limit; set by the routes, none under 6 hours of usage snapshots. */
  wk?: Wk;
  commit?: string; commitUrl?: string;
  defaults: string[]; followups: string[];
  stat?: string;
  /** A live run exists for this job: a next run or a rerun. */
  agent?: boolean;
  /** Running, errored: the part this job works on, "n/m" of its parent. */
  part?: Part;
  /** Awaiting: what the run asks of Chris, and why. */
  ask?: Ask;
  /** Awaiting: when the Ask timeout acts on the run with no answer from Chris, and what it does then (jobs/lib/asks/timeout.ts). */
  due?: string; dueAction?: string;
  /** Awaiting: the reviewer's call on the held run. */
  reviewCall?: { call: string; reason?: string };
  /** A landed job whose manual check is still open. */
  check?: "open";
  checks?: CheckResult[];
  /** Lands: the trailers of the land commit. Needs-you: the trailers the land will write. */
  trailers?: { key: string; value: string }[];
  /** An intake or triage run: its verdict as `build`, `close`, `done` or `ask`; none while it runs or when it gave no verdict. */
  outcome?: string;
  /** Error: the open issue this job waits on or its last run names; the row offers Wait instead of Re-check. */
  blocker?: Blocker;
  /** Errored or failed: why its last run stopped, the sub word the card shows beside its state. */
  cause?: Cause;
  /** Errored or failed: the check that stopped its last run, when a check did; the card's line names it after the cause. */
  checkName?: string;
  /** Errored or failed by a time box or a stall: its length in seconds. */
  limit?: number;
}

/** A new issue of a factory repo, in the shape of the Issue card. */
export interface NewIssue { id: string; title: string; priority?: string; status: string; href: string; labels: string[]; notes: number; created: string; updated: string;
  /** An issue that awaits you: what Chris is asked. */
  question?: string;
  /** Its Ask with options: the fields. */
  decision?: Ask;
  /** The whole Ask: kind, reason and the stored case text. */
  ask?: Ask;
  /** The Ask's reason. */
  reason?: string;
  /** The stage from stage(). */
  stage?: string;
  /** When the work on it was first picked up (ISO, "" for never), and the part it is of its parent. */
  since?: string; part?: Part }

/** An issue in Running: its parts, each with its stage and the job that works on it. */
interface RunningIssue { id: string; title: string; href: string; stage: string; priority: string; of: { n: number; m: number }; /** When the work on it was first picked up. */ since: string; /** When it was last changed. */ at: string }

/** A done issue as the Done list shows it: the issue is the head, its jobs are links. */
interface DoneItem { id: string; title: string; href: string; priority: string; finished: string; /** When the work on it was first picked up; "" if never. */ since: string; part?: Part; jobs: Job[] }

/** One status transition or factory event in the Herald feed. */
interface HeraldHistoryItem {
  at: string;
  tone: "alert" | "warning" | "fine" | "run" | "ask";
  label?: string;
  text: string;
  reason?: string;
}

/** The most events the Herald gets with the state; the stream adds the ones after. */
const HERALD_EVENTS = 50;
const MAX_STATUS_HISTORY = 50;

/** The status history with `item` on top when its text or tone is new, newest first. It is a `state` row: each land restarts the server, and the history outlives it. */
function recordStatusTransition(item: HeraldHistoryItem): HeraldHistoryItem[] {
  const history = getJson<HeraldHistoryItem[]>("state", "herald.status", []);
  if (history[0]?.text === item.text && history[0]?.tone === item.tone) return history;
  const next = [item, ...history].slice(0, MAX_STATUS_HISTORY);
  putJson("state", "herald.status", next);
  return next;
}

export interface State {
  now: string;
  factory: {
    paused: boolean; judge: "jev" | "haiku"; liveCap: number; /** Live agent runs, the count the live cap checks. */ liveRuns: number; /** Live agent runs on the local backend, and the cap they count against. */ liveLocal: number; localCap: number; runCap: number; /** The most starts any one issue made in the last hour. */ runStarts: number; runsToday: number; costToday: number;
    nextTick: string | null;
    /** True when there is no next elapse and aleph-tick.service is activating or active: a tick is running, not a dead timer. */
    tickInProgress: boolean;
    health: { text: string; kind: "alert" | "warn"; key?: string }[];
    /** The firefighter's factory log lines of the last 24 hours, newest last. */
    firefighter: { at: string; line: string }[];
    /** The monitor's newest daily report: the first metric, the reader's findings in rank order, and the table. Null before the first report. */
    monitor: ReturnType<typeof monitorPanel>;
  };
  errored: Job[]; running: Job[];
  /** Everything that waits for Chris: one entry per awaiting run, issue and proposal, with its card and reason. */
  asks: AskItem[];
  /** Queued and blocked issues (and old items): the Queued lane. */
  queued: { repo: string; id: number | string; title: string; priority: string; stage: string; at?: string; since?: string; part?: Part; kind: IssueDecision["kind"];
    /** The hold event the dispatch stores in the record: the action word and the content the card shows. */
    ev?: Hold;
    waits?: { id: string; href: string; state: string | null }[] }[];
  /** Issues in Running: each with its parts nested and "n of m issues". */
  runningIssues: RunningIssue[];
  /** Done: the last 10 done issues, newest first, each with the intake and land jobs that belong to it. */
  done: DoneItem[];
  /** When each done issue finished (ms), newest first: the Done lane counts the selected window from it. */
  doneStamps: { id: string; at: number }[];
  /** Recent status transitions for the Herald panel, and the newest HERALD_EVENTS events of the event log in the last day, oldest first. */
  herald?: HeraldContext & { history: HeraldHistoryItem[]; /** The `seq` of the newest event: a later push of rows replaces these. */ seq: number; events: EventRow[] };
}

const DONE = 10;

/** The next firing of aleph-tick.timer, and with none whether a tick runs now: a running tick is not a dead timer. */
function tickTimer(): { nextTick: string | null; tickInProgress: boolean } {
  const t = timer("aleph-tick.timer");
  return { nextTick: t.next ? new Date(t.next).toISOString() : null, tickInProgress: t.running };
}

/** `https://github.com/<owner>/<name>` from an origin URL in https or git@github.com: form. */
export function githubBase(url: string): string | null {
  const m = url.trim().match(/^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/);
  return m ? `https://github.com/${m[1]}/${m[2]}` : null;
}

function commitUrl(repo: Repo | undefined, commit: string | undefined, bases: Map<string, string | null>): string | undefined {
  if (!repo || !commit) return undefined;
  if (!bases.has(repo.key)) {
    const p = probe(repo.path, "remote", "get-url", "origin");
    bases.set(repo.key, p.ok ? githubBase(p.out) : null);
  }
  const base = bases.get(repo.key);
  return base ? `${base}/commit/${commit}` : undefined;
}

/** Each commit's trailers, by repo path and hash: a commit never changes, so one git call per commit per process. */
const trailers = new Map<string, { key: string; value: string }[]>();

/** A commit git could not read, by the same key, to the time it failed: it is tried again after MISS_MS, as a fetch may bring it. */
const misses = new Map<string, number>();
const MISS_MS = 10 * 60_000;

/** The trailers of a commit, from `git log -1 --format=%(trailers:only,unfold)`; none when git fails. */
function landedTrailers(repo: Repo | undefined, commit: string | undefined): { key: string; value: string }[] {
  if (!repo || !commit) return [];
  const id = `${repo.path}\0${commit}`;
  const hit = trailers.get(id);
  if (hit) return hit;
  const missed = misses.get(id);
  if (missed !== undefined && Date.now() - missed < MISS_MS) return [];
  const p = probe(repo.path, "log", "-1", "--format=%(trailers:only,unfold)", commit);
  if (!p.ok) { misses.set(id, Date.now()); return []; }
  const out = p.out.split("\n").flatMap((l) => {
    const i = l.indexOf(":");
    return i > 0 ? [{ key: l.slice(0, i).trim(), value: l.slice(i + 1).trim() }] : [];
  });
  trailers.set(id, out);
  return out;
}

/**
 * The UI's job: the Job module's `view`, with the item's title, the commit's
 * URL and the trailers. One projector per request: it reads each work list
 * and each origin URL once.
 */
export function jobProjector(registry: Record<string, Repo> = loadRegistry(), jobs?: Runs[]) {
  const lists = reader();
  const bases = new Map<string, string | null>();

  // The trailer the land writes.
  const needsYouIssue = (todo: number | string | undefined): { key: string; value: string }[] =>
    todo === undefined ? [] : [{ key: "Issue", value: issueKey(todo) }];

  const toJob = (runs: Runs, v: JobView = view(runs)): Job => {
    const repo = v.repo ? registry[v.repo] : undefined;
    const todo = v.item;
    const found = todo !== undefined && v.repo ? lists.item(v.repo, todo) : undefined;
    const job: Job = {
      id: v.run.id, name: v.name, repo: v.repo ?? "", item: found ? { id: found.id, title: found.title, priority: priorityOf(found) } : todo !== undefined ? { id: todo, title: "" } : null,
      state: v.state, started: v.started, run: { id: v.run.id, kind: v.run.role, started: v.run.started },
      defaults: v.defaults, followups: v.followups,
    };
    for (const k of ["phase", "reason", "question", "ended", "model", "size", "checkName"] as const) if (v[k] !== undefined) job[k] = v[k];
    // An errored or failed job's card shows the word of what stopped its last run, and the failed check's name.
    if (v.cause) job.cause = v.cause;
    if (v.limit !== undefined) job.limit = v.limit;
    if (v.cost !== undefined) job.cost = v.cost;
    if (v.commit) {
      job.commit = v.commit;
      const url = commitUrl(repo, v.commit, bases);
      if (url) job.commitUrl = url;
    }
    if (v.state === "waiting" && v.stat) job.stat = v.stat;
    const asked = v.ask;
    if (asked) job.ask = asked;
    const due = asked ? dueAt(runs.find((e) => e.id === v.run.id)!) : null;
    if (due) { job.due = new Date(due.at).toISOString(); job.dueAction = due.action; }
    if (asked && v.review) job.reviewCall = v.review;
    if (v.checks) job.checks = v.checks;
    if (v.check === "open") job.check = "open";
    const trailers = v.state === "landed" ? landedTrailers(repo, v.commit)
      : v.state === "waiting" ? [
        ...needsYouIssue(todo),
        { key: "Job", value: v.job },
        ...(needsOf(asked) === "protected" || needsOf(asked) === "review" ? [{ key: "Held-by", value: "Chris" }] : []),
      ] : [];
    if (trailers.length) job.trailers = trailers;
    return job;
  };
  // The dispatch's decider, on this build's lists: it fetches no repo.
  const at = decider({ fresh: false, jobs, lists, registry });
  const blocker = (id: string): Wait => {
    const r = parseIssueRef(id), found = r ? lists.item(r.repo, r.id) : undefined;
    return {
      id, href: issueHref(id), title: found?.title ?? "",
      state: r && found && registry[r.repo] ? at.stagesOf(registry[r.repo]).get(String(r.id))?.stage ?? status(found) : null,
      // The dispatcher counts neither as done, so the wait does not end by itself.
      dead: !found ? null : status(found) === "dropped" ? "dropped" : isTracker(found) ? "tracker" : null,
    };
  };
  /** What an open issue waits on now: nothing once it is closed. */
  const blockers = (key: string, ref: number | string): Wait[] => {
    const item = lists.item(key, ref);
    return item && status(item) === "open" ? pendingWaits(waitsOf(item, parentIn(key, item, lists)), at.done).map(blocker) : [];
  };
  return { lists, toJob, stagesOf: at.stagesOf, decide: at.decide, blocker, blockers };
}

type Projector = ReturnType<typeof jobProjector>;

/** The needs, errored and running job cards: one pass over the jobs, then the dropped issues' cards, the live agents, the blockers and the parts. */
function jobCards(jobs: Runs[], registry: Record<string, Repo>, { lists, toJob }: Projector, partOf: Map<string, Part>) {
  const needs: Job[] = [], errored: Job[] = [], running: Job[] = [];
  const issueStatus = (j: Job) => { const it = j.item !== null ? lists.item(j.repo, j.item.id) : undefined; return it && status(it); };
  const liveJobs = new Set<string>(), liveItems = new Set<string>();
  for (const runs of jobs) {
    const last = counting(runs).run;
    // A running intake (or planner) counts as running; it is not a live agent.
    if (last.role === "intake" && last.state === "running") {
      running.push(toJob(runs));
      continue;
    }
    // An intake run sorts an issue and never lands; it shows only when it awaits you.
    if (last.role === "intake") {
      if (isOpen(runs) && isWaiting(stateOf(runs))) needs.push(toJob(runs));
      continue;
    }
    if (isOpen(runs)) {
      const real = counting(runs).run;
      if (isWaiting(real.state)) needs.push(toJob(runs));
      // A run whose `next` is set already has its rework, recheck or land queued: it is between steps, not errored.
      else if (isError(real)) errored.push(toJob(runs));
      else {
        const k = issueKeyOf(real), on = onOf(real);
        const item = real.repo === undefined || on === undefined ? undefined : lists.item(real.repo, on);
        // A parked issue's job waits on the work store: its next step is held, so a job between steps is not at
        // work. Parking stops new work, not a run already at it, so a running one stays.
        if (real.state !== "running" && item !== undefined && status(item) === "parked") continue;
        liveJobs.add(real.job);
        if (k) liveItems.add(k);
        running.push(toJob(runs));
      }
    }
  }

  // A dropped issue holds no Ask and no errored run.
  const droppedJob = (j: Job) => issueStatus(j) === "dropped";
  for (const list of [needs, errored]) list.splice(0, list.length, ...list.filter((j) => !droppedJob(j)));

  for (const j of [...needs, ...errored]) {
    const todo = j.item?.id;
    j.agent = liveJobs.has(j.name) || (todo !== undefined && liveItems.has(`${j.repo}-${todo}`));
  }

  const openById = new Map<string, { title: string; href: string }>(), waitsOf = new Map<string, string>();
  for (const repo of Object.values(registry)) {
    if (!repo.sandbox) continue;
    for (const item of lists.list(repo.key)?.items ?? []) {
      const id = `${repo.key}-${item.id}`;
      if (status(item) === "open") openById.set(id, { title: item.title, href: issueHref(id) });
      const after = afterOf(item);
      if (after.length) waitsOf.set(id, after[0]);
    }
  }
  for (const j of errored) {
    const b = errorBlocker(j, j.item ? waitsOf.get(`${j.repo}-${j.item.id}`) : undefined, openById);
    if (b) j.blocker = b;
  }
  for (const j of [...running, ...errored, ...needs]) if (j.item) j.part = partOf.get(`${j.repo}-${j.item.id}`);
  return { needs, errored, running };
}

/** The part of each part: "n/m" and its parent, by `repo-ref`. */
function partsByKey(registry: Record<string, Repo>, { lists }: Projector): Map<string, Part> {
  const partOf = new Map<string, Part>();
  for (const repo of Object.values(registry)) {
    const doc = lists.list(repo.key);
    for (const item of doc?.items ?? []) {
      const ps = partsOf(doc!, item);
      ps.forEach((g, i) => partOf.set(`${repo.key}-${g.id}`, { n: i + 1, m: ps.length, parent: `${repo.key}-${item.id}`, href: issueHref(`${repo.key}-${item.id}`) }));
    }
  }
  return partOf;
}

/** An issue of a sandbox repo with what the card lists read of it, found once: its key, stage, parts and place as a part. */
interface Slot { repo: Repo; item: Issue; id: string; st: string; top: boolean; parts: Issue[]; of?: { n: number; m: number }; part?: Part }

function slotsOf(registry: Record<string, Repo>, { lists, stagesOf }: Projector, partOf: Map<string, Part>): Slot[] {
  return Object.values(registry).filter((repo) => repo.sandbox).flatMap((repo) => {
    const stageById = stagesOf(repo), doc = lists.list(repo.key);
    return (doc?.items ?? []).map((item) => {
      const ref = String(item.id), id = `${repo.key}-${ref}`, stage = stageById.get(ref);
      // Done lists issues; a part shows under its issue.
      return { repo, item, id, st: stageOf(item, stage), top: parentRef(item) === undefined, parts: partsOf(doc!, item), of: stage?.of, part: partOf.get(id) };
    });
  });
}

/** The jobs of each issue by `repo-id` (the open ones give its status, all of them its Done package), and when the work on an item was first picked up: its earliest run, and for a parent its parts' too. */
function pickups(jobs: Runs[]) {
  const ofItem = new Map<string, Runs[]>();
  for (const runs of jobs) {
    const k = issueKeyOf(counting(runs).run);
    if (k === undefined) continue;
    ofItem.set(k, [...(ofItem.get(k) ?? []), runs]);
  }
  const pickedUp = (key: string, ...more: string[]): string => {
    const ts = [key, ...more].flatMap((k) => ofItem.get(k) ?? []).map((r) => Date.parse(r[0].run.started)).filter((t) => t > 0);
    return ts.length ? new Date(Math.min(...ts)).toISOString() : "";
  };
  return { ofItem, pickedUp };
}
type Pickups = ReturnType<typeof pickups>;

/** The issues that wait on Chris. */
const awaitingOf = (slots: Slot[], { pickedUp }: Pickups): NewIssue[] =>
  slots.flatMap(({ repo, item, id, st, part }) => {
    const waiting = awaiting(repo.key, item, st);
    return waiting ? [{ ...waiting, since: pickedUp(id), part }] : [];
  });

/** The open issues that are queued or held, with what each waits on. */
const queuedOf = (slots: Slot[], { pickedUp }: Pickups, { blocker }: Projector, decide: (repo: Repo, item: Issue) => IssueDecision) =>
  byPriority(slots.filter(({ item, st }) => status(item) === "open" && (st === "queued" || st === "held")).map(({ repo, item, id, st, part }) => {
    // The stage already says when an issue is to plan.
    const w = decide(repo, item);
    return { item, repo: repo.key, id: item.id, title: item.title, priority: priorityOf(item), stage: st, at: updated(item) ?? created(item) ?? "", since: pickedUp(id), ...(part ? { part } : {}), kind: w.kind,
      ...(w.ev ? { ev: w.ev } : {}), ...(w.kind === "after" && w.ids ? { waits: w.ids.map(blocker) } : {}),
    };
  }).sort((a, b) => Number(deadWait(b)) - Number(deadWait(a)))).map(({ item: _, ...q }) => q);

/** A parent in Running only while it waits to close: every part is done. */
const runningIssuesOf = (slots: Slot[], { pickedUp }: Pickups): RunningIssue[] =>
  slots.flatMap(({ repo, item, id, st, parts, of }) => {
    if (status(item) !== "open" || st !== "working" || !parts.length) return [];
    const n = of ?? { n: 0, m: parts.length };
    return n.n >= n.m ? [{ id, title: item.title, href: issueHref(id), stage: st, priority: priorityOf(item), of: n, since: pickedUp(id, ...parts.map((g) => `${repo.key}-${g.id}`)), at: updated(item) ?? "" }] : [];
  });

/** The latest done issues, and the finish time of every done one. Latest done holds the done parts and the done issues without parts; a done parent shows no card. */
function doneOf(slots: Slot[], { ofItem, pickedUp }: Pickups, { toJob }: Projector) {
  const items = slots.filter(({ st, top, parts }) => st === "done" && (!top || parts.length === 0)).map(({ id, item, part }) => {
    const mine = ofItem.get(id) ?? [];
    const ends = mine.map((r) => Date.parse(r.at(-1)!.run.ended ?? "")).filter((t) => t > 0);
    return { at: ends.length ? Math.max(...ends) : Date.parse(updated(item) ?? "") || 0, id, item, part, runs: mine, since: pickedUp(id) };
  }).sort((a, b) => b.at - a.at);
  const done: DoneItem[] = items.slice(0, DONE).map(({ at, id, item, part, runs, since }) => ({
    id, title: item.title, href: issueHref(id), priority: priorityOf(item),
    finished: at ? new Date(at).toISOString() : "", since, ...(part ? { part } : {}),
    jobs: runs.map((r: Runs) => toJob(r)),
  }));
  return { done, doneStamps: items.map(({ at, id }) => ({ id, at })) };
}

/** The state at `now`. */
export function state(now = new Date()): State {
  const registry = loadRegistry();
  // The ledger is read once: every part below takes these jobs (and their runs) instead of reading it again.
  const jobs = allJobs();
  const projector = jobProjector(registry, jobs);
  const partOf = partsByKey(registry, projector);
  const { needs, errored, running } = jobCards(jobs, registry, projector, partOf);
  const slots = slotsOf(registry, projector, partOf), picks = pickups(jobs);
  const awaitingItems = awaitingOf(slots, picks);
  const { done, doneStamps } = doneOf(slots, picks, projector);

  const { gated, baselines: base, ...factory } = factorySnapshot(now.getTime(), jobs);
  const att = attend({ runs: needs, issues: awaitingItems });
  const timers = tickTimer();
  const v = verdict({ now: now.toISOString(), factory: { ...factory, ...timers }, errored, asks: att.items, usage: summary(now.getTime()) });
  const history = recordStatusTransition({ at: now.toISOString(), tone: v.tone, label: v.label, text: v.text, reason: v.errors[0]?.text });
  const events = heraldEvents(now.getTime());
  return {
    now: now.toISOString(),
    factory: { ...factory, judge: judgeChoice(), ...timers, monitor: monitorPanel() },
    herald: { history, seq: events.at(-1)?.seq ?? 0, events, ...heraldContext(events, jobs.flat(), projector.lists) },
    asks: att.items, done, doneStamps,
    errored, running, runningIssues: runningIssuesOf(slots, picks),
    queued: queuedOf(slots, picks, projector, (repo, item) => projector.decide(repo, item, { jobs, now: now.getTime(), gates: gated })),
  };
}
