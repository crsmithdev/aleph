/**
 * `GET /api/projects` and `GET /api/projects/<key>`: each registry repo with its open
 * items and goals, last land, distance behind origin/<main>, baseline and vault notes.
 * Read-only and offline: git is asked about refs already fetched, never fetched.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { factoryDir } from "../../jobs/lib/factory.ts";
import { git } from "../../jobs/lib/git.ts";
import { loadRegistry, type Entry, type Repo } from "../../jobs/lib/ledger.ts";
import { allJobs, lastReal } from "../../jobs/lib/job.ts";
import { isGoal, labels, readFetched } from "../../todo/lib/store.ts";
import { status, type Item } from "../../todo/lib/todo.ts";
import { vaultDir, type Note } from "../../vault/lib/vault.ts";
import { vaultNotes } from "./memory.ts";
import type { Routes } from "../server.ts";
import { githubBase } from "../state.ts";

export interface Card {
  key: string; path: string; factory: boolean;
  openItems: number; openGoals: number;
  lastLanded: { name: string; at: string } | null;
  behind: number | null;
  baseline: { commit: string; ok: boolean; failed?: string } | null;
  notes: number;
  /** The latest of the last land and the latest job start, for ordering. */
  activity: string | null;
}

export interface Detail extends Card {
  commits: { hash: string; subject: string; date: string; item: string | null; commitUrl?: string }[];
  items: { id: number; title: string; labels: string[]; priority: string }[];
  jobs: { name: string; state: string; started: string; ended?: string; item: number | string | null }[];
  vault: { title: string; kind: string; updated: string }[];
}

/** The repo's open issues on the work store's last-fetched origin/main; no fetch. */
function openIssues(key: string): Item[] {
  return (readFetched({ key })?.items ?? []).filter((i) => status(i) === "open");
}

function baselineOf(repo: Repo): Card["baseline"] {
  if (!repo.sandbox) return null;
  try {
    const b = JSON.parse(readFileSync(join(factoryDir(), "baseline.json"), "utf8"))[repo.key];
    return b ? { commit: b.commit, ok: !!b.ok, ...(b.failed ? { failed: b.failed } : {}) } : null;
  } catch { return null; }
}

/** The loaders a request reads once; a test swaps them to count reads. */
export const loaders = { vault: () => vaultNotes(vaultDir()), jobs: allJobs };

const scoped = (repo: Repo, notes: Note[]) => notes.filter((n) => !n.archived && [n.fm.scope ?? []].flat().includes(repo.key));

const jobsOf = (repo: Repo, jobs: Entry[][]): Entry[][] => jobs.filter((j) => j.at(-1)!.run.repo === repo.key);

function card(repo: Repo, issues: Item[], jobs: Entry[][], notes: number): Card {
  const landed = jobs.map((j) => j.at(-1)!.run).filter((r) => r.state === "landed" && r.ended)
    .sort((a, b) => Date.parse(b.ended!) - Date.parse(a.ended!))[0];
  const started = jobs.map((j) => j[0].run.started).sort().at(-1);
  const n = git(repo.path, "rev-list", "--count", `HEAD..origin/${repo.main}`);
  const activity = [landed?.ended, started].filter((x): x is string => !!x).sort().at(-1) ?? null;
  return {
    key: repo.key, path: repo.path, factory: repo.sandbox,
    openItems: issues.length, openGoals: issues.filter(isGoal).length,
    lastLanded: landed ? { name: landed.name, at: landed.ended! } : null,
    behind: n.ok ? Number(n.out) : null,
    baseline: baselineOf(repo), notes, activity,
  };
}

function commits(repo: Repo): Detail["commits"] {
  const base = githubBase(git(repo.path, "remote", "get-url", "origin").out);
  const r = git(repo.path, "log", "-20", `--format=%H%x1f%s%x1f%aI%x1f%(trailers:key=Item,valueonly,separator=%x2C )%x1e`, `origin/${repo.main}`);
  if (!r.ok) return [];
  return r.out.split("\x1e").map((s) => s.trim()).filter(Boolean).map((rec) => {
    const [hash, subject, date, item] = rec.split("\x1f");
    return { hash, subject, date, item: item?.trim() || null, ...(base ? { commitUrl: `${base}/commit/${hash}` } : {}) };
  });
}

const stamp = (s: string | null | undefined) => (s ? Date.parse(s) || 0 : 0);

export async function projects(only: string | null): Promise<Card[]> {
  const notes = await loaders.vault(), jobs = loaders.jobs();
  return Object.values(loadRegistry()).filter((r) => !only || r.key === only).map((r) => card(r, openIssues(r.key), jobsOf(r, jobs), scoped(r, notes).length))
    .sort((a, b) => stamp(b.activity) - stamp(a.activity) || a.key.localeCompare(b.key));
}

export async function project(key: string): Promise<Detail | null> {
  const repo = loadRegistry()[key];
  if (!repo) return null;
  const issues = openIssues(key), jobs = jobsOf(repo, loaders.jobs()), notes = scoped(repo, await loaders.vault());
  return {
    ...card(repo, issues, jobs, notes.length),
    commits: commits(repo),
    items: issues.map((i) => ({ id: i.id, title: i.title, labels: labels(i), priority: String(i.fm.priority ?? "medium") })),
    jobs: jobs.slice(-10).reverse().map((j) => {
      const r = lastReal(j).run;
      return { name: r.name, state: r.state, started: j[0].run.started, ...(r.ended ? { ended: r.ended } : {}), item: j.findLast((e) => e.run.todo !== undefined)?.run.todo ?? null };
    }),
    vault: notes.map((n) => ({ title: n.title, kind: String(n.fm.kind ?? ""), updated: String(n.fm.updated ?? "") }))
      .sort((a, b) => b.updated.localeCompare(a.updated) || a.title.localeCompare(b.title)),
  };
}

export const routes: Routes = {
  "GET /api/projects": async (_req, _p, url) => Response.json(await projects(url.searchParams.get("project") || null)),
  "GET /api/projects/:key": async (_req, params, url) => {
    const only = url.searchParams.get("project");
    const d = only && only !== params.key ? null : await project(params.key);
    return d ? Response.json(d) : Response.json({ error: `no project ${params.key}` }, { status: 404 });
  },
};
