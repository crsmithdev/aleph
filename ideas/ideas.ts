/**
 * The ideas store: one folder per idea in its own git repo, `$ALEPH_IDEAS` or ~/.aleph/ideas.
 * `<slug>/idea.md` is frontmatter, the write-up, then `## Log`; `<slug>/lenses/<lens>-<YYYY-MM-DD-HHMM>.html|md`
 * are the lens results. Every write is one commit, pushed when the store has an origin. See docs/specs/2026-11-10-ideas.md.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { parseFrontmatter, serializeFrontmatter, splitFrontmatter, type Frontmatter } from "../lib/frontmatter.ts";
import { today } from "../lib/day.ts";
import { alephPath } from "../lib/paths.ts";
import { refuse } from "../lib/refusal.ts";
import { commitPaths, git, pushOrigin } from "../vault/lib/git.ts";
import { openRun } from "../jobs/lib/roles/agent-run.ts";
import { skillSection } from "../jobs/lib/roles/role-skill.ts";
import { runFile } from "../jobs/lib/records/run-files.ts";
import { OPUS_MODEL } from "../jobs/lib/routing/models.ts";

/** The lenses: each is the skill of the same name. */
export const LENSES = ["prior-art", "red-team", "explainer"];

/** Read-only tools, the web, and Write, which acceptEdits allows only in the run folder, its working directory. */
const LENS_FLAGS = ["--tools", "Read,Grep,Glob,WebSearch,WebFetch,Write", "--allowedTools", "Read,Grep,Glob,WebSearch,WebFetch", "--permission-mode", "acceptEdits"];

export interface Idea { slug: string; fm: Frontmatter; writeup: string; log: string[] }

export const ideasDir = (): string => alephPath("ALEPH_IDEAS", "ideas");

export const slugOf = (title: string): string => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** The path of `idea.md`. */
export const file = (slug: string): string => join(ideasDir(), slug, "idea.md");

export function read(slug: string): Idea {
  if (!existsSync(file(slug))) refuse(`no idea named ${slug}`);
  const { frontmatter, body } = splitFrontmatter(readFileSync(file(slug), "utf8"));
  const [writeup, log = ""] = body.split(/^## Log$/m);
  return { slug, fm: parseFrontmatter(frontmatter ?? ""), writeup: writeup.trim(), log: log.split("\n").filter((l) => l.startsWith("- ")) };
}

const render = (i: Idea): string => `${serializeFrontmatter(i.fm)}\n${i.writeup}\n\n## Log\n${i.log.length ? `\n${i.log.join("\n")}\n` : ""}`;

/** Write the idea and the extra paths, commit them as `<verb> <slug>`, and push; a warning when the push failed, else null. */
function write(i: Idea, verb: string, extra: string[] = []): string | null {
  const dir = ideasDir();
  if (!existsSync(dir)) { mkdirSync(dir, { recursive: true }); git(dir, "init", "-q"); }
  mkdirSync(join(dir, i.slug), { recursive: true });
  writeFileSync(file(i.slug), render(i));
  commitPaths(dir, `${verb} ${i.slug}`, [file(i.slug), ...extra]);
  const p = pushOrigin(dir);
  return p.pushed || p.detail === "no origin" ? null : `warn: push of ${verb} ${i.slug} failed: ${p.detail}; the commit stands`;
}

/** Add an idea; its slug and the push warning. */
export function add(title: string, writeup: string, target?: string): { slug: string; warn: string | null } {
  const slug = slugOf(title);
  if (existsSync(file(slug))) refuse(`an idea named ${slug} exists: ${read(slug).fm.title}`);
  const fm: Frontmatter = { title, ...(target ? { target } : {}), status: "exploring", built: [] };
  return { slug, warn: write({ slug, fm, writeup: writeup.trim(), log: [] }, "add") };
}

/** The local time `YYYY-MM-DD HH:MM`. */
const stamp = (d = new Date()): string => `${today(d)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

/** The idea's lens results, oldest first. */
export function lenses(slug: string): { lens: string; at: string; file: string }[] {
  const dir = join(ideasDir(), slug, "lenses");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).sort().flatMap((f) => {
    const m = /^(.+)-(\d{4}-\d\d-\d\d)-(\d\d)(\d\d)\.(html|md)$/.exec(f);
    return m ? [{ lens: m[1], at: `${m[2]} ${m[3]}:${m[4]}`, file: `lenses/${f}` }] : [];
  });
}

/** The ideas with `status`, each with its lens names and the date of its last commit. */
export function list(status = "exploring"): { idea: Idea; lenses: string[]; last: string }[] {
  const dir = ideasDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((d) => existsSync(file(d))).sort().map(read).filter((i) => i.fm.status === status)
    .map((idea) => ({ idea, lenses: [...new Set(lenses(idea.slug).map((l) => l.lens))], last: git(dir, "log", "-1", "--format=%cd", "--date=short", "--", idea.slug).out }));
}

/** Copy `from`, an .html or .md result, to `lenses/<lens>-<YYYY-MM-DD-HHMM>.<ext>` and log it; its path in the idea and the push warning. */
export function save(slug: string, lens: string, from: string): { file: string; warn: string | null } {
  const i = read(slug);
  const ext = extname(from).slice(1);
  if (ext !== "html" && ext !== "md") refuse(`a lens result is .html or .md, not ${from}`);
  const now = new Date();
  const rel = `lenses/${lens}-${stamp(now).replace(" ", "-").replace(":", "")}.${ext}`;
  mkdirSync(join(ideasDir(), slug, "lenses"), { recursive: true });
  copyFileSync(from, join(ideasDir(), slug, rel));
  return { file: rel, warn: write({ ...i, log: [...i.log, `- ${stamp(now)} ${lens} saved: ${rel}`] }, "save", [join(ideasDir(), slug, rel)]) };
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

/** Run `lens` on the idea as a `lens` run with no worktree, and save the result.html or result.md it writes; refuses when it wrote none. */
export async function lens(slug: string, name: string): Promise<{ file: string; warn: string | null }> {
  if (!LENSES.includes(name)) refuse(`no lens named ${name}: use ${LENSES.join(", ")}`);
  read(slug);
  const run = openRun({ role: "lens", who: `the ${name} lens`, model: OPUS_MODEL, seconds: 3600, flags: LENS_FLAGS, name: `${slug}-${name}`, command: `idea lens ${slug} ${name}`, shown: true });
  const prompt = `${skillSection(name, `The ${name} skill`)}\n\nThe skill's folder is ${join(import.meta.dir, "..", "skills", name)}.\n\n## The idea\n\nApply the skill to the idea in ${file(slug)}. Write your result to result.html or result.md in your working directory, ${run.folder}.`;
  const error = await run.ask(prompt, run.folder).then(() => undefined, (e: Error) => e.message);
  const out = [runFile(run.folder, "result.html"), runFile(run.folder, "result.md")].find((f) => existsSync(f));
  if (!out) {
    run.end(`failed: ${error ?? "the run wrote no result file"}`, { cause: "unanswered" });
    refuse(`the ${name} lens on ${slug} wrote no result: ${run.folder}`);
  }
  const s = save(slug, name, out);
  run.end(`saved ${s.file}`);
  return s;
}
