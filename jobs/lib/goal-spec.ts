/**
 * A goal's spec: the Markdown sections a goal issue must have, the paths of its Edit surface, and
 * its version. The spec check, the planner, the director, the rescue and the busy-file wait all
 * read a spec through this module.
 */
import { createHash } from "node:crypto";
import { section, type Issue } from "../../todo/lib/todo.ts";

/** The sections the spec check reads. A goal without one of them cannot be checked. */
const REQUIRED = ["Goal", "Edit surface", "Oracle"] as const;

/** The required sections that are absent or empty in `body`, in order. */
export const missingSections = (body: string): string[] => REQUIRED.filter((name) => !section(body, name));

/**
 * The paths named in the Edit surface of `body`: each word that can be a path, without trailing dots.
 * A plain prose word comes along too, as a file at the repo's root such as `Makefile` has no `/` or `.`.
 */
export function surfacePaths(body: string): string[] {
  const words = section(body, "Edit surface").split(/[^\w./@-]+/).map((w) => w.replace(/\.+$/, ""));
  return [...new Set(words.filter(Boolean))];
}

const hash = (text: string): string => createHash("sha256").update(text).digest("hex").slice(0, 12);

/** The text of a goal that an edit changes: its title, request and spec. */
const textOf = (item: Issue): string => JSON.stringify([item.title, item.request, item.spec]);

/** The version of a goal's spec: a short hash of its title, request and spec. An edit of any of them makes a new version. */
export const specVersion = (item: Issue): string => hash(textOf(item));

/**
 * Whether `recorded`, a version written earlier, is the goal's version now. Notes and run folders
 * written before this module hold older forms: the spec check's hash of the trimmed spec, and the
 * rescue's JSON text of the title, request and spec. Both still count.
 */
export function isVersion(item: Issue, recorded: string): boolean {
  const r = recorded.trim();
  return r === specVersion(item) || r === hash(item.spec.trim()) || r === textOf(item);
}
