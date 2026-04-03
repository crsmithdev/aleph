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
  const db = drizzle(sqlite);
  return { db, sqlite };
}

export type Db = BunSQLiteDatabase;
export type Sqlite = Database;
