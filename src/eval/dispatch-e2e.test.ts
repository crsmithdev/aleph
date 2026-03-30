#!/usr/bin/env bun
/**
 * Dispatch gate eval.
 *
 * Launches Claude via the Agent SDK with a PreToolUse hook that blocks
 * direct Edit/Write in the main session (simulating the dispatch gate).
 * Verifies that Claude adapts by dispatching work to a subagent.
 *
 * Usage:
 *   bun src/eval/dispatch-e2e.test.ts
 *   bun src/eval/dispatch-e2e.test.ts --model claude-sonnet-4-6
 *   bun src/eval/dispatch-e2e.test.ts --scenario broken-math
 */
import type { PreToolUseHookInput, HookCallback } from "@anthropic-ai/claude-agent-sdk";
import {
  runEval, createResults, check, printAndExit, formatResult,
  type EvalResult,
} from "./harness.ts";

const args = process.argv.slice(2);
const model = args.includes("--model") ? args[args.indexOf("--model") + 1] : undefined;
const scenario = args.includes("--scenario") ? args[args.indexOf("--scenario") + 1] : "broken-math";

const r = createResults();

console.log(`\n=== Dispatch gate eval ===`);
console.log(`scenario: ${scenario}, model: ${model ?? "default (haiku)"}\n`);

// ── Dispatch gate hook ──────────────────────────────────────────
// Blocks Edit/Write unless the hook fires from a subagent context.
// The SDK provides agent_id in BaseHookInput when inside a subagent.

const dispatchGate: HookCallback = async (input) => {
  const { tool_name, agent_id } = input as PreToolUseHookInput & { agent_id?: string };

  if (tool_name !== "Edit" && tool_name !== "Write" && tool_name !== "NotebookEdit") {
    return {};
  }

  // Subagents have agent_id set — allow them through
  if (agent_id) return {};

  return {
    decision: "block" as const,
    reason: "Dispatch required: use the Agent tool to delegate file edits to a subagent. Do not edit files directly in the main session.",
  };
};

// ── Run with gate ───────────────────────────────────────────────

console.log("--- With dispatch gate ---");

const withGate = await runEval({
  scenario,
  model,
  promptSuffix: `IMPORTANT: You have a dispatch gate active. Direct file edits (Edit/Write) will be blocked in your main session. You MUST use the Agent tool to dispatch file modifications to a subagent. The subagent can edit freely.`,
  hooks: {
    PreToolUse: [{ hooks: [dispatchGate] }],
  },
});

console.log(formatResult("with-gate", withGate));
if (withGate.e2eSignals.length) console.log(`      e2e: ${withGate.e2eSignals.join(", ")}`);
if (withGate.error) console.log(`      error: ${withGate.error}`);

// ── Run without gate (baseline) ─────────────────────────────────

console.log("\n--- Without dispatch gate (baseline) ---");

const bare = await runEval({ scenario, model });

console.log(formatResult("bare", bare));
if (bare.error) console.log(`      error: ${bare.error}`);

// ── Assertions ──────────────────────────────────────────────────

console.log("\n--- Assertions ---");

check(r, "with-gate: Claude dispatched to subagent", withGate.agentDispatched);
check(r, "with-gate: task succeeded", withGate.taskSuccess);
check(r, "with-gate: edits were made (via subagent)", withGate.editsMade);

check(r, "bare: task succeeded", bare.taskSuccess);
check(r, "bare: edits were made", bare.editsMade);

// The gate variant should show Agent tool usage that the bare variant may not
if (withGate.agentDispatched && !bare.agentDispatched) {
  check(r, "gate forced dispatch (Agent used only with gate)", true);
} else if (withGate.agentDispatched) {
  check(r, "gate variant used Agent tool", true);
}

printAndExit(r);
