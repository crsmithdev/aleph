#!/usr/bin/env bun
/**
 * PreToolUse hook: strategic compact suggestion.
 *
 * Fires on Edit/Write. Tracks tool call count for the session and suggests
 * /compact at logical phase boundaries. Never blocks.
 *
 * Threshold: COMPACT_THRESHOLD env var (default 50). Reminds every 25 after.
 * State: /tmp/construct-compact-{sessionId} (counter, reset each session)
 */
import { readFileSync, writeFileSync } from "fs";
import { trace } from "../../trace.ts";
import { reportHook } from "../../hook-report.ts";

const TAG = "context-suggest-edit";
const THRESHOLD = parseInt(process.env.COMPACT_THRESHOLD || "50", 10);
const REMIND_EVERY = 25;

let input: any;
try { input = JSON.parse(await Bun.stdin.text()); }
catch (e) { trace(TAG, `stdin parse failed: ${(e as Error).message}`); process.exit(0); }
reportHook(TAG, "PreToolUse", input.session_id);

const sessionId = input.session_id;
if (!sessionId) { process.exit(0); }

const stateFile = `/tmp/construct-compact-${sessionId}`;

let count = 0;
try { count = parseInt(readFileSync(stateFile, "utf8"), 10) || 0; } catch {}
count++;
try { writeFileSync(stateFile, String(count)); } catch {}

trace(TAG, `tool calls this session: ${count}`);

const atThreshold = count === THRESHOLD;
const isReminder = count > THRESHOLD && (count - THRESHOLD) % REMIND_EVERY === 0;

if (!atThreshold && !isReminder) process.exit(0);

console.log(`[Compact] Tool calls: ${count} — Consider /compact at a phase boundary
  Compact NOW if: between phases (research→plan, plan→implement, debug→next feature), after a failed approach
  Don't compact: mid-implementation (loses variable names, file paths, partial state)
  Survives: CLAUDE.md, TodoWrite, memory files, git state
  Lost: intermediate reasoning, earlier file reads, conversation nuance`);

process.exit(0);
