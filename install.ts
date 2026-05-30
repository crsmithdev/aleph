#!/usr/bin/env bun

import { readdir, mkdir, cp, rm, stat, lstat, readFile, writeFile } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { existsSync } from "node:fs";

// Aleph installer — deploys from repo src/ to ~/.claude/aleph/
// Preserves: ALL CAPS .md files in identity/ and memory/; DB files
// User data: ~/.aleph/ (DB, sessions, signals) — never touched

const REPO = dirname(resolve(Bun.argv[1]));
const ALEPH_SRC = join(REPO, "src");
const DST = join(Bun.env.HOME!, ".claude");
const DATA_DIR = join(Bun.env.HOME!, ".aleph");
const OLD_CONSTRUCT_DATA = join(Bun.env.HOME!, ".construct");
const BACKUP_DIR = join(DATA_DIR, "backups");
const MAX_BACKUPS = 5;
const INFRA_FILES = new Set(["README.md", "INSTALL.md"]);
const SKIP_EXTENSIONS = [".db", ".db-wal", ".db-shm"];
const SKIP_DIRS = new Set(["node_modules", ".bun", "backups"]);

function step(label: string, value: string) {
  console.log(`  ${label.padEnd(10)} ${value}`);
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch { return false; }
}

async function backupDb(): Promise<string | null> {
  const dbPath = join(DATA_DIR, "aleph.db");
  if (!await exists(dbPath)) return null;
  await mkdir(BACKUP_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const name = `aleph-${ts}.db`;
  await cp(dbPath, join(BACKUP_DIR, name));
  const walPath = dbPath + "-wal";
  if (await exists(walPath)) await cp(walPath, join(BACKUP_DIR, name + "-wal"));
  // Prune: keep last MAX_BACKUPS
  const files = (await readdir(BACKUP_DIR))
    .filter(f => f.startsWith("aleph-") && f.endsWith(".db"))
    .sort().reverse();
  for (const f of files.slice(MAX_BACKUPS)) {
    const stem = f.replace(/\.db$/, "");
    await rm(join(BACKUP_DIR, f), { force: true });
    await rm(join(BACKUP_DIR, stem + ".db-wal"), { force: true });
    await rm(join(BACKUP_DIR, stem + ".db-shm"), { force: true });
  }
  return name;
}

// Migrate ~/.construct → ~/.aleph on first run after rename. Non-destructive:
// copies entries that don't already exist in ~/.aleph, renames construct.db → aleph.db.
// Leaves ~/.construct intact for the user to remove once they verify.
async function migrateConstructToAleph(): Promise<number> {
  if (!await exists(OLD_CONSTRUCT_DATA)) return 0;
  let count = 0;
  for (const entry of await readdir(OLD_CONSTRUCT_DATA, { withFileTypes: true })) {
    const from = join(OLD_CONSTRUCT_DATA, entry.name);
    const renameDb = entry.name === "construct.db";
    const targetName = renameDb ? "aleph.db" : entry.name;
    const to = join(DATA_DIR, targetName);
    if (entry.isDirectory()) {
      if (await exists(to) && (await readdir(to)).length > 0) continue;
    } else if (await exists(to)) {
      continue;
    }
    await mkdir(dirname(to), { recursive: true });
    await cp(from, to, { recursive: entry.isDirectory() });
    if (renameDb) {
      for (const ext of ["-wal", "-shm"]) {
        if (await exists(from + ext)) await cp(from + ext, to + ext);
      }
    }
    count++;
  }
  return count;
}

async function discoverAllCapsMd(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  return (await readdir(dir)).filter(f => {
    if (!f.endsWith(".md") || INFRA_FILES.has(f)) return false;
    return /^[A-Z_]+$/.test(f.slice(0, -3));
  });
}

async function syncDir(srcDir: string, dstDir: string): Promise<void> {
  await mkdir(dstDir, { recursive: true });
  const srcPaths = new Set<string>();
  async function walk(dir: string, rel: string) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
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
  await cp(srcDir, dstDir, {
    recursive: true, force: true,
    filter: (src) => {
      const base = src.split("/").pop()!;
      return !SKIP_DIRS.has(base) && !SKIP_EXTENSIONS.some(ext => base.endsWith(ext));
    },
  });
  async function cleanDst(dir: string, rel: string) {
    if (!await exists(dir)) return;
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (!srcPaths.has(relPath) && !SKIP_DIRS.has(e.name) && !SKIP_EXTENSIONS.some(ext => e.name.endsWith(ext))) {
        await rm(join(dir, e.name), { recursive: true, force: true });
      } else if (e.isDirectory()) {
        await cleanDst(join(dir, e.name), relPath);
      }
    }
  }
  await cleanDst(dstDir, "");
}

async function syncConfig(): Promise<{ commands: number; removedCommands: number; agents: number }> {
  const installed = new Set<string>();
  await mkdir(join(DST, "commands"), { recursive: true });

  // Commands from src/commands/
  const cmdDir = join(ALEPH_SRC, "commands");
  if (await exists(cmdDir)) {
    for (const f of await readdir(cmdDir)) {
      if (!f.endsWith(".md")) continue;
      await rm(join(DST, "commands", f), { force: true });
      await cp(join(cmdDir, f), join(DST, "commands", f));
      installed.add(f);
    }
  }
  // Skills → commands
  const skillsDir = join(ALEPH_SRC, "skills");
  if (await exists(skillsDir)) {
    for (const d of await readdir(skillsDir, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const skillFile = join(skillsDir, d.name, "SKILL.md");
      const cmdName = `${d.name}.md`;
      if (await exists(skillFile) && !installed.has(cmdName)) {
        await rm(join(DST, "commands", cmdName), { force: true });
        await cp(skillFile, join(DST, "commands", cmdName));
        installed.add(cmdName);
      }
    }
  }
  // Agents
  await mkdir(join(DST, "agents"), { recursive: true });
  const installedAgents = new Set<string>();
  const agentSrcDir = join(ALEPH_SRC, "agents");
  if (await exists(agentSrcDir)) {
    for (const f of await readdir(agentSrcDir)) {
      if (!f.endsWith(".md")) continue;
      await rm(join(DST, "agents", f), { force: true });
      await cp(join(agentSrcDir, f), join(DST, "agents", f));
      installedAgents.add(f);
    }
  }

  // Prune orphans from prior install (manifest-based) + legacy symlinks.
  const manifestPath = join(DST, ".aleph-manifest.json");
  let prior: { commands?: string[]; agents?: string[] } = {};
  try { prior = JSON.parse(await readFile(manifestPath, "utf-8")); } catch { /* first run */ }
  // Pick up the older manifest filename too so prior construct installs prune cleanly.
  if (Object.keys(prior).length === 0) {
    try { prior = JSON.parse(await readFile(join(DST, ".construct-manifest.json"), "utf-8")); } catch { /* ignore */ }
  }

  let removed = 0;
  for (const f of prior.commands ?? []) {
    if (!installed.has(f) && await exists(join(DST, "commands", f))) {
      await rm(join(DST, "commands", f), { force: true });
      removed++;
    }
  }
  for (const f of prior.agents ?? []) {
    if (!installedAgents.has(f) && await exists(join(DST, "agents", f))) {
      await rm(join(DST, "agents", f), { force: true });
    }
  }
  for (const sub of ["commands", "agents"] as const) {
    const set = sub === "commands" ? installed : installedAgents;
    for (const f of await readdir(join(DST, sub))) {
      if (set.has(f)) continue;
      const p = join(DST, sub, f);
      try {
        const s = await lstat(p);
        if (s.isSymbolicLink()) {
          const target = await import("fs/promises").then(m => m.readlink(p));
          if (target.startsWith(ALEPH_SRC)) { await rm(p); if (sub === "commands") removed++; }
        }
      } catch { /* ignore */ }
    }
  }

  await writeFile(manifestPath, JSON.stringify({
    commands: [...installed].sort(),
    agents: [...installedAgents].sort(),
  }, null, 2));

  // settings.json — replace hooks + statusLine, preserve everything else
  const repoSettings = JSON.parse(await readFile(join(ALEPH_SRC, "core/hooks/settings-hooks.json"), "utf-8"));
  const home = Bun.env.HOME!;
  function fixPaths(obj: any): any {
    if (typeof obj === "string") return obj.replace(/^(bun|bash) src\//, `$1 ${home}/.claude/aleph/`);
    if (Array.isArray(obj)) return obj.map(fixPaths);
    if (obj && typeof obj === "object") {
      const out: any = {};
      for (const [k, v] of Object.entries(obj)) out[k] = fixPaths(v);
      return out;
    }
    return obj;
  }
  const dstSettingsPath = join(DST, "settings.json");
  if (await exists(dstSettingsPath)) {
    const existing = JSON.parse(await readFile(dstSettingsPath, "utf-8"));
    await writeFile(dstSettingsPath, JSON.stringify({ ...existing, hooks: fixPaths(repoSettings).hooks, statusLine: fixPaths(repoSettings).statusLine }, null, 2) + "\n");
  } else {
    await writeFile(dstSettingsPath, JSON.stringify(fixPaths(repoSettings), null, 2) + "\n");
  }

  // CLAUDE.md — ensure @aleph/core/CLAUDE.md import. Matches the old
  // "# Construct" section too so existing installs upgrade in place.
  const alephImport = "# Aleph\n\n@aleph/core/CLAUDE.md\n";
  const dstClaudeMd = join(DST, "CLAUDE.md");
  if (await exists(dstClaudeMd)) {
    const content = await readFile(dstClaudeMd, "utf-8");
    const lines = content.split("\n");
    const startIdx = lines.findIndex(l => /^# (Aleph|Construct)\s*$/.test(l));
    if (startIdx !== -1) {
      let endIdx = lines.length;
      for (let i = startIdx + 1; i < lines.length; i++) {
        if (/^# [^\s#]/.test(lines[i]) || /^# $/.test(lines[i])) { endIdx = i; break; }
      }
      const before = lines.slice(0, startIdx).join("\n").replace(/<!--\s*SOURCE FILE[^>]*?-->\s*/g, "");
      const after = lines.slice(endIdx).join("\n");
      let result = before.trim() ? before.replace(/\n+$/, "") + "\n\n" : "";
      result += alephImport;
      if (after.trim()) result += "\n" + after.replace(/^\n+/, "");
      await writeFile(dstClaudeMd, result);
    } else {
      await writeFile(dstClaudeMd, content.replace(/\n+$/, "") + "\n\n" + alephImport);
    }
  } else {
    await writeFile(dstClaudeMd, alephImport);
  }

  return { commands: installed.size, removedCommands: removed, agents: installedAgents.size };
}

// ── Main ───────────────────────────────────────────────────────────────────────

const t0 = Date.now();
console.log("Aleph installer\n");

await mkdir(DATA_DIR, { recursive: true });
await mkdir(join(DATA_DIR, "sessions"), { recursive: true });
await mkdir(join(DATA_DIR, "signals"), { recursive: true });
await mkdir(join(DATA_DIR, "backups"), { recursive: true });
await mkdir(join(DATA_DIR, "memory"), { recursive: true });
await mkdir(join(DATA_DIR, "identity"), { recursive: true });

const backupDir = await mkdtemp(join(tmpdir(), "aleph-backup-"));

try {
  // 1. Migrate ~/.construct → ~/.aleph (non-destructive; leaves original)
  const migrated = await migrateConstructToAleph();
  step("migrate", migrated > 0 ? `${migrated} item${migrated !== 1 ? "s" : ""} from ~/.construct` : "nothing to migrate");

  // 2. Back up preserved ALL CAPS files (memory only — identity files come from src)
  await mkdir(join(backupDir, "memory"), { recursive: true });
  let preserved = 0;
  for (const f of await discoverAllCapsMd(join(DST, "aleph/memory"))) {
    await cp(join(DST, "aleph/memory", f), join(backupDir, "memory", f));
    preserved++;
  }

  // 3. Back up DB
  const backupName = await backupDb();
  step("backup", backupName ?? "no DB yet");
  if (preserved > 0) step("preserve", `${preserved} file${preserved !== 1 ? "s" : ""}`);

  // 4. Stop services (both old construct-* and new aleph-* names)
  await Bun.$`systemctl --user stop aleph-ui 2>/dev/null`.quiet().nothrow();
  await Bun.$`systemctl --user stop construct-ui 2>/dev/null`.quiet().nothrow();

  // 5. Build UI from source (workspace packages resolve correctly from src/)
  const uiSrcWebDir = join(ALEPH_SRC, "ui", "web");
  if (await exists(join(ALEPH_SRC, "ui", "package.json"))) {
    const buildStart = Date.now();
    await Bun.$`cd ${uiSrcWebDir} && npm run build`.quiet();
    step("build", `${((Date.now() - buildStart) / 1000).toFixed(1)}s`);
  }

  // 6. Sync src/ to ~/.claude/aleph/ (remove symlink if present from old link mode)
  const alephDst = join(DST, "aleph");
  try {
    if ((await lstat(alephDst)).isSymbolicLink()) await rm(alephDst);
  } catch { /* doesn't exist */ }
  await syncDir(ALEPH_SRC, alephDst);
  step("sync", "done");

  // 7. Install all dependencies for the installed aleph tree.
  // Create a workspace root at aleph/ mirroring the source monorepo structure,
  // so bun resolves @aleph/* workspace deps and all transitive npm deps correctly.
  const uiDir = join(alephDst, "ui");
  if (await exists(join(uiDir, "package.json"))) {
    await writeFile(join(alephDst, "package.json"), JSON.stringify({
      private: true,
      workspaces: ["data", "eval", "goals", "logger", "research", "telemetry", "ui", "ui/api", "ui/web"],
    }, null, 2) + "\n");
    for (const rel of ["node_modules", "ui/node_modules", "ui/api/node_modules", "ui/web/node_modules",
                        "data/node_modules", "eval/node_modules", "goals/node_modules", "logger/node_modules", "research/node_modules", "telemetry/node_modules"]) {
      await rm(join(alephDst, rel), { recursive: true, force: true });
    }
    await Bun.$`cd ${alephDst} && bun install`.quiet().nothrow();
  }

  // 8. Research dependencies
  const researchDir = join(alephDst, "research");
  if (await exists(join(researchDir, "package.json"))) {
    const dataDir = join(alephDst, "data");
    if (await exists(join(dataDir, "package.json"))) {
      await rm(join(dataDir, "node_modules"), { recursive: true, force: true });
      await Bun.$`cd ${dataDir} && bun install`.quiet();
    }
    await rm(join(researchDir, "node_modules"), { recursive: true, force: true });
    await Bun.$`cd ${researchDir} && bun install`.quiet();
  }

  // 9. Restore preserved files
  for (const [subdir, target] of [
    ["memory", join(DST, "aleph/memory")],
  ] as const) {
    const backupSub = join(backupDir, subdir);
    if (!await exists(backupSub)) continue;
    for (const f of await readdir(backupSub)) {
      if (!f.endsWith(".md")) continue;
      await cp(join(backupSub, f), join(target, f));
    }
  }

  // 10. Sync commands, agents, settings, CLAUDE.md
  const cfg = await syncConfig();
  const removedStr = cfg.removedCommands > 0 ? `, ${cfg.removedCommands} removed` : "";
  step("commands", `${cfg.commands} installed${removedStr}`);
  step("agents", `${cfg.agents} installed`);

  // 11. Write build manifest
  try {
    const rev = (await Bun.$`git -C ${REPO} rev-parse --short HEAD`.text()).trim();
    const fullRev = (await Bun.$`git -C ${REPO} rev-parse HEAD`.text()).trim();
    const dirty = (await Bun.$`git -C ${REPO} diff --quiet HEAD`.exitCode) !== 0;
    const branch = (await Bun.$`git -C ${REPO} rev-parse --abbrev-ref HEAD`.text()).trim();
    const commitCount = (await Bun.$`git -C ${REPO} rev-list --count HEAD`.text()).trim();
    const lastCommitMsg = (await Bun.$`git -C ${REPO} log -1 --format=%s`.text()).trim();
    const lastCommitDate = (await Bun.$`git -C ${REPO} log -1 --format=%ci`.text()).trim();
    let sinceTag = "n/a";
    try {
      const lastTag = (await Bun.$`git -C ${REPO} describe --tags --abbrev=0 2>/dev/null`.text()).trim();
      if (lastTag) sinceTag = `${(await Bun.$`git -C ${REPO} rev-list ${lastTag}..HEAD --count`.text()).trim()} (since ${lastTag})`;
    } catch { /* no tags */ }
    const dbPath = join(DATA_DIR, "aleph.db");
    const dbSize = await exists(dbPath) ? (await stat(dbPath)).size : 0;
    const sessionCount = await exists(join(DATA_DIR, "sessions"))
      ? (await readdir(join(DATA_DIR, "sessions"))).filter(f => f.endsWith(".md")).length : 0;
    await writeFile(join(DST, "aleph", ".manifest"), [
      `# Aleph Build Manifest`,
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
      `data_root = ${DATA_DIR}`,
      `aleph = ${join(DST, "aleph")}`,
      `commands = ${join(DST, "commands")}`,
      `skills = ${join(DST, "aleph", "skills")}`,
      `db = ${dbPath}`,
      `memory_db = ${join(DATA_DIR, "memory", "sqlite_vec.db")}`,
      `sessions = ${join(DATA_DIR, "sessions")}`,
      `events = ${join(DATA_DIR, "signals", "events.jsonl")}`,
      `backups = ${join(DATA_DIR, "backups")}`,
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
    ].join("\n"));
  } catch (e) {
    step("manifest", `failed: ${(e as Error).message?.slice(0, 60) ?? "unknown"}`);
  }

  // 12. Write env file + systemd services
  const serviceDir = join(Bun.env.HOME!, ".config/systemd/user");
  await mkdir(serviceDir, { recursive: true });

  // Write API keys to env file (keeps them out of .service files)
  const envFilePath = join(DATA_DIR, ".env");
  const envLines: string[] = [];
  for (const key of ["ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "TAVILY_API_KEY", "BRAVE_SEARCH_API_KEY", "JINA_API_KEY"]) {
    if (Bun.env[key]) envLines.push(`${key}=${Bun.env[key]}`);
  }
  if (envLines.length > 0) {
    await writeFile(envFilePath, envLines.join("\n") + "\n");
    await Bun.$`chmod 600 ${envFilePath}`.quiet();
  }

  await writeFile(join(serviceDir, "aleph-ui.service"), [
    "[Unit]",
    "Description=Aleph UI (API + Web)",
    "After=network.target",
    "",
    "[Service]",
    "Type=simple",
    "WorkingDirectory=%h/.claude/aleph/ui",
    "Environment=PATH=%h/.bun/bin:/usr/local/bin:/usr/bin:/bin",
    "Environment=NODE_ENV=production",
    "EnvironmentFile=%h/.aleph/.env",
    "ExecStart=%h/.bun/bin/bun run serve",
    "Restart=on-failure",
    "RestartSec=5",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n"));
  await writeFile(join(serviceDir, "aleph-research-worker.service"), [
    "[Unit]",
    "Description=Aleph Research Worker",
    "After=network.target",
    "",
    "[Service]",
    "Type=simple",
    "WorkingDirectory=%h/.claude/aleph/research",
    "Environment=PATH=%h/.bun/bin:/usr/local/bin:/usr/bin:/bin",
    "Environment=NODE_ENV=production",
    "EnvironmentFile=%h/.aleph/.env",
    "ExecStart=%h/.bun/bin/bun src/worker.ts",
    "Restart=on-failure",
    "RestartSec=10",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n"));
  await Bun.$`systemctl --user daemon-reload`.quiet().nothrow();
  await Bun.$`systemctl --user restart aleph-ui`.quiet().nothrow();
  await Bun.$`systemctl --user restart aleph-research-worker`.quiet().nothrow();
  step("service", "restarted → http://localhost:3000");

  // 13. Verify DB
  const dbVerifyPath = join(DATA_DIR, "aleph.db");
  if (await exists(dbVerifyPath)) {
    try {
      const { Database } = await import("bun:sqlite");
      const db = new Database(dbVerifyPath);
      db.exec("PRAGMA journal_mode=WAL");
      const { applyDDL } = await import(join(DST, "aleph/goals/src/ddl.ts"));
      applyDDL(db);
      const tables = ["goals", "categories", "notes", "todos", "habits", "habit_completions", "history_logs", "goal_categories"];
      for (const t of tables) db.prepare(`SELECT count(*) FROM ${t}`).get();
      db.close();
      step("verify", "✓ DB healthy");
    } catch (e) {
      step("verify", `✗ ${(e as Error).message?.slice(0, 60)}`);
    }
  } else {
    step("verify", "⚠ no DB (created on first start)");
  }

  // Summary
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  try {
    const rev = (await Bun.$`git -C ${REPO} rev-parse --short HEAD`.text()).trim();
    const dirty = (await Bun.$`git -C ${REPO} diff --quiet HEAD`.exitCode) !== 0;
    const branch = (await Bun.$`git -C ${REPO} rev-parse --abbrev-ref HEAD`.text()).trim();
    console.log(`\n  ${rev}${dirty ? "-dirty" : ""} · ${branch} · done in ${elapsed}s`);
  } catch {
    console.log(`\n  done in ${elapsed}s`);
  }

} finally {
  await rm(backupDir, { recursive: true, force: true });
}
