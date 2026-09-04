#!/usr/bin/env bun
/**
 * SessionStart, synchronous: inject Home.md then MEMORY.md from the vault as
 * additionalContext. No vault, no output. Path: $ALEPH_VAULT or ~/.aleph/vault.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { vaultDir } from "../vault/lib/vault.ts";

await Bun.stdin.text();
const root = vaultDir();
const home = join(root, "Home.md");
if (!existsSync(home)) process.exit(0);
const memory = join(root, "MEMORY.md");
const parts = [`<vault path="${root}">`, readFileSync(home, "utf8").trim()];
if (existsSync(memory)) parts.push("", readFileSync(memory, "utf8").trim());
parts.push("</vault>");
console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: parts.join("\n") } }));
