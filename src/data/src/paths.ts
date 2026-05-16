import { resolve } from "path";
import { homedir } from "os";
import { mkdirSync } from "fs";

const CLAUDE_ROOT = process.env.CLAUDE_ROOT || resolve(homedir(), ".claude");
const DATA_ROOT = process.env.CONSTRUCT_DATA_ROOT || resolve(homedir(), ".construct");
const CONSTRUCT_ROOT = resolve(CLAUDE_ROOT, "construct");

export const claudePaths = {
  root: CLAUDE_ROOT,
  construct: CONSTRUCT_ROOT,
  commands: resolve(CLAUDE_ROOT, "commands"),
  projects: resolve(CLAUDE_ROOT, "projects"),
  manifest: resolve(CONSTRUCT_ROOT, ".manifest"),
  skills: resolve(CONSTRUCT_ROOT, "skills"),
};

export const dataPaths = {
  root: DATA_ROOT,
  db: resolve(DATA_ROOT, "construct.db"),
  backups: resolve(DATA_ROOT, "backups"),
  sessions: resolve(DATA_ROOT, "sessions"),
  signals: resolve(DATA_ROOT, "signals"),
  ratings: resolve(DATA_ROOT, "signals", "ratings.jsonl"),
  feedback: resolve(DATA_ROOT, "signals", "feedback.jsonl"),
  directives: resolve(DATA_ROOT, "signals", "directives.jsonl"),
  hookEvents: resolve(DATA_ROOT, "signals", "hook-events.jsonl"),
  compactionNotes: resolve(DATA_ROOT, "signals", "compaction-notes.json"),
  toolSignals: resolve(DATA_ROOT, "signals", "tool-signals.jsonl"),
  consolidationState: resolve(DATA_ROOT, "signals", "consolidation-state.json"),
  learnedRules: resolve(DATA_ROOT, "signals", "learned-rules.md"),
  ruleInjections: resolve(DATA_ROOT, "signals", "rule-injections.jsonl"),
  ruleEffectiveness: resolve(DATA_ROOT, "signals", "rule-effectiveness.json"),
  learningProvenance: resolve(DATA_ROOT, "signals", "learning-provenance.jsonl"),
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
