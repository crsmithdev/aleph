/**
 * Claude Code JSONL adapter.
 *
 * Reads Claude Code's raw session JSONL files and produces TelemetryEvent[].
 * This is the ONLY code that understands Claude Code's internal message format.
 * If Claude Code changes its log format, only this file needs updating.
 */

import { readdirSync, statSync, readFileSync, existsSync } from "fs";
import { join, basename, dirname } from "path";
import { claudePaths, dataPaths, createDb } from "@construct/data";
import type { TelemetryEvent } from "./event.js";

const DEFAULT_BASE = claudePaths.projects;
const PROJECTS_DIRNAME = basename(claudePaths.projects);

// ---------------------------------------------------------------------------
// SQLite-backed file cache
// ---------------------------------------------------------------------------

const { sqlite: cacheDb } = createDb(dataPaths.db);
cacheDb.exec(`DROP TABLE IF EXISTS telemetry_cache`);
cacheDb.exec(`DROP TABLE IF EXISTS telemetry_cache_v4`);
cacheDb.exec(`DROP TABLE IF EXISTS telemetry_cache_v5`);
cacheDb.exec(`DROP TABLE IF EXISTS telemetry_cache_v6`);
cacheDb.exec(`
  CREATE TABLE IF NOT EXISTS telemetry_cache_v6 (
    file_path TEXT PRIMARY KEY,
    mtime_ms INTEGER NOT NULL,
    size INTEGER NOT NULL,
    events TEXT NOT NULL
  )
`);

const insertCache = cacheDb.prepare(
  `INSERT OR REPLACE INTO telemetry_cache_v6 (file_path, mtime_ms, size, events) VALUES (?, ?, ?, ?)`
);
const selectCache = cacheDb.prepare(
  `SELECT mtime_ms, size, events FROM telemetry_cache_v6 WHERE file_path = ?`
);

// ---------------------------------------------------------------------------
// Filesystem discovery cache (30s TTL)
// ---------------------------------------------------------------------------

interface DiscoveryCache {
  files: string[];
  expiresAt: number;
  baseDir: string;
  sinceMs: number | undefined;
}

let discoveryCache: DiscoveryCache | undefined;

function discoverJsonlFilesCached(baseDir: string, since?: Date): string[] {
  const sinceMs = since?.getTime();
  const now = Date.now();
  if (
    discoveryCache &&
    discoveryCache.baseDir === baseDir &&
    discoveryCache.sinceMs === sinceMs &&
    now < discoveryCache.expiresAt
  ) {
    return discoveryCache.files;
  }
  const files = discoverJsonlFiles(baseDir, since);
  discoveryCache = { files, expiresAt: now + 30_000, baseDir, sinceMs };
  return files;
}

function discoverJsonlFiles(baseDir: string, since?: Date): string[] {
  const files: string[] = [];
  let dirs: string[];
  try {
    dirs = readdirSync(baseDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(baseDir, d.name));
  } catch {
    return files;
  }

  for (const projDir of dirs) {
    try {
      for (const entry of readdirSync(projDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
        const fullPath = join(projDir, entry.name);
        if (since) {
          try { if (statSync(fullPath).mtimeMs < since.getTime()) continue; } catch { continue; }
        }
        files.push(fullPath);
      }
    } catch { continue; }

    try {
      for (const sessionDir of readdirSync(projDir, { withFileTypes: true })) {
        if (!sessionDir.isDirectory()) continue;
        const subagentDir = join(projDir, sessionDir.name, "subagents");
        try {
          for (const sub of readdirSync(subagentDir, { withFileTypes: true })) {
            if (!sub.isFile() || !sub.name.endsWith(".jsonl")) continue;
            const fullPath = join(subagentDir, sub.name);
            if (since) {
              try { if (statSync(fullPath).mtimeMs < since.getTime()) continue; } catch { continue; }
            }
            files.push(fullPath);
          }
        } catch { continue; }
      }
    } catch { continue; }
  }

  return files;
}

// ---------------------------------------------------------------------------
// Path-based metadata extraction
// ---------------------------------------------------------------------------

function projectFromPath(filePath: string): string {
  const parts = filePath.split("/");
  const projectsIdx = parts.indexOf(PROJECTS_DIRNAME);
  if (projectsIdx >= 0 && projectsIdx + 1 < parts.length) return parts[projectsIdx + 1];
  return basename(dirname(filePath));
}

function sessionIdFromPath(filePath: string): string | undefined {
  const name = basename(filePath, ".jsonl");
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(name)) return name;
  if (name.startsWith("agent-")) return name;
  return undefined;
}

function parentSessionIdFromPath(filePath: string): string | undefined {
  if (!filePath.includes("/subagents/")) return undefined;
  const parent = basename(dirname(dirname(filePath)));
  if (/^[0-9a-f]{8}-/.test(parent)) return parent;
  return undefined;
}

// ---------------------------------------------------------------------------
// Line-level adaptation: Claude Code JSONL → TelemetryEvent[]
// ---------------------------------------------------------------------------

/**
 * Derive a semantic hook decision from exit code and stdout output.
 * Stop hooks signal blocks via stdout JSON; PreToolUse/PostToolUse use exit 2.
 */
function deriveHookDecision(exitCode: number | undefined, output: string | undefined): "pass" | "block" | "crash" {
  if (output) {
    try {
      const parsed = JSON.parse(output.trim());
      if (parsed?.decision === "block") return "block";
    } catch { /* not JSON */ }
  }
  if (exitCode === 2) return "block";
  if (exitCode !== undefined && exitCode !== 0) return "crash";
  return "pass";
}

/**
 * Extract a clean hook name from a shell command string.
 * Command format: "bun /path/to/hook.ts 2>/dev/null" or similar.
 * Naive split("/").pop() fails when the command ends with "2>/dev/null",
 * yielding the literal string "null".
 */
function hookBasename(command: string | null | undefined): string {
  if (!command) return "unknown";
  // Find the first token that looks like a script file path (.ts / .js / .sh)
  const tokens = command.split(/\s+/);
  const script = tokens.find((t) => /\.(ts|js|sh|py)$/.test(t) && t.includes("/"));
  if (script) return script.split("/").pop()!.replace(/\.(ts|js|sh|py)$/, "");
  // Fallback: first path-like token that isn't a redirect
  const path = tokens.find((t) => t.startsWith("/") && !t.startsWith("/dev/"));
  if (path) return path.split("/").pop() || "unknown";
  return "unknown";
}

function adaptLine(
  line: string,
  project: string,
  fallbackSessionId?: string,
  parentSessionId?: string,
): TelemetryEvent[] {
  const events: TelemetryEvent[] = [];
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(line); } catch { return events; }

  const sid = parentSessionId
    ? (fallbackSessionId || (raw.sessionId as string) || "unknown")
    : ((raw.sessionId as string) || fallbackSessionId || "unknown");
  const ts = (raw.timestamp as string) || "";
  const gitBranch = (raw.gitBranch as string) || undefined;
  const cwd = (raw.cwd as string) || undefined;

  // Metadata fields attached to every event from this line
  const meta: Record<string, unknown> = { project };
  if (parentSessionId) meta.parentSessionId = parentSessionId;
  if (gitBranch) meta.gitBranch = gitBranch;
  if (cwd) meta.cwd = cwd;

  if (raw.type === "assistant") {
    const message = raw.message as Record<string, unknown> | undefined;
    if (!message) return events;

    const model = (message.model as string) || undefined;
    const usage = message.usage as Record<string, number> | undefined;

    if (usage) {
      events.push({
        ts, sid, kind: "tokens", name: model || "unknown",
        data: {
          ...meta,
          model: model || "unknown",
          input: usage.input_tokens || 0,
          output: usage.output_tokens || 0,
          cacheRead: usage.cache_read_input_tokens || 0,
          cacheCreation: usage.cache_creation_input_tokens || 0,
        },
      });
    }

    const content = message.content as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === "tool_use") {
          const toolName = block.name as string;
          const input = block.input as Record<string, unknown> | undefined;

          // Lines changed estimation for Edit/Write
          let linesAdded: number | undefined;
          let linesRemoved: number | undefined;
          if (toolName === "Edit" && input) {
            const oldStr = (input.old_string as string) || "";
            const newStr = (input.new_string as string) || "";
            linesRemoved = oldStr.split("\n").length;
            linesAdded = newStr.split("\n").length;
          } else if (toolName === "Write" && input) {
            const c = (input.content as string) || "";
            linesAdded = c.split("\n").length;
          }

          // Skill detection
          const isSkill = toolName === "Skill";
          const skillName = isSkill ? (input?.skill as string) || undefined : undefined;

          const toolData: Record<string, unknown> = {
            ...meta,
            tool: toolName,
            useId: (block.id as string) || undefined,
            params: input || undefined,
            model,
          };
          if (linesAdded !== undefined) toolData.linesAdded = linesAdded;
          if (linesRemoved !== undefined) toolData.linesRemoved = linesRemoved;
          if (skillName) toolData.skill = skillName;

          events.push({
            ts, sid, kind: "tool", name: skillName ? `Skill(${skillName})` : toolName,
            data: toolData,
          });
        }
      }

      // Capture assistant text
      const textParts: string[] = [];
      for (const block of content) {
        if (block.type === "text" && typeof block.text === "string") {
          textParts.push(block.text as string);
        }
      }
      if (textParts.length > 0) {
        events.push({
          ts, sid, kind: "message", name: "assistant",
          data: { ...meta, text: textParts.join("\n").slice(0, 2000), role: "assistant" },
        });
      }
    }
  }

  if (raw.type === "user" && !raw.isCompactSummary) {
    const message = raw.message as Record<string, unknown> | undefined;
    if (message) {
      const content = message.content;
      let userText: string | undefined;

      if (typeof content === "string") {
        userText = content;
      } else if (Array.isArray(content)) {
        const textParts: string[] = [];
        for (const block of content as Array<Record<string, unknown>>) {
          if (block.type === "text" && typeof block.text === "string") {
            textParts.push(block.text);
          }
          if (block.type === "tool_result") {
            const toolUseId = (block.tool_use_id as string) || undefined;
            const toolUseResult = (raw as Record<string, unknown>).toolUseResult as Record<string, unknown> | undefined;
            const toolDurationMs = toolUseResult?.totalDurationMs as number | undefined;

            // Count result content size for token estimation
            const rawContent = block.content;
            let resultChars = 0;
            if (typeof rawContent === "string") {
              resultChars = rawContent.length;
            } else if (Array.isArray(rawContent)) {
              for (const b of rawContent as Array<Record<string, unknown>>) {
                if (b.type === "text" && typeof b.text === "string") resultChars += (b.text as string).length;
              }
            }

            // Capture result content text (capped at 8KB) for memory tool observability
            const RESULT_CONTENT_CAP = 8192;
            let resultContent: string | undefined;
            if (resultChars <= RESULT_CONTENT_CAP) {
              if (typeof rawContent === "string") {
                resultContent = rawContent;
              } else if (Array.isArray(rawContent)) {
                const parts: string[] = [];
                for (const b of rawContent as Array<Record<string, unknown>>) {
                  if (b.type === "text" && typeof b.text === "string") parts.push(b.text as string);
                }
                if (parts.length > 0) resultContent = parts.join("");
              }
            }

            if (block.is_error) {
              const errorMessage = typeof rawContent === "string"
                ? rawContent.slice(0, 200)
                : Array.isArray(rawContent)
                  ? (rawContent.find((b: Record<string, unknown>) => b.type === "text")?.text as string ?? "").slice(0, 200)
                  : undefined;
              events.push({
                ts, sid, kind: "tool_result", name: "error",
                err: errorMessage || undefined,
                ms: toolDurationMs,
                data: { ...meta, useId: toolUseId, isError: true, errorMessage: errorMessage || undefined, resultChars, resultContent },
              });
            } else if (toolUseId) {
              events.push({
                ts, sid, kind: "tool_result", name: "ok",
                ms: toolDurationMs,
                data: { ...meta, useId: toolUseId, resultChars, resultContent },
              });
            }
          }
        }
        if (textParts.length > 0) userText = textParts.join("\n");
      }

      if (userText) {
        // Stop-hook feedback is injected as a user message by Claude Code but is not a real user turn.
        // Emit as hook_feedback so it doesn't create a fake turn boundary in the trace.
        const isHookFeedback =
          userText.startsWith("Stop hook feedback:") ||
          userText.startsWith("Stop hook blocking error:");
        if (isHookFeedback) {
          events.push({
            ts, sid, kind: "hook_feedback", name: "blocked",
            data: { ...meta, text: userText.slice(0, 500) },
          });
        } else {
          events.push({
            ts, sid, kind: "message", name: "user",
            data: { ...meta, text: userText.slice(0, 500), role: "user" },
          });
        }
      }
    }
  }

  if (raw.type === "progress") {
    const data = raw.data as Record<string, unknown> | undefined;
    if (data?.type === "hook_progress") {
      events.push({
        ts, sid, kind: "hook", name: hookBasename(data.command as string),
        data: {
          ...meta,
          event: (data.hookEvent as string) || undefined,
          hookName: (data.hookName as string) || undefined,
          command: (data.command as string) || undefined,
        },
      });
    }
  }

  if (raw.type === "system") {
    if (raw.subtype === "stop_hook_summary") {
      const hookInfos = raw.hookInfos as Array<Record<string, unknown>> | undefined;
      const hookErrors = raw.hookErrors as string[] | undefined;
      const hasHookErrors = Array.isArray(hookErrors) && hookErrors.length > 0;

      if (Array.isArray(hookInfos)) {
        for (const info of hookInfos) {
          const exitCode = info.exitCode !== undefined ? (info.exitCode as number) : undefined;
          const output = (info.output as string) || undefined;
          const decision = deriveHookDecision(exitCode, output);
          const isError = decision === "crash" || hasHookErrors;
          events.push({
            ts, sid, kind: "hook_summary",
            name: hookBasename(info.command as string),
            ms: (info.durationMs as number) || undefined,
            err: isError ? (hasHookErrors ? hookErrors!.join("\n").slice(0, 200) : `crash(${exitCode})`) : undefined,
            data: {
              ...meta,
              command: (info.command as string) || undefined,
              exitCode,
              output,
              isError: isError || undefined,
              hookDecision: decision,
            },
          });
        }
      } else if (hasHookErrors) {
        events.push({
          ts, sid, kind: "hook_summary", name: "unknown",
          err: hookErrors!.join("\n").slice(0, 200),
          data: { ...meta, isError: true, hookDecision: "crash" as const },
        });
      }
    }

    if (raw.subtype === "turn_duration") {
      events.push({
        ts, sid, kind: "turn", name: "duration",
        ms: (raw.durationMs as number) || undefined,
        data: { ...meta, durationMs: (raw.durationMs as number) || 0 },
      });
    }

    if (raw.subtype === "compact_boundary") {
      const compactMeta = raw.compactMetadata as Record<string, unknown> | undefined;
      events.push({
        ts, sid, kind: "compact", name: (compactMeta?.trigger as string) || "unknown",
        data: {
          ...meta,
          trigger: (compactMeta?.trigger as string) || "unknown",
          preTokens: (compactMeta?.preTokens as number) || undefined,
        },
      });
    }
  }

  return events;
}

// ---------------------------------------------------------------------------
// File-level adaptation with caching
// ---------------------------------------------------------------------------

function adaptFile(filePath: string, project: string, since?: Date): TelemetryEvent[] {
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(filePath);
  } catch {
    return [];
  }

  const cached = selectCache.get(filePath) as { mtime_ms: number; size: number; events: string } | undefined;
  if (cached && cached.mtime_ms === stat.mtimeMs && cached.size === stat.size) {
    const events = JSON.parse(cached.events) as TelemetryEvent[];
    if (since) {
      const cutoff = since.toISOString();
      return events.filter((e) => e.ts >= cutoff);
    }
    return events;
  }

  let content: string;
  try { content = readFileSync(filePath, "utf-8"); } catch { return []; }

  const fallbackSessionId = sessionIdFromPath(filePath);
  const parentId = parentSessionIdFromPath(filePath);
  const rawEvents: TelemetryEvent[] = [];

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    rawEvents.push(...adaptLine(line, project, fallbackSessionId, parentId));
  }

  // Build useId → tool_result map for joining duration/error onto tool events
  const toolResults = new Map<string, { ms?: number; err?: string; ts: string }>();
  for (const e of rawEvents) {
    if (e.kind === "tool_result" && e.data?.useId) {
      toolResults.set(e.data.useId as string, { ms: e.ms, err: e.err, ts: e.ts });
    }
  }

  // Attach last user message text and tool_result data to skill invocations
  const lastUserMsg = new Map<string, string>();
  for (const e of rawEvents) {
    if (e.kind === "message" && e.data?.role === "user" && e.data?.text) {
      lastUserMsg.set(e.sid, e.data.text as string);
    }
    if (e.kind === "tool" && e.data?.skill) {
      e.data.userRequest = lastUserMsg.get(e.sid);
      if (e.data.useId) {
        const result = toolResults.get(e.data.useId as string);
        if (result) {
          if (result.ms != null) {
            e.ms = result.ms;
          } else {
            // Estimate duration from timestamp delta (tool_use → tool_result)
            const delta = new Date(result.ts).getTime() - new Date(e.ts).getTime();
            if (delta > 0) e.ms = delta;
          }
          if (result.err) e.err = result.err;
        }
      }
    }
  }

  // Enrich compact events with tool call count and context% up to that point
  const toolCountBySid = new Map<string, number>();
  for (const e of rawEvents) {
    if (e.kind === "tool") {
      toolCountBySid.set(e.sid, (toolCountBySid.get(e.sid) || 0) + 1);
    }
    if (e.kind === "compact" && e.data) {
      e.data.toolCallCount = toolCountBySid.get(e.sid) || 0;
      const preTokens = e.data.preTokens as number | undefined;
      if (preTokens) {
        e.data.contextPct = Math.round(preTokens / 200_000 * 100);
      }
    }
  }

  insertCache.run(filePath, stat.mtimeMs, stat.size, JSON.stringify(rawEvents));

  if (since) {
    const cutoff = since.toISOString();
    return rawEvents.filter((e) => e.ts >= cutoff);
  }
  return rawEvents;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface AdaptOptions {
  since?: Date;
  projects?: string[];
  baseDir?: string;
  includeEvents?: boolean;  // default true; set false for fixture-isolated tests
}

const fileCache = new Map<string, { mtimeMs: number; events: TelemetryEvent[] }>();

/**
 * Map a hook-events.jsonl entry to a TelemetryEvent kind.
 * Centralizes the schema for `events.jsonl` consumers (routes/observability.ts
 * filters by these kinds; no route reads the file directly).
 */
function eventKindFor(hook: string, entry: Record<string, unknown>): { kind: string; name: string } {
  // Gate hooks self-identify by setting `tier` (verify-gate, quality-check) or
  // a `decision` value with a tier field. The git-require-edit hook is its own kind.
  if (hook === "git-require-edit") return { kind: "gate_marker", name: hook };
  if (hook === "feedback-capture-submit" && entry.polarity) {
    return { kind: "feedback", name: (entry.polarity as string) || hook };
  }
  if (hook === "rating-capture-submit" && entry.rating !== undefined) {
    return { kind: "rating", name: `rating:${entry.rating}` };
  }
  if (hook === "signal-capture" && entry.file) {
    return { kind: "re_edit", name: entry.file as string };
  }
  if (hook === "memory-extract-stop" && entry.memoryId) {
    return { kind: "memory_write", name: (entry.memoryType as string) || "session" };
  }
  if (hook === "routing-classify-submit" && Array.isArray(entry.directives)) {
    return { kind: "directive", name: (entry.directives as string[]).join(", ") };
  }
  if (hook === "context-backup-precompact" && (entry.workingFiles || entry.recentPrompts)) {
    return { kind: "compaction", name: hook };
  }
  // Anything with a tier/decision pair from a quality / verify gate
  const tier = entry.tier;
  const decision = entry.decision as string | undefined;
  if (tier !== undefined && decision && ["block", "pass", "skip", "advisory"].includes(decision)) {
    return { kind: "gate", name: hook };
  }
  // verify-gate / quality-check-stop entries without explicit tier
  if (hook.includes("quality-check") || hook.includes("verify-gate")) {
    return { kind: "gate", name: hook };
  }
  return { kind: "hook_event", name: hook };
}

function readEvents(since?: Date): TelemetryEvent[] {
  const filePath = dataPaths.events;
  if (!existsSync(filePath)) return [];
  const cached = fileCache.get(filePath);
  const stat = statSync(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    if (since) {
      const cutoff = since.toISOString();
      return cached.events.filter((e) => e.ts >= cutoff);
    }
    return cached.events;
  }

  const events: TelemetryEvent[] = [];
  try {
    const lines = readFileSync(filePath, "utf-8").split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        const ts = (entry.ts as string) || "";
        const hook = (entry.hook as string) || "unknown";
        const sid = (entry.sessionId as string) || "unknown";
        if (!ts) continue;
        const { kind, name } = eventKindFor(hook, entry);
        // Strip the envelope fields from the data payload so callers see a clean meta surface.
        const { ts: _ts, hook: _hook, event: _event, sessionId: _sid, ...rest } = entry;
        events.push({ ts, sid, kind, name, data: { hook, event: entry.event as string | undefined, ...rest } });
      } catch {}
    }
  } catch {}
  fileCache.set(filePath, { mtimeMs: stat.mtimeMs, events });
  if (since) {
    const cutoff = since.toISOString();
    return events.filter((e) => e.ts >= cutoff);
  }
  return events;
}

// ---------------------------------------------------------------------------
// Event corpus cache (60s TTL — amortizes the 8s corpus load across requests)
// ---------------------------------------------------------------------------

interface CorpusCache {
  events: TelemetryEvent[];
  expiresAt: number;
  key: string;
}

let corpusCache: CorpusCache | undefined;

function corpusCacheKey(opts?: AdaptOptions): string {
  return `${opts?.baseDir ?? ""}|${opts?.since?.getTime() ?? ""}|${(opts?.projects ?? []).join(",")}`;
}

export function clearCache(): void {
  cacheDb.exec("DELETE FROM telemetry_cache_v6");
  fileCache.clear();
  discoveryCache = undefined;
  corpusCache = undefined;
}

export function adaptAllSessions(opts?: AdaptOptions): TelemetryEvent[] {
  const key = corpusCacheKey(opts);
  const now = Date.now();
  if (corpusCache && corpusCache.key === key && now < corpusCache.expiresAt) {
    return corpusCache.events;
  }

  const baseDir = opts?.baseDir || DEFAULT_BASE;
  const files = discoverJsonlFilesCached(baseDir, opts?.since);

  const allEvents: TelemetryEvent[] = [];
  for (const file of files) {
    const project = projectFromPath(file);
    if (opts?.projects && !opts.projects.includes(project)) continue;
    allEvents.push(...adaptFile(file, project, opts?.since));
  }

  if (opts?.includeEvents !== false) allEvents.push(...readEvents(opts?.since));
  corpusCache = { events: allEvents, expiresAt: Date.now() + 60_000, key };
  return allEvents;
}

export function adaptSessionsForDays(days: number, opts?: Omit<AdaptOptions, "since">): TelemetryEvent[] {
  // Round to the nearest minute so concurrent requests share the same corpus cache key.
  const since = new Date(Math.floor(Date.now() / 60_000) * 60_000);
  since.setDate(since.getDate() - days);
  return adaptAllSessions({ ...opts, since });
}

