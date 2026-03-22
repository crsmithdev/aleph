import { readdirSync, statSync, readFileSync } from "fs";
import { join, basename, dirname } from "path";
import { homedir } from "os";
import type { SessionEntry, ParseOptions } from "./types.js";

const DEFAULT_BASE = join(homedir(), ".claude", "projects");

interface CacheEntry {
  mtimeMs: number;
  entries: SessionEntry[];
}

const fileCache = new Map<string, CacheEntry>();

export function clearCache(): void {
  fileCache.clear();
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
    // Main session files
    try {
      for (const entry of readdirSync(projDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
        const fullPath = join(projDir, entry.name);
        if (since) {
          try {
            const stat = statSync(fullPath);
            if (stat.mtimeMs < since.getTime()) continue;
          } catch {
            continue;
          }
        }
        files.push(fullPath);
      }
    } catch {
      continue;
    }

    // Subagent files
    try {
      for (const sessionDir of readdirSync(projDir, { withFileTypes: true })) {
        if (!sessionDir.isDirectory()) continue;
        const subagentDir = join(projDir, sessionDir.name, "subagents");
        try {
          for (const sub of readdirSync(subagentDir, { withFileTypes: true })) {
            if (!sub.isFile() || !sub.name.endsWith(".jsonl")) continue;
            const fullPath = join(subagentDir, sub.name);
            if (since) {
              try {
                const stat = statSync(fullPath);
                if (stat.mtimeMs < since.getTime()) continue;
              } catch {
                continue;
              }
            }
            files.push(fullPath);
          }
        } catch {
          continue;
        }
      }
    } catch {
      continue;
    }
  }

  return files;
}

function projectFromPath(filePath: string): string {
  // Path: baseDir/projectName/sessionId.jsonl
  // or:   baseDir/projectName/sessionId/subagents/agent.jsonl
  const parts = filePath.split("/");
  const projectsIdx = parts.indexOf("projects");
  if (projectsIdx >= 0 && projectsIdx + 1 < parts.length) {
    return parts[projectsIdx + 1];
  }
  return basename(dirname(filePath));
}

function parseLine(line: string, project: string): SessionEntry[] {
  const entries: SessionEntry[] = [];
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(line);
  } catch {
    return entries;
  }

  const sessionId = (raw.sessionId as string) || "unknown";
  const timestamp = (raw.timestamp as string) || "";

  if (raw.type === "assistant") {
    const message = raw.message as Record<string, unknown> | undefined;
    if (!message) return entries;

    const model = (message.model as string) || undefined;
    const usage = message.usage as Record<string, number> | undefined;

    if (usage) {
      entries.push({
        sessionId,
        timestamp,
        project,
        model,
        entryType: "tokens",
        inputTokens: usage.input_tokens || 0,
        outputTokens: usage.output_tokens || 0,
        cacheReadTokens: usage.cache_read_input_tokens || 0,
        cacheCreationTokens: usage.cache_creation_input_tokens || 0,
      });
    }

    const content = message.content as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === "tool_use") {
          const toolName = block.name as string;
          const input = block.input as Record<string, unknown> | undefined;
          const isSkill = toolName === "Skill";
          const skillName = isSkill
            ? (input?.skill as string) || undefined
            : undefined;

          entries.push({
            sessionId,
            timestamp,
            project,
            model,
            entryType: "tool_use",
            toolName,
            skillName,
            toolParams: input || undefined,
          });
        }
      }
    }
  }

  if (raw.type === "user") {
    const message = raw.message as Record<string, unknown> | undefined;
    if (message) {
      const content = message.content as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "tool_result" && block.is_error) {
            entries.push({
              sessionId,
              timestamp,
              project,
              entryType: "tool_result",
              isError: true,
            });
          }
        }
      }
    }
  }

  if (raw.type === "progress") {
    const data = raw.data as Record<string, unknown> | undefined;
    if (data?.type === "hook_progress") {
      entries.push({
        sessionId,
        timestamp,
        project,
        entryType: "hook_progress",
        hookEvent: (data.hookEvent as string) || undefined,
        hookName: (data.hookName as string) || undefined,
        hookCommand: (data.command as string) || undefined,
      });
    }
  }

  if (raw.type === "system") {
    if (raw.subtype === "stop_hook_summary") {
      const hookInfos = raw.hookInfos as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(hookInfos)) {
        for (const info of hookInfos) {
          entries.push({
            sessionId,
            timestamp,
            project,
            entryType: "stop_hook_summary",
            hookCommand: (info.command as string) || undefined,
            hookDurationMs: (info.durationMs as number) || undefined,
            hookExitCode: info.exitCode !== undefined ? (info.exitCode as number) : undefined,
            hookOutput: (info.output as string) || undefined,
            isError: (info.exitCode as number) !== 0 && info.exitCode !== undefined ? true : undefined,
          });
        }
      }
    }

    if (raw.subtype === "turn_duration") {
      entries.push({
        sessionId,
        timestamp,
        project,
        entryType: "turn_duration",
        turnDurationMs: (raw.durationMs as number) || undefined,
      });
    }
  }

  return entries;
}

function parseFile(filePath: string, project: string): SessionEntry[] {
  const stat = statSync(filePath);
  const cached = fileCache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    return cached.entries;
  }

  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }

  const entries: SessionEntry[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    entries.push(...parseLine(line, project));
  }

  fileCache.set(filePath, { mtimeMs: stat.mtimeMs, entries });
  return entries;
}

export function parseAllSessions(opts?: ParseOptions): SessionEntry[] {
  const baseDir = opts?.baseDir || DEFAULT_BASE;
  const files = discoverJsonlFiles(baseDir, opts?.since);

  const allEntries: SessionEntry[] = [];
  for (const file of files) {
    const project = projectFromPath(file);
    if (opts?.projects && !opts.projects.includes(project)) continue;
    allEntries.push(...parseFile(file, project));
  }

  return allEntries;
}

export function parseSessionsForDays(days: number, opts?: Omit<ParseOptions, "since">): SessionEntry[] {
  const since = new Date();
  since.setDate(since.getDate() - days);
  return parseAllSessions({ ...opts, since });
}
