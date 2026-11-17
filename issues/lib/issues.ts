/**
 * The `aleph issue` verbs over the work store (store.ts), with explicit
 * arguments: a repo, an issue number, text and options. Each returns what
 * `aleph issue` prints as JSON and throws a `Refusal` when it refuses. No argv,
 * no stdout, no exit code: jobs/cli.ts parses, prints and exits, and starts the
 * detached dispatch that follows an edit; `add` gets the `effects` a new issue
 * starts from its caller. A store `follow` warning
 * comes back in the result for the caller to print.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, extname } from "node:path";
import { key, parseKey, PRIORITIES, SOURCES, STATUSES } from "../../lib/naming.ts";
import { Refusal, refuse } from "../../lib/refusal.ts";
import { git } from "../../lib/git.ts";
import { loadRegistry } from "../../jobs/lib/records/ledger.ts";
import { recentRepos } from "../../jobs/lib/records/status.ts";
import * as issues from "./todo.ts";
import * as store from "./store.ts";
import { askOfItem, awaitsChris, clearAsk, decideAsk, refIn } from "../../jobs/lib/asks/ask.ts";
import { triage } from "./triage.ts";
import { errText } from "../../lib/errtext.ts";
import { isAgent } from "../../lib/env.ts";

/** The fields `add` and `edit` take. `labels` are the issue's areas. `spec` makes an issue buildable, and `after` is what it waits for. */
export interface Fields {
  title?: string;
  kind?: string;
  request?: string;
  spec?: string;
  priority?: string;
  labels?: string[];
  source?: string;
  status?: string;
  after?: string[];
  /** Issues it names as plain references; they hold nothing. */
  refs?: string[];
  /** Local image or PDF files to attach. */
  media?: string[];
}

export const brief = (i: issues.Issue) => ({ id: i.id, title: i.title, status: issues.status(i), priority: i.fm.priority ?? null, updated: issues.updated(i) ?? null, source: store.sourceOf(i), after: store.afterOf(i), refs: store.refsOf(i), areas: store.areasOf(i), plan: store.planSet(i) || undefined, tracker: store.isTracker(i) || undefined, since: i.fm.since ?? undefined, ask: askOfItem(i), notes: i.notes.length });

/** A bad value is refused before anything is written. */
export function checkFields(f: Fields): void {
  if (f.priority !== undefined && !(PRIORITIES as readonly string[]).includes(f.priority)) refuse(`--priority takes ${PRIORITIES.join(", ")}`);
  if (f.kind !== undefined) { const bad = issues.kindProblem(f.kind); if (bad) refuse(`--kind: ${bad}`); }
  if (f.status !== undefined && !(STATUSES as readonly string[]).includes(f.status)) refuse(`--status takes ${STATUSES.join(", ")}`);
}

/** Set what an issue waits for (`after`) or names (`refs`), checked for form and for existence in the items repo. */
function setKeys(i: issues.Issue, field: "after" | "refs", refs: string[]): void {
  const keys = checkKeys(field, refs);
  for (const r of keys) if (!store.hasIssue(parseKey(r)!.n)) refuse(`--${field} ${r} names no issue`);
  i.fm[field] = keys;
}

/** The repo's list in the work store; a refusal when the store has none or the fetch fails. */
function readIssues(repo: store.Place): issues.Doc {
  let doc: issues.Doc | null = null;
  try { doc = store.readList(repo); } catch (e) { refuse(errText(e)); }
  return doc ?? refuse(`the work store has no list for ${repo.key}`);
}

function pick(repo: store.Place, doc: issues.Doc, id: number | string): issues.Issue {
  if (typeof id === "number" && !Number.isInteger(id)) refuse("name an issue by its number");
  return issues.find(doc, id) ?? refuse(`${repo.key} has no issue ${id}`);
}

// Every verb but `add` needs a list on main; `add` starts one.
function write<T>(repo: store.Place, message: string, change: (doc: issues.Doc) => T | null, create = false, blobs?: Record<string, Uint8Array>) {
  return refusing(() => store.writeList(repo, message, change, create, blobs, actor()));
}

/** What `f` returns; an error of the store is thrown as a refusal. */
function refusing<T>(f: () => T): T {
  try {
    return f();
  } catch (e) {
    if (e instanceof Refusal) throw e;
    return refuse(errText(e));
  }
}

/** Chris's answer to an issue with an Ask: not a worker's note (a job id) and not the factory's own. */
export const isAnswer = (text: string, jobId: string | undefined): boolean => !jobId && !/^(intake|triage|job \S+ landed)\b/.test(text);

export interface Added { repo: string; added: number; title: string; commit: string; maybeSame?: { id: number; title: string }[] }

/** The media files to attach, read and checked before anything is written: an image or a PDF of at most MEDIA_BYTES. */
function readMedia(paths: string[]): { name: string; data: Uint8Array }[] {
  return paths.map((p) => {
    const ext = extname(p).slice(1).toLowerCase();
    if (!store.MEDIA_TYPES[ext]) refuse(`media must be ${Object.keys(store.MEDIA_TYPES).join(", ")}: ${p}`);
    if (!existsSync(p)) refuse(`no such file: ${p}`);
    if (statSync(p).size > store.MEDIA_BYTES) refuse(`${p} is over ${store.MEDIA_BYTES / 1024 / 1024} MB`);
    return { name: basename(p).replace(/[^\w.-]/g, "_"), data: readFileSync(p) };
  });
}

/** Put `files` on `item`: each in `blobs`, its name in the item's `media`. A name already there gets a number. */
function attachTo(item: issues.Issue, files: { name: string; data: Uint8Array }[], blobs: Record<string, Uint8Array>): string[] {
  const names = store.mediaOf(item);
  for (const f of files) {
    let name = f.name;
    for (let n = 2; names.includes(name); n++) name = f.name.replace(/(\.[^.]+)$/, `-${n}$1`);
    names.push(name);
    blobs[store.mediaPath(item, name)] = f.data;
  }
  item.fm.media = names;
  return names;
}

/** Attach image or PDF files to item `id`, as one commit. */
export function attach(repo: store.Place, id: number | string, paths: string[]) {
  if (!paths.length) refuse("name a file to attach");
  const files = readMedia(paths);
  const blobs: Record<string, Uint8Array> = {};
  const w = write(repo, `todo: media on item ${id}`, (doc) => {
    const i = pick(repo, doc, id);
    return { id: i.id, media: attachTo(i, files, blobs) };
  }, false, blobs)!;
  return { result: { repo: repo.key, id: w.value.id, media: w.value.media, commit: w.commit }, follow: w.follow };
}

/** The refs of `--after` or `--refs`: each the key `issue.<n>`, or a shown ID such as `a-01234`. */
function checkKeys(field: "after" | "refs", refs: string[]): string[] {
  return refs.map((r) => parseKey(r)?.kind === "issue" ? key("issue", parseKey(r)!.n) : refuse(`--${field} takes issue keys like issue.5: ${r}`));
}

/** Who runs this command: a factory agent (`ALEPH_AGENT`), a Claude Code session (`CLAUDECODE`), else Chris at a shell. */
const actor = (): string => (isAgent() ? "worker" : process.env.CLAUDECODE ? "claude" : "human");

/**
 * Add an issue, with its areas from the triage unless `fields.labels` is given. With `fields.spec` it is buildable as filed;
 * `fields.after` is what it waits for. `item` is the stored issue, `follow` a store warning. It is filed through
 * `store.writeFiling`, which logs `filed` and calls `effects.after`.
 */
export async function add(repo: store.Place, title: string, fields: Fields, effects: store.Effects): Promise<{ result: Added; item: issues.Issue; follow: string | null }> {
  checkFields(fields);
  title = title.trim() || refuse("give the item a title");
  const problem = issues.titleProblem(title);
  if (problem) refuse(problem);
  const spec = fields.spec?.trim();
  if (fields.spec !== undefined && !spec) refuse("--spec - needs the spec on stdin");
  checkKeys("after", fields.after ?? []);
  checkKeys("refs", fields.refs ?? []);
  const files = readMedia(fields.media ?? []);
  const blobs: Record<string, Uint8Array> = {};
  const t = await triage(store.reader().list(repo.key), title, fields.request ?? spec ?? "");
  const w = refusing(() => store.writeFiling(repo, "todo: add an item", actor(), effects, (_, file) => {
    const labels = fields.labels ?? t.labels;
    // Claude Code sets CLAUDECODE in its shells; a label that implies a source still wins over it.
    const implied = labels.some((l) => ["followup", "memory"].includes(l));
    const issue = file({ title, kind: fields.kind, priority: fields.priority, labels, request: fields.request, spec, source: process.env.CLAUDECODE && !implied ? "agent" : undefined, parked: fields.status === "parked" });
    if (fields.after?.length) setKeys(issue, "after", fields.after);
    if (fields.refs?.length) setKeys(issue, "refs", fields.refs);
    if (files.length) attachTo(issue, files, blobs);
    return { issue };
  }, true, blobs))!;
  const { issue } = w.value;
  const result: Added = { repo: repo.key, added: issue.id, title: issue.title, commit: w.commit, ...(t.maybeSame.length ? { maybeSame: t.maybeSame } : {}) };
  return { result, item: issue, follow: w.follow };
}

/** The items of the repo's list that pass `status` and `label`. */
export function list(repo: store.Place, o: { status?: string; label?: string; kind?: string } = {}): issues.Issue[] {
  return filterRows(readIssues(repo), o);
}

function filterRows(doc: issues.Doc, o: { status?: string; label?: string; kind?: string }): issues.Issue[] {
  if (o.status && !STATUSES.includes(o.status as issues.Status)) refuse(`status must be one of ${STATUSES.join(", ")}`);
  return doc.items
    .filter((i) => (o.status ? issues.status(i) === o.status : ["open", "parked"].includes(issues.status(i))))
    .filter((i) => (o.kind ? (i.fm.kind ?? "task") === o.kind : true))
    .filter((i) => (o.label ? store.areasOf(i).includes(o.label) : true));
}

export function show(repo: store.Place, id: number | string): issues.Issue {
  return pick(repo, readIssues(repo), id);
}

/** Add a note; `answer` marks it as Chris's answer, which clears the item's Ask (`answered`). */
export function note(repo: store.Place, id: number | string, text: string, answer = false) {
  text = text.trim() || refuse("give the note some text");
  const w = write(repo, `todo: a note on item ${id}`, (doc) => {
    const i = pick(repo, doc, id);
    const line = issues.note(i, text);
    const answered = answer && awaitsChris(refIn(i));
    return { id: i.id, ref: refIn(i), line, answered };
  })!;
  if (w.value.answered) clearAsk(w.value.ref);
  return { result: { repo: repo.key, id: w.value.id, note: w.value.line, commit: w.commit }, answered: w.value.answered, follow: w.follow };
}

/**
 * Chris's answer to an issue that asks him something, in one write: the decision note, and the Ask cleared. The issue is
 * left to the intake that follows a note. `fields.after` (the UI's option that waits for an issue) sets `after`. On the
 * part-dropped Ask, the plan option sets `plan` and the close option closes the issue. A parked issue with the blocker-dropped Ask can be decided.
 */
export function decide(repo: store.Place, id: number | string, text: string, fields: Fields = {}) {
  checkFields(fields);
  text = text.trim() || refuse("give the decision");
  const w = write(repo, `todo: item ${id}: decided`, (doc) => {
    const i = pick(repo, doc, id);
    const ask = askOfItem(i);
    if (!ask || (issues.status(i) !== "open" && ask.reason !== "blocker-dropped")) refuse(`${repo.key}-${i.id} is not waiting for a decision`);
    issues.note(i, text);
    decideAsk(ask, i, text);
    if (fields.after !== undefined) setKeys(i, "after", fields.after);
    return i;
  })!;
  clearAsk(refIn(w.value));
  return { result: { repo: repo.key, ...brief(w.value), commit: w.commit }, item: w.value, follow: w.follow };
}

export function edit(repo: store.Place, id: number | string, fields: Fields, reason = "") {
  checkFields(fields);
  const title = fields.title?.trim();
  const { kind, request, spec, priority, labels, source, status, after, refs } = fields;
  if (source !== undefined && !(SOURCES as readonly string[]).includes(source)) refuse(`--source takes ${SOURCES.join(", ")}`);
  if (title === undefined && kind === undefined && request === undefined && spec === undefined && priority === undefined && labels === undefined && source === undefined && status === undefined && after === undefined && refs === undefined) refuse("give --title, --request, --spec, --priority, --labels, --after, --refs (or --status, --kind)");
  if (title === "") refuse("the title cannot be empty");
  const kept = after?.filter((r) => r !== "none"), named = refs?.filter((r) => r !== "none");
  const w = write(repo, `todo: edit item ${id}`, (doc) => {
    const i = pick(repo, doc, id);
    for (const r of kept ?? []) if (parseKey(r)?.n === i.id) refuse("an issue cannot wait for itself");
    for (const r of named ?? []) if (parseKey(r)?.n === i.id) refuse("an issue cannot reference itself");
    issues.edit(i, { kind, title, request, spec, priority, areas: labels });
    if (priority !== undefined) for (const p of store.partsOf(doc, i)) if (issues.status(p) === "open") issues.edit(p, { priority });
    if (source !== undefined) i.fm.source = source;
    if (status === "open" && issues.status(i) === "parked") issues.setStatus(i, "open");
    else if (status === "open") store.reopen(doc, i, mainHead(repo));
    else if (status !== undefined) issues.setStatus(i, status as issues.Status);
    if (reason) issues.note(i, reason);
    if (kept !== undefined) setKeys(i, "after", kept);
    if (named !== undefined) setKeys(i, "refs", named);
    return i;
  })!;
  return { result: { repo: repo.key, ...brief(w.value), commit: w.commit }, item: w.value, follow: w.follow };
}

/** The commit at origin/<main> of a registry repo, for `since`; null when it cannot be read. */
function mainHead(repo: store.Place): string | null {
  const r = loadRegistry()[repo.key];
  if (!r) return null;
  const head = git(r.path, "rev-parse", "--verify", "-q", `origin/${r.main}^{commit}`);
  return head.ok ? head.out.trim() : null;
}

/** Close an item as done, or as dropped (which needs a reason); `text` goes on it as a note and as `closed_why`. The write logs the close (store.ts `writeList`). */
export function close(repo: store.Place, id: number | string, how: "done" | "drop", text = "") {
  text = text.trim();
  if (how === "drop" && !text) refuse("say why it is dropped");
  const w = write(repo, `todo: item ${id} ${how === "done" ? "done" : "dropped"}`, (doc) => {
    const i = pick(repo, doc, id);
    issues.setStatus(i, how === "done" ? "done" : "dropped", undefined, text || undefined);
    if (text) issues.note(i, text);
    return i;
  })!;
  return { result: { repo: repo.key, id: w.value.id, status: issues.status(w.value), title: w.value.title, commit: w.commit }, follow: w.follow };
}

export type Finding = ReturnType<typeof issues.lint>[number];

export function lint(repo: store.Place): { repo: string; items: number; findings: Finding[] } {
  const doc = readIssues(repo);
  return { repo: repo.key, items: doc.items.length, findings: issues.lint(doc) };
}

/** Repair what lint can; `remaining` is what is left. */
export function lintFix(repo: store.Place) {
  const w = write(repo, "todo: lint --fix", (doc) => { const fixed = issues.fix(doc); return fixed.length ? { fixed, left: issues.lint(doc) } : null; });
  const remaining = w?.value.left ?? issues.lint(readIssues(repo));
  return { result: { repo: repo.key, fixed: w?.value.fixed ?? [], remaining }, follow: w?.follow ?? null };
}

/** Give each open or parked issue that `titleProblem` refuses a new title from `fit` (the part's `[Group] ` kept), with a note of the old title. Returns the ids changed. */
export async function retitle(repo: store.Place, fit: (group: string, rest: string) => Promise<string>) {
  const bad = (i: issues.Issue) => ["open", "parked"].includes(issues.status(i)) && issues.titleProblem(i.title, { part: issues.parentRef(i) !== undefined });
  const fresh = new Map<string, string>();
  for (const i of readIssues(repo).items.filter(bad)) {
    const group = (issues.parentRef(i) !== undefined && /^\[[^\]]*\] /.exec(i.title)?.[0]) || "";
    fresh.set(issues.refOf(i), await fit(group, i.title.slice(group.length)));
  }
  const w = fresh.size ? write(repo, "todo: retitle", (doc) => {
    const done: { id: string; title: string }[] = [];
    for (const [ref, title] of fresh) {
      const i = issues.find(doc, ref);
      if (!i) continue;
      issues.note(i, `retitled from: ${i.title}`);
      issues.edit(i, { title });
      done.push({ id: ref, title });
    }
    return done.length ? done : null;
  }) : null;
  return { result: { repo: repo.key, retitled: w?.value ?? [] }, follow: w?.follow ?? null };
}

/** The repos with a ledger run or an item update in the last 7 days, the latest first, each with its list (null when the store has none). */
export function recentLists<R extends store.Place>(repos: R[]): { repo: R; doc: issues.Doc | null }[] {
  let docs: (issues.Doc | null)[] = [];
  try { docs = store.readLists(repos); } catch (e) { refuse(errText(e)); }
  return recentRepos(repos, docs).map((n) => ({ repo: repos[n], doc: docs[n] }));
}

/** `list` with no repo: each recent repo's rows that pass the filter. */
export function listRecent<R extends store.Place>(repos: R[], o: { status?: string; label?: string; kind?: string } = {}): { repo: R; items: issues.Issue[] }[] {
  return recentLists(repos).filter((r) => r.doc).map(({ repo, doc }) => ({ repo, items: filterRows(doc!, o) })).filter((r) => r.items.length);
}

/** `lint` with no repo: each recent repo's findings. */
export function lintRecent<R extends store.Place>(repos: R[]) {
  return recentLists(repos).filter((r) => r.doc).map(({ repo, doc }) => ({ repo: repo.key, items: doc!.items.length, findings: issues.lint(doc!) }));
}
