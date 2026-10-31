/**
 * The `aleph issue` verbs over the work store (store.ts), with explicit
 * arguments: a repo, an issue number, text and options. Each returns what
 * `aleph issue` prints as JSON and throws a `Refusal` when it refuses. No argv,
 * no stdout, no exit code: jobs/cli.ts parses, prints and exits, and starts the
 * detached dispatch and triage that follow a write. A store `follow` warning
 * comes back in the result for the caller to print.
 */
import { Refusal, refuse } from "../../jobs/lib/transitions.ts";
import { recentRepos } from "../../jobs/lib/status.ts";
import * as todos from "./todo.ts";
import * as store from "./store.ts";
import { triage } from "./triage.ts";

/**
 * The fields `add` and `edit` take; `due` takes `none` to remove the field. `labels` are the issue's areas.
 * `waitingOn` is for in-process callers (the UI's Wait button and decide route): `aleph issue` refuses `--waiting-on`.
 * `goal` is the goal-format text that `add` files as goal `.1`, and `after` the goals that goal waits for.
 */
export interface Fields {
  title?: string;
  body?: string;
  priority?: string;
  labels?: string[];
  due?: string;
  waitingOn?: string;
  status?: string;
  goal?: string;
  after?: string[];
}

export const brief = (i: todos.Issue) => ({ id: i.id, ...(i.sub === undefined ? {} : { ref: todos.refOf(i) }), title: i.title, status: todos.status(i), priority: i.fm.priority ?? null, updated: i.fm.updated ?? null, due: i.fm.due ?? null, kind: store.kindOf(i), source: store.sourceOf(i), issue: store.issueOf(i), goals: store.goalsOf(i), after: store.afterOf(i), areas: store.areasOf(i), ask: store.askOf(i), notes: i.notes.length, legacy: i.legacy || undefined });

/** A bad value is refused before anything is written. */
export function checkFields(f: Fields): void {
  if (f.due !== undefined && f.due !== "none" && !todos.validDate(f.due)) refuse("--due takes YYYY-MM-DD or none");
  if (f.status !== undefined && !(todos.STATUSES as readonly string[]).includes(f.status)) refuse(`--status takes ${todos.STATUSES.join(", ")}`);
  if (f.waitingOn !== undefined && f.waitingOn !== "none" && !(todos.waitParts(f.waitingOn).length && todos.waitParts(f.waitingOn).every((p) => todos.parseRef(p)))) refuse("--waiting-on takes <repo>-<n>[,<repo>-<n>...] or none");
}

/** The repo's list in the work store; a refusal when the store has none or the fetch fails. */
export function readIssues(repo: store.Place): todos.Doc {
  let doc: todos.Doc | null = null;
  try { doc = store.readList(repo); } catch (e: any) { refuse(e?.message ?? String(e)); }
  return doc ?? refuse(`the work store has no list for ${repo.key}`);
}

function pick(repo: store.Place, doc: todos.Doc, id: number): todos.Issue {
  if (!Number.isInteger(id)) refuse("name an issue by its number");
  return todos.find(doc, id) ?? refuse(`${repo.key} has no issue ${id}`);
}

// Every verb but `add` needs a list on main; `add` starts one.
function write<T>(repo: store.Place, message: string, change: (doc: todos.Doc) => T | null, create = false) {
  try {
    return store.writeList(repo, message, change, create);
  } catch (e: any) {
    if (e instanceof Refusal) throw e;
    return refuse(e?.message ?? String(e));
  }
}

/** Chris's answer to a `needs-chris` issue: not a worker's note (a job id) and not the factory's own. */
export const isAnswer = (text: string, jobId: string | undefined): boolean => !jobId && !/^(triage|job \S+ landed)\b/.test(text);

export interface Added { repo: string; added: number; title: string; commit: string; goal?: string; maybeSame?: { id: number; title: string }[] }

/** A goal ref (`<repo>-<n>.<k>`) for `--after`; an issue's ref has no `.<k>` and is refused. */
function checkAfter(after: string[]): void {
  for (const r of after) {
    if (!/^[^\s,]+-\d+\.\d+$/.test(r)) refuse(/^[^\s,]+-\d+$/.test(r) ? `--after takes goal ids: ${r} is an issue` : `--after takes goal ids like <repo>-<n>.<k>: ${r}`);
  }
}

/**
 * Add an issue, with its areas from the triage unless `fields.labels` is given. With `fields.goal` (goal-format text) the
 * issue is filed with a `## Request` holding that text as written and with goal `.1`, in one commit; `fields.after` is the goal's order.
 * `item` is the stored issue, `goal` the goal beside it, `follow` a store warning.
 */
export async function add(repo: store.Place, title: string, fields: Fields = {}): Promise<{ result: Added; item: todos.Issue; goal?: todos.Goal; follow: string | null }> {
  checkFields(fields);
  title = title.trim() || refuse("give the item a title");
  if (fields.waitingOn !== undefined) refuse("an issue does not take --waiting-on: file a goal with --goal - and --after <goal id>");
  const text = fields.goal?.trim();
  if (fields.goal !== undefined && !text) refuse("--goal - needs the goal text on stdin");
  if (text && fields.body !== undefined) refuse("--goal - takes the text from stdin: leave --body off");
  if (fields.after?.length && text === undefined) refuse("--after goes with --goal -");
  checkAfter(fields.after ?? []);
  const t = await triage(store.reader().list(repo.key), title, fields.body ?? text ?? "");
  const w = write(repo, "todo: add an item", (doc) => {
    const issue = todos.add(doc, title, { priority: fields.priority, labels: fields.labels ?? t.labels, body: text ? `## Request\n\n${text}` : fields.body, due: fields.due });
    if (!text) return { issue };
    const own = (fields.after ?? []).filter((r) => r.startsWith(`${repo.key}-`));
    for (const r of own) if (!todos.find(doc, r.slice(repo.key.length + 1))) refuse(`--after ${r} names no goal`);
    return { issue, goal: todos.addGoal(doc, issue, { title, body: text, after: fields.after ?? [] }) };
  }, true)!;
  const { issue, goal } = w.value;
  const result: Added = { repo: repo.key, added: issue.id, title: issue.title, commit: w.commit, ...(goal ? { goal: `${repo.key}-${todos.refOf(goal)}` } : {}), ...(t.maybeSame.length ? { maybeSame: t.maybeSame } : {}) };
  return { result, item: issue, goal, follow: w.follow };
}

/** The items of the repo's list that pass `status` and `label`. */
export function list(repo: store.Place, o: { status?: string; label?: string } = {}): todos.Issue[] {
  return filterRows(readIssues(repo), o);
}

export function filterRows(doc: todos.Doc, o: { status?: string; label?: string }): todos.Issue[] {
  if (o.status && !todos.STATUSES.includes(o.status as todos.Status)) refuse(`status must be one of ${todos.STATUSES.join(", ")}`);
  return doc.items
    .filter((i) => (o.status ? todos.status(i) === o.status : true))
    .filter((i) => (o.label ? store.areasOf(i).includes(o.label) : true));
}

/** How many hidden check files an item has in the store. */
export const hiddenCount = (repo: store.Place, id: number): number => Object.keys(store.readHidden(repo, id)).length;

export function show(repo: store.Place, id: number): { item: todos.Issue; hidden: number } {
  const item = pick(repo, readIssues(repo), id);
  return { item, hidden: hiddenCount(repo, id) };
}

/** The names of an item's hidden check files. */
export function hiddenList(repo: store.Place, id: number): string[] {
  const i = pick(repo, readIssues(repo), id);
  try { return Object.keys(store.readHidden(repo, i.id)); } catch (e: any) { return refuse(e?.message ?? String(e)); }
}

/** Store `files` (name to content) as the item's hidden checks. */
export function hiddenAdd(repo: store.Place, id: number, files: Record<string, string>): { result: { repo: string; id: number; hidden: string[]; commit: string }; follow: string | null } {
  const i = pick(repo, readIssues(repo), id);
  try {
    const w = store.writeHidden(repo, i.id, files);
    return { result: { repo: repo.key, id: i.id, hidden: Object.keys(files), commit: w.commit }, follow: w.follow };
  } catch (e: any) {
    if (e instanceof Refusal) throw e;
    return refuse(e?.message ?? String(e));
  }
}

/** Add a note; `answer` marks it as Chris's answer, which clears the item's Ask (`answered`). */
export function note(repo: store.Place, id: number, text: string, answer = false) {
  text = text.trim() || refuse("give the note some text");
  const w = write(repo, `todo: a note on item ${id}`, (doc) => {
    const i = pick(repo, doc, id);
    const line = todos.note(i, text);
    const answered = answer && store.awaitsChris(i);
    if (answered) store.clearAsk(i);
    return { id: i.id, line, answered };
  })!;
  return { result: { repo: repo.key, id: w.value.id, note: w.value.line, commit: w.commit }, answered: w.value.answered, follow: w.follow };
}

/**
 * Chris's answer to an issue that asks him something, in one write: the decision note, and the Ask cleared. The issue is
 * left to the triage that follows a note. `fields.waitingOn` (the UI's option that waits on another issue) sets `waiting_on`.
 */
export function decide(repo: store.Place, id: number, text: string, fields: Fields = {}) {
  checkFields(fields);
  text = text.trim() || refuse("give the decision");
  const w = write(repo, `todo: item ${id}: decided`, (doc) => {
    const i = pick(repo, doc, id);
    if (todos.status(i) !== "open" || !store.awaitsChris(i)) refuse(`${repo.key}-${i.id} is not waiting for a decision`);
    todos.note(i, text);
    store.clearAsk(i);
    // The old shape stored the decision's own kind (product or build) in `kind`.
    if (i.fm.kind === "product" || i.fm.kind === "build") delete i.fm.kind;
    if (fields.waitingOn !== undefined) todos.setWaitingOn(i, fields.waitingOn);
    return i;
  })!;
  return { result: { repo: repo.key, ...brief(w.value), commit: w.commit }, item: w.value, follow: w.follow };
}

export function edit(repo: store.Place, id: number, fields: Fields) {
  checkFields(fields);
  const title = fields.title?.trim();
  const { body, priority, labels, due, waitingOn, status } = fields;
  if (title === undefined && body === undefined && priority === undefined && labels === undefined && due === undefined && waitingOn === undefined && status === undefined) refuse("give --title, --body, --priority, --labels, --due (or --status)");
  if (title === "") refuse("the title cannot be empty");
  const w = write(repo, `todo: edit item ${id}`, (doc) => {
    const i = pick(repo, doc, id);
    todos.edit(i, { title, body, priority, areas: labels, due, waitingOn });
    if (status !== undefined) todos.setStatus(i, status as todos.Status);
    return i;
  })!;
  return { result: { repo: repo.key, ...brief(w.value), commit: w.commit }, item: w.value, follow: w.follow };
}

/** Close an item as done, or as dropped (which needs a reason); `text` goes on it as a note. */
export function close(repo: store.Place, id: number, how: "done" | "drop", text = "") {
  text = text.trim();
  if (how === "drop" && !text) refuse("say why it is dropped");
  const w = write(repo, `todo: item ${id} ${how === "done" ? "done" : "dropped"}`, (doc) => {
    const i = pick(repo, doc, id);
    todos.setStatus(i, how === "done" ? "done" : "dropped");
    if (text) todos.note(i, text);
    return i;
  })!;
  return { result: { repo: repo.key, id: w.value.id, status: todos.status(w.value), title: w.value.title, commit: w.commit }, follow: w.follow };
}

/** Whether `<repo>-<n>` names an item in the work store; `own` is the list already read for `key`. */
export function itemExists(key: string, registry: Record<string, unknown>, own?: todos.Doc): (repo: string, id: number) => boolean {
  const lists = store.reader();
  return (r, id) => (own && r === key ? todos.find(own, id) : registry[r] ? lists.item(r, id) : undefined) !== undefined;
}

export type Finding = ReturnType<typeof todos.lint>[number];

export function lint(repo: store.Place, registry: Record<string, unknown>): { repo: string; items: number; findings: Finding[] } {
  const doc = readIssues(repo);
  return { repo: repo.key, items: doc.items.length, findings: todos.lint(doc, itemExists(repo.key, registry, doc)) };
}

/** Repair what lint can; `remaining` is what is left. */
export function lintFix(repo: store.Place, registry: Record<string, unknown>) {
  const w = write(repo, "todo: lint --fix", (doc) => { const fixed = todos.fix(doc); return fixed.length ? { fixed, left: todos.lint(doc, itemExists(repo.key, registry, doc)) } : null; });
  const remaining = w?.value.left ?? todos.lint(readIssues(repo), itemExists(repo.key, registry));
  return { result: { repo: repo.key, fixed: w?.value.fixed ?? [], remaining }, follow: w?.follow ?? null };
}

/** The repos with a ledger run or an item update in the last 7 days, the latest first, each with its list (null when the store has none). */
export function recentLists<R extends store.Place>(repos: R[]): { repo: R; doc: todos.Doc | null }[] {
  let docs: (todos.Doc | null)[] = [];
  try { docs = store.readLists(repos); } catch (e: any) { refuse(e?.message ?? String(e)); }
  return recentRepos(repos as any, docs).map((n) => ({ repo: repos[n], doc: docs[n] }));
}

/** `list` with no repo: each recent repo's rows that pass the filter. */
export function listRecent<R extends store.Place>(repos: R[], o: { status?: string; label?: string } = {}): { repo: R; items: todos.Issue[] }[] {
  return recentLists(repos).filter((r) => r.doc).map(({ repo, doc }) => ({ repo, items: filterRows(doc!, o) })).filter((r) => r.items.length);
}

/** `lint` with no repo: each recent repo's findings. */
export function lintRecent<R extends store.Place>(repos: R[], registry: Record<string, unknown>) {
  return recentLists(repos).filter((r) => r.doc).map(({ repo, doc }) => ({ repo: repo.key, items: doc!.items.length, findings: todos.lint(doc!, itemExists(repo.key, registry, doc!)) }));
}
