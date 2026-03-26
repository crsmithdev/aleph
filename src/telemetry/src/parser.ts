import { readdirSync, statSync, readFileSync } from "fs";
import { join, basename, dirname } from "path";
import type { SessionEntry, ParseOptions } from "./types.js";
import { claudePaths } from "@construct/data";

const DEFAULT_BASE = claudePaths.projects;

const slashCommands = new Set<string>(
  (() => {
    try {
      return readdirSync(claudePaths.commands)
        .filter((f) => f.endsWith(".md"))
        .map((f) => f.replace(/\.md$/, ""));
    } catch {
      return [];
    }
  })(),
);

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

function parseLine(line: string, project: string, fallbackSessionId?: string): SessionEntry[] {
  const entries: SessionEntry[] = [];
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(line);
  } catch {
    return entries;
  }

  const sessionId = (raw.sessionId as string) || fallbackSessionId || "unknown";
  const timestamp = (raw.timestamp as string) || "";

  const gitBranch = (raw.gitBranch as string) || undefined;
  const cwd = (raw.cwd as string) || undefined;

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
        role: "assistant",
        inputTokens: usage.input_tokens || 0,
        outputTokens: usage.output_tokens || 0,
        cacheReadTokens: usage.cache_read_input_tokens || 0,
        cacheCreationTokens: usage.cache_creation_input_tokens || 0,
        gitBranch,
        cwd,
      });
    }

    const content = message.content as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === "tool_use") {
          const toolName = block.name as string;
          const input = block.input as Record<string, unknown> | undefined;
          const isSkill = toolName === "Skill";
          const rawSkill = isSkill ? (input?.skill as string) || undefined : undefined;
          const skillName = rawSkill
            ? slashCommands.has(rawSkill) ? `/${rawSkill}` : rawSkill
            : undefined;

          // Estimate lines changed for Edit tools
          let linesAdded: number | undefined;
          let linesRemoved: number | undefined;
          if (toolName === "Edit" && input) {
            const oldStr = (input.old_string as string) || "";
            const newStr = (input.new_string as string) || "";
            linesRemoved = oldStr.split("\n").length;
            linesAdded = newStr.split("\n").length;
          } else if (toolName === "Write" && input) {
            const content = (input.content as string) || "";
            linesAdded = content.split("\n").length;
          }

          entries.push({
            sessionId,
            timestamp,
            project,
            model,
            entryType: "tool_use",
            toolName,
            skillName,
            toolParams: input || undefined,
            toolUseId: (block.id as string) || undefined,
            linesAdded,
            linesRemoved,
            gitBranch,
            cwd,
          });
        }
      }
    }
  }

  if (raw.type === "user" && !raw.isCompactSummary) {
    const message = raw.message as Record<string, unknown> | undefined;
    if (message) {
      const content = message.content;
      // Extract user message text
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
            // Extract explicit duration from toolUseResult (e.g. Agent subagent calls)
            const toolUseResult = (raw as Record<string, unknown>).toolUseResult as Record<string, unknown> | undefined;
            const toolDurationMs = toolUseResult?.totalDurationMs as number | undefined;

            if (block.is_error) {
              const rawContent = block.content;
              const errorMessage = typeof rawContent === "string"
                ? rawContent.slice(0, 200)
                : Array.isArray(rawContent)
                  ? (rawContent.find((b: any) => b.type === "text")?.text ?? "").slice(0, 200)
                  : undefined;
              entries.push({
                sessionId,
                timestamp,
                project,
                entryType: "tool_result",
                isError: true,
                toolUseId,
                errorMessage: errorMessage || undefined,
                toolDurationMs,
              });
            } else if (toolUseId) {
              entries.push({
                sessionId,
                timestamp,
                project,
                entryType: "tool_result",
                toolUseId,
                toolDurationMs,
              });
            }
          }
        }
        if (textParts.length > 0) userText = textParts.join("\n");
      }
      if (userText) {
        entries.push({
          sessionId,
          timestamp,
          project,
          entryType: "user_message",
          userRequest: userText.slice(0, 500),
        });
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
      const hookErrors = raw.hookErrors as string[] | undefined;
      const hasHookErrors = Array.isArray(hookErrors) && hookErrors.length > 0;

      if (Array.isArray(hookInfos)) {
        for (const info of hookInfos) {
          const exitCode = info.exitCode !== undefined ? (info.exitCode as number) : undefined;
          entries.push({
            sessionId,
            timestamp,
            project,
            entryType: "stop_hook_summary",
            hookCommand: (info.command as string) || undefined,
            hookDurationMs: (info.durationMs as number) || undefined,
            hookExitCode: exitCode,
            hookOutput: (info.output as string) || undefined,
            isError: (exitCode !== undefined && exitCode !== 0) || hasHookErrors || undefined,
            errorMessage: hasHookErrors ? hookErrors.join("\n").slice(0, 200) : undefined,
          });
        }
      } else if (hasHookErrors) {
        entries.push({
          sessionId,
          timestamp,
          project,
          entryType: "stop_hook_summary",
          isError: true,
          errorMessage: hookErrors.join("\n").slice(0, 200),
        });
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

    if (raw.subtype === "compact_boundary") {
      const meta = raw.compactMetadata as Record<string, unknown> | undefined;
      entries.push({
        sessionId,
        timestamp,
        project,
        entryType: "compact_boundary",
        compactTrigger: (meta?.trigger as string) || "unknown",
        compactPreTokens: (meta?.preTokens as number) || undefined,
      });
    }
  }

  return entries;
}

function sessionIdFromPath(filePath: string): string | undefined {
  const name = basename(filePath, ".jsonl");
  // UUID pattern: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(name)) {
    return name;
  }
  // Subagent files: agent-<id>.jsonl — use filename as unique session ID
  if (name.startsWith("agent-")) return name;
  return undefined;
}

function parentSessionIdFromPath(filePath: string): string | undefined {
  // Only subagent files in <parentSessionId>/subagents/ have a parent
  if (!filePath.includes("/subagents/")) return undefined;
  const parent = basename(dirname(dirname(filePath)));
  if (/^[0-9a-f]{8}-/.test(parent)) return parent;
  return undefined;
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

  const fallbackSessionId = sessionIdFromPath(filePath);
  const parentId = parentSessionIdFromPath(filePath);
  const rawEntries: SessionEntry[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    rawEntries.push(...parseLine(line, project, fallbackSessionId));
  }

  // Attach last user message to skill invocations; keep user_message entries
  const lastUserMsg = new Map<string, string>();
  const entries: SessionEntry[] = [];
  for (const e of rawEntries) {
    if (parentId) {
      e.parentSessionId = parentId;
      e.sessionId = fallbackSessionId || e.sessionId;
    }
    if (e.entryType === "user_message") {
      if (e.userRequest) lastUserMsg.set(e.sessionId, e.userRequest);
    }
    if (e.entryType === "tool_use" && e.skillName) {
      e.userRequest = lastUserMsg.get(e.sessionId);
    }
    entries.push(e);
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
