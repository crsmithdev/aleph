#!/usr/bin/env bun
/**
 * Dispatch gate eval.
 *
 * Launches Claude via the Agent SDK with a PreToolUse hook that blocks
 * direct Edit/Write in the main session (simulating the dispatch gate).
 * Verifies that Claude adapts by dispatching work to a subagent, and
 * that correct telemetry is written.
 *
 * Usage:
 *   bun src/eval/dispatch-e2e.test.ts
 *   bun src/eval/dispatch-e2e.test.ts --model claude-sonnet-4-6
 *   bun src/eval/dispatch-e2e.test.ts --scenario broken-math
 */
import type { PreToolUseHookInput, HookCallback } from "@anthropic-ai/claude-agent-sdk";
import { join } from "path";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import {
  runEval, emptyResult, createResults, check, printAndExit, formatResult,
  writeHookEvent, readHookEvents,
  type EvalResult, type HookEvent,
} from "./harness.ts";

const args = process.argv.slice(2);
const model = args.includes("--model") ? args[args.indexOf("--model") + 1] : undefined;
const scenario = args.includes("--scenario") ? args[args.indexOf("--scenario") + 1] : "broken-math";

const r = createResults();
const telemetryDir = mkdtempSync(join(tmpdir(), "eval-telemetry-"));

console.log(`\n=== Dispatch gate eval ===`);
console.log(`scenario: ${scenario}, model: ${model ?? "default (haiku)"}\n`);

// ── Dispatch gate hook ──────────────────────────────────────────

function makeDispatchGate(telemetryPath: string): HookCallback {
  return async (input) => {
    const { tool_name, agent_id, session_id } = input as PreToolUseHookInput & { agent_id?: string; session_id?: string };

    if (tool_name !== "Edit" && tool_name !== "Write" && tool_name !== "NotebookEdit") {
      return {};
    }

    // Subagents have agent_id set — allow them through
    if (agent_id) {
      writeHookEvent(telemetryPath, {
        ts: new Date().toISOString(),
        hook: "dispatch-gate",
        event: "PreToolUse",
        sessionId: session_id ?? "eval",
        decision: "allow",
        reason: "subagent",
      });
      return {};
    }

    writeHookEvent(telemetryPath, {
      ts: new Date().toISOString(),
      hook: "dispatch-gate",
      event: "PreToolUse",
      sessionId: session_id ?? "eval",
      decision: "block",
      reason: "main-session-edit",
    });

    return {
      decision: "block" as const,
      reason: "Dispatch required: use the Agent tool to delegate file edits to a subagent. Do not edit files directly in the main session.",
    };
  };
}

// ── Run with gate ───────────────────────────────────────────────

console.log("--- With dispatch gate ---");

const gateTelemetry = join(telemetryDir, "with-gate.jsonl");
const sharedResult = emptyResult();

const withGate = await runEval({
  scenario,
  model,
  result: sharedResult,
  telemetryPath: join(telemetryDir, "with-gate-tracker.jsonl"),
  promptSuffix: `IMPORTANT: You have a dispatch gate active. Direct file edits (Edit/Write) will be blocked in your main session. You MUST use the Agent tool to dispatch file modifications to a subagent. The subagent can edit freely.`,
  hooks: {
    PreToolUse: [{ hooks: [makeDispatchGate(gateTelemetry)] }],
  },
});

console.log(formatResult("with-gate", withGate));
if (withGate.e2eSignals.length) console.log(`      e2e: ${withGate.e2eSignals.join(", ")}`);
if (withGate.error) console.log(`      error: ${withGate.error}`);

// ── Run without gate (baseline) ─────────────────────────────────

console.log("\n--- Without dispatch gate (baseline) ---");

const bare = await runEval({
  scenario, model,
  telemetryPath: join(telemetryDir, "bare-tracker.jsonl"),
});

console.log(formatResult("bare", bare));
if (bare.error) console.log(`      error: ${bare.error}`);

// ── Behavioral assertions ───────────────────────────────────────

console.log("\n--- Behavioral assertions ---");

check(r, "with-gate: Claude dispatched to subagent", withGate.agentDispatched);
check(r, "with-gate: task succeeded", withGate.taskSuccess);
check(r, "with-gate: edits were made (via subagent)", withGate.editsMade);

check(r, "bare: task succeeded", bare.taskSuccess);
check(r, "bare: edits were made", bare.editsMade);

if (withGate.agentDispatched && !bare.agentDispatched) {
  check(r, "gate forced dispatch (Agent used only with gate)", true);
} else if (withGate.agentDispatched) {
  check(r, "gate variant used Agent tool", true);
}

// ── Telemetry assertions ────────────────────────────────────────

console.log("\n--- Telemetry assertions ---");

const gateEvents = readHookEvents(gateTelemetry);
const trackerEvents = readHookEvents(join(telemetryDir, "with-gate-tracker.jsonl"));
const bareTrackerEvents = readHookEvents(join(telemetryDir, "bare-tracker.jsonl"));

check(r, "gate telemetry: events written", gateEvents.length > 0, `got ${gateEvents.length}`);
// Block events only appear if Claude tried to edit directly before dispatching.
// If Claude dispatched immediately, only allow events exist — that's fine.
const hasBlockOrAllow = gateEvents.some(e => e.decision === "block" || e.decision === "allow");
check(r, "gate telemetry: has block or allow decisions", hasBlockOrAllow,
  `decisions: ${gateEvents.map(e => e.decision).join(",")}`);

check(r, "tracker telemetry: events written for with-gate", trackerEvents.length > 0, `got ${trackerEvents.length}`);
check(r, "tracker telemetry: events written for bare", bareTrackerEvents.length > 0, `got ${bareTrackerEvents.length}`);

check(r, "tracker telemetry: has PostToolUse events",
  trackerEvents.every(e => e.event === "PostToolUse"));

check(r, "tracker telemetry: records tool names",
  trackerEvents.some(e => typeof e.tool === "string" && e.tool.length > 0));

check(r, "tracker telemetry: has timestamps",
  trackerEvents.every(e => typeof e.ts === "string" && e.ts.length > 0));

// If gate allowed subagent edits, those should show up too
if (withGate.agentDispatched) {
  const allowEvents = gateEvents.filter(e => e.decision === "allow" && e.reason === "subagent");
  check(r, "gate telemetry: has subagent allow events", allowEvents.length > 0,
    `allow-subagent: ${allowEvents.length}`);
}

printAndExit(r);
