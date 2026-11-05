#!/usr/bin/env bun
/**
 * SessionStart on startup and /clear: when the session's project has a
 * handoff at <handoffs>/projects/<scope>.md, show its summary line to Chris
 * and tell Claude to pick it up on the first prompt. The full handoff text and
 * the session directory's `git status` and `git log -5` go in the context when
 * it stays within 10,000 characters. No handoff, no output.
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

const text = readFileSync(path, "utf8");
const summary = text.match(/^summary:\s*(.+)$/m)?.[1].trim() ?? "no summary line";
const at = statSync(path).mtime;
const today = at.toDateString() === new Date().toDateString();
const hhmm = at.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
const when = today ? hhmm : `${at.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${hhmm}`;

const short = `A handoff for this project waits at ${path}: ${summary}. On the user's first prompt, run the aleph:pickup skill with no argument before anything else, unless that prompt is plainly about other work; then do that work and say in one line that the handoff still waits.`;
const git = (...args: string[]) => Bun.spawnSync(["git", ...args], { cwd: input.cwd ?? process.cwd(), stdout: "pipe", stderr: "pipe" });
const status = git("status");
const gitPart = status.exitCode === 0 ? `\n\ngit status:\n${status.stdout.toString().trim()}\n\ngit log -5:\n${git("log", "-5").stdout.toString().trim()}` : "";
const full = `${short}\n\nThe handoff text follows. The pickup skill needs no Read of the file.\n\n${text.trim()}${gitPart}`;
const additionalContext = full.length > 10000 ? short : full;

console.log(JSON.stringify({
  systemMessage: `handoff waiting (${scope}, ${when}): ${summary}`,
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext,
  },
}));
