/**
 * Only the runner (jobs/lib/roles/agent-call.ts) spawns a `claude` process. A source file that gives a claude
 * command to a spawn starts claude by itself, and this test lists it. A claude command is a `modelArgv` call,
 * an argv or a command line that starts with `claude`, or a name that one of these is assigned to.
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

/** Whether `text` gives a claude command to a spawn, or to a shell through `$`. */
function spawnsClaude(text: string): boolean {
  const names = [...text.matchAll(new RegExp(String.raw`\b(?:const|let|var)\s+(\w+)\s*=\s*${CLAUDE}`, "g"))].map((m) => m[1]);
  const arg = names.length ? String.raw`(?:${CLAUDE}|\[[^\]]*?\.\.\.(?:${names.join("|")})\b|(?:${names.join("|")})\b)` : CLAUDE;
  return new RegExp(SPAWN + arg).test(text) || /\$`\s*claude(?![\w-])/.test(text);
}

test("no source file outside the runner spawns claude", () => {
  const found = [...new Glob("**/*.{ts,js,mjs}").scanSync(ROOT)]
    .filter((f) => f !== RUNNER && !SKIPPED.test(f) && spawnsClaude(readFileSync(join(ROOT, f), "utf8")))
    .sort();
  expect(found).toEqual([]);
});
