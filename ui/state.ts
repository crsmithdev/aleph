/**
 * The `/api/state` object of docs/specs/2026-10-27-ui.md, built read-only from
 * the ledger, the factory directory and the work store. It marks no run
 * `shown` and does not reconcile the ledger with git: both are the CLI's.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { judgeChoice } from "../hooks/lib/jev.ts";
import { DAY_CAP, WAITING_CAP, health, lastProbe, liveRuns, openGoals, paused, runsToday } from "../jobs/lib/factory.ts";
import { allJobs, isOpen, loadRegistry, type Entry, type Repo } from "../jobs/lib/ledger.ts";
import { readList } from "../todo/lib/store.ts";
import type { Doc } from "../todo/lib/todo.ts";

export interface Job {
  name: string; repo: string; item: { id: number; title: string } | null;
  state: string; needs?: string; phase?: string; reason?: string; question?: string;
  started: string; ended?: string; cost?: number; model?: string;
  commit?: string; commitUrl?: string;
  defaults: string[]; followups: string[];
  stat?: string;
  /** A landed job whose manual check is still open. */
  check?: "open";
  checks?: { name: string; ok: boolean; seconds: number }[];
  /** The hidden check's test counts, when the job's item has hidden checks. */
  hidden?: { passed: number; total: number };
  /** Delivered: the trailers of the land commit. Needs-you: the trailers the land will write. */
  trailers?: { key: string; value: string }[];
}

export interface State {
  now: string;
  factory: {
    paused: boolean; judge: "jev" | "haiku"; dayCap: number; liveCap: number; waitingCap: number; runsToday: number; costToday: number;
    ready: number; live: number;
    probe: { at: string; ok: boolean; failed: string[] } | null;
    health: string[];
  };
  needs: Job[]; stuck: Job[]; running: Job[]; delivered: Job[];
  waiting: { repo: string; id: number; title: string }[];
}

/** The Now page shows this many of the latest lands. */
const DELIVERED = 10;

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
      state: r.state, started: runs[0].run.started,
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

  const needs: Job[] = [], stuck: Job[] = [], running: Job[] = [];
  const delivered: { at: number; job: Job }[] = [];
  const openNames = new Set<string>();
  for (const runs of jobs) {
    const last = runs.at(-1)!.run;
    if (isOpen(runs)) {
      openNames.add(`${last.repo}/${last.name}`);
      if (last.state === "needs-you") needs.push(toJob(runs));
      else if (last.state === "stuck" || last.state === "failed") stuck.push(toJob(runs));
      else running.push(toJob(runs));
    } else if (last.state === "landed" && last.ended) {
      const at = Date.parse(last.ended);
      delivered.push({ at, job: toJob(runs) });
    }
  }

  const waitingGoals = openGoals().filter(({ repo, item }) => !openNames.has(`${repo.key}/${repo.key}-${item.id}`));
  const today = runsToday(now.getTime());
  const probe = lastProbe();
  return {
    now: now.toISOString(),
    factory: {
      paused: paused(), judge: judgeChoice(), dayCap: DAY_CAP(), liveCap: Number(process.env.ALEPH_LIVE_CAP ?? 10), waitingCap: WAITING_CAP(), runsToday: today.length,
      costToday: today.reduce((a, e) => a + (e.run.cost ?? 0), 0),
      ready: waitingGoals.length, live: liveRuns(), probe, health: health(now.getTime()),
    },
    needs, stuck, running,
    delivered: delivered.sort((a, b) => b.at - a.at).slice(0, DELIVERED).map((d) => d.job),
    waiting: waitingGoals
      .map(({ repo, item }) => ({ repo: repo.key, id: item.id, title: item.title })),
  };
}
