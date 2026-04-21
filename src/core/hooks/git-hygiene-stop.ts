#!/usr/bin/env bun
/**
 * Stop hook: git hygiene enforcement.
 *
 * Fires at session end. Checks three conditions:
 *
 * 1. NOT ON MAIN — if this session made edits, work should be on a branch.
 * 2. CLEAN TREE — no uncommitted changes (staged or unstaged).
 * 3. PUSHED — no unpushed commits on the current branch.
 *
 * Blocks when edits were made and any condition fails. Advisory-only when
 * the session made no edits but the tree is dirty (pre-existing mess).
 */
import { readFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { trace } from "../../trace.ts";
import { reportHook } from "../../hook-report.ts";

const TAG = "git-hygiene-stop";

let input: any;
try { input = JSON.parse(await Bun.stdin.text()); }
catch { process.exit(0); }

// Guards: never block re-fires or non-natural stops
if (input.stop_hook_active) { trace(TAG, "skip: stop_hook_active"); process.exit(0); }
if (input.stop_reason && input.stop_reason !== "end_of_turn") {
  trace(TAG, `skip: stop_reason=${input.stop_reason}`);
  process.exit(0);
}

const cwd = input.cwd;
if (!cwd) { trace(TAG, "no cwd, skip"); process.exit(0); }

reportHook(TAG, "Stop", input.session_id);

// --- Did this session make edits? ---
function sessionMadeEdits(): boolean {
  const transcriptPath = input.transcript_path;
  if (!transcriptPath || !existsSync(transcriptPath)) return false;

  const lines = readFileSync(transcriptPath, "utf8").trim().split("\n");
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.type !== "assistant") continue;
      for (const block of (parsed.message?.content ?? [])) {
        if (block.type === "tool_use" && (block.name === "Edit" || block.name === "Write")) {
          return true;
        }
      }
    } catch { continue; }
  }
  return false;
}

// --- Git checks ---
function git(cmd: string): string {
  try { return execSync(cmd, { cwd, encoding: "utf8", timeout: 5000 }).trim(); }
  catch { return ""; }
}

const madeEdits = sessionMadeEdits();
const branch = git("git branch --show-current");
const isMain = branch === "main" || branch === "master";
const status = git("git status --porcelain");
const isDirty = status.length > 0;
const unpushed = git(`git log origin/${branch}..HEAD --oneline 2>/dev/null`);
const hasUnpushed = unpushed.length > 0 && !isMain; // don't nag about pushing main

// Allow main when the session ended in a legitimate post-land state:
//  - a merge or squash commit (the /ship workflow landed here), OR
//  - tree is clean and fully pushed (a fast-forward land leaves no merge commit, so fall back to the invariant).
const lastCommitSubject = git("git log -1 --pretty=%s HEAD 2>/dev/null");
const lastCommitParents = git("git log -1 --pretty=%P HEAD 2>/dev/null").split(/\s+/).filter(Boolean).length;
const isMergeOrSquash = lastCommitParents >= 2 || /^Merge\b/i.test(lastCommitSubject) || /\(squashed\)/i.test(lastCommitSubject);
const isLandedClean = isMain && !isDirty && unpushed.length === 0;
const isPostShip = isMain && (isMergeOrSquash || isLandedClean);

trace(TAG, `branch=${branch} isMain=${isMain} dirty=${isDirty} unpushed=${hasUnpushed} madeEdits=${madeEdits} isPostShip=${isPostShip}`);

// --- Build violations ---
const violations: string[] = [];

if (isMain && madeEdits && !isPostShip) {
  violations.push("Working directly on main — create a feature branch for this work");
}
if (isDirty && !isPostShip) {
  const fileCount = status.split("\n").filter(Boolean).length;
  violations.push(`${fileCount} uncommitted file${fileCount === 1 ? "" : "s"} in working tree — commit before ending`);
}
if (hasUnpushed) {
  const commitCount = unpushed.split("\n").filter(Boolean).length;
  violations.push(`${commitCount} unpushed commit${commitCount === 1 ? "" : "s"} on ${branch} — push before ending`);
}

if (violations.length === 0) {
  trace(TAG, "pass: all clean");
  reportHook(TAG, "Stop", input.session_id, { decision: "pass" });
  process.exit(0);
}

// If this session made edits → block. If pre-existing mess → advisory.
const decision = madeEdits ? "block" : "advisory";
const reason = violations.join("; ");

trace(TAG, `${decision}: ${reason}`);
reportHook(TAG, "Stop", input.session_id, { decision, violations });

if (decision === "block") {
  console.log(JSON.stringify({
    decision: "block",
    reason: `Git hygiene: ${reason}.`,
  }));
} else {
  console.log(`[Construct] Git hygiene: ${reason}.`);
}
process.exit(0);
