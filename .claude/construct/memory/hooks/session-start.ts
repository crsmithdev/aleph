#!/usr/bin/env bun
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { resolve, dirname } from "path";
import { trace } from "../../trace.ts";

const root = resolve(dirname(Bun.main), "../..");
const sessionsDir = resolve(root, "memory/sessions");
const context = resolve(root, "memory/CONTEXT.md");
const learned = resolve(root, "memory/LEARNED.md");
const snapDir = resolve(root, "memory/snapshots");

const sessions = existsSync(sessionsDir) ? readdirSync(sessionsDir).length : 0;
trace("session-start", `sessions dir: ${sessions} files`);
console.log(`=== Session Start ===\nSessions: ${sessions}`);

if (existsSync(context)) {
  trace("session-start", "reading CONTEXT.md");
  const m = readFileSync(context, "utf8").match(/## Current focus\n([\s\S]+?)(?=\n## |$)/);
  const lines = m?.[1].split("\n").filter((l) => l.trim()).slice(0, 3);
  if (lines?.length) console.log("Focus: " + lines.join("\n"));
  else trace("session-start", "no focus section found");
} else {
  trace("session-start", "CONTEXT.md not found");
  console.log("⚠ memory/CONTEXT.md not found — install construct-memory or create it manually");
}

if (existsSync(learned)) {
  trace("session-start", "reading LEARNED.md");
  const recent = readFileSync(learned, "utf8").split("\n").filter((l) => /^\d{4}-/.test(l)).slice(-2);
  if (recent.length) console.log("Recent:\n" + recent.map((l) => `  ${l}`).join("\n"));
  else trace("session-start", "no dated entries in LEARNED.md");
} else {
  trace("session-start", "LEARNED.md not found");
  console.log("⚠ memory/LEARNED.md not found — install construct-memory or create it manually");
}

if (existsSync(snapDir)) {
  const snaps = readdirSync(snapDir).filter((f) => f.endsWith(".md"))
    .map((f) => ({ name: f, mt: statSync(resolve(snapDir, f)).mtimeMs }))
    .sort((a, b) => b.mt - a.mt).slice(0, 3);
  trace("session-start", `snapshots: ${snaps.length} unresolved`);
  if (snaps.length) {
    console.log("\n⚠ Unresolved snapshots:");
    snaps.forEach((s) => console.log(`  ${s.name}: ${readFileSync(resolve(snapDir, s.name), "utf8").split("\n")[0]}`));
  }
} else {
  trace("session-start", "snapshots dir not found");
}
console.log("====================");
