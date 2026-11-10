/**
 * The `aleph issue` verbs over the work store (store.ts), with explicit
 * arguments: a repo, an issue number, text and options. Each returns what
 * `aleph issue` prints as JSON and throws a `Refusal` when it refuses. No argv,
 * no stdout, no exit code: jobs/cli.ts parses, prints and exits, and starts the
 * detached dispatch and intake that follow a write. A store `follow` warning
 * comes back in the result for the caller to print.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, extname } from "node:path";
import { FULL } from "../../lib/naming.ts";
import { Refusal, refuse } from "../../lib/refusal.ts";
import { logEvent } from "../../jobs/lib/infra/layout.ts";
import { git } from "../../jobs/lib/infra/git.ts";
import { loadRegistry } from "../../jobs/lib/records/ledger.ts";
import { recentRepos } from "../../jobs/lib/records/status.ts";
import * as issues from "./todo.ts";
import * as store from "./store.ts";
import { askIfPartDropped, askOf, awaitsChris, clearAsk, decideAsk, refIn } from "../../jobs/lib/asks/ask.ts";
import { triage } from "./triage.ts";

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
  /** Local image or PDF files to attach. */
  media?: string[];
}

export const brief = (key: string) => (i: issues.Issue) => ({ id: i.id, ...(i.sub === undefined ? {} : { ref: issues.refOf(i) }), title: i.title, status: issues.status(i), priority: i.fm.priority ?? null, updated: i.fm.updated_time ?? null, source: store.sourceOf(i), after: store.afterOf(i), areas: store.areasOf(i), plan: store.planSet(i) || undefined, tracker: store.isTracker(i) || undefined, since: i.fm.since ?? undefined, ask: askOf(refIn(key, i)), notes: i.notes.length });

/** A bad value is refused before anything is written. */
export function checkFields(f: Fields): void {
  if (f.priority !== undefined && !(issues.PRIORITIES as readonly string[]).includes(f.priority)) refuse(`--priority takes ${issues.PRIORITIES.join(", ")}`);
  if (f.kind !== undefined) { const bad = issues.kindProblem(f.kind); if (bad) refuse(`--kind: ${bad}`); }
  if (f.status !== undefined && !(issues.STATUSES as readonly string[]).includes(f.status)) refuse(`--status takes ${issues.STATUSES.join(", ")}`);
}

/** Set what an issue waits for (`after`), checked for form and, in this repo, for existence. */
function setAfter(repo: store.Place, doc: issues.Doc, i: issues.Issue, after: string[]): void {
  checkAfter(after);
  for (const r of after) if (r.startsWith(`${repo.key}-`) && !issues.find(doc, r.slice(repo.key.length + 1))) refuse(`--after ${r} names no issue`);
  i.fm.after = after;
  issues.touch(i);
}

/** The repo's list in the work store; a refusal when the store has none or the fetch fails. */
export function readIssues(repo: store.Place): issues.Doc {
  let doc: issues.Doc | null = null;
  try { doc = store.readList(repo); } catch (e: any) { refuse(e?.message ?? String(e)); }
  return doc ?? refuse(`the work store has no list for ${repo.key}`);
}

function pick(repo: store.Place, doc: issues.Doc, id: number | string): issues.Issue {
  if (typeof id === "number" && !Number.isInteger(id)) refuse("name an issue by its number");
  return issues.find(doc, id) ?? refuse(`${repo.key} has no issue ${id}`);
}

// Every verb but `add` needs a list on main; `add` starts one.
function write<T>(repo: store.Place, message: string, change: (doc: issues.Doc) => T | null, create = false, blobs?: Record<string, Uint8Array>) {
  try {
    return store.writeList(repo, message, change, create, blobs);
  } catch (e: any) {
    if (e instanceof Refusal) throw e;
    return refuse(e?.message ?? String(e));
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
function attachTo(key: string, item: issues.Issue, files: { name: string; data: Uint8Array }[], blobs: Record<string, Uint8Array>): string[] {
  const names = store.mediaOf(item);
  for (const f of files) {
    let name = f.name;
    for (let n = 2; names.includes(name); n++) name = f.name.replace(/(\.[^.]+)$/, `-${n}$1`);
    names.push(name);
    blobs[store.mediaPath(key, item, name)] = f.data;
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
    return { id: i.id, media: attachTo(repo.key, i, files, blobs) };
  }, false, blobs)!;
  return { result: { repo: repo.key, id: w.value.id, media: w.value.media, commit: w.commit }, follow: w.follow };
}

/** A ref for `--after`: `<repo>-<n>` or `<repo>-<n>.<k>`. */
function checkAfter(after: string[]): void {
  for (const r of after) if (!FULL.test(r)) refuse(`--after takes ids like <repo>-<n> or <repo>-<n>.<k>: ${r}`);
}

/**
 * Add an issue, with its areas from the triage unless `fields.labels` is given. With `fields.spec` it is buildable as filed;
 * `fields.after` is what it waits for. `item` is the stored issue, `follow` a store warning.
 */
export async function add(repo: store.Place, title: string, fields: Fields = {}): Promise<{ result: Added; item: issues.Issue; follow: string | null }> {
  checkFields(fields);
  title = title.trim() || refuse("give the item a title");
  const problem = issues.titleProblem(title);
  if (problem) refuse(problem);
  const spec = fields.spec?.trim();
  if (fields.spec !== undefined && !spec) refuse("--spec - needs the spec on stdin");
  checkAfter(fields.after ?? []);
  const files = readMedia(fields.media ?? []);
  const blobs: Record<string, Uint8Array> = {};
  const t = await triage(store.reader().list(repo.key), title, fields.request ?? spec ?? "");
  const w = write(repo, "todo: add an item", (doc) => {
    const labels = fields.labels ?? t.labels;
    // Claude Code sets CLAUDECODE in its shells; a label that implies a source still wins over it.
    const implied = labels.some((l) => ["followup", "memory"].includes(l));
    const issue = issues.add(doc, title, { kind: fields.kind, priority: fields.priority, labels, request: fields.request, spec, source: process.env.CLAUDECODE && !implied ? "agent" : undefined });
    if (fields.status === "parked") issues.setStatus(issue, "parked");
    if (fields.after?.length) setAfter(repo, doc, issue, fields.after);
    if (files.length) attachTo(repo.key, issue, files, blobs);
    return { issue };
  }, true, blobs)!;
  const { issue } = w.value;
  logEvent({ by: "rule", subject: refIn(repo.key, issue), action: "filed" });
  const result: Added = { repo: repo.key, added: issue.id, title: issue.title, commit: w.commit, ...(t.maybeSame.length ? { maybeSame: t.maybeSame } : {}) };
  return { result, item: issue, follow: w.follow };
}

/** The items of the repo's list that pass `status` and `label`. */
export function list(repo: store.Place, o: { status?: string; label?: string; kind?: string } = {}): issues.Issue[] {
  return filterRows(readIssues(repo), o);
}

export function filterRows(doc: issues.Doc, o: { status?: string; label?: string; kind?: string }): issues.Issue[] {
  if (o.status && !issues.STATUSES.includes(o.status as issues.Status)) refuse(`status must be one of ${issues.STATUSES.join(", ")}`);
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
    const answered = answer && awaitsChris(refIn(repo.key, i));
    return { id: i.id, ref: refIn(repo.key, i), line, answered };
  })!;
  if (w.value.answered) clearAsk(w.value.ref);
  return { result: { repo: repo.key, id: w.value.id, note: w.value.line, commit: w.commit }, answered: w.value.answered, follow: w.follow };
}

/**
 * Chris's answer to an issue that asks him something, in one write: the decision note, and the Ask cleared. The issue is
 * left to the intake that follows a note. `fields.after` (the UI's option that waits for an issue) sets `after`. On the
 * part-dropped Ask, the plan option sets `plan` and the close option closes the issue.
 */
export function decide(repo: store.Place, id: number | string, text: string, fields: Fields = {}) {
  checkFields(fields);
  text = text.trim() || refuse("give the decision");
  const w = write(repo, `todo: item ${id}: decided`, (doc) => {
    const i = pick(repo, doc, id);
    const ask = askOf(refIn(repo.key, i));
    if (issues.status(i) !== "open" || !ask) refuse(`${repo.key}-${i.id} is not waiting for a decision`);
    issues.note(i, text);
    decideAsk(ask, i, text);
    if (fields.after !== undefined) setAfter(repo, doc, i, fields.after);
    return i;
  })!;
  clearAsk(refIn(repo.key, w.value));
  return { result: { repo: repo.key, ...brief(repo.key)(w.value), commit: w.commit }, item: w.value, follow: w.follow };
}

export function edit(repo: store.Place, id: number | string, fields: Fields, reason = "") {
  checkFields(fields);
  const title = fields.title?.trim();
  const { kind, request, spec, priority, labels, source, status, after } = fields;
  if (source !== undefined && !["chris", "worker", "deps", "memory", "agent"].includes(source)) refuse("--source takes chris, worker, deps, memory, agent");
  if (title === undefined && kind === undefined && request === undefined && spec === undefined && priority === undefined && labels === undefined && source === undefined && status === undefined && after === undefined) refuse("give --title, --request, --spec, --priority, --labels, --after (or --status, --kind)");
  if (title === "") refuse("the title cannot be empty");
  const kept = after?.filter((r) => r !== "none");
  const w = write(repo, `todo: edit item ${id}`, (doc) => {
    const i = pick(repo, doc, id);
    for (const r of kept ?? []) if (r === `${repo.key}-${issues.refOf(i)}`) refuse("an issue cannot wait for itself");
    issues.edit(i, { kind, title, request, spec, priority, areas: labels });
    if (priority !== undefined) for (const p of store.partsOf(doc, i)) if (issues.status(p) === "open") issues.edit(p, { priority });
    if (source !== undefined) i.fm.source = source;
    if (status === "open" && issues.status(i) === "parked") issues.setStatus(i, "open");
    else if (status === "open") store.reopen(doc, i, mainHead(repo));
    else if (status !== undefined) issues.setStatus(i, status as issues.Status);
    if (reason) issues.note(i, reason);
    if (kept !== undefined) setAfter(repo, doc, i, kept);
    return i;
  })!;
  return { result: { repo: repo.key, ...brief(repo.key)(w.value), commit: w.commit }, item: w.value, follow: w.follow };
}

/** The commit at origin/<main> of a registry repo, for `since`; null when it cannot be read. */
function mainHead(repo: store.Place): string | null {
  const r = loadRegistry()[repo.key];
  if (!r) return null;
  const head = git(r.path, "rev-parse", "--verify", "-q", `origin/${r.main}^{commit}`);
  return head.ok ? head.out.trim() : null;
}

/** Close an item as done, or as dropped (which needs a reason); `text` goes on it as a note. */
export function close(repo: store.Place, id: number | string, how: "done" | "drop", text = "") {
  text = text.trim();
  if (how === "drop" && !text) refuse("say why it is dropped");
  const w = write(repo, `todo: item ${id} ${how === "done" ? "done" : "dropped"}`, (doc) => {
    const i = pick(repo, doc, id);
    issues.setStatus(i, how === "done" ? "done" : "dropped", undefined, text || undefined);
    if (text) issues.note(i, text);
    if (how === "drop") askIfPartDropped(doc, i, text);
    return i;
  })!;
  if (how === "drop") clearAsk(refIn(repo.key, w.value));
  logEvent({ by: "rule", subject: refIn(repo.key, w.value), action: how === "done" ? "done" : "dropped" });
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
  try { docs = store.readLists(repos); } catch (e: any) { refuse(e?.message ?? String(e)); }
  return recentRepos(repos as any, docs).map((n) => ({ repo: repos[n], doc: docs[n] }));
}

/** `list` with no repo: each recent repo's rows that pass the filter. */
export function listRecent<R extends store.Place>(repos: R[], o: { status?: string; label?: string; kind?: string } = {}): { repo: R; items: issues.Issue[] }[] {
  return recentLists(repos).filter((r) => r.doc).map(({ repo, doc }) => ({ repo, items: filterRows(doc!, o) })).filter((r) => r.items.length);
}

/** `lint` with no repo: each recent repo's findings. */
export function lintRecent<R extends store.Place>(repos: R[]) {
  return recentLists(repos).filter((r) => r.doc).map(({ repo, doc }) => ({ repo: repo.key, items: doc!.items.length, findings: issues.lint(doc!) }));
}
