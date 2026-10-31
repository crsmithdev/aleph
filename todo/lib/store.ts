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
import { fetchOrigin, followMain, git, spawnGit, treeWithFiles } from "../../jobs/lib/git.ts";
import { layout } from "../../jobs/lib/layout.ts";
import { clearAsk as clearAskFields, readAsk, writeAsk, type Ask } from "../../jobs/lib/ask.ts";
import * as issues from "./todo.ts";
import { labels, parseItem, renderItem, status, type Doc, type Issue } from "./todo.ts";

export { labels };

export interface Place { key: string }

const MAIN = "main";
const ATTEMPTS = 5;

export const storeDir = (): string => layout().store;
const tasksDir = (key: string): string => `${key}/backlog/tasks`;
const configPath = (key: string): string => `${key}/backlog/config.yml`;
const itemPath = (key: string, item: issues.Issue | string): string => `${tasksDir(key)}/${key}-${typeof item === "string" ? item : issues.refOf(item)}.md`;

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

/** A repo's items at `rev`, in number order, or null when the store has no list for it. One ls-tree finds the config and the items. */
function load(dir: string, rev: string, key: string): Doc | null {
  const ls = git(dir, "ls-tree", "-r", "-z", "--name-only", rev, "--", configPath(key), `${tasksDir(key)}/`);
  const paths = ls.ok ? ls.out.split("\0") : [];
  if (!paths.includes(configPath(key))) return null;
  const names = paths.filter((p) => p.startsWith(`${tasksDir(key)}/`) && p.endsWith(".md") && !p.slice(tasksDir(key).length + 1).includes("/"));
  const items = readFiles(dir, names.map((p) => `${rev}:${p}`)).map(parseItem);
  return { head: "", repo: key, items: items.sort((a, b) => a.id - b.id || (a.sub ?? -1) - (b.sub ?? -1)) };
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
    const doc = found ?? { head: "", repo: repo.key, items: [] };
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

let timesAt: { dir: string; rev: string; times: Map<string, { added: number; changed: number }> } | null = null;

/**
 * When each item was first and last committed on the store's origin/main as
 * last fetched, by `<repo>-<n>`, in ms. One `git log`, reused while origin/main stays put.
 */
export function itemTimes(): Map<string, { added: number; changed: number }> {
  const dir = storeDir();
  const head = git(dir, "rev-parse", `origin/${MAIN}`);
  if (head.ok && timesAt?.dir === dir && timesAt.rev === head.out) return timesAt.times;
  const out = new Map<string, { added: number; changed: number }>();
  const p = spawnGit(["git", "-C", dir, "log", head.ok ? head.out : `origin/${MAIN}`, "--format=%ct", "--name-only"], { cwd: dir, stdout: "pipe", stderr: "ignore" });
  if (p.exitCode !== 0) return out;
  let ct = 0;
  for (const line of p.stdout.toString().split("\n")) {
    if (!line) continue;
    if (/^\d+$/.test(line)) { ct = Number(line) * 1000; continue; }
    const m = /^([^/]+)\/backlog\/tasks\/\1-(\d+(?:\.\d+)?)\.md$/.exec(line);
    if (!m) continue;
    const ref = `${m[1]}-${m[2]}`;
    const t = out.get(ref);
    if (t) t.added = ct; else out.set(ref, { added: ct, changed: ct });
  }
  if (head.ok) timesAt = { dir, rev: head.out, times: out };
  return out;
}

// The labels.

export const GOAL = "goal";
/**
 * Labels that mark an issue as sorted: triage skips it, and the UI does not
 * count it as new. One set for both. `live-check` is in it: triage labels a
 * live check `live-check` and `triaged` together, and an issue labelled
 * `live-check` by hand is a check the sandbox cannot reach either.
 */
// The literal "needs-chris" below is the old shape's label: the legacy readers (askOf, needsChris, clearAsk) and the SORTED and MAPPED sets keep it until step 6 drops the old shape.
export const SORTED: readonly string[] = [GOAL, "needs-chris", "triaged", "live-check", "proposal"];

export const hasLabel = (item: Issue, label: string): boolean => labels(item).includes(label);
/** An open item labelled `goal`: a factory run's work. */
export const isGoal = (item: Issue): boolean => status(item) === "open" && !hasAsk(item) && kindOf(item) === "goal";
/** Put `ask` on the item, as `askOf` reads it. */
export const setAsk = (item: Issue, ask: Ask): void => writeAsk(item, ask);

/** Take the item's Ask off: the `ask` fields, and the old shape's `needs-chris` label if it has one. */
export function clearAsk(item: Issue): void {
  clearAskFields(item);
  label(item, [], ["needs-chris"]);
}

/** An item with an `ask` (new shape): it waits for Chris, so it is never dispatched and never triaged. */
const hasAsk = (item: Issue): boolean => item.fm.ask !== undefined;
/** Labels that map to a spec field of their own, so `areasOf` leaves them out. */
const MAPPED: readonly string[] = [GOAL, "needs-chris", "planned", "followup", "triaged", "live-check", "proposal", "deps", "memory"];

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);
const text = (v: unknown): string => (typeof v === "string" ? v : "");

/** The item's `kind` when it has one (new shape), else `goal` for the `goal` label and `issue` for none. */
export const kindOf = (item: Issue): "goal" | "issue" => (item.fm.kind === "goal" || item.fm.kind === "issue" ? item.fm.kind : hasLabel(item, GOAL) ? "goal" : "issue");
/** Who raised the item: its `source`, else `followup` -> worker, `deps` -> deps, `memory` -> memory, else chris. */
export function sourceOf(item: Issue): "chris" | "worker" | "deps" | "memory" {
  const s = text(item.fm.source);
  if (s === "chris" || s === "worker" || s === "deps" || s === "memory") return s;
  return hasLabel(item, "followup") ? "worker" : hasLabel(item, "deps") ? "deps" : hasLabel(item, "memory") ? "memory" : "chris";
}
/** The issue a goal belongs to: its `issue`, else the ref of a body that starts "Part of <repo>-<n>."; null for none. */
export const issueOf = (item: Issue): string | null => text(item.fm.issue) || /^Part of ([^\s,]+-\d+(?:\.\d+)?)\./.exec(item.body)?.[1] || null;
/** The goals of an issue: its `goals`, else the `waiting_on` of a `planned` item. */
export const goalsOf = (item: Issue): string[] => (item.fm.goals !== undefined ? list(item.fm.goals) : hasLabel(item, "planned") ? list(item.fm.waiting_on) : []);
/** The goals a goal waits for: its `after`, else the `waiting_on` of an item not `planned`. */
export const afterOf = (item: Issue): string[] => (item.fm.after !== undefined ? list(item.fm.after) : hasLabel(item, "planned") ? [] : list(item.fm.waiting_on));
/** The item's areas: its `areas`, else its labels less the mapped ones. */
export const areasOf = (item: Issue): string[] => (item.fm.areas !== undefined ? list(item.fm.areas) : labels(item).filter((l) => !MAPPED.includes(l)));

export type { Ask };

/** The reason code of an old item's ask, from `reason`, else from the question as `issueReason` in ui/attention.ts reads it. */
function oldReason(reason: string, question: string): string {
  if (reason === "triage-no-verdict" || reason === "triage-failed") return "triage-failed";
  if (reason === "no-commit") return "no-commit";
  if (reason && reason !== "decision" && reason !== "question") return reason;
  const q = question.replace(/^\s*-\s*/, "").replace(/^\s*\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?:\s*/, "").replace(/^\s*needs-chris:\s*/i, "");
  if (/^triage: no verdict in/.test(q)) return "triage-failed";
  if (/ended with no commit, so the factory stopped/.test(q)) return "no-commit";
  return "question";
}

/** The item's ask: `ask: input|approval` with its flat fields, or for an old item the `needs-chris` label; null for none. */
export function askOf(item: Issue): Ask | null {
  const kind = item.fm.ask;
  const approval = kind === "approval";
  if (!approval && kind !== "input" && !needsChris(item)) return null;
  const d = readAsk(item);
  const question = d?.question ?? text(item.fm.question) ?? "";
  const reason = text(item.fm.reason);
  const options = d?.options ?? [];
  const recommended = d?.recommended || undefined;
  return {
    kind: approval ? "approval" : "input",
    reason: kind === undefined ? oldReason(reason, question || item.notes.at(-1) || "") : reason || "question",
    question, options, ...(recommended ? { recommended } : {}), why: list(item.fm.why),
  };
}

/** An item with a label of SORTED: triage leaves it alone. */
export const isSorted = (item: Issue): boolean =>
  item.fm.route !== undefined || hasAsk(item) || kindOf(item) === "goal" || list(item.fm.goals).length > 0 || labels(item).some((l) => SORTED.includes(l));
/** An item labelled `needs-chris`: it waits for Chris's answer. */
export const needsChris = (item: Issue): boolean => hasLabel(item, "needs-chris");
/** An item that waits for Chris in either shape: the `needs-chris` label or an `ask`. */
export const awaitsChris = (item: Issue): boolean => needsChris(item) || hasAsk(item);

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

/** The open goals of each repo, in repo then number order. A repo whose list cannot be read has none. */
export function goals<R extends Place>(repos: R[]): { repo: R; item: Issue }[] {
  const lists = reader();
  return repos.flatMap((repo) => (lists.list(repo.key)?.items ?? []).filter(isGoal).map((item) => ({ repo, item })));
}

/**
 * Item `id` as the store has it now, or null when it is not an open goal: it
 * may have been closed, had its `goal` label removed, or had a note added
 * since the list was read. A store that cannot be read counts as not a goal.
 */
export function goal(repo: Place, id: number | string): Issue | null {
  const item = reader().item(repo.key, id);
  return item && isGoal(item) ? item : null;
}

// The writes.

/** Why a write did not happen, from what it threw. */
const why = (e: any): string => e?.message ?? String(e);

/**
 * A note on item `id`, as one commit; with `done` the item is done too, with
 * `label` it gains that label, with `reason` it carries the reason code (`fm.reason`), with `ask` it waits for Chris (`setAsk`).
 * Returns why it could not, or null.
 */
export function note(repo: Place, id: number | string, text: string, opts: { done?: boolean; label?: string; unlabel?: string; reason?: string; ask?: Ask } = {}): string | null {
  try {
    const w = writeList(repo, `todo: item ${id}: ${text}`, (doc) => {
      const item = issues.find(doc, id);
      if (!item) return null;
      if (opts.done) issues.setStatus(item, "done");
      if (opts.label || opts.unlabel) label(item, opts.label ? [opts.label] : [], opts.unlabel ? [opts.unlabel] : []);
      if (opts.reason) item.fm.reason = opts.reason;
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
    if (!item || status(item) !== "open" || isSorted(item)) return null;
    change(item, doc);
    return true;
  });
  return w?.value === true;
}

/**
 * Called in the write that sets goal `goal` to dropped: when its issue is open, has no Ask and no other open goal,
 * the issue gets the part-dropped Ask, so the same commit that drops the goal asks Chris what now.
 */
export function askIfPartDropped(doc: Doc, goal: Issue, reason: string): void {
  if (kindOf(goal) !== "goal" || status(goal) !== "dropped") return;
  const ref = issueOf(goal);
  const issue = ref ? doc.items.find((i) => `${doc.repo}-${issues.refOf(i)}` === ref) : undefined;
  if (!issue || kindOf(issue) !== "issue" || status(issue) !== "open" || hasAsk(issue)) return;
  const open = goalsOf(issue).some((r) => {
    const g = doc.items.find((i) => `${doc.repo}-${issues.refOf(i)}` === r);
    return g && g !== goal && status(g) === "open";
  });
  if (open) return;
  const id = `${doc.repo}-${issues.refOf(goal)}`;
  setAsk(issue, {
    kind: "input",
    reason: "part-dropped",
    question: `Goal ${id} was dropped: ${reason}. What now?`,
    options: [
      { label: "Close with what landed", line: "Close the issue: the parts that landed are enough." },
      { label: "Plan the missing part", line: "File a new goal for what the dropped goal was to do." },
    ],
    why: [],
  });
  issue.fm.updated = issues.today();
}

/** A new issue for `file` and `closeAndFile`; `goal` files the body as goal `.1` too. */
export interface Filing { title: string; labels?: string[]; areas?: string[]; body?: string; priority?: string; source?: "chris" | "worker" | "deps" | "memory"; ask?: Ask; goal?: boolean }

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
        // `goal`: the body is goal-format, so the issue holds it as its Request and files goal `.1` beside it, as `aleph issue add --goal -` does.
        const item = issues.add(doc, f.title, { labels: f.labels, body: f.goal ? `## Request\n\n${f.body ?? ""}` : f.body, priority: f.priority, source: f.source });
        if (f.areas) item.fm.areas = f.areas;
        if (f.goal) issues.addGoal(doc, item, { title: f.title, body: f.body ?? "" });
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
    .filter((i) => i.sub === undefined && status(i) === "open" && areasOf(i).includes(FLAKES))
    .sort((a, b) => a.id - b.id)[0];
}

/**
 * A note on the flake tracker, adding the tracker first when there is none, as
 * one commit. Chris picks from the tracker's notes which flakes get a goal, so
 * a run that meets an unrelated flake notes it here and files no issue.
 * Returns the tracker's id, or why the write did not happen.
 */
export function noteFlake(repo: Place, text: string): { id: number } | string {
  try {
    const w = writeList(repo, `todo: flake: ${text}`, (doc) => {
      const tracker = flakeTracker(doc) ?? issues.add(doc, "Flaky tests seen by runs", {
        priority: "low",
        labels: [FLAKES],
        route: "triaged",
        body: "Flaky tests that runs met and did not cause. Each note is one flake a run saw. Chris picks from these notes which flakes get a goal.",
      });
      issues.note(tracker, text);
      return { id: tracker.id };
    }, true);
    return w ? w.value : "no flake tracker written";
  } catch (e) {
    return why(e);
  }
}
