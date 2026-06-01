#!/usr/bin/env bun
/**
 * PreToolUse hook: security scan on git commit.
 *
 * Fires when a Bash tool call is a git commit command. Scans the staged diff
 * for common secret patterns and debug leftovers. Advisory only — never blocks.
 *
 * Patterns:
 *   - API keys: sk-[20+ chars]
 *   - Credential assignments: api_key/password/secret = "..."
 *   - Debug logs: console.log( in added lines
 */
import { execSync } from "child_process";
import { trace } from "../../trace.ts";
import { reportHook } from "../../hook-report.ts";

const TAG = "security-scan-bash";

let input: any;
try { input = JSON.parse(await Bun.stdin.text()); }
catch (e) { trace(TAG, `stdin parse failed: ${(e as Error).message}`); process.exit(1); }
reportHook(TAG, "PreToolUse", input.session_id);

const command: string = input.tool_input?.command ?? "";
if (!/^git\s+commit\b/.test(command.trim())) {
  process.exit(0);
}

const cwd = input.cwd || process.cwd();

let diff: string;
try {
  diff = execSync("git diff --cached", { cwd, encoding: "utf8", timeout: 5000 });
} catch (e) {
  trace(TAG, `git diff failed: ${(e as Error).message}`);
  process.exit(0);
}

if (!diff.trim()) {
  trace(TAG, "empty diff, nothing to scan");
  process.exit(0);
}

const PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "API key (sk-...)",    re: /sk-[a-zA-Z0-9]{20,}/g },
  { name: "api_key assignment",  re: /^\+[^+].*api_key\s*=\s*["'][^"']{4,}/gim },
  { name: "password assignment", re: /^\+[^+].*password\s*=\s*["'][^"']{4,}/gim },
  { name: "secret assignment",   re: /^\+[^+].*secret\s*=\s*["'][^"']{4,}/gim },
  { name: "console.log",         re: /^\+[^+].*console\.log\(/gm },
];

const findings: string[] = [];
for (const { name, re } of PATTERNS) {
  const matches = diff.match(re);
  if (matches) findings.push(`${name} (${matches.length}x)`);
}

if (findings.length === 0) {
  trace(TAG, "security scan clean");
  process.exit(0);
}

trace(TAG, `findings: ${findings.join(", ")}`);
console.log(`[Security] ${findings.length} finding(s) in staged diff: ${findings.join(", ")}. Review before committing.`);
process.exit(0);
