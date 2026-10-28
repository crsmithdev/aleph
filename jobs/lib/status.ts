/**
 * Item state, derived (seed milestone 2): from the `Item:` trailers on
 * origin/<main>, the work store and the ledger. The precedence is dropped,
 * done, needs-you, stuck, running, open. Nothing writes it back to the store.
 *
 * A factory run's bundle carries the store and ledger facts as a snapshot
 * commit at refs/aleph/facts, so `aleph status` inside the sandbox gives the
 * same answer as Chris's session from the same bundle.
 */
import { readList } from "../../todo/lib/store.ts";
import * as todos from "../../todo/lib/todo.ts";
import { git, gitWith } from "./git.ts";
import { allJobs, isOpen, type Repo, type State } from "./ledger.ts";

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

export function facts(repo: Repo): Facts {
  const doc = readList(repo);
  const store: Record<string, string> = {};
  for (const i of doc?.items ?? []) store[i.id] = todos.status(i);
  const open: Record<string, State> = {};
  const touched = new Set<number>();
  for (const runs of allJobs()) {
    const item = runs.findLast((e) => e.run.todo !== undefined)?.run.todo;
    if (item === undefined || runs[0].run.repo !== repo.key) continue;
    if (repo.sandbox) touched.add(item);
    if (isOpen(runs)) open[item] = runs.at(-1)!.run.state;
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
  const want = `${key}-${n}`;
  const rows = git(cwd, "log", main, "--format=%H%x09%(trailers:key=Item,valueonly,separator=%x2C)").out.split("\n").filter(Boolean);
  const hits = rows.map((r) => r.split("\t")).filter(([, v]) => (v ?? "").split(",").map((s) => s.trim()).includes(want)).map(([h]) => h);
  if (!hits.length) return [];
  const reverted = new Set([...git(cwd, "log", main, "-E", "--grep=^This reverts commit [0-9a-f]{40}", "--format=%B").out.matchAll(/This reverts commit ([0-9a-f]{40})/g)].map((m) => m[1]));
  return hits.filter((h) => !reverted.has(h));
}

/** The short sha of a commit on origin/<main> that names the item, or null. It reads the ref as it is: the caller fetches. */
export function itemOnMain(repo: { path: string; key: string; main: string } | undefined, n: number | undefined): string | null {
  if (!repo || n === undefined) return null;
  const hit = landedCommits(repo.path, `origin/${repo.main}`, repo.key, n)[0];
  return hit ? hit.slice(0, 7) : null;
}

export interface ItemState { item: string; state: "dropped" | "done" | "needs-you" | "stuck" | "running" | "open"; why: string }

/** One item's state, from the repo at `cwd`, its main ref and the facts. */
export function derive(cwd: string, main: string, f: Facts, n: number): ItemState | null {
  const item = `${f.repo}-${n}`;
  const store = f.store[n];
  if (store === undefined) return null;
  if (store === "dropped") return { item, state: "dropped", why: "the store says dropped" };
  const landed = landedCommits(cwd, main, f.repo, n);
  if (landed.length) return { item, state: "done", why: `commit ${landed[0].slice(0, 7)} on ${main.replace(/^refs\/remotes\//, "")}` };
  // An item done before the trailers, or by hand, keeps the store's done; a factory item needs its trailer.
  if (store === "done" && !f.touched.includes(n)) return { item, state: "done", why: "the store says done" };
  const run = f.open[n];
  if (run === "needs-you") return { item, state: "needs-you", why: "its job needs Chris" };
  if (run === "stuck" || run === "failed") return { item, state: "stuck", why: `its job is ${run}` };
  if (run === "running" || run === "passed") return { item, state: "running", why: `its job is ${run}` };
  return { item, state: "open", why: "no commit on main names it" };
}
