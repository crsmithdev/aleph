import { resolve } from "path";
import { homedir } from "os";
import { mkdirSync, existsSync } from "fs";

// Auto-detect dev repo: if install.ts + src/data/src/paths.ts exist at or above cwd,
// we're running from the source tree. Default to .dev/ to prevent accidental production writes.
function detectClaudeRoot(): string {
  if (process.env.CLAUDE_ROOT) return process.env.CLAUDE_ROOT;
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    if (existsSync(resolve(dir, "install.ts")) && existsSync(resolve(dir, "src/data/src/paths.ts"))) {
      return resolve(dir, ".dev");
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(homedir(), ".claude");
}

const CLAUDE_ROOT = detectClaudeRoot();
const DATA_ROOT = process.env.CONSTRUCT_DATA_ROOT || resolve(CLAUDE_ROOT, "data");
const CONSTRUCT_ROOT = resolve(CLAUDE_ROOT, "construct");

// In dev mode, read transcripts from production (read-only) so the dev UI has real data.
const PROD_CLAUDE = resolve(homedir(), ".claude");

export const claudePaths = {
  root: CLAUDE_ROOT,
  construct: CONSTRUCT_ROOT,
  commands: resolve(CLAUDE_ROOT, "commands"),
  projects: resolve(PROD_CLAUDE, "projects"),
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
  directives: resolve(DATA_ROOT, "signals", "directives.jsonl"),
  hookEvents: resolve(DATA_ROOT, "signals", "hook-events.jsonl"),
};

const MEMORY_DIR = resolve(DATA_ROOT, "memory");

export function getMemoryDbPath(): string {
  return process.env.MEMORY_DB_PATH || resolve(MEMORY_DIR, "sqlite_vec.db");
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
