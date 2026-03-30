#!/usr/bin/env bun
/**
 * PreToolUse hook: production edit blocker.
 *
 * Prevents writing to ~/.claude/construct/ when running from the dev repo.
 *
 * 1. Extract file_path from tool_input; skip if missing.
 * 2. Resolve both the target file and ~/.claude/construct/ to real paths.
 * 3. If the file is NOT under production construct → exit 0 (allow).
 * 4. If the file IS under production construct, check if cwd is the dev repo
 *    (has install.ts + src/data/src/paths.ts).
 * 5. Dev repo + prod target → exit 2 (hard block). Use install.ts to deploy.
 *    Not dev repo → exit 0 (allow, this is a production session editing its own files).
 */
import { realpathSync } from "fs";
import { resolve } from "path";
import { homedir } from "os";
import { existsSync } from "fs";
import { trace } from "../../trace.ts";
import { reportHook } from "../../hook-report.ts";

const TAG = "isolation-pre-block-prod-edit";
let input: any;
try { input = JSON.parse(await Bun.stdin.text()); }
catch (e) {
  const msg = `[${TAG}] stdin parse failed: ${(e as Error).message}`;
  console.error(msg);
  trace(TAG, msg);
  process.exit(1);
}
reportHook(TAG, "PreToolUse", input.session_id);

const filePath: string | undefined = input.tool_input?.file_path;
if (!filePath) {
  trace(TAG, "no file_path in tool input");
  process.exit(0);
}

let resolvedFile: string;
try {
  resolvedFile = realpathSync(filePath);
} catch {
  trace(TAG, `realpathSync failed for ${filePath}, allowing`);
  process.exit(0);
}

let resolvedProdConstruct: string;
try {
  resolvedProdConstruct = realpathSync(resolve(homedir(), ".claude", "construct"));
} catch {
  trace(TAG, "production construct dir not found, allowing");
  process.exit(0);
}

if (!resolvedFile.startsWith(resolvedProdConstruct + "/") && resolvedFile !== resolvedProdConstruct) {
  trace(TAG, `file ${resolvedFile} not under prod construct, allowing`);
  process.exit(0);
}

// File is under production construct — check if we're in the dev repo
const cwd = process.cwd();
const isDevRepo =
  existsSync(resolve(cwd, "install.ts")) &&
  existsSync(resolve(cwd, "src/data/src/paths.ts"));

if (isDevRepo) {
  console.log("[Construct] Blocked: Edit/Write to production path while in dev repo. Use install.ts to deploy changes.");
  trace(TAG, `blocked write to ${resolvedFile} from dev repo at ${cwd}`);
  process.exit(2);
}

trace(TAG, `file under prod construct but not in dev repo, allowing`);
process.exit(0);
