/**
 * The work store holds every registry repo's issues, one file each, in a
 * git repo of its own at $ALEPH_ITEMS or ~/.aleph/items. A repo's items are
 * `<repo>/backlog/tasks/<repo>-<n>.md`, a Backlog.md project, so `backlog
 * browser` in `<repo>/` shows them as a board. A read fetches and reads
 * origin/main; a write is one commit on origin/main, made without a working
 * tree, and the store's checkout follows. No product repo's main moves when
 * an item changes, and no branch of a product repo can edit its own item.
 *
 * It is the Issues module: the label predicates (`isGoal`, `isSorted`,
 * `needsChris`), one read of a repo's list (`reader`), and the named writes
 * (`note`, `close`, `label`, `closeAndFile`, `file`). Callers do not read
 * `fm.labels` or name a task's path.
 */
import { fetchOrigin, followMain, git, treeWithFiles } from "../../jobs/lib/git.ts";
import { expand } from "../../jobs/lib/ledger.ts";
import { writeDecision, type Decision } from "../../jobs/lib/decision.ts";
import * as todos from "./todo.ts";
import { labels, parseItem, renderItem, status, type Doc, type Item } from "./todo.ts";

export { labels };

export interface Place { key: string }

const MAIN = "main";
const ATTEMPTS = 5;

export const storeDir = (): string => expand(process.env.ALEPH_ITEMS ?? "~/.aleph/items");
const tasksDir = (key: string): string => `${key}/backlog/tasks`;
const configPath = (key: string): string => `${key}/backlog/config.yml`;
const itemPath = (key: string, id: number): string => `${tasksDir(key)}/${key}-${id}.md`;

/**
 * The Backlog.md project file for a repo: its statuses are aleph's, and
 * Backlog.md never commits. It is in the full form Backlog.md 1.55.3 writes
 * back when it loads a config, so opening the board leaves the checkout clean.
 */
export const config = (key: string): string => [
  `project_name: "${key}"`, `default_status: "open"`, `statuses: ["open", "done", "dropped"]`, `labels: []`, `date_format: yyyy-mm-dd`,
  `max_column_width: 80`, `auto_open_browser: true`, `default_port: 6420`, `remote_operations: false`, `auto_commit: false`,
  `bypass_git_hooks: false`, `check_active_branches: false`, `active_branch_days: 30`, `task_prefix: "${key}"`, "",
].join("\n");

const fetchedAt = new Map<string, number>();

/** Seconds the UI reuses a fetch of the work store ($ALEPH_UI_FETCH_TTL, default 30). */
export function uiFetchTtl(): number {
  const n = Number(process.env.ALEPH_UI_FETCH_TTL ?? 30);
  return Number.isFinite(n) && n >= 0 ? n : 30;
}

let reuse = 0;

/** Reuse a fetch of the store for `seconds` in this process. Only the UI server turns it on; the CLI always fetches. */
export function cacheFetches(seconds: number): void { reuse = seconds; }

/**
 * Fetch origin/main, unless this process fetched the store less than `reuse` seconds ago.
 * With `reuse` on, only the first fetch waits: a later one runs in the background and
 * this read uses the refs of the last fetch, so no UI request waits on the network.
 */
function fetch(dir: string): void {
  const last = fetchedAt.get(dir);
  if (reuse > 0 && last !== undefined && Date.now() - last < reuse * 1000) return;
  if (reuse > 0 && last !== undefined) {
    fetchedAt.set(dir, Date.now());
    Bun.spawn(["git", "fetch", "-q", "origin", MAIN], { cwd: dir, env: process.env, stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    return;
  }
  // Every aleph process reads the store, so two fetches at once race on the ref's lock: fetchOrigin retries that.
  const r = fetchOrigin(dir, MAIN);
  if (!r.ok) throw new Error(`work store fetch failed: ${r.out}`);
  fetchedAt.set(dir, Date.now());
}

/** The contents of each `rev:path`, in one `git cat-file --batch`. */
function readFiles(dir: string, specs: string[]): string[] {
  if (!specs.length) return [];
  const p = Bun.spawnSync(["git", "cat-file", "--batch"], { cwd: dir, stdin: new Blob([specs.join("\n") + "\n"]), stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`cat-file: ${p.stderr.toString()}`);
  const buf = p.stdout;
  const out: string[] = [];
  let at = 0;
  for (const _ of specs) {
    const nl = buf.indexOf(10, at);
    const size = Number(buf.subarray(at, nl).toString().split(" ")[2]);
    out.push(buf.subarray(nl + 1, nl + 1 + size).toString());
    at = nl + 1 + size + 1;
  }
  return out;
}

/** A repo's items at `rev`, in number order, or null when the store has no list for it. One ls-tree finds the config and the items. */
function load(dir: string, rev: string, key: string): Doc | null {
  const ls = git(dir, "ls-tree", "-r", "-z", "--name-only", rev, "--", configPath(key), `${tasksDir(key)}/`);
  const paths = ls.ok ? ls.out.split("\0") : [];
  if (!paths.includes(configPath(key))) return null;
  const names = paths.filter((p) => p.startsWith(`${tasksDir(key)}/`) && p.endsWith(".md") && !p.slice(tasksDir(key).length + 1).includes("/"));
  const items = readFiles(dir, names.map((p) => `${rev}:${p}`)).map(parseItem);
  return { head: "", items: items.sort((a, b) => a.id - b.id) };
}

/** The repo's list on the store's origin/main, or null when the store has none. */
export function readList(repo: Place): Doc | null {
  const dir = storeDir();
  fetch(dir);
  return load(dir, `origin/${MAIN}`, repo.key);
}

/** The repo's list on the store's origin/main as last fetched, with no fetch; null when the store has none. */
export function readFetched(repo: Place): Doc | null {
  return load(storeDir(), `origin/${MAIN}`, repo.key);
}

/** Each repo's list on the store's origin/main, after one fetch; null when the store has none. */
export function readLists(repos: Place[]): (Doc | null)[] {
  const dir = storeDir();
  fetch(dir);
  return repos.map((r) => load(dir, `origin/${MAIN}`, r.key));
}

/**
 * Apply `change` to the repo's list on the store's origin/main and push it as
 * one commit. When the push is refused because main moved, fetch and apply
 * `change` again. `change` returns null to write nothing. A repo the store
 * has no list for starts blank only when `create` is set.
 */
export function writeList<T>(repo: Place, message: string, change: (doc: Doc) => T | null, create = false): { value: T; commit: string; follow: string | null } | null {
  const dir = storeDir();
  for (let attempt = 1; ; attempt++) {
    fetch(dir);
    const base = git(dir, "rev-parse", `origin/${MAIN}`).out;
    const found = load(dir, base, repo.key);
    if (found === null && !create) throw new Error(`the work store has no list for ${repo.key}`);
    const doc = found ?? { head: "", items: [] };
    const before = new Map(doc.items.map((i) => [i.id, renderItem(repo.key, i)]));
    const value = change(doc);
    if (value === null) return null;
    const files: Record<string, string> = found === null ? { [configPath(repo.key)]: config(repo.key) } : {};
    for (const item of doc.items) {
      const text = renderItem(repo.key, item);
      if (before.get(item.id) !== text) files[itemPath(repo.key, item.id)] = text;
    }
    const tree = treeWithFiles(dir, `${base}^{tree}`, files);
    const commit = git(dir, "commit-tree", tree, "-p", base, "-m", `${repo.key}: ${message}`);
    if (!commit.ok) throw new Error(`commit-tree failed: ${commit.out}`);
    const push = git(dir, "push", "-q", "origin", `${commit.out}:refs/heads/${MAIN}`);
    if (push.ok) return { value, commit: commit.out, follow: followMain(dir, MAIN) };
    if (attempt === ATTEMPTS) throw new Error(`push refused ${ATTEMPTS} times: ${push.out}`);
  }
}

const hiddenDir = (key: string, id: number): string => `${key}/hidden/${id}`;

/** An item's hidden check files on the store's origin/main, by file name; empty when it has none. */
export function readHidden(repo: Place, id: number): Record<string, string> {
  const dir = storeDir();
  fetch(dir);
  const ls = git(dir, "ls-tree", "--name-only", `origin/${MAIN}:${hiddenDir(repo.key, id)}`);
  const names = ls.ok ? ls.out.split("\n").filter(Boolean) : [];
  const texts = readFiles(dir, names.map((n) => `origin/${MAIN}:${hiddenDir(repo.key, id)}/${n}`));
  return Object.fromEntries(names.map((n, i) => [n, texts[i]]));
}

/** Put `files` (by file name) in an item's hidden checks as one commit on the store's origin/main. */
export function writeHidden(repo: Place, id: number, files: Record<string, string>): { commit: string; follow: string | null } {
  const dir = storeDir();
  for (let attempt = 1; ; attempt++) {
    fetch(dir);
    const base = git(dir, "rev-parse", `origin/${MAIN}`).out;
    const put = Object.fromEntries(Object.entries(files).map(([n, text]) => [`${hiddenDir(repo.key, id)}/${n}`, text]));
    const tree = treeWithFiles(dir, `${base}^{tree}`, put);
    const commit = git(dir, "commit-tree", tree, "-p", base, "-m", `${repo.key}: hidden checks for item ${id}`);
    if (!commit.ok) throw new Error(`commit-tree failed: ${commit.out}`);
    const push = git(dir, "push", "-q", "origin", `${commit.out}:refs/heads/${MAIN}`);
    if (push.ok) return { commit: commit.out, follow: followMain(dir, MAIN) };
    if (attempt === ATTEMPTS) throw new Error(`push refused ${ATTEMPTS} times: ${push.out}`);
  }
}

let timesAt: { rev: string; times: Map<string, { added: number; changed: number }> } | null = null;

/**
 * When each item was first and last committed on the store's origin/main as
 * last fetched, by `<repo>-<n>`, in ms. One `git log`, reused while origin/main stays put.
 */
export function itemTimes(): Map<string, { added: number; changed: number }> {
  const dir = storeDir();
  const head = git(dir, "rev-parse", `origin/${MAIN}`);
  if (head.ok && timesAt?.rev === head.out) return timesAt.times;
  const out = new Map<string, { added: number; changed: number }>();
  const p = Bun.spawnSync(["git", "-C", dir, "log", head.ok ? head.out : `origin/${MAIN}`, "--format=%ct", "--name-only"], { stdout: "pipe", stderr: "ignore" });
  if (p.exitCode !== 0) return out;
  let ct = 0;
  for (const line of p.stdout.toString().split("\n")) {
    if (!line) continue;
    if (/^\d+$/.test(line)) { ct = Number(line) * 1000; continue; }
    const m = /^([^/]+)\/backlog\/tasks\/\1-(\d+)\.md$/.exec(line);
    if (!m) continue;
    const ref = `${m[1]}-${m[2]}`;
    const t = out.get(ref);
    if (t) t.added = ct; else out.set(ref, { added: ct, changed: ct });
  }
  if (head.ok) timesAt = { rev: head.out, times: out };
  return out;
}

// The labels.

export const GOAL = "goal";
export const NEEDS_CHRIS = "needs-chris";
/**
 * Labels that mark an issue as sorted: triage skips it, and the UI does not
 * count it as new. One set for both. `live-check` is in it: triage labels a
 * live check `live-check` and `triaged` together, and an issue labelled
 * `live-check` by hand is a check the sandbox cannot reach either.
 */
export const SORTED: readonly string[] = [GOAL, NEEDS_CHRIS, "triaged", "live-check", "proposal"];

export const hasLabel = (item: Item, label: string): boolean => labels(item).includes(label);
/** An open item labelled `goal`: a factory run's work. */
export const isGoal = (item: Item): boolean => status(item) === "open" && hasLabel(item, GOAL);
/** An item with a label of SORTED: triage leaves it alone. */
export const isSorted = (item: Item): boolean => labels(item).some((l) => SORTED.includes(l));
/** An item labelled `needs-chris`: it waits for Chris's answer. */
export const needsChris = (item: Item): boolean => hasLabel(item, NEEDS_CHRIS);

/** Add the labels `add` the item lacks and take out `remove`, as one edit; no edit when nothing changes. */
export function label(item: Item, add: string[], remove: string[] = []): void {
  const had = labels(item);
  const next = [...new Set([...had, ...add])].filter((l) => !remove.includes(l));
  if (next.join("\0") !== had.join("\0")) todos.edit(item, { labels: next });
}

// The read.

/** Lists by repo key, each read from the store once for the reader's life. */
export interface Reader {
  /** The repo's list, or null when the store has none or cannot be read. */
  list(key: string): Doc | null;
  /** Item `id` of the repo's list, or undefined. */
  item(key: string, id: number): Item | undefined;
}

/** A reader of the store's lists; `fetch: false` reads origin/main as last fetched. */
export function reader(o: { fetch?: boolean } = {}): Reader {
  const lists = new Map<string, Doc | null>();
  const list = (key: string): Doc | null => {
    if (!lists.has(key)) {
      let doc: Doc | null = null;
      try { doc = o.fetch === false ? readFetched({ key }) : readList({ key }); } catch {}
      lists.set(key, doc);
    }
    return lists.get(key)!;
  };
  return { list, item: (key, id) => list(key)?.items.find((i) => i.id === id) };
}

/** The open goals of each repo, in repo then number order. A repo whose list cannot be read has none. */
export function goals<R extends Place>(repos: R[]): { repo: R; item: Item }[] {
  const lists = reader();
  return repos.flatMap((repo) => (lists.list(repo.key)?.items ?? []).filter(isGoal).map((item) => ({ repo, item })));
}

/**
 * Item `id` as the store has it now, or null when it is not an open goal: it
 * may have been closed, had its `goal` label removed, or had a note added
 * since the list was read. A store that cannot be read counts as not a goal.
 */
export function goal(repo: Place, id: number): Item | null {
  const item = reader().item(repo.key, id);
  return item && isGoal(item) ? item : null;
}

// The writes.

/** Why a write did not happen, from what it threw. */
const why = (e: any): string => e?.message ?? String(e);

/**
 * A note on item `id`, as one commit; with `done` the item is done too, with
 * `label` it gains that label, with `decision` it carries that decision.
 * Returns why it could not, or null.
 */
export function note(repo: Place, id: number, text: string, opts: { done?: boolean; label?: string; unlabel?: string; decision?: Decision } = {}): string | null {
  try {
    const w = writeList(repo, `todo: item ${id}: ${text}`, (doc) => {
      const item = todos.find(doc, id);
      if (!item) return null;
      if (opts.done) todos.setStatus(item, "done");
      if (opts.label || opts.unlabel) label(item, opts.label ? [opts.label] : [], opts.unlabel ? [opts.unlabel] : []);
      if (opts.decision) writeDecision(item, opts.decision);
      return todos.note(item, text);
    });
    return w ? null : `no issue ${id}`;
  } catch (e) {
    return why(e);
  }
}

/** Item `id` done, with the note `text`. Returns why it could not, or null. */
export const close = (repo: Place, id: number, text: string): string | null => note(repo, id, text, { done: true });

/**
 * Change item `id` with `change` as one commit, while it is still open and not
 * sorted: triage's write. False when the item is gone, closed or sorted.
 */
export function sort(repo: Place, id: number, message: string, change: (item: Item) => void): boolean {
  const w = writeList(repo, message, (doc) => {
    const item = todos.find(doc, id);
    if (!item || status(item) !== "open" || isSorted(item)) return null;
    change(item);
    return true;
  });
  return w?.value === true;
}

/** A new issue for `file` and `closeAndFile`. */
export interface Filing { title: string; labels: string[]; body?: string; priority?: string }

/**
 * Item `id` done with the note `text` (when `id` is given), and `filed` added,
 * as one commit; a repo the store has no list for gets one. Returns what became
 * of the item (`done`, `no issue <id>`, or the write's error) and the new numbers.
 */
export function closeAndFile(repo: Place, message: string, id: number | undefined, text: string, filed: Filing[]): { todo?: string; ids: number[] } {
  let todo: string | undefined;
  let ids: number[] = [];
  try {
    writeList(repo, message, (doc) => {
      if (id !== undefined) {
        const item = todos.find(doc, id);
        if (item) {
          todos.setStatus(item, "done");
          todos.note(item, text);
        }
        todo = item ? "done" : `no issue ${id}`;
      }
      ids = filed.map((f) => todos.add(doc, f.title, { labels: f.labels, body: f.body, priority: f.priority }).id);
      return true;
    }, true);
  } catch (e) {
    todo = why(e);
    ids = [];
  }
  return { todo, ids };
}

/** File new issues as one commit, starting the list when the store has none; their numbers. A write that fails files none. */
export const file = (repo: Place, message: string, filed: Filing[]): number[] =>
  filed.length ? closeAndFile(repo, message, undefined, "", filed).ids : [];
