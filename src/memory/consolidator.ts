#!/usr/bin/env bun
/**
 * Memory consolidator — background script, spawned by memory-consolidate-stop.ts.
 *
 * After the telemetry consolidation the consolidator no longer synthesizes
 * behavioral rules (that injection path was driven by noisy auto_extract
 * memories and replaced with a verbatim feedback tail-scan in
 * context-restore-start.ts). All this script does today is touch the
 * consolidation-state.json so the periodic trigger knows when to fire again.
 */
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";
import { Database } from "bun:sqlite";
import { trace } from "../trace.ts";
import { reportHook } from "../hook-report.ts";
import { dataPaths, externalPaths } from "../data/src/paths.ts";

const TAG = "consolidator";

reportHook(TAG, "ConsolidationRun", "background");
trace(TAG, "consolidator starting");

function updateState(data: { lastRun: string; lastMemoryCount: number }) {
  try {
    mkdirSync(dirname(dataPaths.consolidationState), { recursive: true });
    writeFileSync(dataPaths.consolidationState, JSON.stringify(data, null, 2));
  } catch (e) {
    trace(TAG, `state write failed: ${(e as Error).message}`);
  }
}

let memoryCount = 0;
try {
  const memDbPath = externalPaths.memoryDb;
  if (existsSync(memDbPath)) {
    const db = new Database(memDbPath, { readonly: true });
    const row = db.query<{ n: number }, []>(
      `SELECT COUNT(*) AS n FROM memories WHERE deleted_at IS NULL`,
    ).get();
    memoryCount = row?.n ?? 0;
    db.close();
  }
} catch (e) {
  trace(TAG, `memory count query failed: ${(e as Error).message}`);
}

updateState({ lastRun: new Date().toISOString(), lastMemoryCount: memoryCount });

reportHook(TAG, "ConsolidationRun", "background", {
  decision: "pass",
  detail: `state updated, ${memoryCount} memories`,
});

trace(TAG, "consolidator done");
process.exit(0);
