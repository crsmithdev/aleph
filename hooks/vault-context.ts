#!/usr/bin/env bun
/**
 * SessionStart, synchronous: inject MEMORY.md whole, then the Home.md lines of
 * the session's repo and `global`, as additionalContext. No vault, no output.
 * Path: $ALEPH_VAULT or ~/.aleph/vault.
 *
 * Claude Code shows a 2 KB preview in place of hook output over about 10,000
 * characters, so the context is cut at whole Home lines to BUDGET bytes and
 * ends with a pointer to the rest.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FOLDERS, HOME_KINDS, repoScope, vaultDir, type Kind } from "../vault/lib/vault.ts";

const BUDGET = 6000;

const input = JSON.parse((await Bun.stdin.text()) || "{}");
const root = vaultDir();
const home = join(root, "Home.md");
if (!existsSync(home)) process.exit(0);

const scope = repoScope(input.cwd ?? process.cwd());

function noteScope(title: string): string | undefined {
  for (const kind of HOME_KINDS) {
    const path = join(root, "wiki", FOLDERS[kind as Kind], `${title}.md`);
    if (existsSync(path)) return /^scope:\s*(.+)$/m.exec(readFileSync(path, "utf8"))?.[1].trim();
  }
}

const lines = readFileSync(home, "utf8").trim().split("\n").filter((line) => {
  const link = /^- \[\[([^\]|#]+)/.exec(line);
  if (!link) return true;
  const s = noteScope(link[1]);
  return s === scope || s === "global";
});

const memory = join(root, "MEMORY.md");
const head = [`<vault path="${root}">`, ...(existsSync(memory) ? [readFileSync(memory, "utf8").trim(), ""] : [])];
const links = (ls: string[]) => ls.filter((l) => l.startsWith("- [[")).length;
const render = (kept: string[]) => {
  const cut = links(lines) - links(kept);
  return [...head, ...kept, ...(cut ? [`${cut} more Home lines: vault recall --scope ${scope}`] : []), "</vault>"].join("\n");
};
let kept = lines;
while (Buffer.byteLength(render(kept)) > BUDGET) kept = kept.slice(0, -1);
console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: render(kept) } }));
