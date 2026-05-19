#!/usr/bin/env bun
/**
 * Build Construct as a Claude Code plugin.
 *
 * Emits a loadable plugin tree under dist/plugin/. Test locally with
 *   claude --plugin-dir ./dist/plugin
 *
 * Phase 2 (this script) covers the structural transformation:
 *   - .claude-plugin/plugin.json manifest
 *   - skills/, agents/, commands/ — copied from src/ (skills become /construct:<name>)
 *   - hooks/hooks.json — generated from src/core/hooks/settings-hooks.json with
 *     bun src/... rewritten to bun ${CLAUDE_PLUGIN_ROOT}/...
 *   - .mcp.json — goal-tracker MCP server entry
 *   - Internal modules (core/, data/, logger/, telemetry/, eval/, goals/, memory/,
 *     research/, rules/, trace.ts, hook-report.ts, status.ts) — bundled
 *
 * Out of scope here, deferred to follow-up commits:
 *   - SessionStart hook injecting identity layer (problem B)
 *   - bun install of workspace deps into ${CLAUDE_PLUGIN_DATA} (problem C)
 *   - Router emitting namespaced skill names (problem A)
 *   - src/ui/ — does not ship in the plugin (decision #2)
 */

import { mkdir, rm, cp, readFile, writeFile, readdir, stat } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";

const REPO = dirname(resolve(Bun.argv[1]));
const SRC = join(REPO, "src");
const OUT = join(REPO, "dist", "plugin");

const SKIP_DIRS = new Set(["node_modules", ".bun", "__tests__", "tests", "e2e", "tmp", ".worktrees"]);
const SKIP_EXTS = [".db", ".db-wal", ".db-shm", ".tsbuildinfo"];

const PLUGIN_NAME = "construct";

async function exists(p: string): Promise<boolean> {
  try { await stat(p); return true; } catch { return false; }
}

async function copyTree(src: string, dst: string) {
  await mkdir(dirname(dst), { recursive: true });
  await cp(src, dst, {
    recursive: true,
    force: true,
    filter: (s) => {
      const base = s.split("/").pop()!;
      if (SKIP_DIRS.has(base)) return false;
      if (SKIP_EXTS.some(ext => base.endsWith(ext))) return false;
      return true;
    },
  });
}

async function writeManifest() {
  const authorName = Bun.env.CONSTRUCT_AUTHOR_NAME;
  const authorUrl = Bun.env.CONSTRUCT_AUTHOR_URL;
  const repository = Bun.env.CONSTRUCT_REPOSITORY ?? "https://github.com/crsmithdev/construct";
  const manifest: Record<string, unknown> = {
    name: PLUGIN_NAME,
    description: "Claude Code-native personal AI infrastructure — hooks, skills, agents, memory, research, observability.",
    repository,
    license: "MIT",
    keywords: ["claude-code", "agents", "skills", "hooks", "memory", "research", "ai-infrastructure"],
  };
  if (authorName || authorUrl) {
    manifest.author = { ...(authorName ? { name: authorName } : {}), ...(authorUrl ? { url: authorUrl } : {}) };
  }
  await mkdir(join(OUT, ".claude-plugin"), { recursive: true });
  await writeFile(join(OUT, ".claude-plugin", "plugin.json"), JSON.stringify(manifest, null, 2) + "\n");
}

async function copySkills() {
  const srcSkills = join(SRC, "skills");
  const dstSkills = join(OUT, "skills");
  await mkdir(dstSkills, { recursive: true });
  let count = 0;
  for (const entry of await readdir(srcSkills, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillSrc = join(srcSkills, entry.name);
    if (!await exists(join(skillSrc, "SKILL.md"))) continue;
    await copyTree(skillSrc, join(dstSkills, entry.name));
    count++;
  }
  await cp(join(srcSkills, "skill-rules.json"), join(dstSkills, "skill-rules.json"));
  return count;
}

async function copyAgents() {
  const srcAgents = join(SRC, "agents");
  if (!await exists(srcAgents)) return 0;
  const dstAgents = join(OUT, "agents");
  await mkdir(dstAgents, { recursive: true });
  let count = 0;
  for (const f of await readdir(srcAgents)) {
    if (!f.endsWith(".md")) continue;
    await cp(join(srcAgents, f), join(dstAgents, f));
    count++;
  }
  return count;
}

async function copyCommands() {
  const srcCmds = join(SRC, "commands");
  if (!await exists(srcCmds)) return 0;
  const dstCmds = join(OUT, "commands");
  await mkdir(dstCmds, { recursive: true });
  let count = 0;
  for (const f of await readdir(srcCmds)) {
    if (!f.endsWith(".md")) continue;
    await cp(join(srcCmds, f), join(dstCmds, f));
    count++;
  }
  return count;
}

async function writeHooks() {
  const srcConfig = JSON.parse(await readFile(join(SRC, "core/hooks/settings-hooks.json"), "utf-8"));
  function rewrite(node: any): any {
    if (typeof node === "string") {
      return node.replace(/^(bun|bash) src\//, `$1 "\${CLAUDE_PLUGIN_ROOT}"/`);
    }
    if (Array.isArray(node)) return node.map(rewrite);
    if (node && typeof node === "object") {
      const out: any = {};
      for (const [k, v] of Object.entries(node)) out[k] = rewrite(v);
      return out;
    }
    return node;
  }
  const rewritten = rewrite(srcConfig);
  const hookCount = (rewritten.hooks ? Object.values(rewritten.hooks).flat().length : 0);
  await mkdir(join(OUT, "hooks"), { recursive: true });
  await writeFile(join(OUT, "hooks", "hooks.json"), JSON.stringify({ hooks: rewritten.hooks }, null, 2) + "\n");
  return hookCount;
}

async function writeMcp() {
  const mcp = {
    mcpServers: {
      "goal-tracker": {
        command: "bun",
        args: ["run", "${CLAUDE_PLUGIN_ROOT}/goals/mcp/src/index.ts"],
      },
    },
  };
  await writeFile(join(OUT, ".mcp.json"), JSON.stringify(mcp, null, 2) + "\n");
}

async function copyInternalModules() {
  const modules = ["core", "data", "logger", "telemetry", "eval", "goals", "memory", "research", "rules"];
  for (const m of modules) {
    const src = join(SRC, m);
    if (!await exists(src)) continue;
    await copyTree(src, join(OUT, m));
  }
  for (const f of ["trace.ts", "hook-report.ts", "status.ts"]) {
    const src = join(SRC, f);
    if (await exists(src)) await cp(src, join(OUT, f));
  }
}

async function main() {
  const t0 = Date.now();
  console.log(`Building plugin ${PLUGIN_NAME} → ${OUT}\n`);

  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  await writeManifest();
  const skills = await copySkills();
  const agents = await copyAgents();
  const commands = await copyCommands();
  const hooks = await writeHooks();
  await writeMcp();
  await copyInternalModules();

  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
  console.log(`  manifest    1`);
  console.log(`  skills      ${skills}`);
  console.log(`  agents      ${agents}`);
  console.log(`  commands    ${commands}`);
  console.log(`  hooks       ${hooks}`);
  console.log(`  mcp servers 1`);
  console.log(`  modules     core data logger telemetry eval goals memory research rules`);
  console.log(`\n  built in ${elapsed}s — load with: claude --plugin-dir ${OUT.replace(Bun.env.HOME!, "~")}`);
}

await main();
