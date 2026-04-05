#!/usr/bin/env bun
/**
 * link.ts — toggle ~/.claude/construct between a live pointer (symlink to this repo's src/)
 * and its previous real-directory state.
 *
 * States:
 *   linked-on   ~/.claude/construct → ~/construct/src/  (this repo)
 *   linked-off  ~/.claude/construct → ~/.claude/construct-<id>  (backed-up original)
 *   installed   ~/.claude/construct = real directory  (normal install)
 *
 * Transitions:
 *   installed   → linked-on   (backup real dir, create symlink, sync config, restart)
 *   linked-on   → linked-off  (retarget symlink to backup, restart)
 *   linked-off  → linked-on   (retarget symlink to repo src, restart)
 *
 * Commands/agents use per-file symlinks so user's own commands coexist.
 * File edits in src/ are picked up automatically by bun --watch (no restart needed).
 * Switching the symlink target requires a service restart to reload the new code.
 */

import { lstatSync, readlinkSync } from "fs";
import { rename, symlink, unlink, readdir, mkdir, readlink, rm, readFile, writeFile } from "fs/promises";
import { resolve, join, dirname } from "path";
import { homedir } from "os";

const HOME = homedir();
const CLAUDE_DIR = resolve(HOME, ".claude");
const CONSTRUCT_LINK = join(CLAUDE_DIR, "construct");
const REPO_SRC = resolve(dirname(Bun.argv[1] || "."), "src");
const STATE_FILE = resolve(HOME, ".construct", "link-state.json");
const DST = CLAUDE_DIR;
const CONSTRUCT_SRC = REPO_SRC;

// ── State ─────────────────────────────────────────────────────────────────────

interface LinkState {
  backup?: string;   // path of most recent backed-up construct dir
  checkout?: string; // path of repo src/ when linked
}

async function readState(): Promise<LinkState> {
  try { return JSON.parse(await readFile(STATE_FILE, "utf-8")); }
  catch { return {}; }
}

async function writeState(s: LinkState): Promise<void> {
  await mkdir(dirname(STATE_FILE), { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(s, null, 2) + "\n");
}

type Mode = "linked-on" | "linked-off" | "installed" | "unknown";

function currentMode(): Mode {
  try {
    const s = lstatSync(CONSTRUCT_LINK);
    if (!s.isSymbolicLink()) return "installed";
    const target = resolve(readlinkSync(CONSTRUCT_LINK));
    if (target === REPO_SRC) return "linked-on";
    return "linked-off";
  } catch { return "unknown"; }
}

// ── Config sync ───────────────────────────────────────────────────────────────

async function exists(p: string): Promise<boolean> {
  try { await import("fs/promises").then(m => m.access(p)); return true; } catch { return false; }
}

async function syncConfig(): Promise<void> {
  // Commands — per-file symlinks; user's own commands (real files) coexist safely
  console.log("syncing commands...");
  await mkdir(join(DST, "commands"), { recursive: true });
  const linked = new Set<string>();

  const cmdDir = join(CONSTRUCT_SRC, "commands");
  if (await exists(cmdDir)) {
    for (const f of await readdir(cmdDir)) {
      if (f.endsWith(".md")) {
        const dst = join(DST, "commands", f);
        if (await exists(dst)) await rm(dst);
        await symlink(join(cmdDir, f), dst);
        linked.add(f);
      }
    }
  }
  const skillsDir = join(CONSTRUCT_SRC, "skills");
  if (await exists(skillsDir)) {
    for (const d of await readdir(skillsDir, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const skillFile = join(skillsDir, d.name, "SKILL.md");
      if (await exists(skillFile)) {
        const cmdName = `${d.name}.md`;
        if (!linked.has(cmdName)) {
          const dst = join(DST, "commands", cmdName);
          if (await exists(dst)) await rm(dst);
          await symlink(skillFile, dst);
          linked.add(cmdName);
        }
      }
    }
  }
  // Remove stale: symlinks pointing into CONSTRUCT_SRC that are no longer present
  for (const f of await readdir(join(DST, "commands"))) {
    if (linked.has(f)) continue;
    const p = join(DST, "commands", f);
    try {
      const { lstat } = await import("fs/promises");
      const s = await lstat(p);
      if (s.isSymbolicLink()) {
        const target = await readlink(p);
        if (target.startsWith(CONSTRUCT_SRC)) { await rm(p); console.log(`  removed stale: ${f}`); }
      }
    } catch { /* ignore */ }
  }
  console.log(`  linked: ${linked.size ? [...linked].join(" ") : "none"}`);

  // Agents — same approach
  console.log("syncing agents...");
  await mkdir(join(DST, "agents"), { recursive: true });
  const linkedAgents = new Set<string>();
  const agentSrcDir = join(CONSTRUCT_SRC, "agents");
  if (await exists(agentSrcDir)) {
    for (const f of await readdir(agentSrcDir)) {
      if (f.endsWith(".md")) {
        const dst = join(DST, "agents", f);
        if (await exists(dst)) await rm(dst);
        await symlink(join(agentSrcDir, f), dst);
        linkedAgents.add(f);
      }
    }
  }
  for (const f of await readdir(join(DST, "agents"))) {
    if (linkedAgents.has(f)) continue;
    const p = join(DST, "agents", f);
    try {
      const { lstat } = await import("fs/promises");
      const s = await lstat(p);
      if (s.isSymbolicLink()) {
        const target = await readlink(p);
        if (target.startsWith(CONSTRUCT_SRC)) { await rm(p); }
      }
    } catch { /* ignore */ }
  }
  console.log(`  linked agents: ${linkedAgents.size ? [...linkedAgents].join(" ") : "none"}`);

  // settings.json — replace hooks + statusLine, preserve everything else
  console.log("merging settings.json...");
  const repoSettings = JSON.parse(await readFile(join(CONSTRUCT_SRC, "core/hooks/settings-hooks.json"), "utf-8"));
  function fixPaths(obj: any): any {
    if (typeof obj === "string") return obj.replace(/^(bun|bash) src\//, `$1 ${HOME}/.claude/construct/`);
    if (Array.isArray(obj)) return obj.map(fixPaths);
    if (obj && typeof obj === "object") { const o: any = {}; for (const [k,v] of Object.entries(obj)) o[k]=fixPaths(v); return o; }
    return obj;
  }
  const fixed = fixPaths(repoSettings);
  const dstSettings = join(DST, "settings.json");
  if (await exists(dstSettings)) {
    const existing = JSON.parse(await readFile(dstSettings, "utf-8"));
    await writeFile(dstSettings, JSON.stringify({ ...existing, hooks: fixed.hooks, statusLine: fixed.statusLine }, null, 2) + "\n");
  } else {
    await writeFile(dstSettings, JSON.stringify(fixed, null, 2) + "\n");
  }

  // CLAUDE.md — upsert # Construct section
  console.log("updating CLAUDE.md...");
  const constructImport = "# Construct\n\n@construct/core/CLAUDE.md\n";
  const dstMd = join(DST, "CLAUDE.md");
  if (await exists(dstMd)) {
    const content = await readFile(dstMd, "utf-8");
    const lines = content.split("\n");
    const si = lines.findIndex(l => /^# Construct\s*$/.test(l));
    if (si !== -1) {
      let ei = lines.length;
      for (let i = si + 1; i < lines.length; i++) {
        if (/^# [^\s#]/.test(lines[i]) || /^# $/.test(lines[i])) { ei = i; break; }
      }
      const before = lines.slice(0, si).join("\n").replace(/<!--\s*SOURCE FILE[^>]*?-->\s*/g, "");
      const after = lines.slice(ei).join("\n");
      let r = before.trim() ? before.replace(/\n+$/, "") + "\n\n" : "";
      r += constructImport;
      if (after.trim()) r += "\n" + after.replace(/^\n+/, "");
      await writeFile(dstMd, r);
    } else {
      await writeFile(dstMd, content.replace(/\n+$/, "") + "\n\n" + constructImport);
    }
  } else {
    await writeFile(dstMd, constructImport);
  }
}

async function restartService(): Promise<void> {
  console.log("restarting service...");
  await Bun.$`systemctl --user restart construct-ui`.quiet().nothrow();
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log("=== Construct Link ===");
console.log(`repo:  ${REPO_SRC}`);
console.log(`link:  ${CONSTRUCT_LINK}`);
console.log();

const mode = currentMode();
const state = await readState();

if (mode === "linked-on") {
  // Toggle off: retarget symlink to backup
  if (!state.backup || !await exists(state.backup)) {
    console.error(`no backup to toggle to (state.backup: ${state.backup ?? "unset"})`);
    console.error("run 'bun install.ts' to restore an installed copy");
    process.exit(1);
  }
  await unlink(CONSTRUCT_LINK);
  await symlink(state.backup, CONSTRUCT_LINK);
  console.log(`linked off`);
  console.log(`  ~/.claude/construct → ${state.backup}`);
  await restartService();

} else if (mode === "linked-off") {
  // Toggle on: retarget symlink back to repo
  await unlink(CONSTRUCT_LINK);
  await symlink(REPO_SRC, CONSTRUCT_LINK);
  console.log(`linked on`);
  console.log(`  ~/.claude/construct → ${REPO_SRC}`);
  await restartService();

} else {
  // Installed (real dir) or unknown: backup and create symlink
  const backupPath = `${CONSTRUCT_LINK}-installed`;

  if (mode === "installed") {
    console.log(`moving current install → ${backupPath}`);
    await rm(backupPath, { recursive: true, force: true });
    await rename(CONSTRUCT_LINK, backupPath);
  } else {
    // Unknown: dangling or missing — just remove whatever is there
    await rm(CONSTRUCT_LINK, { recursive: true, force: true });
  }

  await symlink(REPO_SRC, CONSTRUCT_LINK);
  await writeState({ backup: mode === "installed" ? backupPath : state.backup, checkout: REPO_SRC });

  console.log(`linked on`);
  console.log(`  ~/.claude/construct → ${REPO_SRC}`);
  if (mode === "installed") console.log(`  backup: ${backupPath}`);

  await syncConfig();
  await restartService();
}

console.log();
console.log("done.");
console.log("  file changes in src/ are picked up automatically by bun --watch (no restart needed).");
console.log("  run 'bun link.ts' again to toggle off, or 'bun install.ts' to restore copy mode.");

await printSymlinks();

async function printSymlinks(): Promise<void> {
  console.log("\n=== Symlinks ===");
  const result = await Bun.$`find ${CLAUDE_DIR}/construct ${CLAUDE_DIR}/commands -maxdepth 1 -type l -printf "%p -> %l\n" 2>/dev/null`.text();
  console.log(result.trim() || "(none)");
}
