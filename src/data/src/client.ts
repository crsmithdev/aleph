import { Database } from 'bun:sqlite';
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';

const DEFAULT_DB_PATH = join(homedir(), '.claude', 'construct', 'data', 'construct.db');

export function createDb(url?: string): { db: BunSQLiteDatabase; sqlite: Database } {
  const dbPath = url || process.env.CONSTRUCT_DB_PATH || DEFAULT_DB_PATH;
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const sqlite = new Database(dbPath);
  sqlite.exec('PRAGMA journal_mode = WAL');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const db = drizzle(sqlite);
  return { db, sqlite };
}

export type Db = BunSQLiteDatabase;
export type Sqlite = Database;
