/**
 * The `/api/state` object of docs/specs/2026-10-27-ui.md, built read-only from
 * the ledger, the factory directory and the work store. It marks no run
 * `shown` and does not reconcile the ledger with git: both are the CLI's.
 */
import { resultLine } from "../jobs/lib/acceptance.ts";
import { judgeChoice } from "../hooks/lib/jev.ts";
import { DAY_CAP, LIVE_CAP, liveRuns, WAITING_CAP, baselines, doneChecker, firefighterLines, gates, health, hold, lastProbe, paused, redLine, runsToday, waitReason, type WaitReason } from "../jobs/lib/factory.ts";
import { allRuns, isAwaiting, loadRegistry, onOf, type Repo } from "../jobs/lib/ledger.ts";
import { allJobs, isOpen, lastReal, view, type Job as Runs, type JobView } from "../jobs/lib/job.ts";
import { readDecision, type Decision } from "../jobs/lib/decision.ts";
import { attend, stuckBlocker, type AttentionItem, type Blocker } from "./attention.ts";
import { readStanding } from "../jobs/lib/standing.ts";
import { askOf, labels, reader } from "../todo/lib/store.ts";
import { parseRef, status } from "../todo/lib/todo.ts";
import { facts, landedIndex, stages } from "../jobs/lib/status.ts";
import type { Stage } from "../jobs/lib/stage.ts";
import type { Wk } from "./usage.ts";

export interface Job {
  name: string; repo: string; item: { id: number; title: string } | null;
  state: string; needs?: string; phase?: string; reason?: string; question?: string;
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
  /** Needs-you: the review2 verdict of the held run. */
  review2?: { verdict: string; reason?: string };
  /** A landed job whose manual check is still open. */
  check?: "open";
  checks?: { name: string; ok: boolean; seconds: number }[];
  /** The hidden check's test counts, when the job's item has hidden checks. */
  hidden?: { passed: number; total: number };
  /** Lands: the trailers of the land commit. Needs-you: the trailers the land will write. */
  trailers?: { key: string; value: string }[];
  /** A triage run: its verdict as `goal`, `closed`, `needs-chris` or `live-check`; none while it runs or when it gave no verdict. */
  outcome?: string;
  /** Lands: the acceptance run's result for the job's goal, as `acceptance: pass at <sha>`. */
  acceptance?: string;
  /** Stuck: the open issue this job waits on or its last run names; the row offers Wait instead of Re-check. */
  blocker?: Blocker;
}

/** A new issue of a factory repo, in the shape of the Issue card. */
export interface NewIssue { id: string; title: string; status: string; href: string; labels: string[]; notes: number; created: string; updated: string;
  /** A needs-chris issue: what Chris is asked, from its last note. */
  question?: string;
  /** A needs-chris issue that carries a structured decision: its fields. */
  decision?: Decision;
  /** The reason code the factory wrote on the issue (`fm.reason`); none on an old item. */
  reason?: string }

/** A done issue as the Done list shows it: the issue is the head, its jobs are links. */
export interface DoneItem { id: string; title: string; href: string; finished: string; jobs: Job[] }
/** An issue as the Incoming list shows it: `status` is the item's stage from stage(). */
export interface IncomingItem { id: string; title: string; href: string; created: string; status: string }

export interface State {
  now: string;
  factory: {
    paused: boolean; judge: "jev" | "haiku"; dayCap: number; liveCap: number; /** Live agent runs, the count the live cap checks. */ liveRuns: number; waitingCap: number; runsToday: number; costToday: number;
    nextTick: string | null;
    probe: { at: string; ok: boolean; failed: string[] } | null;
    health: string[];
    /** The factory's own hold (a stuck or failed run), or null. */
    hold: string | null;
    /** The firefighter's factory log lines of the last 24 hours, newest last. */
    firefighter: { at: string; line: string }[];
  };
  needs: Job[]; stuck: Job[]; running: Job[]; delivered: Job[];
  waiting: { repo: string; id: number; title: string; why: string; kind: WaitReason["kind"];
    waits?: { id: string; href: string; state: string | null }[]; ask?: { href: string } }[];
  /** Land runs in progress. */
  landing: number;
  /** Open issues in factory repos that are not goals and not yet triaged: the newest NEW_ISSUES. */
  issues: NewIssue[];
  /** Open issues labelled needs-chris: they wait for Chris. */
  needsIssues: NewIssue[];
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
  /** What Needs you says: one item per held, review or question run, needs-chris issue and proposal. */
  attention: AttentionItem[];
  /** The standing permissions, with how many items each left out of `attention`. */
  standing: { reason: string; action: string; at: string; handed: number }[];
  /** Jobs landed and issues triaged in the last 24 hours, with the 7-day daily average. */
  velocity: { landed: { day: number; avg: number }; triaged: { day: number; avg: number } };
}

/** The Now page shows this many of the latest lands. */
const DELIVERED = 10;
/** So do the Issues and Triage sections. */
const NEW_ISSUES = 10, TRIAGED = 10, DONE = 10;

/** The next firing of aleph-tick.timer, or null when systemctl fails or lists no such timer. */
export function nextTick(): string | null {
  try {
    const p = Bun.spawnSync(["systemctl", "--user", "list-timers", "aleph-tick.timer", "--no-pager"], { stdout: "pipe", stderr: "ignore" });
    if (p.exitCode !== 0) return null;
    const line = p.stdout.toString().split("\n").find((l) => l.includes("aleph-tick.timer"));
    const m = line?.match(/(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?: (UTC|GMT|Z))?/);
    if (!m) return null;
    const d = new Date(m[3] ? `${m[1]}T${m[2]}Z` : `${m[1]}T${m[2]}`);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  } catch { return null; }
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

/** The trailers of a commit, from `git log -1 --format=%(trailers:only,unfold)`; none when git fails. */
function landedTrailers(repo: Repo | undefined, commit: string | undefined): { key: string; value: string }[] {
  if (!repo || !commit) return [];
  const id = `${repo.path}\0${commit}`;
  const hit = trailers.get(id);
  if (hit) return hit;
  const p = Bun.spawnSync(["git", "-C", repo.path, "log", "-1", "--format=%(trailers:only,unfold)", commit], { stdout: "pipe", stderr: "ignore" });
  if (p.exitCode !== 0) return [];
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
export function jobProjector(registry: Record<string, Repo> = loadRegistry()) {
  const lists = reader();
  const bases = new Map<string, string | null>();

  const toJob = (runs: Runs, v: JobView = view(runs)): Job => {
    const repo = v.repo ? registry[v.repo] : undefined;
    const todo = v.item;
    const found = todo !== undefined && v.repo ? lists.item(v.repo, todo) : undefined;
    const job: Job = {
      name: v.name, repo: v.repo ?? "", item: found ? { id: found.id, title: found.title } : todo !== undefined ? { id: todo, title: "" } : null,
      state: v.state, started: v.started, run: { kind: v.run.kind, started: v.run.started },
      defaults: v.defaults, followups: v.followups,
    };
    for (const k of ["needs", "phase", "reason", "question", "ended", "cost", "model"] as const) if (v[k] !== undefined) (job as any)[k] = v[k];
    if (v.commit) {
      job.commit = v.commit;
      const url = commitUrl(repo, v.commit, bases);
      if (url) job.commitUrl = url;
    }
    if (v.state === "needs-you" && v.stat) job.stat = v.stat;
    if (v.state === "needs-you" && v.review2) job.review2 = v.review2;
    if (v.checks) job.checks = v.checks;
    if (v.hidden) job.hidden = v.hidden;
    if (v.check === "open") job.check = "open";
    const accepted = v.state === "landed" && todo !== undefined && v.repo ? resultLine(v.repo, todo) : null;
    if (accepted) job.acceptance = accepted;
    const trailers = v.state === "landed" ? landedTrailers(repo, v.commit)
      : v.state === "needs-you" ? [
        ...(todo !== undefined ? [{ key: "Item", value: `${v.repo}-${todo}` }] : []),
        { key: "Job", value: v.job },
        ...(v.needs === "held" || v.needs === "review" ? [{ key: "Held-by", value: "Chris" }] : []),
      ] : [];
    if (trailers.length) job.trailers = trailers;
    return job;
  };
  // One landedIndex per repo per request: the stage of each item of a repo, by number.
  const staged = new Map<string, Map<number, Stage>>();
  const stagesOf = (repo: Repo): Map<number, Stage> => {
    let m = staged.get(repo.key);
    if (!m) {
      m = new Map();
      const doc = lists.list(repo.key);
      if (doc) {
        try {
          const f = facts(repo, doc), main = `refs/remotes/origin/${f.main}`;
          for (const st of stages(repo.path, main, f, Object.keys(f.items).map(Number), landedIndex(repo.path, main, repo.key))) m.set(Number(st.id.slice(repo.key.length + 1)), st);
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
  const jobs = allJobs();
  const { lists, toJob, stagesOf } = jobProjector(registry);

  let landing = 0;
  const needs: Job[] = [], stuck: Job[] = [], running: Job[] = [];
  const delivered: { at: number; runs: Runs }[] = [];
  const liveJobs = new Set<string>(), liveItems = new Set<string>();
  const landRuns: Job[] = [];
  for (const runs of jobs) {
    const last = runs.at(-1)!.run;
    // A running planner counts as running; it is not a live agent.
    if (last.kind === "plan" && last.state === "running") {
      running.push(toJob(runs));
      continue;
    }
    // A triage, planner or facts run sorts a goal and never lands.
    if (last.kind === "triage" || last.kind === "plan" || last.kind === "facts") continue;
    if (isOpen(runs)) {
      const real = lastReal(runs).run;
      if (isAwaiting(real.state)) needs.push(toJob(runs));
      else if (real.state === "stuck" || real.state === "failed") stuck.push(toJob(runs));
      else {
        liveJobs.add(real.job);
        if (onOf(real) !== undefined) liveItems.add(`${real.repo}/${onOf(real)}`);
        const job = toJob(runs);
        running.push(job);
        if (real.kind === "land") { landing++; landRuns.push(job); }
      }
    } else if (last.state === "landed" && last.ended) {
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
      const id = `${repo.key}-${item.id}`;
      if (status(item) === "open") openById.set(id, { title: item.title, href: `#/issues/${encodeURIComponent(repo.key)}/${item.id}` });
      if (typeof item.fm.waiting_on === "string") waitsOf.set(id, item.fm.waiting_on);
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
  const triagedAt = allRuns().filter((e) => e.run.kind === "triage" && e.run.state === "done").map((e) => Date.parse(e.run.ended ?? e.run.started)).filter((t) => t <= t0);

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
  const doneItems: { at: number; repo: Repo; item: any }[] = [];

  const fresh: NewIssue[] = [];
  const waitingOnChris: NewIssue[] = [];
  const queued: { repo: Repo; item: any }[] = [];
  let openIssues = 0;
  for (const repo of Object.values(registry)) {
    if (!repo.sandbox) continue;
    const stageById = stagesOf(repo);
    for (const item of lists.list(repo.key)?.items ?? []) {
      const st = stageById.get(item.id)?.stage ?? status(item);
      const card = (): NewIssue => ({ id: `${repo.key}-${item.id}`, title: item.title, status: "open", href: `#/issues/${encodeURIComponent(repo.key)}/${item.id}`, labels: labels(item), notes: item.notes.length, created: String(item.fm.created ?? ""), updated: String(item.fm.updated ?? "") });
      const created = String(item.fm.created ?? "");
      everyone.push({ at: created, n: item.id, card: { id: `${repo.key}-${item.id}`, title: item.title, href: `#/issues/${encodeURIComponent(repo.key)}/${item.id}`, created, status: st } });
      if (st === "done") {
        const ends = (ofItem.get(`${repo.key}-${item.id}`) ?? []).map((r) => Date.parse(r.at(-1)!.run.ended ?? "")).filter((t) => t > 0);
        doneItems.push({ at: ends.length ? Math.max(...ends) : Date.parse(String(item.fm.updated ?? "")) || 0, repo, item });
      }
      if (status(item) !== "open" || st === "done" || st === "dropped") continue;
      openIssues++;
      if (st === "awaiting" && askOf(item)) {
        const c = card();
        const q = item.notes.at(-1)?.replace(/^\s*-\s*/, "").trim();
        if (q) c.question = q;
        const d = readDecision(item);
        if (d) c.decision = d;
        if (typeof item.fm.reason === "string" && item.fm.reason) c.reason = item.fm.reason;
        waitingOnChris.push(c);
      }
      else if (st === "queued" || st === "blocked") queued.push({ repo, item });
      else if (st === "new") fresh.push({ ...card(), status: st });
    }
  }

  everyone.sort((a, b) => b.at.localeCompare(a.at) || b.n - a.n);
  doneItems.sort((a, b) => b.at - a.at);
  const done: DoneItem[] = doneItems.slice(0, DONE).map(({ at, repo, item }) => ({
    id: `${repo.key}-${item.id}`, title: item.title, href: `#/issues/${encodeURIComponent(repo.key)}/${item.id}`,
    finished: at ? new Date(at).toISOString() : "",
    jobs: (ofItem.get(`${repo.key}-${item.id}`) ?? []).map((r) => toJob(r)),
  }));
  const planAt = (r: Runs) => Date.parse(r.at(-1)!.run.state === "running" ? "9999-01-01" : r.at(-1)!.run.ended ?? r.at(-1)!.run.started);
  const planner = jobs.filter((r) => r.at(-1)!.run.kind === "plan").sort((a, b) => planAt(b) - planAt(a)).slice(0, TRIAGED).map((r) => toJob(r));

  fresh.sort((a, b) => b.created.localeCompare(a.created));
  const today = runsToday(now.getTime());
  const probe = lastProbe();
  const granted = readStanding();
  const isDone = doneChecker(), gated = gates({ only: ["pause", "hold", "probe", "live", "day", "waiting"], jobs });
  const att = attend({ needs, needsIssues: waitingOnChris }, granted);
  return {
    now: now.toISOString(),
    factory: {
      paused: paused(), judge: judgeChoice(), dayCap: DAY_CAP(), liveCap: LIVE_CAP(), liveRuns: liveRuns(), waitingCap: WAITING_CAP(), runsToday: today.length,
      costToday: today.reduce((a, e) => a + (e.run.cost ?? 0), 0),
      nextTick: nextTick(), probe, health: health(now.getTime()), hold: hold(jobs)?.line ?? null,
      firefighter: firefighterLines(now.getTime()),
    },
    attention: att.items, done, incoming: everyone.slice(0, NEW_ISSUES).map((e) => e.card), planner,
    standing: Object.entries(granted).map(([reason, g]) => ({ reason, action: g.action, at: g.at, handed: att.handed[reason] ?? 0 })),
    needs, stuck, running, landing, newIssues: fresh.length, openIssues, issues: fresh.slice(0, NEW_ISSUES), needsIssues: waitingOnChris,
    velocity: { landed: rate(landedAt), triaged: rate(triagedAt) },
    // Lands: land runs in progress first, then the latest landed, DELIVERED in all.
    delivered: [...landRuns, ...delivered.sort((a, b) => b.at - a.at).slice(0, Math.max(0, DELIVERED - landRuns.length)).map((d) => toJob(d.runs))].slice(0, DELIVERED),
    waiting: queued.map(({ repo, item }) => {
      const href = `#/issues/${encodeURIComponent(repo.key)}/${item.id}`;
      let red: string | null = null;
      const b = baselines()[repo.key];
      if (b && !b.ok) {
        const p = Bun.spawnSync(["git", "-C", repo.path, "rev-parse", `origin/${repo.main}`], { stdout: "pipe", stderr: "ignore" });
        if (p.stdout.toString().trim() === b.commit) red = redLine(b);
      }
      const w = waitReason(repo, item, { done: isDone, jobs, gated, red, now });
      return {
        repo: repo.key, id: item.id, title: item.title, why: w.text, kind: w.kind,
        ...(w.kind === "waits_on" ? { waits: w.ids.map((id) => {
          const r = parseRef(id), found = r ? lists.item(r.repo, r.id) : undefined;
          return { id, href: r ? `#/issues/${encodeURIComponent(r.repo)}/${r.id}` : "", state: r && found && registry[r.repo] ? stagesOf(registry[r.repo]).get(r.id)?.stage ?? status(found) : null };
        }) } : {}),
        ...(w.kind === "needs-chris" ? { ask: { href } } : {}),
      };
    }),
  };
}
