/**
 * An issue's spec: the Markdown sections an issue must have, how intake writes them, the paths of its Edit surface,
 * the commands of its Oracle, and its version. Intake, the director, the rescue, the reviewer and the busy-file wait
 * all read a spec through this module.
 */
import { createHash } from "node:crypto";
import { section, type Issue } from "../../../issues/lib/todo.ts";

/** The sections an issue's spec has. */
const REQUIRED = ["Goal", "Edit surface", "Oracle"] as const;

/** A spec as intake gives it: each section a field. `new` marks a file of the Edit surface that the run creates. */
export interface Spec { goal: string; surface: { path: string; new: boolean }[]; oracle: string[] }

/** The spec as the issue keeps it: the three sections in Markdown. */
export const specText = (s: Spec): string =>
  `## Goal\n${s.goal}\n\n## Edit surface\n${s.surface.map((p) => `- ${p.path}${p.new ? " (new)" : ""}`).join("\n")}\n\n## Oracle\n${s.oracle.map((o) => `- ${o}`).join("\n")}`;

/** The required sections that are absent or empty in `body`, in order. */
export const missingSections = (body: string): string[] => REQUIRED.filter((name) => !section(body, name));

/**
 * The paths named in the Edit surface of `body`: each word that can be a path, without a leading `./` and trailing dots.
 * A plain prose word comes along too, as a file at the repo's root such as `Makefile` has no `/` or `.`.
 */
export function surfacePaths(body: string): string[] {
  const words = section(body, "Edit surface").split(/[^\w./@-]+/).map((w) => w.replace(/^\.\//, "").replace(/\.+$/, ""));
  return [...new Set(words.filter(Boolean))];
}

/** Whether `surface`, a list of paths, names `file`: the path itself, or a folder above it. A leading `./` does not count. */
export function inSurface(file: string, surface: string[]): boolean {
  const f = file.replace(/^\.\//, "");
  return surface.some((s) => {
    const p = s.replace(/^\.\//, "");
    return f === p || f.startsWith(p.endsWith("/") ? p : `${p}/`);
  });
}

/**
 * The files of `files` that the Edit surface of `body` does not name: not a named path, and not under a named folder.
 * A spec with no Edit surface has nothing to judge against, so none.
 */
export function outsideSurface(body: string, files: string[]): string[] {
  const surface = surfacePaths(body);
  if (!surface.length) return [];
  return files.filter((f) => !inSurface(f, surface));
}

const hash = (text: string): string => createHash("sha256").update(text).digest("hex").slice(0, 12);

/** The text of an issue that an edit changes: its title, request and spec. */
const textOf = (item: Issue): string => JSON.stringify([item.title, item.request, item.spec]);

/** The version of an issue's spec: a short hash of its title, request and spec. An edit of any of them makes a new version. */
export const specVersion = (item: Issue): string => hash(textOf(item));

/**
 * Whether `recorded`, a version written earlier, is the issue's version now. Notes and run folders
 * written before this module hold older forms: the old spec check's hash of the trimmed spec, and the
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
/** Whether `text` holds a placeholder such as `<file>`. */
export const hasPlaceholder = (text: string): boolean => PLACEHOLDER.test(text);

/** The commands in backticks in `text`, one per pair of backticks on one line. */
export const commandsIn = (text: string): string[] => [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1].trim());

/**
 * `bun test` takes a file whose name has no `.test` or `.spec` (such as `a.accept.ts`) only with a `./` path; without it
 * the argument is a name filter that matches no test file. True for such an argument.
 */
const nameFilter = (arg: string): boolean => /^[^-./].*\.[jt]sx?$/.test(arg) && !/\.(?:test|spec)\.[jt]sx?$/.test(arg);

/** The file arguments of a `bun test` command that bun reads as a name filter, as nameFilter says. */
export const nameFilters = (command: string): string[] => (/^bun test\s/.test(command) ? command.split(/\s+/).slice(2).filter(nameFilter) : []);

/** The command with a `./` before each argument that nameFilters names. */
const asPath = (command: string): string =>
  /^bun test\s/.test(command) ? command.replace(/(?<=\s)\S+/g, (arg) => (nameFilter(arg) ? `./${arg}` : arg)) : command;

/** The commands in backticks in the issue's `## Oracle` section that start with a command the repo's checks use. */
export function oracleCommands(body: string): string[] {
  return commandsIn(section(body, "Oracle")).map(asPath).filter((c) => RUNNABLE.test(c) && !hasPlaceholder(c));
}
