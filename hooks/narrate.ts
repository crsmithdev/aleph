#!/usr/bin/env bun
/**
 * PreToolUse, async: append one spoken phrase per tool call to a per-session
 * file, so the voice bridge can say what is happening during a long turn.
 *
 * Off unless ALEPH_NARRATE is set, because this runs on every tool call and a
 * desktop session with no bridge should pay nothing and leave nothing behind.
 * ALEPH_NARRATE=1 means ~/.aleph/narration; any other value is the directory.
 *
 * The file is also an activity signal: a line means the process is alive, so
 * the bridge's silence detector can watch it alongside the JSON stream.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { narrationFor } from "./lib/narrate.ts";

const setting = process.env.ALEPH_NARRATE;
const text = await Bun.stdin.text();
if (!setting) process.exit(0);

const dir = setting === "1" ? join(homedir(), ".aleph", "narration") : setting;

let input: Record<string, unknown>;
try { input = JSON.parse(text); } catch { process.exit(0); }

const narration = narrationFor(input);
if (!narration) process.exit(0);

// a hook that throws is noise in the transcript; narration is never worth a turn
try {
  mkdirSync(dir, { recursive: true });
  const name = narration.session_id.replace(/[^A-Za-z0-9_.-]/g, "_");
  appendFileSync(join(dir, `${name}.jsonl`), `${JSON.stringify(narration)}\n`);
} catch { /* no narration is better than a failed tool call */ }
