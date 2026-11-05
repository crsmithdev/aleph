/**
 * One work store file: an issue. Flat frontmatter, then three parts, each
 * opened by a marker line: the request, the spec and the notes. See
 * docs/specs/2026-10-31-work-model.md.
 *
 * An issue is closed by its `closed_as` field. A part is an issue whose id has
 * a `.k`; its parent comes from its id.
 */
import { parseFrontmatter, serializeFrontmatter, splitFrontmatter, type Frontmatter } from "../../vault/lib/frontmatter.ts";
import { nowOverride } from "../../jobs/lib/settings.ts";

export const STATUSES = ["open", "parked", "done", "dropped"] as const;
export type Status = (typeof STATUSES)[number];
const REQUIRED = ["id", "created", "updated"] as const;

export interface Issue {
  id: number;
  /** The part's number under issue `id`: `proj-5.1` is id 5, sub 1. Absent on a top-level issue. */
  sub?: number;
  title: string;
  fm: Frontmatter;
  /** What was asked. Verbatim. Empty on a part intake wrote. */
  request: string;
  /** What a run builds: Markdown with the sections `## Goal`, `## Edit surface` and `## Oracle`. Verbatim. */
  spec: string;
  /** Raw `- YYYY-MM-DD HH:MM: text` lines, in the order they were appended. */
  notes: string[];
}

export interface Doc {
  items: Issue[];
  /** The registry key the store read the list for. */
  repo?: string;
  /** The numbers issues of closed work had: a new issue or part goes above them. */
  floor?: Floor;
}

/** The highest number used by work no longer in the list: `next` for the repo, `parts` by issue number. */
export interface Floor { next: number; parts: Record<string, number> }

// Local time, not UTC. `toISOString` stamps the UTC date, so west of Greenwich
// every issue filed in the evening carried tomorrow's date.
const pad = (n: number): string => String(n).padStart(2, "0");

export const today = (now = new Date()): string =>
  `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
export const minute = (now = new Date()): string =>
  `${today(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

/** The current time. `ALEPH_NOW` (anything `Date` parses) fixes it, for tests that cross days. */
export const clock = (): Date => (nowOverride() ? new Date(nowOverride()!) : new Date());

const REF = /^(.+)-(\d+)$/;
/** A ref in `after`: `<repo>-<n>` or `<repo>-<n>.<k>`. */
const ITEM_REF = /^[^\s,]+-\d+(\.\d+)?$/;

/** `<repo>-<n>` split into its parts, or null. */
export function parseRef(s: string): { repo: string; id: number } | null {
  const m = REF.exec(s);
  return m ? { repo: m[1], id: Number(m[2]) } : null;
}

/** `<repo>-<n>` or a part's `<repo>-<n>.<m>` split into its parts: the id is a number for the first, `"n.m"` for the second. Null for neither. */
export function parseGoalRef(s: string): { repo: string; id: number | string } | null {
  const m = /^(.+)-(\d+(?:\.\d+)?)$/.exec(s);
  return m ? { repo: m[1], id: m[2].includes(".") ? m[2] : Number(m[2]) } : null;
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

const MARK = { request: "<!-- request -->", spec: "<!-- spec -->", notes: "<!-- notes -->" } as const;
const MARKS: string[] = Object.values(MARK);

/** A line of text that reads as a marker gets a leading backslash, so text cannot open a part. A line with backslashes before a marker gets one more. */
const escapeMarks = (text: string): string => text.split("\n").map((l) => (MARKS.includes(l.replace(/^\\+/, "")) ? `\\${l}` : l)).join("\n");
const unescapeMarks = (text: string): string => text.split("\n").map((l) => (MARKS.includes(l.replace(/^\\+/, "")) ? l.slice(1) : l)).join("\n");

const trimmed = (text: string): string => text.replace(/^\n+/, "").replace(/\n+$/, "");

/**
 * One issue as a work store file: the frontmatter carries `id: <repo>-<n>` and `title` beside the
 * item's own fields. Each part that has text follows under its marker.
 */
export function renderItem(repo: string, item: Issue): string {
  const { id: _, ...fields } = item.fm;
  const fm = serializeFrontmatter({ id: `${repo}-${refOf(item)}`, title: item.title, ...fields });
  const block: string[] = [];
  if (item.request.trim()) block.push(`${MARK.request}\n${escapeMarks(trimmed(item.request))}`);
  if (item.spec.trim()) block.push(`${MARK.spec}\n${escapeMarks(trimmed(item.spec))}`);
  if (item.notes.length) block.push(`${MARK.notes}\n${item.notes.map((n) => n.replace(/\n/g, " ")).join("\n")}`);
  return fm + (block.length ? block.join("\n") + "\n" : "");
}

export function parseItem(text: string): Issue {
  const { frontmatter, body: rest } = splitFrontmatter(text);
  const { title, id: full, ...fields } = parseFrontmatter(frontmatter ?? "");
  const m = /-(\d+)(?:\.(\d+))?$/.exec(String(full));
  const id = Number(m?.[1]);
  const sub = m?.[2] === undefined ? undefined : Number(m[2]);
  const parts: Record<string, string[]> = { request: [], spec: [], notes: [] };
  let at: string[] | null = null;
  for (const line of rest.split("\n")) {
    const opened = Object.entries(MARK).find(([, mark]) => mark === line);
    if (opened) at = parts[opened[0]];
    else at?.push(line);
  }
  return {
    id,
    ...(sub === undefined ? {} : { sub }),
    title: String(title ?? ""),
    fm: { id: sub === undefined ? String(id) : `${id}.${sub}`, ...fields },
    request: trimmed(unescapeMarks(parts.request.join("\n"))),
    spec: trimmed(unescapeMarks(parts.spec.join("\n"))),
    notes: parts.notes.filter((l) => l.trim().startsWith("- ")),
  };
}

/** The list a repo gets on its first `issue add`. */
export const blank = (repo?: string): Doc => ({ items: [], ...(repo ? { repo } : {}) });

/** `"5"` for a top-level issue, `"5.1"` for a part. */
export const refOf = (item: Issue): string => (item.sub === undefined ? String(item.id) : `${item.id}.${item.sub}`);
/** The text with each `<repo>-<n>` of this repo as `<n>`, for output where the repo is known. An id of another repo stays whole. */
export const localRefs = (key: string, text: string): string => text.replace(new RegExp(`(^|[^\\w-])${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(?=\\d)`, "g"), "$1");
/** The id that finds the item: its number for a top-level issue, `"5.1"` for a part. */
export const idOf = (item: Issue): number | string => (item.sub === undefined ? item.id : refOf(item));
/** A number resolves to the top-level issue, never to a part under it; a string like `"5.1"` to the part. */
export const find = (doc: Doc, id: number | string): Issue | undefined => doc.items.find((i) => refOf(i) === String(id));
// The max of `id` ignores `sub` on purpose: a part's id is its parent's number, so a part never takes a new issue number.
export const nextId = (doc: Doc): number => Math.max(doc.items.reduce((m, i) => Math.max(m, i.id), 0), (doc.floor?.next ?? 1) - 1) + 1;

const SOURCES = ["chris", "worker", "deps", "memory", "agent"] as const;
export type Source = (typeof SOURCES)[number];

/** The next free `k` for a part `<n>.<k>` under issue `n`, above any part of closed work. */
export const nextSub = (doc: Doc, n: number): number => Math.max(doc.items.reduce((m, i) => (i.id === n && i.sub !== undefined ? Math.max(m, i.sub) : m), 0), doc.floor?.parts[String(n)] ?? 0) + 1;

/** Add an issue: `source` (chris unless the caller or a label says otherwise; this reads no environment) and `areas`, with its request and, when given, its spec. */
/** Labels that say a source or an old state, never an area. */
const NOT_AREAS = ["deps", "memory", "followup", "goal", "needs-chris", "triaged", "planned", "proposal", "live-check"];

/** The four priorities, in rank order. */
export const PRIORITIES = ["low", "medium", "high", "critical"] as const;

export const KINDS = ["task", "bug", "check", "flake", "proposal", "acceptance"] as const;
export type Kind = (typeof KINDS)[number];

/** Matches `: ` anywhere in a title. */
export const PREFIX = /: /;
export const TITLE_RULE = "an imperative of at most 60 characters that says what changes, not how, with no final period and no `<words>: ` prefix";

/** Null, or the one problem a title has: a length over 60, a final `.`, or a `<words>: ` prefix. A part's leading `[Group] ` is not tested for the prefix. */
export function titleProblem(title: string, o: { part?: boolean } = {}): string | null {
  if (title.length > 60) return `the title is ${title.length} characters; the limit is 60 (${TITLE_RULE})`;
  if (title.endsWith(".")) return `the title ends with a period (${TITLE_RULE})`;
  const body = o.part ? title.replace(/^\[[^\]]*\] /, "") : title;
  if (PREFIX.test(body)) return `the title has a ': ' prefix (${TITLE_RULE})`;
  return null;
}

/** Null for a kind the store knows, else the message that names them. */
export const kindProblem = (kind: string): string | null => ((KINDS as readonly string[]).includes(kind) ? null : `unknown kind "${kind}": use ${KINDS.join(", ")}`);

export function add(doc: Doc, title: string, o: { kind?: string; priority?: string; labels?: string[]; request?: string; spec?: string; source?: Source; tracker?: boolean; now?: Date } = {}): Issue {
  const day = today(o.now);
  const kind = o.kind ?? "task";
  const bad = kindProblem(kind) ?? titleProblem(title);
  if (bad) throw new Error(bad);
  const given = o.labels ?? [];
  const source = o.source ?? (given.includes("followup") ? "worker" : given.includes("memory") ? "memory" : "chris");
  const areas = given.filter((l) => !(SOURCES as readonly string[]).includes(l) && !NOT_AREAS.includes(l));
  const item: Issue = {
    id: nextId(doc),
    title,
    fm: { id: String(nextId(doc)), created: day, created_time: minute(o.now), updated: day, kind, priority: o.priority ?? "medium", source, areas, ...(o.tracker ? { tracker: "true" } : {}) },
    request: o.request ?? "",
    spec: o.spec ?? "",
    notes: [],
  };
  doc.items.push(item);
  return item;
}

/** Add part `<n>.<k>` under issue `issue` (`k` the next free number), with `after`, the issue's priority and a `source`: the issue's when it is not chris, else agent. */
export function addPart(doc: Doc, issue: Issue, o: { title: string; spec: string; after?: string[]; now?: Date }): Issue {
  const bad = titleProblem(o.title, { part: true });
  if (bad) throw new Error(bad);
  const day = today(o.now);
  const sub = nextSub(doc, issue.id);
  const part: Issue = {
    id: issue.id,
    sub,
    title: o.title,
    fm: { id: `${issue.id}.${sub}`, created: day, created_time: minute(o.now), updated: day, kind: (issue.fm.kind as string) ?? "task", priority: (issue.fm.priority as string) ?? "medium", source: issue.fm.source && issue.fm.source !== "chris" ? (issue.fm.source as Source) : "agent", after: o.after ?? [] },
    request: "",
    spec: o.spec,
    notes: [],
  };
  issue.fm.updated = day;
  doc.items.push(part);
  return part;
}

/** Append-only: an existing note line is never rewritten, which is the lost update this format exists to stop. */
export function note(item: Issue, text: string, now = new Date()): string {
  const line = `- ${minute(now)}: ${text}`;
  item.notes.push(line);
  item.fm.updated = today(now);
  return line;
}

/** Replace the fields given. Notes are never edited: they stay append-only. */
export function edit(item: Issue, change: { kind?: string; title?: string; request?: string; spec?: string; priority?: string; labels?: string[]; areas?: string[] }, now = new Date()): void {
  const bad = change.title === undefined ? null : titleProblem(change.title, { part: item.sub !== undefined });
  if (bad) throw new Error(bad);
  if (change.kind !== undefined) item.fm.kind = change.kind;
  if (change.title !== undefined) item.title = change.title;
  if (change.request !== undefined) item.request = change.request;
  if (change.spec !== undefined) item.spec = change.spec;
  if (change.priority !== undefined) item.fm.priority = change.priority;
  if (change.labels !== undefined) item.fm.labels = change.labels;
  if (change.areas !== undefined) item.fm.areas = change.areas;
  item.fm.updated = today(now);
}

/** Close the issue as `next`, with why; `open` takes the closure off. A reopen also sets `since`: see `store.reopen`. */
export function setStatus(item: Issue, next: Status, now = new Date(), why?: string): void {
  if (next === "parked") {
    item.fm.parked = "true";
  } else if (next === "open") {
    delete item.fm.parked;
    delete item.fm.closed_as;
    delete item.fm.closed_why;
    delete item.fm.closed_at;
    delete item.fm.closed_time;
  } else {
    delete item.fm.parked;
    item.fm.closed_as = next;
    item.fm.closed_at = today(now);
    item.fm.closed_time = minute(now);
    if (why) item.fm.closed_why = why;
  }
  item.fm.updated = today(now);
}

const refParts = (r: string): [number, number] => { const [n, k] = r.split("."); return [Number(n), k === undefined ? -1 : Number(k)]; };
const byRef = (a: Finding, b: Finding) => { const [an, ak] = refParts(a.id), [bn, bk] = refParts(b.id); return an - bn || ak - bk; };

export interface Finding {
  id: string;
  problem: string;
  fixable: boolean;
}

/** Fields of the old store shape: a file with one was not rewritten. `ask` moved to the job record (jobs/lib/record.ts). */
const RETIRED = ["status", "goals", "issue", "labels", "waiting_on", "due", "route", "created_date", "updated_date", "ask"];

export function lint(doc: Doc): Finding[] {
  const findings: Finding[] = [];
  const seen = new Map<string, number>();
  for (const item of doc.items) {
    seen.set(refOf(item), (seen.get(refOf(item)) ?? 0) + 1);
    for (const key of REQUIRED) {
      if (item.fm[key] === undefined || item.fm[key] === "") {
        findings.push({ id: refOf(item), problem: `${key} is missing`, fixable: true });
      }
    }
    const s = item.fm.closed_as;
    if (s !== undefined && s !== "done" && s !== "dropped") findings.push({ id: refOf(item), problem: `closed_as "${s}" is not done or dropped`, fixable: false });
    for (const key of ["created", "updated"] as const) {
      const v = item.fm[key];
      if (typeof v === "string" && v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) findings.push({ id: refOf(item), problem: `${key} "${v}" is not YYYY-MM-DD`, fixable: false });
    }
    const after = item.fm.after;
    if (after !== undefined) {
      const refs = Array.isArray(after) ? after : [after];
      if (refs.some((r) => !ITEM_REF.test(String(r)))) findings.push({ id: refOf(item), problem: `after: ${refs.join(", ")} is not <repo>-<n>[.<k>]`, fixable: false });
    }
    const source = item.fm.source;
    if (source !== undefined && !(SOURCES as readonly string[]).includes(source as string)) findings.push({ id: refOf(item), problem: `source "${source}" is not one of ${SOURCES.join(", ")}`, fixable: false });
    for (const key of RETIRED) if (item.fm[key] !== undefined) findings.push({ id: refOf(item), problem: `${key} is retired`, fixable: false });
    if (item.fm.id !== undefined && String(item.fm.id) !== refOf(item)) findings.push({ id: refOf(item), problem: `id says ${item.fm.id} but the file says ${refOf(item)}`, fixable: true });
    const kind = item.fm.kind;
    if (kind === undefined || kind === "") findings.push({ id: refOf(item), problem: "kind is missing", fixable: true });
    else if (kindProblem(String(kind))) findings.push({ id: refOf(item), problem: kindProblem(String(kind))!, fixable: true });
    const title = ["open", "parked"].includes(status(item)) ? titleProblem(item.title, { part: item.sub !== undefined }) : null;
    if (title) findings.push({ id: refOf(item), problem: title, fixable: false });
  }
  for (const [ref, count] of seen) if (count > 1) findings.push({ id: ref, problem: `${count} items share id ${ref}`, fixable: false });
  return findings.sort(byRef);
}

/** The areas that say what an issue is, in the order that picks its kind. */
const KIND_AREAS: [string, Kind][] = [["bug", "bug"], ["red-main", "bug"], ["flakes", "flake"], ["check", "check"], ["deps", "proposal"], ["proposal", "proposal"]];
/** The kind areas that leave `areas`. `red-main` stays: the firefighter reads it. */
const MOVED_AREAS = ["bug", "flakes", "check", "deps", "proposal"];

const areaList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);

/** Repair what is mechanically repairable. Returns what it changed. */
export function fix(doc: Doc, now = new Date()): string[] {
  const fixed: string[] = [];
  // A part with no kind area takes its parent's kind, as addPart gives it; so parents go first.
  for (const item of [...doc.items].sort((a, b) => (a.sub === undefined ? 0 : 1) - (b.sub === undefined ? 0 : 1))) {
    const areas = areaList(item.fm.areas);
    if (!item.fm.kind || kindProblem(String(item.fm.kind))) {
      const parent = item.sub === undefined ? undefined : doc.items.find((p) => p.id === item.id && p.sub === undefined);
      item.fm.kind = item.fm.kind === "goal" ? "task" : KIND_AREAS.find(([a]) => areas.includes(a))?.[1] ?? (parent?.fm.kind as Kind | undefined) ?? "task";
      fixed.push(`${refOf(item)}: kind set to ${item.fm.kind}`);
    }
    const kept = areas.filter((a) => !MOVED_AREAS.includes(a));
    if (kept.length < areas.length) { item.fm.areas = kept; fixed.push(`${refOf(item)}: areas ${areas.filter((a) => MOVED_AREAS.includes(a)).join(", ")} removed`); }
    if (item.fm.id === undefined || String(item.fm.id) !== refOf(item)) { item.fm.id = refOf(item); fixed.push(`${refOf(item)}: id set to ${refOf(item)}`); }
    if (!item.fm.created) { item.fm.created = (item.fm.updated as string) || today(now); fixed.push(`${refOf(item)}: created set to ${item.fm.created}`); }
    if (!item.fm.updated) { item.fm.updated = (item.fm.created as string) || today(now); fixed.push(`${refOf(item)}: updated set to ${item.fm.updated}`); }
    if (item.fm.labels !== undefined && !Array.isArray(item.fm.labels)) { item.fm.labels = [String(item.fm.labels)]; fixed.push(`${refOf(item)}: labels wrapped in a list`); }
  }
  return fixed;
}

/** The text under `## <name>` in a goal body, up to the next `##` heading; empty when there is none. */
export function section(body: string, name: string): string {
  const parts = body.split(/^##[ \t]+(.+?)[ \t]*$/m);
  for (let i = 1; i < parts.length; i += 2) if (parts[i].toLowerCase().startsWith(name.toLowerCase())) return parts[i + 1].trim();
  return "";
}
