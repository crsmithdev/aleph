#!/usr/bin/env bun
/**
 * False-positive sampler: for a given skill, dumps prompts that matched it
 * but where the model did NOT invoke it. Reveals over-firing keywords.
 *
 * Usage: bun scripts/routing-fp.ts <skill> [days=7] [n=20]
 */
import { readdirSync, readFileSync, statSync } from "fs";
import { spawnSync } from "child_process";
import { resolve } from "path";

const skill = process.argv[2];
const days = Number(process.argv[3] ?? 7);
const sampleN = Number(process.argv[4] ?? 20);
if (!skill) { console.error("usage: routing-fp.ts <skill> [days] [n]"); process.exit(1); }

const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
const sessionsDir = resolve(process.env.HOME!, ".claude/projects/-home-crsmi-construct");
const hookPath = resolve(import.meta.dir, "../src/core/hooks/routing-classify-submit.ts");

function runHook(prompt: string): string[] {
  const res = spawnSync("bun", [hookPath], {
    input: JSON.stringify({ prompt, session_id: "replay" }),
    encoding: "utf8",
  });
  const m = res.stdout.match(/Matched skills:\s*([^.]+)\./);
  return m ? m[1].split(",").map((s) => s.trim()) : [];
}

const files = readdirSync(sessionsDir)
  .filter((f) => f.endsWith(".jsonl"))
  .filter((f) => statSync(resolve(sessionsDir, f)).mtimeMs > cutoff);

// First pass: collect invocations per session so we can tell match→no-invoke
const samples: Array<{ prompt: string; session: string }> = [];
for (const f of files) {
  const lines = readFileSync(resolve(sessionsDir, f), "utf8").split("\n");
  const invokedInSession = new Set<string>();
  // Pre-scan invocations
  for (const ln of lines) {
    if (!ln) continue;
    let j: any; try { j = JSON.parse(ln); } catch { continue; }
    if (j.type === "assistant" && !j.isSidechain) {
      const c = j.message?.content;
      if (Array.isArray(c)) for (const b of c) {
        if (b.type === "tool_use" && b.name === "Skill") {
          const n = (b.input as any)?.skill;
          if (n) invokedInSession.add(n);
        }
      }
    }
  }
  // Now collect false-positive prompts: matched skill in this session, but
  // the model never invoked it anywhere in the session.
  if (invokedInSession.has(skill)) continue;
  for (const ln of lines) {
    if (!ln) continue;
    let j: any; try { j = JSON.parse(ln); } catch { continue; }
    if (j.type !== "user" || j.isCompactSummary || j.toolUseResult || j.isSidechain || j.isMeta) continue;
    const c = j.message?.content;
    let text: string | undefined;
    if (typeof c === "string") text = c;
    else if (Array.isArray(c)) {
      if (c.some((b: any) => b?.type === "tool_result")) continue;
      text = c.map((b: any) => b.text || "").filter(Boolean).join("\n");
    }
    if (!text || text.length < 3) continue;
    if (text.startsWith("<")) continue;
    if (/^#\s+\w/.test(text)) continue;
    const matched = runHook(text);
    if (matched.includes(skill)) samples.push({ prompt: text, session: f });
    if (samples.length >= sampleN * 3) break;
  }
}

console.log(`\n${samples.length} false-positive prompts for skill "${skill}" (last ${days}d):\n`);
const display = samples.slice(0, sampleN);
for (const s of display) {
  console.log("─".repeat(80));
  console.log(s.prompt.slice(0, 400).replace(/\s+/g, " "));
}
