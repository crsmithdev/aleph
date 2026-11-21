/**
 * One item file: an issue, `issues/<n>/issue.md`. The path is its key (`issue.<n>`), so the file holds no id. Flat
 * frontmatter, then three parts, each opened by a heading line: `# Request`, `# Spec` and `# Notes`. See
 * docs/data-model.md.
 *
 * An issue is closed by its `closed_as` field. A child is an issue with a `from` field that names its parent.
 */
import { parseFrontmatter, serializeFrontmatter, splitFrontmatter, type Frontmatter } from "./frontmatter.ts";
import { next } from "./db.ts";
import { ISSUE_KINDS, issueKey, parseId, parseKey, PRIORITIES, priorityRank, shownKey, SOURCES, STATUSES } from "./naming.ts";

export type Status = (typeof STATUSES)[number];
const REQUIRED = ["project", "created"] as const;

export interface Issue {
  /** The number in its path: `issues/<id>/issue.md`. */
  id: number;
  title: string;
  fm: Frontmatter;
  /** What was asked. Verbatim. Empty on a part intake wrote. */
  request: string;
  /** What a run builds: Markdown with the sections `## Goal`, `## Edit surface` and `## Oracle`. Verbatim. */
  spec: string;
  /** Raw `- <ISO UTC time>: text` lines, in the order they were appended. */
  notes: string[];
}

export interface Doc {
  items: Issue[];
  /** The registry name of the project the store read the list for. */
  repo?: string;
  /** Its key, `project.<n>`: what a new issue holds in `project`. */
  project?: string;
  /** The highest issue number in the store at the commit read: a new issue takes a number above it. */
  floor?: number;
}

/** A time as ISO 8601 UTC, the form every issue time and note stamp has. */
export const minute = (now = new Date()): string => now.toISOString();
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** The current time. `ALEPH_NOW` (anything `Date` parses) fixes it, for tests that cross days. */
export const clock = (): Date => (process.env.ALEPH_NOW ? new Date(process.env.ALEPH_NOW) : new Date());

/** `<repo>-<n>` or a part's `<repo>-<n>.<m>` split into its parts: the id is a number for the first, `"n.m"` for the second. Null for neither. */
export function parseIssueRef(s: string): { repo: string; id: number | string } | null {
  const p = parseId(s);
  return p ? { repo: p.repo, id: p.sub === undefined ? p.n : `${p.n}.${p.sub}` } : null;
}

/** `open`, or how the issue was closed. */
export function status(item: Issue): string {
  return (item.fm.closed_as as string) ?? (item.fm.parked === "true" ? "parked" : "open");
}

/** An item's labels. A lone label not in a list counts as a list of one. */
export function labels(item: Issue): string[] {
  const l = item.fm.labels;
  if (Array.isArray(l)) return l.map(String);
  return l === undefined || l === null || l === "" ? [] : [String(l)];
}

/** The item's kind; none reads task. */
export const kindOf = (item: Issue): string => String(item.fm.kind || "task");
/** Main's head when the issue was reopened, or undefined. */
export const sinceOf = (item: Issue): string | undefined => (item.fm.since ? String(item.fm.since) : undefined);

/** When the issue was made, as ISO UTC. */
export const created = (item: Issue): string | undefined => (item.fm.created ? String(item.fm.created) : undefined);
/** When the issue closed, as ISO UTC; undefined while it is open. */
export const closed = (item: Issue): string | undefined => (item.fm.closed_as && item.fm.closed_at ? String(item.fm.closed_at) : undefined);

/** When the issue last changed, as ISO UTC: the latest of its creation, its close and its last note. The file holds no such field; git holds the history. */
export const updated = (item: Issue): string | undefined => [created(item), closed(item), ...item.notes.slice(-1).map((n) => noteOf(n).at ?? undefined)].filter((t): t is string => !!t).sort().at(-1);

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);
const text = (v: unknown): string => (typeof v === "string" ? v : "");
/** The names of an item's media files. */
export const mediaOf = (item: Issue): string[] => list(item.fm.media);

/** Who raised the item: its `source`, else agent for a child (a child is made by the planner, never by chris) and chris for an issue. */
export function sourceOf(item: Issue): Source {
  const s = text(item.fm.source);
  return s !== "chris" && (SOURCES as readonly string[]).includes(s) ? (s as Source) : parentRef(item) === undefined ? "chris" : "agent";
}
/** The children of an issue, in number order: the issues with a `from` that names it. */
export const partsOf = (doc: Doc, item: Issue): Issue[] => doc.items.filter((i) => parentRef(i) === String(item.id));
/** The parent of a child; undefined for an issue with none. */
export const parentOf = (doc: Doc, item: Issue): Issue | undefined => { const up = parentRef(item); return up === undefined ? undefined : find(doc, up); };
/** Whether the issue needs a plan run, or "plan the rest" on a parent. */
export const planSet = (item: Issue): boolean => item.fm.plan === "true";
/** Set or clear `plan`, so the next dispatch starts (or stops) intake splitting the issue. */
export function setPlan(item: Issue, on: boolean): void { if (on) item.fm.plan = "true"; else delete item.fm.plan; }
/** Record that intake took the issue in as buildable. */
export const setIntake = (item: Issue): void => { item.fm.intake = "build"; };
/** The reason an issue was closed with, if it has one. */
export const closedWhy = (item: Issue): string | undefined => (item.fm.closed_why ? String(item.fm.closed_why) : undefined);
/** The flake tracker: a note log, never built. */
export const isTracker = (item: Issue): boolean => item.fm.tracker === "true";
/** The refs an issue waits for: its `after`. */
export const afterOf = (item: Issue): string[] => list(item.fm.after);
/** The issues an issue names as plain references: its `refs`. They hold nothing. */
export const refsOf = (item: Issue): string[] => list(item.fm.refs);
/** The issues of `all` whose `refs` name `item`. Numbers are global, so a ref can cross projects. */
export const referrersOf = (all: Issue[], item: Issue): Issue[] => all.filter((i) => refsOf(i).includes(issueKey(item.id)));
/** The item's areas: its `areas`. */
export const areasOf = (item: Issue): string[] => list(item.fm.areas);
/** The red-main fix issue: `add` writes the label into `areas`; an older issue carries it in `labels`. */
export const isRedMain = (item: Issue): boolean => areasOf(item).includes("red-main") || labels(item).includes("red-main");
/** Rank of an item's priority: 3 for critical down to 0 for low. No priority, or an unknown one, ranks as medium. */
const rank = (item: Issue): number => priorityRank(item.fm.priority);
/** An item's priority; none, or an unknown one, reads medium. */
export const priorityOf = (item: Issue): string => PRIORITIES[rank(item)];

/** Sort entries by priority, highest first; stable, so equal priorities keep their order. */
export function byPriority<T extends { item: Issue }>(entries: T[]): T[] {
  return entries.map((e, n) => ({ e, n })).sort((a, b) => rank(b.e.item) - rank(a.e.item) || a.n - b.n).map((x) => x.e);
}

const HEADS = { request: "# Request", spec: "# Spec", notes: "# Notes" } as const;
const HEADINGS: string[] = Object.values(HEADS);

/** A line of text that reads as a part heading gets a leading backslash, so text cannot open a part. A line with backslashes before a heading gets one more. */
const escapeHeads = (text: string): string => text.split("\n").map((l) => (HEADINGS.includes(l.replace(/^\\+/, "")) ? `\\${l}` : l)).join("\n");
const unescapeHeads = (text: string): string => text.split("\n").map((l) => (HEADINGS.includes(l.replace(/^\\+/, "")) ? l.slice(1) : l)).join("\n");

const trimmed = (text: string): string => text.replace(/^\n+/, "").replace(/\n+$/, "");

/** The frontmatter fields in the order a file lists them; any other field follows. */
const ORDER = ["project", "title", "kind", "priority", "source", "created", "closed_as", "closed_at", "closed_why", "from", "after", "refs"];

/** One issue as its file: the frontmatter, then each part that has text under its heading. */
export function renderItem(item: Issue): string {
  const { title: _, ...fields } = item.fm;
  const all: Frontmatter = { title: item.title, ...fields };
  const ordered: Frontmatter = Object.fromEntries([...ORDER.filter((k) => k in all), ...Object.keys(all).filter((k) => !ORDER.includes(k))].map((k) => [k, all[k]]));
  const block: string[] = [];
  if (item.request.trim()) block.push(`${HEADS.request}\n\n${escapeHeads(trimmed(item.request))}\n`);
  if (item.spec.trim()) block.push(`${HEADS.spec}\n\n${escapeHeads(trimmed(item.spec))}\n`);
  if (item.notes.length) block.push(`${HEADS.notes}\n\n${item.notes.map((n) => n.replace(/\n/g, " ")).join("\n")}\n`);
  return serializeFrontmatter(ordered) + (block.length ? `\n${block.join("\n")}` : "");
}

/** The issue `id` from its file text. */
export function parseItem(id: number, text: string): Issue {
  const { frontmatter, body: rest } = splitFrontmatter(text);
  const { title, ...fields } = parseFrontmatter(frontmatter ?? "");
  const parts: Record<string, string[]> = { request: [], spec: [], notes: [] };
  let at: string[] | null = null;
  for (const line of rest.split("\n")) {
    const opened = Object.entries(HEADS).find(([, head]) => head === line);
    if (opened) at = parts[opened[0]];
    else at?.push(line);
  }
  return {
    id,
    title: String(title ?? ""),
    fm: fields,
    request: trimmed(unescapeHeads(parts.request.join("\n"))),
    spec: trimmed(unescapeHeads(parts.spec.join("\n"))),
    notes: parts.notes.filter((l) => l.trim().startsWith("- ")),
  };
}

/** An empty list, for a project that has no issue yet. */
export const blank = (repo?: string, project?: string): Doc => ({ items: [], ...(repo ? { repo } : {}), ...(project ? { project } : {}) });

/** The text with each full or short id of the repo `key` as its shown key, `a1234` with the project's code, `i1234` with none. `code` is that code. */
export const localRefs = (key: string, text: string, code?: string): string =>
  text.replace(/(?<![\w.-])[a-z][a-z0-9-]*\d+(?:\.\d+)?(?![\w-])/g, (r) => { const p = parseId(r); return p?.repo === key && p.sub === undefined ? shownKey(issueKey(p.n), code) : r; });
/** The number of the parent, as text, from `from: issue.<n>`. Undefined for an issue with no parent. */
export const parentRef = (item: Issue): string | undefined => { const p = item.fm.from ? parseKey(item.fm.from) : null; return p?.kind === "issue" ? String(p.n) : undefined; };
/** The issue with number `id`: a number, its text, or a key such as `issue.5`. */
export const find = (doc: Doc, id: number | string): Issue | undefined => {
  const n = typeof id === "number" ? id : parseKey(id)?.n ?? Number(id);
  return doc.items.find((i) => i.id === n);
};
const nextId = (doc: Doc): number => next("issue", Math.max(doc.floor ?? 0, ...doc.items.map((i) => i.id)));

export type Source = (typeof SOURCES)[number];

/** Add an issue: `source` (chris unless the caller or a label says otherwise; this reads no environment) and `areas`, with its request and, when given, its spec. */
/** Labels that say a source or an old state, never an area. */
const NOT_AREAS = ["deps", "memory", "followup", "goal", "needs-chris", "triaged", "planned", "proposal", "live-check"];


export const KINDS = ISSUE_KINDS;
type Kind = (typeof KINDS)[number];

/** Matches `: ` anywhere in a title. */
const PREFIX = /: /;
export const TITLE_RULE = "an imperative of at most 60 characters that says what changes, not how, with no final period and no `<words>: ` prefix";

/** Null, or the one problem a title has: a length over 60, a final `.`, or a `<words>: ` prefix. A child's leading `[Group] ` takes the place of the prefix, so the rest of its title is not tested for one. */
export function titleProblem(title: string, o: { part?: boolean } = {}): string | null {
  if (title.length > 60) return `the title is ${title.length} characters; the limit is 60 (${TITLE_RULE})`;
  if (title.endsWith(".")) return `the title ends with a period (${TITLE_RULE})`;
  if (o.part && /^\[[^\]]*\] /.test(title)) return null;
  if (PREFIX.test(title)) return `the title has a ': ' prefix (${TITLE_RULE})`;
  return null;
}

/** Null for a kind the store knows, else the message that names them. */
export const kindProblem = (kind: string): string | null => ((KINDS as readonly string[]).includes(kind) ? null : `unknown kind "${kind}": use ${KINDS.join(", ")}`);

/** `from` is the key of the issue this one was split from (`issue.5`); `after` the keys it waits for. The number comes from the counter at once, so a write that fails leaves a gap. */
export function add(doc: Doc, title: string, o: { kind?: string; priority?: string; labels?: string[]; request?: string; spec?: string; source?: Source; tracker?: boolean; from?: string; after?: string[]; areas?: string[]; now?: Date } = {}): Issue {
  const kind = o.kind ?? "task";
  const bad = kindProblem(kind) ?? titleProblem(title, { part: !!o.from });
  if (bad) throw new Error(bad);
  const given = o.labels ?? [];
  const source = o.source ?? (given.includes("followup") ? "worker" : given.includes("memory") ? "memory" : "chris");
  const areas = o.areas ?? given.filter((l) => !(SOURCES as readonly string[]).includes(l) && !NOT_AREAS.includes(l));
  const item: Issue = {
    id: nextId(doc),
    title,
    fm: { ...(doc.project ? { project: doc.project } : {}), created: minute(o.now), kind, priority: o.priority ?? "medium", source, areas, ...(o.tracker ? { tracker: "true" } : {}), ...(o.from ? { from: o.from } : {}), ...(o.after?.length ? { after: o.after } : {}) },
    request: o.request ?? "",
    spec: o.spec ?? "",
    notes: [],
  };
  doc.items.push(item);
  return item;
}

/** A note line as note() writes it: `- <ISO stamp>: <text>`. */
const NOTE = new RegExp(`^- (${ISO.source.slice(1, -1)}): (.*)$`, "s");
/** A note line's stamp (ISO UTC; null when the line has none) and its text after the stamp. */
export function noteOf(line: string): { at: string | null; text: string } {
  const m = NOTE.exec(line);
  return m ? { at: m[1], text: m[3] } : { at: null, text: line.replace(/^\s*-\s*/, "") };
}

/** Append-only: an existing note line is never rewritten, which is the lost update this format exists to stop. A note holds what a person or an agent said; code writes none. */
export function note(item: Issue, text: string, now = new Date()): string {
  const line = `- ${minute(now)}: ${text}`;
  item.notes.push(line);
  return line;
}

/** Replace the fields given. Notes are never edited: they stay append-only. */
export function edit(item: Issue, change: { kind?: string; title?: string; request?: string; spec?: string; priority?: string; areas?: string[]; source?: Source; after?: string[]; refs?: string[]; media?: string[]; since?: string }): void {
  const bad = change.title === undefined || change.title === item.title ? null : titleProblem(change.title, { part: parentRef(item) !== undefined });
  if (bad) throw new Error(bad);
  if (change.kind !== undefined) item.fm.kind = change.kind;
  if (change.title !== undefined) item.title = change.title;
  if (change.request !== undefined) item.request = change.request;
  if (change.spec !== undefined) item.spec = change.spec;
  if (change.priority !== undefined) item.fm.priority = change.priority;
  if (change.areas !== undefined) item.fm.areas = change.areas;
  if (change.source !== undefined) item.fm.source = change.source;
  if (change.after !== undefined) item.fm.after = change.after;
  if (change.refs !== undefined) item.fm.refs = change.refs;
  if (change.media !== undefined) item.fm.media = change.media;
  if (change.since !== undefined) item.fm.since = change.since;
}

/** Close the issue as `next`, with why; `open` takes the closure off. A reopen also sets `since`: see `store.reopen`. The caller logs the close (`store.logClosed`). */
export function setStatus(item: Issue, next: Status, now = new Date(), why?: string): void {
  if (next === "parked") {
    item.fm.parked = "true";
  } else if (next === "open") {
    delete item.fm.parked;
    delete item.fm.closed_as;
    delete item.fm.closed_why;
    delete item.fm.closed_at;
  } else {
    delete item.fm.parked;
    item.fm.closed_as = next;
    item.fm.closed_at = minute(now);
    if (why) item.fm.closed_why = why;
  }
}

const byRef = (a: Finding, b: Finding) => Number(a.id) - Number(b.id);

export interface Finding {
  id: string;
  problem: string;
  fixable: boolean;
}

/** Fields of an older store shape: a file with one was not rewritten. `ask` moved to the job record (jobs/lib/records/record.ts). `id` and `was` go because the path is the key. */
const RETIRED = ["status", "goals", "issue", "labels", "waiting_on", "due", "route", "created_date", "updated_date", "ask", "id", "was", "updated", "updated_time", "created_time", "closed_time"];
/** The retired fields that `fix` drops: an old time, or a field the path or the history holds. */
const DROPPED = ["id", "was", "updated", "updated_time"];
const FIXABLE = [...DROPPED, "created_time", "closed_time"];
const KEYS = /^issue\.\d+$/;

export function lint(doc: Doc): Finding[] {
  const findings: Finding[] = [];
  for (const item of doc.items) {
    const id = String(item.id);
    for (const key of REQUIRED) {
      if (item.fm[key] === undefined || item.fm[key] === "") {
        findings.push({ id, problem: `${key} is missing`, fixable: key === "project" ? doc.project !== undefined : item.fm.created_time !== undefined });
      }
    }
    const s = item.fm.closed_as;
    if (s !== undefined && s !== "done" && s !== "dropped") findings.push({ id, problem: `closed_as "${s}" is not done or dropped`, fixable: false });
    for (const key of ["created", "closed_at"] as const) {
      const v = item.fm[key];
      if (typeof v === "string" && v && !ISO.test(v)) findings.push({ id, problem: `${key} "${v}" is not an ISO UTC time`, fixable: false });
    }
    for (const field of ["after", "refs"] as const) {
      const v = item.fm[field];
      if (v === undefined) continue;
      const keys = Array.isArray(v) ? v : [v];
      if (keys.some((r) => !KEYS.test(String(r)))) findings.push({ id, problem: `${field}: ${keys.join(", ")} is not issue.<n>`, fixable: false });
    }
    if (item.fm.from !== undefined && !KEYS.test(String(item.fm.from))) findings.push({ id, problem: `from: ${item.fm.from} is not issue.<n>`, fixable: false });
    const source = item.fm.source;
    if (source !== undefined && !(SOURCES as readonly string[]).includes(source as string)) findings.push({ id, problem: `source "${source}" is not one of ${SOURCES.join(", ")}`, fixable: false });
    for (const key of RETIRED) if (item.fm[key] !== undefined) findings.push({ id, problem: `${key} is retired`, fixable: FIXABLE.includes(key) });
    const kind = item.fm.kind;
    if (kind === undefined || kind === "") findings.push({ id, problem: "kind is missing", fixable: true });
    else if (kindProblem(String(kind))) findings.push({ id, problem: kindProblem(String(kind))!, fixable: true });
    const title = ["open", "parked"].includes(status(item)) ? titleProblem(item.title, { part: parentRef(item) !== undefined }) : null;
    if (title) findings.push({ id, problem: title, fixable: false });
  }
  return findings.sort(byRef);
}

/** The areas that say what an issue is, in the order that picks its kind. */
const KIND_AREAS: [string, Kind][] = [["bug", "bug"], ["red-main", "bug"], ["flakes", "flake"], ["check", "check"], ["deps", "task"], ["proposal", "task"]];
/** The kind areas that leave `areas`. `red-main` stays: the firefighter reads it. */
const MOVED_AREAS = ["bug", "flakes", "check", "deps", "proposal"];

const areaList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);

/** Repair what is mechanically repairable. Returns what it changed. */
export function fix(doc: Doc): string[] {
  const fixed: string[] = [];
  // A child with no kind area takes its parent's kind; so parents go first.
  for (const item of [...doc.items].sort((a, b) => (parentRef(a) === undefined ? 0 : 1) - (parentRef(b) === undefined ? 0 : 1))) {
    const id = String(item.id);
    const areas = areaList(item.fm.areas);
    if (!item.fm.kind || kindProblem(String(item.fm.kind))) {
      const up = parentRef(item), parent = up === undefined ? undefined : find(doc, up);
      item.fm.kind = ["goal", "acceptance", "proposal"].includes(String(item.fm.kind)) ? "task" : KIND_AREAS.find(([a]) => areas.includes(a))?.[1] ?? (parent?.fm.kind as Kind | undefined) ?? "task";
      fixed.push(`${id}: kind set to ${item.fm.kind}`);
    }
    const kept = areas.filter((a) => !MOVED_AREAS.includes(a));
    if (kept.length < areas.length) { item.fm.areas = kept; fixed.push(`${id}: areas ${areas.filter((a) => MOVED_AREAS.includes(a)).join(", ")} removed`); }
    if (!item.fm.project && doc.project) { item.fm.project = doc.project; fixed.push(`${id}: project set to ${doc.project}`); }
    for (const key of DROPPED) if (item.fm[key] !== undefined) { delete item.fm[key]; fixed.push(`${id}: ${key} removed`); }
    if (item.fm.created_time !== undefined) { item.fm.created ||= item.fm.created_time; delete item.fm.created_time; fixed.push(`${id}: created_time is created`); }
    if (item.fm.closed_time !== undefined) { item.fm.closed_at ||= item.fm.closed_time; delete item.fm.closed_time; fixed.push(`${id}: closed_time is closed_at`); }
    if (item.fm.labels !== undefined && !Array.isArray(item.fm.labels)) { item.fm.labels = [String(item.fm.labels)]; fixed.push(`${id}: labels wrapped in a list`); }
  }
  return fixed;
}

/** The text under `## <name>` in an issue body, up to the next `##` heading; empty when there is none. */
export function section(body: string, name: string): string {
  const parts = body.split(/^##[ \t]+(.+?)[ \t]*$/m);
  for (let i = 1; i < parts.length; i += 2) if (parts[i].toLowerCase().startsWith(name.toLowerCase())) return parts[i + 1].trim();
  return "";
}
