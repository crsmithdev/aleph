#!/usr/bin/env bun
/**
 * Stop hook: dirty working tree check.
 *
 * When a session ends with uncommitted changes, prints a loud reminder.
 * Does not block — just warns. The real enforcement is the instruction
 * in CLAUDE.md: "Never declare work done with uncommitted changes."
 */
import { execSync } from "child_process";
import { trace } from "../../trace.ts";

const TAG = "dirty-tree-check";

let input: any;
try { input = JSON.parse(await Bun.stdin.text()); }
catch (e) { trace(TAG, `stdin parse failed: ${(e as Error).message}`); process.exit(0); }

// Only check in git repos
const cwd = input.cwd;
if (!cwd) { trace(TAG, "skip: no cwd"); process.exit(0); }

try {
  // Check for staged + unstaged + untracked changes
  const status = execSync("git status --porcelain", { cwd, encoding: "utf8", timeout: 5000 }).trim();
  if (!status) {
    trace(TAG, "pass: clean working tree");
    process.exit(0);
  }

  const lines = status.split("\n").filter(Boolean);
  const staged = lines.filter((l) => /^[MADRC]/.test(l)).length;
  const modified = lines.filter((l) => /^.[MD]/.test(l)).length;
  const untracked = lines.filter((l) => l.startsWith("??")).length;

  const parts: string[] = [];
  if (staged) parts.push(`${staged} staged`);
  if (modified) parts.push(`${modified} modified`);
  if (untracked) parts.push(`${untracked} untracked`);

  trace(TAG, `WARN: dirty tree — ${parts.join(", ")}`);

  console.log(`[Construct] Dirty working tree: ${parts.join(", ")} (${lines.length} files).
Commit your changes before ending the session. Rule: never declare work done with uncommitted changes.`);
} catch (e) {
  trace(TAG, `git status failed: ${(e as Error).message}`);
  process.exit(0);
}
