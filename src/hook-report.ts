import { appendFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { dataPaths } from "./data/src/paths.ts";
import { trace } from "./trace.ts";

export interface HookDecision {
  decision: "block" | "advisory" | "pass";
  tier?: number;
  detail?: string;
  /** Arbitrary structured payload merged into the JSONL entry. Use for
   *  per-hook context the offline analyst will want to grep — e.g. the
   *  verify-gate dumps the parsed [verify] block fields here so quality
   *  audits can run against the log. */
  meta?: Record<string, unknown>;
}

export function reportHook(hook: string, event: string, sessionId?: string, decision?: HookDecision): void {
  try {
    mkdirSync(dirname(dataPaths.hookEvents), { recursive: true });
    const entry: Record<string, unknown> = { ts: new Date().toISOString(), hook, event, sessionId: sessionId ?? "unknown" };
    if (decision) {
      entry.decision = decision.decision;
      if (decision.tier !== undefined) entry.tier = decision.tier;
      if (decision.detail) entry.detail = decision.detail;
      if (decision.meta) Object.assign(entry, decision.meta);
    }
    appendFileSync(dataPaths.hookEvents, JSON.stringify(entry) + "\n");
  } catch (e) {
    trace("hook-report", `write failed for ${hook}: ${(e as Error).message}`);
    throw e;
  }
}
