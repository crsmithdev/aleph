#!/usr/bin/env bun
/**
 * The context load of a repo: what Claude Code puts in the window at every turn, and what it loads on demand.
 * agnix checks each file against its spec; this counts what the files cost together.
 *
 *   always   memory files (CLAUDE.md up the tree, ~/.claude/CLAUDE.md, their @imports) and the description of
 *            every skill, agent and command the model can invoke
 *   lazy     a nested CLAUDE.md, a skill body, a file a skill links to
 *   hooks    the events whose output enters the context; their size shows only in a run
 *
 *   bun load.ts [root] [--home <dir>]   JSON, largest first
 *
 * Tokens are chars / 4, close enough to rank and to watch a total move.
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

export type Item = { file: string; kind: string; tokens: number; note?: string };
export type Skill = { file: string; name: string; description: number; lines: number; invoked: "model" | "user" };
export type Load = { total: number; always: Item[]; lazy: Item[]; skills: Skill[]; hooks: string[] };

const SKIP = /(^|\/)(node_modules|\.git|\.worktrees|dist|build)\//;
/** The hook events whose stdout or additionalContext reaches the model. */
const INJECT = ["SessionStart", "UserPromptSubmit", "PostToolUse", "PreCompact", "SubagentStart"];

const tokens = (s: string) => Math.ceil(s.length / 4);
/** Files under root that match any pattern. Bun.Glob does not match a dot directory inside braces, so each base is its own pattern. */
const glob = (root: string, ...patterns: string[]) => [...new Set(patterns.flatMap((p) => [...new Bun.Glob(p).scanSync({ cwd: root, dot: true })]))].filter((f) => !SKIP.test(f)).sort();

/** The frontmatter of a markdown file, or {} when it has none. */
export function front(text: string): Record<string, unknown> {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  return m ? (Bun.YAML.parse(m[1]) as Record<string, unknown>) ?? {} : {};
}

/** A memory file and every file its @imports reach, depth first, each once. */
function memory(file: string, seen: Set<string>, depth = 0): string[] {
  if (!existsSync(file) || depth > 5 || seen.has(realpathSync(file))) return [];
  seen.add(realpathSync(file));
  const text = readFileSync(file, "utf8").replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");
  const refs = [...text.matchAll(/(?:^|\s)@((?:~|\.{0,2})\/?[\w./-]+)/g)].map((m) => m[1].replace(/^~/, homedir()));
  return [file, ...refs.flatMap((r) => memory(resolve(dirname(file), r), seen, depth + 1))];
}

/** CLAUDE.md and CLAUDE.local.md from root up to /, and the user's own. */
function chain(root: string, home: string): string[] {
  const dirs: string[] = [];
  for (let d = resolve(root); ; d = dirname(d)) {
    dirs.push(d);
    if (d === dirname(d)) break;
  }
  const seen = new Set<string>();
  return [join(home, ".claude/CLAUDE.md"), ...dirs.reverse().flatMap((d) => [join(d, "CLAUDE.md"), join(d, "CLAUDE.local.md")])].flatMap((f) => memory(f, seen));
}

export function load(root: string, home = homedir()): Load {
  const at = (f: string) => (f.startsWith(root) ? relative(root, f) : f.replace(home, "~"));
  const always: Item[] = chain(root, home).map((f) => ({ file: at(f), kind: "memory", tokens: tokens(readFileSync(f, "utf8")) }));
  const skills: Skill[] = glob(root, "skills/*/SKILL.md", ".claude/skills/*/SKILL.md").map((f) => {
    const text = readFileSync(join(root, f), "utf8");
    const fm = front(text);
    const user = fm["disable-model-invocation"] === true;
    return { file: f, name: String(fm.name ?? ""), description: String(fm.description ?? "").length, lines: text.split("\n").length, invoked: user ? "user" : "model" };
  });
  const described = glob(root, "agents/**/*.md", "commands/**/*.md", ".claude/agents/**/*.md", ".claude/commands/**/*.md").map((f) => ({ f, fm: front(readFileSync(join(root, f), "utf8")) }));
  always.push(
    ...skills.filter((s) => s.invoked === "model").map((s) => ({ file: s.file, kind: "skill description", tokens: Math.ceil(s.description / 4) })),
    ...described.filter((d) => d.fm.description && d.fm["disable-model-invocation"] !== true).map((d) => ({ file: d.f, kind: `${d.f.includes("agents/") ? "agent" : "command"} description`, tokens: tokens(String(d.fm.description)) })),
  );
  const top = new Set(chain(root, home).map((f) => realpathSync(f)));
  const lazy: Item[] = [
    ...glob(root, "**/CLAUDE.md").filter((f) => !top.has(realpathSync(join(root, f)))).map((f) => ({ file: f, kind: "nested memory", tokens: tokens(readFileSync(join(root, f), "utf8")) })),
    ...skills.map((s) => ({ file: s.file, kind: "skill body", tokens: tokens(readFileSync(join(root, s.file), "utf8")) })),
    ...glob(root, "skills/*/**/*.md", ".claude/skills/*/**/*.md").filter((f) => !f.endsWith("/SKILL.md")).map((f) => ({ file: f, kind: "skill reference", tokens: tokens(readFileSync(join(root, f), "utf8")) })),
  ];
  const config = ["hooks/hooks.json", ".claude/settings.json", ".claude/settings.local.json"].map((f) => join(root, f)).filter(existsSync);
  const hooks = config.flatMap((f) => Object.keys((JSON.parse(readFileSync(f, "utf8")).hooks ?? {}) as object).filter((e) => INJECT.includes(e)).map((e) => `${at(f)}: ${e}`));
  const big = (a: Item, b: Item) => b.tokens - a.tokens;
  return { total: always.reduce((n, i) => n + i.tokens, 0), always: always.sort(big), lazy: lazy.sort(big), skills, hooks };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const i = args.indexOf("--home");
  const home = i >= 0 ? args[i + 1] : homedir();
  const root = args.find((a, j) => !a.startsWith("--") && args[j - 1] !== "--home") ?? process.cwd();
  console.log(JSON.stringify(load(resolve(root), home), null, 2));
}
