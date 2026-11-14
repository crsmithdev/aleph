/**
 * `aleph.db`: the machine state of aleph (docs/specs/2026-11-14-storage-ids.md). One connection per process, opened at
 * the first call and again when `ALEPH_DB` changes. A transaction never spans a git call or a process start, and no
 * read transaction outlives one request.
 */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { alephPath } from "./paths.ts";

// One entry per `user_version`: a file at version N runs the entries from N on, so a new version adds only its tables.
const SCHEMAS = [`
CREATE TABLE counters (kind TEXT PRIMARY KEY, last INTEGER NOT NULL);
CREATE TABLE jobs (id TEXT PRIMARY KEY, role TEXT NOT NULL, by TEXT NOT NULL, state TEXT NOT NULL, project TEXT,
  made INTEGER NOT NULL, started TEXT NOT NULL, ended TEXT, model TEXT, tier TEXT, cost REAL, commit_sha TEXT,
  pid INTEGER, exit_code INTEGER, target TEXT, prev TEXT REFERENCES jobs, retry_of TEXT REFERENCES jobs,
  was TEXT, extra TEXT);
CREATE INDEX jobs_state ON jobs (state);
CREATE INDEX jobs_target ON jobs (target, started);
CREATE INDEX jobs_prev ON jobs (prev);
CREATE INDEX jobs_retry_of ON jobs (retry_of);
CREATE TABLE events (seq INTEGER PRIMARY KEY, time TEXT NOT NULL, subject TEXT NOT NULL, action TEXT NOT NULL,
  object TEXT NOT NULL, detail TEXT);
CREATE INDEX events_time ON events (time);
CREATE INDEX events_object ON events (object, seq);
CREATE INDEX events_subject ON events (subject, seq);
CREATE VIEW event_rows AS SELECT e.*,
  s.role AS subject_role, o.role AS object_role, o.target AS object_target, coalesce(o.project, s.project) AS project,
  o.model, o.tier, o.cost, o.commit_sha, o.started, o.ended
  FROM events e LEFT JOIN jobs s ON s.id = e.subject LEFT JOIN jobs o ON o.id = e.object;
CREATE TABLE issue_state (issue TEXT PRIMARY KEY, ask TEXT, ask_job TEXT REFERENCES jobs, wait_kind TEXT,
  wait_reason TEXT, wait_since TEXT, ci TEXT);
CREATE TABLE tick (step TEXT PRIMARY KEY, last TEXT, result TEXT);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`, `
CREATE TABLE state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE usage (seq INTEGER PRIMARY KEY, time TEXT NOT NULL, five_hour REAL, seven_day REAL NOT NULL, seven_day_resets_at TEXT);
CREATE INDEX usage_time ON usage (time);
CREATE TABLE openrouter (seq INTEGER PRIMARY KEY, time TEXT NOT NULL, usage REAL NOT NULL, factor REAL);
CREATE TABLE jev (seq INTEGER PRIMARY KEY, time TEXT NOT NULL, cost REAL NOT NULL);
CREATE TABLE suite_history (seq INTEGER PRIMARY KEY, time TEXT NOT NULL, repo TEXT NOT NULL, commit_sha TEXT NOT NULL,
  ran INTEGER NOT NULL, passed INTEGER NOT NULL, failed INTEGER NOT NULL, skipped INTEGER NOT NULL, rerun_passed INTEGER NOT NULL);
CREATE TABLE flaky (seq INTEGER PRIMARY KEY, time TEXT NOT NULL, repo TEXT NOT NULL, check_name TEXT NOT NULL, run TEXT NOT NULL, tests TEXT);
`];
const VERSION = SCHEMAS.length;

let db: Database | undefined;
let at = "";

/** The path of `aleph.db`. */
export const dbFile = (): string => alephPath("ALEPH_DB", "aleph.db");

/** The connection, opened with the schema when the file is new. */
export function conn(): Database {
  const path = dbFile();
  if (db && at === path) return db;
  db?.close();
  mkdirSync(dirname(path), { recursive: true });
  db = new Database(path, { create: true });
  at = path;
  db.run("PRAGMA busy_timeout = 5000");
  // Changing the journal mode of a new file fails with SQLITE_BUSY at once when another process holds it: busy_timeout does not apply.
  for (const stop = Date.now() + 5000; ;) {
    try { db.run("PRAGMA journal_mode = WAL"); break; } catch (e: any) {
      if (e?.code !== "SQLITE_BUSY" || Date.now() > stop) throw e;
      Bun.sleepSync(5);
    }
  }
  db.run("PRAGMA synchronous = NORMAL");
  // Two processes can meet an empty file: the second waits for the lock, then sees the version.
  db.transaction(() => {
    const have = (db!.query("PRAGMA user_version").get() as { user_version: number }).user_version;
    if (have >= VERSION) return;
    for (const schema of SCHEMAS.slice(have)) db!.run(schema);
    db!.run(`PRAGMA user_version = ${VERSION}`);
  }).immediate();
  return db;
}

/** Run `fn` in `BEGIN IMMEDIATE`: it takes the write lock first, so a read-modify-write never loses a race. */
export function tx<T>(fn: (db: Database) => T): T {
  const d = conn();
  return d.transaction(() => fn(d)).immediate();
}

/** The next number of `kind`, above `floor`; it never repeats and never falls. */
export const next = (kind: string, floor = 0): number => tx((d) => {
  const row = d.query("SELECT last FROM counters WHERE kind = ?").get(kind) as { last: number } | null;
  const n = Math.max(row?.last ?? 0, floor) + 1;
  d.query("INSERT INTO counters (kind, last) VALUES (?, ?) ON CONFLICT (kind) DO UPDATE SET last = excluded.last").run(kind, n);
  return n;
});

/** The JSON of row `key` in `table`; `fallback` when the row does not exist. */
export function getJson<T>(table: "settings" | "state", key: string, fallback: T): T {
  const row = conn().query(`SELECT value FROM ${table} WHERE key = ?`).get(key) as { value: string } | null;
  return row ? JSON.parse(row.value) : fallback;
}

/** Writes `value` as the JSON of row `key` in `table`. */
export const putJson = (table: "settings" | "state", key: string, value: unknown): void => {
  conn().query(`INSERT INTO ${table} VALUES (?, ?) ON CONFLICT DO UPDATE SET value = excluded.value`).run(key, JSON.stringify(value));
};
