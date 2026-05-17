import { appendFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { dataPaths } from "./data/src/paths.ts";
import { trace } from "./trace.ts";

export interface HookDecision {
  decision?: "block" | "advisory" | "pass";
  tier?: number;
  detail?: string;
  /** Arbitrary structured payload merged into the JSONL entry. Use for
   *  per-hook context the offline analyst will want to grep — e.g. the
   *  verify-gate dumps the parsed [verify] block fields here so quality
   *  audits can run against the log. */
  meta?: Record<string, unknown>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SUBAGENT_RE = /^agent-[0-9a-f]+$/;

/** Real Claude Code session IDs are UUIDs or `agent-<hex>` (subagent). Anything
 *  else — empty/`unknown`, `background` from the consolidator, `test*` from
 *  manual stdin invocations during dev — is not real session data. It still
 *  lands in events.jsonl, but tagged `lane: "test"` so the telemetry adapter
 *  skips it (see `readEvents` in `src/telemetry/src/adapter.ts`). */
function isRealSessionId(sid: string | undefined): boolean {
  if (!sid) return false;
  return UUID_RE.test(sid) || SUBAGENT_RE.test(sid);
}

export function reportHook(hook: string, event: string, sessionId?: string, decision?: HookDecision): void {
  try {
    mkdirSync(dirname(dataPaths.events), { recursive: true });
    const entry: Record<string, unknown> = { ts: new Date().toISOString(), hook, event, sessionId: sessionId ?? "unknown" };
    if (!isRealSessionId(sessionId)) entry.lane = "test";
    if (decision) {
      if (decision.decision) entry.decision = decision.decision;
      if (decision.tier !== undefined) entry.tier = decision.tier;
      if (decision.detail) entry.detail = decision.detail;
      if (decision.meta) Object.assign(entry, decision.meta);
    }
    appendFileSync(dataPaths.events, JSON.stringify(entry) + "\n");
  } catch (e) {
    trace("hook-report", `write failed for ${hook}: ${(e as Error).message}`);
    throw e;
  }
}
