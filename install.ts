#!/usr/bin/env bun

import { readdir, mkdir, cp, rm, stat, readFile, writeFile } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { existsSync } from "node:fs";

// Construct installer — deploys from repo to ~/.claude
// Source: construct/ (modules), dotclaude/ (CLAUDE.md, settings.json, commands)
// Preserves: ALL CAPS files in identity/ and memory/
// Overwrites: hooks, skills, meta, commands, settings, CLAUDE.md
// Data: ~/.claude/data/ is never touched by sync (DB, sessions, signals live there)

const REPO = dirname(resolve(Bun.argv[1]));
const CONSTRUCT_SRC = join(REPO, "src");
const TEMPLATES = join(REPO, "dotclaude");
const DST = join(Bun.env.HOME!, ".claude");

const INFRA_FILES = new Set(["README.md", "INSTALL.md"]);

// File extensions that should never be overwritten during sync (runtime data)
const SKIP_EXTENSIONS = [".db", ".db-wal", ".db-shm"];

const DATA_DIR = join(DST, "data");
const BACKUP_DIR = join(DATA_DIR, "backups");
const MAX_BACKUPS = 5;

/** Back up the DB before install, keeping the last N backups */
async function backupDb(): Promise<void> {
  const dbPath = join(DATA_DIR, "construct.db");
  if (!(await exists(dbPath))) return;

  await mkdir(BACKUP_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  await cp(dbPath, join(BACKUP_DIR, `construct-${ts}.db`));

  // Copy WAL if present (ensures consistent backup)
  const walPath = dbPath + "-wal";
  if (await exists(walPath)) {
    await cp(walPath, join(BACKUP_DIR, `construct-${ts}.db-wal`));
  }

  console.log(`  backed up: construct-${ts}.db`);

  // Prune old backups, keep last N
  const files = (await readdir(BACKUP_DIR))
    .filter((f) => f.startsWith("construct-") && f.endsWith(".db"))
    .sort()
    .reverse();

  for (const f of files.slice(MAX_BACKUPS)) {
    const stem = f.replace(/\.db$/, "");
    await rm(join(BACKUP_DIR, f), { force: true });
    await rm(join(BACKUP_DIR, stem + ".db-wal"), { force: true });
    await rm(join(BACKUP_DIR, stem + ".db-shm"), { force: true });
  }
}

/** Migrate data from old locations under construct/ to ~/.claude/data/ */
async function migrateData(): Promise<void> {
  const migrations: Array<{ from: string; to: string; type: "file" | "dir" }> = [
    {
      from: join(DST, "construct", "data", "construct.db"),
      to: join(DATA_DIR, "construct.db"),
      type: "file",
    },
    {
      from: join(DST, "construct", "memory", "sessions"),
      to: join(DATA_DIR, "sessions"),
      type: "dir",
    },
    {
      from: join(DST, "construct", "memory", "signals"),
      to: join(DATA_DIR, "signals"),
      type: "dir",
    },
  ];

  let anyMigrated = false;
  for (const { from, to, type } of migrations) {
    if (!(await exists(from))) continue;
    // Skip if destination already has content
    if (type === "file" && await exists(to)) continue;
    if (type === "dir" && await exists(to) && (await readdir(to)).length > 0) continue;

    await mkdir(dirname(to), { recursive: true });
    await cp(from, to, { recursive: type === "dir" });

    // For DB files, also copy WAL/SHM if present
    if (type === "file" && from.endsWith(".db")) {
      for (const ext of ["-wal", "-shm"]) {
        if (await exists(from + ext)) {
          await cp(from + ext, to + ext);
        }
      }
    }

    console.log(`  migrated: ${from.replace(DST + "/", "")} → ${to.replace(DST + "/", "")}`);
    anyMigrated = true;
  }

  if (!anyMigrated) {
    console.log("  nothing to migrate");
  }
}

/** Discover ALL CAPS .md data files in a directory (stem is [A-Z_]+ only) */
async function discoverAllCapsMd(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir);
  return entries.filter((f) => {
    if (!f.endsWith(".md")) return false;
    if (INFRA_FILES.has(f)) return false;
    const stem = f.slice(0, -3);
    return /^[A-Z_]+$/.test(stem);
  });
}

/** Check if path exists */
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Sync srcDir to dstDir: copy everything from src, delete files in dst not in src */
async function syncDir(srcDir: string, dstDir: string): Promise<void> {
  await mkdir(dstDir, { recursive: true });

  // Collect all relative paths in src
  const srcPaths = new Set<string>();
  const SKIP_DIRS = new Set(["node_modules", "dist", ".bun", "backups"]);
  async function walk(dir: string, rel: string) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        srcPaths.add(relPath);
        await walk(join(dir, e.name), relPath);
      } else {
        srcPaths.add(relPath);
      }
    }
  }
  await walk(srcDir, "");

  // Copy all from src to dst, skipping node_modules/dist/.bun and DB files
  await cp(srcDir, dstDir, {
    recursive: true,
    force: true,
    filter: (src) => {
      const base = src.split("/").pop()!;
      if (SKIP_DIRS.has(base)) return false;
      if (SKIP_EXTENSIONS.some((ext) => base.endsWith(ext))) return false;
      return true;
    },
  });

  // Delete files in dst not in src
  async function cleanDst(dir: string, rel: string) {
    if (!(await exists(dir))) return;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (!srcPaths.has(relPath) && !SKIP_DIRS.has(e.name) && !SKIP_EXTENSIONS.some((ext) => e.name.endsWith(ext))) {
        await rm(join(dir, e.name), { recursive: true, force: true });
      } else if (e.isDirectory()) {
        await cleanDst(join(dir, e.name), relPath);
      }
    }
  }
  await cleanDst(dstDir, "");
}

// --- Main ---

console.log("=== Construct Installer ===");
console.log(`src: ${REPO}`);
console.log(`dst: ${DST}`);
console.log();

// 0. Ensure data directories exist
await mkdir(join(DATA_DIR), { recursive: true });
await mkdir(join(DATA_DIR, "sessions"), { recursive: true });
await mkdir(join(DATA_DIR, "signals"), { recursive: true });
await mkdir(join(DATA_DIR, "backups"), { recursive: true });

// 1. Migrate data from old locations (if needed)
console.log("migrating data...");
await migrateData();

// 2. Back up preserved files to temp dir
console.log("backing up preserved files...");
const backupDir = await mkdtemp(join(tmpdir(), "construct-backup-"));

try {
  // Back up ALL CAPS .md files from identity/ and memory/
  await mkdir(join(backupDir, "core/identity"), { recursive: true });
  await mkdir(join(backupDir, "memory"), { recursive: true });

  for (const f of await discoverAllCapsMd(join(DST, "construct/core/identity"))) {
    await cp(join(DST, "construct/core/identity", f), join(backupDir, "core/identity", f));
    console.log(`  preserved: core/identity/${f}`);
  }

  for (const f of await discoverAllCapsMd(join(DST, "construct/memory"))) {
    await cp(join(DST, "construct/memory", f), join(backupDir, "memory", f));
    console.log(`  preserved: memory/${f}`);
  }

  // 3. Sync construct/ tree (delete stale files, overwrite everything)
  // 3a. Back up DB before sync
  console.log("backing up database...");
  await backupDb();

  //    DB files (*.db, *.db-wal, *.db-shm) are never overwritten
  // 3a. Stop UI service before overwriting its files
  await Bun.$`systemctl --user stop construct-ui 2>/dev/null`.quiet().nothrow();

  console.log("syncing construct/...");
  await syncDir(CONSTRUCT_SRC, join(DST, "construct"));

  // 3b. Install UI dependencies (file: deps point to sibling dirs that were just overwritten)
  const uiDir = join(DST, "construct", "ui");
  const uiWebDir = join(uiDir, "web");
  if (await exists(join(uiDir, "package.json"))) {
    console.log("installing ui dependencies...");
    await Bun.$`cd ${uiDir} && bun install`.quiet();
    if (await exists(join(uiWebDir, "package.json"))) {
      await Bun.$`cd ${uiWebDir} && bun install`.quiet();
    }
  }

  // 4. Restore preserved files from temp dir
  console.log("restoring preserved files...");

  // Restore ALL CAPS .md files
  for (const [subdir, target] of [
    ["core/identity", join(DST, "construct/core/identity")],
    ["memory", join(DST, "construct/memory")],
  ]) {
    const backupSub = join(backupDir, subdir);
    if (await exists(backupSub)) {
      for (const f of await readdir(backupSub)) {
        if (f.endsWith(".md")) {
          const src = join(backupSub, f);
          const dst = join(target, f);
          await cp(src, dst);
          // Verify byte-size matches
          const srcSize = (await stat(src)).size;
          const dstSize = (await stat(dst)).size;
          if (srcSize !== dstSize) {
            console.error(`  ✗ size mismatch: ${f} (${srcSize} → ${dstSize})`);
          }
        }
      }
    }
  }

  // 5. Sync commands — install from repo, remove stale Construct-owned commands
  console.log("syncing commands...");
  await mkdir(join(DST, "commands"), { recursive: true });

  const cmdDir = join(TEMPLATES, "commands");
  const repoCommands = new Set<string>();
  if (await exists(cmdDir)) {
    for (const f of await readdir(cmdDir)) {
      if (f.endsWith(".md")) {
        await cp(join(cmdDir, f), join(DST, "commands", f));
        repoCommands.add(f);
      }
    }
  }

  // Register skills from src/skills/*/SKILL.md as commands
  const skillsDir = join(CONSTRUCT_SRC, "skills");
  if (await exists(skillsDir)) {
    for (const d of await readdir(skillsDir, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const skillFile = join(skillsDir, d.name, "SKILL.md");
      if (await exists(skillFile)) {
        const cmdName = `${d.name}.md`;
        if (!repoCommands.has(cmdName)) {
          await cp(skillFile, join(DST, "commands", cmdName));
          repoCommands.add(cmdName);
        }
      }
    }
  }
  console.log(`  installed: ${repoCommands.size ? [...repoCommands].join(" ") : "none"}`);

  // Remove stale Construct-owned commands using manifest
  const manifestPath = join(DST, "commands", ".construct-managed");
  const previouslyManaged = new Set<string>();
  if (await exists(manifestPath)) {
    const content = await readFile(manifestPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed) previouslyManaged.add(trimmed);
    }
  }
  for (const f of previouslyManaged) {
    if (!repoCommands.has(f) && await exists(join(DST, "commands", f))) {
      await rm(join(DST, "commands", f));
      console.log(`  removed stale: ${f}`);
    }
  }
  await writeFile(manifestPath, [...repoCommands].sort().join("\n") + "\n");

  // 6. Merge settings.json — replace hooks + statusLine, preserve everything else
  console.log("merging settings.json...");

  const repoSettings = JSON.parse(await readFile(join(TEMPLATES, "settings.json"), "utf-8"));
  // Path fixup: rewrite relative paths in hook commands to absolute $HOME-based paths
  const home = Bun.env.HOME!;
  function fixPaths(obj: any): any {
    if (typeof obj === "string") {
      return obj.replace(/^(bun|bash) src\//, `$1 ${home}/.claude/construct/`);
    }
    if (Array.isArray(obj)) return obj.map(fixPaths);
    if (obj && typeof obj === "object") {
      const out: any = {};
      for (const [k, v] of Object.entries(obj)) out[k] = fixPaths(v);
      return out;
    }
    return obj;
  }
  const fixedSettings = fixPaths(repoSettings);

  const dstSettingsPath = join(DST, "settings.json");
  if (await exists(dstSettingsPath)) {
    const existingSettings = JSON.parse(await readFile(dstSettingsPath, "utf-8"));
    const merged = {
      ...existingSettings,
      hooks: fixedSettings.hooks,
      statusLine: fixedSettings.statusLine,
    };
    await writeFile(dstSettingsPath, JSON.stringify(merged, null, 2) + "\n");
  } else {
    await writeFile(dstSettingsPath, JSON.stringify(fixedSettings, null, 2) + "\n");
  }

  // 7. Update CLAUDE.md — replace # Construct section, preserve content before AND after
  console.log("updating CLAUDE.md...");
  const rawSection = await readFile(join(TEMPLATES, "CLAUDE.md"), "utf-8");
  // Strip source-only HTML comments — they're meaningless in the installed copy
  const constructSection = rawSection.replace(/<!--[\s\S]*?-->\s*/g, "");
  const dstClaudeMd = join(DST, "CLAUDE.md");

  if (await exists(dstClaudeMd)) {
    const content = await readFile(dstClaudeMd, "utf-8");
    const lines = content.split("\n");

    // Find the start of "# Construct"
    const startIdx = lines.findIndex((l) => /^# Construct\s*$/.test(l));

    if (startIdx !== -1) {
      // Find the end: next ^# heading at same level (single #), or EOF
      let endIdx = lines.length;
      for (let i = startIdx + 1; i < lines.length; i++) {
        if (/^# [^\s#]/.test(lines[i]) || /^# $/.test(lines[i])) {
          endIdx = i;
          break;
        }
      }

      // Clean stale Construct source comments from the user section
      const before = lines.slice(0, startIdx).join("\n")
        .replace(/<!--\s*SOURCE FILE[^>]*?-->\s*/g, "");
      const after = lines.slice(endIdx).join("\n");

      let result = "";
      if (before.trim()) {
        result = before.replace(/\n+$/, "") + "\n\n";
      }
      result += constructSection.replace(/\n+$/, "");
      if (after.trim()) {
        result += "\n\n" + after.replace(/^\n+/, "");
      }
      result += "\n";

      await writeFile(dstClaudeMd, result);
    } else {
      // No existing Construct section — append
      const result = content.replace(/\n+$/, "") + "\n\n" + constructSection.replace(/\n+$/, "") + "\n";
      await writeFile(dstClaudeMd, result);
    }
  } else {
    await writeFile(dstClaudeMd, constructSection);
  }

  // 8. Verify critical files — byte-size check on key infrastructure
  const criticalFiles = [
    "construct/skills/skill-rules.json",
    "construct/trace.ts",
    "construct/memory/parse-transcript.ts",
  ];
  let verifyFails = 0;
  for (const rel of criticalFiles) {
    const src = join(CONSTRUCT_SRC, rel.replace("construct/", ""));
    const dst = join(DST, rel);
    if (await exists(src) && await exists(dst)) {
      const srcSize = (await stat(src)).size;
      const dstSize = (await stat(dst)).size;
      if (srcSize !== dstSize) {
        console.error(`  ✗ size mismatch: ${rel} (src ${srcSize} → dst ${dstSize})`);
        verifyFails++;
      }
    }
  }
  if (verifyFails > 0) {
    console.error(`\n⚠ ${verifyFails} file(s) failed size verification`);
  }

  // 9. Write build manifest — git info, paths, timestamps for diagnostics
  console.log("writing build manifest...");
  try {
    const rev = (await Bun.$`git -C ${REPO} rev-parse --short HEAD`.text()).trim();
    const fullRev = (await Bun.$`git -C ${REPO} rev-parse HEAD`.text()).trim();
    const dirty = (await Bun.$`git -C ${REPO} diff --quiet HEAD`.exitCode) !== 0;
    const hash = `${rev}${dirty ? "-dirty" : ""}`;
    const lastCommitMsg = (await Bun.$`git -C ${REPO} log -1 --format=%s`.text()).trim();
    const lastCommitDate = (await Bun.$`git -C ${REPO} log -1 --format=%ci`.text()).trim();
    const commitCount = (await Bun.$`git -C ${REPO} rev-list --count HEAD`.text()).trim();
    const branch = (await Bun.$`git -C ${REPO} rev-parse --abbrev-ref HEAD`.text()).trim();

    // Commits since last tag (if any tags exist)
    let sinceTag = "n/a";
    try {
      const lastTag = (await Bun.$`git -C ${REPO} describe --tags --abbrev=0 2>/dev/null`.text()).trim();
      if (lastTag) {
        const count = (await Bun.$`git -C ${REPO} rev-list ${lastTag}..HEAD --count`.text()).trim();
        sinceTag = `${count} (since ${lastTag})`;
      }
    } catch (e) {
      console.log(`  no tags: ${(e as Error).message?.slice(0, 60) ?? "unknown"}`);
    }

    // Write full manifest
    const dataDir = join(DST, "data");
    const dbPath = join(dataDir, "construct.db");
    const dbSize = (await exists(dbPath)) ? (await stat(dbPath)).size : 0;
    const sessionCount = (await exists(join(dataDir, "sessions")))
      ? (await readdir(join(dataDir, "sessions"))).filter((f) => f.endsWith(".md")).length
      : 0;

    const manifest = [
      `# Construct Build Manifest`,
      `# Generated by install.ts — do not edit`,
      ``,
      `[git]`,
      `revision = ${fullRev}`,
      `short = ${rev}`,
      `dirty = ${dirty}`,
      `branch = ${branch}`,
      `commit_count = ${commitCount}`,
      `commits_since_tag = ${sinceTag}`,
      `last_commit = ${lastCommitMsg}`,
      `last_commit_date = ${lastCommitDate}`,
      ``,
      `[paths]`,
      `repo = ${REPO}`,
      `claude_root = ${DST}`,
      `construct = ${join(DST, "construct")}`,
      `commands = ${join(DST, "commands")}`,
      `skills = ${join(DST, "construct", "skills")}`,
      `db = ${dbPath}`,
      `memory_db = ${join(dataDir, "memory", "sqlite_vec.db")}`,
      `sessions = ${join(dataDir, "sessions")}`,
      `ratings = ${join(dataDir, "signals", "ratings.jsonl")}`,
      `backups = ${join(dataDir, "backups")}`,
      ``,
      `[install]`,
      `timestamp = ${new Date().toISOString()}`,
      `bun_version = ${Bun.version}`,
      `platform = ${process.platform}`,
      `arch = ${process.arch}`,
      ``,
      `[stats]`,
      `db_size_bytes = ${dbSize}`,
      `session_count = ${sessionCount}`,
      ``,
    ].join("\n");

    await writeFile(join(DST, "construct", ".manifest"), manifest);
    console.log(`  build: ${hash}`);
  } catch (e) {
    console.error(`  manifest failed: ${(e as Error).message?.slice(0, 80) ?? "unknown"}`);
  }

  // 10. Write systemd service unit and restart
  console.log("updating construct-ui service...");
  const serviceDir = join(Bun.env.HOME!, ".config/systemd/user");
  await mkdir(serviceDir, { recursive: true });
  await writeFile(join(serviceDir, "construct-ui.service"), [
    "[Unit]",
    "Description=Construct UI (API + Web)",
    "After=network.target",
    "",
    "[Service]",
    "Type=simple",
    "WorkingDirectory=%h/.claude/construct/ui",
    "Environment=PATH=%h/.bun/bin:/usr/local/bin:/usr/bin:/bin",
    "Environment=NODE_ENV=production",
    "ExecStart=%h/.bun/bin/bun run serve",
    "Restart=on-failure",
    "RestartSec=5",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n"));
  await Bun.$`systemctl --user daemon-reload`.quiet().nothrow();
  await Bun.$`systemctl --user restart construct-ui`.quiet().nothrow();

  // 11. Verify database health — run DDL and smoke-test each table
  console.log("verifying database...");
  const dbVerifyPath = join(DATA_DIR, "construct.db");
  if (await exists(dbVerifyPath)) {
    try {
      const { Database } = await import("bun:sqlite");
      const db = new Database(dbVerifyPath);
      db.exec("PRAGMA journal_mode=WAL");

      // Run DDL to ensure migrations apply cleanly
      const { applyDDL } = await import(join(DST, "construct/goals/src/ddl.ts"));
      applyDDL(db);

      // Smoke-test: SELECT from every core table
      const tables = ["goals", "categories", "notes", "todos", "habits", "habit_completions", "history_logs", "goal_categories"];
      for (const table of tables) {
        const row = db.prepare(`SELECT count(*) as c FROM ${table}`).get() as { c: number };
        if (row.c < 0) throw new Error(`Invalid count for ${table}`);
      }

      // Verify due_date column exists on todos
      const cols = db.prepare("SELECT name FROM pragma_table_info('todos')").all() as { name: string }[];
      const colNames = cols.map((c) => c.name);
      if (!colNames.includes("due_date")) {
        throw new Error("todos table missing due_date column after DDL");
      }

      db.close();
      console.log("  ✓ DDL applied, all tables accessible");
    } catch (e) {
      console.error(`  ✗ database verification failed: ${(e as Error).message}`);
      console.error("  ACTION REQUIRED: check DDL migrations and database integrity");
    }
  } else {
    console.log("  ⚠ no database found (will be created on first API start)");
  }

  console.log();
  console.log("done.");
} finally {
  await rm(backupDir, { recursive: true, force: true });
}
