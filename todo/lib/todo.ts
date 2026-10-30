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

export interface Item {
  id: number;
  title: string;
  fm: Frontmatter;
  /** Prose under the heading, frontmatter and Notes removed. Verbatim. */
  body: string;
  /** Raw `- YYYY-MM-DD HH:MM: text` lines, in the order they were appended. */
  notes: string[];
  /** No frontmatter block in the file: an issue written before this command existed. */
  legacy: boolean;
}

export interface Doc {
  /** Everything above the first issue, verbatim. */
  head: string;
  items: Item[];
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

export function todoPath(repoPath: string): string {
  return join(repoPath, "docs", "todo.md");
}

/** `status`, defaulting a legacy issue to open rather than dropping it from every view. */
export function status(item: Item): string {
  return (item.fm.status as string) ?? "open";
}

/** An item's labels. A lone label not in a list, which lint flags and fix wraps, counts as a list of one. */
export function labels(item: Item): string[] {
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
  const items: Item[] = [];
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
export function renderItem(repo: string, item: Item): string {
  const { id: _, ...fields } = item.fm;
  const fm = serializeFrontmatter({ id: `${repo}-${item.id}`, title: item.title, ...fields, repo });
  const block: string[] = [];
  if (item.body.trim()) block.push(item.body.replace(/\n+$/, ""));
  if (item.notes.length) block.push(["### Notes", "", ...item.notes].join("\n"));
  return fm + (block.length ? "\n" + block.join("\n\n") + "\n" : "");
}

export function parseItem(text: string): Item {
  const { frontmatter, body: rest } = splitFrontmatter(text);
  const { title, repo: _, id: full, ...fields } = parseFrontmatter(frontmatter ?? "");
  const id = Number(/-(\d+)$/.exec(String(full))?.[1]);
  const { body, notes } = splitNotes(rest);
  return {
    id,
    title: String(title ?? ""),
    fm: { id: String(id), ...fields },
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

export const find = (doc: Doc, id: number): Item | undefined => doc.items.find((i) => i.id === id);
export const nextId = (doc: Doc): number => doc.items.reduce((m, i) => Math.max(m, i.id), 0) + 1;

export function add(doc: Doc, title: string, o: { priority?: string; labels?: string[]; body?: string; due?: string; waitingOn?: string; now?: Date } = {}): Item {
  const day = today(o.now);
  const item: Item = {
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

/** Set `due` and `waiting_on` from the values given; `none` removes the field. */
function setReadiness(item: Item, o: { due?: string; waitingOn?: string }): void {
  for (const [key, value] of [["due", o.due], ["waiting_on", o.waitingOn]] as const) {
    if (value === undefined) continue;
    if (value === "none") delete item.fm[key];
    else item.fm[key] = value;
  }
}

/** Append-only: an existing note line is never rewritten, which is the lost update this format exists to stop. */
export function note(item: Item, text: string, now = new Date()): string {
  const line = `- ${minute(now)}: ${text}`;
  item.notes.push(line);
  item.fm.updated = today(now);
  if (item.legacy) adopt(item, now);
  return line;
}

/** Replace the fields given. Notes are never edited: they stay append-only. */
export function edit(item: Item, change: { title?: string; body?: string; priority?: string; labels?: string[]; due?: string; waitingOn?: string }, now = new Date()): void {
  if (item.legacy) adopt(item, now);
  if (change.title !== undefined) item.title = change.title;
  if (change.body !== undefined) item.body = change.body;
  if (change.priority !== undefined) item.fm.priority = change.priority;
  if (change.labels !== undefined) item.fm.labels = change.labels;
  setReadiness(item, change);
  item.fm.updated = today(now);
}

export function setStatus(item: Item, next: Status, now = new Date()): void {
  if (item.legacy) adopt(item, now);
  item.fm.status = next;
  item.fm.updated = today(now);
}

/** Give a legacy item the header it never had, keeping its prose untouched. */
export function adopt(item: Item, now = new Date(), created?: string): void {
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

export interface Finding {
  id: number;
  problem: string;
  fixable: boolean;
}

/** `exists` says whether `<repo>-<n>` names an item; without it a `waiting_on` is only checked for form. */
export function lint(doc: Doc, exists?: (repo: string, id: number) => boolean): Finding[] {
  const findings: Finding[] = [];
  const seen = new Map<number, number>();
  for (const item of doc.items) {
    seen.set(item.id, (seen.get(item.id) ?? 0) + 1);
    if (item.legacy) continue;
    for (const key of REQUIRED) {
      if (item.fm[key] === undefined || item.fm[key] === "") {
        findings.push({ id: item.id, problem: `${key} is missing`, fixable: key === "updated" || key === "created" || key === "id" });
      }
    }
    const s = item.fm.status;
    if (s !== undefined && !STATUSES.includes(s as Status)) findings.push({ id: item.id, problem: `status "${s}" is not one of ${STATUSES.join(", ")}`, fixable: false });
    for (const key of ["created", "updated"] as const) {
      const v = item.fm[key];
      if (typeof v === "string" && v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) findings.push({ id: item.id, problem: `${key} "${v}" is not YYYY-MM-DD`, fixable: false });
    }
    const due = item.fm.due;
    if (due !== undefined && !(typeof due === "string" && validDate(due))) findings.push({ id: item.id, problem: `due: ${due} is not a date written YYYY-MM-DD`, fixable: false });
    const waits = item.fm.waiting_on;
    if (waits !== undefined) {
      const parts = typeof waits === "string" ? waitParts(waits) : [];
      const refs = parts.map(parseRef);
      if (!parts.length || refs.some((r) => !r)) findings.push({ id: item.id, problem: `waiting_on: ${waits} is not <repo>-<n>[,<repo>-<n>...]`, fixable: false });
      else if (exists && refs.some((r) => !exists(r!.repo, r!.id))) findings.push({ id: item.id, problem: `waiting_on: ${waits} names no issue`, fixable: false });
    }
    for (const key of ["after", "goals", "issue"] as const) {
      const v = item.fm[key];
      if (v === undefined) continue;
      const refs = Array.isArray(v) ? v : [v];
      if (key === "issue" ? typeof v !== "string" : false) findings.push({ id: item.id, problem: `${key} must be one ref`, fixable: false });
      else if (refs.some((r) => !GOAL_REF.test(r))) findings.push({ id: item.id, problem: `${key}: ${refs.join(", ")} is not <repo>-<n>[.<k>]`, fixable: false });
    }
    for (const key of ["kind", "source", "ask"] as const) {
      const v = item.fm[key];
      const ok = { kind: ["goal", "issue", "product", "build"], source: ["chris", "worker", "deps", "memory"], ask: ["input", "approval"] }[key];
      if (v !== undefined && !ok.includes(v as string)) findings.push({ id: item.id, problem: `${key} "${v}" is not one of ${ok.join(", ")}`, fixable: false });
    }
    if (item.fm.labels !== undefined && !Array.isArray(item.fm.labels)) findings.push({ id: item.id, problem: "labels must be a list", fixable: true });
    if (item.fm.id !== undefined && Number(item.fm.id) !== item.id) findings.push({ id: item.id, problem: `id says ${item.fm.id} but the heading says ${item.id}`, fixable: true });
  }
  for (const [id, count] of seen) if (count > 1) findings.push({ id, problem: `${count} items share id ${id}`, fixable: false });
  return findings.sort((a, b) => a.id - b.id);
}

/** Repair what is mechanically repairable. Returns what it changed. */
export function fix(doc: Doc, now = new Date()): string[] {
  const fixed: string[] = [];
  for (const item of doc.items) {
    if (item.legacy) continue;
    if (item.fm.id === undefined || Number(item.fm.id) !== item.id) { item.fm.id = String(item.id); fixed.push(`${item.id}: id set to ${item.id}`); }
    if (!item.fm.status) { item.fm.status = "open"; fixed.push(`${item.id}: status set to open`); }
    if (!item.fm.created) { item.fm.created = (item.fm.updated as string) || today(now); fixed.push(`${item.id}: created set to ${item.fm.created}`); }
    if (!item.fm.updated) { item.fm.updated = (item.fm.created as string) || today(now); fixed.push(`${item.id}: updated set to ${item.fm.updated}`); }
    if (item.fm.labels !== undefined && !Array.isArray(item.fm.labels)) { item.fm.labels = [String(item.fm.labels)]; fixed.push(`${item.id}: labels wrapped in a list`); }
  }
  return fixed;
}
