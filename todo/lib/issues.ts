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
import * as issues from "./todo.ts";
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

export const brief = (i: issues.Issue) => ({ id: i.id, ...(i.sub === undefined ? {} : { ref: issues.refOf(i) }), title: i.title, status: issues.status(i), priority: i.fm.priority ?? null, updated: i.fm.updated ?? null, due: i.fm.due ?? null, kind: store.kindOf(i), source: store.sourceOf(i), issue: store.issueOf(i), goals: store.goalsOf(i), after: store.afterOf(i), areas: store.areasOf(i), ask: store.askOf(i), notes: i.notes.length, legacy: i.legacy || undefined });

/** A bad value is refused before anything is written. */
export function checkFields(f: Fields): void {
  if (f.due !== undefined && f.due !== "none" && !issues.validDate(f.due)) refuse("--due takes YYYY-MM-DD or none");
  if (f.status !== undefined && !(issues.STATUSES as readonly string[]).includes(f.status)) refuse(`--status takes ${issues.STATUSES.join(", ")}`);
  if (f.waitingOn !== undefined && f.waitingOn !== "none" && !(issues.waitParts(f.waitingOn).length && issues.waitParts(f.waitingOn).every((p) => issues.parseRef(p)))) refuse("--waiting-on takes <repo>-<n>[,<repo>-<n>...] or none");
}

/** Set the goals a goal waits for (`after`), checked for form and, in this repo, for existence; an old `waiting_on` goes. */
function setAfter(repo: store.Place, doc: issues.Doc, i: issues.Issue, after: string[]): void {
  checkAfter(after);
  for (const r of after) if (r.startsWith(`${repo.key}-`) && !issues.find(doc, r.slice(repo.key.length + 1))) refuse(`--after ${r} names no goal`);
  if (i.legacy) issues.adopt(i);
  i.fm.after = after;
  delete i.fm.waiting_on;
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

/** A goal id as typed (`<n>.<k>`, or `<m>` for an old child goal that keeps its plain number); a refusal for anything else. */
export function goalId(raw: string | undefined): string {
  if (!raw || !/^\d+(\.\d+)?$/.test(raw)) refuse("name a goal by its id, <n>.<k>");
  return raw as string;
}

function pickGoal(repo: store.Place, doc: issues.Doc, id: string): issues.Goal {
  const g = pick(repo, doc, goalId(id));
  if (store.kindOf(g) !== "goal") refuse(`${repo.key}-${id} is an issue, not a goal`);
  return g;
}

/** The repo's goals (`kindOf` goal) that pass `status`. */
export function goalList(repo: store.Place, o: { status?: string } = {}): issues.Goal[] {
  return filterRows(readIssues(repo), o).filter((i) => store.kindOf(i) === "goal");
}

export function goalShow(repo: store.Place, id: string): { item: issues.Goal; hidden: number } {
  const item = pickGoal(repo, readIssues(repo), id);
  return { item, hidden: Object.keys(readHiddenOf(repo, item)).length };
}

const readHiddenOf = (repo: store.Place, g: issues.Goal): Record<string, string> => {
  try { return store.readHidden(repo, `${repo.key}-${issues.refOf(g)}`); } catch (e: any) { return refuse(e?.message ?? String(e)); }
};

/** The names of a goal's hidden check files. */
export function goalHiddenList(repo: store.Place, id: string): string[] {
  return Object.keys(readHiddenOf(repo, pickGoal(repo, readIssues(repo), id)));
}

/** Store `files` as the goal's hidden checks, in `<repo>/hidden/<repo>-<n>.<k>/`. */
export function goalHiddenAdd(repo: store.Place, id: string, files: Record<string, string>) {
  const g = pickGoal(repo, readIssues(repo), id);
  const ref = `${repo.key}-${issues.refOf(g)}`;
  try {
    const w = store.writeHidden(repo, ref, files);
    return { result: { repo: repo.key, id: ref, hidden: Object.keys(files), commit: w.commit }, follow: w.follow };
  } catch (e: any) {
    if (e instanceof Refusal) throw e;
    return refuse(e?.message ?? String(e));
  }
}

/** A note on a goal. */
export function goalNote(repo: store.Place, id: string, text: string) {
  text = text.trim() || refuse("give the note some text");
  const w = write(repo, `todo: a note on goal ${id}`, (doc) => {
    const g = pickGoal(repo, doc, id);
    return { id: issues.refOf(g), line: issues.note(g, text) };
  })!;
  return { result: { repo: repo.key, id: `${repo.key}-${w.value.id}`, note: w.value.line, commit: w.commit }, follow: w.follow };
}

/** Edit a goal's title, body, priority or `after` (`none` clears it; issue ids are refused). */
export function goalEdit(repo: store.Place, id: string, f: { title?: string; body?: string; priority?: string; after?: string[] }) {
  goalId(id);
  const title = f.title?.trim();
  if (title === undefined && f.body === undefined && f.priority === undefined && f.after === undefined) refuse("give --title, --body, --priority or --after");
  if (title === "") refuse("the title cannot be empty");
  const after = f.after?.filter((r) => r !== "none");
  if (after) checkAfter(after);
  const w = write(repo, `todo: edit goal ${id}`, (doc) => {
    const g = pickGoal(repo, doc, id);
    for (const r of after ?? []) {
      if (r.startsWith(`${repo.key}-`) && !issues.find(doc, r.slice(repo.key.length + 1))) refuse(`--after ${r} names no goal`);
      if (r === `${repo.key}-${issues.refOf(g)}`) refuse("a goal cannot wait for itself");
    }
    issues.edit(g, { title, body: f.body, priority: f.priority });
    if (f.after !== undefined) { g.fm.after = after ?? []; g.fm.updated = issues.today(); }
    return g;
  })!;
  return { result: { repo: repo.key, ...brief(w.value), commit: w.commit }, item: w.value, follow: w.follow };
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
export async function add(repo: store.Place, title: string, fields: Fields = {}): Promise<{ result: Added; item: issues.Issue; goal?: issues.Goal; follow: string | null }> {
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
    const issue = issues.add(doc, title, { priority: fields.priority, labels: fields.labels ?? t.labels, body: text ? `## Request\n\n${text}` : fields.body, due: fields.due });
    if (!text) return { issue };
    const own = (fields.after ?? []).filter((r) => r.startsWith(`${repo.key}-`));
    for (const r of own) if (!issues.find(doc, r.slice(repo.key.length + 1))) refuse(`--after ${r} names no goal`);
    return { issue, goal: issues.addGoal(doc, issue, { title, body: text, after: fields.after ?? [] }) };
  }, true)!;
  const { issue, goal } = w.value;
  const result: Added = { repo: repo.key, added: issue.id, title: issue.title, commit: w.commit, ...(goal ? { goal: `${repo.key}-${issues.refOf(goal)}` } : {}), ...(t.maybeSame.length ? { maybeSame: t.maybeSame } : {}) };
  return { result, item: issue, goal, follow: w.follow };
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
export const hiddenCount = (repo: store.Place, id: number | string): number => Object.keys(store.readHidden(repo, id)).length;

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
 * left to the triage that follows a note. `fields.waitingOn` (the UI's option that waits on another issue) sets `waiting_on`.
 */
export function decide(repo: store.Place, id: number | string, text: string, fields: Fields = {}) {
  checkFields(fields);
  text = text.trim() || refuse("give the decision");
  const w = write(repo, `todo: item ${id}: decided`, (doc) => {
    const i = pick(repo, doc, id);
    if (issues.status(i) !== "open" || !store.awaitsChris(i)) refuse(`${repo.key}-${i.id} is not waiting for a decision`);
    issues.note(i, text);
    store.clearAsk(i);
    // The old shape stored the decision's own kind (product or build) in `kind`.
    if (i.fm.kind === "product" || i.fm.kind === "build") delete i.fm.kind;
    if (fields.waitingOn !== undefined) issues.setWaitingOn(i, fields.waitingOn);
    if (fields.after !== undefined) setAfter(repo, doc, i, fields.after);
    return i;
  })!;
  return { result: { repo: repo.key, ...brief(w.value), commit: w.commit }, item: w.value, follow: w.follow };
}

export function edit(repo: store.Place, id: number | string, fields: Fields) {
  checkFields(fields);
  const title = fields.title?.trim();
  const { body, priority, labels, due, waitingOn, status, after } = fields;
  if (title === undefined && body === undefined && priority === undefined && labels === undefined && due === undefined && waitingOn === undefined && status === undefined && after === undefined) refuse("give --title, --body, --priority, --labels, --due (or --status)");
  if (title === "") refuse("the title cannot be empty");
  const w = write(repo, `todo: edit item ${id}`, (doc) => {
    const i = pick(repo, doc, id);
    issues.edit(i, { title, body, priority, areas: labels, due, waitingOn });
    if (status !== undefined) issues.setStatus(i, status as issues.Status);
    if (after !== undefined) setAfter(repo, doc, i, after);
    return i;
  })!;
  return { result: { repo: repo.key, ...brief(w.value), commit: w.commit }, item: w.value, follow: w.follow };
}

/** Close an item as done, or as dropped (which needs a reason); `text` goes on it as a note. */
export function close(repo: store.Place, id: number | string, how: "done" | "drop", text = "") {
  text = text.trim();
  if (how === "drop" && !text) refuse("say why it is dropped");
  const w = write(repo, `todo: item ${id} ${how === "done" ? "done" : "dropped"}`, (doc) => {
    const i = pick(repo, doc, id);
    issues.setStatus(i, how === "done" ? "done" : "dropped");
    if (text) issues.note(i, text);
    if (how === "drop") store.askIfPartDropped(doc, i, text);
    return i;
  })!;
  return { result: { repo: repo.key, id: w.value.id, status: issues.status(w.value), title: w.value.title, commit: w.commit }, follow: w.follow };
}

/** Whether `<repo>-<n>` names an item in the work store; `own` is the list already read for `key`. */
export function itemExists(key: string, registry: Record<string, unknown>, own?: issues.Doc): (repo: string, id: number) => boolean {
  const lists = store.reader();
  return (r, id) => (own && r === key ? issues.find(own, id) : registry[r] ? lists.item(r, id) : undefined) !== undefined;
}

export type Finding = ReturnType<typeof issues.lint>[number];

export function lint(repo: store.Place, registry: Record<string, unknown>): { repo: string; items: number; findings: Finding[] } {
  const doc = readIssues(repo);
  return { repo: repo.key, items: doc.items.length, findings: issues.lint(doc, itemExists(repo.key, registry, doc)) };
}

/** Repair what lint can; `remaining` is what is left. */
export function lintFix(repo: store.Place, registry: Record<string, unknown>) {
  const w = write(repo, "todo: lint --fix", (doc) => { const fixed = issues.fix(doc); return fixed.length ? { fixed, left: issues.lint(doc, itemExists(repo.key, registry, doc)) } : null; });
  const remaining = w?.value.left ?? issues.lint(readIssues(repo), itemExists(repo.key, registry));
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
export function lintRecent<R extends store.Place>(repos: R[], registry: Record<string, unknown>) {
  return recentLists(repos).filter((r) => r.doc).map(({ repo, doc }) => ({ repo: repo.key, items: doc!.items.length, findings: issues.lint(doc!, itemExists(repo.key, registry, doc!)) }));
}
