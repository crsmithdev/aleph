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
cacheDb.exec(`
  CREATE TABLE IF NOT EXISTS telemetry_cache (
    file_path TEXT PRIMARY KEY,
    mtime_ms INTEGER NOT NULL,
    size INTEGER NOT NULL,
    events TEXT NOT NULL
  )
`);

const insertCache = cacheDb.prepare(
  `INSERT OR REPLACE INTO telemetry_cache (file_path, mtime_ms, size, events) VALUES (?, ?, ?, ?)`
);
const selectCache = cacheDb.prepare(
  `SELECT mtime_ms, size, events FROM telemetry_cache WHERE file_path = ?`
);

export function clearCache(): void {
  cacheDb.exec("DELETE FROM telemetry_cache");
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

            if (block.is_error) {
              const rawContent = block.content;
              const errorMessage = typeof rawContent === "string"
                ? rawContent.slice(0, 200)
                : Array.isArray(rawContent)
                  ? (rawContent.find((b: any) => b.type === "text")?.text ?? "").slice(0, 200)
                  : undefined;
              events.push({
                ts, sid, kind: "tool_result", name: "error",
                err: errorMessage || undefined,
                ms: toolDurationMs,
                data: { ...meta, useId: toolUseId, isError: true, errorMessage: errorMessage || undefined },
              });
            } else if (toolUseId) {
              events.push({
                ts, sid, kind: "tool_result", name: "ok",
                ms: toolDurationMs,
                data: { ...meta, useId: toolUseId },
              });
            }
          }
        }
        if (textParts.length > 0) userText = textParts.join("\n");
      }

      if (userText) {
        events.push({
          ts, sid, kind: "message", name: "user",
          data: { ...meta, text: userText.slice(0, 500), role: "user" },
        });
      }
    }
  }

  if (raw.type === "progress") {
    const data = raw.data as Record<string, unknown> | undefined;
    if (data?.type === "hook_progress") {
      events.push({
        ts, sid, kind: "hook", name: (data.command as string)?.split("/").pop() || "unknown",
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
          const isError = (exitCode !== undefined && exitCode !== 0) || hasHookErrors;
          events.push({
            ts, sid, kind: "hook_summary",
            name: (info.command as string)?.split("/").pop() || "unknown",
            ms: (info.durationMs as number) || undefined,
            err: isError ? (hasHookErrors ? hookErrors!.join("\n").slice(0, 200) : `exit ${exitCode}`) : undefined,
            data: {
              ...meta,
              command: (info.command as string) || undefined,
              exitCode,
              output: (info.output as string) || undefined,
              isError: isError || undefined,
            },
          });
        }
      } else if (hasHookErrors) {
        events.push({
          ts, sid, kind: "hook_summary", name: "unknown",
          err: hookErrors!.join("\n").slice(0, 200),
          data: { ...meta, isError: true },
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

  // Attach last user message text to skill invocations
  const lastUserMsg = new Map<string, string>();
  for (const e of rawEvents) {
    if (e.kind === "message" && e.data?.role === "user" && e.data?.text) {
      lastUserMsg.set(e.sid, e.data.text as string);
    }
    if (e.kind === "tool" && e.data?.skill) {
      e.data.userRequest = lastUserMsg.get(e.sid);
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
}

const fileCache = new Map<string, { mtimeMs: number; events: TelemetryEvent[] }>();

function readDirectives(since?: Date): TelemetryEvent[] {
  const filePath = dataPaths.directives;
  if (!existsSync(filePath)) return [];
  const cached = fileCache.get(filePath);
  const stat = statSync(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.events;

  const events: TelemetryEvent[] = [];
  try {
    const lines = readFileSync(filePath, "utf-8").split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as { ts: string; sessionId: string; directives: string[]; promptWords: number };
        if (since && entry.ts < since.toISOString()) continue;
        events.push({
          ts: entry.ts,
          sid: entry.sessionId,
          kind: "directive",
          name: entry.directives.join(", "),
          data: {
            directives: entry.directives,
            promptWords: entry.promptWords,
          },
        });
      } catch {}
    }
  } catch {}
  fileCache.set(filePath, { mtimeMs: stat.mtimeMs, events });
  return events;
}

export function adaptAllSessions(opts?: AdaptOptions): TelemetryEvent[] {
  const baseDir = opts?.baseDir || DEFAULT_BASE;
  const files = discoverJsonlFiles(baseDir, opts?.since);

  const allEvents: TelemetryEvent[] = [];
  for (const file of files) {
    const project = projectFromPath(file);
    if (opts?.projects && !opts.projects.includes(project)) continue;
    allEvents.push(...adaptFile(file, project, opts?.since));
  }

  allEvents.push(...readDirectives(opts?.since));
  return allEvents;
}

export function adaptSessionsForDays(days: number, opts?: Omit<AdaptOptions, "since">): TelemetryEvent[] {
  const since = new Date();
  since.setDate(since.getDate() - days);
  return adaptAllSessions({ ...opts, since });
}

