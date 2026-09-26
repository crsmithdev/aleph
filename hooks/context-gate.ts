#!/usr/bin/env bun
/**
 * The context gate. docs/context-gate.md is the contract.
 *
 *   Stop  fill below the warn fraction     → pass silently
 *         above it                         → pass, warn Chris
 *         session has compacted            → block once, ask for a handoff
 */
import { peek, put } from "./lib/handshake.ts";
import { assess, read, threshold } from "./lib/context.ts";

const input = JSON.parse(await Bun.stdin.text());
if (input.hook_event_name !== "Stop") process.exit(0);

const sessionId: string | undefined = input.session_id;
const transcript: string = input.transcript_path ?? "";
if (!sessionId || !transcript) process.exit(0);

const key = `ctx:${sessionId}`;
const verdict = assess(read(transcript), threshold(), peek(key) !== null, input.stop_hook_active === true);

if (verdict.kind === "warn") console.log(JSON.stringify({ systemMessage: verdict.message }));
if (verdict.kind === "gate") {
  put(key, { start: Date.now() });
  console.log(JSON.stringify({ decision: "block", reason: `Context gate: ${verdict.reason}` }));
}
