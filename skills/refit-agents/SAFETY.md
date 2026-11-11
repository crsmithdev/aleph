# Safety lens

Can an agent file leak a secret, grant too much, or run code nobody reviewed? Agent files run with the user's
rights: a hook is a shell command, an MCP server is a process, a skill can run its scripts.

## Signals

- **Secrets** in any agent file, hook script or `.mcp.json`: keys, tokens, URLs with credentials. Grep, and run the
  repo's secret scan over them.
- **Broad grants.** `allowed-tools: Bash(*)` or a settings `allow` of a whole tool. `allowed-tools` pre-approves; it
  restricts nothing.
- **MCP servers.** An unpinned `npx`/`uvx` package (`@latest`, no version), a remote URL over plain HTTP, a server
  nobody named.
- **Hooks that fail open.** A guard hook whose crash lets the tool call through: it needs a wrapper that blocks
  when the guard does not run, or an exit code of 2.
- **Untrusted text as instructions.** A hook or skill that pastes fetched, issue or user text into context
  without marking it as data.
- **Scanners.** agnix `MCP-` and `CC-HK-` rules; Cisco `skill-scanner` and Snyk `agent-scan` for injection and
  exfiltration in skills. Snyk `agent-scan` starts the stdio MCP servers it scans: read each server's command first.

## Proof

Quote the line and name what an agent or an attacker gets from it. A scanner hit needs the same.

## Fix

Move secrets to the environment and rotate them. Narrow the grant to the commands the skill runs. Pin the
package version. Wrap a guard so it blocks when it fails. Fence untrusted text and say it is data.

## Hold

A secret scan on agent files in the pre-commit hook; agnix `MCP-` and hook rules in CI.

## Check

What does the new hook, server, grant or script run, with whose rights, and on what input?
