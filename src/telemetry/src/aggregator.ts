import type {
  SessionEntry,
  ToolMetric,
  HookMetric,
  SkillMetric,
  TimeBucket,
  TokenBucket,
  CostBucket,
  ModelCost,
  SessionBucket,
  SessionMetric,
  ProjectBucket,

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
  HookEventData,
  HookInvocation,
  CompactionData,
  ApiDurationData,
  TraceData,
  TraceSpan,
  TraceTurn,
  SubagentsData,
  SubagentInvocation,
  SubagentTypeBucket,
} from "./types.js";
import { calculateCost } from "./pricing.js";

function hourKey(timestamp: string): number {
  const match = timestamp.match(/T(\d{2}):/);
  return match ? parseInt(match[1], 10) : 0;
}

function bucketKey(timestamp: string): string {
  return timestamp.slice(0, 10); // YYYY-MM-DD
}

const shortNameCache = new Map<string, string>();
function shortName(cmd: string): string {
  const cached = shortNameCache.get(cmd);
  if (cached !== undefined) return cached;
  const result = cmd.split("/").pop() || cmd;
  shortNameCache.set(cmd, result);
  return result;
}

const KNOWN_EVENTS = ["SessionStart", "UserPromptSubmit", "Stop", "PostToolUse", "Notification"];

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
    const day = bucketKey(e.timestamp);
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

export function aggregateTools(entries: SessionEntry[]): ToolsData {
  const toolCounts = new Map<string, { count: number; errors: number; lastUsed: string; durations: number[] }>();
  const dayToolMap = new Map<string, Map<string, number>>();

  // resultInfo must be pre-built (tool_result follows tool_use in the stream)
  const resultInfo = new Map<string, { timestamp: string; durationMs?: number }>();
  for (const e of entries) {
    if (e.entryType === "tool_result" && e.toolUseId) {
      resultInfo.set(e.toolUseId, { timestamp: e.timestamp, durationMs: e.toolDurationMs });
    }
  }

  // useIdToTool is built inline (tool_use always precedes its tool_result)
  const useIdToTool = new Map<string, { toolName: string; timestamp: string }>();

  for (const e of entries) {
    if (e.entryType === "tool_use" && e.toolName) {
      if (e.toolUseId) useIdToTool.set(e.toolUseId, { toolName: e.toolName, timestamp: e.timestamp });

      const cur = toolCounts.get(e.toolName) || { count: 0, errors: 0, lastUsed: "", durations: [] };
      cur.count++;
      if (!cur.lastUsed || e.timestamp > cur.lastUsed) cur.lastUsed = e.timestamp;

      // Calculate latency: prefer explicit duration, fall back to timestamp diff
      if (e.toolUseId) {
        const result = resultInfo.get(e.toolUseId);
        if (result) {
          const durationMs = result.durationMs ?? (new Date(result.timestamp).getTime() - new Date(e.timestamp).getTime());
          if (durationMs >= 0 && durationMs < 3600000) cur.durations.push(durationMs);
        }
      }

      toolCounts.set(e.toolName, cur);

      const bk = bucketKey(e.timestamp);
      if (!dayToolMap.has(bk)) dayToolMap.set(bk, new Map());
      const dm = dayToolMap.get(bk)!;
      dm.set(e.toolName, (dm.get(e.toolName) || 0) + 1);
    }

    if (e.entryType === "tool_result" && e.isError) {
      const info = e.toolUseId ? useIdToTool.get(e.toolUseId) : undefined;
      if (info) {
        const cur = toolCounts.get(info.toolName);
        if (cur) cur.errors++;
      }
    }
  }

  const total = [...toolCounts.values()].reduce((s, v) => s + v.count, 0);
  const ranked: ToolMetric[] = [...toolCounts.entries()]
    .map(([name, v]) => {
      const sorted = v.durations.slice().sort((a, b) => a - b);
      const avgMs = sorted.length > 0 ? Math.round(sorted.reduce((s, d) => s + d, 0) / sorted.length) : undefined;
      return {
        name,
        count: v.count,
        errorCount: v.errors,
        pct: total > 0 ? (v.count / total) * 100 : 0,
        lastUsed: v.lastUsed,
        avgMs,
        p50Ms: sorted.length > 0 ? Math.round(percentile(sorted, 50)) : undefined,
        p95Ms: sorted.length > 0 ? Math.round(percentile(sorted, 95)) : undefined,
      };
    })
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

export function aggregateHooks(entries: SessionEntry[]): HooksData {
  const hookMap = new Map<string, { event: string; durations: number[]; errors: number; fullCommand: string; progressCount: number }>();
  const dayHookMap = new Map<string, Map<string, number>>();

  for (const e of entries) {
    if (e.entryType === "stop_hook_summary" && e.hookCommand) {
      const shortCmd = shortName(e.hookCommand);
      const cur = hookMap.get(shortCmd) || { event: "", durations: [], errors: 0, fullCommand: e.hookCommand, progressCount: 0 };
      if (e.hookDurationMs !== undefined) {
        cur.durations.push(e.hookDurationMs);
      }
      if (e.isError) {
        cur.errors++;
      }
      cur.fullCommand = e.hookCommand;
      hookMap.set(shortCmd, cur);

      const bk = bucketKey(e.timestamp);
      if (!dayHookMap.has(bk)) dayHookMap.set(bk, new Map());
      const dm = dayHookMap.get(bk)!;
      dm.set(shortCmd, (dm.get(shortCmd) || 0) + 1);
    }

    if (e.entryType === "hook_progress" && e.hookCommand) {
      const shortCmd = shortName(e.hookCommand);
      const cur = hookMap.get(shortCmd) || { event: "", durations: [], errors: 0, fullCommand: e.hookCommand, progressCount: 0 };
      cur.event = e.hookEvent || cur.event;
      cur.fullCommand = e.hookCommand;
      hookMap.set(shortCmd, cur);

      // Stop hooks are already counted via stop_hook_summary — only count
      // non-Stop hook_progress entries to avoid double-counting
      if (e.hookEvent !== "Stop") {
        cur.progressCount++;

        const bk = bucketKey(e.timestamp);
        if (!dayHookMap.has(bk)) dayHookMap.set(bk, new Map());
        const dm = dayHookMap.get(bk)!;
        dm.set(shortCmd, (dm.get(shortCmd) || 0) + 1);
      }
    }
  }

  const ranked: HookMetric[] = [...hookMap.entries()]
    .map(([command, v]) => {
      const sorted = v.durations.slice().sort((a, b) => a - b);
      const timedCount = sorted.length;
      const count = timedCount || v.progressCount || 0;
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

export function aggregateSkills(entries: SessionEntry[]): SkillsData {
  const skillCounts = new Map<string, { count: number; errors: number; lastUsed: string }>();
  const daySkillMap = new Map<string, Map<string, number>>();

  for (const e of entries) {
    if (e.entryType === "tool_use" && e.skillName) {
      const cur = skillCounts.get(e.skillName) || { count: 0, errors: 0, lastUsed: "" };
      cur.count++;
      if (!cur.lastUsed || e.timestamp > cur.lastUsed) cur.lastUsed = e.timestamp;
      skillCounts.set(e.skillName, cur);

      const bk = bucketKey(e.timestamp);
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
  let totalInput = 0, totalOutput = 0, totalCacheRead = 0, totalCacheCreation = 0;

  for (const e of entries) {
    if (e.entryType === "tokens") {
      const day = bucketKey(e.timestamp);
      const cur = dayMap.get(day) || { date: day, input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
      const input = e.inputTokens || 0;
      const output = e.outputTokens || 0;
      const cacheRead = e.cacheReadTokens || 0;
      const cacheCreation = e.cacheCreationTokens || 0;
      cur.input += input;
      cur.output += output;
      cur.cacheRead += cacheRead;
      cur.cacheCreation += cacheCreation;
      dayMap.set(day, cur);
      totalInput += input;
      totalOutput += output;
      totalCacheRead += cacheRead;
      totalCacheCreation += cacheCreation;
    }
  }

  const cacheTotal = totalCacheRead + totalCacheCreation;
  const cacheEfficiency = cacheTotal > 0 ? (totalCacheRead / cacheTotal) * 100 : 0;

  const byDay = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date));
  return { cacheEfficiency, totalInput, totalOutput, totalCacheRead, totalCacheCreation, byDay };
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

      const day = bucketKey(e.timestamp);
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
  const dayMap = new Map<string, { sessions: Set<string>; messages: number; userMessages: number; assistantMessages: number }>();
  const projectMap = new Map<string, Set<string>>();
  const activityMap = new Map<string, number>();

  // Per-session tracking
  const sessionMap = new Map<string, {
    project: string;
    parentSessionId?: string;
    firstTs: string; lastTs: string;
    userMessages: number; assistantMessages: number;
    toolCalls: number; cost: number;
    linesAdded: number; linesRemoved: number;
    commits: number; compactions: number;
    hasSubagents: boolean;
    gitBranch?: string;
  }>();

  function getSession(sessionId: string, project: string, timestamp: string, parentSessionId?: string) {
    if (!sessionMap.has(sessionId)) {
      sessionMap.set(sessionId, {
        project, parentSessionId, firstTs: timestamp, lastTs: timestamp,
        userMessages: 0, assistantMessages: 0,
        toolCalls: 0, cost: 0,
        linesAdded: 0, linesRemoved: 0,
        commits: 0, compactions: 0,
        hasSubagents: false,
      });
    }
    const s = sessionMap.get(sessionId)!;
    if (timestamp < s.firstTs) s.firstTs = timestamp;
    if (timestamp > s.lastTs) s.lastTs = timestamp;
    return s;
  }

  for (const e of entries) {
    const day = bucketKey(e.timestamp);
    if (!dayMap.has(day)) dayMap.set(day, { sessions: new Set(), messages: 0, userMessages: 0, assistantMessages: 0 });
    const bucket = dayMap.get(day)!;
    bucket.sessions.add(e.sessionId);

    const sess = getSession(e.sessionId, e.project, e.timestamp, e.parentSessionId);
    if (e.gitBranch) sess.gitBranch = e.gitBranch;

    if (e.entryType === "tokens") {
      bucket.messages++;
      bucket.assistantMessages++;
      sess.assistantMessages++;
      sess.cost += calculateCost(
        e.model || "", e.inputTokens || 0, e.outputTokens || 0,
        e.cacheReadTokens || 0, e.cacheCreationTokens || 0,
      );
    }

    if (e.entryType === "user_message") {
      bucket.messages++;
      bucket.userMessages++;
      sess.userMessages++;
    }

    if (e.entryType === "tool_use") {
      sess.toolCalls++;
      if (e.toolName === "Agent") sess.hasSubagents = true;
      if (e.linesAdded) sess.linesAdded += e.linesAdded;
      if (e.linesRemoved) sess.linesRemoved += e.linesRemoved;

      // Detect git commits
      if (e.toolName === "Bash" && e.toolParams?.command &&
          /\bgit\s+commit\b/.test(e.toolParams.command as string)) {
        sess.commits++;
      }
    }

    if (e.entryType === "compact_boundary") {
      sess.compactions++;
    }

    if (!projectMap.has(e.project)) projectMap.set(e.project, new Set());
    projectMap.get(e.project)!.add(e.sessionId);

    const actKey = bucketKey(e.timestamp);
    activityMap.set(actKey, (activityMap.get(actKey) || 0) + 1);
  }

  const byDay: SessionBucket[] = [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      date, sessions: v.sessions.size, messages: v.messages,
      userMessages: v.userMessages, assistantMessages: v.assistantMessages,
    }));

  const byProject: ProjectBucket[] = [...projectMap.entries()]
    .map(([project, sessions]) => ({ project, sessions: sessions.size }))
    .sort((a, b) => b.sessions - a.sessions);

  const byActivity: TimeBucket[] = [...activityMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));

  const sessions: SessionMetric[] = [...sessionMap.entries()]
    .map(([sessionId, s]) => ({
      sessionId,
      parentSessionId: s.parentSessionId,
      project: s.project,
      durationMs: new Date(s.lastTs).getTime() - new Date(s.firstTs).getTime(),
      userMessages: s.userMessages,
      assistantMessages: s.assistantMessages,
      toolCalls: s.toolCalls,
      cost: s.cost,
      linesAdded: s.linesAdded,
      linesRemoved: s.linesRemoved,
      commits: s.commits,
      compactions: s.compactions,
      firstTimestamp: s.firstTs,
      lastTimestamp: s.lastTs,
      gitBranch: s.gitBranch,
      hasSubagents: s.hasSubagents,
    }))
    .sort((a, b) => b.lastTimestamp.localeCompare(a.lastTimestamp));

  const durations = sessions.map((s) => s.durationMs).filter((d) => d > 0);
  const avgDurationMs = durations.length > 0 ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length) : 0;
  const totalUserMessages = sessions.reduce((s, v) => s + v.userMessages, 0);
  const totalAssistantMessages = sessions.reduce((s, v) => s + v.assistantMessages, 0);
  const totalLinesAdded = sessions.reduce((s, v) => s + v.linesAdded, 0);
  const totalLinesRemoved = sessions.reduce((s, v) => s + v.linesRemoved, 0);
  const totalCommits = sessions.reduce((s, v) => s + v.commits, 0);

  return {
    byDay, byProject, byActivity, sessions,
    avgDurationMs, totalUserMessages, totalAssistantMessages,
    totalLinesAdded, totalLinesRemoved, totalCommits,
  };
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
    const day = bucketKey(e.timestamp);
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
  const dayMap = new Map<string, { durations: number[]; count: number }>();
  const invocations: { timestamp: string; sessionId: string; durationMs: number; exitCode?: number; output?: string; trigger?: string; isError?: boolean; errorMessage?: string }[] = [];

  // Track whether stop_hook_summary entries exist for this hook.
  // If they do, hook_progress entries are duplicates and should not produce invocation rows.
  let hasStopSummary = false;

  for (const e of entries) {
    if (e.entryType === "stop_hook_summary" && e.hookCommand) {
      const shortCmd = shortName(e.hookCommand);
      if (shortCmd !== hookName) continue;
      hasStopSummary = true;
      const dur = e.hookDurationMs ?? 0;
      durations.push(dur);
      if (e.isError) errors++;
      fullCommand = e.hookCommand;

      const day = bucketKey(e.timestamp);
      if (!dayMap.has(day)) dayMap.set(day, { durations: [], count: 0 });
      const dm = dayMap.get(day)!;
      dm.durations.push(dur);
      dm.count++;

      invocations.push({
        timestamp: e.timestamp,
        sessionId: e.sessionId,
        durationMs: dur,
        exitCode: e.hookExitCode,
        output: e.hookOutput,
        isError: e.isError,
        errorMessage: e.errorMessage,
      });
    }

    if (e.entryType === "hook_progress" && e.hookCommand) {
      const shortCmd = shortName(e.hookCommand);
      if (shortCmd === hookName) {
        if (e.hookEvent) event = e.hookEvent;
        fullCommand = e.hookCommand;
      }
    }
  }

  // For non-Stop hooks, stop_hook_summary is never emitted — use hook_progress entries instead.
  if (!hasStopSummary) {
    for (const e of entries) {
      if (e.entryType === "hook_progress" && e.hookCommand) {
        const shortCmd = shortName(e.hookCommand);
        if (shortCmd !== hookName) continue;

        // Extract trigger from hookName (e.g. "PostToolUse:Edit" → "Edit")
        const trigger = e.hookName?.includes(":") ? e.hookName.split(":").slice(1).join(":") : undefined;

        invocations.push({
          timestamp: e.timestamp,
          sessionId: e.sessionId,
          durationMs: 0,
          trigger,
        });

        const day = bucketKey(e.timestamp);
        if (!dayMap.has(day)) dayMap.set(day, { durations: [], count: 0 });
        dayMap.get(day)!.count++;
      }
    }
  }

  const sorted = durations.slice().sort((a, b) => a - b);
  const totalCount = invocations.length;
  const timedCount = sorted.length;
  const avgMs = timedCount > 0 ? Math.round(sorted.reduce((s, d) => s + d, 0) / timedCount) : 0;
  const p50Ms = Math.round(percentile(sorted, 50));
  const p95Ms = Math.round(percentile(sorted, 95));

  const byDay = [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      date,
      count: v.count,
      avgMs: v.durations.length > 0 ? Math.round(v.durations.reduce((s, d) => s + d, 0) / v.durations.length) : 0,
    }));

  const recentInvocations = invocations
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 200);

  return { command: hookName, event, totalCount, avgMs, p50Ms, p95Ms, errors, fullCommand, byDay, invocations: recentInvocations };
}

export function aggregateSkillDetail(entries: SessionEntry[], skillName: string): SkillDetailData {
  const matched = entries.filter((e) => e.entryType === "tool_use" && e.skillName === skillName);
  const totalCount = matched.length;

  const dayMap = new Map<string, number>();
  const invocations: { timestamp: string; sessionId: string; project: string; params?: Record<string, unknown>; userRequest?: string }[] = [];

  for (const e of matched) {
    const day = bucketKey(e.timestamp);
    dayMap.set(day, (dayMap.get(day) || 0) + 1);

    invocations.push({
      timestamp: e.timestamp,
      sessionId: e.sessionId,
      project: e.project,
      params: e.toolParams,
      userRequest: e.userRequest,
    });
  }

  const byDay: TimeBucket[] = [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));

  const recentInvocations = invocations
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 200);

  return { skill: skillName, totalCount, byDay, invocations: recentInvocations };
}

export function aggregateHookEvents(entries: SessionEntry[]): HookEventData {
  // Track event → set of hooks and total count
  const eventMap = new Map<string, { count: number; hooks: Set<string> }>();

  // Track invocations grouped by (sessionId, timestamp) for stop_hook_summary
  // and by (sessionId, timestamp) for hook_progress
  const invocationMap = new Map<string, HookInvocation>();
  // Dedup hooks per invocation key: key → Set of command strings already added
  const invocationHookSets = new Map<string, Set<string>>();

  // Process hook_progress entries to learn event→hook mappings and create invocations
  for (const e of entries) {
    if (e.entryType === "hook_progress" && e.hookEvent && e.hookCommand) {
      const event = e.hookEvent;
      const shortCmd = shortName(e.hookCommand);

      if (!eventMap.has(event)) eventMap.set(event, { count: 0, hooks: new Set() });
      const ev = eventMap.get(event)!;
      ev.hooks.add(shortCmd);

      // Key by session+timestamp for grouping
      const key = `${e.sessionId}::${e.timestamp}::${event}`;
      if (!invocationMap.has(key)) {
        invocationMap.set(key, {
          timestamp: e.timestamp,
          sessionId: e.sessionId,
          event,
          hooks: [],
        });
        invocationHookSets.set(key, new Set());
        ev.count++;
      }
      const inv = invocationMap.get(key)!;
      const hookSet = invocationHookSets.get(key)!;
      if (!hookSet.has(shortCmd)) {
        hookSet.add(shortCmd);
        inv.hooks.push({ command: shortCmd });
      }
    }
  }

  // Process stop_hook_summary entries to enrich with timing data
  // Group by sessionId+timestamp: a single stop_hook_summary event produces one entry per hook
  const stopGroups = new Map<string, { timestamp: string; sessionId: string; hooks: Array<{ command: string; durationMs?: number; exitCode?: number; output?: string }> }>();

  for (const e of entries) {
    if (e.entryType === "stop_hook_summary" && e.hookCommand) {
      const shortCmd = shortName(e.hookCommand);
      const key = `${e.sessionId}::${e.timestamp}`;
      if (!stopGroups.has(key)) {
        stopGroups.set(key, { timestamp: e.timestamp, sessionId: e.sessionId, hooks: [] });
      }
      stopGroups.get(key)!.hooks.push({
        command: shortCmd,
        durationMs: e.hookDurationMs,
        exitCode: e.hookExitCode,
        output: e.hookOutput,
      });
    }
  }

  // Merge stop_hook_summary groups into invocations (under "Stop" event)
  for (const [, group] of stopGroups) {
    const event = "Stop";
    const key = `${group.sessionId}::${group.timestamp}::${event}`;

    if (!eventMap.has(event)) eventMap.set(event, { count: 0, hooks: new Set() });
    const ev = eventMap.get(event)!;

    if (!invocationMap.has(key)) {
      invocationMap.set(key, {
        timestamp: group.timestamp,
        sessionId: group.sessionId,
        event,
        hooks: group.hooks,
      });
      ev.count++;
    }

    for (const h of group.hooks) {
      ev.hooks.add(h.command);
    }
  }

  const events = [...eventMap.entries()]
    .map(([event, v]) => ({ event, count: v.count, hooks: [...v.hooks] }))
    .sort((a, b) => {
      const ai = KNOWN_EVENTS.indexOf(a.event);
      const bi = KNOWN_EVENTS.indexOf(b.event);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.event.localeCompare(b.event);
    });

  const invocations = [...invocationMap.values()]
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 500);

  return { events, invocations };
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

    const day = bucketKey(e.timestamp);
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

export function aggregateCompaction(entries: SessionEntry[]): CompactionData {
  const dayMap = new Map<string, number>();
  const events: CompactionData["events"] = [];
  let totalTokensAtCompaction = 0;

  for (const e of entries) {
    if (e.entryType !== "compact_boundary") continue;
    const preTokens = e.compactPreTokens || 0;
    totalTokensAtCompaction += preTokens;
    events.push({
      timestamp: e.timestamp,
      sessionId: e.sessionId,
      trigger: e.compactTrigger || "unknown",
      preTokens,
    });
    const day = bucketKey(e.timestamp);
    dayMap.set(day, (dayMap.get(day) || 0) + 1);
  }

  const totalCompactions = events.length;
  const avgPreTokens = totalCompactions > 0 ? Math.round(totalTokensAtCompaction / totalCompactions) : 0;

  const byDay: TimeBucket[] = [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));

  return { totalCompactions, totalTokensAtCompaction, avgPreTokens, byDay, events: events.sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 100) };
}

export function aggregateApiDuration(entries: SessionEntry[]): ApiDurationData {
  const allDurations: number[] = [];
  const dayMap = new Map<string, number[]>();

  for (const e of entries) {
    if (e.entryType !== "turn_duration" || !e.turnDurationMs) continue;
    allDurations.push(e.turnDurationMs);
    const day = bucketKey(e.timestamp);
    if (!dayMap.has(day)) dayMap.set(day, []);
    dayMap.get(day)!.push(e.turnDurationMs);
  }

  const sorted = allDurations.slice().sort((a, b) => a - b);
  const avgMs = sorted.length > 0 ? Math.round(sorted.reduce((s, d) => s + d, 0) / sorted.length) : 0;

  const byDay = [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, durations]) => ({
      date,
      avgMs: Math.round(durations.reduce((s, d) => s + d, 0) / durations.length),
      count: durations.length,
    }));

  return {
    avgMs,
    p50Ms: Math.round(percentile(sorted, 50)),
    p95Ms: Math.round(percentile(sorted, 95)),
    byDay,
  };
}

export function getRecentEvents(
  entries: SessionEntry[],
  limit: number = 200,
  offset: number = 0,
  filters?: { entryType?: string; search?: string },
): { events: SessionEntry[]; total: number } {
  let filtered = entries;
  if (filters?.entryType) {
    filtered = filtered.filter((e) => e.entryType === filters.entryType);
  }
  if (filters?.search) {
    const q = filters.search.toLowerCase();
    filtered = filtered.filter((e) => {
      const fields = [e.toolName, e.skillName, e.hookCommand, e.hookEvent, e.hookName, e.errorMessage];
      for (const f of fields) {
        if (f && f.toLowerCase().includes(q)) return true;
      }
      if (e.toolParams) {
        for (const v of Object.values(e.toolParams)) {
          const s = typeof v === "string" ? v : JSON.stringify(v);
          if (s.toLowerCase().includes(q)) return true;
        }
      }
      return false;
    });
  }

  const total = filtered.length;
  if (limit < total / 2) {
    // Partial sort: maintain a bounded sorted array of size limit+offset
    const needed = limit + offset;
    const top: SessionEntry[] = [];
    for (const e of filtered) {
      if (top.length < needed) {
        top.push(e);
        if (top.length === needed) {
          top.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
        }
      } else if (e.timestamp > top[top.length - 1].timestamp) {
        top[top.length - 1] = e;
        // Re-sort only the tail to maintain order (insertion sort on small array)
        for (let i = top.length - 1; i > 0 && top[i].timestamp > top[i - 1].timestamp; i--) {
          const tmp = top[i]; top[i] = top[i - 1]; top[i - 1] = tmp;
        }
      }
    }
    return { events: top.slice(offset, offset + limit), total };
  }

  const sorted = filtered.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return { events: sorted.slice(offset, offset + limit), total };
}

export function aggregateSessionTrace(entries: SessionEntry[], sessionId: string): TraceData {
  const sessionEntries = entries
    .filter((e) => e.sessionId === sessionId)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  if (sessionEntries.length === 0) {
    return { sessionId, project: "", turns: [], totalDurationMs: 0, totalTokens: 0, totalCost: 0 };
  }

  const project = sessionEntries[0].project;
  const parentSessionId = sessionEntries[0].parentSessionId;

  // Build map of subagent sessions belonging to this parent, keyed by first timestamp
  const subagentTimes: { sessionId: string; firstTs: number; lastTs: number }[] = [];
  const subSessionMap = new Map<string, { firstTs: number; lastTs: number }>();
  for (const e of entries) {
    if (e.parentSessionId === sessionId && e.sessionId !== sessionId) {
      const ts = new Date(e.timestamp).getTime();
      const existing = subSessionMap.get(e.sessionId);
      if (!existing) {
        subSessionMap.set(e.sessionId, { firstTs: ts, lastTs: ts });
      } else {
        if (ts < existing.firstTs) existing.firstTs = ts;
        if (ts > existing.lastTs) existing.lastTs = ts;
      }
    }
  }
  for (const [sid, times] of subSessionMap) {
    subagentTimes.push({ sessionId: sid, ...times });
  }

  // Build toolUseId → result timestamp and duration maps
  const resultTimestamps = new Map<string, string>();
  const resultDurations = new Map<string, number>();
  const resultErrors = new Map<string, { isError: boolean; errorMessage?: string }>();
  for (const e of sessionEntries) {
    if (e.entryType === "tool_result" && e.toolUseId) {
      resultTimestamps.set(e.toolUseId, e.timestamp);
      if (e.toolDurationMs) resultDurations.set(e.toolUseId, e.toolDurationMs);
      if (e.isError) resultErrors.set(e.toolUseId, { isError: true, errorMessage: e.errorMessage });
    }
  }

  // Split entries into turns at each user_message
  const turnBoundaries: number[] = [];
  for (let i = 0; i < sessionEntries.length; i++) {
    if (sessionEntries[i].entryType === "user_message") turnBoundaries.push(i);
  }

  const turns: TraceTurn[] = [];
  let totalTokens = 0;
  let totalCost = 0;

  for (let t = 0; t < turnBoundaries.length; t++) {
    const startIdx = turnBoundaries[t];
    const endIdx = t + 1 < turnBoundaries.length ? turnBoundaries[t + 1] : sessionEntries.length;
    const turnEntries = sessionEntries.slice(startIdx, endIdx);
    const turnStart = new Date(turnEntries[0].timestamp).getTime();
    const userMessage = turnEntries[0].userRequest || "";

    const spans: TraceSpan[] = [];
    let turnTokens = 0;
    let turnCost = 0;
    let turnModel: string | undefined;
    let turnDurationMs = 0;
    let spanCounter = 0;

    for (const e of turnEntries) {
      const offsetMs = new Date(e.timestamp).getTime() - turnStart;

      if (e.entryType === "tool_use" && e.toolName) {
        let durationMs = 0;
        let isError = false;
        let detail: string | undefined;

        if (e.toolUseId) {
          const result = resultTimestamps.get(e.toolUseId);
          if (result) {
            const explicitMs = resultDurations.get(e.toolUseId);
            durationMs = explicitMs ?? (new Date(result).getTime() - new Date(e.timestamp).getTime());
            if (durationMs < 0 || durationMs > 3600000) durationMs = 0;
          }
          const err = resultErrors.get(e.toolUseId);
          if (err) {
            isError = true;
            detail = err.errorMessage;
          }
        }

        // Summarize params for detail
        if (!detail && e.toolParams) {
          if (e.toolName === "Agent") {
            const desc = e.toolParams.description as string | undefined;
            const prompt = e.toolParams.prompt as string | undefined;
            detail = desc || (prompt && prompt.length > 100 ? prompt.slice(0, 100) + "..." : prompt) || undefined;
          } else {
            const keys = Object.keys(e.toolParams);
            if (keys.length <= 3) {
              const parts = keys.map((k) => {
                const v = e.toolParams![k];
                const s = typeof v === "string" ? v : JSON.stringify(v);
                return `${k}: ${s && s.length > 60 ? s.slice(0, 60) + "..." : s}`;
              });
              detail = parts.join(", ");
            } else {
              detail = keys.join(", ");
            }
          }
        }

        // For Agent tool calls, find the matching subagent session by time overlap
        let subagentSessionId: string | undefined;
        if (e.toolName === "Agent" && durationMs > 0) {
          const toolStart = new Date(e.timestamp).getTime();
          const toolEnd = toolStart + durationMs;
          for (const sub of subagentTimes) {
            if (sub.firstTs >= toolStart - 2000 && sub.firstTs <= toolEnd + 2000) {
              subagentSessionId = sub.sessionId;
              break;
            }
          }
        }

        spans.push({
          id: `span-${t}-${spanCounter++}`,
          kind: "tool",
          label: e.skillName ? `Skill(${e.skillName})` : e.toolName,
          startMs: offsetMs,
          durationMs,
          isError: isError || undefined,
          detail,
          toolUseId: e.toolUseId,
          subagentSessionId,
        });
      }

      if (e.entryType === "stop_hook_summary" && e.hookCommand) {
        const shortCmd = shortName(e.hookCommand);
        spans.push({
          id: `span-${t}-${spanCounter++}`,
          kind: "hook",
          label: shortCmd,
          startMs: offsetMs,
          durationMs: e.hookDurationMs || 0,
          isError: e.isError || undefined,
          detail: e.hookOutput || e.errorMessage,
        });
      }

      if (e.entryType === "hook_progress" && e.hookCommand) {
        const shortCmd = shortName(e.hookCommand);
        // hook_progress doesn't have duration — use a small placeholder
        spans.push({
          id: `span-${t}-${spanCounter++}`,
          kind: "hook",
          label: `${e.hookEvent || "hook"}: ${shortCmd}`,
          startMs: offsetMs,
          durationMs: 0,
          detail: e.hookOutput,
        });
      }

      if (e.entryType === "tokens") {
        const tokens = (e.inputTokens || 0) + (e.outputTokens || 0);
        const cost = calculateCost(
          e.model || "",
          e.inputTokens || 0,
          e.outputTokens || 0,
          e.cacheReadTokens || 0,
          e.cacheCreationTokens || 0,
        );
        turnTokens += tokens;
        turnCost += cost;
        totalTokens += tokens;
        totalCost += cost;
        if (e.model) turnModel = e.model;
      }

      if (e.entryType === "turn_duration" && e.turnDurationMs) {
        turnDurationMs = e.turnDurationMs;
      }
    }

    // Infer turn duration from spans if not available
    if (turnDurationMs === 0 && spans.length > 0) {
      turnDurationMs = Math.max(...spans.map((s) => s.startMs + s.durationMs));
    }
    // Fallback: use timestamp range
    if (turnDurationMs === 0 && turnEntries.length > 1) {
      turnDurationMs = new Date(turnEntries[turnEntries.length - 1].timestamp).getTime() - turnStart;
    }

    turns.push({
      index: t,
      userMessage,
      startTime: turnEntries[0].timestamp,
      durationMs: turnDurationMs,
      spans: spans.sort((a, b) => a.startMs - b.startMs),
      tokenCount: turnTokens || undefined,
      cost: turnCost || undefined,
      model: turnModel,
    });
  }

  const totalDurationMs = turns.length > 0
    ? new Date(sessionEntries[sessionEntries.length - 1].timestamp).getTime() -
      new Date(sessionEntries[0].timestamp).getTime()
    : 0;

  return { sessionId, parentSessionId, project, turns, totalDurationMs, totalTokens, totalCost };
}

export function aggregateSubagents(entries: SessionEntry[]): SubagentsData {
  // Build subagent session time map: parentSessionId → [{ sessionId, firstTs, lastTs }]
  const subSessionMap = new Map<string, Map<string, { firstTs: number; lastTs: number }>>();
  for (const e of entries) {
    if (!e.parentSessionId || e.sessionId === e.parentSessionId) continue;
    const ts = new Date(e.timestamp).getTime();
    let parentMap = subSessionMap.get(e.parentSessionId);
    if (!parentMap) {
      parentMap = new Map();
      subSessionMap.set(e.parentSessionId, parentMap);
    }
    const existing = parentMap.get(e.sessionId);
    if (!existing) {
      parentMap.set(e.sessionId, { firstTs: ts, lastTs: ts });
    } else {
      if (ts < existing.firstTs) existing.firstTs = ts;
      if (ts > existing.lastTs) existing.lastTs = ts;
    }
  }

  // Build toolUseId → result info
  const resultMap = new Map<string, { durationMs?: number; isError?: boolean; errorMessage?: string }>();
  for (const e of entries) {
    if (e.entryType === "tool_result" && e.toolUseId) {
      resultMap.set(e.toolUseId, {
        durationMs: e.toolDurationMs,
        isError: e.isError,
        errorMessage: e.errorMessage,
      });
    }
  }

  // Collect Agent tool_use entries
  const agentCalls = entries.filter((e) => e.entryType === "tool_use" && e.toolName === "Agent");

  const durations: number[] = [];
  const parentSessions = new Set<string>();
  const dayBuckets = new Map<string, { count: number; bg: number; fg: number }>();
  const typeBuckets = new Map<string, { count: number; durations: number[]; errors: number }>();
  const recent: SubagentInvocation[] = [];
  let backgroundCount = 0;
  const now = Date.now();
  let activeNow = 0;

  for (const e of agentCalls) {
    const params = e.toolParams ?? {};
    const description = params.description as string | undefined;
    const subagentType = (params.subagent_type as string | undefined) || "unspecified";
    const runInBackground = params.run_in_background as boolean | undefined;
    const model = params.model as string | undefined;

    const result = e.toolUseId ? resultMap.get(e.toolUseId) : undefined;
    const durationMs = result?.durationMs;
    const isError = result?.isError;
    const errorMessage = result?.errorMessage;

    // Match to subagent session
    let subagentSessionId: string | undefined;
    const parentChildren = subSessionMap.get(e.sessionId);
    if (parentChildren && durationMs && durationMs > 0) {
      const toolStart = new Date(e.timestamp).getTime();
      const toolEnd = toolStart + durationMs;
      for (const [sid, times] of parentChildren) {
        if (times.firstTs >= toolStart - 2000 && times.firstTs <= toolEnd + 2000) {
          subagentSessionId = sid;
          break;
        }
      }
    }

    // Active now: child session started in last 5min with last activity within 1min
    if (subagentSessionId && parentChildren) {
      const childTimes = parentChildren.get(subagentSessionId);
      if (childTimes && childTimes.firstTs >= now - 5 * 60 * 1000 && childTimes.lastTs >= now - 60 * 1000) {
        activeNow++;
      }
    }

    parentSessions.add(e.sessionId);
    if (runInBackground) backgroundCount++;
    if (durationMs && durationMs > 0) durations.push(durationMs);

    // Day buckets
    const day = bucketKey(e.timestamp);
    const db = dayBuckets.get(day) ?? { count: 0, bg: 0, fg: 0 };
    db.count++;
    if (runInBackground) db.bg++;
    else db.fg++;
    dayBuckets.set(day, db);

    // Type buckets
    const tb = typeBuckets.get(subagentType) ?? { count: 0, durations: [], errors: 0 };
    tb.count++;
    if (durationMs && durationMs > 0) tb.durations.push(durationMs);
    if (isError) tb.errors++;
    typeBuckets.set(subagentType, tb);

    // Recent invocations
    recent.push({
      timestamp: e.timestamp,
      sessionId: e.sessionId,
      project: e.project,
      description,
      subagentType,
      runInBackground,
      model,
      durationMs,
      isError,
      errorMessage,
      subagentSessionId,
    });
  }

  // Sort and compute stats
  durations.sort((a, b) => a - b);
  const avgMs = durations.length > 0 ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length) : 0;

  const byDay = [...dayBuckets.entries()]
    .map(([date, { count, bg, fg }]) => ({ date, count, backgroundCount: bg, foregroundCount: fg }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const totalDispatches = agentCalls.length;
  const byType: SubagentTypeBucket[] = [...typeBuckets.entries()]
    .map(([subagentType, { count, durations: d, errors }]) => {
      d.sort((a, b) => a - b);
      return {
        subagentType,
        count,
        pct: totalDispatches > 0 ? Math.round((count / totalDispatches) * 100) : 0,
        avgMs: d.length > 0 ? Math.round(d.reduce((s, v) => s + v, 0) / d.length) : 0,
        p95Ms: percentile(d, 95),
        errors,
      };
    })
    .sort((a, b) => b.count - a.count);

  recent.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return {
    activeNow,
    totalDispatches,
    backgroundDispatches: backgroundCount,
    parentSessionCount: parentSessions.size,
    avgMs,
    p50Ms: percentile(durations, 50),
    p95Ms: percentile(durations, 95),
    byDay,
    byType,
    recent: recent.slice(0, 100),
  };
}
