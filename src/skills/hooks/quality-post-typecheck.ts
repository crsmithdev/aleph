#!/usr/bin/env bun
/**
 * PostToolUse hook: TypeScript type-checker.
 *
 * Fires after Edit/Write on .ts/.tsx/.js/.jsx files.
 *
 * 1. Extract file_path from tool_input; skip if missing or non-TS/JS extension.
 * 2. Find git repo root from the file's directory.
 * 3. Walk up from the file to find the nearest tsconfig.json (or .app/.build variants).
 * 4. Run `tsc --noEmit` against that tsconfig.
 * 5. If type errors found → exit 1 with error preview (up to 5 lines).
 *    If clean → exit 0.
 *    If tsc missing or no tsconfig → exit 0 (skip silently).
 */
import { existsSync } from "fs";
import { dirname, extname } from "path";
import { execSync } from "child_process";
import { trace } from "../../trace.ts";
import { reportHook } from "../../hook-report.ts";

const TAG = "quality-post-typecheck";
let input: any;
try { input = JSON.parse(await Bun.stdin.text()); }
catch (e) {
  const msg = `[${TAG}] stdin parse failed: ${(e as Error).message}`;
  console.error(msg);
  trace(TAG, msg);
  process.exit(1);
}
reportHook(TAG, "PostToolUse", input.session_id);

const filePath = input.tool_input?.file_path ?? "";
if (!filePath) { trace(TAG, "no file path"); process.exit(0); }

const ext = extname(filePath).slice(1);
if (!["ts", "tsx", "js", "jsx"].includes(ext)) {
  trace(TAG, `skip: .${ext} not a TS/JS file`);
  process.exit(0);
}

// Find project root
let projectRoot = "";
try {
  projectRoot = execSync(`git -C "${dirname(filePath)}" rev-parse --show-toplevel`, { encoding: "utf8" }).trim();
} catch {
  trace(TAG, "no git root");
  process.exit(0);
}

// Find the nearest tsconfig
function findTsconfig(from: string): string | undefined {
  const candidates = ["tsconfig.json", "tsconfig.app.json", "tsconfig.build.json"];
  let dir = dirname(from);
  while (dir.startsWith(projectRoot)) {
    for (const name of candidates) {
      const candidate = `${dir}/${name}`;
      if (existsSync(candidate)) return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

const tsconfig = findTsconfig(filePath);
if (!tsconfig) {
  trace(TAG, "no tsconfig found");
  process.exit(0);
}

// Check if tsc is available
try { execSync("which tsc", { stdio: "ignore" }); }
catch { trace(TAG, "tsc not on PATH"); process.exit(0); }

// Run tsc --noEmit
trace(TAG, `checking: tsc -p ${tsconfig}`);
try {
  execSync(`tsc --noEmit -p "${tsconfig}"`, {
    encoding: "utf8",
    stdio: "pipe",
    timeout: 15000,
  });
  trace(TAG, "ok: no type errors");
} catch (e: any) {
  const output = (e.stdout || e.stderr || "").trim();
  const lines = output.split("\n").filter((l: string) => l.includes("error TS"));
  const errorCount = lines.length;
  if (errorCount > 0) {
    const preview = lines.slice(0, 5).join("\n");
    const suffix = errorCount > 5 ? `\n... and ${errorCount - 5} more errors` : "";
    console.log(`⚠ TypeScript: ${errorCount} error${errorCount === 1 ? "" : "s"} found after editing ${filePath}\n${preview}${suffix}`);
    trace(TAG, `${errorCount} type errors`);
    process.exit(2);
  }
  trace(TAG, "tsc exited non-zero but no TS errors found");
}
