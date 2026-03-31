import { appendFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { dataPaths } from "./data/src/paths.ts";
import { trace } from "./trace.ts";

export function reportHook(hook: string, event: string, sessionId?: string): void {
  try {
    mkdirSync(dirname(dataPaths.hookEvents), { recursive: true });
    const line = JSON.stringify({ ts: new Date().toISOString(), hook, event, sessionId: sessionId ?? "unknown" });
    appendFileSync(dataPaths.hookEvents, line + "\n");
  } catch (e) {
    trace("hook-report", `write failed for ${hook}: ${(e as Error).message}`);
  }
}
