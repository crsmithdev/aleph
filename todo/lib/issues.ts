/**
 * The `aleph issue` verbs over the work store (store.ts), with explicit
 * arguments: a repo, an issue number, text and options. Each returns what
 * `aleph issue` prints as JSON and throws a `Refusal` when it refuses. No argv,
 * no stdout, no exit code: jobs/cli.ts parses, prints and exits, and starts the
 * detached dispatch and triage that follow a write. A store `follow` warning
 * comes back in the result for the caller to print.
 */
import { Refusal, refuse } from "../../jobs/lib/transitions.ts";
import { git } from "../../jobs/lib/git.ts";
import { loadRegistry } from "../../jobs/lib/ledger.ts";
import { recentRepos } from "../../jobs/lib/status.ts";
import * as issues from "./todo.ts";
import * as store from "./store.ts";
import { triage } from "./triage.ts";

/** The fields `add` and `edit` take. `labels` are the issue's areas. `spec` makes an issue buildable, and `after` is what it waits for. */
export interface Fields {
  title?: string;
  request?: string;
  spec?: string;
  priority?: string;
  labels?: string[];
  source?: string;
  status?: string;
  after?: string[];
}

export const brief = (i: issues.Issue) => ({ id: i.id, ...(i.sub === undefined ? {} : { ref: issues.refOf(i) }), title: i.title, status: issues.status(i), priority: i.fm.priority ?? null, updated: i.fm.updated ?? null, source: store.sourceOf(i), after: store.afterOf(i), areas: store.areasOf(i), plan: store.planSet(i) || undefined, tracker: store.isTracker(i) || undefined, since: i.fm.since ?? undefined, ask: store.askOf(i), notes: i.notes.length });

/** A bad value is refused before anything is written. */
export function checkFields(f: Fields): void {
  if (f.status !== undefined && !(issues.STATUSES as readonly string[]).includes(f.status)) refuse(`--status takes ${issues.STATUSES.join(", ")}`);
}

/** Set what an issue waits for (`after`), checked for form and, in this repo, for existence. */
function setAfter(repo: store.Place, doc: issues.Doc, i: issues.Issue, after: string[]): void {
  checkAfter(after);
  for (const r of after) if (r.startsWith(`${repo.key}-`) && !issues.find(doc, r.slice(repo.key.length + 1))) refuse(`--after ${r} names no issue`);
  i.fm.after = after;
  i.fm.updated = issues.today();
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

/** An issue's hidden check files in the store. */
const readHiddenOf = (repo: store.Place, g: issues.Issue): Record<string, string> => {
  try { return store.readHidden(repo, `${repo.key}-${issues.refOf(g)}`); } catch (e: any) { return refuse(e?.message ?? String(e)); }
};

/** The names of an issue's hidden check files. */
export function hiddenList(repo: store.Place, id: number | string): string[] {
  return Object.keys(readHiddenOf(repo, pick(repo, readIssues(repo), id)));
}

/** Store `files` as the issue's hidden checks, in `<repo>/hidden/<repo>-<id>/`. */
export function hiddenAdd(repo: store.Place, id: number | string, files: Record<string, string>) {
  const g = pick(repo, readIssues(repo), id);
  const ref = `${repo.key}-${issues.refOf(g)}`;
  try {
    const w = store.writeHidden(repo, ref, files);
    return { result: { repo: repo.key, id: ref, hidden: Object.keys(files), commit: w.commit }, follow: w.follow };
  } catch (e: any) {
    if (e instanceof Refusal) throw e;
    return refuse(e?.message ?? String(e));
  }
}

// Every verb but `add` needs a list on main; `add` starts one.
function write<T>(repo: store.Place, message: string, change: (doc: issues.Doc) => T | null, create = false) {
  try {
    return store.writeList(repo, message, change, create);
  } catch (e: any) {
    if (e instanceof Refusal) throw e;
    return refuse(e?.message ?? String(e));
  }
}

/** Chris's answer to an issue with an Ask: not a worker's note (a job id) and not the factory's own. */
export const isAnswer = (text: string, jobId: string | undefined): boolean => !jobId && !/^(triage|job \S+ landed)\b/.test(text);

export interface Added { repo: string; added: number; title: string; commit: string; maybeSame?: { id: number; title: string }[] }

/** A ref for `--after`: `<repo>-<n>` or `<repo>-<n>.<k>`. */
function checkAfter(after: string[]): void {
  for (const r of after) if (!/^[^\s,]+-\d+(\.\d+)?$/.test(r)) refuse(`--after takes ids like <repo>-<n> or <repo>-<n>.<k>: ${r}`);
}

/**
 * Add an issue, with its areas from the triage unless `fields.labels` is given. With `fields.spec` it is buildable as filed;
 * `fields.after` is what it waits for. `item` is the stored issue, `follow` a store warning.
 */
export async function add(repo: store.Place, title: string, fields: Fields = {}): Promise<{ result: Added; item: issues.Issue; follow: string | null }> {
  checkFields(fields);
  title = title.trim() || refuse("give the item a title");
  const spec = fields.spec?.trim();
  if (fields.spec !== undefined && !spec) refuse("--spec - needs the spec on stdin");
  checkAfter(fields.after ?? []);
  const t = await triage(store.reader().list(repo.key), title, fields.request ?? spec ?? "");
  const w = write(repo, "todo: add an item", (doc) => {
    const issue = issues.add(doc, title, { priority: fields.priority, labels: fields.labels ?? t.labels, request: fields.request, spec });
    if (fields.after?.length) setAfter(repo, doc, issue, fields.after);
    return { issue };
  }, true)!;
  const { issue } = w.value;
  const result: Added = { repo: repo.key, added: issue.id, title: issue.title, commit: w.commit, ...(t.maybeSame.length ? { maybeSame: t.maybeSame } : {}) };
  return { result, item: issue, follow: w.follow };
}

/** The items of the repo's list that pass `status` and `label`. */
export function list(repo: store.Place, o: { status?: string; label?: string } = {}): issues.Issue[] {
  return filterRows(readIssues(repo), o);
}

export function filterRows(doc: issues.Doc, o: { status?: string; label?: string }): issues.Issue[] {
  if (o.status && !issues.STATUSES.includes(o.status as issues.Status)) refuse(`status must be one of ${issues.STATUSES.join(", ")}`);
  return doc.items
    .filter((i) => (o.status ? issues.status(i) === o.status : true))
    .filter((i) => (o.label ? store.areasOf(i).includes(o.label) : true));
}

/** How many hidden check files an item has in the store. */
export const hiddenCount = (repo: store.Place, id: number | string): number => Object.keys(store.readHidden(repo, typeof id === "number" ? id : `${repo.key}-${id}`)).length;

export function show(repo: store.Place, id: number | string): { item: issues.Issue; hidden: number } {
  const item = pick(repo, readIssues(repo), id);
  return { item, hidden: hiddenCount(repo, id) };
}

/** Add a note; `answer` marks it as Chris's answer, which clears the item's Ask (`answered`). */
export function note(repo: store.Place, id: number | string, text: string, answer = false) {
  text = text.trim() || refuse("give the note some text");
  const w = write(repo, `todo: a note on item ${id}`, (doc) => {
    const i = pick(repo, doc, id);
    const line = issues.note(i, text);
    const answered = answer && store.awaitsChris(i);
    if (answered) store.clearAsk(i);
    return { id: i.id, line, answered };
  })!;
  return { result: { repo: repo.key, id: w.value.id, note: w.value.line, commit: w.commit }, answered: w.value.answered, follow: w.follow };
}

/**
 * Chris's answer to an issue that asks him something, in one write: the decision note, and the Ask cleared. The issue is
 * left to the triage that follows a note. `fields.after` (the UI's option that waits for an issue) sets `after`. On the
 * part-dropped Ask, the plan option sets `plan` and the close option closes the issue.
 */
export function decide(repo: store.Place, id: number | string, text: string, fields: Fields = {}) {
  checkFields(fields);
  text = text.trim() || refuse("give the decision");
  const w = write(repo, `todo: item ${id}: decided`, (doc) => {
    const i = pick(repo, doc, id);
    if (issues.status(i) !== "open" || !store.awaitsChris(i)) refuse(`${repo.key}-${i.id} is not waiting for a decision`);
    const ask = store.askOf(i);
    issues.note(i, text);
    store.clearAsk(i);
    if (ask?.reason === "part-dropped") {
      const planRest = ask.options.find((o) => o.label === store.PLAN_REST);
      if (planRest && (text.includes(planRest.label) || text.includes(planRest.line))) i.fm.plan = "true";
      else issues.setStatus(i, "done");
    }
    if (fields.after !== undefined) setAfter(repo, doc, i, fields.after);
    return i;
  })!;
  return { result: { repo: repo.key, ...brief(w.value), commit: w.commit }, item: w.value, follow: w.follow };
}

export function edit(repo: store.Place, id: number | string, fields: Fields) {
  checkFields(fields);
  const title = fields.title?.trim();
  const { request, spec, priority, labels, source, status, after } = fields;
  if (source !== undefined && !["chris", "worker", "deps", "memory"].includes(source)) refuse("--source takes chris, worker, deps, memory");
  if (title === undefined && request === undefined && spec === undefined && priority === undefined && labels === undefined && source === undefined && status === undefined && after === undefined) refuse("give --title, --request, --spec, --priority, --labels, --after (or --status)");
  if (title === "") refuse("the title cannot be empty");
  const kept = after?.filter((r) => r !== "none");
  const w = write(repo, `todo: edit item ${id}`, (doc) => {
    const i = pick(repo, doc, id);
    for (const r of kept ?? []) if (r === `${repo.key}-${issues.refOf(i)}`) refuse("an issue cannot wait for itself");
    issues.edit(i, { title, request, spec, priority, areas: labels });
    if (source !== undefined) i.fm.source = source;
    if (status === "open") store.reopen(doc, i, mainHead(repo));
    else if (status !== undefined) issues.setStatus(i, status as issues.Status);
    if (kept !== undefined) setAfter(repo, doc, i, kept);
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

/** Close an item as done, or as dropped (which needs a reason); `text` goes on it as a note. */
export function close(repo: store.Place, id: number | string, how: "done" | "drop", text = "") {
  text = text.trim();
  if (how === "drop" && !text) refuse("say why it is dropped");
  const w = write(repo, `todo: item ${id} ${how === "done" ? "done" : "dropped"}`, (doc) => {
    const i = pick(repo, doc, id);
    issues.setStatus(i, how === "done" ? "done" : "dropped", undefined, text || undefined);
    if (text) issues.note(i, text);
    if (how === "drop") store.askIfPartDropped(doc, i, text);
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

/** The repos with a ledger run or an item update in the last 7 days, the latest first, each with its list (null when the store has none). */
export function recentLists<R extends store.Place>(repos: R[]): { repo: R; doc: issues.Doc | null }[] {
  let docs: (issues.Doc | null)[] = [];
  try { docs = store.readLists(repos); } catch (e: any) { refuse(e?.message ?? String(e)); }
  return recentRepos(repos as any, docs).map((n) => ({ repo: repos[n], doc: docs[n] }));
}

/** `list` with no repo: each recent repo's rows that pass the filter. */
export function listRecent<R extends store.Place>(repos: R[], o: { status?: string; label?: string } = {}): { repo: R; items: issues.Issue[] }[] {
  return recentLists(repos).filter((r) => r.doc).map(({ repo, doc }) => ({ repo, items: filterRows(doc!, o) })).filter((r) => r.items.length);
}

/** `lint` with no repo: each recent repo's findings. */
export function lintRecent<R extends store.Place>(repos: R[]) {
  return recentLists(repos).filter((r) => r.doc).map(({ repo, doc }) => ({ repo: repo.key, items: doc!.items.length, findings: issues.lint(doc!) }));
}
