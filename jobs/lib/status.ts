/**
 * Item stage (seed milestone 2): stage() over the `Issue:` and `Goal:` trailers (and the legacy `Item:`) on
 * origin/<main>, the work store and the ledger. Nothing writes it back to the store.
 *
 * A factory run's bundle carries the store and ledger facts as a snapshot
 * commit at refs/aleph/facts, so `aleph status` inside the sandbox gives the
 * same answer as Chris's session from the same bundle.
 */
import { afterReopen } from "./acceptance.ts";
import { readList } from "../../todo/lib/store.ts";
import * as todos from "../../todo/lib/todo.ts";
import { fetchOrigin, git, gitWith } from "./git.ts";
import { allRuns, type Repo, type State } from "./ledger.ts";
import { allJobs, isOpen, issue, stateOf } from "./job.ts";
import { runViewOf, stage, subjectOf, type Ctx, type RunView, type Stage, type Subject } from "./stage.ts";

export const FACTS_REF = "refs/aleph/facts";

/** What the store and the ledger say about a repo's items: what stage() needs of each. */
export interface Facts {
  repo: string; main: string;
  /** Item number to its status, kind, after, goals and ask kind. */
  items: Record<string, Subject>;
  /** Item number to its jobs, each as its last run: the open run state is in there. */
  runs: Record<string, RunView[]>;
  /** Item number to the state of its open job's latest run. */
  open: Record<string, State>;
  /** Items that a run of the factory has worked on. */
  touched: number[];
}

/** `doc` is the repo's list when the caller has read it already. */
export function facts(repo: Repo, doc: todos.Doc | null = readList(repo)): Facts {
  const items: Record<string, Subject> = {};
  for (const i of doc?.items ?? []) items[todos.refOf(i)] = subjectOf(i, repo.key);
  const runs: Record<string, RunView[]> = {};
  const open: Record<string, State> = {};
  const touched = new Set<number>();
  for (const job of allJobs()) {
    const item = issue(job);
    if (item === undefined || job[0].run.repo !== repo.key) continue;
    // A triage run marks its item in the store, and a planner run files children and does not land:
    // neither is a factory run working on the item, so a goal they close in the store is done.
    if (typeof item === "number" && repo.sandbox && job.some((e) => e.run.kind !== "triage" && e.run.kind !== "plan")) touched.add(item);
    (runs[item] ??= []).push(runViewOf(job));
    if (isOpen(job)) open[item] = stateOf(job);
  }
  return { repo: repo.key, main: repo.main, items, runs, open, touched: [...touched].sort((a, b) => a - b) };
}

/** A commit with no parent whose tree holds facts.json, at refs/aleph/facts. Returns the ref. */
export function writeFacts(repo: Repo): string {
  const blob = gitWith({ stdin: JSON.stringify(facts(repo), null, 2) + "\n" }, repo.path, "hash-object", "-w", "--stdin").out;
  const tree = gitWith({ stdin: `100644 blob ${blob}\tfacts.json\n` }, repo.path, "mktree").out;
  const commit = gitWith({ env: { GIT_AUTHOR_NAME: "aleph", GIT_AUTHOR_EMAIL: "aleph@aleph.invalid", GIT_COMMITTER_NAME: "aleph", GIT_COMMITTER_EMAIL: "aleph@aleph.invalid" } },
    repo.path, "commit-tree", tree, "-m", "facts").out;
  git(repo.path, "update-ref", FACTS_REF, commit);
  return FACTS_REF;
}

/** The facts in a repo's snapshot ref, or null. */
export function readFacts(cwd: string): Facts | null {
  const r = git(cwd, "show", `${FACTS_REF}:facts.json`);
  try { return r.ok ? JSON.parse(r.out) : null; } catch { return null; }
}

/**
 * The commits on `main` whose trailer block holds `Issue: <key>-<n>` (or the legacy `Item:`) and that
 * no later commit reverts. Only trailer lines count: a subject or a body line
 * that says `Issue:` does not. A commit that also names a goal (`Goal:`) lands that goal, not the whole issue.
 */
export function landedCommits(cwd: string, main: string, key: string, n: number): string[] {
  return landedIndex(cwd, main, key).get(n) ?? [];
}

/** For a `landedIndex` result, the items with a trailer commit on main that a later commit reverts and none that is not reverted. */
const revertedOnly = new WeakMap<Map<number, string[]>, Set<number>>();
export const revertedIn = (index: Map<number, string[]>): Set<number> => revertedOnly.get(index) ?? new Set();

/** The log format that gives each commit's hash and its `Item`, `Issue` and `Goal` trailer values, tab-separated: the one trailer reader (`Item:` is the legacy key). */
const TRAILERS = "--format=%H%x09%(trailers:key=Item,valueonly,separator=%x2C)%x09%(trailers:key=Issue,valueonly,separator=%x2C)%x09%(trailers:key=Goal,valueonly,separator=%x2C)";
const values = (v: string | undefined): string[] => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/** Each of the repo's items that a commit on `main` names in an `Issue:` or `Item:` trailer (`Goal:` names a goal), to those commits, less the reverted ones: two git calls for every item. */
export function landedIndex(cwd: string, main: string, key: string): Map<number, string[]> {
  const out = new Map<number, string[]>();
  const rows = git(cwd, "log", main, TRAILERS).out.split("\n").filter(Boolean);
  const hits: [string, number][] = [];
  for (const [h, item, issue, goal] of rows.map((r) => r.split("\t"))) {
    // The commit of a goal names its issue too: it lands the goal, and the issue is done when its goals are.
    for (const s of new Set([...values(item), ...values(goal), ...(values(goal).length ? [] : values(issue))])) {
      const m = s.startsWith(`${key}-`) ? /^\d+$/.exec(s.slice(key.length + 1)) : null;
      if (m) hits.push([h, Number(m[0])]);
    }
  }
  if (!hits.length) return out;
  revertedOnly.set(out, new Set());
  const reverted = new Set([...git(cwd, "log", main, "-E", "--grep=^This reverts commit [0-9a-f]{40}", "--format=%B").out.matchAll(/This reverts commit ([0-9a-f]{40})/g)].map((m) => m[1]));
  for (const [h, n] of hits) if (!reverted.has(h)) out.set(n, [...(out.get(n) ?? []), h]);
  // An item whose trailer commits are all reverted: the store's done is stale for it.
  for (const [h, n] of hits) if (reverted.has(h) && !out.has(n)) revertedOnly.get(out)!.add(n);
  // A goal the acceptance run reopened is done again only by a commit after the reopening.
  for (const [n, hs] of out) {
    const later = afterReopen(cwd, key, n, hs);
    if (later.length) out.set(n, later); else out.delete(n);
  }
  return out;
}

/** The short sha of a commit on `main` whose `Goal:` (or legacy `Item:`) trailer names the goal `ref` (`<repo>-<n>.<m>`) and that no later commit reverts, or null. */
function dottedOnMain(cwd: string, main: string, ref: string): string | null {
  const rows = git(cwd, "log", main, TRAILERS).out.split("\n").filter(Boolean);
  const hits = rows.map((r) => r.split("\t")).filter(([, item, , goal]) => [...values(item), ...values(goal)].includes(ref)).map(([h]) => h);
  if (!hits.length) return null;
  const reverted = new Set([...git(cwd, "log", main, "-E", "--grep=^This reverts commit [0-9a-f]{40}", "--format=%B").out.matchAll(/This reverts commit ([0-9a-f]{40})/g)].map((m) => m[1]));
  const hit = hits.find((h) => !reverted.has(h));
  return hit ? hit.slice(0, 7) : null;
}

/** The short sha of a commit on origin/<main> that names the item, or null. It reads the ref as it is: the caller fetches. */
export function itemOnMain(repo: { path: string; key: string; main: string } | undefined, n: number | string | undefined): string | null {
  if (!repo || n === undefined) return null;
  if (typeof n === "string") return dottedOnMain(repo.path, `origin/${repo.main}`, `${repo.key}-${n}`);
  const hit = landedCommits(repo.path, `origin/${repo.main}`, repo.key, n)[0];
  return hit ? hit.slice(0, 7) : null;
}

/** The items of `ns` that the facts hold, with the stage() context for them: one `landedIndex` for all. */
export function stages(cwd: string, main: string, f: Facts, refs: (number | string)[], landed: Map<number, string[]> = landedIndex(cwd, main, f.repo)): Stage[] {
  const num = (ref: string) => (ref.startsWith(`${f.repo}-`) && /^\d+(\.\d+)?$/.test(ref.slice(f.repo.length + 1)) ? ref.slice(f.repo.length + 1) : undefined);
  const ctx: Ctx = {
    main, landed, reverted: revertedIn(landed),
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
export function repoStages(repo: Repo, opts: { fetch: boolean; doc?: todos.Doc | null; items?: (number | string)[] }): Stage[] {
  if (opts.fetch) fetchOrigin(repo.path);
  const f = facts(repo, opts.doc);
  return stages(repo.path, `refs/remotes/origin/${f.main}`, f, opts.items ?? Object.keys(f.items).filter((k) => !k.includes(".")).map(Number));
}

const DAY_MS = 24 * 3600_000;
const RECENT_DAYS = 7;

/** The indices of the repos with a ledger run or an item update in the last week, the latest first. `docs[n]` is `repos[n]`'s list. */
export function recentRepos(repos: Repo[], docs: (todos.Doc | null)[]): number[] {
  const since = Date.now() - RECENT_DAYS * DAY_MS;
  const last = new Map<string, number>();
  const seen = (k: string, t: number) => { if (t >= since && t > (last.get(k) ?? 0)) last.set(k, t); };
  for (const e of allRuns()) if (e.run.repo) seen(e.run.repo, Date.parse(e.run.started));
  repos.forEach((r, n) => { for (const i of docs[n]?.items ?? []) if (i.fm.updated) seen(r.key, Date.parse(String(i.fm.updated))); });
  return repos.map((_, n) => n).filter((n) => last.has(repos[n].key)).sort((a, b) => last.get(repos[b].key)! - last.get(repos[a].key)!);
}
