#!/usr/bin/env bun
/**
 * Construct status — collects identity, skills, sessions, and ratings in parallel.
 */
import { readdirSync, readFileSync, existsSync } from "fs";
import { resolve, basename } from "path";

const root = resolve(import.meta.dir);
const home = Bun.env.HOME ?? "/tmp";

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
out.push(`**Sessions**: ${sessionCount} total\n`);

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
