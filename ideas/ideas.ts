/**
 * The ideas: one folder per idea in the items repo, `ideas/<n>/` (the path is its key, `idea.<n>`; `slug` below is
 * that number as text). `idea.md` is frontmatter (`title`, `project`, `status`, `built`), the write-up, then `## Log`. Every write is one commit on origin/main,
 * made by the store without a working tree; the checkout follows. See docs/specs/2026-11-10-ideas.md.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter, serializeFrontmatter, splitFrontmatter, type Frontmatter } from "../lib/frontmatter.ts";
import { clock, today } from "../lib/day.ts";
import { next } from "../lib/db.ts";
import { key, parseKey } from "../lib/naming.ts";
import { itemsDir, writeFiles } from "../lib/store.ts";
import { projectKey } from "../lib/projects.ts";
import { refuse } from "../lib/refusal.ts";
import { git } from "../lib/git.ts";

export interface Idea { slug: string; fm: Frontmatter; writeup: string; log: string[] }

export const ideasDir = (): string => join(itemsDir(), "ideas");

/** The idea number as text, from `3`, `idea.3` or a shown form such as `d3`; a refusal for anything else. */
export const slugOf = (arg: string): string => {
  const n = parseKey(arg);
  return n?.kind === "idea" ? String(n.n) : /^\d+$/.test(arg) ? String(Number(arg)) : refuse(`name an idea by its number: ${arg}`);
};

/** The path of `idea.md`. */
export const file = (slug: string): string => join(ideasDir(), slug, "idea.md");

export function read(slug: string): Idea {
  if (!existsSync(file(slug))) refuse(`no idea named ${slug}`);
  const { frontmatter, body } = splitFrontmatter(readFileSync(file(slug), "utf8"));
  const [writeup, log = ""] = body.split(/^## Log$/m);
  return { slug, fm: parseFrontmatter(frontmatter ?? ""), writeup: writeup.trim(), log: log.split("\n").filter((l) => l.startsWith("- ")) };
}

const render = (i: Idea): string => `${serializeFrontmatter(i.fm)}\n${i.writeup}\n\n## Log\n${i.log.length ? `\n${i.log.join("\n")}\n` : ""}`;

/** Commit the idea and the `extra` files (by name in the idea's folder) as `<verb> idea.<n>` on the items repo's origin/main; a warning when the checkout did not follow, else null. */
function write(i: Idea, verb: string, extra: Record<string, Uint8Array> = {}): string | null {
  const folder = join("ideas", i.slug);
  const follow = writeFiles(`${verb} ${key("idea", Number(i.slug))}`, { [join(folder, "idea.md")]: render(i), ...Object.fromEntries(Object.entries(extra).map(([name, bytes]) => [join(folder, name), bytes])) });
  return follow && `warn: ${follow}`;
}

/** The highest idea number on disk. */
const highest = (): number => (existsSync(ideasDir()) ? readdirSync(ideasDir()).map(Number).filter((n) => Number.isInteger(n)).reduce((m, n) => Math.max(m, n), 0) : 0);

/** Add an idea under the next number of the counter; its slug and the push warning. `target` names the project it is for. */
export function add(title: string, writeup: string, target?: string): { slug: string; warn: string | null } {
  const slug = String(next("idea", highest()));
  const project = target ? projectKey(target) ?? refuse(`no project named ${target}`) : undefined;
  const fm: Frontmatter = { title, ...(project ? { project } : {}), status: "exploring", built: [] };
  return { slug, warn: write({ slug, fm, writeup: writeup.trim(), log: [] }, "add") };
}

/** The local time `YYYY-MM-DD HH:MM`. */
const stamp = (d = new Date()): string => `${today(d)} ${clock(d)}`;

/** The ideas with `status`, each with the local time of its last commit. */
export function list(status = "exploring"): { idea: Idea; last: string }[] {
  const dir = ideasDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((d) => existsSync(file(d))).sort((a, b) => Number(a) - Number(b)).map(read).filter((i) => i.fm.status === status)
    .map((idea) => ({ idea, last: git(itemsDir(), "log", "-1", "--format=%cd", "--date=format-local:%Y-%m-%d %H:%M", "--", join("ideas", idea.slug)).out }));
}

/** Replace the write-up; the push warning. */
export function edit(slug: string, writeup: string): string | null {
  return write({ ...read(slug), writeup: writeup.trim() }, "edit");
}

/** Append `- <YYYY-MM-DD HH:MM> <text>` to the log; the push warning. */
export function note(slug: string, text: string): string | null {
  const i = read(slug);
  return write({ ...i, log: [...i.log, `- ${stamp()} ${text}`] }, "note");
}

/** Set the status built with the issue refs; the push warning. */
export function built(slug: string, refs: string[]): string | null {
  const i = read(slug);
  return write({ ...i, fm: { ...i.fm, status: "built", built: refs } }, "build");
}

/** Set the status dropped; the push warning. */
export function drop(slug: string): string | null {
  const i = read(slug);
  return write({ ...i, fm: { ...i.fm, status: "dropped" } }, "drop");
}
