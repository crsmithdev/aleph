/**
 * The `/api/state` object of docs/specs/2026-10-27-ui.md, built read-only from
 * the ledger, the factory directory and the work store. It marks no run
 * `shown` and does not reconcile the ledger with git: both are the CLI's.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { judgeChoice } from "../hooks/lib/jev.ts";
import { DAY_CAP, LIVE_CAP, WAITING_CAP, health, hold, lastProbe, openGoals, paused, runsToday } from "../jobs/lib/factory.ts";
import { allJobs, allRuns, isOpen, loadRegistry, readReview2, type Entry, type Repo } from "../jobs/lib/ledger.ts";
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
export interface NewIssue { id: string; title: string; status: string; href: string; labels: string[]; notes: number; created: string; updated: string }

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

/** The trailers of a commit, from `git log -1 --format=%(trailers:only,unfold)`; none when git fails. */
function landedTrailers(repo: Repo | undefined, commit: string | undefined): { key: string; value: string }[] {
  if (!repo || !commit) return [];
  const p = Bun.spawnSync(["git", "-C", repo.path, "log", "-1", "--format=%(trailers:only,unfold)", commit], { stdout: "pipe", stderr: "ignore" });
  if (p.exitCode !== 0) return [];
  return p.stdout.toString().split("\n").flatMap((l) => {
    const i = l.indexOf(":");
    return i > 0 ? [{ key: l.slice(0, i).trim(), value: l.slice(i + 1).trim() }] : [];
  });
}

const read = (folder: string, f: string): string | undefined => {
  const p = join(folder, f);
  return existsSync(p) ? readFileSync(p, "utf8") : undefined;
};

const tagged = (text: string, tag: string): string[] =>
  text.split("\n").map((l) => l.trim()).filter((l) => l.startsWith(`${tag}:`)).map((l) => l.slice(tag.length + 1).trim());

export function state(now = new Date()): State {
  const registry = loadRegistry();
  const jobs = allJobs();
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

  const toJob = (runs: Entry[]): Job => {
    const last = runs.at(-1)!;
    const r = last.run;
    const repo = r.repo ? registry[r.repo] : undefined;
    const todo = runs.findLast((e) => e.run.todo !== undefined)?.run.todo;
    const found = todo !== undefined && r.repo ? list(r.repo)?.items.find((i) => i.id === todo) : undefined;
    const withDefaults = runs.findLast((e) => e.run.defaults !== undefined);
    const withResult = runs.findLast((e) => e.run.kind === "agent" && existsSync(join(e.folder, "result.md")));
    const commit = r.commit ?? runs.findLast((e) => e.run.commit)?.run.commit;
    const cost = runs.some((e) => e.run.cost !== undefined) ? runs.reduce((a, e) => a + (e.run.cost ?? 0), 0) : undefined;
    const job: Job = {
      name: r.name, repo: r.repo ?? "", item: found ? { id: found.id, title: found.title } : todo !== undefined ? { id: todo, title: "" } : null,
      state: r.state, started: runs[0].run.started, run: { kind: r.kind, started: r.started },
      defaults: withDefaults?.run.defaults ?? [],
      followups: withResult ? tagged(read(withResult.folder, "result.md") ?? "", "FOLLOWUP") : [],
    };
    if (r.needs) job.needs = r.needs;
    if (r.phase) job.phase = r.phase;
    if (r.reason) job.reason = r.reason;
    if (r.question) job.question = r.question;
    if (r.ended) job.ended = r.ended;
    if (cost !== undefined) job.cost = cost;
    const model = r.model ?? runs.findLast((e) => e.run.model)?.run.model;
    if (model) job.model = model;
    if (commit) {
      job.commit = commit;
      const url = commitUrl(repo, commit, bases);
      if (url) job.commitUrl = url;
    }
    const stat = r.stat ?? runs.findLast((e) => e.run.stat)?.run.stat;
    if (r.state === "needs-you" && stat) job.stat = stat;
    const review2 = r.state === "needs-you" ? readReview2(last.folder) : undefined;
    if (review2) job.review2 = review2;
    const withChecks = runs.findLast((e) => e.run.checks?.length)?.run.checks;
    if (withChecks) job.checks = withChecks;
    const hid = runs.findLast((e) => e.run.checks?.some((c) => c.name === "hidden" && c.total))?.run.checks?.find((c) => c.name === "hidden");
    if (hid?.total) job.hidden = { passed: hid.passed ?? 0, total: hid.total };
    if (r.state === "landed" && r.check === "open") job.check = "open";
    const checks = (runs.findLast((e) => (e.run as any).checks)?.run as any)?.checks;
    if (r.state === "stuck" || r.state === "failed") if (Array.isArray(checks)) job.checks = checks;
    const trailers = r.state === "landed" ? landedTrailers(repo, commit)
      : r.state === "needs-you" ? [
        ...(todo !== undefined ? [{ key: "Item", value: `${r.repo}-${todo}` }] : []),
        { key: "Job", value: r.job },
        ...(r.needs === "held" || r.needs === "review" ? [{ key: "Held-by", value: "Chris" }] : []),
      ] : [];
    if (trailers.length) job.trailers = trailers;
    return job;
  };

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
      openNames.add(`${last.repo}/${last.name}`);
      if (last.state === "needs-you") needs.push(toJob(runs));
      else if (last.state === "stuck" || last.state === "failed") stuck.push(toJob(runs));
      else {
        liveJobs.add(last.job);
        if (last.todo !== undefined) liveItems.add(`${last.repo}/${last.todo}`);
        const job = toJob(runs);
        running.push(job);
        if (last.kind === "land") { landing++; landRuns.push(job); }
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
  for (const repo of Object.values(registry)) {
    if (!repo.sandbox) continue;
    for (const item of list(repo.key)?.items ?? []) {
      const labels = (item.fm.labels as string[]) ?? [];
      const card = (): NewIssue => ({ id: `${repo.key}-${item.id}`, title: item.title, status: "open", href: `#/issues/${encodeURIComponent(repo.key)}/${item.id}`, labels, notes: item.notes.length, created: String(item.fm.created ?? ""), updated: String(item.fm.updated ?? "") });
      if (status(item) !== "open") continue;
      if (labels.includes("needs-chris")) waitingOnChris.push(card());
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
    needs, stuck, running, landing, newIssues: fresh.length, issues: fresh.slice(0, NEW_ISSUES), needsIssues: waitingOnChris,
    triage: triageRuns.sort((a, b) => b.at - a.at).slice(0, TRIAGED).map((t) => t.job),
    velocity: { landed: rate(landedAt), triaged: rate(triagedAt) },
    // Lands: land runs in progress first, then the latest landed, DELIVERED in all.
    delivered: [...landRuns, ...delivered.sort((a, b) => b.at - a.at).map((d) => d.job)].slice(0, DELIVERED),
    waiting: openGoals().filter(({ repo, item }) => !openNames.has(`${repo.key}/${repo.key}-${item.id}`))
      .map(({ repo, item }) => ({ repo: repo.key, id: item.id, title: item.title })),
  };
}
