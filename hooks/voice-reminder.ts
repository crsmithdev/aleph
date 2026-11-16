#!/usr/bin/env bun
/**
 * UserPromptSubmit, synchronous: inject identity/voice-reminder.md as
 * additionalContext on every prompt, so the VOICE.md rules survive compaction.
 * Silent for a factory agent (`ALEPH_AGENT`), which gets the full VOICE.md at start.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isAgent } from "../lib/env.ts";

if (!isAgent()) {
  const additionalContext = readFileSync(join(import.meta.dir, "..", "identity", "voice-reminder.md"), "utf8").trim();
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext } }));
}
