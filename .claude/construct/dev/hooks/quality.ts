#!/usr/bin/env bun
import { existsSync, readFileSync } from "fs";
import { dirname, extname } from "path";
import { execSync } from "child_process";
import { trace } from "../../trace.ts";

const input = JSON.parse(await Bun.stdin.text());
const filePath = input.tool_input?.file_path ?? "";
if (!filePath || !existsSync(filePath)) {
  trace("quality", `skip: ${filePath ? "file not found" : "no file path"}`);
  process.exit(0);
}
trace("quality", `file: ${filePath}`);

function run(cmd: string) {
  try { execSync(cmd, { stdio: "ignore" }); } catch {}
}

function has(bin: string) {
  try { execSync(`which ${bin}`, { stdio: "ignore" }); return true; } catch { return false; }
}

// Check for project-level quality config
let projectRoot = "";
try { projectRoot = execSync(`git -C "${dirname(filePath)}" rev-parse --show-toplevel`, { encoding: "utf8" }).trim(); } catch {}
const config = projectRoot ? `${projectRoot}/.claude/quality.json` : "";

if (config && existsSync(config)) {
  trace("quality", `using project config: ${config}`);
  const rules = JSON.parse(readFileSync(config, "utf8"));
  for (const key of ["format", "lint"] as const) {
    const cmd = rules[key];
    if (cmd) {
      trace("quality", `running ${key}: ${cmd.replace(/\$FILE/g, filePath)}`);
      run(cmd.replace(/\$FILE/g, filePath));
    }
  }
  process.exit(0);
}

// Default formatters by extension
const ext = extname(filePath).slice(1);
trace("quality", `extension: ${ext}`);
const formatters: Record<string, [string, string[]][]> = {
  py:   [["ruff", ["check", "--fix", filePath]], ["ruff", ["format", filePath]]],
  ts:   [["tsc", ["--noEmit"]], ["prettier", ["--write", filePath]]],
  tsx:  [["tsc", ["--noEmit"]], ["prettier", ["--write", filePath]]],
  js:   [["prettier", ["--write", filePath]]],
  jsx:  [["prettier", ["--write", filePath]]],
  go:   [["gofmt", ["-w", filePath]]],
  rs:   [["rustfmt", [filePath]]],
};

for (const [bin, args] of formatters[ext] ?? []) {
  if (has(bin)) {
    trace("quality", `running: ${bin} ${args.join(" ")}`);
    run([bin, ...args].join(" "));
  } else {
    trace("quality", `skip: ${bin} not found`);
  }
}
