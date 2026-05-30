#!/usr/bin/env bun
/**
 * Aleph status — collects identity, skills, sessions, and ratings in parallel.
 */
import { readdirSync, readFileSync, existsSync, statSync } from "fs";
import { resolve } from "path";
import { execSync, spawnSync } from "child_process";
import { getStatus } from "./telemetry/src/index.js";
import { claudePaths, dataPaths, externalPaths } from "./data/src/paths.ts";

const root = resolve(import.meta.dir);

interface SessionInfo {
  file: string;
  content: string;
}

async function getIdentityFiles(): Promise<string[]> {
  const dir = resolve(root, "core/identity");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.endsWith(".md")).sort();
}

async function getSkills(): Promise<string[]> {
  const dir = resolve(root, "skills");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory() && existsSync(resolve(dir, d.name, "SKILL.md")))
    .map(d => d.name)
    .sort();
}

async function getRecentSessions(count: number): Promise<SessionInfo[]> {
  const dir = dataPaths.sessions;
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter(f => f.endsWith(".md")).sort().slice(-count);
  return files.map(f => ({ file: f, content: readFileSync(resolve(dir, f), "utf-8") }));
}

async function getRatings(): Promise<{ total: number; explicit: number; avg: number | null }> {
  // Ratings now live in events.jsonl as hook=rating-capture-submit entries.
  const file = dataPaths.events;
  if (!existsSync(file)) return { total: 0, explicit: 0, avg: null };
  const lines = readFileSync(file, "utf-8").trim().split("\n").filter(Boolean);
  const explicit: number[] = [];
  for (const l of lines) {
    try {
      const e = JSON.parse(l) as Record<string, unknown>;
      if (e.hook === "rating-capture-submit" && typeof e.rating === "number") {
        explicit.push(e.rating as number);
      }
    } catch {}
  }
  const sum = explicit.reduce((s, r) => s + r, 0);
  return { total: explicit.length, explicit: explicit.length, avg: explicit.length > 0 ? sum / explicit.length : null };
}

async function getSessionCount(): Promise<number> {
  const dir = dataPaths.sessions;
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter(f => f.endsWith(".md")).length;
}

// Collect everything in parallel
const [identity, skills, sessions, ratings, sessionCount] = await Promise.all([
  getIdentityFiles(),
  getSkills(),
  getRecentSessions(5),
  getRatings(),
  getSessionCount(),
]);

// Build info from .manifest
function getBuildInfo(): string {
  const manifestFile = claudePaths.manifest;
  if (!existsSync(manifestFile)) return "unknown";
  const content = readFileSync(manifestFile, "utf-8");

  const get = (key: string): string | undefined =>
    content.match(new RegExp(`^${key} = (.+)$`, "m"))?.[1];

  const installed = get("short") ?? "unknown";
  const dirty = get("dirty") === "true" ? "-dirty" : "";
  const tag = `${installed}${dirty}`;

  // Compare with current source hash
  try {
    const repoRoot = resolve(root, "..");
    const rev = require("child_process").execSync("git rev-parse --short HEAD", { cwd: repoRoot, encoding: "utf-8" }).trim();
    const srcDirty = require("child_process").spawnSync("git", ["diff", "--quiet", "HEAD"], { cwd: repoRoot }).status !== 0;
    const current = `${rev}${srcDirty ? "-dirty" : ""}`;
    if (current !== tag) return `${tag} (source: ${current} — drift)`;
    return `${tag} (clean)`;
  } catch (e) {
    console.error(`drift check failed: ${(e as Error).message?.slice(0, 60)}`);
    return tag;
  }
}

// Format output
const out: string[] = [];

out.push("## Build\n");
out.push(`**Version**: ${getBuildInfo()}`);

out.push("\n## Context\n");
out.push(`**Identity files** (${identity.length}): ${identity.join(", ") || "none"}`);
out.push(`**Skills** (${skills.length}): ${skills.join(", ") || "none"}`);

out.push("\n## Memory\n");
out.push(`**Ratings**: ${ratings.explicit} explicit, ${ratings.avg !== null ? ratings.avg.toFixed(1) : "n/a"} avg`);
out.push(`**Sessions**: ${sessionCount} total`);

// Memory size
const sessionsSize = (() => {
  const dir = dataPaths.sessions;
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter(f => f.endsWith(".md")).reduce((sum, f) => {
    try { return sum + statSync(resolve(dir, f)).size; } catch { return sum; }
  }, 0);
})();
const ratingsSize = (() => {
  // Ratings folded into events.jsonl; report combined events size as a proxy.
  try { return statSync(dataPaths.events).size; } catch { return 0; }
})();
const memoSize = (() => {
  const db = externalPaths.memoryDb;
  try { return statSync(db).size; } catch { return 0; }
})();
const fmt = (b: number) => b < 1024 ? `${b}B` : b < 1048576 ? `${(b/1024).toFixed(1)}KB` : `${(b/1048576).toFixed(1)}MB`;
out.push(`**Memory size**: sessions ${fmt(sessionsSize)}, ratings ${fmt(ratingsSize)}, semantic ${memoSize > 0 ? fmt(memoSize) : "n/a"}`);

// Codebase stats
out.push("\n## Codebase\n");
const countFiles = (dir: string, ext: string): { files: number; lines: number } => {
  if (!existsSync(dir)) return { files: 0, lines: 0 };
  let files = 0, lines = 0;
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === "references" || e.name === ".git") continue;
      const p = resolve(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(ext)) {
        files++;
        try { lines += readFileSync(p, "utf-8").split("\n").length; } catch {}
      }
    }
  };
  walk(dir);
  return { files, lines };
};
const ts = countFiles(resolve(root, ".."), ".ts");
const md = countFiles(resolve(root, ".."), ".md");
out.push(`**TypeScript**: ${ts.files} files, ${ts.lines} lines`);
out.push(`**Docs**: ${md.files} files, ${md.lines} lines\n`);

// Telemetry (last 7 days)
out.push("## Telemetry (7d)\n");
try {
  const t = getStatus(7);
  out.push(`**Sessions**: ${t.sessions} | **Messages**: ${t.messages} | **Tool calls**: ${t.toolCalls}`);
  out.push(`**Cost**: $${t.totalCostUsd.toFixed(2)}`);
  if (t.topTools.length > 0) {
    out.push(`**Top tools**: ${t.topTools.map(t => `${t.name} (${t.count})`).join(", ")}`);
  }
  if (t.topHooks.length > 0) {
    out.push(`**Top hooks**: ${t.topHooks.map(h => `${h.command} (${h.count}x, ${h.avgMs}ms avg)`).join(", ")}`);
  }
  if (t.topSkills.length > 0) {
    out.push(`**Top skills**: ${t.topSkills.map(s => `${s.skill} (${s.count})`).join(", ")}`);
  }
} catch {
  out.push("*no telemetry data*");
}
out.push("");

if (sessions.length > 0) {
  out.push("**Recent sessions**:");
  for (const s of sessions) {
    const date = s.file.replace(".md", "").replace(/-/g, (_, i: number) => i < 12 ? "-" : " ");
    const intent = s.content.match(/Intent:\s*(.+)/)?.[1]?.slice(0, 80) ?? "—";
    const msgs = s.content.match(/Messages:\s*(\d+)/)?.[1] ?? "?";
    out.push(`  ${s.file.slice(0, 10)} | ${msgs} msgs | ${intent}`);
  }
}

console.log(out.join("\n"));
