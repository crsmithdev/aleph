#!/usr/bin/env bun
/**
 * PreToolUse on Edit|Write: no edits on main outside a worktree.
 * Exempt: ~/.claude, ~/.aleph and the home directory itself. The vault is
 * allowed on main except VAULT.md, which is human-owned.
 */
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { vaultDir } from "../vault/lib/vault.ts";

const input = JSON.parse(await Bun.stdin.text());
const filePath: string | undefined = input.tool_input?.file_path;
if (!filePath) process.exit(0);

let dir = dirname(resolve(filePath));
while (!existsSync(dir) && dir !== dirname(dir)) dir = dirname(dir);

function git(...args: string[]): string | null {
  const proc = Bun.spawnSync(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "ignore" });
  return proc.exitCode === 0 ? proc.stdout.toString().trim() : null;
}

const top = git("rev-parse", "--show-toplevel");
if (!top) process.exit(0);
const home = homedir();
if ([home, resolve(home, ".claude"), resolve(home, ".aleph")].includes(top)) process.exit(0);

const vault = existsSync(vaultDir()) ? realpathSync(vaultDir()) : resolve(vaultDir());
if (realpathSync(top) === vault) {
  if (resolve(filePath) !== resolve(vault, "VAULT.md")) process.exit(0);
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "VAULT.md is human-owned. Write the proposed change as a note in wiki/decisions/ and ask." } }));
  process.exit(0);
}

const branch = git("rev-parse", "--abbrev-ref", "HEAD");
if (branch !== "main" && branch !== "master") process.exit(0);
if (resolve(filePath).includes("/.worktrees/")) process.exit(0);

console.log(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: `Refusing to edit ${filePath} on ${branch} in ${top}. Work in a worktree: git -C ${top} worktree add .worktrees/<name> -b feature/<name> ${branch}`,
  },
}));
