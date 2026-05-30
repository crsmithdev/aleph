import { resolve } from "path";
import { homedir } from "os";
import { mkdirSync } from "fs";

const CLAUDE_ROOT = process.env.CLAUDE_ROOT || resolve(homedir(), ".claude");
const DATA_ROOT = process.env.ALEPH_DATA_ROOT || resolve(homedir(), ".aleph");
const ALEPH_ROOT = resolve(CLAUDE_ROOT, "aleph");

export const claudePaths = {
  root: CLAUDE_ROOT,
  aleph: ALEPH_ROOT,
  commands: resolve(CLAUDE_ROOT, "commands"),
  projects: resolve(CLAUDE_ROOT, "projects"),
  manifest: resolve(ALEPH_ROOT, ".manifest"),
  skills: resolve(ALEPH_ROOT, "skills"),
};

export const dataPaths = {
  root: DATA_ROOT,
  db: resolve(DATA_ROOT, "aleph.db"),
  backups: resolve(DATA_ROOT, "backups"),
  sessions: resolve(DATA_ROOT, "sessions"),
  signals: resolve(DATA_ROOT, "signals"),
  events: resolve(DATA_ROOT, "signals", "events.jsonl"),
  compactionNotes: resolve(DATA_ROOT, "signals", "compaction-notes.json"),
  consolidationState: resolve(DATA_ROOT, "signals", "consolidation-state.json"),
};

// Default matches memory-writer.py's default so reads and writes use the same DB.
// Override via MEMORY_DB_PATH env var.
export function getMemoryDbPath(): string {
  return process.env.MEMORY_DB_PATH || resolve(homedir(), ".local/share/mcp-memory/sqlite_vec.db");
}

export const externalPaths = {
  get memoryDb() { return getMemoryDbPath(); },
};

export function ensureDataDirs(): void {
  mkdirSync(dataPaths.root, { recursive: true });
  mkdirSync(dataPaths.backups, { recursive: true });
  mkdirSync(dataPaths.sessions, { recursive: true });
  mkdirSync(dataPaths.signals, { recursive: true });
}
