#!/usr/bin/env bun
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { trace } from "../../trace.ts";
import { reportHook } from "../../hook-report.ts";
import { dataPaths } from "../../paths.ts";

const TAG = "dispatch-stop-remind";

let input: any;
try { input = JSON.parse(await Bun.stdin.text()); }
catch (e) { trace(TAG, `stdin parse failed: ${(e as Error).message}`); process.exit(0); }
reportHook(TAG, "Stop", input.session_id);

const counterPath = `${dataPaths.signals}/dispatch-stop-remind-count`;

mkdirSync(dataPaths.signals, { recursive: true });
trace(TAG, `signals dir ensured: ${dataPaths.signals}`);

let count = 1;
if (existsSync(counterPath)) {
  try {
    const raw = readFileSync(counterPath, "utf8").trim();
    const parsed = parseInt(raw, 10);
    if (!isNaN(parsed)) count = parsed + 1;
    trace(TAG, `read counter: ${parsed} → incrementing to ${count}`);
  } catch (e) {
    trace(TAG, `counter read failed: ${(e as Error).message}, defaulting to 1`);
    count = 1;
  }
} else {
  trace(TAG, "counter file not found, starting at 1");
}

writeFileSync(counterPath, String(count));
trace(TAG, `wrote counter: ${count}`);

if (count % 5 === 0) {
  trace(TAG, `count ${count} is multiple of 5, emitting reminder`);
  console.log("[Construct] Reminder: main session is orchestrator. Use Agent with isolation: \"worktree\" for all implementation. Use /inline to override.");
} else {
  trace(TAG, `count ${count}, no reminder needed`);
}

process.exit(0);
