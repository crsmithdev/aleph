/**
 * A repo's `docs/todo.md`: numbered `## N. Title` sections, each with a small
 * frontmatter block and free prose. Status is a field, never a filing
 * position, so nothing moves and nothing is renumbered when an issue ships.
 *
 * The file is parsed as sections and rewritten section by section, so an issue
 * nobody touched keeps its bytes. Prose is never reflowed.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter, serializeFrontmatter, splitFrontmatter, type Frontmatter } from "../../vault/lib/frontmatter.ts";

export const STATUSES = ["open", "done", "dropped"] as const;
export type Status = (typeof STATUSES)[number];
const REQUIRED = ["id", "status", "created", "updated"] as const;

export interface Issue {
  id: number;
  /** The goal's number under item `id`: `proj-5.1` is id 5, sub 1. Absent on a plain item. */
  sub?: number;
  title: string;
  fm: Frontmatter;
  /** Prose under the heading, frontmatter and Notes removed. Verbatim. */
  body: string;
  /** Raw `- YYYY-MM-DD HH:MM: text` lines, in the order they were appended. */
  notes: string[];
  /** No frontmatter block in the file: an issue written before this command existed. */
  legacy: boolean;
}

/** An issue (`kind: issue`) and a goal (`kind: goal`) are both stored as an `Item`; the names say which one a signature means. */
export type Goal = Issue;

export interface Doc {
  /** Everything above the first issue, verbatim. */
  head: string;
  items: Issue[];
  /** The registry key the store read the list for; absent on a list parsed from docs/todo.md. */
  repo?: string;
}

// Local time, not UTC. `toISOString` stamps the UTC date, so west of Greenwich
// every issue filed in the evening carried tomorrow's date.
const pad = (n: number): string => String(n).padStart(2, "0");

export const today = (now = new Date()): string =>
  `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
export const minute = (now = new Date()): string =>
  `${today(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

/** The current time. `ALEPH_NOW` (anything `Date` parses) fixes it, for tests that cross days. */
export const clock = (): Date => (process.env.ALEPH_NOW ? new Date(process.env.ALEPH_NOW) : new Date());

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** A real calendar day written `YYYY-MM-DD`: `2026-13-40` is not one. */
export function validDate(s: string): boolean {
  const m = DATE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

const REF = /^(.+)-(\d+)$/;
/** A ref in `after`, `goals` or `issue`: `<repo>-<n>` or `<repo>-<n>.<k>`. */
const GOAL_REF = /^[^\s,]+-\d+(\.\d+)?$/;
/** The refs a `waiting_on` names: its comma-separated parts, trimmed, empty parts dropped. */
export const waitParts = (waits: string): string[] => waits.split(",").map((s) => s.trim()).filter(Boolean);

/** `<repo>-<n>` split into its parts, or null. */
export function parseRef(s: string): { repo: string; id: number } | null {
  const m = REF.exec(s);
  return m ? { repo: m[1], id: Number(m[2]) } : null;
}

/** `<repo>-<n>` or a goal's `<repo>-<n>.<m>` split into its parts: the id is a number for the first, `"n.m"` for the second. Null for neither. */
export function parseGoalRef(s: string): { repo: string; id: number | string } | null {
  const m = /^(.+)-(\d+(?:\.\d+)?)$/.exec(s);
  return m ? { repo: m[1], id: m[2].includes(".") ? m[2] : Number(m[2]) } : null;
}

export function todoPath(repoPath: string): string {
  return join(repoPath, "docs", "todo.md");
}

/** `status`, defaulting a legacy issue to open rather than dropping it from every view. */
export function status(item: Issue): string {
  return (item.fm.status as string) ?? "open";
}

/** An item's labels. A lone label not in a list, which lint flags and fix wraps, counts as a list of one. */
export function labels(item: Issue): string[] {
  const l = item.fm.labels;
  if (Array.isArray(l)) return l.map(String);
  return l === undefined || l === null || l === "" ? [] : [String(l)];
}

const HEADING = /^##\s+(\d+)\.\s*(.*)$/;
const NOTES = /^###\s+Notes\s*$/;

function splitNotes(text: string): { body: string; notes: string[] } {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => NOTES.test(l));
  if (at < 0) return { body: text, notes: [] };
  const notes = lines.slice(at + 1).filter((l) => l.trim().startsWith("- "));
  return { body: lines.slice(0, at).join("\n"), notes };
}

export function parse(text: string): Doc {
  const lines = text.split("\n");
  const starts: number[] = [];
  for (let i = 0; i < lines.length; i++) if (HEADING.test(lines[i])) starts.push(i);
  const head = lines.slice(0, starts[0] ?? lines.length).join("\n");
  const items: Issue[] = [];
  for (let n = 0; n < starts.length; n++) {
    const from = starts[n];
    const to = starts[n + 1] ?? lines.length;
    const [, id, title] = HEADING.exec(lines[from])!;
    const rest = lines.slice(from + 1, to).join("\n").replace(/^\n/, "");
    const { frontmatter, body: afterFm } = splitFrontmatter(rest);
    const { body, notes } = splitNotes(afterFm);
    items.push({
      id: Number(id),
      title: title.trim(),
      fm: frontmatter === null ? {} : parseFrontmatter(frontmatter),
      body: body.replace(/^\n+/, "").replace(/\n+$/, ""),
      notes,
      legacy: frontmatter === null,
    });
  }
  return { head, items };
}

export function render(doc: Doc): string {
  const parts = [doc.head.replace(/\n+$/, "")];
  for (const item of doc.items) {
    const block = [`## ${item.id}. ${item.title}`];
    if (!item.legacy) block.push(serializeFrontmatter(item.fm).replace(/\n$/, ""));
    if (item.body.trim()) block.push("", item.body.replace(/\n+$/, ""));
    if (item.notes.length) block.push("", "### Notes", "", ...item.notes);
    parts.push(block.join("\n"));
  }
  return parts.join("\n\n") + "\n";
}

/**
 * One issue as a work store file: the frontmatter carries `id: <repo>-<n>`,
 * `title` and `repo` beside the item's own fields, so Backlog.md can read it.
 * The body and the Notes follow as they do in a list section.
 */
export function renderItem(repo: string, item: Issue): string {
  const { id: _, ...fields } = item.fm;
  // Backlog.md reads the creation and update dates only from `created_date` and `updated_date`, so the store writes those keys.
  const dateKey: Record<string, string> = { created: "created_date", updated: "updated_date" };
  const written = Object.fromEntries(Object.entries(fields).map(([k, v]) => [dateKey[k] ?? k, v]));
  const fm = serializeFrontmatter({ id: `${repo}-${refOf(item)}`, title: item.title, ...written, repo });
  const block: string[] = [];
  if (item.body.trim()) block.push(item.body.replace(/\n+$/, ""));
  if (item.notes.length) block.push(["### Notes", "", ...item.notes].join("\n"));
  return fm + (block.length ? "\n" + block.join("\n\n") + "\n" : "");
}

export function parseItem(text: string): Issue {
  const { frontmatter, body: rest } = splitFrontmatter(text);
  const { title, repo: _, id: full, ...raw } = parseFrontmatter(frontmatter ?? "");
  // `created_date` and `updated_date` are what Backlog.md reads and win when a file has both keys; `created` and `updated` are what older files carry.
  // Each pair becomes one field, in the place the file gave the winning key.
  const dateKey: Record<string, string> = { created_date: "created", updated_date: "updated" };
  const fields = Object.fromEntries(
    Object.entries(raw)
      .filter(([k]) => !(k === "created" && raw.created_date !== undefined) && !(k === "updated" && raw.updated_date !== undefined))
      .map(([k, v]) => [dateKey[k] ?? k, v]),
  );
  const m = /-(\d+)(?:\.(\d+))?$/.exec(String(full));
  const id = Number(m?.[1]);
  const sub = m?.[2] === undefined ? undefined : Number(m[2]);
  const { body, notes } = splitNotes(rest);
  return {
    id,
    ...(sub === undefined ? {} : { sub }),
    title: String(title ?? ""),
    fm: { id: sub === undefined ? String(id) : `${id}.${sub}`, ...fields },
    body: body.replace(/^\n+/, "").replace(/\n+$/, ""),
    notes,
    legacy: false,
  };
}

export function read(repoPath: string): Doc {
  const file = todoPath(repoPath);
  if (!existsSync(file)) throw new Error(`no ${file}`);
  return parse(readFileSync(file, "utf8"));
}

export function write(repoPath: string, doc: Doc): void {
  writeFileSync(todoPath(repoPath), render(doc));
}

/** The list a repo gets on its first `todo add`. */
export function blank(repo: string): Doc {
  return { head: `# To do\n\nThings to build or look at in ${repo}. \`aleph issue\` owns this file.\nItem numbers never change: commits, the spec and the vault quote them.`, items: [] };
}

/** `"5"` for a plain item, `"5.1"` for a goal. */
export const refOf = (item: Issue): string => (item.sub === undefined ? String(item.id) : `${item.id}.${item.sub}`);
/** The id that finds the item: its number for a plain item, `"5.1"` for a goal. */
export const idOf = (item: Issue): number | string => (item.sub === undefined ? item.id : refOf(item));
/** A number resolves to the plain item, never to a goal under it; a string like `"5.1"` to the goal. */
export const find = (doc: Doc, id: number | string): Issue | undefined => doc.items.find((i) => refOf(i) === String(id));
// The max of `id` ignores `sub` on purpose: a goal's id is its parent's number, so a goal never takes a new issue number.
export const nextId = (doc: Doc): number => doc.items.reduce((m, i) => Math.max(m, i.id), 0) + 1;

/** Labels the new shape holds as fields (or not at all): `add` never writes them, whatever the caller names. */
const RETIRED_LABELS: readonly string[] = ["goal", "needs-chris", "triaged", "followup", "planned", "proposal", "live-check"];
const SOURCES = ["chris", "worker", "deps", "memory"] as const;
export type Source = (typeof SOURCES)[number];

/** The next free `k` for a goal `<n>.<k>` under issue `n`: Backlog.md does not number children, so the store does. */
export const nextSub = (doc: Doc, n: number): number => doc.items.reduce((m, i) => (i.id === n && i.sub !== undefined ? Math.max(m, i.sub) : m), 0) + 1;

/**
 * Add an issue in the new shape: `kind: issue`, `source` (chris unless the caller says worker, deps or memory)
 * and `areas`, the labels that remain. It never writes `labels`, `waiting_on` or a label of RETIRED_LABELS.
 * `route: "triaged"` marks the issue sorted, for the one the factory files for itself.
 */
export function add(doc: Doc, title: string, o: { priority?: string; labels?: string[]; body?: string; due?: string; source?: Source; route?: string; now?: Date } = {}): Issue {
  const day = today(o.now);
  const given = o.labels ?? [];
  const source = o.source ?? (given.includes("followup") ? "worker" : given.includes("deps") ? "deps" : given.includes("memory") ? "memory" : "chris");
  const areas = given.filter((l) => !RETIRED_LABELS.includes(l) && !(SOURCES as readonly string[]).includes(l) && l !== "deps" && l !== "memory");
  const item: Issue = {
    id: nextId(doc),
    title,
    fm: { id: String(nextId(doc)), status: "open", created: day, updated: day, priority: o.priority ?? "medium", kind: "issue", source, areas, ...(o.route ? { route: o.route } : {}) },
    body: o.body ?? "",
    notes: [],
    legacy: false,
  };
  setReadiness(item, o);
  doc.items.push(item);
  return item;
}

/**
 * Add goal `<n>.<k>` under issue `issue` (`k` the next free number): `kind: goal`, `issue: <repo>-<n>`, `after`, and the
 * issue's priority. The issue's `goals` gains it. The refs carry the doc's repo key (`doc.repo`, set by the store), or `o.repo`.
 */
export function addGoal(doc: Doc, issue: Issue, o: { title: string; body: string; after?: string[]; repo?: string; now?: Date }): Issue {
  const day = today(o.now);
  const repo = o.repo ?? doc.repo ?? (() => { throw new Error("addGoal: the doc names no repo"); })();
  const sub = nextSub(doc, issue.id);
  const ref = `${repo}-${issue.id}.${sub}`;
  const goal: Issue = {
    id: issue.id,
    sub,
    title: o.title,
    fm: { id: `${issue.id}.${sub}`, status: "open", created: day, updated: day, priority: (issue.fm.priority as string) ?? "medium", kind: "goal", issue: `${repo}-${issue.id}`, after: o.after ?? [] },
    body: o.body,
    notes: [],
    legacy: false,
  };
  const goals = Array.isArray(issue.fm.goals) ? issue.fm.goals.map(String) : [];
  issue.fm.goals = [...goals, ref];
  issue.fm.updated = day;
  doc.items.push(goal);
  return goal;
}

/** The old `add`, for the code that still writes the old shape (the planner, the UI's wait route) until aleph-849 and aleph-628: labels, `waiting_on`, no `kind`. */
export function addLegacy(doc: Doc, title: string, o: { priority?: string; labels?: string[]; body?: string; due?: string; waitingOn?: string; now?: Date } = {}): Issue {
  const day = today(o.now);
  const item: Issue = {
    id: nextId(doc),
    title,
    fm: { id: String(nextId(doc)), status: "open", created: day, updated: day, priority: o.priority ?? "medium", labels: o.labels ?? [] },
    body: o.body ?? "",
    notes: [],
    legacy: false,
  };
  setReadiness(item, o);
  doc.items.push(item);
  return item;
}

/** Set `waiting_on` on an item, or remove it with `none`: the old shape's only writer of the field. */
export function setWaitingOn(item: Issue, waitingOn: string, now = new Date()): void {
  edit(item, { waitingOn }, now);
}

/** Set `due` and `waiting_on` from the values given; `none` removes the field. */
function setReadiness(item: Issue, o: { due?: string; waitingOn?: string }): void {
  for (const [key, value] of [["due", o.due], ["waiting_on", o.waitingOn]] as const) {
    if (value === undefined) continue;
    if (value === "none") delete item.fm[key];
    else item.fm[key] = value;
  }
}

/** Append-only: an existing note line is never rewritten, which is the lost update this format exists to stop. */
export function note(item: Issue, text: string, now = new Date()): string {
  const line = `- ${minute(now)}: ${text}`;
  item.notes.push(line);
  item.fm.updated = today(now);
  if (item.legacy) adopt(item, now);
  return line;
}

/** Replace the fields given. Notes are never edited: they stay append-only. */
export function edit(item: Issue, change: { title?: string; body?: string; priority?: string; labels?: string[]; areas?: string[]; due?: string; waitingOn?: string }, now = new Date()): void {
  if (item.legacy) adopt(item, now);
  if (change.title !== undefined) item.title = change.title;
  if (change.body !== undefined) item.body = change.body;
  if (change.priority !== undefined) item.fm.priority = change.priority;
  if (change.labels !== undefined) item.fm.labels = change.labels;
  if (change.areas !== undefined) item.fm.areas = change.areas;
  setReadiness(item, change);
  item.fm.updated = today(now);
}

export function setStatus(item: Issue, next: Status, now = new Date()): void {
  if (item.legacy) adopt(item, now);
  item.fm.status = next;
  item.fm.updated = today(now);
}

/** Give a legacy item the header it never had, keeping its prose untouched. */
export function adopt(item: Issue, now = new Date(), created?: string): void {
  const day = today(now);
  item.fm = {
    id: String(item.id),
    status: (item.fm.status as string) ?? "open",
    created: created ?? day,
    updated: day,
    priority: (item.fm.priority as string) ?? "medium",
    labels: labels(item),
    ...item.fm,
  };
  item.fm.id = String(item.id);
  item.legacy = false;
}

const refParts = (r: string): [number, number] => { const [n, k] = r.split("."); return [Number(n), k === undefined ? -1 : Number(k)]; };
const byRef = (a: Finding, b: Finding) => { const [an, ak] = refParts(a.id), [bn, bk] = refParts(b.id); return an - bn || ak - bk; };

export interface Finding {
  id: string;
  problem: string;
  fixable: boolean;
}

/** `exists` says whether `<repo>-<n>` names an item; without it a `waiting_on` is only checked for form. */
export function lint(doc: Doc, exists?: (repo: string, id: number) => boolean): Finding[] {
  const findings: Finding[] = [];
  const seen = new Map<string, number>();
  for (const item of doc.items) {
    seen.set(refOf(item), (seen.get(refOf(item)) ?? 0) + 1);
    if (item.legacy) continue;
    for (const key of REQUIRED) {
      if (item.fm[key] === undefined || item.fm[key] === "") {
        findings.push({ id: refOf(item), problem: `${key} is missing`, fixable: key === "updated" || key === "created" || key === "id" });
      }
    }
    const s = item.fm.status;
    if (s !== undefined && !STATUSES.includes(s as Status)) findings.push({ id: refOf(item), problem: `status "${s}" is not one of ${STATUSES.join(", ")}`, fixable: false });
    for (const key of ["created", "updated"] as const) {
      const v = item.fm[key];
      if (typeof v === "string" && v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) findings.push({ id: refOf(item), problem: `${key} "${v}" is not YYYY-MM-DD`, fixable: false });
    }
    const due = item.fm.due;
    if (due !== undefined && !(typeof due === "string" && validDate(due))) findings.push({ id: refOf(item), problem: `due: ${due} is not a date written YYYY-MM-DD`, fixable: false });
    const waits = item.fm.waiting_on;
    if (waits !== undefined) {
      const parts = typeof waits === "string" ? waitParts(waits) : [];
      const refs = parts.map(parseRef);
      if (!parts.length || refs.some((r) => !r)) findings.push({ id: refOf(item), problem: `waiting_on: ${waits} is not <repo>-<n>[,<repo>-<n>...]`, fixable: false });
      else if (exists && refs.some((r) => !exists(r!.repo, r!.id))) findings.push({ id: refOf(item), problem: `waiting_on: ${waits} names no issue`, fixable: false });
    }
    for (const key of ["after", "goals", "issue"] as const) {
      const v = item.fm[key];
      if (v === undefined) continue;
      const refs = Array.isArray(v) ? v : [v];
      if (key === "issue" ? typeof v !== "string" : false) findings.push({ id: refOf(item), problem: `${key} must be one ref`, fixable: false });
      else if (refs.some((r) => !GOAL_REF.test(r))) findings.push({ id: refOf(item), problem: `${key}: ${refs.join(", ")} is not <repo>-<n>[.<k>]`, fixable: false });
    }
    for (const key of ["kind", "source", "ask"] as const) {
      const v = item.fm[key];
      const ok = { kind: ["goal", "issue", "product", "build"], source: ["chris", "worker", "deps", "memory"], ask: ["input", "approval"] }[key];
      if (v !== undefined && !ok.includes(v as string)) findings.push({ id: refOf(item), problem: `${key} "${v}" is not one of ${ok.join(", ")}`, fixable: false });
    }
    if (item.fm.labels !== undefined && !Array.isArray(item.fm.labels)) findings.push({ id: refOf(item), problem: "labels must be a list", fixable: true });
    if (item.fm.id !== undefined && String(item.fm.id) !== refOf(item)) findings.push({ id: refOf(item), problem: `id says ${item.fm.id} but the heading says ${refOf(item)}`, fixable: true });
  }
  for (const [ref, count] of seen) if (count > 1) findings.push({ id: ref, problem: `${count} items share id ${ref}`, fixable: false });
  return findings.sort(byRef);
}

/** Repair what is mechanically repairable. Returns what it changed. */
export function fix(doc: Doc, now = new Date()): string[] {
  const fixed: string[] = [];
  for (const item of doc.items) {
    if (item.legacy) continue;
    if (item.fm.id === undefined || String(item.fm.id) !== refOf(item)) { item.fm.id = refOf(item); fixed.push(`${refOf(item)}: id set to ${refOf(item)}`); }
    if (!item.fm.status) { item.fm.status = "open"; fixed.push(`${refOf(item)}: status set to open`); }
    if (!item.fm.created) { item.fm.created = (item.fm.updated as string) || today(now); fixed.push(`${refOf(item)}: created set to ${item.fm.created}`); }
    if (!item.fm.updated) { item.fm.updated = (item.fm.created as string) || today(now); fixed.push(`${refOf(item)}: updated set to ${item.fm.updated}`); }
    if (item.fm.labels !== undefined && !Array.isArray(item.fm.labels)) { item.fm.labels = [String(item.fm.labels)]; fixed.push(`${refOf(item)}: labels wrapped in a list`); }
  }
  return fixed;
}
