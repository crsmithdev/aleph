import { Database } from 'bun:sqlite';
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { dataPaths } from './paths.ts';

const DEFAULT_DB_PATH = dataPaths.db;

export function createDb(url?: string): { db: BunSQLiteDatabase; sqlite: Database } {
  const dbPath = url || process.env.CONSTRUCT_DB_PATH || DEFAULT_DB_PATH;
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const sqlite = new Database(dbPath);
  sqlite.exec('PRAGMA journal_mode = WAL');
  sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.exec('PRAGMA busy_timeout = 5000');
  // synchronous=NORMAL with WAL is the recommended write-throughput setting
  // for multi-worker workloads. Trades a tiny crash-window for far less
  // fsync churn — workers were observed sub-linear at default FULL.
  sqlite.exec('PRAGMA synchronous = NORMAL');
  // Push the WAL autocheckpoint up so frequent step writes don't trigger
  // a checkpoint on every commit. Default 1000 pages ≈ 4MB.
  sqlite.exec('PRAGMA wal_autocheckpoint = 4000');
  const db = drizzle(sqlite);
  return { db, sqlite };
}

export type Db = BunSQLiteDatabase;
export type Sqlite = Database;
