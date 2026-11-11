/**
 * The `/api/factory` object (docs/ui.md), built read-only from
 * the ledger, the factory directory and the work store. It marks no run
 * `shown` and does not reconcile the ledger with git: both are the CLI's.
 */
import { logEvent, readEvents } from "../lib/layout.ts";
import { issueHref, parseId, type Event } from "../lib/naming.ts";
import { judgeChoice } from "../lib/jev.ts";
import { factorySnapshot, issueFacts, mainRed } from "../jobs/lib/gates/factory-status.ts";
import { monitorPanel } from "../jobs/lib/learning/monitor-table.ts";
import { issueDecision, pendingWaits, refDone, type Hold, type IssueDecision } from "../jobs/lib/gates/issue-decision.ts";
import { allRuns, isWaiting, issueKeyOf, loadRegistry, type CheckResult, type Entry, type Repo } from "../jobs/lib/records/ledger.ts";
import { allJobs, isOpen, view, type Job as Runs, type JobView } from "../jobs/lib/records/job.ts";
import { counting as lastReal, jobIdOf } from "../jobs/lib/records/record.ts";
import { causeOf, failedCheckOf, type Cause } from "../jobs/lib/records/outcome.ts";
import { askOf, needsOf, plainAsk, type Ask } from "../jobs/lib/asks/ask.ts";
import { attend, stuckBlocker, type AskItem, type Blocker } from "./asks.ts";
import { afterOf, byPriority, partsOf, priorityOf, reader, isTracker } from "../issues/lib/store.ts";
import { created, idOf, parentRef, parseIssueRef, refOf, status, updated } from "../issues/lib/todo.ts";
import { facts, landedIndex, stages } from "../jobs/lib/records/status.ts";
import type { Stage } from "../jobs/lib/records/stage.ts";
import { summary, type Wk } from "./usage.ts";
import { card, stageOf } from "./issue.ts";
import { verdict } from "../lib/status-words.ts";
import { timer } from "../jobs/lib/infra/systemd.ts";

const logged = new Set<string>();

/** Logs a failed UI read once per process and message: the write touches the events source, so a build that logs each time would rebuild and log again. */
export function logOnce(subject: string, e: any) {
  const note = String(e?.message ?? e), key = `${subject} ${note}`;
  if (logged.has(key)) return;
  logged.add(key);
  logEvent({ by: "rule", subject, action: "failed", sub: "error", note });
}

/** A wait that has not ended. `dead` names why it never will: the blocker is dropped, or is a tracker that never closes. */
export interface Wait { id: string; href: string; title: string; state: string | null; dead: "dropped" | "tracker" | null }
const deadWait = (q: { waits?: Wait[] }): boolean => !!q.waits?.some((b) => b.dead);

/** A part of an issue as a flat card says it: "n/m" with a link to the parent. */
export interface Part { n: number; m: number; parent: string; href: string }

export interface Job {
  /** The job ID of the run that counts, `a1430#2`: the Job page's address and the one an action acts on. */
  id: string;
  name: string; repo: string; item: { id: number | string; title: string; priority?: string } | null;
  condition: string; phase?: string; reason?: string; question?: string;
  started: string;
  /** The current (last) run: its kind and start. `started` is the job's first. */
  run: { id: string; kind: string; started: string };
  ended?: string; cost?: number; model?: string; tier?: string;
  /** The cost as an estimated share of the weekly plan limit; set by the routes, none under 6 hours of usage snapshots. */
  wk?: Wk;
  commit?: string; commitUrl?: string;
  defaults: string[]; followups: string[];
  stat?: string;
  /** A live run exists for this job: a next run or a rerun. */
  agent?: boolean;
  /** Running, stuck: the part this job works on, "n/m" of its parent. */
  part?: Part;
  /** Awaiting: what the run asks of Chris, an input or an approval, and why. */
  ask?: Ask;
  /** Awaiting: the reviewer's call on the held run. */
  reviewCall?: { call: string; reason?: string };
  /** A landed job whose manual check is still open. */
  check?: "open";
  checks?: CheckResult[];
  /** Lands: the trailers of the land commit. Needs-you: the trailers the land will write. */
  trailers?: { key: string; value: string }[];
  /** An intake or triage run: its verdict as `build`, `close`, `done` or `ask`; none while it runs or when it gave no verdict. */
  outcome?: string;
  /** Stuck: the open issue this job waits on or its last run names; the row offers Wait instead of Re-check. */
  blocker?: Blocker;
  /** Stuck or failed: why its last run stopped, the sub word the card shows beside its state. */
  cause?: Cause;
  /** Stuck or failed: the check that stopped its last run, when a check did; the card's line names it after the cause. */
  checkName?: string;
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
  /** The Ask's kind: `input` or `approval`. */
  askKind?: "input" | "approval";
  /** The stage from stage(). */
  stage?: string }

/** An issue in Running: its parts, each with its stage and the job that works on it. */
export interface RunningIssue { id: string; title: string; href: string; stage: string; priority: string; of: { n: number; m: number }; /** When the work on it was first picked up. */ since: string; /** When it was last changed. */ at: string }

/** A done issue as the Done list shows it: the issue is the head, its jobs are links. */
export interface DoneItem { id: string; title: string; href: string; priority: string; finished: string; /** When the work on it was first picked up; "" if never. */ since: string; part?: Part; jobs: Job[] }

/** One status transition or factory event in the Herald feed. */
export interface HeraldHistoryItem {
  at: string;
  tone: "alert" | "warning" | "fine" | "run" | "ask";
  label?: string;
  text: string;
  reason?: string;
}

const statusHistory: HeraldHistoryItem[] = [];
/** The most events the Herald gets with the state; the stream adds the ones after. */
const HERALD_EVENTS = 50;
const MAX_STATUS_HISTORY = 50;

export function recordStatusTransition(item: HeraldHistoryItem): void {
  const last = statusHistory[0];
  if (!last || last.text !== item.text || last.tone !== item.tone) {
    statusHistory.unshift(item);
    if (statusHistory.length > MAX_STATUS_HISTORY) statusHistory.pop();
  }
}

export function currentStatusHistory(): HeraldHistoryItem[] {
  return statusHistory.slice();
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
  stuck: Job[]; running: Job[];
  /** Everything that waits for Chris: one entry per awaiting run, issue and proposal, with its kind (input or approval) and reason. */
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
  herald?: { history: HeraldHistoryItem[]; events: Event[]; /** The title of each issue the events name, by its full ID. */ titles: Record<string, string> };
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
    const p = Bun.spawnSync(["git", "-C", repo.path, "remote", "get-url", "origin"], { stdout: "pipe", stderr: "ignore" });
    bases.set(repo.key, p.exitCode === 0 ? githubBase(p.stdout.toString()) : null);
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
  const p = Bun.spawnSync(["git", "-C", repo.path, "log", "-1", "--format=%(trailers:only,unfold)", commit], { stdout: "pipe", stderr: "ignore" });
  if (p.exitCode !== 0) { misses.set(id, Date.now()); return []; }
  const out = p.stdout.toString().split("\n").flatMap((l) => {
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
  let every: Entry[] | undefined;
  // A run from before job IDs has no `n`: its ID needs every run's start order, read once.
  const jobOf = (e: Entry) => (e.run.n !== undefined ? jobIdOf(e) : jobIdOf(e, every ??= allRuns()));

  // The trailer the land writes.
  const needsYouIssue = (key: string | undefined, todo: number | string | undefined): { key: string; value: string }[] =>
    todo === undefined || key === undefined ? [] : [{ key: "Issue", value: `${key}-${todo}` }];

  const toJob = (runs: Runs, v: JobView = view(runs)): Job => {
    const repo = v.repo ? registry[v.repo] : undefined;
    const todo = v.item;
    const found = todo !== undefined && v.repo ? lists.item(v.repo, todo) : undefined;
    const job: Job = {
      id: jobOf(runs.find((e) => e.id === v.run.id) ?? lastReal(runs)), name: v.name, repo: v.repo ?? "", item: found ? { id: idOf(found), title: found.title, priority: priorityOf(found) } : todo !== undefined ? { id: todo, title: "" } : null,
      condition: v.condition, started: v.started, run: { id: v.run.id, kind: v.run.kind, started: v.run.started },
      defaults: v.defaults, followups: v.followups,
    };
    for (const k of ["phase", "reason", "question", "ended", "model", "tier"] as const) if (v[k] !== undefined) job[k] = v[k];
    if (v.cost !== undefined) job.cost = v.cost;
    if (v.commit) {
      job.commit = v.commit;
      const url = commitUrl(repo, v.commit, bases);
      if (url) job.commitUrl = url;
    }
    if (v.condition === "waiting" && v.stat) job.stat = v.stat;
    // A stuck or failed job's card shows the word of what stopped its last run, and the failed check's name.
    if (v.condition === "returned" || v.condition === "failed") {
      const run = lastReal(runs).run;
      job.cause = causeOf(run);
      job.checkName = failedCheckOf(run);
    }
    // A waiting run with no ask of its own asks a question, as stage() reads it.
    const stored = isWaiting(lastReal(runs).run.condition) ? lastReal(runs).run.ask : undefined;
    const asked = isWaiting(lastReal(runs).run.condition) ? (stored ?? plainAsk("question", "")) : undefined;
    if (asked) job.ask = asked;
    if (asked && v.review) job.reviewCall = v.review;
    if (v.checks) job.checks = v.checks;
    if (v.check === "open") job.check = "open";
    const trailers = v.condition === "landed" ? landedTrailers(repo, v.commit)
      : v.condition === "waiting" ? [
        ...needsYouIssue(v.repo, todo),
        { key: "Job", value: v.job },
        ...(needsOf(asked) === "protected" || needsOf(asked) === "review" ? [{ key: "Held-by", value: "Chris" }] : []),
      ] : [];
    if (trailers.length) job.trailers = trailers;
    return job;
  };
  // One landedIndex per repo per request: the stage of each item of a repo, by number.
  const staged = new Map<string, Map<string, Stage>>();
  const stagesOf = (repo: Repo): Map<string, Stage> => {
    let m = staged.get(repo.key);
    if (!m) {
      m = new Map();
      const doc = lists.list(repo.key);
      if (doc) {
        try {
          const f = facts(repo, doc, jobs), main = `refs/remotes/origin/${f.main}`;
          for (const st of stages(repo.path, main, f, Object.keys(f.items), landedIndex(repo.path, main, repo.key, (n) => f.items[n]?.since))) m.set(st.id.slice(repo.key.length + 1), st);
        } catch (e: any) { logOnce("stages", e); }
      }
      staged.set(repo.key, m);
    }
    return m;
  };
  // The dispatch's test, from this build's lists and stages: it fetches no project repo, as the stages above do not.
  const isDone = (ref: string): boolean => {
    const r = parseIssueRef(ref), repo = r ? registry[r.repo] : undefined;
    if (!r || !repo) return false;
    return refDone(lists.item(r.repo, r.id), !!lists.list(r.repo), stagesOf(repo).get(String(r.id))?.stage);
  };
  const blocker = (id: string): Wait => {
    const r = parseIssueRef(id), found = r ? lists.item(r.repo, r.id) : undefined;
    return {
      id, href: issueHref(id), title: found?.title ?? "",
      state: r && found && registry[r.repo] ? stagesOf(registry[r.repo]).get(String(r.id))?.stage ?? status(found) : null,
      // The dispatcher counts neither as done, so the wait does not end by itself.
      dead: !found ? null : status(found) === "dropped" ? "dropped" : isTracker(found) ? "tracker" : null,
    };
  };
  /** What an open issue waits on now: nothing once it is closed. */
  const blockers = (key: string, ref: number | string): Wait[] => {
    const item = lists.item(key, ref);
    return item && status(item) === "open" ? pendingWaits(afterOf(item), isDone).map(blocker) : [];
  };
  return { lists, toJob, stagesOf, isDone, blocker, blockers };
}

export function state(now = new Date()): State {
  const registry = loadRegistry();
  // The ledger is read once: every part below takes these jobs (and their runs) instead of reading it again.
  const jobs = allJobs(true);
  const { lists, toJob, stagesOf, isDone, blocker } = jobProjector(registry, jobs);

  const needs: Job[] = [], stuck: Job[] = [], running: Job[] = [];
  const liveJobs = new Set<string>(), liveItems = new Set<string>();
  for (const runs of jobs) {
    const last = lastReal(runs).run;
    // A running intake (or planner) counts as running; it is not a live agent.
    if (last.kind === "intake" && last.condition === "running") {
      running.push(toJob(runs));
      continue;
    }
    // An intake, triage, planner or facts run sorts an issue and never lands; it shows only when it awaits you.
    if (last.kind === "intake") {
      if (isOpen(runs) && isWaiting(lastReal(runs).run.condition)) needs.push(toJob(runs));
      continue;
    }
    if (isOpen(runs)) {
      const real = lastReal(runs).run;
      if (isWaiting(real.condition)) needs.push(toJob(runs));
      else if (real.condition === "returned" || real.condition === "failed") stuck.push(toJob(runs));
      else {
        liveJobs.add(real.job);
        const k = issueKeyOf(real);
        if (k) liveItems.add(k);
        running.push(toJob(runs));
      }
    }
  }

  // A dropped issue holds no Ask and no stuck run.
  const droppedJob = (j: Job) => { const it = j.item !== null ? lists.item(j.repo, j.item.id) : undefined; return it !== undefined && status(it) === "dropped"; };
  for (const list of [needs, stuck]) list.splice(0, list.length, ...list.filter((j) => !droppedJob(j)));

  for (const j of [...needs, ...stuck]) {
    const todo = j.item?.id;
    j.agent = liveJobs.has(j.name) || (todo !== undefined && liveItems.has(`${j.repo}-${todo}`));
  }

  const openById = new Map<string, { title: string; href: string }>(), waitsOf = new Map<string, string>();
  for (const repo of Object.values(registry)) {
    if (!repo.sandbox) continue;
    for (const item of lists.list(repo.key)?.items ?? []) {
      const id = `${repo.key}-${refOf(item)}`;
      if (status(item) === "open") openById.set(id, { title: item.title, href: issueHref(id) });
      const after = afterOf(item);
      if (after.length) waitsOf.set(id, after[0]);
    }
  }
  for (const j of stuck) {
    const b = stuckBlocker(j, j.item ? waitsOf.get(`${j.repo}-${j.item.id}`) : undefined, openById);
    if (b) j.blocker = b;
  }

  // The jobs of each issue, by `repo-id`: the open ones give its status, all of them its Done package.
  const ofItem = new Map<string, Runs[]>();
  for (const runs of jobs) {
    const k = issueKeyOf(lastReal(runs).run);
    if (k === undefined) continue;
    ofItem.set(k, [...(ofItem.get(k) ?? []), runs]);
  }
  // When the work on an item was first picked up: its earliest run, and for a parent its parts' too.
  const pickedUp = (key: string, ...more: string[]): string => {
    const ts = [key, ...more].flatMap((k) => ofItem.get(k) ?? []).map((r) => Date.parse(r[0].run.started)).filter((t) => t > 0);
    return ts.length ? new Date(Math.min(...ts)).toISOString() : "";
  };
  // The part of each part: "n/m" and its parent, by `repo-ref`.
  const partOf = new Map<string, Part>();
  for (const repo of Object.values(registry)) {
    const doc = lists.list(repo.key);
    for (const item of doc?.items ?? []) {
      const ps = partsOf(doc!, item);
      ps.forEach((g, i) => partOf.set(`${repo.key}-${refOf(g)}`, { n: i + 1, m: ps.length, parent: `${repo.key}-${refOf(item)}`, href: issueHref(`${repo.key}-${refOf(item)}`) }));
    }
  }
  const doneItems: { at: number; repo: Repo; item: any; runs: Runs[]; since: string }[] = [];

  const awaitingItems: NewIssue[] = [];
  const queued: { repo: Repo; item: any; stage: string; since: string; at: string }[] = [];
  const runningIssues: RunningIssue[] = [];
  for (const repo of Object.values(registry)) {
    if (!repo.sandbox) continue;
    const stageById = stagesOf(repo);
    const doc = lists.list(repo.key);
    for (const item of doc?.items ?? []) {
      const ref = refOf(item), id = `${repo.key}-${ref}`, href = issueHref(id);
      const st = stageOf(item, stageById.get(ref));
      // Done lists issues; a part shows under its issue.
      const top = parentRef(item) === undefined;
      const mineParts = partsOf(doc!, item);
      // Latest done holds the done parts and the done issues without parts; a done parent shows no card.
      if (st === "done" && (!top || mineParts.length === 0)) {
        const mine = ofItem.get(id) ?? [];
        const ends = mine.map((r) => Date.parse(r.at(-1)!.run.ended ?? "")).filter((t) => t > 0);
        doneItems.push({ at: ends.length ? Math.max(...ends) : Date.parse(updated(item) ?? "") || 0, repo, item, runs: mine, since: pickedUp(id) });
      }
      if (status(item) !== "open" || st === "done" || st === "dropped") continue;
      const ask = askOf(id);
      if (st === "waiting" && ask) awaitingItems.push(card(repo.key, item, st, ask));
      else if (st === "queued" || st === "held") queued.push({ repo, item, stage: st, since: pickedUp(id), at: updated(item) ?? created(item) ?? "" });
      // A parent shows a card in Running only while it waits to close: every part is done.
      if (st === "working" && mineParts.length) {
        const of = stageById.get(ref)?.of ?? { n: 0, m: mineParts.length };
        if (of.n >= of.m) runningIssues.push({ id, title: item.title, href, stage: st, priority: priorityOf(item), of, since: pickedUp(id, ...mineParts.map((g) => `${repo.key}-${refOf(g)}`)), at: updated(item) ?? "" });
      }
    }
  }
  for (const j of running) if (j.item) {
    const k = `${j.repo}-${j.item.id}`;
    j.part = partOf.get(k);
  }
  for (const j of stuck) if (j.item) j.part = partOf.get(`${j.repo}-${j.item.id}`);

  doneItems.sort((a, b) => b.at - a.at);
  const done: DoneItem[] = doneItems.slice(0, DONE).map(({ at, repo, item, runs, since }) => ({
    id: `${repo.key}-${refOf(item)}`, title: item.title, href: issueHref(`${repo.key}-${refOf(item)}`), priority: priorityOf(item),
    finished: at ? new Date(at).toISOString() : "", since, ...(partOf.get(`${repo.key}-${refOf(item)}`) ? { part: partOf.get(`${repo.key}-${refOf(item)}`) } : {}),
    jobs: runs.map((r: Runs) => toJob(r)),
  }));

  const { gated, baselines: base, ...factory } = factorySnapshot(now.getTime(), jobs);
  const att = attend({ runs: needs, issues: awaitingItems });
  // The run behind an ask: its live-run mark, its trailers and its notes.
  for (const a of att.items) {
    const j = a.key.startsWith("run:") ? needs.find((x) => `run:${x.name}` === a.key) : undefined;
    const key = j?.item ? `${j.repo}-${j.item.id}` : a.id;
    a.part = partOf.get(key); a.at = awaitingItems.find((c) => c.id === key)?.updated ?? ""; a.since = pickedUp(key);
    if (!j) continue;
    a.at = j.run.started; a.since = j.started;
    if (j.item) a.on = `${j.repo}-${j.item.id}`;
    a.agent = j.agent ?? false; a.defaults = j.defaults; a.followups = j.followups;
    if (j.trailers) a.trailers = j.trailers;
  }
  const timers = tickTimer();
  const v = verdict({ now: now.toISOString(), factory: { ...factory, ...timers }, stuck, asks: att.items, usage: summary(now.getTime()) });
  recordStatusTransition({ at: now.toISOString(), tone: v.tone, label: v.label, text: v.text, reason: v.errors[0]?.text });
  const redOf = mainRed();
  const events = readEvents(now.getTime() - 86_400_000).slice(-HERALD_EVENTS), titles: Record<string, string> = {};
  for (const e of events) {
    const p = parseId(e.subject);
    const item = p && !(e.subject in titles) ? lists.item(p.repo, p.sub === undefined ? p.n : `${p.n}.${p.sub}`) : undefined;
    if (item) titles[e.subject] = item.title;
  }
  return {
    now: now.toISOString(),
    factory: { ...factory, judge: judgeChoice(), ...timers, monitor: monitorPanel() },
    herald: { history: currentStatusHistory(), events, titles },
    asks: att.items, done, doneStamps: doneItems.map(({ at, repo, item }) => ({ id: `${repo.key}-${refOf(item)}`, at })),
    stuck, running, runningIssues,
    queued: byPriority(queued.map(({ repo, item, stage, since, at }) => {
      const red = redOf(repo);
      // The stage already says when an issue is to plan.
      const w = issueDecision({ ...issueFacts(repo, item, jobs, now.getTime()), done: isDone, red, ...gated });
      return { item, repo: repo.key, id: idOf(item), title: item.title, priority: priorityOf(item), stage, at, since, ...(partOf.get(`${repo.key}-${refOf(item)}`) ? { part: partOf.get(`${repo.key}-${refOf(item)}`) } : {}), kind: w.kind,
        ...(w.ev ? { ev: w.ev } : {}), ...(w.kind === "not-ready" && w.ids ? { waits: w.ids.map(blocker) } : {}),
      };
    }).sort((a, b) => Number(deadWait(b)) - Number(deadWait(a)))).map(({ item: _, ...q }) => q),
  };
}
