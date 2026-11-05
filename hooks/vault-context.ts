#!/usr/bin/env bun
/**
 * SessionStart, synchronous: inject MEMORY.md whole, then the `core:` lines of
 * the session's repo and `global`, newest first, as additionalContext. No
 * vault, no output. Path: $ALEPH_VAULT or ~/.aleph/vault.
 *
 * The context is cut at whole core lines to START_BUDGET bytes and then ends
 * with a pointer to the rest (vault/lib/vault.ts startContext).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadVault, repoScope, startContext, vaultDir } from "../vault/lib/vault.ts";

const input = JSON.parse((await Bun.stdin.text()) || "{}");
const root = vaultDir();
if (!existsSync(join(root, "Home.md"))) process.exit(0);
const { text } = startContext(root, await loadVault(root), repoScope(input.cwd ?? process.cwd()));
console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text } }));
