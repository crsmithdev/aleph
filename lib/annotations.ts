/**
 * The annotations: notes pinned on elements of UI pages with ui/vendor/kit/annotate.js, and the replies to them.
 * One JSON file holds them all (`annotationsFile()`), outside git: a note lives until someone drops it. The page writes
 * through `aleph annotation put` and `drop`; an agent reads, replies, resolves and adds through the other verbs.
 *
 * A note is v 2 of the kit's shape. `url` "" puts a note on every page where its selector finds an element, which is
 * how an agent pins a note on an item by its `data-annotate` id without knowing which page shows it.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { annotationsFile } from "../jobs/lib/infra/settings.ts";
import { refuse } from "./refusal.ts";

export type By = "you" | "agent";
export type Status = "open" | "resolved";
export interface Reply { by: By; text: string; at: string }
export interface Note { v: 2; id: string; url: string; selector: string; text: string; html: string; note: string; status: Status; by: By; replies: Reply[]; at: string }

const BY: By[] = ["you", "agent"];
const STATUS: Status[] = ["open", "resolved"];

/** Every note, oldest first; a v 1 note reads as open, by you, with no replies. */
export function read(): Note[] {
  const file = annotationsFile();
  if (!existsSync(file)) return [];
  return (JSON.parse(readFileSync(file, "utf8")) as Partial<Note>[]).map((n) => ({ url: "", text: "", html: "", status: "open", by: "you", replies: [], ...n, v: 2 }) as Note);
}

/** Replaces the file whole: a rename, so a reader never sees half of it. */
function write(all: Note[]): void {
  const file = annotationsFile();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, `${JSON.stringify(all, null, 2)}\n`);
  renameSync(`${file}.tmp`, file);
}

const now = () => new Date().toISOString();
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const one = (id: string): Note => read().find((n) => n.id === id) ?? refuse(`no annotation ${id}`);
const str = (v: unknown, name: string): string => (typeof v === "string" ? v : refuse(`${name} must be a string`));

/** Saves a note the page sends, in its place or at the end; it refuses a note without id, selector or text. */
export function put(raw: unknown): Note {
  const n = (raw ?? {}) as Record<string, unknown>;
  const note: Note = {
    v: 2, id: str(n.id, "id"), url: str(n.url ?? "", "url"), selector: str(n.selector, "selector"), text: str(n.text ?? "", "text"),
    html: str(n.html ?? "", "html"), note: str(n.note, "note").trim(), status: STATUS.includes(n.status as Status) ? (n.status as Status) : "open",
    by: BY.includes(n.by as By) ? (n.by as By) : "you", at: str(n.at ?? now(), "at"),
    replies: (Array.isArray(n.replies) ? n.replies : []).map((r: any) => ({ by: BY.includes(r?.by) ? r.by : "you", text: str(r?.text, "reply text"), at: str(r?.at ?? now(), "reply at") })),
  };
  if (!note.id || !note.selector || !note.note) refuse("an annotation needs an id, a selector and a note");
  const all = read();
  write(all.some((x) => x.id === note.id) ? all.map((x) => (x.id === note.id ? note : x)) : [...all, note]);
  return note;
}

/** A new note by `by` on `selector`; `url` "" shows it on every page that has the element. */
export const add = (selector: string, note: string, { url = "", by = "agent" as By } = {}): Note =>
  put({ id: uid(), url, selector, note, by, status: "open", replies: [], at: now() });

/** Adds a reply to a note. */
export function reply(id: string, text: string, by: By = "agent"): Note {
  const n = one(id);
  return put({ ...n, replies: [...n.replies, { by, text: text.trim() || refuse("a reply needs text"), at: now() }] });
}

/** Marks a note resolved or open again. */
export const mark = (id: string, status: Status): Note => put({ ...one(id), status });

/** Deletes a note. */
export function drop(id: string): { dropped: string } {
  one(id);
  write(read().filter((n) => n.id !== id));
  return { dropped: id };
}

/** The selector of a `data-annotate` id, the anchor aleph puts on each issue and job row. */
export const anchor = (id: string): string => `[data-annotate="${id.replace(/["\\]/g, "\\$&")}"]`;

/** Notes as the Markdown the page's Copy gives, grouped by page. */
export function markdown(notes: Note[]): string {
  if (!notes.length) return "No annotations.";
  const pages = [...new Set(notes.map((n) => n.url))];
  return pages.map((url) => [`Annotations on ${url || "any page with the element"}:`, "", ...notes.filter((n) => n.url === url).map((n, i) => [
    `${i + 1}. ${n.note.replace(/\n/g, "\n   ")}${n.by === "agent" ? " (by the agent)" : ""}${n.status === "resolved" ? " (resolved)" : ""}`,
    `   - id: ${n.id}`,
    `   - element: \`${n.selector}\``,
    ...(n.text ? [`   - text: "${n.text}"`] : []),
    ...(n.html ? [`   - html: \`${n.html.replace(/`/g, "'")}\``] : []),
    ...n.replies.map((r) => `   - reply from ${r.by}: ${r.text.replace(/\n/g, " ")}`),
  ].join("\n"))].join("\n")).join("\n\n");
}
