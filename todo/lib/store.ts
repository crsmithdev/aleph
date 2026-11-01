/**
 * The work store holds every registry repo's issues, one file each, in a
 * git repo of its own at $ALEPH_ISSUES or ~/.aleph/issues. A repo's items are
 * `<repo>/backlog/tasks/<repo>-<n>.md`, in the layout `todo.ts` reads. A read fetches and reads
 * origin/main; a write is one commit on origin/main, made without a working
 * tree, and the store's checkout follows. No product repo's main moves when
 * an item changes, and no branch of a product repo can edit its own item.
 *
 * It is the Issues module: the predicates (`isBuildable`, `isSorted`,
 * `awaitsChris`), one read of a repo's list (`reader`), and the named writes
 * (`note`, `close`, `label`, `closeAndFile`, `file`). Callers do not read
 * `fm.labels` or name a task's path.
 */
import { fetchOrigin, followMain, git, spawnGit, treeWithFiles } from "../../jobs/lib/git.ts";
import { layout } from "../../jobs/lib/layout.ts";
import { clearAsk as clearAskFields, readAsk, writeAsk, type Ask } from "../../jobs/lib/ask.ts";
import * as issues from "./todo.ts";
import { labels, parseItem, renderItem, status, type Doc, type Floor, type Issue } from "./todo.ts";

export { labels };

export interface Place { key: string }

const MAIN = "main";
const ATTEMPTS = 5;

export const storeDir = (): string => layout().store;
const tasksDir = (key: string): string => `${key}/backlog/tasks`;
const configPath = (key: string): string => `${key}/backlog/config.yml`;
const floorPath = (key: string): string => `${key}/backlog/floor.json`;
const itemPath = (key: string, item: issues.Issue | string): string => `${tasksDir(key)}/${key}-${typeof item === "string" ? item : issues.refOf(item)}.md`;

/** The file that marks a repo as having a list in the store. */
export const config = (key: string): string => `project_name: "${key}"\ntask_prefix: "${key}"\n`;

const fetchedAt = new Map<string, number>();

/** Seconds the UI reuses a fetch of the work store ($ALEPH_UI_FETCH_TTL, default 30). */
export function uiFetchTtl(): number {
  const n = Number(process.env.ALEPH_UI_FETCH_TTL ?? 30);
  return Number.isFinite(n) && n >= 0 ? n : 30;
}

let reuse = 0;

/** Reuse a fetch of the store for `seconds` in this process. Only the UI server turns it on; the CLI always fetches. */
export function cacheFetches(seconds: number): void { reuse = seconds; }
/** The seconds set by cacheFetches: the UI passes it on to the worker that builds its state. */
export const fetchReuse = (): number => reuse;

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
    // An explicit, non-forced refspec: a write may move origin/main while this runs, and the
    // clone's forced `origin` refspec would then set it back to the remote's older value. Git refuses that here.
    Bun.spawn(["git", "fetch", "-q", "origin", `refs/heads/${MAIN}:refs/remotes/origin/${MAIN}`], { cwd: dir, env: process.env, stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    return;
  }
  fetchNow(dir);
}

/**
 * Fetch origin/main and wait for it, whatever the cache setting. Every aleph process
 * reads the store, so two fetches at once race on the ref's lock: fetchOrigin retries that.
 */
function fetchNow(dir: string): void {
  const r = fetchOrigin(dir, MAIN);
  if (!r.ok) throw new Error(`work store fetch failed: ${r.out}`);
  fetchedAt.set(dir, Date.now());
}

/** The contents of each `rev:path`, in one `git cat-file --batch`. */
function readFiles(dir: string, specs: string[]): string[] {
  if (!specs.length) return [];
  const p = spawnGit(["git", "cat-file", "--batch"], { cwd: dir, stdin: new Blob([specs.join("\n") + "\n"]), stdout: "pipe", stderr: "pipe" });
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

/**
 * The item files of a repo's list at the commit last loaded, by store and repo key: a commit never changes, so a
 * later load of the same commit reads no blob. Only the latest commit is kept for each list.
 */
const texts = new Map<string, { sha: string; files: string[] | null; floor?: Floor }>();

/** A repo's items at `rev`, in number order, or null when the store has no list for it. One ls-tree finds the config and the items. */
function load(dir: string, rev: string, key: string): Doc | null {
  // The commit `rev` names: the files of a commit loaded before are reused, and they are parsed afresh, as the caller may change the items.
  const sha = /^[0-9a-f]{40}$/.test(rev) ? rev : git(dir, "rev-parse", "--verify", "-q", `${rev}^{commit}`).out;
  const id = `${dir}\0${key}`;
  const known = /^[0-9a-f]{40}$/.test(sha), at = known ? sha : rev;
  let hit = texts.get(id);
  if (!hit || hit.sha !== sha || !known) {
    const ls = git(dir, "ls-tree", "-r", "-z", "--name-only", at, "--", configPath(key), floorPath(key), `${tasksDir(key)}/`);
    const paths = ls.ok ? ls.out.split("\0") : [];
    const names = paths.filter((p) => p.startsWith(`${tasksDir(key)}/`) && p.endsWith(".md") && !p.slice(tasksDir(key).length + 1).includes("/"));
    const floor = paths.includes(floorPath(key)) ? JSON.parse(readFiles(dir, [`${at}:${floorPath(key)}`])[0]) as Floor : undefined;
    hit = { sha, files: paths.includes(configPath(key)) ? readFiles(dir, names.map((p) => `${at}:${p}`)) : null, ...(floor ? { floor } : {}) };
    if (known) texts.set(id, hit);
  }
  if (!hit.files) return null;
  const items = hit.files.map(parseItem);
  return { repo: key, items: items.sort((a, b) => a.id - b.id || (a.sub ?? -1) - (b.sub ?? -1)), ...(hit.floor ? { floor: hit.floor } : {}) };
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
    fetchNow(dir);
    const base = git(dir, "rev-parse", `origin/${MAIN}`).out;
    const found = load(dir, base, repo.key);
    if (found === null && !create) throw new Error(`the work store has no list for ${repo.key}`);
    const doc = found ?? issues.blank(repo.key);
    const before = new Map(doc.items.map((i) => [issues.refOf(i), renderItem(repo.key, i)]));
    const value = change(doc);
    if (value === null) return null;
    const files: Record<string, string> = found === null ? { [configPath(repo.key)]: config(repo.key) } : {};
    for (const item of doc.items) {
      const text = renderItem(repo.key, item);
      if (before.get(issues.refOf(item)) !== text) files[itemPath(repo.key, item)] = text;
    }
    // Nothing changed: no commit, so the store's history holds only real writes.
    if (Object.keys(files).length === 0) return { value, commit: base, follow: null };
    const tree = treeWithFiles(dir, `${base}^{tree}`, files);
    const commit = git(dir, "commit-tree", tree, "-p", base, "-m", `${repo.key}: ${message}`);
    if (!commit.ok) throw new Error(`commit-tree failed: ${commit.out}`);
    const push = git(dir, "push", "-q", "origin", `${commit.out}:refs/heads/${MAIN}`);
    if (push.ok) {
      fetchedAt.set(dir, Date.now());
      return { value, commit: commit.out, follow: followMain(dir, MAIN) };
    }
    if (attempt === ATTEMPTS) throw new Error(`push refused ${ATTEMPTS} times: ${push.out}`);
  }
}

const hiddenDir = (key: string, id: number | string): string => `${key}/hidden/${id}`;

/** Where an item's hidden checks may be, first choice first: the goal id directory, then the old number. */
function hiddenDirs(key: string, id: number | string): string[] {
  if (typeof id === "number") return [hiddenDir(key, `${key}-${id}`), hiddenDir(key, id)];
  const n = id.startsWith(`${key}-`) ? id.slice(key.length + 1).match(/^\d+/)?.[0] : undefined;
  return n === undefined ? [hiddenDir(key, id)] : [hiddenDir(key, id), hiddenDir(key, n)];
}

/** An item's hidden check files on the store's origin/main, by file name; empty when it has none. The goal id directory wins over the old number's. */
export function readHidden(repo: Place, id: number | string): Record<string, string> {
  const dir = storeDir();
  fetch(dir);
  // A failed ls-tree also means "no such folder", so an unreadable store has to be told apart first.
  if (!git(dir, "rev-parse", "--verify", "-q", `origin/${MAIN}`).ok) throw new Error(`no origin/${MAIN} in the work store`);
  for (const where of hiddenDirs(repo.key, id)) {
    const ls = git(dir, "ls-tree", "--name-only", `origin/${MAIN}:${where}`);
    const names = ls.ok ? ls.out.split("\n").filter(Boolean) : [];
    if (!names.length) continue;
    const texts = readFiles(dir, names.map((n) => `origin/${MAIN}:${where}/${n}`));
    return Object.fromEntries(names.map((n, i) => [n, texts[i]]));
  }
  return {};
}

/** Put `files` (by file name) in an item's hidden checks as one commit on the store's origin/main. */
export function writeHidden(repo: Place, id: number | string, files: Record<string, string>): { commit: string; follow: string | null } {
  const dir = storeDir();
  for (let attempt = 1; ; attempt++) {
    fetchNow(dir);
    const base = git(dir, "rev-parse", `origin/${MAIN}`).out;
    const put = Object.fromEntries(Object.entries(files).map(([n, text]) => [`${hiddenDir(repo.key, id)}/${n}`, text]));
    const tree = treeWithFiles(dir, `${base}^{tree}`, put);
    const commit = git(dir, "commit-tree", tree, "-p", base, "-m", `${repo.key}: hidden checks for item ${id}`);
    if (!commit.ok) throw new Error(`commit-tree failed: ${commit.out}`);
    const push = git(dir, "push", "-q", "origin", `${commit.out}:refs/heads/${MAIN}`);
    if (push.ok) {
      fetchedAt.set(dir, Date.now());
      return { commit: commit.out, follow: followMain(dir, MAIN) };
    }
    if (attempt === ATTEMPTS) throw new Error(`push refused ${ATTEMPTS} times: ${push.out}`);
  }
}

// The fields.

/** Put `ask` on the item, as `askOf` reads it. */
export const setAsk = (item: Issue, ask: Ask): void => writeAsk(item, ask);
/** Take the item's Ask off. */
export const clearAsk = (item: Issue): void => clearAskFields(item);
/** An item with an `ask`: it waits for Chris, so it is never dispatched and never triaged. */
export const awaitsChris = (item: Issue): boolean => item.fm.ask !== undefined;

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);
const text = (v: unknown): string => (typeof v === "string" ? v : "");

/** Who raised the item: its `source`, else agent for a part (a part is made by the planner, never by chris) and chris for an issue. */
export function sourceOf(item: Issue): "chris" | "worker" | "deps" | "memory" | "agent" {
  const s = text(item.fm.source);
  return s === "worker" || s === "deps" || s === "memory" || s === "agent" ? s : item.sub === undefined ? "chris" : "agent";
}
/** The parts of an issue, in number order. */
export const partsOf = (doc: Doc, item: Issue): Issue[] => (item.sub === undefined ? doc.items.filter((i) => i.id === item.id && i.sub !== undefined) : []);
/** The parent of a part; undefined for a top-level issue. */
export const parentOf = (doc: Doc, item: Issue): Issue | undefined => (item.sub === undefined ? undefined : issues.find(doc, item.id));
/** Whether the issue needs a plan run, or "plan the rest" on a parent. */
export const planSet = (item: Issue): boolean => item.fm.plan === "true";
/** The flake tracker: a note log, never built. */
export const isTracker = (item: Issue): boolean => item.fm.tracker === "true";
/** An open issue a factory run can build: it has a spec, no parts and no Ask, and is neither to plan nor the tracker. */
export const isBuildable = (doc: Doc, item: Issue): boolean =>
  status(item) === "open" && !awaitsChris(item) && !!item.spec.trim() && !planSet(item) && !isTracker(item) && partsOf(doc, item).length === 0;
/** The refs an issue waits for: its `after`. */
export const afterOf = (item: Issue): string[] => list(item.fm.after);
/** The item's areas: its `areas`. */
export const areasOf = (item: Issue): string[] => list(item.fm.areas);

export type { Ask };

/** The item's ask, or null for none. */
export const askOf = (item: Issue): Ask | null => readAsk(item);

/** An item triage leaves alone: asking, a part, the tracker, to plan, or with a spec or parts. */
export const isSorted = (doc: Doc, item: Issue): boolean =>
  awaitsChris(item) || item.sub !== undefined || isTracker(item) || planSet(item) || !!item.spec.trim() || partsOf(doc, item).length > 0;

/** Add the labels `add` the item lacks and take out `remove`, as one edit; no edit when nothing changes. */
export function label(item: Issue, add: string[], remove: string[] = []): void {
  const had = labels(item);
  const next = [...new Set([...had, ...add])].filter((l) => !remove.includes(l));
  if (next.join("\0") !== had.join("\0")) issues.edit(item, { labels: next });
}

// The read.

/** Lists by repo key, each read from the store once for the reader's life. */
export interface Reader {
  /** The repo's list, or null when the store has none or cannot be read. */
  list(key: string): Doc | null;
  /** Item `id` of the repo's list, or undefined. */
  item(key: string, id: number | string): Issue | undefined;
}

/** A reader of the store's lists; it fetches at most once, on its first list. `fetch: false` reads origin/main as last fetched. */
export function reader(o: { fetch?: boolean } = {}): Reader {
  const lists = new Map<string, Doc | null>();
  let fetched = o.fetch === false;
  const list = (key: string): Doc | null => {
    if (!lists.has(key)) {
      let doc: Doc | null = null;
      const read = fetched ? readFetched : readList;
      fetched = true;
      try { doc = read({ key }); } catch {}
      lists.set(key, doc);
    }
    return lists.get(key)!;
  };
  return { list, item: (key, id) => { const doc = list(key); return doc ? issues.find(doc, id) : undefined; } };
}

/** The buildable issues of each repo, in repo then number order. A repo whose list cannot be read has none. */
export function goals<R extends Place>(repos: R[], lists: Reader = reader()): { repo: R; item: Issue }[] {
  return repos.flatMap((repo) => {
    const doc = lists.list(repo.key);
    return (doc?.items ?? []).filter((i) => isBuildable(doc!, i)).map((item) => ({ repo, item }));
  });
}

/**
 * Item `id` as the store has it now, or null when it is not buildable: it
 * may have been closed or had a note added since the list was read. A store
 * that cannot be read counts as not buildable.
 */
export function goal(repo: Place, id: number | string): Issue | null {
  const r = reader();
  const doc = r.list(repo.key);
  const item = doc ? issues.find(doc, id) : undefined;
  return doc && item && isBuildable(doc, item) ? item : null;
}

// The writes.

/** Why a write did not happen, from what it threw. */
const why = (e: any): string => e?.message ?? String(e);

/**
 * A note on item `id`, as one commit; with `done` the item is done too, with
 * `label` it gains that label, with `ask` it waits for Chris (`setAsk`).
 * Returns why it could not, or null.
 */
export function note(repo: Place, id: number | string, text: string, opts: { done?: boolean; label?: string; unlabel?: string; ask?: Ask } = {}): string | null {
  try {
    const w = writeList(repo, `todo: item ${id}: ${text}`, (doc) => {
      const item = issues.find(doc, id);
      if (!item) return null;
      if (opts.done) issues.setStatus(item, "done");
      if (opts.label || opts.unlabel) label(item, opts.label ? [opts.label] : [], opts.unlabel ? [opts.unlabel] : []);
      if (opts.ask) setAsk(item, opts.ask);
      return issues.note(item, text);
    });
    return w ? null : `no issue ${id}`;
  } catch (e) {
    return why(e);
  }
}

/** Item `id` done, with the note `text`. Returns why it could not, or null. */
export const close = (repo: Place, id: number | string, text: string): string | null => note(repo, id, text, { done: true });

/**
 * Change item `id` with `change` as one commit, while it is still open and not
 * sorted: triage's write. False when the item is gone, closed or sorted.
 */
export function sort(repo: Place, id: number | string, message: string, change: (item: Issue, doc: Doc) => void): boolean {
  const w = writeList(repo, message, (doc) => {
    const item = issues.find(doc, id);
    if (!item || status(item) !== "open" || isSorted(doc, item)) return null;
    change(item, doc);
    return true;
  });
  return w?.value === true;
}

/**
 * Reopen item: the closure off, `since` set to main's head so that only later trailers count, and a closed parent
 * reopened in the same write. Called in a write.
 */
export function reopen(doc: Doc, item: Issue, since: string | null): void {
  for (const i of [item, parentOf(doc, item)]) {
    if (!i || status(i) === "open") continue;
    issues.setStatus(i, "open");
    if (since) i.fm.since = since;
  }
  if (since) item.fm.since = since;
}

export const PLAN_REST = "Plan the missing part";

/**
 * Called in the write that sets part `part` to dropped: when its parent is open, has no Ask and no other open part,
 * the parent gets the part-dropped Ask, so the same commit that drops the part asks Chris what now.
 */
export function askIfPartDropped(doc: Doc, part: Issue, reason: string): void {
  if (status(part) !== "dropped") return;
  const issue = parentOf(doc, part);
  if (!issue || status(issue) !== "open" || awaitsChris(issue)) return;
  if (partsOf(doc, issue).some((g) => g !== part && status(g) === "open")) return;
  askPartDropped(issue, `Part ${doc.repo}-${issues.refOf(part)} was dropped: ${reason}. What now?`);
}

/** Put the part-dropped Ask on a parent. */
export function askPartDropped(issue: Issue, question: string): void {
  setAsk(issue, {
    kind: "input",
    reason: "part-dropped",
    question,
    options: [
      { label: "Close with what landed", line: "Close the issue: the parts that landed are enough." },
      { label: PLAN_REST, line: "Plan a new part for what the dropped part was to do." },
    ],
    why: [],
  });
  issue.fm.updated = issues.today();
}

/** A new issue for `file` and `closeAndFile`; `spec` makes it buildable. */
export interface Filing { title: string; labels?: string[]; areas?: string[]; request?: string; spec?: string; priority?: string; source?: "chris" | "worker" | "deps" | "memory" | "agent"; ask?: Ask }

/**
 * Item `id` done with the note `text` (when `id` is given), and `filed` added,
 * as one commit; a repo the store has no list for gets one. Returns what became
 * of the item (`done`, `no issue <id>`, or the write's error) and the new numbers.
 */
export function closeAndFile(repo: Place, message: string, id: number | string | undefined, text: string, filed: Filing[]): { todo?: string; ids: number[] } {
  let todo: string | undefined;
  let ids: number[] = [];
  try {
    writeList(repo, message, (doc) => {
      if (id !== undefined) {
        const item = issues.find(doc, id);
        if (item) {
          issues.setStatus(item, "done");
          issues.note(item, text);
        }
        todo = item ? "done" : `no issue ${id}`;
      }
      ids = filed.map((f) => {
        const item = issues.add(doc, f.title, { labels: f.labels, request: f.request, spec: f.spec, priority: f.priority, source: f.source });
        if (f.areas) item.fm.areas = f.areas;
        if (f.ask) setAsk(item, f.ask);
        return item.id;
      });
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

/** The label of the one issue that collects the flakes runs meet. */
export const FLAKES = "flakes";

/** The open item labelled `flakes`, the lowest id when there are several; undefined when there is none. */
export function flakeTracker(doc: Doc): Issue | undefined {
  return doc.items
    .filter((i) => i.sub === undefined && status(i) === "open" && isTracker(i))
    .sort((a, b) => a.id - b.id)[0];
}

/**
 * A note on the flake tracker, adding the tracker first when there is none, as
 * one commit. Chris picks from the tracker's notes which flakes get a spec, so
 * a run that meets an unrelated flake notes it here and files no issue.
 * Returns the tracker's id, or why the write did not happen.
 */
export function noteFlake(repo: Place, text: string): { id: number } | string {
  try {
    const w = writeList(repo, `todo: flake: ${text}`, (doc) => {
      const tracker = flakeTracker(doc) ?? issues.add(doc, "Flaky tests seen by runs", {
        priority: "low",
        labels: [FLAKES],
        tracker: true,
        request: "Flaky tests that runs met and did not cause. Each note is one flake a run saw. Chris picks from these notes which flakes to fix.",
      });
      issues.note(tracker, text);
      return { id: tracker.id };
    }, true);
    return w ? w.value : "no flake tracker written";
  } catch (e) {
    return why(e);
  }
}
