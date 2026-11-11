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
 * (`note`, `close`, `closeAndFile`, `file`). Every new issue but the flake
 * tracker comes from `writeFiling`. Callers do not read
 * `fm.labels` or name a task's path.
 */
import * as record from "../../jobs/lib/records/record.ts";
import { fetchOrigin, fetchOriginAsync, followMain, git, spawnGit, treeWithFiles } from "../../lib/git.ts";
import { layout, logEvent } from "../../lib/layout.ts";
import * as issues from "./todo.ts";
import { labels, parseItem, renderItem, status, type Doc, type Floor, type Issue } from "./todo.ts";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export { labels };

/** A repo of the store. With `author`, intake also takes in an issue filed with a spec before it builds. */
export interface Place { key: string; author?: boolean }

const MAIN = "main";
const ATTEMPTS = 5;

export const storeDir = (): string => layout().store;
/** Where runs read the items' media: `<store>-media`, outside the store's checkout. */
export const mediaDir = (): string => `${storeDir()}-media`;
const tasksDir = (key: string): string => `${key}/backlog/tasks`;
const configPath = (key: string): string => `${key}/backlog/config.yml`;
const floorPath = (key: string): string => `${key}/backlog/floor.json`;
const itemPath = (key: string, item: issues.Issue | string): string => `${tasksDir(key)}/${key}-${typeof item === "string" ? item : issues.refOf(item)}.md`;

/** The file that marks a repo as having a list in the store. */
export const config = (key: string): string => `project_name: "${key}"\ntask_prefix: "${key}"\n`;

let fetches = true;

/** Reads in this process never fetch: the UI's updater fetches the store itself (fetchStore). The CLI always fetches; a write always does. */
export function skipFetches(skip = true): void { fetches = !skip; }

function fetch(dir: string): void {
  if (fetches) fetchNow(dir);
}

/** An explicit, non-forced refspec: a write may move origin/main while a fetch runs, and the clone's forced `origin` refspec would then set it back to the remote's older value. */
const REFSPEC = `refs/heads/${MAIN}:refs/remotes/origin/${MAIN}`;

/** Fetch origin/main without blocking: the error text, or null. */
export async function fetchStore(dir = storeDir()): Promise<string | null> {
  const r = await fetchOriginAsync(dir, REFSPEC);
  return r.ok ? null : r.out;
}

/**
 * Fetch origin/main and wait for it. Every aleph process
 * reads the store, so two fetches at once race on the ref's lock: fetchOrigin retries that.
 */
function fetchNow(dir: string): void {
  const r = fetchOrigin(dir, REFSPEC);
  if (!r.ok) throw new Error(`work store fetch failed: ${r.out}`);
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
const texts = new Map<string, { sha: string; files: string[] | null; items?: Issue[]; floor?: Floor }>();

/** A repo's items at `rev`, in number order, or null when the store has no list for it. One ls-tree finds the config and the items. */
function load(dir: string, rev: string, key: string): Doc | null {
  // The commit `rev` names: the files of a commit loaded before are reused with their parsed items, which a caller gets as copies.
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
  const items = structuredClone(hit.items ??= hit.files.map(parseItem));
  return { repo: key, items: items.sort((a, b) => a.id - b.id || (a.sub ?? -1) - (b.sub ?? -1)), ...(hit.floor ? { floor: hit.floor } : {}) };
}

/** The repo's list on the store's origin/main, or null when the store has none. */
export function readList(repo: Place): Doc | null {
  const dir = storeDir();
  fetch(dir);
  return load(dir, `origin/${MAIN}`, repo.key);
}

/** The repo's list on the store's origin/main as last fetched, with no fetch; null when the store has none. */
export function readFetched(repo: Place, rev = `origin/${MAIN}`): Doc | null {
  return load(storeDir(), rev, repo.key);
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
export function writeList<T>(repo: Place, message: string, change: (doc: Doc) => T | null, create = false, blobs: Record<string, Uint8Array> = {}): { value: T; commit: string; follow: string | null } | null {
  const dir = storeDir();
  for (let attempt = 1; ; attempt++) {
    // `change` fills `blobs` again on each attempt: a retry can give the item another number.
    for (const k of Object.keys(blobs)) delete blobs[k];
    fetchNow(dir);
    const base = git(dir, "rev-parse", `origin/${MAIN}`).out;
    const found = load(dir, base, repo.key);
    if (found === null && !create) throw new Error(`the work store has no list for ${repo.key}`);
    const doc = found ?? issues.blank(repo.key);
    const before = new Map(doc.items.map((i) => [issues.refOf(i), renderItem(repo.key, i)]));
    const value = change(doc);
    if (value === null) return null;
    const files: Record<string, string | Uint8Array> = { ...(found === null ? { [configPath(repo.key)]: config(repo.key) } : {}), ...blobs };
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
      return { value, commit: commit.out, follow: followMain(dir, MAIN) };
    }
    if (attempt === ATTEMPTS) throw new Error(`push refused ${ATTEMPTS} times: ${push.out}`);
  }
}

// The media: images and PDFs attached to an item, stored beside the list and named in the item's `media` field.

export const MEDIA_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", pdf: "application/pdf" };
/** The largest file an item takes. */
export const MEDIA_BYTES = 20 * 1024 * 1024;

/** The store path of an item's media file. */
export const mediaPath = (key: string, item: Issue, name: string): string => `${key}/backlog/media/${key}-${issues.refOf(item)}/${name}`;
/** The names of an item's media files. */
export const mediaOf = (item: Issue): string[] => list(item.fm.media);

/**
 * The item's media files on disk, read from origin/main into `<store>-media`, so a run reads them whatever state
 * the store's checkout is in. A file already there with the same size is not read again.
 */
export function mediaFiles(key: string, item: Issue): string[] {
  const dir = storeDir();
  return mediaOf(item).map((name) => {
    const out = join(mediaDir(), `${key}-${issues.refOf(item)}`, name);
    const spec = `origin/${MAIN}:${mediaPath(key, item, name)}`;
    const size = Number(git(dir, "cat-file", "-s", spec).out);
    if (existsSync(out) && statSync(out).size === size) return out;
    const blob = spawnGit(["git", "cat-file", "blob", spec], { cwd: dir, stdout: "pipe", stderr: "pipe" });
    if (blob.exitCode !== 0) throw new Error(`no media ${name} on the store's main: ${blob.stderr.toString().trim()}`);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, blob.stdout);
    return out;
  });
}

/** The media files a run on item `id` reads: its own, and for a part its issue's too. */
export function runMedia(key: string, id: number | string, lists: Reader = reader()): string[] {
  const item = lists.item(key, id);
  if (!item) return [];
  const parent = item.sub === undefined ? undefined : lists.item(key, item.id);
  return [...(parent ? mediaFiles(key, parent) : []), ...mediaFiles(key, item)];
}

/** An item with an Ask in its job record: it waits for Chris, so it is never dispatched and never triaged. */
const asks = (doc: Doc, item: Issue, repo: Place): boolean => record.issueAsk(record.read(`${doc.repo ?? repo.key}-${issues.refOf(item)}`)) !== null;

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);
const text = (v: unknown): string => (typeof v === "string" ? v : "");

/** Who raised the item: its `source`, else agent for a part (a part is made by the planner, never by chris) and chris for an issue. */
export function sourceOf(item: Issue): "chris" | "worker" | "deps" | "memory" | "agent" {
  const s = text(item.fm.source);
  return s === "worker" || s === "deps" || s === "memory" || s === "agent" ? s : item.sub === undefined ? "chris" : "agent";
}
/** The children of an issue, in number order: the issues with a `from` that names it, and its old parts `<n>.<k>`. */
export const partsOf = (doc: Doc, item: Issue): Issue[] => doc.items.filter((i) => issues.parentRef(i) === issues.refOf(item));
/** The parent of a child or an old part; undefined for a top-level issue. */
export const parentOf = (doc: Doc, item: Issue): Issue | undefined => { const up = issues.parentRef(item); return up === undefined ? undefined : issues.find(doc, up); };
/** Whether the issue needs a plan run, or "plan the rest" on a parent. */
export const planSet = (item: Issue): boolean => item.fm.plan === "true";
/** The flake tracker: a note log, never built. */
export const isTracker = (item: Issue): boolean => item.fm.tracker === "true";
/** Whether intake took the item in: its `intake` field, or a triage `build` or `plan` note from before intake. */
const takenIn = (item: Issue): boolean => item.fm.intake !== undefined || item.notes.some((n) => /: triage: (build|plan)\b/.test(n));
/**
 * An open issue a factory run can build: it has a spec, no parts and no Ask, and is neither to plan nor the tracker.
 * In a repo with `author`, a top-level issue builds only after intake took it in.
 */
export const isBuildable = (doc: Doc, item: Issue, repo: Place = { key: "" }): boolean =>
  status(item) === "open" && (parentOf(doc, item) === undefined || status(parentOf(doc, item)!) !== "parked") && !asks(doc, item, repo) && !!item.spec.trim() && !planSet(item) && !isTracker(item) && partsOf(doc, item).length === 0
  && (issues.parentRef(item) !== undefined || !repo.author || takenIn(item));
/** The refs an issue waits for: its `after`. */
export const afterOf = (item: Issue): string[] => list(item.fm.after);
/** The item's areas: its `areas`. */
export const areasOf = (item: Issue): string[] => list(item.fm.areas);

/**
 * An item intake leaves alone: asking, a part, the tracker, or, unless it is to plan, with parts, taken in, or with a spec.
 * In a repo with `author`, a spec alone does not sort it: intake takes in an issue filed with a spec too.
 */
export const isSorted = (doc: Doc, item: Issue, repo: Place = { key: "" }): boolean =>
  asks(doc, item, repo) || issues.parentRef(item) !== undefined || isTracker(item)
  || (!planSet(item) && (partsOf(doc, item).length > 0 || takenIn(item) || (!repo.author && !!item.spec.trim())));

/** Lists by repo key, each read from the store once for the reader's life. */
export interface Reader {
  /** The repo's list, or null when the store has none or cannot be read. */
  list(key: string): Doc | null;
  /** Item `id` of the repo's list, or undefined. */
  item(key: string, id: number | string): Issue | undefined;
}

/** A reader of the store's lists; it fetches at most once, on its first list. `fetch: false` reads origin/main as last fetched, or the commit `rev`. */
export function reader(o: { fetch?: boolean; rev?: string } = {}): Reader {
  const lists = new Map<string, Doc | null>();
  let fetched = o.fetch === false;
  const list = (key: string): Doc | null => {
    if (!lists.has(key)) {
      let doc: Doc | null = null;
      const read = fetched ? (r: Place) => readFetched(r, o.rev) : readList;
      fetched = true;
      try { doc = read({ key }); } catch {}
      lists.set(key, doc);
    }
    return lists.get(key)!;
  };
  return { list, item: (key, id) => { const doc = list(key); return doc ? issues.find(doc, id) : undefined; } };
}

/** Rank of an item's priority: 3 for critical down to 0 for low. No priority, or an unknown one, ranks as medium. */
function rank(item: Issue): number {
  const i = (issues.PRIORITIES as readonly string[]).indexOf(String(item.fm.priority ?? ""));
  return i < 0 ? (issues.PRIORITIES as readonly string[]).indexOf("medium") : i;
}
/** An item's priority; none, or an unknown one, reads medium. */
export const priorityOf = (item: Issue): string => issues.PRIORITIES[rank(item)];

/** Sort entries by priority, highest first; stable, so equal priorities keep their order. */
export function byPriority<T extends { item: Issue }>(entries: T[]): T[] {
  return entries.map((e, n) => ({ e, n })).sort((a, b) => rank(b.e.item) - rank(a.e.item) || a.n - b.n).map((x) => x.e);
}

/** The buildable issues of all repos, critical first, then repo then number order within a priority. A repo whose list cannot be read has none. */
export function buildableIssues<R extends Place>(repos: R[], lists: Reader = reader()): { repo: R; item: Issue }[] {
  return byPriority(repos.flatMap((repo) => {
    const doc = lists.list(repo.key);
    return (doc?.items ?? []).filter((i) => isBuildable(doc!, i, repo)).map((item) => ({ repo, item }));
  }));
}

/**
 * Item `id` as the store has it now, or null when it is not buildable: it
 * may have been closed or had a note added since the list was read. A store
 * that cannot be read counts as not buildable.
 */
export function buildableIssue(repo: Place, id: number | string): Issue | null {
  const r = reader();
  const doc = r.list(repo.key);
  const item = doc ? issues.find(doc, id) : undefined;
  return doc && item && isBuildable(doc, item, repo) ? item : null;
}

/** Why a write did not happen, from what it threw. */
const why = (e: any): string => e?.message ?? String(e);

/**
 * A note on item `id`, as one commit; with `done` the item is done too.
 * Returns why it could not, or null.
 */
export function note(repo: Place, id: number | string, text: string, opts: { done?: boolean } = {}): string | null {
  try {
    const w = writeList(repo, `todo: item ${id}: ${text}`, (doc) => {
      const item = issues.find(doc, id);
      if (!item) return null;
      if (opts.done) issues.setStatus(item, "done");
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
 * sorted: intake's write. False when the item is gone, closed or sorted. A
 * change that files parts with `file` passes the `effects` they start.
 */
export function sort(repo: Place, id: number | string, message: string, change: (item: Issue, doc: Doc, file: File) => void, effects: Effects = { after: () => {} }): boolean {
  const w = writeFiling(repo, message, "intake", effects, (doc, file) => {
    const item = issues.find(doc, id);
    if (!item || status(item) !== "open" || isSorted(doc, item, repo)) return null;
    change(item, doc, file);
    return true;
  }, false);
  return w?.value === true;
}

/**
 * Reopen item: the closure off, `since` set to main's head so that only later trailers count, and a closed parent
 * reopened in the same write. Called in a write.
 */
export function reopen(doc: Doc, item: Issue, since: string | null): void {
  for (const i of [item, parentOf(doc, item)]) {
    if (!i || status(i) === "open") continue;
    if (i !== item && status(i) === "parked") continue;
    issues.setStatus(i, "open");
    if (since) i.fm.since = since;
  }
  if (since) item.fm.since = since;
}

/** A new issue; `spec` makes it buildable, `from` (the full id it was split from) makes it a part, and `after` is what it waits for. */
export interface Filing { title: string; kind?: string; labels?: string[]; areas?: string[]; request?: string; spec?: string; priority?: string; source?: issues.Source; parked?: boolean; from?: string; after?: string[] }

/** What a new issue starts once its commit is on main. Production passes `filing` (factory.ts): intake or a dispatch. A test passes a recorder. */
export interface Effects { after: (repo: Place, item: Issue) => void }

/** Adds `f` to the list in a write: the new issue. A title or kind the store refuses throws, so nothing is written. */
export type File = (f: Filing) => Issue;

/**
 * The one path that creates an issue: `change` runs in one write of the list and adds each new issue with `file`.
 * After the commit, each new issue logs one `filed` event by `by`, and `effects.after` starts what it calls for.
 * Returns what `writeList` returns.
 */
export function writeFiling<T>(repo: Place, message: string, by: string, effects: Effects, change: (doc: Doc, file: File) => T | null, create = true, blobs?: Record<string, Uint8Array>) {
  let made: Issue[] = [];
  const w = writeList(repo, message, (doc) => {
    // A retry runs `change` again on a fresh list.
    made = [];
    return change(doc, (f) => {
      const item = issues.add(doc, f.title, { kind: f.kind, labels: f.labels, request: f.request, spec: f.spec, priority: f.priority, source: f.source, from: f.from, after: f.after });
      if (f.areas) item.fm.areas = f.areas;
      if (f.parked) issues.setStatus(item, "parked");
      made.push(item);
      return item;
    });
  }, create, blobs);
  for (const item of w ? made : []) {
    logEvent({ by, subject: `${repo.key}-${issues.refOf(item)}`, action: "filed" });
    effects.after(repo, item);
  }
  return w;
}

/** File one issue as one commit, starting the list when the store has none: the new issue. */
export const fileIssue = (repo: Place, f: Filing, by: string, effects: Effects): Issue =>
  writeFiling(repo, `todo: file ${f.title}`, by, effects, (_, file) => file(f))!.value;

/**
 * Item `id` done with the note `text` (when `id` is given), and `filed` added,
 * as one commit; a repo the store has no list for gets one. Returns what became
 * of the item (`done`, `no issue <id>`, or the write's error) and the new numbers.
 * A filing with no `priority` takes the priority of the closed item.
 */
export function closeAndFile(repo: Place, message: string, id: number | string | undefined, text: string, filed: Filing[], by: string, effects: Effects): { todo?: string; ids: number[] } {
  let todo: string | undefined;
  let ids: number[] = [];
  try {
    writeFiling(repo, message, by, effects, (doc, file) => {
      let inherited: string | undefined;
      if (id !== undefined) {
        const item = issues.find(doc, id);
        if (item) {
          inherited = item.fm.priority as string | undefined;
          issues.setStatus(item, "done");
          issues.note(item, text);
        }
        todo = item ? "done" : `no issue ${id}`;
      }
      ids = filed.map((f) => file({ ...f, priority: f.priority ?? inherited }).id);
      return true;
    });
  } catch (e) {
    todo = why(e);
    ids = [];
  }
  return { todo, ids };
}

/** File new issues as one commit, starting the list when the store has none; their numbers. A write that fails files none. */
export const file = (repo: Place, message: string, filed: Filing[], by: string, effects: Effects): number[] =>
  filed.length ? closeAndFile(repo, message, undefined, "", filed, by, effects).ids : [];

/** The open flake tracker (`tracker: true`), the lowest id when there are several; undefined when there is none. */
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
        kind: "flake",
        priority: "low",
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
