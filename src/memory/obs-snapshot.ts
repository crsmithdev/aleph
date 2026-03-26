#!/usr/bin/env bun
/**
 * Takes a memory snapshot and writes it to obs_memory_snapshots in construct.db.
 * Run standalone or spawned fire-and-forget from session-start.
 */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { dataPaths, externalPaths } from "../paths.ts";

const constructDbPath = dataPaths.db;
const memoryDbPath = externalPaths.memoryDb;

function ensureTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS obs_memory_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      taken_at TEXT NOT NULL DEFAULT (datetime('now')),
      total INTEGER NOT NULL,
      by_type TEXT NOT NULL,
      health TEXT NOT NULL,
      by_tag TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_obs_memory_taken_at ON obs_memory_snapshots(taken_at);
  `);
}

function getMemoryStats(memDb: Database): {
  total: number;
  byType: Record<string, number>;
  byTag: Record<string, number>;
  stale: number;
} {
  const total = (memDb.query("SELECT COUNT(*) as c FROM memories WHERE deleted_at IS NULL").get() as { c: number }).c;

  const typeRows = memDb
    .query("SELECT memory_type, COUNT(*) as c FROM memories WHERE deleted_at IS NULL GROUP BY memory_type")
    .all() as Array<{ memory_type: string; c: number }>;
  const byType: Record<string, number> = {};
  for (const r of typeRows) byType[r.memory_type] = r.c;

  const tagRows = memDb
    .query("SELECT tags FROM memories WHERE deleted_at IS NULL AND tags IS NOT NULL")
    .all() as Array<{ tags: string }>;
  const byTag: Record<string, number> = {};
  for (const r of tagRows) {
    const tagStr = r.tags.trim();
    if (!tagStr) continue;
    // Tags can be comma-separated strings or JSON arrays
    let tags: string[];
    if (tagStr.startsWith('[')) {
      try { tags = JSON.parse(tagStr); } catch { continue; }
    } else {
      tags = tagStr.split(',').map(t => t.trim()).filter(Boolean);
    }
    for (const t of tags) byTag[t] = (byTag[t] || 0) + 1;
  }

  // Stale = memories not updated in 30+ days
  // updated_at is a unix timestamp (seconds)
  const thirtyDaysAgo = Date.now() / 1000 - 30 * 24 * 60 * 60;
  const staleResult = memDb
    .query(
      "SELECT COUNT(*) as c FROM memories WHERE deleted_at IS NULL AND updated_at < ?",
    )
    .get(thirtyDaysAgo) as { c: number };

  return { total, byType, byTag, stale: staleResult.c };
}

try {
  if (!existsSync(memoryDbPath)) {
    process.exit(0);
  }

  mkdirSync(dirname(constructDbPath), { recursive: true });
  const constructDb = new Database(constructDbPath);
  constructDb.exec("PRAGMA journal_mode = WAL");
  ensureTable(constructDb);

  const memDb = new Database(memoryDbPath, { readonly: true });
  const stats = getMemoryStats(memDb);
  memDb.close();

  const healthScore = stats.total > 0 ? Math.max(0, 1 - stats.stale / stats.total) : 0;

  constructDb
    .query(
      "INSERT INTO obs_memory_snapshots (total, by_type, health, by_tag) VALUES (?, ?, ?, ?)",
    )
    .run(
      stats.total,
      JSON.stringify(stats.byType),
      JSON.stringify({ score: Math.round(healthScore * 100) / 100, stale: stats.stale }),
      JSON.stringify(stats.byTag),
    );

  constructDb.close();
} catch (err) {
  console.error("obs-snapshot error:", (err as Error).message ?? err);
  process.exit(1);
}
