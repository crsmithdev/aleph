/**
 * Item stage (seed milestone 2): stage() over the `Issue:` trailers on
 * origin/<main>, the work store and the ledger. Nothing writes it back to the store.
 */
import { readFetched, readList } from "../../../issues/lib/store.ts";
import * as issues from "../../../issues/lib/todo.ts";
import { fetchOrigin, git, jobCommit } from "../infra/git.ts";
import { allRuns, trailerOf, type Entry, type Repo, type State } from "./ledger.ts";
import { allJobs, isOpen, issue, stateOf } from "./job.ts";
import { runViewOf, stage, subjectOf, type Ctx, type RunView, type Stage, type Subject } from "./stage.ts";

/** What the store and the ledger say about a repo's items: what stage() needs of each. */
export interface Facts {
  repo: string; main: string;
  /** The repo has `sandbox: true`: it is a factory repo. */
  sandbox: boolean;
  /** Item number to its status, kind, after, issues and ask kind. */
  items: Record<string, Subject>;
  /** Item number to its jobs, each as its last run: the open run state is in there. */
  runs: Record<string, RunView[]>;
  /** Item number to the state of its open job's latest run. */
  open: Record<string, State>;
  /** Items that a run of the factory has worked on. */
  touched: number[];
}

/** `doc` is the repo's list, and `jobs` every job, when the caller has read them already. */
export function facts(repo: Repo, doc: issues.Doc | null = readList(repo), jobs: Entry[][] = allJobs()): Facts {
  const items: Record<string, Subject> = {};
  for (const i of doc?.items ?? []) items[issues.refOf(i)] = subjectOf(i, repo.key, doc!);
  const runs: Record<string, RunView[]> = {};
  const open: Record<string, State> = {};
  const touched = new Set<number>();
  for (const job of jobs) {
    const item = issue(job);
    if (item === undefined || job[0].run.repo !== repo.key) continue;
    // An intake run (a triage or planner run before it) marks its item in the store and does not land:
    // neither is a factory run working on the item, so an issue they close in the store is done.
    if (typeof item === "number" && repo.sandbox && job.some((e) => e.run.kind !== "intake")) touched.add(item);
    (runs[item] ??= []).push(runViewOf(job));
    if (isOpen(job)) open[item] = stateOf(job);
  }
  return { repo: repo.key, main: repo.main, sandbox: !!repo.sandbox, items, runs, open, touched: [...touched].sort((a, b) => a - b) };
}

/**
 * The commits on `main` whose trailer block holds `Issue: <key>-<n>`, after the item's `since`, and that
 * no later commit reverts. Only trailer lines count: a subject or a body line that says `Issue:` does not.
 */
export function landedCommits(cwd: string, main: string, key: string, n: number | string): string[] {
  return landedIndex(cwd, main, key).get(String(n)) ?? [];
}

/** For a `landedIndex` result, the items with a trailer commit on main that a later commit reverts and none that is not reverted. */
const revertedOnly = new WeakMap<Map<string, string[]>, Set<string>>();
export const revertedIn = (index: Map<string, string[]>): Set<string> => revertedOnly.get(index) ?? new Set();

/** The log format that gives each commit's hash and its `Issue` trailer values, tab-separated: the one trailer reader. */
const TRAILERS = "--format=%H%x09%(trailers:key=Issue,valueonly,separator=%x2C)";
const values = (v: string | undefined): string[] => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const revertedOn = (cwd: string, main: string): Set<string> =>
  new Set([...git(cwd, "log", main, "-E", "--grep=^This reverts commit [0-9a-f]{40}", "--format=%B").out.matchAll(/This reverts commit ([0-9a-f]{40})/g)].map((m) => m[1]));

/** Each item's `since` as the store last fetched it. */
function storedSince(key: string): (n: string) => string | undefined {
  let doc: issues.Doc | null = null;
  try { doc = readFetched({ key }); } catch {}
  return (n) => {
    const v = doc && issues.find(doc, n)?.fm.since;
    return v ? String(v) : undefined;
  };
}

/** Each of the repo's items that a commit on `main` names in an `Issue:` trailer, to those commits, after its `since`, less the reverted ones. */
export function landedIndex(cwd: string, main: string, key: string, since: (n: string) => string | undefined = storedSince(key)): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const rows = git(cwd, "log", main, TRAILERS).out.split("\n").filter(Boolean).map((r) => r.split("\t"));
  // The log is newest first, so a commit after `since` comes before it.
  const place = new Map(rows.map(([h], i) => [h, i]));
  const hits: [string, string][] = [];
  for (const [h, issue] of rows) {
    for (const s of new Set(values(issue))) {
      const m = s.startsWith(`${key}-`) ? /^\d+(?:\.\d+)?$/.exec(s.slice(key.length + 1)) : null;
      if (!m) continue;
      const at = since(m[0]), from = at === undefined ? undefined : place.get(at);
      if (from === undefined || place.get(h)! < from) hits.push([h, m[0]]);
    }
  }
  if (!hits.length) return out;
  revertedOnly.set(out, new Set());
  const reverted = revertedOn(cwd, main);
  for (const [h, n] of hits) if (!reverted.has(h)) out.set(n, [...(out.get(n) ?? []), h]);
  // An item whose trailer commits are all reverted: the store's done is stale for it.
  for (const [h, n] of hits) if (reverted.has(h) && !out.has(n)) revertedOnly.get(out)!.add(n);
  return out;
}

/** The short sha of a commit on origin/<main> that names the item, or null. It reads the ref as it is: the caller fetches. */
export function itemOnMain(repo: { path: string; key: string; main: string } | undefined, n: number | string | undefined): string | null {
  if (!repo || n === undefined) return null;
  const main = `origin/${repo.main}`;
  const hit = landedCommits(repo.path, main, repo.key, n)[0];
  return hit ? hit.slice(0, 7) : null;
}

/**
 * Where a job's or an item's work is on origin/<main>, or null. Each test runs when its input is given, in this order:
 * a `Job:` trailer of `job` (the full sha; `how` "Job trailer"), an `Issue:` trailer of `item` (the short sha;
 * "Issue trailer"), then, while `branch` exists and has a net change, a merge of it into main that leaves main's tree
 * as it is (the full sha of main; "content"): the work is already there, however it got there.
 * `fetch` says whether to fetch origin once first; without it the ref is read as it is.
 */
export function onMain(repo: { path: string; key: string; main: string } | undefined, o: { job?: string; item?: number | string; branch?: string; fetch: boolean }): { commit: string; how: "Job trailer" | "Issue trailer" | "content" } | null {
  if (!repo) return null;
  if (o.fetch) fetchOrigin(repo.path);
  const main = `origin/${repo.main}`;
  if (o.job) {
    const trailer = jobCommit(repo.path, repo.main, [o.job, trailerOf(o.job)]);
    if (trailer) return { commit: trailer, how: "Job trailer" };
  }
  const there = itemOnMain(repo, o.item);
  if (there) return { commit: there, how: "Issue trailer" };
  if (!o.branch) return null;
  const tip = git(repo.path, "rev-parse", "--verify", "-q", `refs/heads/${o.branch}`);
  if (!tip.ok) return null;
  const fork = git(repo.path, "merge-base", tip.out, main).out;
  const treeOf = (rev: string) => git(repo.path, "rev-parse", `${rev}^{tree}`).out;
  if (!fork || treeOf(tip.out) === treeOf(fork)) return null;
  const merged = git(repo.path, "merge-tree", "--write-tree", main, tip.out);
  if (merged.ok && merged.out.split("\n")[0] === treeOf(main)) return { commit: git(repo.path, "rev-parse", main).out, how: "content" };
  return null;
}

/** The items of `ns` that the facts hold, with the stage() context for them: one `landedIndex` for all. */
export function stages(cwd: string, main: string, f: Facts, refs: (number | string)[], landed: Map<string, string[]> = landedIndex(cwd, main, f.repo, (n) => f.items[n]?.since)): Stage[] {
  const num = (ref: string) => (ref.startsWith(`${f.repo}-`) && /^\d+(\.\d+)?$/.test(ref.slice(f.repo.length + 1)) ? ref.slice(f.repo.length + 1) : undefined);
  const ctx: Ctx = {
    landed, reverted: revertedIn(landed), sandbox: f.sandbox,
    item: (ref) => f.items[num(ref) ?? ""],
    runs: (ref) => f.runs[num(ref) ?? ""] ?? [],
  };
  return refs.map(String).filter((n) => f.items[n] !== undefined).map((n) => stage(f.items[n], ctx));
}

/**
 * The stages of `items` (all the repo's items when omitted), from the repo's
 * origin/<main>. `fetch` says whether to fetch origin first; `doc` is the
 * list when the caller has read it already. Items the store lacks are left
 * out. It throws when the store cannot be read.
 */
export function repoStages(repo: Repo, opts: { fetch: boolean; doc?: issues.Doc | null; items?: (number | string)[] }): Stage[] {
  if (opts.fetch) fetchOrigin(repo.path);
  const f = facts(repo, opts.doc);
  return stages(repo.path, `refs/remotes/origin/${f.main}`, f, opts.items ?? Object.keys(f.items));
}

const DAY_MS = 24 * 3600_000;
const RECENT_DAYS = 7;

/** The indices of the repos with a ledger run or an item update in the last week, the latest first. `docs[n]` is `repos[n]`'s list. */
export function recentRepos(repos: Repo[], docs: (issues.Doc | null)[]): number[] {
  const since = Date.now() - RECENT_DAYS * DAY_MS;
  const last = new Map<string, number>();
  const seen = (k: string, t: number) => { if (t >= since && t > (last.get(k) ?? 0)) last.set(k, t); };
  for (const e of allRuns()) if (e.run.repo) seen(e.run.repo, Date.parse(e.run.started));
  repos.forEach((r, n) => { for (const i of docs[n]?.items ?? []) if (i.fm.updated_time) seen(r.key, Date.parse(String(i.fm.updated_time))); });
  return repos.map((_, n) => n).filter((n) => last.has(repos[n].key)).sort((a, b) => last.get(repos[b].key)! - last.get(repos[a].key)!);
}
