/**
 * A repo's `docs/todo.md`: numbered `## N. Title` sections, each with a small
 * frontmatter block and free prose. Status is a field, never a filing
 * position, so nothing moves and nothing is renumbered when an item ships.
 *
 * The file is parsed as sections and rewritten section by section, so an item
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
  /** No frontmatter block in the file: an item written before this command existed. */
  legacy: boolean;
}

export interface Doc {
  /** Everything above the first item, verbatim. */
  head: string;
  items: Item[];
}

// Local time, not UTC. `toISOString` stamps the UTC date, so west of Greenwich
// every item filed in the evening carried tomorrow's date.
const pad = (n: number): string => String(n).padStart(2, "0");

export const today = (now = new Date()): string =>
  `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
export const minute = (now = new Date()): string =>
  `${today(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

export function todoPath(repoPath: string): string {
  return join(repoPath, "docs", "todo.md");
}

/** `status`, defaulting a legacy item to open rather than dropping it from every view. */
export function status(item: Item): string {
  return (item.fm.status as string) ?? "open";
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
      body: body.replace(/\n+$/, ""),
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
  return { head: `# To do\n\nThings to build or look at in ${repo}. \`aleph todo\` owns this file.\nItem numbers never change: commits, the spec and the vault quote them.`, items: [] };
}

export const find = (doc: Doc, id: number): Item | undefined => doc.items.find((i) => i.id === id);
export const nextId = (doc: Doc): number => doc.items.reduce((m, i) => Math.max(m, i.id), 0) + 1;

export function add(doc: Doc, title: string, o: { priority?: string; labels?: string[]; now?: Date } = {}): Item {
  const day = today(o.now);
  const item: Item = {
    id: nextId(doc),
    title,
    fm: { id: String(nextId(doc)), status: "open", created: day, updated: day, priority: o.priority ?? "medium", labels: o.labels ?? [] },
    body: "",
    notes: [],
    legacy: false,
  };
  doc.items.push(item);
  return item;
}

/** Append-only: an existing note line is never rewritten, which is the lost update this format exists to stop. */
export function note(item: Item, text: string, now = new Date()): string {
  const line = `- ${minute(now)}: ${text}`;
  item.notes.push(line);
  item.fm.updated = today(now);
  if (item.legacy) adopt(item, now);
  return line;
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
    labels: (item.fm.labels as string[]) ?? [],
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

export function lint(doc: Doc): Finding[] {
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
