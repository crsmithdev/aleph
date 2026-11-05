#!/usr/bin/env bun
/**
 * SessionStart on startup and /clear: when the session's project has a
 * handoff at <handoffs>/projects/<scope>.md, show its summary line to Chris
 * and tell Claude to pick it up on the first prompt. No handoff, no output.
 * Headless (`claude -p`) sessions and factory jobs are skipped.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { handoffsDir } from "../jobs/lib/settings.ts";
import { repoScope } from "../vault/lib/vault.ts";

const input = JSON.parse((await Bun.stdin.text()) || "{}");
if (process.env.ALEPH_JOB_ID || process.env.CLAUDE_CODE_ENTRYPOINT?.startsWith("sdk")) process.exit(0);

const scope = repoScope(input.cwd ?? process.cwd());
const path = join(handoffsDir(), "projects", `${scope}.md`);
if (!existsSync(path)) process.exit(0);

const summary = readFileSync(path, "utf8").match(/^summary:\s*(.+)$/m)?.[1].trim() ?? "no summary line";
const at = statSync(path).mtime;
const today = at.toDateString() === new Date().toDateString();
const hhmm = at.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
const when = today ? hhmm : `${at.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${hhmm}`;

console.log(JSON.stringify({
  systemMessage: `handoff waiting (${scope}, ${when}): ${summary}`,
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: `A handoff for this project waits at ${path}: ${summary}. On the user's first prompt, run the aleph:pickup skill with no argument before anything else, unless that prompt is plainly about other work; then do that work and say in one line that the handoff still waits.`,
  },
}));
