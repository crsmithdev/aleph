/**
 * The `/api/state` object of docs/specs/2026-10-27-ui.md, built read-only from
 * the ledger, the factory directory and the work store. It marks no run
 * `shown` and does not reconcile the ledger with git: both are the CLI's.
 */
import { resultLine } from "../jobs/lib/acceptance.ts";
import { judgeChoice } from "../hooks/lib/jev.ts";
import { DAY_CAP, LIVE_CAP, liveRuns, AWAITING_CAP, baselines, firefighterLines, gates, health, hold, lastProbe, paused, redLine, runsToday, spentToday, waitReason, type WaitReason } from "../jobs/lib/factory.ts";
import { askOf as runAsk, isAwaiting, loadRegistry, onOf, type Repo } from "../jobs/lib/ledger.ts";
import { allJobs, isOpen, lastReal, view, type Job as Runs, type JobView } from "../jobs/lib/job.ts";
import { readAsk, type Ask } from "../jobs/lib/ask.ts";
import { attend, stuckBlocker, type AskItem, type Blocker } from "./asks.ts";
import { readAlways } from "../jobs/lib/always.ts";
import { afterOf, areasOf, askOf, partsOf, reader, isTracker } from "../todo/lib/store.ts";
import { idOf, parseGoalRef, refOf, status } from "../todo/lib/todo.ts";
import { facts, landedIndex, stages } from "../jobs/lib/status.ts";
import type { Stage } from "../jobs/lib/stage.ts";
import type { Wk } from "./usage.ts";

export interface Job {
  name: string; repo: string; item: { id: number | string; title: string } | null;
  condition: string; phase?: string; reason?: string; question?: string;
  started: string;
  /** The current (last) run: its kind and start. `started` is the job's first. */
  run: { kind: string; started: string };
  ended?: string; cost?: number; model?: string;
  /** The cost as an estimated share of the weekly plan limit; set by the routes, none under 6 hours of usage snapshots. */
  wk?: Wk;
  commit?: string; commitUrl?: string;
  defaults: string[]; followups: string[];
  stat?: string;
  /** A live run exists for this job: a next run or a rerun. */
  agent?: boolean;
  /** Running: the issue whose goals are nested in the Running lane, which shows this job under that goal. */
  issue?: string;
  /** Awaiting: what the run asks of Chris, an input or an approval, and why. */
  ask?: { kind: "input" | "approval"; reason: string };
  /** Awaiting: the reviewer's call on the held run. */
  reviewCall?: { call: string; reason?: string };
  /** A landed job whose manual check is still open. */
  check?: "open";
  checks?: { name: string; ok: boolean; seconds: number }[];
  /** The hidden check's test counts, when the job's item has hidden checks. */
  hidden?: { passed: number; total: number };
  /** Lands: the trailers of the land commit. Needs-you: the trailers the land will write. */
  trailers?: { key: string; value: string }[];
  /** A triage run: its verdict as `goal`, `close`, `done` or `ask`; none while it runs or when it gave no verdict. */
  outcome?: string;
  /** Lands: the acceptance run's result for the job's goal, as `acceptance: pass at <sha>`. */
  acceptance?: string;
  /** Stuck: the open issue this job waits on or its last run names; the row offers Wait instead of Re-check. */
  blocker?: Blocker;
}

/** A new issue of a factory repo, in the shape of the Issue card. */
export interface NewIssue { id: string; title: string; status: string; href: string; labels: string[]; notes: number; created: string; updated: string;
  /** An issue or goal that awaits you: what Chris is asked. */
  question?: string;
  /** Its Ask with options: the fields. */
  decision?: Ask;
  /** The Ask's reason (`fm.reason`); none on an old item. */
  reason?: string;
  /** The Ask's kind: `input` or `approval`. */
  askKind?: "input" | "approval";
  /** The stage from stage(). */
  stage?: string }

/** An issue in Running: its goals, each with its stage and the job that works on it. */
export interface RunningIssue { id: string; title: string; href: string; stage: string; of: { n: number; m: number };
  parts: { id: string; title: string; href: string; stage: string; job?: { name: string; href: string; kind: string } }[] }

/** A done issue as the Done list shows it: the issue is the head, its jobs are links. */
export interface DoneItem { id: string; title: string; href: string; finished: string; jobs: Job[] }
/** An issue as the Incoming list shows it: `stage` is from stage(). */
export interface IncomingItem { id: string; title: string; href: string; created: string; stage: string }

export interface State {
  now: string;
  factory: {
    paused: boolean; judge: "jev" | "haiku"; dayCap: number; liveCap: number; /** Live agent runs, the count the live cap checks. */ liveRuns: number; awaitingCap: number; runsToday: number; costToday: number;
    nextTick: string | null;
    /** True when there is no next elapse and aleph-tick.service is activating or active: a tick is running, not a dead timer. */
    tickInProgress: boolean;
    probe: { at: string; ok: boolean; failed: string[] } | null;
    health: string[];
    /** The factory's own hold (a stuck or failed run), or null. */
    hold: string | null;
    /** The firefighter's factory log lines of the last 24 hours, newest last. */
    firefighter: { at: string; line: string }[];
  };
  stuck: Job[]; running: Job[]; delivered: Job[];
  /** Everything that waits for Chris: one entry per awaiting run, issue, goal and proposal, with its kind (input or approval) and reason. */
  asks: AskItem[];
  /** Queued and blocked goals (and old items): the Queued lane. */
  queued: { repo: string; id: number | string; title: string; stage: string; why: string; kind: WaitReason["kind"];
    waits?: { id: string; href: string; state: string | null }[] }[];
  /** Issues in Running: each with its goals nested and "n of m issues". */
  runningIssues: RunningIssue[];
  /** Land runs in progress. */
  landing: number;
  /** Open issues in factory repos that are not goals and not yet triaged: the newest NEW_ISSUES. */
  issues: NewIssue[];
  /** How many such issues there are in all. */
  newIssues: number;
  /** Every open issue in factory repos, whatever its labels: the count of the Issues metric card. */
  openIssues: number;
  /** Done: the last 10 done issues, newest first, each with the triage and land jobs that belong to it. */
  done: DoneItem[];
  /** Incoming: the last 10 issues added, newest first, each with its current status. */
  incoming: IncomingItem[];
  /** The planner's runs, the running ones first, then the latest finished. */
  planner: Job[];
  /** The Always rules, with how many asks each reason hands to the firefighter. */
  always: { reason: string; action: string; at: string; handed: number }[];
  /** Jobs landed and issues triaged in the last 24 hours, with the 7-day daily average. */
  velocity: { landed: { day: number; avg: number }; triaged: { day: number; avg: number } };
}

/** The Now page shows this many of the latest lands. */
const DELIVERED = 10;
/** So do the Issues and Triage sections. */
const NEW_ISSUES = 10, TRIAGED = 10, DONE = 10;

function systemctlUser(...args: string[]): { ok: boolean; out: string } {
  try {
    const p = Bun.spawnSync(["systemctl", "--user", ...args], { env: process.env, stdout: "pipe", stderr: "ignore" });
    return { ok: p.exitCode === 0, out: p.stdout.toString() };
  } catch { return { ok: false, out: "" }; }
}

/** The next firing of aleph-tick.timer and whether a tick is running, as jobs/lib/doctor.ts reads them: `systemctl show` for the next elapse, `is-active` for the oneshot service. */
export function tickTimer(): { nextTick: string | null; tickInProgress: boolean } {
  const t = systemctlUser("show", "aleph-tick.timer", "-p", "NextElapseUSecRealtime", "-p", "NextElapseUSecMonotonic");
  if (!t.ok) return { nextTick: null, tickInProgress: false };
  const lines = t.out.split("\n");
  const value = (key: string) => lines.find((l) => l.startsWith(`${key}=`))?.slice(key.length + 1).trim() ?? "";
  const set = (v: string) => !!v && v !== "0" && v !== "n/a" && v !== "infinity";
  const dated = (text: string): string | null => {
    const m = text.match(/(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?: (UTC|GMT|Z))?/);
    const d = m && new Date(m[3] ? `${m[1]}T${m[2]}Z` : `${m[1]}T${m[2]}`);
    return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
  };
  // An OnUnitActiveSec timer has only a monotonic elapse, as time since boot: list-timers gives it as a date.
  const real = value("NextElapseUSecRealtime");
  const next = set(real) ? dated(real) : set(value("NextElapseUSecMonotonic")) ? dated(systemctlUser("list-timers", "aleph-tick.timer", "--no-pager").out) : null;
  if (next) return { nextTick: next, tickInProgress: false };
  // A oneshot service reports `activating` while it runs (exit 3): read the word, ignore the exit code.
  const state = systemctlUser("is-active", "aleph-tick.service").out.split("\n")[0]?.trim();
  return { nextTick: null, tickInProgress: state === "activating" || state === "active" };
}

/** The next firing of aleph-tick.timer, or null when there is none (a tick running, a dead timer, or systemctl failing). */
export function nextTick(): string | null { return tickTimer().nextTick; }

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

  // The trailer the land writes.
  const needsYouIssue = (key: string | undefined, todo: number | string | undefined): { key: string; value: string }[] =>
    todo === undefined || key === undefined ? [] : [{ key: "Issue", value: `${key}-${todo}` }];

  const toJob = (runs: Runs, v: JobView = view(runs)): Job => {
    const repo = v.repo ? registry[v.repo] : undefined;
    const todo = v.item;
    const found = todo !== undefined && v.repo ? lists.item(v.repo, todo) : undefined;
    const job: Job = {
      name: v.name, repo: v.repo ?? "", item: found ? { id: idOf(found), title: found.title } : todo !== undefined ? { id: todo, title: "" } : null,
      condition: v.condition, started: v.started, run: { kind: v.run.kind, started: v.run.started },
      defaults: v.defaults, followups: v.followups,
    };
    for (const k of ["phase", "reason", "question", "ended", "cost", "model"] as const) if (v[k] !== undefined) (job as any)[k] = v[k];
    if (v.commit) {
      job.commit = v.commit;
      const url = commitUrl(repo, v.commit, bases);
      if (url) job.commitUrl = url;
    }
    if (v.condition === "awaiting" && v.stat) job.stat = v.stat;
    // An awaiting run with no ask of its own asks a question, as stage() reads it.
    const asked = isAwaiting(lastReal(runs).run.condition) ? runAsk(lastReal(runs).run) ?? { kind: "input" as const, reason: "question" } : undefined;
    if (asked) job.ask = { kind: asked.kind, reason: asked.reason };
    if (asked && v.review) job.reviewCall = v.review;
    if (v.checks) job.checks = v.checks;
    if (v.hidden) job.hidden = v.hidden;
    if (v.check === "open") job.check = "open";
    const accepted = v.condition === "landed" && todo !== undefined && v.repo ? resultLine(v.repo, todo) : null;
    if (accepted) job.acceptance = accepted;
    const trailers = v.condition === "landed" ? landedTrailers(repo, v.commit)
      : v.condition === "awaiting" ? [
        ...needsYouIssue(v.repo, todo),
        { key: "Job", value: v.job },
        ...(asked?.reason === "held-path" || asked?.reason === "review" ? [{ key: "Held-by", value: "Chris" }] : []),
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
          for (const st of stages(repo.path, main, f, Object.keys(f.items), landedIndex(repo.path, main, repo.key))) m.set(st.id.slice(repo.key.length + 1), st);
        } catch {}
      }
      staged.set(repo.key, m);
    }
    return m;
  };
  return { lists, toJob, stagesOf };
}

export function state(now = new Date()): State {
  const registry = loadRegistry();
  // The ledger is read once: every part below takes these jobs (and their runs) instead of reading it again.
  const jobs = allJobs(), runs = jobs.flat();
  const { lists, toJob, stagesOf } = jobProjector(registry, jobs);

  let landing = 0;
  const needs: Job[] = [], stuck: Job[] = [], running: Job[] = [];
  const delivered: { at: number; runs: Runs }[] = [];
  const liveJobs = new Set<string>(), liveItems = new Set<string>();
  const landRuns: Job[] = [];
  for (const runs of jobs) {
    const last = runs.at(-1)!.run;
    // A running planner counts as running; it is not a live agent.
    if (last.kind === "plan" && last.condition === "running") {
      running.push(toJob(runs));
      continue;
    }
    // A triage, planner or facts run sorts a goal and never lands; it shows only when it awaits you.
    if (last.kind === "triage" || last.kind === "plan" || last.kind === "facts") {
      if (isOpen(runs) && isAwaiting(lastReal(runs).run.condition)) needs.push(toJob(runs));
      continue;
    }
    if (isOpen(runs)) {
      const real = lastReal(runs).run;
      if (isAwaiting(real.condition)) needs.push(toJob(runs));
      else if (real.condition === "stuck" || real.condition === "failed") stuck.push(toJob(runs));
      else {
        liveJobs.add(real.job);
        if (onOf(real) !== undefined) liveItems.add(`${real.repo}/${onOf(real)}`);
        const job = toJob(runs);
        running.push(job);
        if (real.kind === "land") { landing++; landRuns.push(job); }
      }
    } else if (last.condition === "landed" && last.ended) {
      const at = Date.parse(last.ended);
      delivered.push({ at, runs });
    }
  }

  for (const j of [...needs, ...stuck]) {
    const todo = j.item?.id;
    j.agent = liveJobs.has(j.name) || (todo !== undefined && liveItems.has(`${j.repo}/${todo}`));
  }

  const openById = new Map<string, { title: string; href: string }>(), waitsOf = new Map<string, string>();
  for (const repo of Object.values(registry)) {
    if (!repo.sandbox) continue;
    for (const item of lists.list(repo.key)?.items ?? []) {
      const id = `${repo.key}-${refOf(item)}`;
      if (status(item) === "open") openById.set(id, { title: item.title, href: `#/issues/${encodeURIComponent(repo.key)}/${refOf(item)}` });
      const after = afterOf(item);
      if (after.length) waitsOf.set(id, after[0]);
    }
  }
  for (const j of stuck) {
    const b = stuckBlocker(j, j.item ? waitsOf.get(`${j.repo}-${j.item.id}`) : undefined, openById);
    if (b) j.blocker = b;
  }

  const DAY_MS = 86_400_000, t0 = now.getTime();
  const rate = (times: number[]) => ({
    day: times.filter((t) => t0 - t < DAY_MS).length,
    avg: times.filter((t) => t0 - t < 7 * DAY_MS).length / 7,
  });
  const landedAt = delivered.map((d) => d.at).filter((t) => t <= t0);
  const triagedAt = runs.filter((e) => e.run.kind === "triage" && e.run.condition === "done").map((e) => Date.parse(e.run.ended ?? e.run.started)).filter((t) => t <= t0);

  // The jobs of each issue, by `repo-id`: the open ones give its status, all of them its Done package.
  const ofItem = new Map<string, Runs[]>();
  for (const runs of jobs) {
    const real = lastReal(runs).run;
    const n = onOf(real);
    if (n === undefined) continue;
    const k = `${real.repo}-${n}`;
    ofItem.set(k, [...(ofItem.get(k) ?? []), runs]);
  }
  const everyone: { at: string; n: number; card: IncomingItem }[] = [];
  const doneItems: { at: number; repo: Repo; item: any; runs: Runs[] }[] = [];

  const fresh: NewIssue[] = [];
  const awaitingItems: NewIssue[] = [];
  const queued: { repo: Repo; item: any; stage: string }[] = [];
  const runningIssues: RunningIssue[] = [];
  let openIssues = 0;
  const hrefOf = (repo: Repo, ref: string) => `#/issues/${encodeURIComponent(repo.key)}/${ref}`;
  // The job that works on each goal now, by `repo-ref`.
  const liveOf = new Map<string, Job>();
  for (const j of running) if (j.item && j.run.kind !== "plan") liveOf.set(`${j.repo}-${j.item.id}`, j);
  const nested = new Set<string>();
  for (const repo of Object.values(registry)) {
    if (!repo.sandbox) continue;
    const stageById = stagesOf(repo);
    const doc = lists.list(repo.key);
    for (const item of doc?.items ?? []) {
      const ref = refOf(item), id = `${repo.key}-${ref}`, href = hrefOf(repo, ref);
      const st = stageById.get(ref)?.stage ?? status(item);
      // Incoming and Done list issues; a goal with an issue shows under it.
      const top = item.sub === undefined;
      const card = (): NewIssue => ({ id, title: item.title, status: "open", href, labels: areasOf(item), notes: item.notes.length, created: String(item.fm.created ?? ""), updated: String(item.fm.updated ?? ""), stage: st });
      const created = String(item.fm.created ?? "");
      if (top) everyone.push({ at: created, n: item.id, card: { id, title: item.title, href, created, stage: st } });
      if (st === "done" && top) {
        const mine = [ref, ...partsOf(doc!, item).map(refOf)].flatMap((r) => ofItem.get(`${repo.key}-${r}`) ?? []);
        const ends = mine.map((r) => Date.parse(r.at(-1)!.run.ended ?? "")).filter((t) => t > 0);
        doneItems.push({ at: ends.length ? Math.max(...ends) : Date.parse(String(item.fm.updated ?? "")) || 0, repo, item, runs: mine });
      }
      if (status(item) !== "open" || st === "done" || st === "dropped") continue;
      if (top) openIssues++;
      const ask = askOf(item);
      if (st === "awaiting" && ask) {
        const c = card();
        const q = ask.question || item.notes.at(-1)?.replace(/^\s*-\s*/, "").trim();
        if (q) c.question = q;
        const d = readAsk(item);
        if (d) c.decision = d;
        c.reason = ask.reason;
        c.askKind = ask.kind;
        awaitingItems.push(c);
      }
      else if (st === "queued" || st === "blocked") queued.push({ repo, item, stage: st });
      else if (st === "new" && !isTracker(item)) fresh.push({ ...card(), status: st });
      const parts = partsOf(doc!, item);
      if (st === "building" && parts.length) {
        const of = stageById.get(ref)?.of ?? { n: 0, m: parts.length };
        const nested_ = parts.map((gi) => {
          const gref = refOf(gi), g = `${repo.key}-${gref}`, j = liveOf.get(g);
          if (j) nested.add(j.name);
          return { id: g, title: gi.title, href: hrefOf(repo, gref), stage: stageById.get(gref)?.stage ?? status(gi),
            ...(j ? { job: { name: j.name, href: `#/jobs/${encodeURIComponent(j.name)}`, kind: j.run.kind } } : {}) };
        });
        runningIssues.push({ id, title: item.title, href, stage: st, of, parts: nested_ });
      }
    }
  }
  for (const j of running) if (nested.has(j.name)) j.issue = j.item ? `${j.repo}-${String(j.item.id).split(".")[0]}` : undefined;

  everyone.sort((a, b) => b.at.localeCompare(a.at) || b.n - a.n);
  doneItems.sort((a, b) => b.at - a.at);
  const done: DoneItem[] = doneItems.slice(0, DONE).map(({ at, repo, item, runs }) => ({
    id: `${repo.key}-${refOf(item)}`, title: item.title, href: hrefOf(repo, refOf(item)),
    finished: at ? new Date(at).toISOString() : "",
    jobs: runs.map((r: Runs) => toJob(r)),
  }));
  const planAt = (r: Runs) => Date.parse(r.at(-1)!.run.condition === "running" ? "9999-01-01" : r.at(-1)!.run.ended ?? r.at(-1)!.run.started);
  const planner = jobs.filter((r) => r.at(-1)!.run.kind === "plan").sort((a, b) => planAt(b) - planAt(a)).slice(0, TRIAGED).map((r) => toJob(r));

  fresh.sort((a, b) => b.created.localeCompare(a.created));
  const today = runsToday(now.getTime(), runs);
  const probe = lastProbe();
  const granted = readAlways();
  // doneChecker's test, from this build's lists and stages: it fetches no project repo, as the stages above do not.
  const isDone = (ref: string): boolean => {
    const r = parseGoalRef(ref), repo = r ? registry[r.repo] : undefined;
    if (!r || !repo) return false;
    const item = lists.item(r.repo, r.id);
    return (item !== undefined && status(item) === "done") || stagesOf(repo).get(String(r.id))?.stage === "done";
  };
  const gated = gates({ only: ["pause", "hold", "probe", "live", "day", "awaiting"], jobs });
  const att = attend({ runs: needs, issues: awaitingItems }, granted);
  // The run behind an ask: its live-run mark, its trailers and its notes.
  for (const a of att.items) {
    const j = a.key.startsWith("run:") ? needs.find((x) => `run:${x.name}` === a.key) : undefined;
    if (!j) continue;
    if (j.item) a.on = `${j.repo}-${j.item.id}`;
    a.agent = j.agent ?? false; a.defaults = j.defaults; a.followups = j.followups;
    if (j.trailers) a.trailers = j.trailers;
  }
  // A red baseline counts while origin/<main> is still the red commit: one rev-parse per repo, not per queued goal.
  const base = baselines(), reds = new Map<string, string | null>();
  const redOf = (repo: Repo): string | null => {
    if (!reds.has(repo.key)) {
      let red: string | null = null;
      const b = base[repo.key];
      if (b && !b.ok) {
        const p = Bun.spawnSync(["git", "-C", repo.path, "rev-parse", `origin/${repo.main}`], { stdout: "pipe", stderr: "ignore" });
        if (p.stdout.toString().trim() === b.commit) red = redLine(b);
      }
      reds.set(repo.key, red);
    }
    return reds.get(repo.key)!;
  };
  return {
    now: now.toISOString(),
    factory: {
      paused: paused(), judge: judgeChoice(), dayCap: DAY_CAP(), liveCap: LIVE_CAP(), liveRuns: liveRuns(runs), awaitingCap: AWAITING_CAP(), runsToday: today.length,
      costToday: spentToday(now.getTime(), runs),
      ...tickTimer(), probe, health: health(now.getTime(), { jobs, lists }), hold: hold(jobs)?.line ?? null,
      firefighter: firefighterLines(now.getTime()),
    },
    asks: att.items, done, incoming: everyone.slice(0, NEW_ISSUES).map((e) => e.card), planner,
    always: Object.entries(granted).map(([reason, g]) => ({ reason, action: g.action, at: g.at, handed: att.handed[reason] ?? 0 })),
    stuck, running, runningIssues, landing, newIssues: fresh.length, openIssues, issues: fresh.slice(0, NEW_ISSUES),
    velocity: { landed: rate(landedAt), triaged: rate(triagedAt) },
    // Lands: land runs in progress first, then the latest landed, DELIVERED in all.
    delivered: [...landRuns, ...delivered.sort((a, b) => b.at - a.at).slice(0, Math.max(0, DELIVERED - landRuns.length)).map((d) => toJob(d.runs))].slice(0, DELIVERED),
    queued: queued.map(({ repo, item, stage }) => {
      const red = redOf(repo);
      const w = waitReason(repo, item, { done: isDone, jobs, gated, red, now });
      return {
        repo: repo.key, id: idOf(item), title: item.title, stage, why: w.text, kind: w.kind,
        ...(w.kind === "waits_on" ? { waits: w.ids.map((id) => {
          const r = parseGoalRef(id), found = r ? lists.item(r.repo, r.id) : undefined;
          return { id, href: r ? hrefOf({ key: r.repo } as Repo, String(r.id)) : "", state: r && found && registry[r.repo] ? stagesOf(registry[r.repo]).get(String(r.id))?.stage ?? status(found) : null };
        }) } : {}),
      };
    }),
  };
}
