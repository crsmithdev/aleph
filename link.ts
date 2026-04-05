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
 * Systemd notes:
 *   - bun --watch (the serve script) picks up file changes within the linked directory
 *     automatically with no service action needed.
 *   - Switching the symlink target requires a service restart so the server re-evaluates
 *     isLinked() and loads the correct mode (Vite middleware vs static assets).
 *   - `systemctl reload` sends SIGHUP; bun exits on SIGHUP and systemd auto-restarts it
 *     (Restart=on-failure), so `reload` effectively equals `restart` here. We use restart
 *     directly for clarity.
 */

import { lstatSync, readlinkSync } from "fs";
import { rename, symlink, unlink, readdir, mkdir, cp, rm, readFile, writeFile } from "fs/promises";
import { resolve, join, dirname } from "path";
import { homedir } from "os";

const HOME = homedir();
const CLAUDE_DIR = resolve(HOME, ".claude");
const CONSTRUCT_LINK = join(CLAUDE_DIR, "construct");
const REPO_SRC = resolve(dirname(Bun.argv[1] || "."), "src");
const STATE_FILE = resolve(HOME, ".construct", "link-state.json");
const DST = CLAUDE_DIR;
const CONSTRUCT_SRC = REPO_SRC;

// ── 3-word ID ─────────────────────────────────────────────────────────────────

const ADJECTIVES = [
  "amber", "azure", "bold", "bright", "calm", "cedar", "clear", "cool", "crisp",
  "dawn", "deep", "dense", "distant", "drifting", "dusky", "early", "ember", "faint",
  "firm", "fleet", "flowing", "foggy", "forest", "frozen", "gentle", "golden", "grand",
  "green", "grey", "hollow", "humid", "hushed", "idle", "indigo", "jade", "keen",
  "lofty", "lunar", "marble", "mellow", "misty", "modular", "mossy", "muted", "narrow",
  "night", "noble", "quiet", "rapid", "rocky", "rolling", "rustic", "sandy", "sharp",
  "silent", "silver", "sleek", "slow", "smooth", "solar", "sparse", "steady", "steep",
  "still", "stone", "stormy", "swift", "tidal", "timber", "tranquil", "vast", "velvet",
  "vivid", "wandering", "warm", "wild", "winding", "winter", "wooden",
];

const NOUNS = [
  "anchor", "arch", "basin", "beacon", "birch", "brook", "canyon", "cedar", "cliff",
  "cloud", "cove", "creek", "crest", "dawn", "delta", "dune", "elm", "fern", "field",
  "fjord", "flame", "flint", "fog", "forest", "frost", "garden", "glade", "gorge",
  "grove", "harbor", "heath", "hill", "horizon", "island", "lake", "lantern", "laurel",
  "leaf", "ledge", "marsh", "meadow", "mesa", "mist", "moon", "moss", "mountain",
  "oak", "ocean", "peak", "pine", "plain", "pond", "reef", "ridge", "river", "rock",
  "root", "sand", "shore", "slope", "snow", "spring", "stone", "stream", "summit",
  "tide", "timber", "trail", "tree", "turtle", "valley", "vine", "wave", "willow",
  "wind", "wood",
];

function threeWordId(): string {
  const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];
  return `${pick(ADJECTIVES)}-${pick(ADJECTIVES)}-${pick(NOUNS)}`;
}

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

// ── Config sync (commands, agents, settings.json, CLAUDE.md) ─────────────────

async function exists(p: string): Promise<boolean> {
  try { await import("fs/promises").then(m => m.access(p)); return true; } catch { return false; }
}

async function syncConfig(): Promise<void> {
  console.log("syncing commands...");
  await mkdir(join(DST, "commands"), { recursive: true });
  const cmdDir = join(CONSTRUCT_SRC, "commands");
  const repoCommands = new Set<string>();
  if (await exists(cmdDir)) {
    for (const f of await readdir(cmdDir)) {
      if (f.endsWith(".md")) {
        await cp(join(cmdDir, f), join(DST, "commands", f));
        repoCommands.add(f);
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
        if (!repoCommands.has(cmdName)) {
          await cp(skillFile, join(DST, "commands", cmdName));
          repoCommands.add(cmdName);
        }
      }
    }
  }
  console.log(`  installed: ${repoCommands.size ? [...repoCommands].join(" ") : "none"}`);
  const manifestPath = join(DST, "commands", ".construct-managed");
  const previouslyManaged = new Set<string>();
  if (await exists(manifestPath)) {
    for (const line of (await readFile(manifestPath, "utf-8")).split("\n")) {
      const t = line.trim(); if (t) previouslyManaged.add(t);
    }
  }
  for (const f of previouslyManaged) {
    if (!repoCommands.has(f) && await exists(join(DST, "commands", f))) {
      await rm(join(DST, "commands", f));
      console.log(`  removed stale: ${f}`);
    }
  }
  await writeFile(manifestPath, [...repoCommands].sort().join("\n") + "\n");

  console.log("syncing agents...");
  await mkdir(join(DST, "agents"), { recursive: true });
  const agentSrcDir = join(CONSTRUCT_SRC, "agents");
  const repoAgents = new Set<string>();
  if (await exists(agentSrcDir)) {
    for (const f of await readdir(agentSrcDir)) {
      if (f.endsWith(".md")) {
        await cp(join(agentSrcDir, f), join(DST, "agents", f)); repoAgents.add(f);
      }
    }
  }
  const agentManifest = join(DST, "agents", ".construct-managed");
  const prevAgents = new Set<string>();
  if (await exists(agentManifest)) {
    for (const line of (await readFile(agentManifest, "utf-8")).split("\n")) {
      const t = line.trim(); if (t) prevAgents.add(t);
    }
  }
  for (const f of prevAgents) {
    if (!repoAgents.has(f) && await exists(join(DST, "agents", f))) {
      await rm(join(DST, "agents", f));
    }
  }
  await writeFile(agentManifest, [...repoAgents].sort().join("\n") + "\n");
  console.log(`  installed agents: ${repoAgents.size ? [...repoAgents].join(" ") : "none"}`);

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
  const id = threeWordId();
  const backupPath = `${CONSTRUCT_LINK}-${id}`;

  if (mode === "installed") {
    console.log(`moving current install → ${backupPath}`);
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
