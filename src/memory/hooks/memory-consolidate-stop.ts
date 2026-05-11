#!/usr/bin/env bun
/**
 * Stop hook: threshold-triggered memory consolidation.
 *
 * Checks whether enough new memories have accumulated since the last
 * consolidation run. If so, spawns consolidator.ts as a fire-and-forget
 * background process.
 *
 * Trigger criteria (either):
 *   - 5+ new auto_extract memories since last run
 *   - 7+ days elapsed since last run
 *
 * Never blocks (always exit 0). DB access is a single COUNT query.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { Database } from "bun:sqlite";
import { trace } from "../../trace.ts";
import { reportHook } from "../../hook-report.ts";
import { dataPaths, externalPaths } from "../../data/src/paths.ts";

const TAG = "memory-consolidate";
const NEW_MEMORIES_THRESHOLD = 5;
const DAYS_THRESHOLD = 7;

let input: any;
const raw = await Bun.stdin.text();
try { input = JSON.parse(raw); }
catch (e) { trace(TAG, `stdin parse failed: ${(e as Error).message}`); process.exit(0); }

const sessionId: string = input.session_id ?? "unknown";
reportHook(TAG, "Stop", sessionId);

// Read consolidation state
let state = { lastRun: new Date(0).toISOString(), lastMemoryCount: 0 };
try {
  if (existsSync(dataPaths.consolidationState)) {
    state = JSON.parse(readFileSync(dataPaths.consolidationState, "utf8"));
  }
} catch {
  // use defaults
}

const memDbPath = externalPaths.memoryDb;
if (!existsSync(memDbPath)) {
  trace(TAG, `memory DB not found at ${memDbPath}`);
  process.exit(0);
}

// Count auto_extract memories added since last run
let newCount = 0;
try {
  const db = new Database(memDbPath, { readonly: true });
  const lastRunSecs = new Date(state.lastRun).getTime() / 1000;
  const row = db.query<{ n: number }, [number]>(
    `SELECT COUNT(*) as n FROM memories
     WHERE deleted_at IS NULL AND tags LIKE '%auto_extract%' AND created_at > ?`
  ).get(lastRunSecs);
  db.close();
  newCount = row?.n ?? 0;
} catch (e) {
  trace(TAG, `DB query failed: ${(e as Error).message}`);
  process.exit(0);
}

const daysSince = (Date.now() - new Date(state.lastRun).getTime()) / 86400000;
const shouldRun = newCount >= NEW_MEMORIES_THRESHOLD || daysSince >= DAYS_THRESHOLD;

trace(TAG, `${newCount} new memories, ${daysSince.toFixed(1)}d since last run → ${shouldRun ? "trigger" : "skip"}`);

if (!shouldRun) {
  reportHook(TAG, "Stop", sessionId, {
    decision: "advisory",
    detail: `skip: ${newCount} new, ${daysSince.toFixed(1)}d since last`,
  });
  process.exit(0);
}

reportHook(TAG, "Stop", sessionId, {
  decision: "pass",
  detail: `trigger: ${newCount} new memories`,
});

// Spawn consolidator fire-and-forget
const consolidatorScript = resolve(dirname(Bun.main), "../consolidator.ts");
if (!existsSync(consolidatorScript)) {
  trace(TAG, `consolidator not found at ${consolidatorScript}`);
  process.exit(0);
}

try {
  const proc = Bun.spawn(["bun", consolidatorScript], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  proc.unref();
  trace(TAG, "spawned consolidator");
} catch (e) {
  trace(TAG, `spawn failed: ${(e as Error).message}`);
}

process.exit(0);
