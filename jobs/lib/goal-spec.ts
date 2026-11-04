/**
 * A goal's spec: the Markdown sections a goal issue must have, the paths of its Edit surface, and
 * its version. The spec check, the planner, the director, the rescue, the reviewer and the busy-file wait all
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

/**
 * The files of `files` that the Edit surface of `body` does not name: not a named path, and not under a named folder.
 * A spec with no Edit surface has nothing to judge against, so none.
 */
export function outsideSurface(body: string, files: string[]): string[] {
  const surface = surfacePaths(body);
  if (!surface.length) return [];
  return files.filter((f) => !surface.some((p) => f === p || f.startsWith(p.endsWith("/") ? p : `${p}/`)));
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

const CHECK = "(?:bun test|bun run|bunx tsc)";
/** A plain check command, or a shell `for` loop whose body runs one. */
const RUNNABLE = new RegExp(`^${CHECK}(\\s|$)|^for\\s.*;\\s*do\\b.*[\\s;&|(]${CHECK}(?=[\\s;&|)]|$)`);
/** A placeholder such as `<file>`, `<repo>-<n>` or `<that file>` that the Oracle leaves for the reader to fill in. Not a redirection: a space inside the brackets must be followed by a letter, so `<in >out` does not match. */
const PLACEHOLDER = /<[A-Za-z][A-Za-z0-9_-]*(?: [A-Za-z][A-Za-z0-9_-]*)*>/;
/** A test file by its name, as `bun test` takes one. */
const TEST_FILE = /\.(?:test|spec)\.(?:ts|js)$/;

/**
 * `bun test` takes a file whose name has no `.test` or `.spec` (such as `a.accept.ts`) only with a `./` path; without it
 * the argument is a name filter that matches no test file. This adds the `./`.
 */
const asPath = (command: string): string =>
  /^bun test\s/.test(command) ? command.replace(/(?<=\s)(?![./])(\S+\.[jt]sx?)(?=\s|$)/g, (arg) => (TEST_FILE.test(arg) ? arg : `./${arg}`)) : command;

/** The commands in backticks in the issue's `## Oracle` section that start with a command the repo's checks use. */
export function oracleCommands(body: string): string[] {
  return [...section(body, "Oracle").matchAll(/`([^`\n]+)`/g)].map((m) => asPath(m[1].trim())).filter((c) => RUNNABLE.test(c) && !PLACEHOLDER.test(c));
}
