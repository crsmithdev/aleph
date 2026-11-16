/**
 * The items repo holds every project's issues, one folder each, in a git repo at $ALEPH_ITEMS or ~/.aleph/items:
 * `issues/<n>/issue.md`, in the layout `todo.ts` reads, with its media files flat beside it. The number is one
 * counter across projects (`next("issue")`), and an issue's `project` field names its project. A read fetches and
 * reads origin/main; a write is one commit on origin/main, made without a working tree, and the checkout follows. No
 * product repo's main moves when an item changes, and no branch of a product repo can edit its own item.
 *
 * It is the Issues module: the predicates (`isBuildable`, `isSorted`, `awaitsChris`), one read of a project's list
 * (`reader`), and the named writes (`note`, `close`, `closeAndFile`, `file`). Every new issue but the flake tracker
 * comes from `writeFiling`, and every close is logged by `logClosed`. Callers do not read `fm.labels` or name a path.
 */
import * as record from "../../jobs/lib/records/record.ts";
import { fetchOrigin, fetchOriginAsync, followMain, git, spawnGit, treeWithFiles } from "../../lib/git.ts";
import { layout, logEvent } from "../../lib/layout.ts";
import { next } from "../../lib/db.ts";
import { always, logAlways } from "../../jobs/lib/asks/ask.ts";
import { key as keyOf } from "../../lib/naming.ts";
import * as issues from "./todo.ts";
import { labels, parseItem, renderItem, status, type Doc, type Issue } from "./todo.ts";
import { projectKey, projectName, readProjects, renderProject } from "./projects.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";

export { labels };

/** A repo of the store. With `author`, intake also takes in an issue filed with a spec before it builds. */
export interface Place { key: string; author?: boolean }

const MAIN = "main";
const ATTEMPTS = 5;

export const itemsDir = (): string => layout().items;
const issueDir = (id: number): string => `issues/${id}`;
const itemPath = (item: Issue): string => `${issueDir(item.id)}/issue.md`;

let fetches = true;

/** Reads in this process never fetch: the UI's updater fetches the store itself (fetchStore). The CLI always fetches; a write always does. */
export function skipFetches(skip = true): void { fetches = !skip; }

function fetch(dir: string): void {
  if (fetches) fetchNow(dir);
}

/** An explicit, non-forced refspec: a write may move origin/main while a fetch runs, and the clone's forced `origin` refspec would then set it back to the remote's older value. */
const REFSPEC = `refs/heads/${MAIN}:refs/remotes/origin/${MAIN}`;

/** Fetch origin/main without blocking: the error text, or null. */
export async function fetchStore(dir = itemsDir()): Promise<string | null> {
  const r = await fetchOriginAsync(dir, REFSPEC);
  return r.ok ? null : r.out;
}

/**
 * Fetch origin/main and wait for it. Every aleph process
 * reads the store, so two fetches at once race on the ref's lock: fetchOrigin retries that.
 */
function fetchNow(dir: string): void {
  const r = fetchOrigin(dir, REFSPEC);
  if (!r.ok) throw new FetchFailed(`work store fetch failed: ${r.out}`);
}

/** The store's fetch failed: the lists on disk may be stale, not missing. */
class FetchFailed extends Error {}

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

/** Every issue of the items repo at the commit last loaded, by directory: a commit never changes, so a later load of the same commit reads no blob. Only the latest commit is kept. */
const texts = new Map<string, { sha: string; items: Issue[] }>();
const ISSUE = /^issues\/(\d+)\/issue\.md$/;

/** Every issue at `rev`, in number order, parsed once for each commit. */
function loadAll(dir: string, rev: string): Issue[] {
  const sha = /^[0-9a-f]{40}$/.test(rev) ? rev : git(dir, "rev-parse", "--verify", "-q", `${rev}^{commit}`).out;
  const known = /^[0-9a-f]{40}$/.test(sha), at = known ? sha : rev;
  let hit = texts.get(dir);
  if (!hit || hit.sha !== sha || !known) {
    const ls = git(dir, "ls-tree", "-r", "-z", "--name-only", at, "--", "issues/");
    const names = (ls.ok ? ls.out.split("\0") : []).filter((p) => ISSUE.test(p));
    const files = readFiles(dir, names.map((p) => `${at}:${p}`));
    hit = { sha, items: names.map((p, n) => parseItem(Number(ISSUE.exec(p)![1]), files[n])).sort((a, b) => a.id - b.id) };
    if (known) texts.set(dir, hit);
  }
  return hit.items;
}

/** The name of the project of each issue at `rev`, by issue number, with no fetch. */
export const projectsAt = (dir: string, rev: string): Map<number, string> => new Map(loadAll(dir, rev).flatMap((i) => { const name = projectName(String(i.fm.project)); return name ? [[i.id, name] as [number, string]] : []; }));

/** Whether the items repo has issue `n` on its origin/main as last fetched. */
export const hasIssue = (n: number): boolean => loadAll(itemsDir(), `origin/${MAIN}`).some((i) => i.id === n);

/** The name of the project that holds issue `n`, or undefined when the items repo has no such issue. */
export function projectOfIssue(n: number): string | undefined {
  const dir = itemsDir();
  fetch(dir);
  const found = loadAll(dir, `origin/${MAIN}`).find((i) => i.id === n);
  return found ? projectName(String(found.fm.project)) : undefined;
}

/** A project's issues at `rev`, in number order, or null when the items repo has no project of that name. */
function load(dir: string, rev: string, name: string): Doc | null {
  const project = projectKey(name);
  if (!project) return null;
  const all = structuredClone(loadAll(dir, rev));
  return { repo: name, project, items: all.filter((i) => i.fm.project === project), floor: all.at(-1)?.id ?? 0 };
}

/** The repo's list on the store's origin/main, or null when the store has none. */
export function readList(repo: Place): Doc | null {
  const dir = itemsDir();
  fetch(dir);
  return load(dir, `origin/${MAIN}`, repo.key);
}

/** The repo's list on the store's origin/main as last fetched, with no fetch; null when the store has none. */
export function readFetched(repo: Place, rev = `origin/${MAIN}`): Doc | null {
  return load(itemsDir(), rev, repo.key);
}

/**
 * Every issue of every project on origin/main as last fetched, with its project's name, and no fetch. The issues are the
 * store's cached objects, not copies, so a caller only reads them. After a fetch it took 6 to 9 ms where `readLists`
 * took about 1.2 s with its own fetch (12 projects, 1,489 issues, 2026-11-14).
 */
export function everyFetched(): { repo: string; item: Issue }[] {
  // projectName reads the registry on each call, so name each project once.
  const names = new Map<string, string | undefined>();
  const nameOf = (k: string) => { if (!names.has(k)) names.set(k, projectName(k)); return names.get(k); };
  return loadAll(itemsDir(), `origin/${MAIN}`).flatMap((item) => { const repo = nameOf(String(item.fm.project)); return repo ? [{ repo, item }] : []; });
}

/** Each repo's list on the store's origin/main, after one fetch; null when the store has none. */
export function readLists(repos: Place[]): (Doc | null)[] {
  const dir = itemsDir();
  fetch(dir);
  return repos.map((r) => load(dir, `origin/${MAIN}`, r.key));
}

const CLOSED = ["done", "dropped"];

/** Log the close of `item`: `done` or `dropped` by its `closed_as`, with its `closed_why` as the detail. */
function logClosed(item: Issue, by: string): void {
  const why = item.fm.closed_why ? String(item.fm.closed_why) : undefined;
  logEvent({ subject: by, action: status(item), object: keyOf("issue", item.id), ...(why ? { detail: why } : {}) });
}

/** The `created` time of each issue at `rev` that has a parsable one, in ms by issue number, with no fetch. */
export const createdAt = (dir: string, rev: string): Map<number, number> => new Map(loadAll(dir, rev).flatMap((i) => { const at = Date.parse(String(i.fm.created)); return Number.isNaN(at) ? [] : [[i.id, at] as [number, number]]; }));

export const REMOVE_LINK = "Remove the link", DROP_WAITER = "Drop the waiter";

/**
 * Called after the write that dropped issue `blocker`, for each open issue whose `after` names it: with the Always rule
 * `resolve` for blocker-dropped the link is removed and the issue stays open; else the issue is parked with the
 * blocker-dropped Ask (ask.ts decides it).
 */
function parkWaiter(repo: Place, waiter: Issue, blocker: string): void {
  const ref = keyOf("issue", waiter.id);
  const standing = always("blocker-dropped", repo.key)?.action === "resolve";
  const w = writeList(repo, `todo: item ${waiter.id}: blocker ${blocker} dropped`, (doc) => {
    const item = issues.find(doc, waiter.id);
    if (!item || status(item) !== "open" || !afterOf(item).includes(blocker)) return null;
    if (standing) item.fm.after = afterOf(item).filter((r) => r !== blocker);
    else issues.setStatus(item, "parked");
    return true;
  });
  if (!w) return;
  if (standing) { logAlways("blocker-dropped", ref, "answered", { detail: "the recommended answer" }); return; }
  record.setIssueAsk(ref, {
    reason: "blocker-dropped", question: `${blocker} was dropped, so this issue is parked. What now?`, recommended: REMOVE_LINK, why: [],
    options: [{ label: REMOVE_LINK, line: "Takes the dropped issue out of after and opens this issue." }, { label: DROP_WAITER, line: "Drops this issue too." }],
  });
  logEvent({ subject: "rule", action: "parked", object: ref, detail: `blocker ${blocker} dropped` });
}

/**
 * Apply `change` to the project's list on the store's origin/main and push it as one commit. When the push is refused
 * because main moved, fetch and apply `change` again. `change` returns null to write nothing. A project the items repo
 * has none for gets one in the same commit only when `create` is set. A new issue takes its number from the counter in
 * `change`, before the push, so a refused push leaves a gap. Each issue the write closes logs `done` or `dropped` as `by`
 * once the push succeeds (git first, then the event): this is the one door for a close, so no caller logs its own.
 */
export function writeList<T>(repo: Place, message: string, change: (doc: Doc) => T | null, create = false, blobs: Record<string, Uint8Array> = {}, by = "rule"): { value: T; commit: string; follow: string | null } | null {
  const dir = itemsDir();
  for (let attempt = 1; ; attempt++) {
    // `change` fills `blobs` again on each attempt: a retry can give the item another number.
    for (const k of Object.keys(blobs)) delete blobs[k];
    fetchNow(dir);
    const base = git(dir, "rev-parse", `origin/${MAIN}`).out;
    const files: Record<string, string | Uint8Array> = {};
    let doc = load(dir, base, repo.key);
    if (doc === null) {
      if (!create) throw new Error(`the items repo has no project ${repo.key}`);
      const n = next("project", readProjects().reduce((m, p) => Math.max(m, p.n), 0));
      files[`projects/${n}/project.md`] = renderProject({ name: repo.key, description: "", fields: {} });
      doc = issues.blank(repo.key, keyOf("project", n));
      doc.floor = loadAll(dir, base).at(-1)?.id ?? 0;
    }
    const before = new Map(doc.items.map((i) => [i.id, renderItem(i)]));
    const open = new Set(doc.items.filter((i) => !CLOSED.includes(status(i))).map((i) => i.id));
    const value = change(doc);
    if (value === null) return null;
    Object.assign(files, blobs);
    for (const item of doc.items) {
      const text = renderItem(item);
      if (before.get(item.id) !== text) files[itemPath(item)] = text;
    }
    // Nothing changed: no commit, so the history holds only real writes.
    if (Object.keys(files).length === 0) return { value, commit: base, follow: null };
    const tree = treeWithFiles(dir, `${base}^{tree}`, files);
    const commit = git(dir, "commit-tree", tree, "-p", base, "-m", `${repo.key}: ${message}`);
    if (!commit.ok) throw new Error(`commit-tree failed: ${commit.out}`);
    const push = git(dir, "push", "-q", "origin", `${commit.out}:refs/heads/${MAIN}`);
    if (push.ok) {
      for (const item of doc.items) {
        if (!CLOSED.includes(status(item)) || !(open.has(item.id) || !before.has(item.id))) continue;
        logClosed(item, by);
        record.clearIssueState(`issue.${issues.refOf(item)}`);
        if (status(item) !== "dropped") continue;
        const blocker = keyOf("issue", item.id);
        for (const w of loadAll(dir, commit.out)) {
          const name = projectName(String(w.fm.project));
          if (name && status(w) === "open" && afterOf(w).includes(blocker)) parkWaiter({ key: name }, w, blocker);
        }
      }
      return { value, commit: commit.out, follow: followMain(dir, MAIN) };
    }
    if (attempt === ATTEMPTS) throw new Error(`push refused ${ATTEMPTS} times: ${push.out}`);
  }
}

// The media: images and PDFs attached to an item, stored flat beside its file and named in the item's `media` field.

export const MEDIA_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", pdf: "application/pdf" };
/** The largest file an item takes. */
export const MEDIA_BYTES = 20 * 1024 * 1024;

/** The items-repo path of an item's media file. */
export const mediaPath = (item: Issue, name: string): string => `${issueDir(item.id)}/${name}`;
/** The names of an item's media files. */
export const mediaOf = (item: Issue): string[] => list(item.fm.media);

/** The item's media files in the items checkout, which follows origin/main after each write. A write by another process leaves the checkout behind, so a missing file brings it up to date once. Throws when one is not there. */
export function mediaFiles(item: Issue): string[] {
  return mediaOf(item).map((name) => {
    const out = join(itemsDir(), mediaPath(item, name));
    if (!existsSync(out)) { fetchNow(itemsDir()); followMain(itemsDir(), MAIN); }
    if (!existsSync(out)) throw new Error(`no media ${name} in the items checkout: ${out}`);
    return out;
  });
}

/** The media files a run on item `id` reads: its own, and for a child its parent's too. */
export function runMedia(key: string, id: number | string, lists: Reader = reader()): string[] {
  const item = lists.item(key, id);
  if (!item) return [];
  const parent = parentIn(key, item, lists);
  return [...(parent ? mediaFiles(parent) : []), ...mediaFiles(item)];
}

/** An item with an Ask in its issue state: it waits for Chris, so it is never dispatched and never triaged. */
const asks = (_doc: Doc, item: Issue, _repo: Place): boolean => record.issueAsk(record.read(`issue.${issues.refOf(item)}`)) !== null;

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);
const text = (v: unknown): string => (typeof v === "string" ? v : "");

/** Who raised the item: its `source`, else agent for a child (a child is made by the planner, never by chris) and chris for an issue. */
export function sourceOf(item: Issue): "chris" | "worker" | "deps" | "memory" | "agent" {
  const s = text(item.fm.source);
  return s === "worker" || s === "deps" || s === "memory" || s === "agent" ? s : issues.parentRef(item) === undefined ? "chris" : "agent";
}
/** The children of an issue, in number order: the issues with a `from` that names it. */
export const partsOf = (doc: Doc, item: Issue): Issue[] => doc.items.filter((i) => issues.parentRef(i) === issues.refOf(item));
/** The parent of a child; undefined for an issue with none. */
export const parentOf = (doc: Doc, item: Issue): Issue | undefined => { const up = issues.parentRef(item); return up === undefined ? undefined : issues.find(doc, up); };
/** The parent of a child, read from `lists`; undefined for an issue with none. */
export const parentIn = (key: string, item: Issue, lists: Reader = reader()): Issue | undefined => { const up = issues.parentRef(item); return up === undefined ? undefined : lists.item(key, up); };
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
/** Whether issue `ref` (`issue.<n>`) is dropped on the store's origin/main as last fetched. */
export const isDropped = (ref: string): boolean => loadAll(itemsDir(), `origin/${MAIN}`).some((i) => keyOf("issue", i.id) === ref && status(i) === "dropped");
/** The issues an issue names as plain references: its `refs`. They hold nothing. */
export const refsOf = (item: Issue): string[] => list(item.fm.refs);
/** The issues of `all` whose `refs` name `item`. Numbers are global, so a ref can cross projects. */
export const referrersOf = (all: Issue[], item: Issue): Issue[] => all.filter((i) => refsOf(i).includes(`issue.${item.id}`));
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
  /** The repo's list, or null when the store has none or its fetch failed (logged). */
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
      try { doc = read({ key }); } catch (e) {
        if (!(e instanceof FetchFailed)) throw e;
        logEvent({ subject: "gate", action: "failed", object: key, detail: e.message });
      }
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
const reason = (e: any): string => e?.message ?? String(e);

/** A note on item `id`, as one commit: what a person or an agent said. Returns why it could not, or null. */
export function note(repo: Place, id: number | string, text: string): string | null {
  try {
    const w = writeList(repo, `todo: item ${id}: ${text}`, (doc) => {
      const item = issues.find(doc, id);
      return item ? issues.note(item, text) : null;
    });
    return w ? null : `no issue ${id}`;
  } catch (e) {
    return reason(e);
  }
}

/** Item `id` closed as `how`, with `text` as `closed_why`, as one commit; the close is logged as by `by` (a rule unless the caller says). Returns why it could not, or null. */
export function close(repo: Place, id: number | string, text: string, how: "done" | "dropped" = "done", by = "rule"): string | null {
  try {
    const w = writeList(repo, `todo: item ${id} ${how}: ${text}`, (doc) => {
      const item = issues.find(doc, id);
      if (!item) return null;
      issues.setStatus(item, how, undefined, text);
      return item;
    }, false, {}, by);
    return w ? null : `no issue ${id}`;
  } catch (e) {
    return reason(e);
  }
}

/** Item `id` reopened as one commit because its trailer commits on main are all reverted: `since` as `reopen` sets it, `text` as a note, and one `reopened` event as `by`. Returns why it could not, or null. */
export function reopenReverted(repo: Place, id: number, text: string, since: string | null, by = "rule"): string | null {
  try {
    const w = writeList(repo, `todo: item ${id} reopened: ${text}`, (doc) => {
      const item = issues.find(doc, id);
      if (!item || status(item) !== "done") return null;
      reopen(doc, item, since);
      issues.note(item, text);
      return item;
    });
    if (w) logEvent({ subject: by, action: "reopened", object: keyOf("issue", id), detail: text });
    return null;
  } catch (e) {
    return reason(e);
  }
}

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

/** A new issue; `spec` makes it buildable, `from` (the key of the issue it was split from, `issue.5`) makes it a child, and `after` is what it waits for. */
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
  }, create, blobs, by);
  for (const item of w ? made : []) {
    logEvent({ subject: by, action: "filed", object: keyOf("issue", item.id) });
    effects.after(repo, item);
  }
  return w;
}

/** File one issue as one commit, starting the list when the store has none: the new issue. */
export const fileIssue = (repo: Place, f: Filing, by: string, effects: Effects): Issue =>
  writeFiling(repo, `todo: file ${f.title}`, by, effects, (_, file) => file(f))!.value;

/**
 * Item `id` done with `why` as its `closed_why` (when `id` is given), and `filed` added, as one commit; a project the
 * items repo has none for gets one. The close is logged. Returns what became of the item (`done`, `no issue <id>`, or
 * the write's error) and the new numbers. A filing with no `priority` takes the priority of the closed item.
 */
export function closeAndFile(repo: Place, message: string, id: number | string | undefined, why: string, filed: Filing[], by: string, effects: Effects): { todo?: string; ids: number[] } {
  let todo: string | undefined;
  let ids: number[] = [];
  try {
    writeFiling(repo, message, by, effects, (doc, file) => {
      let inherited: string | undefined;
      if (id !== undefined) {
        const item = issues.find(doc, id);
        if (item) {
          inherited = item.fm.priority as string | undefined;
          issues.setStatus(item, "done", undefined, why || undefined);
        }
        todo = item ? "done" : `no issue ${id}`;
      }
      ids = filed.map((f) => file({ ...f, priority: f.priority ?? inherited }).id);
      return true;
    });
  } catch (e) {
    todo = reason(e);
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
    .filter((i) => status(i) === "open" && isTracker(i))
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
    return reason(e);
  }
}
