#!/usr/bin/env bun
/**
 * One-shot cleanup: tag rows in signals/events.jsonl whose sessionId doesn't
 * look like a real Claude Code session (UUID or `agent-<hex>`) with
 * `lane: "test"`. The telemetry adapter skips lane=test entries.
 *
 * Idempotent: re-running on an already-tagged row is a no-op. Going forward,
 * `reportHook()` applies the tag at write time; this script only repairs the
 * pollution that accumulated before that fix landed.
 */
import { existsSync, readFileSync, writeFileSync, copyFileSync } from "fs";
import { dataPaths } from "../src/data/src/paths.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SUBAGENT_RE = /^agent-[0-9a-f]+$/;

function isRealSessionId(sid: string | undefined): boolean {
  if (!sid) return false;
  return UUID_RE.test(sid) || SUBAGENT_RE.test(sid);
}

function main(): void {
  const src = dataPaths.events;
  if (!existsSync(src)) {
    console.log(`No events.jsonl at ${src} — nothing to do.`);
    return;
  }

  const lines = readFileSync(src, "utf-8").split("\n");
  const out: string[] = [];
  let tagged = 0;
  let alreadyTagged = 0;
  let kept = 0;
  let malformed = 0;

  for (const line of lines) {
    if (!line) continue;
    try {
      const entry = JSON.parse(line) as Record<string, unknown>;
      if (isRealSessionId(entry.sessionId as string | undefined)) {
        out.push(line);
        kept++;
        continue;
      }
      if (entry.lane === "test") {
        out.push(line);
        alreadyTagged++;
        continue;
      }
      entry.lane = "test";
      out.push(JSON.stringify(entry));
      tagged++;
    } catch {
      malformed++;
      out.push(line);
    }
  }

  console.log(`Scanned ${kept + tagged + alreadyTagged + malformed} entries:`);
  console.log(`  ${kept} session rows (kept as-is)`);
  console.log(`  ${tagged} ghost rows tagged lane=test`);
  console.log(`  ${alreadyTagged} already tagged`);
  console.log(`  ${malformed} malformed (preserved verbatim)`);

  if (tagged === 0) {
    console.log("Nothing to change.");
    return;
  }

  const backup = `${src}.pre-prune-${Date.now()}.bak`;
  copyFileSync(src, backup);
  console.log(`Backed up original to ${backup}`);

  writeFileSync(src, out.map(l => l + "\n").join(""));
  console.log(`Rewrote ${src}`);
}

main();
