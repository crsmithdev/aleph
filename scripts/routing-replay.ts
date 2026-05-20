#!/usr/bin/env bun
/**
 * Routing precision replay.
 *
 * Walks recent session JSONL files. For each user prompt, runs the current
 * routing-classify-submit hook to capture what skills it matches NOW. Compares
 * against the assistant's actual Skill() tool_use blocks in the same session.
 *
 * Output: per-skill matched/invoked/conv% table + headline totals.
 *
 * Usage: bun scripts/routing-replay.ts [days=7]
 */
import { readdirSync, readFileSync, statSync } from "fs";
import { spawnSync } from "child_process";
import { resolve } from "path";

const days = Number(process.argv[2] ?? 7);
const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
const sessionsDir = resolve(process.env.HOME!, ".claude/projects/-home-crsmi-construct");
const hookPath = resolve(import.meta.dir, "../src/core/hooks/routing-classify-submit.ts");

const matches: Record<string, number> = {};
const invokes: Record<string, number> = {};
let totalPrompts = 0;
let matchedPrompts = 0;

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

console.error(`replaying ${files.length} session files from last ${days} days...`);

for (const f of files) {
  const lines = readFileSync(resolve(sessionsDir, f), "utf8").split("\n");
  for (const ln of lines) {
    if (!ln) continue;
    let j: any;
    try { j = JSON.parse(ln); } catch { continue; }

    // user prompts → run through current hook.
    // Skip tool_result wrappers, system reminders, and synthetic skill bodies.
    if (j.type === "user" && !j.isCompactSummary && !j.toolUseResult) {
      const c = j.message?.content;
      let text: string | undefined;
      if (typeof c === "string") text = c;
      else if (Array.isArray(c)) {
        // Reject if any block is a tool_result — that's not a user prompt.
        if (c.some((b: any) => b?.type === "tool_result")) continue;
        const parts: string[] = [];
        for (const b of c) if (typeof b.text === "string") parts.push(b.text);
        text = parts.join("\n");
      }
      if (!text || text.length < 3) continue;
      if (text.startsWith("<")) continue; // <system-reminder>, <command-name>, etc
      if (/^#\s+\w/.test(text)) continue;  // SKILL.md body starts with "# SkillName"
      totalPrompts++;
      const matched = runHook(text);
      if (matched.length > 0) {
        matchedPrompts++;
        for (const s of matched) matches[s] = (matches[s] || 0) + 1;
      }
    }

    // assistant Skill() tool_use → record invocation
    if (j.type === "assistant") {
      const c = j.message?.content;
      if (Array.isArray(c)) {
        for (const b of c) {
          if (b.type === "tool_use" && b.name === "Skill") {
            const n = (b.input as any)?.skill;
            if (n) invokes[n] = (invokes[n] || 0) + 1;
          }
        }
      }
    }
  }
}

const all = [...new Set([...Object.keys(matches), ...Object.keys(invokes)])];
const rows = all
  .map((k) => ({ skill: k, matched: matches[k] || 0, invoked: invokes[k] || 0 }))
  .sort((a, b) => b.matched + b.invoked - (a.matched + a.invoked));

console.log("\nskill                    matched  invoked    conv%");
for (const r of rows) {
  const conv = r.matched ? Math.round((100 * r.invoked) / r.matched) + "%" : "—";
  console.log(
    r.skill.padEnd(24),
    String(r.matched).padStart(5),
    String(r.invoked).padStart(8),
    conv.padStart(8),
  );
}

const totM = rows.reduce((s, r) => s + r.matched, 0);
const totI = rows.reduce((s, r) => s + r.invoked, 0);
console.log("---");
console.log(`prompts replayed: ${totalPrompts}  with-match: ${matchedPrompts} (${Math.round(100 * matchedPrompts / totalPrompts)}%)`);
console.log(`total matches: ${totM}  total invocations: ${totI}  conv: ${Math.round(100 * totI / totM)}%`);
console.log(`sessions: ${files.length} (last ${days}d)`);
