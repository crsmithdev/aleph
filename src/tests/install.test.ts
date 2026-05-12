#!/usr/bin/env bun
import { execSync } from "child_process";
import { mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from "fs";
import { resolve } from "path";
import { check, createResults, printAndExit } from "../eval/harness.ts";

const ROOT = resolve(import.meta.dir, "../..");
const BUN = process.argv[0];
const r = createResults();

// ── Install preservation ─────────────────────────────────────────────────────

console.log("--- install preservation ---");

const sentinelPath = resolve(Bun.env.HOME!, ".claude/construct/core/identity/TEST_SENTINEL.md");
const sentinelContent = "# Test Sentinel\n\nThis file tests upgrade preservation.\n";
mkdirSync(resolve(Bun.env.HOME!, ".claude/construct/core/identity"), { recursive: true });
writeFileSync(sentinelPath, sentinelContent);
check(r, "install: sentinel file created", existsSync(sentinelPath));

try {
  execSync(`${BUN} ${resolve(ROOT, "install.ts")}`, { encoding: "utf-8", timeout: 30000, cwd: ROOT, stdio: "pipe" });
  check(r, "install: sentinel survived upgrade", existsSync(sentinelPath));
  check(r, "install: sentinel content preserved", readFileSync(sentinelPath, "utf-8") === sentinelContent);
} catch (err: any) {
  check(r, "install: installer failed", false, err.message?.slice(0, 100));
}
try { unlinkSync(sentinelPath); } catch {}

// ── Identity files ──────────────────────────────────────────────────────────

console.log("\n--- identity files ---");

const identityDir = resolve(ROOT, "src/core/identity");
const expectedIdentity = ["SOUL.md", "STYLE.md", "USER.md"];
for (const f of expectedIdentity) {
  const p = resolve(identityDir, f);
  check(r, `identity: ${f} exists`, existsSync(p));
  if (existsSync(p)) {
    const content = readFileSync(p, "utf-8");
    check(r, `identity: ${f} non-empty`, content.length > 10);
  }
}

const installedIdentityDir = resolve(Bun.env.HOME!, ".claude/construct/core/identity");
if (existsSync(installedIdentityDir)) {
  for (const f of expectedIdentity) {
    const dst = resolve(installedIdentityDir, f);
    if (existsSync(dst)) {
      check(r, `identity: installed ${f} exists and non-empty`, readFileSync(dst, "utf-8").length > 10);
    }
  }
}

printAndExit(r);
