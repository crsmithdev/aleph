#!/usr/bin/env bun
import { existsSync, readFileSync } from "fs";
import { dirname, extname } from "path";
import { execSync } from "child_process";
import { trace } from "../../trace.ts";

const TAG = "quality";
const input = JSON.parse(await Bun.stdin.text());
const filePath = input.tool_input?.file_path ?? "";
if (!filePath || !existsSync(filePath)) {
  trace(TAG, `skip: ${filePath ? "file not found" : "no file path"}`);
  process.exit(0);
}
trace(TAG, `file: ${filePath}`);

function run(cmd: string) {
  try {
    execSync(cmd, { stdio: "ignore" });
    trace(TAG, `ok: ${cmd.slice(0, 80)}`);
  } catch (e) {
    trace(TAG, `failed: ${cmd.slice(0, 80)} — ${(e as Error).message?.slice(0, 60)}`);
  }
}

function has(bin: string): boolean {
  try { execSync(`which ${bin}`, { stdio: "ignore" }); return true; } catch { return false; }
}

// Check for project-level quality config
let projectRoot = "";
try {
  projectRoot = execSync(`git -C "${dirname(filePath)}" rev-parse --show-toplevel`, { encoding: "utf8" }).trim();
} catch (e) {
  trace(TAG, `no git root: ${(e as Error).message?.slice(0, 60)}`);
}
const config = projectRoot ? `${projectRoot}/.claude/quality.json` : "";

if (config && existsSync(config)) {
  trace(TAG, `using project config: ${config}`);
  const rules = JSON.parse(readFileSync(config, "utf8"));
  for (const key of ["format", "lint"] as const) {
    const cmd = rules[key];
    if (cmd) {
      trace(TAG, `running ${key}: ${cmd.replace(/\$FILE/g, filePath)}`);
      run(cmd.replace(/\$FILE/g, filePath));
    }
  }
  trace(TAG, "done (project config)");
  process.exit(0);
}

// Default formatters by extension
const ext = extname(filePath).slice(1);
trace(TAG, `extension: ${ext}`);
const formatters: Record<string, [string, string[]][]> = {
  py:   [["ruff", ["check", "--fix", filePath]], ["ruff", ["format", filePath]]],
  ts:   [["prettier", ["--write", filePath]]],
  tsx:  [["prettier", ["--write", filePath]]],
  js:   [["prettier", ["--write", filePath]]],
  jsx:  [["prettier", ["--write", filePath]]],
  go:   [["gofmt", ["-w", filePath]]],
  rs:   [["rustfmt", [filePath]]],
};

const matched = formatters[ext];
if (!matched) {
  trace(TAG, `no formatters for .${ext}`);
  process.exit(0);
}

for (const [bin, args] of matched) {
  if (has(bin)) {
    trace(TAG, `running: ${bin} ${args.join(" ")}`);
    run([bin, ...args].join(" "));
  } else {
    trace(TAG, `skip: ${bin} not found`);
  }
}
trace(TAG, "done");
