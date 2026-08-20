/**
 * The only place bun:sqlite is imported. Everything else takes a `Db`.
 *
 * One database, `data/aleph.db`, WAL mode. Migrations are numbered, forward-only
 * and applied inside a transaction; `schema_version` is the single source of truth
 * for what has run.
 */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Db = Database;

const MIGRATIONS: string[] = [
  // 1 — event index (derived from JSONL; see docs/design/phase-1.md §5.5)
  `
  CREATE TABLE events (
    id         TEXT PRIMARY KEY,
    ts         TEXT NOT NULL,
    kind       TEXT NOT NULL,
    origin     TEXT NOT NULL,
    session_id TEXT,
    task_id    TEXT,
    run_id     TEXT,
    trace_id   TEXT NOT NULL,
    caused_by  TEXT,
    actor      TEXT NOT NULL,
    file       TEXT NOT NULL,
    offset     INTEGER NOT NULL,
    payload    TEXT
  );
  CREATE INDEX events_ts ON events(ts);
  CREATE INDEX events_session ON events(session_id, ts);
  CREATE INDEX events_kind ON events(kind, ts);
  CREATE INDEX events_trace ON events(trace_id);
  CREATE INDEX events_cause ON events(caused_by);
  `,
  // 2 — sessions, channel bindings, turns (§7.2)
  `
  CREATE TABLE sessions (
    id              TEXT PRIMARY KEY,
    topic_key       TEXT NOT NULL UNIQUE,
    title           TEXT NOT NULL,
    state           TEXT NOT NULL,
    sdk_session_id  TEXT,
    created_at      TEXT NOT NULL,
    last_turn_at    TEXT,
    turn_count      INTEGER NOT NULL DEFAULT 0,
    checkpoint_path TEXT,
    model_class     TEXT NOT NULL DEFAULT 'conversation',
    archived_at     TEXT
  );
  CREATE INDEX sessions_state ON sessions(state, last_turn_at);

  CREATE TABLE channel_bindings (
    channel     TEXT NOT NULL,
    external_id TEXT NOT NULL,
    session_id  TEXT NOT NULL REFERENCES sessions(id),
    chat_id     TEXT,
    created_at  TEXT NOT NULL,
    PRIMARY KEY (channel, external_id)
  );
  CREATE INDEX channel_bindings_session ON channel_bindings(session_id);

  CREATE TABLE turns (
    id                    TEXT PRIMARY KEY,
    session_id            TEXT NOT NULL REFERENCES sessions(id),
    trace_id              TEXT NOT NULL,
    started_at            TEXT NOT NULL,
    ended_at              TEXT,
    status                TEXT NOT NULL,
    model                 TEXT,
    tier                  TEXT,
    lane                  TEXT,
    input_tokens          INTEGER,
    output_tokens         INTEGER,
    cache_read_tokens     INTEGER,
    cache_creation_tokens INTEGER,
    cost_usd              REAL,
    resume_mode           TEXT
  );
  CREATE INDEX turns_session ON turns(session_id, started_at);
  `,
  // 3 — usage accumulator (§11.3) and durable key/value for channel offsets
  `
  CREATE TABLE usage (
    id                    TEXT PRIMARY KEY,
    ts                    TEXT NOT NULL,
    lane                  TEXT NOT NULL,
    session_id            TEXT,
    task_id               TEXT,
    run_id                TEXT,
    model                 TEXT NOT NULL,
    tier                  TEXT NOT NULL,
    input_tokens          INTEGER NOT NULL,
    output_tokens         INTEGER NOT NULL,
    cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
    cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
    weighted              REAL NOT NULL,
    cost_usd              REAL,
    source                TEXT NOT NULL
  );
  CREATE INDEX usage_ts ON usage(ts);
  CREATE INDEX usage_lane_ts ON usage(lane, ts);

  CREATE TABLE kv (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE jobs_done (
    job_id     TEXT PRIMARY KEY,
    finished_at TEXT NOT NULL
  );
  `,
];

export function openDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  migrate(db);
  return db;
}

export function migrate(db: Db): number {
  db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
  const row = db.query<{ version: number }, []>("SELECT version FROM schema_version LIMIT 1").get();
  let current = row?.version ?? 0;
  if (!row) db.exec("INSERT INTO schema_version (version) VALUES (0)");
  for (let i = current; i < MIGRATIONS.length; i++) {
    const sql = MIGRATIONS[i]!;
    db.transaction(() => {
      db.exec(sql);
      db.run("UPDATE schema_version SET version = ?", [i + 1]);
    })();
    current = i + 1;
  }
  return current;
}

export function journalMode(db: Db): string {
  return db.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get()?.journal_mode ?? "unknown";
}
