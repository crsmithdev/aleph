#!/usr/bin/env bun
/**
 * Construct status — collects identity, skills, sessions, and ratings in parallel.
 */
import { readdirSync, readFileSync, existsSync, statSync } from "fs";
import { resolve } from "path";

const root = resolve(import.meta.dir);

interface Rating {
  timestamp: string;
  rating: number;
  type: string;
}

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
  const dir = resolve(root, "memory/sessions");
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter(f => f.endsWith(".md")).sort().slice(-count);
  return files.map(f => ({ file: f, content: readFileSync(resolve(dir, f), "utf-8") }));
}

async function getRatings(): Promise<{ total: number; explicit: number; avg: number | null }> {
  const file = resolve(root, "memory/signals/ratings.jsonl");
  if (!existsSync(file)) return { total: 0, explicit: 0, avg: null };
  const lines = readFileSync(file, "utf-8").trim().split("\n").filter(Boolean);
  const ratings: Rating[] = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const explicit = ratings.filter(r => r.type === "explicit");
  const sum = explicit.reduce((s, r) => s + r.rating, 0);
  return { total: ratings.length, explicit: explicit.length, avg: explicit.length > 0 ? sum / explicit.length : null };
}

async function getSessionCount(): Promise<number> {
  const dir = resolve(root, "memory/sessions");
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

// Format output
const out: string[] = [];

out.push("## Context\n");
out.push(`**Identity files** (${identity.length}): ${identity.join(", ") || "none"}`);
out.push(`**Skills** (${skills.length}): ${skills.join(", ") || "none"}`);

out.push("\n## Memory\n");
out.push(`**Ratings**: ${ratings.explicit} explicit, ${ratings.avg !== null ? ratings.avg.toFixed(1) : "n/a"} avg`);
out.push(`**Sessions**: ${sessionCount} total`);

// Memory size
const sessionsSize = (() => {
  const dir = resolve(root, "memory/sessions");
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter(f => f.endsWith(".md")).reduce((sum, f) => {
    try { return sum + statSync(resolve(dir, f)).size; } catch { return sum; }
  }, 0);
})();
const ratingsSize = (() => {
  const f = resolve(root, "memory/signals/ratings.jsonl");
  try { return statSync(f).size; } catch { return 0; }
})();
const memoSize = (() => {
  const db = resolve(Bun.env.HOME ?? "/tmp", ".local/share/mcp-memory/sqlite_vec.db");
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
