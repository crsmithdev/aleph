#!/usr/bin/env bun

import { readdir, mkdir, cp, rm, stat, readFile, writeFile } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { existsSync } from "node:fs";

// Construct installer — deploys from repo to ~/.claude
// Source: construct/ (modules), dotclaude/ (CLAUDE.md, settings.json, commands)
// Preserves: ALL CAPS files in identity/, sessions/, ratings.jsonl
// Overwrites: hooks, skills, meta, dev, commands, settings, CLAUDE.md

const REPO = dirname(resolve(Bun.argv[1]));
const CONSTRUCT_SRC = join(REPO, "construct");
const TEMPLATES = join(REPO, "dotclaude");
const DST = join(Bun.env.HOME!, ".claude");

const INFRA_FILES = new Set(["README.md", "INSTALL.md"]);

// Static preserved paths (relative to construct/)
const PRESERVE = [
  "memory/signals/ratings.jsonl",
  "memory/sessions",
];

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
  async function walk(dir: string, rel: string) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        srcPaths.add(relPath);
        await walk(join(dir, e.name), relPath);
      } else {
        srcPaths.add(relPath);
      }
    }
  }
  await walk(srcDir, "");

  // Copy all from src to dst
  await cp(srcDir, dstDir, { recursive: true, force: true });

  // Delete files in dst not in src
  async function cleanDst(dir: string, rel: string) {
    if (!(await exists(dir))) return;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (!srcPaths.has(relPath)) {
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

// 1. Back up preserved files to temp dir
console.log("backing up preserved files...");
const backupDir = await mkdtemp(join(tmpdir(), "construct-backup-"));

try {
  for (const rel of PRESERVE) {
    const src = join(DST, "construct", rel);
    if (await exists(src)) {
      const dst = join(backupDir, rel);
      await mkdir(dirname(dst), { recursive: true });
      await cp(src, dst, { recursive: true });
    }
  }

  // Back up ALL CAPS .md files from identity/
  await mkdir(join(backupDir, "core/identity"), { recursive: true });

  for (const f of await discoverAllCapsMd(join(DST, "construct/core/identity"))) {
    await cp(join(DST, "construct/core/identity", f), join(backupDir, "core/identity", f));
    console.log(`  preserved: core/identity/${f}`);
  }

  // 2. Sync construct/ tree (delete stale files, overwrite everything)
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
  const backupIdentity = join(backupDir, "core/identity");
  if (await exists(backupIdentity)) {
    for (const f of await readdir(backupIdentity)) {
      if (f.endsWith(".md")) {
        await cp(join(backupIdentity, f), join(DST, "construct/core/identity", f));
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
    "worktree.md", "grasp.md", "status.md", "retain.md", "common-ground.md", "dashboard.md"];
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
      return obj.replace(/^(bun|bash) construct\//, `$1 ${home}/.claude/construct/`);
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
  const constructSection = await readFile(join(TEMPLATES, "CLAUDE.md"), "utf-8");
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

      const before = lines.slice(0, startIdx).join("\n");
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

  console.log();
  console.log("done. run /verify to check installation.");
} finally {
  await rm(backupDir, { recursive: true, force: true });
}
