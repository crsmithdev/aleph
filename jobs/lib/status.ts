/**
 * Item state, derived (seed milestone 2): from the `Item:` trailers on
 * origin/<main>, the work store and the ledger. The precedence is dropped,
 * done, needs-you, stuck, running, open. Nothing writes it back to the store.
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

export const FACTS_REF = "refs/aleph/facts";

/** What the store and the ledger say about a repo's items. */
export interface Facts {
  repo: string; main: string;
  /** Item number to the store's status. */
  store: Record<string, string>;
  /** Item number to the state of its open job's latest run. */
  open: Record<string, State>;
  /** Items that a run of the factory has worked on. */
  touched: number[];
}

/** `doc` is the repo's list when the caller has read it already. */
export function facts(repo: Repo, doc: todos.Doc | null = readList(repo)): Facts {
  const store: Record<string, string> = {};
  for (const i of doc?.items ?? []) store[i.id] = todos.status(i);
  const open: Record<string, State> = {};
  const touched = new Set<number>();
  for (const runs of allJobs()) {
    const item = issue(runs);
    if (item === undefined || runs[0].run.repo !== repo.key) continue;
    // A triage run marks its item in the store, and a planner run files children and does not land:
    // neither is a factory run working on the item, so a goal they close in the store is done.
    if (repo.sandbox && runs.some((e) => e.run.kind !== "triage" && e.run.kind !== "plan")) touched.add(item);
    if (isOpen(runs)) open[item] = stateOf(runs);
  }
  return { repo: repo.key, main: repo.main, store, open, touched: [...touched].sort((a, b) => a - b) };
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
 * The commits on `main` whose trailer block holds `Item: <key>-<n>` and that
 * no later commit reverts. Only trailer lines count: a subject or a body line
 * that says `Item:` does not.
 */
export function landedCommits(cwd: string, main: string, key: string, n: number): string[] {
  return landedIndex(cwd, main, key).get(n) ?? [];
}

/** Each of the repo's items that a commit on `main` names in an `Item:` trailer, to those commits, less the reverted ones: two git calls for every item. */
export function landedIndex(cwd: string, main: string, key: string): Map<number, string[]> {
  const out = new Map<number, string[]>();
  const rows = git(cwd, "log", main, "--format=%H%x09%(trailers:key=Item,valueonly,separator=%x2C)").out.split("\n").filter(Boolean);
  const hits: [string, number][] = [];
  for (const [h, v] of rows.map((r) => r.split("\t"))) {
    for (const s of new Set((v ?? "").split(",").map((s) => s.trim()))) {
      const m = s.startsWith(`${key}-`) ? /^\d+$/.exec(s.slice(key.length + 1)) : null;
      if (m) hits.push([h, Number(m[0])]);
    }
  }
  if (!hits.length) return out;
  const reverted = new Set([...git(cwd, "log", main, "-E", "--grep=^This reverts commit [0-9a-f]{40}", "--format=%B").out.matchAll(/This reverts commit ([0-9a-f]{40})/g)].map((m) => m[1]));
  for (const [h, n] of hits) if (!reverted.has(h)) out.set(n, [...(out.get(n) ?? []), h]);
  // A goal the acceptance run reopened is done again only by a commit after the reopening.
  for (const [n, hs] of out) {
    const later = afterReopen(cwd, key, n, hs);
    if (later.length) out.set(n, later); else out.delete(n);
  }
  return out;
}

/** The short sha of a commit on origin/<main> that names the item, or null. It reads the ref as it is: the caller fetches. */
export function itemOnMain(repo: { path: string; key: string; main: string } | undefined, n: number | undefined): string | null {
  if (!repo || n === undefined) return null;
  const hit = landedCommits(repo.path, `origin/${repo.main}`, repo.key, n)[0];
  return hit ? hit.slice(0, 7) : null;
}

export interface ItemState { item: string; state: "dropped" | "done" | "needs-you" | "stuck" | "running" | "open"; why: string }

/** One item's state, from the repo at `cwd`, its main ref and the facts. `landed` is `landedIndex` of the same, when the caller derives many items. */
export function derive(cwd: string, main: string, f: Facts, n: number, landed?: Map<number, string[]>): ItemState | null {
  const item = `${f.repo}-${n}`;
  const store = f.store[n];
  if (store === undefined) return null;
  if (store === "dropped") return { item, state: "dropped", why: "the store says dropped" };
  const hits = landed ? landed.get(n) ?? [] : landedCommits(cwd, main, f.repo, n);
  if (hits.length) return { item, state: "done", why: `commit ${hits[0].slice(0, 7)} on ${main.replace(/^refs\/remotes\//, "")}` };
  // An item done before the trailers, or by hand, keeps the store's done; a factory item needs its trailer.
  if (store === "done" && !f.touched.includes(n)) return { item, state: "done", why: "the store says done" };
  const run = f.open[n];
  if (run === "needs-you") return { item, state: "needs-you", why: "its job needs Chris" };
  if (run === "stuck" || run === "failed") return { item, state: "stuck", why: `its job is ${run}` };
  if (run === "running" || run === "passed") return { item, state: "running", why: `its job is ${run}` };
  return { item, state: "open", why: "no commit on main names it" };
}

/**
 * The states of `items` (all the repo's items when omitted), from the repo's
 * origin/<main>. `fetch` says whether to fetch origin first; `doc` is the
 * list when the caller has read it already. Items the store lacks are left
 * out. It throws when the store cannot be read.
 */
export function itemStates(repo: Repo, opts: { fetch: boolean; doc?: todos.Doc | null; items?: number[] }): ItemState[] {
  if (opts.fetch) fetchOrigin(repo.path);
  const f = facts(repo, opts.doc);
  const main = `refs/remotes/origin/${f.main}`;
  const ids = opts.items ?? Object.keys(f.store).map(Number);
  const landed = ids.length > 1 ? landedIndex(repo.path, main, repo.key) : undefined;
  const states: ItemState[] = [];
  for (const n of ids) { const s = derive(repo.path, main, f, n, landed); if (s) states.push(s); }
  return states;
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
