#!/usr/bin/env bun
/**
 * PreToolUse on Bash: a `git commit` is denied while the lines it would
 * commit hold a secret or a debug leftover (hooks/lib/scan.ts). The staged
 * diff is always scanned; `-a`, `-A` or a `git add` in the same command adds
 * the unstaged diff and untracked files. `ALEPH_SKIP_SCAN=1` in the command
 * lets it through.
 */
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { scanDiff, scanFile, type Finding } from "./lib/scan.ts";

const input = JSON.parse(await Bun.stdin.text());
const command: string = input.tool_input?.command ?? "";
if (!/\bgit\b[^|;&]*\bcommit\b/.test(command) || /\bALEPH_SKIP_SCAN=1\b/.test(command)) process.exit(0);

// the repo is where the command runs: a leading cd, a git -C, else the session cwd
const cwd: string = input.cwd ?? process.cwd();
const dir = resolve(cwd, command.match(/\bgit\s+-C\s+(\S+)/)?.[1] ?? command.match(/^\s*cd\s+(\S+)\s*&&/)?.[1]?.replace(/^~(?=\/|$)/, process.env.HOME ?? "~") ?? ".");

function git(...args: string[]): string {
  const proc = Bun.spawnSync(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "ignore" });
  return proc.exitCode === 0 ? proc.stdout.toString() : "";
}

const findings: Finding[] = scanDiff(git("diff", "--cached", "-U0", "--no-color"));
if (/\bgit\b[^|;&]*\bcommit\b[^|;&]*\s-[a-zA-Z]*[aA]|\bgit\s+add\b/.test(command)) {
  findings.push(...scanDiff(git("diff", "-U0", "--no-color")));
  for (const file of git("ls-files", "--others", "--exclude-standard").split("\n").filter(Boolean)) {
    const path = resolve(dir, file);
    try {
      if (statSync(path).size > 1_000_000) continue;
      const text = readFileSync(path, "utf8");
      if (text.includes("\0")) continue;
      findings.push(...scanFile(file, text));
    } catch { /* gone or unreadable */ }
  }
}
if (findings.length === 0) process.exit(0);

const list = findings.slice(0, 20).map((f) => `  ${f.file}:${f.line}  ${f.label}`).join("\n");
console.log(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: `secret-scan: ${findings.length} finding(s) in what this commit would add:\n${list}\nRemove them, or prefix the command with ALEPH_SKIP_SCAN=1 if they are intended.`,
  },
}));
