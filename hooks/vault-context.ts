#!/usr/bin/env bun
/**
 * SessionStart, synchronous: inject MEMORY.md whole (identity/AGENT.md in its
 * place for a factory agent, `ALEPH_AGENT`), then the `core:` lines of
 * the session's repo and `global`, newest first, as additionalContext. A
 * factory agent also gets identity/VOICE.md after the vault block: it loads no
 * CLAUDE.md, whose import gives Chris's sessions the same file. No vault, no
 * output. Path: $ALEPH_VAULT or ~/.aleph/vault.
 *
 * The context is cut at whole core lines to START_BUDGET bytes and then ends
 * with a pointer to the rest (vault/lib/vault.ts startContext).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadVault, repoScope, startContext, vaultDir } from "../vault/lib/vault.ts";

const input = JSON.parse((await Bun.stdin.text()) || "{}");
const root = vaultDir();
if (!existsSync(join(root, "Home.md"))) process.exit(0);
const identity = (f: string) => readFileSync(join(import.meta.dir, "..", "identity", f), "utf8");
const agent = Boolean(process.env.ALEPH_AGENT);
const { text } = startContext(root, await loadVault(root), repoScope(input.cwd ?? process.cwd()), agent ? identity("AGENT.md") : undefined);
const context = agent ? `${text}\n\n${identity("VOICE.md")}` : text;
console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context } }));
