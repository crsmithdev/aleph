/**
 * The work store holds every registry repo's issues, one file each, in a
 * git repo of its own at $ALEPH_ITEMS or ~/.aleph/items. A repo's items are
 * `<repo>/backlog/tasks/<repo>-<n>.md`, a Backlog.md project, so `backlog
 * browser` in `<repo>/` shows them as a board. A read fetches and reads
 * origin/main; a write is one commit on origin/main, made without a working
 * tree, and the store's checkout follows. No product repo's main moves when
 * an item changes, and no branch of a product repo can edit its own item.
 */
import { fetchOrigin, followMain, git, treeWithFiles } from "../../jobs/lib/git.ts";
import { expand } from "../../jobs/lib/ledger.ts";
import { parseItem, renderItem, type Doc } from "./todo.ts";

export interface Place { key: string }

const MAIN = "main";
const ATTEMPTS = 5;

export const storeDir = (): string => expand(process.env.ALEPH_ITEMS ?? "~/.aleph/items");
const tasksDir = (key: string): string => `${key}/backlog/tasks`;
export const configPath = (key: string): string => `${key}/backlog/config.yml`;
export const itemPath = (key: string, id: number): string => `${tasksDir(key)}/${key}-${id}.md`;

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

/** Fetch origin/main, unless this process fetched the store less than `reuse` seconds ago. */
function fetch(dir: string): void {
  const last = fetchedAt.get(dir);
  if (reuse > 0 && last !== undefined && Date.now() - last < reuse * 1000) return;
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
