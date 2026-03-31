#!/usr/bin/env bun
/**
 * PreToolUse hook: destructive SQL blocker.
 *
 * Inspects MCP tool calls that execute SQL (execute_sql, apply_migration,
 * run_query). Extracts the SQL string from common parameter names, converts
 * to uppercase, and checks against a blocklist of destructive patterns:
 *   DROP TABLE/DATABASE/SCHEMA, TRUNCATE, DELETE without WHERE, ALTER DROP COLUMN.
 *
 * Non-SQL tools or safe queries → exit 0 (allow).
 * Destructive match → exit 2 (hard block with description of what was caught).
 */
import { trace } from "../../trace.ts";
import { reportHook } from "../../hook-report.ts";

const TAG = "isolation-pre-block-destructive-sql";
let input: any;
try { input = JSON.parse(await Bun.stdin.text()); }
catch (e) {
  const msg = `[${TAG}] stdin parse failed: ${(e as Error).message}`;
  console.error(msg);
  trace(TAG, msg);
  process.exit(1);
}
reportHook(TAG, "PreToolUse", input.session_id);

const toolName = input.tool_name ?? "";
const toolInput = input.tool_input ?? {};

// Only inspect SQL-related MCP tools
if (!toolName.includes("execute_sql") && !toolName.includes("apply_migration") && !toolName.includes("run_query")) {
  process.exit(0);
}

// Extract SQL from common parameter names
const sql = (toolInput.query || toolInput.sql || toolInput.statement || toolInput.content || "").toString().toUpperCase();
if (!sql) { trace(TAG, "no SQL found in tool input"); process.exit(0); }

// Destructive patterns to block
const patterns: Array<{ regex: RegExp; description: string }> = [
  { regex: /\bDROP\s+(TABLE|DATABASE|SCHEMA)\b/, description: "DROP TABLE/DATABASE/SCHEMA" },
  { regex: /\bTRUNCATE\s+/, description: "TRUNCATE" },
  { regex: /\bDELETE\s+FROM\s+\S+\s*(?:;|$)/, description: "DELETE without WHERE clause" },
  { regex: /\bALTER\s+TABLE\s+\S+\s+DROP\s+COLUMN\b/, description: "ALTER TABLE DROP COLUMN" },
];

for (const { regex, description } of patterns) {
  if (regex.test(sql)) {
    console.log(`[Construct] Blocked: ${description} detected in SQL query. This is a destructive operation that requires manual execution.`);
    trace(TAG, `blocked: ${description}`);
    process.exit(2);
  }
}

trace(TAG, "sql ok");
process.exit(0);
