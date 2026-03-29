#!/usr/bin/env bun
import { existsSync, readFileSync, appendFileSync, mkdirSync, unlinkSync } from "fs";
import { dirname } from "path";
import { trace } from "../../trace.ts";
import { dataPaths } from "../../paths.ts";

const TAG = "compliance-check";

let input: any;
try { input = JSON.parse(await Bun.stdin.text()); }
catch (e) { trace(TAG, `stdin parse failed: ${(e as Error).message}`); process.exit(0); }

const sessionId: string = input.session_id ?? "";
const transcriptPath: string = input.transcript_path ?? "";

trace(TAG, `sessionId=${sessionId} transcript=${transcriptPath}`);

// Read directives for this session
if (!existsSync(dataPaths.directives)) {
  trace(TAG, "no directives file, skip");
  process.exit(0);
}

const directiveLines = readFileSync(dataPaths.directives, "utf8")
  .trim()
  .split("\n")
  .filter(Boolean);

const sessionDirectives = new Set<string>();
for (const line of directiveLines) {
  try {
    const record = JSON.parse(line);
    if (record.sessionId === sessionId && Array.isArray(record.directives)) {
      for (const d of record.directives) sessionDirectives.add(d as string);
    }
  } catch { continue; }
}

if (sessionDirectives.size === 0) {
  trace(TAG, "no directives for this session, skip");
  process.exit(0);
}

trace(TAG, `directives: ${[...sessionDirectives].join(", ")}`);

// Read transcript and scan ALL assistant tool_use blocks
if (!transcriptPath || !existsSync(transcriptPath)) {
  trace(TAG, "no transcript, skip");
  process.exit(0);
}

const lines = readFileSync(transcriptPath, "utf8").trim().split("\n");

let hasAgent = false;
let hasSkillOrPlan = false;
const skillsUsed = new Set<string>();

for (const line of lines) {
  let parsed: any;
  try { parsed = JSON.parse(line); } catch { continue; }
  if (parsed.type !== "assistant") continue;

  const content: any[] = parsed.message?.content ?? [];
  for (const block of content) {
    if (block.type !== "tool_use") continue;
    const name: string = block.name ?? "";
    const blockInput = block.input as Record<string, unknown> | undefined;

    if (name === "Agent") hasAgent = true;
    if (name === "Skill" || name === "EnterPlanMode") hasSkillOrPlan = true;
    if (name === "Skill" && blockInput?.skill) {
      skillsUsed.add(blockInput.skill as string);
    }
  }
}

trace(TAG, `hasAgent=${hasAgent} hasSkillOrPlan=${hasSkillOrPlan} skills=[${[...skillsUsed].join(",")}]`);

// Write compliance results
try {
  mkdirSync(dirname(dataPaths.compliance), { recursive: true });
  const ts = new Date().toISOString();

  for (const directive of sessionDirectives) {
    let followed = false;
    if (directive === "dispatch") {
      followed = hasAgent;
    } else if (directive === "full") {
      followed = hasSkillOrPlan;
    } else if (directive.startsWith("skill:")) {
      const skillName = directive.slice("skill:".length);
      followed = skillsUsed.has(skillName);
    }

    const record = JSON.stringify({ ts, sessionId, directive, followed });
    appendFileSync(dataPaths.compliance, record + "\n");
    trace(TAG, `compliance: ${directive}=${followed}`);
  }
} catch (e) {
  trace(TAG, `compliance write failed: ${(e as Error).message}`);
}

// Cleanup dispatch marker
if (sessionId) {
  const markerPath = `/tmp/construct-dispatch-${sessionId}`;
  try { unlinkSync(markerPath); trace(TAG, "dispatch marker cleaned up"); }
  catch { /* no marker to clean */ }
}

process.exit(0);
