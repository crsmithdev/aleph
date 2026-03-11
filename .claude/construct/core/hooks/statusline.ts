#!/usr/bin/env bun
import { execSync } from "child_process";

const stdin = await Bun.stdin.text();

// Delegate to ccstatusline if installed
try {
  const out = execSync("ccstatusline", { input: stdin, encoding: "utf8", timeout: 2000 });
  process.stdout.write(out);
  process.exit(0);
} catch {}

// Fallback: minimal statusline
const input = JSON.parse(stdin);
const model = input.model?.display_name ?? "?";
const cwd = input.cwd ?? input.workspace?.current_dir ?? "?";
const pct = Math.round(input.context_window?.used_percentage ?? 0);
const bar = "█".repeat(Math.floor(pct / 10)) + "░".repeat(10 - Math.floor(pct / 10));

let branch = "";
try { branch = execSync(`git -C "${cwd}" rev-parse --abbrev-ref HEAD`, { encoding: "utf8" }).trim(); } catch {}

const dir = cwd.split("/").pop();
const parts = [model, branch && `⎇ ${branch}`, dir, `[${bar}] ${pct}%`].filter(Boolean);
console.log(parts.join("  "));
