#!/usr/bin/env bun
/**
 * Stop hook: git hygiene enforcement.
 *
 * Fires at session end. Checks three conditions:
 *
 * 1. NOT ON MAIN — if this session made edits, work should be on a branch.
 * 2. CLEAN TREE — no uncommitted changes (staged or unstaged) FROM THIS SESSION.
 * 3. PUSHED — no unpushed commits on the current branch.
 *
 * Multi-session aware: in a shared working tree (e.g. multiple agent sessions
 * sharing the same checkout), uncommitted files belonging to OTHER sessions
 * are not this session's business and won't trigger blocking. The dirty-tree
 * check intersects `git status` with the file paths this session actually
 * Edited or Wrote.
 *
 * Blocks when this session made edits and any condition fails. Advisory-only
 * when the session made no edits but the tree is dirty (pre-existing mess
 * or another session's in-progress work).
 */
import { readFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { resolve } from "path";
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

// --- Files this session edited (absolute paths) ---
function sessionEditedFiles(): Set<string> {
  const transcriptPath = input.transcript_path;
  if (!transcriptPath || !existsSync(transcriptPath)) return new Set();

  const files = new Set<string>();
  const lines = readFileSync(transcriptPath, "utf8").trim().split("\n");
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.type !== "assistant") continue;
      for (const block of (parsed.message?.content ?? [])) {
        if (block.type !== "tool_use") continue;
        if (block.name !== "Edit" && block.name !== "Write" && block.name !== "NotebookEdit") continue;
        const fp = block.input?.file_path;
        if (typeof fp === "string" && fp.length > 0) files.add(fp);
      }
    } catch { continue; }
  }
  return files;
}

// --- Git checks ---
function git(cmd: string): string {
  try { return execSync(cmd, { cwd, encoding: "utf8", timeout: 5000 }); }
  catch { return ""; }
}

// Parse `git status --porcelain -z` into the set of currently-dirty paths
// (relative to cwd). Handles renames/copies which emit two NUL-separated
// tokens per entry: "XY new\0old\0". We keep only the new path.
function dirtyPaths(): string[] {
  const out = git("git status --porcelain -z");
  if (!out) return [];
  const tokens = out.split("\0").filter(Boolean);
  const paths: string[] = [];
  let skipNext = false;
  for (const t of tokens) {
    if (skipNext) { skipNext = false; continue; }
    const code = t.slice(0, 2);
    paths.push(t.slice(3));
    if (code[0] === "R" || code[0] === "C") skipNext = true;
  }
  return paths;
}

const myEdits = sessionEditedFiles();
const madeEdits = myEdits.size > 0;
const branch = git("git branch --show-current").trim();
const isMain = branch === "main" || branch === "master";

const allDirty = dirtyPaths();
const myDirty = allDirty.filter(rel => myEdits.has(resolve(cwd, rel)));
const isDirty = myDirty.length > 0;
const otherDirtyCount = allDirty.length - myDirty.length;

const unpushed = git(`git log origin/${branch}..HEAD --oneline 2>/dev/null`).trim();
const hasUnpushed = unpushed.length > 0;

// Allow main when the session ended in a legitimate post-land state:
//  - a merge or squash commit (the /ship workflow landed here), OR
//  - tree is clean and fully pushed (a fast-forward land leaves no merge commit, so fall back to the invariant).
const lastCommitSubject = git("git log -1 --pretty=%s HEAD 2>/dev/null").trim();
const lastCommitParents = git("git log -1 --pretty=%P HEAD 2>/dev/null").trim().split(/\s+/).filter(Boolean).length;
const isMergeOrSquash = lastCommitParents >= 2 || /^Merge\b/i.test(lastCommitSubject) || /\(squashed\)/i.test(lastCommitSubject);
const isLandedClean = isMain && !isDirty && unpushed.length === 0;
const isPostShip = isMain && (isMergeOrSquash || isLandedClean);

trace(TAG, `branch=${branch} isMain=${isMain} myDirty=${myDirty.length} otherDirty=${otherDirtyCount} unpushed=${hasUnpushed} madeEdits=${madeEdits} isPostShip=${isPostShip}`);

// --- Build violations ---
const violations: string[] = [];

if (isMain && madeEdits && !isPostShip) {
  violations.push("Working directly on main — create a feature branch for this work");
}
if (isDirty && !isPostShip) {
  const n = myDirty.length;
  violations.push(`${n} uncommitted file${n === 1 ? "" : "s"} from this session — commit before ending`);
}
if (hasUnpushed && madeEdits) {
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
