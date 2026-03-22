#!/usr/bin/env bun

import { readdir, mkdir, cp, rm, stat, readFile, writeFile } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { existsSync, lstatSync } from "node:fs";

// Construct installer — deploys from repo to ~/.claude
// Source: construct/ (modules), dotclaude/ (CLAUDE.md, settings.json, commands)
// Preserves: ALL CAPS files in identity/, sessions/, ratings.jsonl
// Overwrites: hooks, skills, meta, commands, settings, CLAUDE.md

const REPO = dirname(resolve(Bun.argv[1]));
const CONSTRUCT_SRC = join(REPO, "src");
const TEMPLATES = join(REPO, "dotclaude");
const DST = join(Bun.env.HOME!, ".claude");

const INFRA_FILES = new Set(["README.md", "INSTALL.md"]);

// Static preserved paths (relative to construct/)
const PRESERVE = [
  "memory/signals/ratings.jsonl",
  "memory/sessions",
];

// File extensions that should never be overwritten during sync (runtime data)
const SKIP_EXTENSIONS = [".db", ".db-wal", ".db-shm"];

const BACKUP_DIR = join(DST, "construct", "data", "backups");
const MAX_BACKUPS = 5;

/** Back up the DB before install, keeping the last N backups */
async function backupDb(): Promise<void> {
  const dbPath = join(DST, "construct", "data", "construct.db");
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

/** Migrate data from construct.bak into src/data/ when switching to linked mode.
 *  Prevents data loss: the backup has the real DB, src/data/ may have a fresh empty one. */
async function migrateDataFromBackup(): Promise<void> {
  const bakDir = join(DST, "construct.bak");
  if (!existsSync(bakDir)) return;

  const { Database } = await import("bun:sqlite");

  // Migrate construct.db
  const bakDb = join(bakDir, "data", "construct.db");
  const liveDb = join(CONSTRUCT_SRC, "data", "construct.db");
  if (await exists(bakDb)) {
    await mkdir(dirname(liveDb), { recursive: true });
    const needsMigration = !(await exists(liveDb)) || (() => {
      try {
        const db = new Database(liveDb, { readonly: true });
        const row = db.query("SELECT COUNT(*) as c FROM todos").get() as { c: number };
        const goals = db.query("SELECT COUNT(*) as c FROM goals").get() as { c: number };
        db.close();
        return row.c === 0 && goals.c === 0;
      } catch { return true; }
    })();

    if (needsMigration) {
      // Checkpoint WAL in backup so all data is in the main file
      try {
        const db = new Database(bakDb);
        db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
        db.close();
      } catch {}
      await cp(bakDb, liveDb);
      // Remove any stale WAL/SHM at destination
      for (const ext of ["-wal", "-shm"]) {
        if (await exists(liveDb + ext)) await rm(liveDb + ext, { force: true });
      }
      console.log("  migrated data from construct.bak");
    }
  }

  // Migrate ratings.jsonl
  const bakRatings = join(bakDir, "memory", "signals", "ratings.jsonl");
  const liveRatings = join(CONSTRUCT_SRC, "memory", "signals", "ratings.jsonl");
  if (await exists(bakRatings)) {
    await mkdir(dirname(liveRatings), { recursive: true });
    const liveSize = (await exists(liveRatings)) ? (await stat(liveRatings)).size : 0;
    const bakSize = (await stat(bakRatings)).size;
    if (bakSize > liveSize) {
      await cp(bakRatings, liveRatings);
      console.log("  migrated ratings.jsonl from construct.bak");
    }
  }

  // Migrate session files
  const bakSessions = join(bakDir, "memory", "sessions");
  const liveSessions = join(CONSTRUCT_SRC, "memory", "sessions");
  if (existsSync(bakSessions)) {
    await mkdir(liveSessions, { recursive: true });
    const bakFiles = await readdir(bakSessions);
    let copied = 0;
    for (const f of bakFiles) {
      if (!f.endsWith(".md")) continue;
      const dst = join(liveSessions, f);
      if (!(await exists(dst))) {
        await cp(join(bakSessions, f), dst);
        copied++;
      }
    }
    if (copied > 0) console.log(`  migrated ${copied} session files from construct.bak`);
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

// Detect linked mode — skip sync if ~/.claude/construct is a symlink
const constructDst = join(DST, "construct");
const linked = (() => {
  try { return lstatSync(constructDst).isSymbolicLink(); } catch { return false; }
})();

if (linked) {
  console.log("linked mode — skipping backup/sync/restore (source is live)");
  // Migrate data from construct.bak if the live DB is empty
  await migrateDataFromBackup();
} else {
  // 1. Back up preserved files to temp dir
  console.log("backing up preserved files...");
}
const backupDir = await mkdtemp(join(tmpdir(), "construct-backup-"));

try {
  if (!linked) {
    for (const rel of PRESERVE) {
      const src = join(DST, "construct", rel);
      if (await exists(src)) {
        const dst = join(backupDir, rel);
        await mkdir(dirname(dst), { recursive: true });
        await cp(src, dst, { recursive: true });
      }
    }

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

    // 2. Sync construct/ tree (delete stale files, overwrite everything)
    // 2a. Back up DB before sync
    console.log("backing up database...");
    await backupDb();

    //    DB files (*.db, *.db-wal, *.db-shm) are never overwritten
    console.log("syncing construct/...");
    await syncDir(CONSTRUCT_SRC, join(DST, "construct"));

    // 3. Restore preserved files from temp dir
    console.log("restoring preserved files...");

    for (const rel of PRESERVE) {
      const backup = join(backupDir, rel);
      if (await exists(backup)) {
        const target = join(DST, "construct", rel);
        await mkdir(dirname(target), { recursive: true });
        await rm(target, { recursive: true, force: true });
        await cp(backup, target, { recursive: true });
      }
    }

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
  }

  // 4. Sync commands — install from repo, remove stale Construct-owned commands
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
  console.log(`  installed: ${repoCommands.size ? [...repoCommands].join(" ") : "none"}`);

  // Remove known Construct commands that are no longer in the repo
  const CONSTRUCT_COMMANDS = ["construct.md", "verify.md", "install.md", "test.md",
    "worktree.md", "grasp.md", "status.md", "retain.md", "common-ground.md", "dashboard.md",
    "goal.md", "todo.md", "finish.md"];
  for (const f of CONSTRUCT_COMMANDS) {
    if (!repoCommands.has(f) && await exists(join(DST, "commands", f))) {
      await rm(join(DST, "commands", f));
      console.log(`  removed stale: ${f}`);
    }
  }

  // 5. Merge settings.json — replace hooks + statusLine, preserve everything else
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

  // 6. Update CLAUDE.md — replace # Construct section, preserve content before AND after
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

  // 7. Verify critical files — byte-size check on key infrastructure (skip in linked mode)
  if (!linked) {
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
  }

  // 8. Write build hash — git rev + dirty flag for version verification
  console.log("writing build hash...");
  try {
    const rev = (await Bun.$`git -C ${REPO} rev-parse --short HEAD`.text()).trim();
    const dirty = (await Bun.$`git -C ${REPO} diff --quiet HEAD`.exitCode) !== 0;
    const hash = `${rev}${dirty ? "-dirty" : ""}`;
    await writeFile(join(DST, "construct", ".build-hash"), hash + "\n");
    console.log(`  build: ${hash}`);
  } catch {
    console.log("  skipped (not a git repo)");
  }

  console.log();
  console.log("done. run /verify to check installation.");
} finally {
  await rm(backupDir, { recursive: true, force: true });
}
