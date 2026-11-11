/**
 * Only the runner (jobs/lib/roles/agent-call.ts) spawns a `claude` process. A source file that gives a claude
 * command to a spawn starts claude by itself, and this test lists it. A claude command is a `modelArgv` call,
 * an argv or a command line that starts with `claude`, or a name that one of these is assigned to, or an exported
 * function that returns one: another file may import the name.
 */
import { expect, test } from "bun:test";
import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const RUNNER = "jobs/lib/roles/agent-call.ts";
const SKIPPED = /^(node_modules|vendor|\.worktrees)\/|\.test\.ts$/;
const CLAUDE = String.raw`(?:modelArgv\(|\[\s*["'\`]claude(?![\w-])|["'\`]claude(?![\w-]))`;
const SPAWN = String.raw`(?<!function\s+)(?:\bspawn|\bspawnSync|\bexecFile|\bexecFileSync|\bexecSync|(?<![.\w])exec)\(\s*(?:\{\s*cmd:\s*)?`;

/** The names in `text` that a claude command is assigned to, or that a function returns it from. */
const claudeNames = (text: string, prefix = ""): string[] => [
  ...text.matchAll(new RegExp(String.raw`${prefix}(?:const|let|var)\s+(\w+)\s*=\s*(?:\([^)]*\)\s*=>\s*)?${CLAUDE}`, "g")),
  ...text.matchAll(new RegExp(String.raw`${prefix}function\s+(\w+)\([^)]*\)[^{]*\{\s*return\s+${CLAUDE}`, "g")),
].map((m) => m[1]);

/** Whether `text` gives a claude command to a spawn, or to a shell through `$`. `wrappers` are the names that other files export for a claude command. */
function spawnsClaude(text: string, wrappers: string[] = []): boolean {
  const names = [...claudeNames(text), ...wrappers];
  const arg = names.length ? String.raw`(?:${CLAUDE}|\[[^\]]*?\.\.\.(?:${names.join("|")})\b|(?:${names.join("|")})\b)` : CLAUDE;
  return new RegExp(SPAWN + arg).test(text) || /\$`\s*claude(?![\w-])/.test(text);
}

test("no source file outside the runner spawns claude", () => {
  const files = [...new Glob("**/*.{ts,js,mjs}").scanSync(ROOT)].filter((f) => f !== RUNNER && !SKIPPED.test(f));
  const text = new Map(files.map((f) => [f, readFileSync(join(ROOT, f), "utf8")]));
  const wrappers = [...text.values()].flatMap((t) => claudeNames(t, String.raw`\bexport\s+(?:async\s+)?`));
  const found = files.filter((f) => spawnsClaude(text.get(f)!, wrappers)).sort();
  expect(found).toEqual([]);
});
