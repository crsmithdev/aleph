#!/usr/bin/env bun
/** docs gate: EVENTS.md fresh, example config valid, design doc references real paths. */
import { existsSync, readFileSync } from "node:fs";
import { loadConfig } from "../src/core/config.ts";

let failed = false;
const fail = (msg: string) => { console.error(`docs:check FAIL ${msg}`); failed = true; };
const ok = (msg: string) => console.log(`docs:check ok   ${msg}`);

const gen = Bun.spawnSync(["bun", "scripts/gen-events-doc.ts", "--check"]);
if (gen.exitCode !== 0) fail(gen.stderr.toString().trim() || "EVENTS.md stale");
else ok("docs/EVENTS.md matches the kind registry");

try {
  loadConfig({
    file: "config/aleph.example.toml", host: "no-such-host",
    env: { TELEGRAM_BOT_TOKEN: "x", TELEGRAM_CHAT_ID: "x", TELEGRAM_OWNER_ID: "x", LANGFUSE_PROJECT_ID: "x", LANGFUSE_OTLP_AUTH: "x" },
  });
  loadConfig({ file: "config/aleph.toml", host: "no-such-host", env: {} });
  ok("config/aleph.toml and config/aleph.example.toml validate");
} catch (e) {
  fail(`example config invalid: ${e instanceof Error ? e.message : String(e)}`);
}

// Every source file named in the design doc's repo-layout tree must exist. A
// design doc pointing at files that were never written is worse than none.
const design = readFileSync("docs/design/phase-1.md", "utf8");
const layout = /## 3\. Repo layout\n+```([\s\S]*?)```/.exec(design)?.[1] ?? "";
const named = [...new Set([...layout.matchAll(/([A-Za-z0-9._-]+\.(?:ts|toml|yml|json|md))/g)].map((m) => m[1]!))];
const found = new Set(
  Bun.spawnSync(["bash", "-c", "find src tests scripts config compose docs .github -type f 2>/dev/null | xargs -n1 basename"])
    .stdout.toString().split("\n").filter(Boolean),
);
const extra = ["package.json", "tsconfig.json", "bunfig.toml", "README.md", "AGENTS.md", "CLAUDE.md"];
const missing = named.filter((n) => !found.has(n) && !extra.includes(n));
if (missing.length) fail(`design doc names files that do not exist: ${missing.join(", ")}`);
else ok(`design doc names ${named.length} files, all present`);

process.exit(failed ? 1 : 0);
