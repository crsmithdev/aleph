#!/usr/bin/env bun
/**
 * SessionStart, synchronous: inject MEMORY.md whole, then the `core:` lines of
 * the session's repo and `global`, newest first, as additionalContext. No
 * vault, no output. Path: $ALEPH_VAULT or ~/.aleph/vault.
 *
 * A factory agent (`ALEPH_AGENT`) gets identity/AGENT.md and identity/VOICE.md
 * and nothing from the vault: factory agents run on their prompts alone (the user,
 * 2026-11-19). It loads no CLAUDE.md, whose import gives the user's sessions VOICE.md.
 *
 * The context is cut at whole core lines to START_BUDGET bytes and then ends
 * with a pointer to the rest (vault/lib/vault.ts startContext).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isVault, loadVault, startContext } from "../vault/lib/vault.ts";
import { scopeOfCwd, vaultDir } from "../lib/paths.ts";
import { isAgent } from "../lib/env.ts";

const input = JSON.parse((await Bun.stdin.text()) || "{}");
const root = vaultDir();
const identity = (f: string) => readFileSync(join(import.meta.dir, "..", "identity", f), "utf8");
if (!isAgent() && !isVault(root)) process.exit(0);
const context = isAgent() ? `${identity("AGENT.md")}\n\n${identity("VOICE.md")}` : startContext(root, await loadVault(root), scopeOfCwd(input.cwd ?? process.cwd())).text;
console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context } }));
