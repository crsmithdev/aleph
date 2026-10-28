/**
 * The `/api/state` object of docs/specs/2026-10-27-ui.md, built read-only from
 * the ledger, the factory directory and the work store. It marks no run
 * `shown` and does not reconcile the ledger with git: both are the CLI's.
 */
import { judgeChoice } from "../hooks/lib/jev.ts";
import { DAY_CAP, LIVE_CAP, WAITING_CAP, health, hold, lastProbe, openGoals, paused, runsToday } from "../jobs/lib/factory.ts";
import { allRuns, loadRegistry, type Repo } from "../jobs/lib/ledger.ts";
import { allJobs, isOpen, lastReal, view, type Job as Runs, type JobView } from "../jobs/lib/job.ts";
import { readDecision, type Decision } from "../jobs/lib/decision.ts";
import { readList } from "../todo/lib/store.ts";
import { status, type Doc } from "../todo/lib/todo.ts";

export interface Job {
  name: string; repo: string; item: { id: number; title: string } | null;
  state: string; needs?: string; phase?: string; reason?: string; question?: string;
  started: string;
  /** The current (last) run: its kind and start. `started` is the job's first. */
  run: { kind: string; started: string };
  ended?: string; cost?: number; model?: string;
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
}

/** A new issue of a factory repo, in the shape of the Issue card. */
export interface NewIssue { id: string; title: string; status: string; href: string; labels: string[]; notes: number; created: string; updated: string;
  /** A needs-chris issue: what Chris is asked, from its last note. */
  question?: string;
  /** A needs-chris issue that carries a structured decision: its fields. */
  decision?: Decision }

export interface State {
  now: string;
  factory: {
    paused: boolean; judge: "jev" | "haiku"; dayCap: number; liveCap: number; waitingCap: number; runsToday: number; costToday: number;
    nextTick: string | null;
    probe: { at: string; ok: boolean; failed: string[] } | null;
    health: string[];
    /** The factory's own hold (a stuck or failed run), or null. */
    hold: string | null;
  };
  needs: Job[]; stuck: Job[]; running: Job[]; delivered: Job[];
  waiting: { repo: string; id: number; title: string }[];
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
  /** Triage runs: those running, then the latest finished. */
  triage: Job[];
  /** Jobs landed and issues triaged in the last 24 hours, with the 7-day daily average. */
  velocity: { landed: { day: number; avg: number }; triaged: { day: number; avg: number } };
}

/** Labels that mark an issue as already sorted. */
const SORTED = ["goal", "needs-chris", "triaged", "live-check", "proposal"];

/** The Now page shows this many of the latest lands. */
const DELIVERED = 10;
/** So do the Issues and Triage sections. */
const NEW_ISSUES = 10, TRIAGED = 10;
const OUTCOME: Record<string, string> = { goal: "goal", close: "closed", chris: "needs-chris", live: "live-check" };

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
  const lists = new Map<string, Doc | null>();
  const list = (key: string): Doc | null => {
    if (!lists.has(key)) {
      let doc: Doc | null = null;
      try { doc = readList({ key }); } catch {}
      lists.set(key, doc);
    }
    return lists.get(key)!;
  };
  const bases = new Map<string, string | null>();

  const toJob = (runs: Runs, v: JobView = view(runs)): Job => {
    const repo = v.repo ? registry[v.repo] : undefined;
    const todo = v.item;
    const found = todo !== undefined && v.repo ? list(v.repo)?.items.find((i) => i.id === todo) : undefined;
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
    const trailers = v.state === "landed" ? landedTrailers(repo, v.commit)
      : v.state === "needs-you" ? [
        ...(todo !== undefined ? [{ key: "Item", value: `${v.repo}-${todo}` }] : []),
        { key: "Job", value: v.job },
        ...(v.needs === "held" || v.needs === "review" ? [{ key: "Held-by", value: "Chris" }] : []),
      ] : [];
    if (trailers.length) job.trailers = trailers;
    return job;
  };
  return { list, toJob };
}

export function state(now = new Date()): State {
  const registry = loadRegistry();
  const jobs = allJobs();
  const { list, toJob } = jobProjector(registry);

  let landing = 0;
  const needs: Job[] = [], stuck: Job[] = [], running: Job[] = [];
  const delivered: { at: number; job: Job }[] = [];
  const liveJobs = new Set<string>(), liveItems = new Set<string>();
  const landRuns: Job[] = [];
  const openNames = new Set<string>();
  const triageRuns: { at: number; job: Job }[] = [];
  for (const runs of jobs) {
    const last = runs.at(-1)!.run;
    if (last.kind === "triage") {
      const job = toJob(runs);
      if (OUTCOME[last.reason ?? ""]) job.outcome = OUTCOME[last.reason!];
      triageRuns.push({ at: Date.parse(last.state === "running" ? "9999-01-01" : last.ended ?? last.started), job });
      continue;
    }
    if (isOpen(runs)) {
      const real = lastReal(runs).run;
      openNames.add(`${last.repo}/${last.name}`);
      if (real.state === "needs-you") needs.push(toJob(runs));
      else if (real.state === "stuck" || real.state === "failed") stuck.push(toJob(runs));
      else {
        liveJobs.add(real.job);
        if (real.todo !== undefined) liveItems.add(`${real.repo}/${real.todo}`);
        const job = toJob(runs);
        running.push(job);
        if (real.kind === "land") { landing++; landRuns.push(job); }
      }
    } else if (last.state === "landed" && last.ended) {
      const at = Date.parse(last.ended);
      delivered.push({ at, job: toJob(runs) });
    }
  }

  for (const j of [...needs, ...stuck]) {
    const todo = j.item?.id;
    j.agent = liveJobs.has(j.name) || (todo !== undefined && liveItems.has(`${j.repo}/${todo}`));
  }

  const DAY_MS = 86_400_000, t0 = now.getTime();
  const rate = (times: number[]) => ({
    day: times.filter((t) => t0 - t < DAY_MS).length,
    avg: times.filter((t) => t0 - t < 7 * DAY_MS).length / 7,
  });
  const landedAt = delivered.map((d) => d.at).filter((t) => t <= t0);
  const triagedAt = allRuns().filter((e) => e.run.kind === "triage" && e.run.state === "done").map((e) => Date.parse(e.run.ended ?? e.run.started)).filter((t) => t <= t0);

  const fresh: NewIssue[] = [];
  const waitingOnChris: NewIssue[] = [];
  let openIssues = 0;
  for (const repo of Object.values(registry)) {
    if (!repo.sandbox) continue;
    for (const item of list(repo.key)?.items ?? []) {
      const labels = (item.fm.labels as string[]) ?? [];
      const card = (): NewIssue => ({ id: `${repo.key}-${item.id}`, title: item.title, status: "open", href: `#/issues/${encodeURIComponent(repo.key)}/${item.id}`, labels, notes: item.notes.length, created: String(item.fm.created ?? ""), updated: String(item.fm.updated ?? "") });
      if (status(item) !== "open") continue;
      openIssues++;
      if (labels.includes("needs-chris")) {
        const c = card();
        const q = item.notes.at(-1)?.replace(/^\s*-\s*/, "").trim();
        if (q) c.question = q;
        const d = readDecision(item);
        if (d) c.decision = d;
        waitingOnChris.push(c);
      }
      else if (!labels.some((l) => SORTED.includes(l))) fresh.push(card());
    }
  }

  fresh.sort((a, b) => b.created.localeCompare(a.created));
  const today = runsToday(now.getTime());
  const probe = lastProbe();
  return {
    now: now.toISOString(),
    factory: {
      paused: paused(), judge: judgeChoice(), dayCap: DAY_CAP(), liveCap: LIVE_CAP(), waitingCap: WAITING_CAP(), runsToday: today.length,
      costToday: today.reduce((a, e) => a + (e.run.cost ?? 0), 0),
      nextTick: nextTick(), probe, health: health(now.getTime()), hold: hold(jobs)?.line ?? null,
    },
    needs, stuck, running, landing, newIssues: fresh.length, openIssues, issues: fresh.slice(0, NEW_ISSUES), needsIssues: waitingOnChris,
    triage: triageRuns.sort((a, b) => b.at - a.at).slice(0, TRIAGED).map((t) => t.job),
    velocity: { landed: rate(landedAt), triaged: rate(triagedAt) },
    // Lands: land runs in progress first, then the latest landed, DELIVERED in all.
    delivered: [...landRuns, ...delivered.sort((a, b) => b.at - a.at).map((d) => d.job)].slice(0, DELIVERED),
    waiting: openGoals().filter(({ repo, item }) => !openNames.has(`${repo.key}/${repo.key}-${item.id}`))
      .map(({ repo, item }) => ({ repo: repo.key, id: item.id, title: item.title })),
  };
}
