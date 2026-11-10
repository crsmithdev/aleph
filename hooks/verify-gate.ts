#!/usr/bin/env bun
/**
 * The verify gate's hook: the ladder is in hooks/lib/gate.ts. docs/verify-gate.md is the contract.
 */
import { gate } from "./lib/gate.ts";

const outcome = await gate(JSON.parse(await Bun.stdin.text()));
if (outcome?.verdict === "deny") {
  // Stop honors the legacy shape; hookSpecificOutput.permissionDecision does nothing here (measured on 2.1.259).
  console.log(JSON.stringify({
    decision: "block",
    reason: `Verify gate: ${outcome.reason} Run it, report what you observed, or say plainly what is unverified.`,
  }));
}
