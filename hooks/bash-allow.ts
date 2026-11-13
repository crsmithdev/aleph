#!/usr/bin/env bun
/**
 * PreToolUse on Bash: when `ALEPH_BASH_ALLOW` holds a JSON array of command prefixes, a Bash command that is not
 * one of them, or one of them followed by arguments, is denied. A read-only factory role sets it from the
 * `Bash(...)` entries of its --allowedTools, because a user setting that allows plain Bash lets every other
 * command through. A command that chains, pipes, redirects or substitutes is denied too: its parts are not
 * the prefix. Without the variable it lets every command through.
 */
/*
 * A hook that exits 1 does not block the tool, so a guard that throws before its verdict exits 2 (deny)
 * with its name and the error on stderr.
 */
export {};

try {
  const allow: string[] | undefined = process.env.ALEPH_BASH_ALLOW ? JSON.parse(process.env.ALEPH_BASH_ALLOW) : undefined;
  if (!allow) process.exit(0);
  const command: string = (JSON.parse(await Bun.stdin.text()).tool_input?.command ?? "").trim();
  // The quoted words hold no operator; a double-quoted word may still substitute.
  const bare = command.replace(/'[^']*'/g, "''").replace(/"(?:[^"$`\\]|\\.)*"/g, '""');
  const plain = !/[;&|<>`$\n]/.test(bare);
  if (plain && allow.some((p) => command === p || command.startsWith(`${p} `))) process.exit(0);
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: `This run may run only: ${allow.join(", ")}` } }));
} catch (e) {
  console.error(`bash-allow.ts: ${e instanceof Error ? e.message : e}`);
  process.exit(2);
}
