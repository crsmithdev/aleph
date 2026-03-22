import type {
  SessionEntry,
  Granularity,
  ToolMetric,
  HookMetric,
  SkillMetric,
  TimeBucket,
  TokenBucket,
  CostBucket,
  ModelCost,
  SessionBucket,
  ProjectBucket,
  HourBucket,
  OverviewData,
  ToolsData,
  HooksData,
  SkillsData,
  TokensData,
  CostData,
  SessionsData,
  ToolDetailData,
  HookDetailData,
  SkillDetailData,
  MemoryUsageData,
} from "./types.js";
import { calculateCost } from "./pricing.js";

function dateKey(timestamp: string): string {
  return timestamp.slice(0, 10);
}

function hourKey(timestamp: string): number {
  const match = timestamp.match(/T(\d{2}):/);
  return match ? parseInt(match[1], 10) : 0;
}

function bucketKey(timestamp: string, granularity: Granularity): string {
  switch (granularity) {
    case "minute":
      return timestamp.slice(0, 16); // YYYY-MM-DDTHH:MM
    case "hour":
      return timestamp.slice(0, 13); // YYYY-MM-DDTHH
    case "day":
    default:
      return timestamp.slice(0, 10); // YYYY-MM-DD
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.floor((p / 100) * (sorted.length - 1));
  return sorted[Math.max(0, idx)];
}

export function aggregateOverview(entries: SessionEntry[]): OverviewData {
  const sessionIds = new Set<string>();
  let messages = 0;
  let toolCalls = 0;
  let toolErrors = 0;
  let hookErrors = 0;
  let totalCost = 0;
  const dayMap = new Map<string, { sessions: Set<string>; messages: number }>();

  for (const e of entries) {
    const day = dateKey(e.timestamp);
    if (!dayMap.has(day)) dayMap.set(day, { sessions: new Set(), messages: 0 });
    const bucket = dayMap.get(day)!;

    sessionIds.add(e.sessionId);
    bucket.sessions.add(e.sessionId);

    if (e.entryType === "tokens") {
      messages++;
      bucket.messages++;
      totalCost += calculateCost(
        e.model || "",
        e.inputTokens || 0,
        e.outputTokens || 0,
        e.cacheReadTokens || 0,
        e.cacheCreationTokens || 0,
      );
    }

    if (e.entryType === "tool_use") {
      toolCalls++;
    }

    if (e.entryType === "tool_result" && e.isError) {
      toolErrors++;
    }

    if (e.entryType === "stop_hook_summary" && e.isError) {
      hookErrors++;
    }
  }

  const byDay = [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, sessions: v.sessions.size, messages: v.messages }));

  return { sessions: sessionIds.size, messages, toolCalls, toolErrors, hookErrors, totalCost, byDay };
}

export function aggregateTools(entries: SessionEntry[], granularity: Granularity = "day"): ToolsData {
  const toolCounts = new Map<string, { count: number; errors: number; lastUsed: string }>();
  const dayToolMap = new Map<string, Map<string, number>>();

  // Build a map of tool_use entries by their position for error matching
  const toolUseBySession = new Map<string, string[]>();
  for (const e of entries) {
    if (e.entryType === "tool_use" && e.toolName) {
      if (!toolUseBySession.has(e.sessionId)) toolUseBySession.set(e.sessionId, []);
      toolUseBySession.get(e.sessionId)!.push(e.toolName);
    }
  }

  for (const e of entries) {
    if (e.entryType === "tool_use" && e.toolName) {
      const cur = toolCounts.get(e.toolName) || { count: 0, errors: 0, lastUsed: "" };
      cur.count++;
      if (!cur.lastUsed || e.timestamp > cur.lastUsed) cur.lastUsed = e.timestamp;
      toolCounts.set(e.toolName, cur);

      const bk = bucketKey(e.timestamp, granularity);
      if (!dayToolMap.has(bk)) dayToolMap.set(bk, new Map());
      const dm = dayToolMap.get(bk)!;
      dm.set(e.toolName, (dm.get(e.toolName) || 0) + 1);
    }

    if (e.entryType === "tool_result" && e.isError) {
      // Count errors generically - attribute to most recently used tool in session
      const sessionTools = toolUseBySession.get(e.sessionId);
      if (sessionTools && sessionTools.length > 0) {
        const lastTool = sessionTools[sessionTools.length - 1];
        const cur = toolCounts.get(lastTool);
        if (cur) cur.errors++;
      }
    }
  }

  const total = [...toolCounts.values()].reduce((s, v) => s + v.count, 0);
  const ranked: ToolMetric[] = [...toolCounts.entries()]
    .map(([name, v]) => ({
      name,
      count: v.count,
      errorCount: v.errors,
      pct: total > 0 ? (v.count / total) * 100 : 0,
      lastUsed: v.lastUsed,
    }))
    .sort((a, b) => b.count - a.count);

  const byDay = [...dayToolMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, tools]) => ({
      date,
      count: [...tools.values()].reduce((s, v) => s + v, 0),
      tools: Object.fromEntries(tools),
    }));

  return { ranked, byDay };
}

export function aggregateHooks(entries: SessionEntry[], granularity: Granularity = "day"): HooksData {
  const hookMap = new Map<string, { event: string; durations: number[]; errors: number; fullCommand: string }>();
  const dayHookMap = new Map<string, Map<string, number>>();

  for (const e of entries) {
    if (e.entryType === "stop_hook_summary" && e.hookCommand) {
      const shortCmd = e.hookCommand.split("/").pop() || e.hookCommand;
      const cur = hookMap.get(shortCmd) || { event: "", durations: [], errors: 0, fullCommand: e.hookCommand };
      if (e.hookDurationMs !== undefined) {
        cur.durations.push(e.hookDurationMs);
      }
      if (e.isError) {
        cur.errors++;
      }
      cur.fullCommand = e.hookCommand;
      hookMap.set(shortCmd, cur);

      const bk = bucketKey(e.timestamp, granularity);
      if (!dayHookMap.has(bk)) dayHookMap.set(bk, new Map());
      const dm = dayHookMap.get(bk)!;
      dm.set(shortCmd, (dm.get(shortCmd) || 0) + 1);
    }

    if (e.entryType === "hook_progress" && e.hookCommand) {
      const shortCmd = e.hookCommand.split("/").pop() || e.hookCommand;
      const cur = hookMap.get(shortCmd) || { event: "", durations: [], errors: 0, fullCommand: e.hookCommand, progressCount: 0 };
      cur.event = e.hookEvent || cur.event;
      cur.fullCommand = e.hookCommand;
      (cur as any).progressCount = ((cur as any).progressCount || 0) + 1;
      hookMap.set(shortCmd, cur);

      const bk = bucketKey(e.timestamp, granularity);
      if (!dayHookMap.has(bk)) dayHookMap.set(bk, new Map());
      const dm = dayHookMap.get(bk)!;
      dm.set(shortCmd, (dm.get(shortCmd) || 0) + 1);
    }
  }

  const ranked: HookMetric[] = [...hookMap.entries()]
    .map(([command, v]) => {
      const sorted = v.durations.slice().sort((a, b) => a - b);
      const timedCount = sorted.length;
      const count = timedCount || (v as any).progressCount || 0;
      const avgMs = timedCount > 0 ? sorted.reduce((s, d) => s + d, 0) / timedCount : 0;
      return {
        command,
        event: v.event,
        count,
        avgMs: Math.round(avgMs),
        p50Ms: Math.round(percentile(sorted, 50)),
        p95Ms: Math.round(percentile(sorted, 95)),
        errors: v.errors,
        fullCommand: v.fullCommand,
      };
    })
    .sort((a, b) => b.count - a.count);

  const byDay = [...dayHookMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, hooks]) => ({
      date,
      count: [...hooks.values()].reduce((s, v) => s + v, 0),
      hooks: Object.fromEntries(hooks),
    }));

  return { ranked, byDay };
}

export function aggregateSkills(entries: SessionEntry[], granularity: Granularity = "day", validSkills?: Set<string>): SkillsData {
  const skillCounts = new Map<string, { count: number; errors: number; lastUsed: string }>();
  const daySkillMap = new Map<string, Map<string, number>>();

  for (const e of entries) {
    if (e.entryType === "tool_use" && e.skillName) {
      if (validSkills && !validSkills.has(e.skillName)) continue;
      const cur = skillCounts.get(e.skillName) || { count: 0, errors: 0, lastUsed: "" };
      cur.count++;
      if (!cur.lastUsed || e.timestamp > cur.lastUsed) cur.lastUsed = e.timestamp;
      skillCounts.set(e.skillName, cur);

      const bk = bucketKey(e.timestamp, granularity);
      if (!daySkillMap.has(bk)) daySkillMap.set(bk, new Map());
      const dm = daySkillMap.get(bk)!;
      dm.set(e.skillName, (dm.get(e.skillName) || 0) + 1);
    }
  }

  const total = [...skillCounts.values()].reduce((s, v) => s + v.count, 0);
  const ranked: SkillMetric[] = [...skillCounts.entries()]
    .map(([skill, v]) => ({
      skill,
      count: v.count,
      pct: total > 0 ? (v.count / total) * 100 : 0,
      errors: v.errors,
      lastUsed: v.lastUsed,
    }))
    .sort((a, b) => b.count - a.count);

  const byDay = [...daySkillMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, skills]) => ({
      date,
      count: [...skills.values()].reduce((s, v) => s + v, 0),
      skills: Object.fromEntries(skills),
    }));

  return { ranked, byDay };
}

export function aggregateTokens(entries: SessionEntry[]): TokensData {
  const dayMap = new Map<string, TokenBucket>();

  for (const e of entries) {
    if (e.entryType === "tokens") {
      const day = dateKey(e.timestamp);
      const cur = dayMap.get(day) || { date: day, input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
      cur.input += e.inputTokens || 0;
      cur.output += e.outputTokens || 0;
      cur.cacheRead += e.cacheReadTokens || 0;
      cur.cacheCreation += e.cacheCreationTokens || 0;
      dayMap.set(day, cur);
    }
  }

  const byDay = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date));
  return { byDay };
}

export function aggregateCost(entries: SessionEntry[]): CostData {
  let totalUsd = 0;
  const dayMap = new Map<string, number>();
  const modelMap = new Map<string, number>();

  for (const e of entries) {
    if (e.entryType === "tokens" && e.model) {
      const cost = calculateCost(
        e.model,
        e.inputTokens || 0,
        e.outputTokens || 0,
        e.cacheReadTokens || 0,
        e.cacheCreationTokens || 0,
      );
      totalUsd += cost;

      const day = dateKey(e.timestamp);
      dayMap.set(day, (dayMap.get(day) || 0) + cost);
      modelMap.set(e.model, (modelMap.get(e.model) || 0) + cost);
    }
  }

  const byDay: CostBucket[] = [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, usd]) => ({ date, usd }));

  const byModel: ModelCost[] = [...modelMap.entries()]
    .map(([model, usd]) => ({
      model,
      usd,
      pct: totalUsd > 0 ? (usd / totalUsd) * 100 : 0,
    }))
    .sort((a, b) => b.usd - a.usd);

  return { totalUsd, byDay, byModel };
}

export function aggregateSessions(entries: SessionEntry[]): SessionsData {
  const dayMap = new Map<string, { sessions: Set<string>; messages: number }>();
  const projectMap = new Map<string, Set<string>>();
  const hourMap = new Map<number, number>();

  for (const e of entries) {
    const day = dateKey(e.timestamp);
    if (!dayMap.has(day)) dayMap.set(day, { sessions: new Set(), messages: 0 });
    const bucket = dayMap.get(day)!;
    bucket.sessions.add(e.sessionId);

    if (e.entryType === "tokens") {
      bucket.messages++;
    }

    if (!projectMap.has(e.project)) projectMap.set(e.project, new Set());
    projectMap.get(e.project)!.add(e.sessionId);

    const hour = hourKey(e.timestamp);
    hourMap.set(hour, (hourMap.get(hour) || 0) + 1);
  }

  const byDay: SessionBucket[] = [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, sessions: v.sessions.size, messages: v.messages }));

  const byProject: ProjectBucket[] = [...projectMap.entries()]
    .map(([project, sessions]) => ({ project, sessions: sessions.size }))
    .sort((a, b) => b.sessions - a.sessions);

  const byHour: HourBucket[] = [...hourMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([hour, count]) => ({ hour, count }));

  return { byDay, byProject, byHour };
}

export function aggregateToolDetail(entries: SessionEntry[], toolName: string): ToolDetailData {
  // Map tool_use_id → timestamp for this tool, and collect error info by tool_use_id.
  const useIdToTimestamp = new Map<string, string>();
  const errorByUseId = new Map<string, string | undefined>(); // tool_use_id → errorMessage

  for (const e of entries) {
    if (e.entryType === "tool_use" && e.toolName === toolName && e.toolUseId) {
      useIdToTimestamp.set(e.toolUseId, e.timestamp);
    }
    if (e.entryType === "tool_result" && e.isError && e.toolUseId) {
      errorByUseId.set(e.toolUseId, e.errorMessage);
    }
  }

  // Build error timestamps set, correlating by tool_use_id
  const errorTimestamps = new Map<string, string | undefined>(); // timestamp → errorMessage
  for (const [useId, msg] of errorByUseId) {
    const ts = useIdToTimestamp.get(useId);
    if (ts) errorTimestamps.set(ts, msg);
  }

  // Fallback: positional attribution for entries without tool_use_id
  let lastToolUseTs: string | null = null;
  for (const e of entries) {
    if (e.entryType === "tool_use" && e.toolName === toolName) {
      lastToolUseTs = e.timestamp;
    } else if (e.entryType === "tool_result" && e.isError && lastToolUseTs && !e.toolUseId) {
      errorTimestamps.set(lastToolUseTs, e.errorMessage);
      lastToolUseTs = null;
    } else if (e.entryType === "tool_use") {
      lastToolUseTs = null;
    }
  }

  const matched = entries.filter((e) => e.entryType === "tool_use" && e.toolName === toolName);
  const totalCount = matched.length;
  let errorCount = 0;

  const dayMap = new Map<string, Map<number, number>>();
  const invocations: { timestamp: string; sessionId: string; project: string; params?: Record<string, unknown>; isError?: boolean; errorMessage?: string }[] = [];

  for (const e of matched) {
    const day = dateKey(e.timestamp);
    if (!dayMap.has(day)) dayMap.set(day, new Map());
    const hm = dayMap.get(day)!;
    const hour = hourKey(e.timestamp);
    hm.set(hour, (hm.get(hour) || 0) + 1);

    const isError = errorTimestamps.has(e.timestamp);
    if (isError) errorCount++;

    invocations.push({
      timestamp: e.timestamp,
      sessionId: e.sessionId,
      project: e.project,
      params: e.toolParams,
      isError: isError || undefined,
      errorMessage: isError ? errorTimestamps.get(e.timestamp) : undefined,
    });
  }

  const byDay = [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, hours]) => ({
      date,
      count: [...hours.values()].reduce((s, v) => s + v, 0),
      byHour: Object.fromEntries(hours) as Record<number, number>,
    }));

  const recentInvocations = invocations
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 200);

  return { name: toolName, totalCount, errorCount, byDay, invocations: recentInvocations };
}

export function aggregateHookDetail(entries: SessionEntry[], hookName: string): HookDetailData {
  const durations: number[] = [];
  let event = "";
  let errors = 0;
  let fullCommand = "";
  const dayMap = new Map<string, { durations: number[] }>();
  const invocations: { timestamp: string; sessionId: string; durationMs: number; exitCode?: number; output?: string }[] = [];

  for (const e of entries) {
    if (e.entryType === "stop_hook_summary" && e.hookCommand) {
      const shortCmd = e.hookCommand.split("/").pop() || e.hookCommand;
      if (shortCmd !== hookName) continue;
      const dur = e.hookDurationMs ?? 0;
      durations.push(dur);
      if (e.isError) errors++;
      fullCommand = e.hookCommand;

      const day = dateKey(e.timestamp);
      if (!dayMap.has(day)) dayMap.set(day, { durations: [] });
      dayMap.get(day)!.durations.push(dur);

      invocations.push({
        timestamp: e.timestamp,
        sessionId: e.sessionId,
        durationMs: dur,
        exitCode: e.hookExitCode,
        output: e.hookOutput,
      });
    }

    if (e.entryType === "hook_progress" && e.hookCommand) {
      const shortCmd = e.hookCommand.split("/").pop() || e.hookCommand;
      if (shortCmd === hookName && e.hookEvent) {
        event = e.hookEvent;
      }
      fullCommand = e.hookCommand;
    }
  }

  const sorted = durations.slice().sort((a, b) => a - b);
  const totalCount = sorted.length;
  const avgMs = totalCount > 0 ? Math.round(sorted.reduce((s, d) => s + d, 0) / totalCount) : 0;
  const p50Ms = Math.round(percentile(sorted, 50));
  const p95Ms = Math.round(percentile(sorted, 95));

  const byDay = [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      date,
      count: v.durations.length,
      avgMs: Math.round(v.durations.reduce((s, d) => s + d, 0) / v.durations.length),
    }));

  const recentInvocations = invocations
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 200);

  return { command: hookName, event, totalCount, avgMs, p50Ms, p95Ms, errors, fullCommand, byDay, invocations: recentInvocations };
}

export function aggregateSkillDetail(entries: SessionEntry[], skillName: string): SkillDetailData {
  const matched = entries.filter((e) => e.entryType === "tool_use" && e.skillName === skillName);
  const totalCount = matched.length;
  const errorCount = 0;

  const dayMap = new Map<string, number>();
  const invocations: { timestamp: string; sessionId: string; project: string; params?: Record<string, unknown> }[] = [];

  for (const e of matched) {
    const day = dateKey(e.timestamp);
    dayMap.set(day, (dayMap.get(day) || 0) + 1);

    invocations.push({
      timestamp: e.timestamp,
      sessionId: e.sessionId,
      project: e.project,
      params: e.toolParams,
    });
  }

  const byDay: TimeBucket[] = [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));

  const recentInvocations = invocations
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 200);

  return { skill: skillName, totalCount, errorCount, byDay, invocations: recentInvocations };
}

export function aggregateMemoryUsage(entries: SessionEntry[]): MemoryUsageData {
  let stores = 0;
  let searches = 0;
  const dayMap = new Map<string, { stores: number; searches: number }>();

  for (const e of entries) {
    if (e.entryType !== "tool_use" || !e.toolName) continue;

    const isStore = e.toolName === "memory_store" || e.toolName === "mcp__memory__memory_store";
    const isSearch = e.toolName === "memory_search" || e.toolName === "mcp__memory__memory_search";

    if (!isStore && !isSearch) continue;

    const day = dateKey(e.timestamp);
    if (!dayMap.has(day)) dayMap.set(day, { stores: 0, searches: 0 });
    const bucket = dayMap.get(day)!;

    if (isStore) {
      stores++;
      bucket.stores++;
    }
    if (isSearch) {
      searches++;
      bucket.searches++;
    }
  }

  const byDay = [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, stores: v.stores, searches: v.searches }));

  return { stores, searches, byDay };
}
