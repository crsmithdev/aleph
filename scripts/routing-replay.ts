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
const sessionsDir = resolve(process.env.HOME!, ".claude/projects", process.cwd().replace(/[\\/.]/g, "-"));
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
  // True when the most recent real user turn was a slash-command / skill dispatch.
  // A Skill() that follows is a mandatory invocation, not a keyword conversion.
  let prevUserSlash = false;
  for (const ln of lines) {
    if (!ln) continue;
    let j: any;
    try { j = JSON.parse(ln); } catch { continue; }

    if (j.type === "user" && !j.isCompactSummary) {
      const c = j.message?.content;
      // tool_result turns aren't real user turns — leave slash state untouched.
      const isToolResult = j.toolUseResult || (Array.isArray(c) && c.some((b: any) => b?.type === "tool_result"));
      if (!isToolResult) {
        let text = "";
        if (typeof c === "string") text = c;
        else if (Array.isArray(c)) text = c.map((b: any) => (typeof b.text === "string" ? b.text : "")).filter(Boolean).join("\n");
        const trimmed = text.trim();
        // Slash dispatch: an isMeta "Invoke the `X` skill ..." expansion, or a
        // literal /command. Invocations that follow are mandatory, not keyword-driven.
        prevUserSlash = (!!j.isMeta && /invoke the\s+\W?[\w-]+\W?\s+skill/i.test(text)) || /^\/[a-z]/i.test(trimmed);

        // Real typed prompt → run through hook for matches. isSidechain (subagent)
        // and isMeta (injected skill body) are not real prompts; neither fires the
        // live hook, so excluding them keeps the conversion denominator honest.
        if (!j.isSidechain && !j.isMeta && trimmed.length >= 3 && !trimmed.startsWith("<") && !/^#\s+\w/.test(trimmed)) {
          totalPrompts++;
          const matched = runHook(text);
          if (matched.length > 0) {
            matchedPrompts++;
            for (const s of matched) matches[s] = (matches[s] || 0) + 1;
          }
        }
      }
    }

    // assistant Skill() tool_use → record invocation (main session only, and only
    // when not following a slash dispatch — those are mandatory, not conversions)
    if (j.type === "assistant" && !j.isSidechain) {
      const c = j.message?.content;
      if (Array.isArray(c)) {
        for (const b of c) {
          if (b.type === "tool_use" && b.name === "Skill") {
            const n = (b.input as any)?.skill;
            if (n && !prevUserSlash) invokes[n] = (invokes[n] || 0) + 1;
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
