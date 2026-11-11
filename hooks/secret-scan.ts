#!/usr/bin/env bun
/**
 * PreToolUse on Bash: a `git commit` is denied while the lines it would
 * commit hold a secret or a debug leftover (hooks/lib/scan.ts). The staged
 * diff is always scanned; `-a`, `-A` or a `git add` in the same command adds
 * the unstaged diff and untracked files. `ALEPH_SKIP_SCAN=1` in the command
 * lets it through.
 */
/*
 * A hook that exits 1 does not block the tool, so a guard that cannot load, or
 * throws before its verdict, exits 2 (deny) with its name and the error on stderr.
 * Its non-builtin imports are dynamic for that reason.
 */
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { Finding } from "./lib/scan.ts";

try {
  const { scanDiff, scanFile } = await import("./lib/scan.ts");
  const { probe } = await import("../lib/git.ts");

  const input = JSON.parse(await Bun.stdin.text());
  const command: string = input.tool_input?.command ?? "";
  if (!/\bgit\b[^|;&]*\bcommit\b/.test(command) || /\bALEPH_SKIP_SCAN=1\b/.test(command)) process.exit(0);

  const deny = (reason: string) => console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }));

  /** One shell word as a path: its quotes gone and `~` expanded. A word with a variable or a substitution has no known value: null. */
  function pathWord(word: string): string | null {
    const unquoted = word.replace(/^(["'])(.*)\1$/, "$2");
    if (word[0] !== "'" && /[$`]/.test(unquoted)) return null;
    return unquoted.replace(/^~(?=\/|$)/, process.env.HOME ?? "~");
  }

  // The repo is where the commit runs: every cd before it, then its git -C, from the session cwd.
  const WORD = `"[^"]*"|'[^']*'|[^\\s;&|()]+`;
  const cwd: string = input.cwd ?? process.cwd();
  const commitAt = command.search(/\bgit\b[^|;&]*\bcommit\b/);
  const words = [...command.slice(0, commitAt).matchAll(new RegExp(`(?:^|[;&|(])\\s*cd\\s+(${WORD})`, "g"))].map((m) => m[1]);
  const dashC = command.slice(commitAt).match(new RegExp(`^git\\s+-C\\s+(${WORD})`))?.[1];
  if (dashC) words.push(dashC);
  const paths = words.map(pathWord);
  const named = paths.length > 0;
  const dir = paths.includes(null) ? null : resolve(cwd, ...(paths as string[]));

  // A command that names a directory the hook cannot read could commit anything there. With no directory named, a cwd outside a repo has nothing to commit.
  const inRepo = dir !== null && probe(dir, "rev-parse", "--git-dir").ok;
  if (!inRepo) {
    if (named) deny(`secret-scan: cannot find the repo this commit runs in (${words.join(", ")}), so it cannot be scanned. Use a literal path, or prefix the command with ALEPH_SKIP_SCAN=1.`);
    process.exit(0);
  }

  function git(...args: string[]): string {
    const r = probe(dir!, ...args);
    return r.ok ? r.out : "";
  }

  const findings: Finding[] = scanDiff(git("diff", "--cached", "-U0", "--no-color"));
  if (/\bgit\b[^|;&]*\bcommit\b[^|;&]*\s-[a-zA-Z]*[aA]|\bgit\s+add\b/.test(command)) {
    findings.push(...scanDiff(git("diff", "-U0", "--no-color")));
    for (const file of git("ls-files", "--others", "--exclude-standard").split("\n").filter(Boolean)) {
      const path = resolve(dir!, file);
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
  deny(`secret-scan: ${findings.length} finding(s) in what this commit would add:\n${list}\nRemove them, or prefix the command with ALEPH_SKIP_SCAN=1 if they are intended.`);
} catch (e) {
  console.error(`secret-scan: the guard failed (${e instanceof Error ? (e.stack ?? e.message) : String(e)}), so this tool call is denied. Fix the hook and retry.`);
  process.exit(2);
}
