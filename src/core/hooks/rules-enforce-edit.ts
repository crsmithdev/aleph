#!/usr/bin/env bun
/**
 * PreToolUse hook: rules enforcement at write-time.
 *
 * On Edit/Write/MultiEdit, classifies the target file path into a bucket
 * (ui, skill, agent, code, docs) and injects the matching RULES.md content as
 * additionalContext on the tool call. Per-session per-bucket dedup so the
 * rules are loaded once per bucket per session — not every edit.
 *
 * Buckets (first match wins):
 *   ui     src/ui/**.{ts,tsx,jsx,css,scss}      → design + design/aleph
 *   skill  src/skills/{slug}/SKILL.md           → docs
 *   agent  {src,.claude}/agents/**.md           → agent
 *   code   **.{ts,tsx,js,jsx,mjs,cjs} under src or root entry points → code
 *   docs   **.md                                → docs
 *
 * State: ~/.aleph/signals/rules-enforce/{sessionId}-{bucket}
 * Never blocks. Silent on no-match, on missing rule files, on I/O failure.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { trace } from "../../trace.ts";
import { reportHook } from "../../hook-report.ts";
import { dataPaths } from "../../data/src/paths.ts";

const TAG = "rules-enforce-edit";

let input: any;
try { input = JSON.parse(await Bun.stdin.text()); }
catch (e) { trace(TAG, `stdin parse failed: ${(e as Error).message}`); process.exit(0); }
reportHook(TAG, "PreToolUse", input.session_id);

const sessionId: string = input.session_id ?? "unknown";
const toolInput = input.tool_input ?? {};
const cwd: string = input.cwd ?? process.cwd();

const filePath: string = toolInput.file_path ?? toolInput.notebook_path ?? "";
if (!filePath) { trace(TAG, "no file_path in tool_input"); process.exit(0); }

const rel = relativize(filePath, cwd);

interface Bucket { name: string; match: RegExp; rules: string[]; }
// Worktree-aware prefix: optionally allow `.worktrees/<name>/` ahead of repo-rooted paths.
const WT = "(?:\\.worktrees/[^/]+/)?";
const BUCKETS: Bucket[] = [
  { name: "ui",    match: new RegExp(`^${WT}src/ui/.+\\.(tsx?|jsx?|css|scss)$`),       rules: ["src/rules/design/RULES.md", "src/rules/design/aleph/RULES.md"] },
  { name: "skill", match: new RegExp(`^${WT}src/skills/[^/]+/SKILL\\.md$`),             rules: ["src/rules/docs/RULES.md"] },
  { name: "agent", match: new RegExp(`^${WT}(?:src/agents|\\.claude/agents)/.+\\.md$`), rules: ["src/rules/agent/RULES.md"] },
  { name: "code",  match: new RegExp(`^${WT}(?:src/.+|install|test|dev-server)\\.(tsx?|jsx?|mjs|cjs)$`), rules: ["src/rules/code/RULES.md"] },
  { name: "docs",  match: /\.md$/,                                                       rules: ["src/rules/docs/RULES.md"] },
];

const bucket = BUCKETS.find(b => b.match.test(rel))!;
if (!bucket) { trace(TAG, `no bucket match for ${rel}`); process.exit(0); }

const markerDir = `${dataPaths.signals}/rules-enforce`;
const marker = `${markerDir}/${sessionId}-${bucket.name}`;
let alreadyInjected = false;
try {
  alreadyInjected = existsSync(marker);
  if (!alreadyInjected) {
    mkdirSync(markerDir, { recursive: true });
    writeFileSync(marker, new Date().toISOString());
  }
} catch (e) {
  trace(TAG, `marker write failed: ${(e as Error).message}`);
}

if (alreadyInjected) {
  trace(TAG, `bucket=${bucket.name} already injected this session, skip`);
  process.exit(0);
}

const sections: string[] = [];
const missing: string[] = [];
for (const r of bucket.rules) {
  const abs = resolve(cwd, r);
  try {
    sections.push(`<!-- ${r} -->\n${readFileSync(abs, "utf8")}`);
  } catch (e) {
    missing.push(r);
    trace(TAG, `rule read failed for ${r}: ${(e as Error).message}`);
  }
}
if (sections.length === 0) {
  trace(TAG, `no rule files readable for bucket=${bucket.name}`);
  process.exit(0);
}

const additionalContext = `# Aleph rules — bucket: ${bucket.name}

The following rules apply to ${rel} and any other ${bucket.name}-bucket file you edit in this session. Auto-apply silently while writing. Cite \`<file>#<section>\` when a rule pins a specific change.

${sections.join("\n\n")}
`;

const payload = {
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    additionalContext,
  },
};

console.log(JSON.stringify(payload));
reportHook(TAG, "PreToolUse", sessionId, {
  decision: "advisory",
  detail: `bucket=${bucket.name}`,
  meta: { bucket: bucket.name, file: rel, rules: bucket.rules, missing, chars: additionalContext.length },
});
trace(TAG, `injected bucket=${bucket.name} for ${rel} (${additionalContext.length} chars, ${missing.length} missing)`);
process.exit(0);

function relativize(p: string, base: string): string {
  if (!p.startsWith("/")) return p.replace(/^\.\//, "");
  const b = base.endsWith("/") ? base : base + "/";
  return p.startsWith(b) ? p.slice(b.length) : p;
}
