/**
 * The handoffs folder's layout, read in one place. A key is a path in the folder: `projects/<scope>.md` is a
 * project's handoff, `projects/<scope>/<id>.md` a Herdr pane's (`<pane>`) or a desktop terminal's (`hc-<terminal>`),
 * `<YYYY-MM-DD-HHMMSS>[-<name>].md` a handoff pickup archived, and any other `<name>.md` a named handoff.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { clip } from "./naming.ts";
import { handoffsDir } from "./paths.ts";

type Kind = "project" | "pane" | "named" | "dated";
/** One handoff. `scope` is a project's or a pane's repo, `name` a pane's id or a named handoff's name, `day` an archived one's date; else "". */
export type Handoff = { key: string; path: string; kind: Kind; scope: string; name: string; day: string };

const PROJECT = /^projects\/([^/.][^/]*)\.md$/;
const PANE = /^projects\/([^/.][^/]*)\/([^/.][^/]*)\.md$/;
const DATED = /^(\d{4}-\d\d-\d\d)-\d{6}(?:-[^/]*)?\.md$/;
const NAMED = /^([^/.][^/]*)\.md$/;

/** The handoff at `at`, a key or a path in the folder; null for any other file. */
export function handoffOf(at: string): Handoff | null {
  const dir = resolve(handoffsDir()), key = relative(dir, resolve(dir, at)), path = join(dir, key);
  const project = PROJECT.exec(key), pane = PANE.exec(key), dated = DATED.exec(key), named = NAMED.exec(key);
  if (project) return { key, path, kind: "project", scope: project[1], name: "", day: "" };
  if (pane) return { key, path, kind: "pane", scope: pane[1], name: pane[2], day: "" };
  if (dated) return { key, path, kind: "dated", scope: "", name: "", day: dated[1] };
  return named && { key, path, kind: "named", scope: "", name: named[1], day: "" };
}

/** Every handoff in the folder, by key. */
export function handoffs(): Handoff[] {
  const dir = handoffsDir();
  const ls = (rel: string): string[] => (existsSync(join(dir, rel)) ? readdirSync(join(dir, rel)).map((f) => (rel ? `${rel}/${f}` : f)) : []);
  const scopes = ls("projects").filter((k) => statSync(join(dir, k)).isDirectory());
  return [...ls(""), ...ls("projects"), ...scopes.flatMap(ls)].sort().flatMap((k) => handoffOf(k) ?? []);
}

/** A handoff's `summary:` line, else the first non-blank line under its `## Intent`, else its first line. */
export function intent(text: string): string {
  const summary = text.match(/^summary:[ \t]*(.+)/m)?.[1].trim();
  if (summary) return clip(summary, 160);
  const lines = text.split("\n");
  const at = lines.findIndex((l) => /^##\s+intent\s*$/i.test(l));
  const from = at < 0 ? lines : lines.slice(at + 1);
  return clip(from.find((l) => l.trim() && !/^#/.test(l)) ?? "", 160);
}
