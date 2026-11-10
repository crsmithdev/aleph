/**
 * Notes on aleph pages: $ALEPH_ANNOTATIONS or ~/.aleph/annotations.json.
 * A v2 note is the v1 fields of ui/vendor/kit/annotate.js plus status, by and replies.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { refuse } from "./refusal.ts";

export type Reply = { by: string; note: string; at: string };
export type Note = {
  id: string; url: string; selector: string; text: string; html: string; note: string; at: string;
  status: "open" | "resolved"; by: string; replies: Reply[];
};

export const file = () => process.env.ALEPH_ANNOTATIONS ?? join(homedir(), ".aleph", "annotations.json");

/** Every note; a v1 note reads as open, written by "user", with no replies. */
export function load(): Note[] {
  if (!existsSync(file())) return [];
  return JSON.parse(readFileSync(file(), "utf8")).map((n: Partial<Note>) => ({ status: "open", by: "user", replies: [], ...n }));
}

function save(all: Note[]): Note[] {
  mkdirSync(dirname(file()), { recursive: true });
  writeFileSync(file(), JSON.stringify(all, null, 2));
  return all;
}

const find = (all: Note[], id: string) => all.find((n) => n.id === id) ?? refuse(`no note ${id}`);

/** A new open note; a v1 field left undefined is saved as "", as annotate.js would. `at` is an ISO time, as in v1. */
export function add(by: string, n: Pick<Note, "url" | "note"> & { selector?: string; text?: string; html?: string }): Note {
  const made: Note = { id: crypto.randomUUID().slice(0, 8), url: n.url, selector: n.selector ?? "", text: n.text ?? "", html: n.html ?? "", note: n.note, at: new Date().toISOString(), status: "open", by, replies: [] };
  save([...load(), made]);
  return made;
}

/** Add a note, or replace the one with its id: what the page's store puts. */
export function put(n: Note): Note {
  const all = load();
  save(all.some((x) => x.id === n.id) ? all.map((x) => (x.id === n.id ? n : x)) : [...all, n]);
  return n;
}

export function reply(id: string, by: string, note: string): Note {
  const all = load();
  const n = find(all, id);
  n.replies.push({ by, note, at: new Date().toISOString() });
  save(all);
  return n;
}

export function resolve(id: string): Note {
  const all = load();
  const n = find(all, id);
  n.status = "resolved";
  save(all);
  return n;
}

export function drop(id: string): Note[] {
  const all = load();
  find(all, id);
  return save(all.filter((n) => n.id !== id));
}
