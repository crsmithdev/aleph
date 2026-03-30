#!/usr/bin/env bun
import { realpathSync } from "fs";
import { resolve } from "path";
import { homedir } from "os";
import { existsSync } from "fs";
import { trace } from "../../trace.ts";
import { reportHook } from "../../hook-report.ts";

const TAG = "isolation-pre-block-prod-edit";
let input: any;
try { input = JSON.parse(await Bun.stdin.text()); }
catch (e) { trace(TAG, `stdin parse failed: ${(e as Error).message}`); process.exit(1); }
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
