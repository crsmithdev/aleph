#!/usr/bin/env bun
/**
 * PreToolUse on Edit|Write: no edits on main outside a worktree.
 * Exempt: ~/.claude, ~/.aleph and the home directory itself. The vault is
 * allowed on main except VAULT.md, which is human-owned. The work store's
 * files are never edited by hand: `aleph issue` writes them.
 */
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { storeDir } from "../todo/lib/store.ts";
import { vaultDir } from "../vault/lib/vault.ts";

const input = JSON.parse(await Bun.stdin.text());
const filePath: string | undefined = input.tool_input?.file_path;
if (!filePath) process.exit(0);

/** The path with every link followed, for a file that may not exist yet. */
function real(p: string): string {
  if (existsSync(p)) return realpathSync(p);
  const parent = dirname(p);
  return parent === p ? p : join(real(parent), basename(p));
}
// Follow links first: ~/.claude/CLAUDE.md is a link into aleph's main checkout.
const target = real(resolve(filePath));
let dir = dirname(target);
while (!existsSync(dir) && dir !== dirname(dir)) dir = dirname(dir);

function git(...args: string[]): string | null {
  const proc = Bun.spawnSync(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "ignore" });
  return proc.exitCode === 0 ? proc.stdout.toString().trim() : null;
}

// A hand edit of the store races every aleph issue commit on its origin/main.
const items = real(storeDir());
if (target.startsWith(items + "/")) {
  const repoKey = target.slice(items.length + 1).split("/")[0];
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: `The work store is written by aleph issue, never by hand. Use: aleph issue add ${repoKey} "<title>" --body -, aleph issue edit ${repoKey} <id> [--title ...] [--body -], aleph issue note|done|drop ${repoKey} <id> "<text>". Put measurements in a findings file and link it in a note.` } }));
  process.exit(0);
}

const top = git("rev-parse", "--show-toplevel");
if (!top) process.exit(0);
const home = homedir();
if ([home, resolve(home, ".claude"), resolve(home, ".aleph")].includes(top)) process.exit(0);

const vault = existsSync(vaultDir()) ? realpathSync(vaultDir()) : resolve(vaultDir());
if (realpathSync(top) === vault) {
  if (target !== resolve(vault, "VAULT.md")) process.exit(0);
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "VAULT.md is human-owned. Write the proposed change as a note in wiki/decisions/ and ask." } }));
  process.exit(0);
}

const branch = git("rev-parse", "--abbrev-ref", "HEAD");
if (branch !== "main" && branch !== "master") process.exit(0);
if (target.includes("/.worktrees/")) process.exit(0);

console.log(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: `Refusing to edit ${filePath} on ${branch} in ${top}. Work in a worktree: git -C ${top} worktree add .worktrees/<name> -b feature/<name> ${branch}`,
  },
}));
