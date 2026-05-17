/**
 * Telemetry v2 reducers.
 *
 * Each reducer consumes TelemetryEvent[] and produces the same output types
 * as the v1 aggregator. The API surface is identical — only the input changes.
 */

import type { TelemetryEvent } from "./event.js";
import type {
  Granularity,
  OverviewData,
  ToolsData, ToolMetric,
  HooksData, HookMetric,
  SkillsData, SkillMetric,
  TokensData, TokenBucket,
  CostData, CostBucket, ModelCost,
  SessionsData, SessionMetric, SessionBucket, ProjectBucket, TimeBucket,
  ToolDetailData,
  HookDetailData,
  SkillDetailData,
  MemoryUsageData,
  MemorySearchData, MemorySearchInvocation, MemorySearchResult,
  HookEventData, HookInvocation,
  CompactionData,
  ApiDurationData,
  TraceData, TraceSpan, TraceTurn,
  SubagentsData, SubagentInvocation, SubagentTypeBucket,
  VerificationData,
} from "./types.js";
import { calculateCost } from "./pricing.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract a readable hook name from a shell command string (e.g. "bun /path/hook.ts 2>/dev/null"). */
function hookBasename(command: string | null | undefined): string {
  if (!command) return "unknown";
  const tokens = command.split(/\s+/);
  const script = tokens.find((t) => /\.(ts|js|sh|py)$/.test(t) && t.includes("/"));
  if (script) return script.split("/").pop()!.replace(/\.(ts|js|sh|py)$/, "");
  const path = tokens.find((t) => t.startsWith("/") && !t.startsWith("/dev/"));
  if (path) return path.split("/").pop() || "unknown";
  return "unknown";
}

function bucketKey(ts: string, g: Granularity): string {
  switch (g) {
    case "minute": return ts.slice(0, 16);
    case "hour": return ts.slice(0, 13);
    default: return ts.slice(0, 10);
  }
}

function dateKey(ts: string): string { return ts.slice(0, 10); }

function hourKey(ts: string): number {
  const m = ts.match(/T(\d{2}):/);
  return m ? parseInt(m[1], 10) : 0;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.max(0, Math.floor((p / 100) * (sorted.length - 1)))];
}

function costFromTokenEvent(e: TelemetryEvent): number {
  const d = e.data || {};
  return calculateCost(
    (d.model as string) || "",
    (d.input as number) || 0,
    (d.output as number) || 0,
    (d.cacheRead as number) || 0,
    (d.cacheCreation as number) || 0,
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export function reduceOverview(events: TelemetryEvent[], granularity: Granularity = "day"): OverviewData {
  const sessionIds = new Set<string>();
  let messages = 0, toolCalls = 0, toolErrors = 0, hookErrors = 0, totalCost = 0;
  const dayMap = new Map<string, { sessions: Set<string>; messages: number }>();

  for (const e of events) {
    const day = bucketKey(e.ts, granularity);
    if (!dayMap.has(day)) dayMap.set(day, { sessions: new Set(), messages: 0 });
    const bucket = dayMap.get(day)!;
    sessionIds.add(e.sid);
    bucket.sessions.add(e.sid);

    if (e.kind === "tokens") {
      messages++;
      bucket.messages++;
      totalCost += costFromTokenEvent(e);
    }
    if (e.kind === "tool") toolCalls++;
    if (e.kind === "tool_result" && e.data?.isError) toolErrors++;
    if (e.kind === "hook_summary" && e.data?.isError) hookErrors++;
  }

  const byDay = [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, sessions: v.sessions.size, messages: v.messages }));

  return { sessions: sessionIds.size, messages, toolCalls, toolErrors, hookErrors, totalCost, byDay };
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export function reduceTools(events: TelemetryEvent[], granularity: Granularity = "day"): ToolsData {
  const toolCounts = new Map<string, {
    count: number; errors: number; lastUsed: string; durations: number[];
    linesAdded: number; linesRemoved: number; sessions: Set<string>;
  }>();
  const dayToolMap = new Map<string, Map<string, number>>();
  const dayChurnMap = new Map<string, Map<string, number>>();
  const dayProjectMap = new Map<string, Map<string, number>>();
  const daySessionMap = new Map<string, Set<string>>();
  const dayErrorMap = new Map<string, Map<string, number>>();
  const dayLatencyMap = new Map<string, Map<string, number[]>>();
  const dayToolSessionMap = new Map<string, Map<string, Set<string>>>();
  const skillToolMap = new Map<string, Map<string, number>>();
  const projectCounts = new Map<string, number>();
  const sidToProject = new Map<string, string>();

  // Build useId → toolName map and sid → project map
  const useIdToTool = new Map<string, { toolName: string; timestamp: string }>();
  for (const e of events) {
    if (e.kind === "tool" && e.data?.tool && e.data?.useId) {
      useIdToTool.set(e.data.useId as string, { toolName: e.data.tool as string, timestamp: e.ts });
    }
    if (e.data?.project && !sidToProject.has(e.sid)) {
      sidToProject.set(e.sid, e.data.project as string);
    }
  }

  // Build useId → result info
  const resultInfo = new Map<string, { timestamp: string; durationMs?: number }>();
  for (const e of events) {
    if (e.kind === "tool_result" && e.data?.useId) {
      resultInfo.set(e.data.useId as string, { timestamp: e.ts, durationMs: e.ms });
    }
  }

  for (const e of events) {
    if (e.kind === "tool" && e.data?.tool) {
      const toolName = e.data.tool as string;
      const cur = toolCounts.get(toolName) || { count: 0, errors: 0, lastUsed: "", durations: [], linesAdded: 0, linesRemoved: 0, sessions: new Set<string>() };
      cur.count++;
      cur.sessions.add(e.sid);
      if (!cur.lastUsed || e.ts > cur.lastUsed) cur.lastUsed = e.ts;

      const added = (e.data?.linesAdded as number) || 0;
      const removed = (e.data?.linesRemoved as number) || 0;
      cur.linesAdded += added;
      cur.linesRemoved += removed;

      const useId = e.data.useId as string | undefined;
      if (useId) {
        const result = resultInfo.get(useId);
        if (result) {
          const ms = result.durationMs ?? (new Date(result.timestamp).getTime() - new Date(e.ts).getTime());
          if (ms >= 0 && ms < 3600000) {
            cur.durations.push(ms);
            const bkLat = bucketKey(e.ts, granularity);
            if (!dayLatencyMap.has(bkLat)) dayLatencyMap.set(bkLat, new Map());
            const dlm = dayLatencyMap.get(bkLat)!;
            if (!dlm.has(toolName)) dlm.set(toolName, []);
            dlm.get(toolName)!.push(ms);
          }
        }
      }

      toolCounts.set(toolName, cur);

      const bk = bucketKey(e.ts, granularity);

      if (!dayToolMap.has(bk)) dayToolMap.set(bk, new Map());
      dayToolMap.get(bk)!.set(toolName, (dayToolMap.get(bk)!.get(toolName) || 0) + 1);

      // Track per-day sessions per tool
      if (!dayToolSessionMap.has(bk)) dayToolSessionMap.set(bk, new Map());
      const dtss = dayToolSessionMap.get(bk)!;
      if (!dtss.has(toolName)) dtss.set(toolName, new Set());
      dtss.get(toolName)!.add(e.sid);

      // Track skill→tool correlation
      if (e.data?.skill) {
        const skillName = e.data.skill as string;
        if (!skillToolMap.has(skillName)) skillToolMap.set(skillName, new Map());
        const stm = skillToolMap.get(skillName)!;
        stm.set(toolName, (stm.get(toolName) || 0) + 1);
      }

      const churnTotal = added + removed;
      if (churnTotal > 0) {
        if (!dayChurnMap.has(bk)) dayChurnMap.set(bk, new Map());
        dayChurnMap.get(bk)!.set(toolName, (dayChurnMap.get(bk)!.get(toolName) || 0) + churnTotal);
      }

      const project = sidToProject.get(e.sid) || "unknown";
      projectCounts.set(project, (projectCounts.get(project) || 0) + 1);
      if (!dayProjectMap.has(bk)) dayProjectMap.set(bk, new Map());
      dayProjectMap.get(bk)!.set(project, (dayProjectMap.get(bk)!.get(project) || 0) + 1);

      if (!daySessionMap.has(bk)) daySessionMap.set(bk, new Set());
      daySessionMap.get(bk)!.add(e.sid);
    }

    if (e.kind === "tool_result" && e.data?.isError) {
      const useId = e.data.useId as string | undefined;
      const info = useId ? useIdToTool.get(useId) : undefined;
      if (info) {
        const cur = toolCounts.get(info.toolName);
        if (cur) cur.errors++;
        const errBk = bucketKey(info.timestamp, granularity);
        if (!dayErrorMap.has(errBk)) dayErrorMap.set(errBk, new Map());
        const dem = dayErrorMap.get(errBk)!;
        dem.set(info.toolName, (dem.get(info.toolName) || 0) + 1);
      }
    }
  }

  const total = [...toolCounts.values()].reduce((s, v) => s + v.count, 0);
  const ranked: ToolMetric[] = [...toolCounts.entries()]
    .map(([name, v]) => {
      const sorted = v.durations.slice().sort((a, b) => a - b);
      const avgMs = sorted.length > 0 ? Math.round(sorted.reduce((s, d) => s + d, 0) / sorted.length) : undefined;
      const sessionCount = v.sessions.size;
      return {
        name, count: v.count, errorCount: v.errors,
        pct: total > 0 ? (v.count / total) * 100 : 0,
        lastUsed: v.lastUsed, avgMs,
        p50Ms: sorted.length > 0 ? Math.round(percentile(sorted, 50)) : undefined,
        p95Ms: sorted.length > 0 ? Math.round(percentile(sorted, 95)) : undefined,
        linesAdded: v.linesAdded || undefined,
        linesRemoved: v.linesRemoved || undefined,
        sessionCount: sessionCount || undefined,
        velocity: sessionCount > 0 ? Math.round((v.count / sessionCount) * 10) / 10 : undefined,
      };
    })
    .sort((a, b) => b.count - a.count);

  const sortBuckets = <T extends { date: string }>(map: Map<string, T>): T[] =>
    [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);

  const byDay = sortBuckets(new Map([...dayToolMap.entries()].map(([date, tools]) => [date, {
    date, count: [...tools.values()].reduce((s, v) => s + v, 0), tools: Object.fromEntries(tools),
  }])));

  const byDayChurn = sortBuckets(new Map([...dayChurnMap.entries()].map(([date, tools]) => [date, {
    date, count: [...tools.values()].reduce((s, v) => s + v, 0), tools: Object.fromEntries(tools),
  }])));

  const byDayProject = sortBuckets(new Map([...dayProjectMap.entries()].map(([date, projects]) => [date, {
    date, count: [...projects.values()].reduce((s, v) => s + v, 0), projects: Object.fromEntries(projects),
  }])));

  const byDayVelocity = [...dayToolMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, tools]) => {
      const calls = [...tools.values()].reduce((s, v) => s + v, 0);
      const sessions = daySessionMap.get(date)?.size || 1;
      return { date, count: calls, velocity: Math.round((calls / sessions) * 10) / 10 };
    });

  const projectTotal = [...projectCounts.values()].reduce((s, v) => s + v, 0);
  const projectRanked = [...projectCounts.entries()]
    .map(([project, count]) => ({ project, count, pct: projectTotal > 0 ? (count / projectTotal) * 100 : 0 }))
    .sort((a, b) => b.count - a.count);

  const byDayErrors = sortBuckets(new Map([...dayErrorMap.entries()].map(([date, tools]) => [date, {
    date, count: [...tools.values()].reduce((s, v) => s + v, 0), tools: Object.fromEntries(tools),
  }])));

  const byDayLatency = sortBuckets(new Map([...dayLatencyMap.entries()].map(([date, toolDurations]) => [date, {
    date, count: [...toolDurations.values()].reduce((s, v) => s + v.length, 0),
    tools: Object.fromEntries([...toolDurations.entries()].map(([tool, durations]) => [
      tool, durations.length > 0 ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length) : 0,
    ])),
  }])));

  const byDaySessionCount = sortBuckets(new Map([...dayToolSessionMap.entries()].map(([date, toolSessions]) => [date, {
    date, count: [...toolSessions.values()].reduce((s, v) => s + v.size, 0),
    tools: Object.fromEntries([...toolSessions.entries()].map(([tool, sids]) => [tool, sids.size])),
  }])));

  const skillToolMatrix = [...skillToolMap.entries()].map(([skill, toolCounts]) => ({
    skill,
    tools: [...toolCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tool, count]) => ({ tool, count })),
  })).sort((a, b) => b.tools.reduce((s, t) => s + t.count, 0) - a.tools.reduce((s, t) => s + t.count, 0));

  return { ranked, byDay, byDayChurn, byDayProject, byDayVelocity, byDayErrors, byDayLatency, byDaySessionCount, skillToolMatrix, projectRanked };
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function reduceHooks(events: TelemetryEvent[], granularity: Granularity = "day"): HooksData {
  const hookMap = new Map<string, { event: string; durations: number[]; blocks: number; crashes: number; fullCommand: string; progressCount: number; lastUsed: string }>();
  const dayHookMap = new Map<string, Map<string, number>>();
  const dayHookLatencyMap = new Map<string, Map<string, number[]>>();
  const dayHookErrorMap = new Map<string, Map<string, number>>();
  const dayHookEventMap = new Map<string, Map<string, number>>();

  for (const e of events) {
    if (e.kind === "hook_summary" && e.data?.command) {
      const shortCmd = e.name;
      const cur = hookMap.get(shortCmd) || { event: "", durations: [], blocks: 0, crashes: 0, fullCommand: (e.data.command as string), progressCount: 0, lastUsed: "" };
      if (e.ms !== undefined) cur.durations.push(e.ms);
      const decision = e.data.hookDecision as string | undefined;
      if (decision === "block") cur.blocks++;
      else if (decision === "crash" || e.data.isError) cur.crashes++;
      cur.fullCommand = e.data.command as string;
      if (!cur.lastUsed || e.ts > cur.lastUsed) cur.lastUsed = e.ts;
      hookMap.set(shortCmd, cur);

      const bk = bucketKey(e.ts, granularity);
      if (!dayHookMap.has(bk)) dayHookMap.set(bk, new Map());
      const dm = dayHookMap.get(bk)!;
      dm.set(shortCmd, (dm.get(shortCmd) || 0) + 1);

      if (e.ms !== undefined) {
        if (!dayHookLatencyMap.has(bk)) dayHookLatencyMap.set(bk, new Map());
        const dlm = dayHookLatencyMap.get(bk)!;
        if (!dlm.has(shortCmd)) dlm.set(shortCmd, []);
        dlm.get(shortCmd)!.push(e.ms);
      }
      if (decision === "block" || decision === "crash" || e.data.isError) {
        if (!dayHookErrorMap.has(bk)) dayHookErrorMap.set(bk, new Map());
        const dem = dayHookErrorMap.get(bk)!;
        dem.set(shortCmd, (dem.get(shortCmd) || 0) + 1);
      }
      const eventType = (e.data.event as string) || "unknown";
      if (!dayHookEventMap.has(bk)) dayHookEventMap.set(bk, new Map());
      const devM = dayHookEventMap.get(bk)!;
      devM.set(eventType, (devM.get(eventType) || 0) + 1);
    }

    if (e.kind === "hook" && e.data?.command) {
      const shortCmd = e.name;
      const cur = hookMap.get(shortCmd) || { event: "", durations: [], blocks: 0, crashes: 0, fullCommand: (e.data.command as string), progressCount: 0, lastUsed: "" };
      cur.event = (e.data.event as string) || cur.event;
      cur.fullCommand = e.data.command as string;
      if (!cur.lastUsed || e.ts > cur.lastUsed) cur.lastUsed = e.ts;
      hookMap.set(shortCmd, cur);

      if ((e.data.event as string) !== "Stop") {
        cur.progressCount++;
        const bk = bucketKey(e.ts, granularity);
        if (!dayHookMap.has(bk)) dayHookMap.set(bk, new Map());
        const dm = dayHookMap.get(bk)!;
        dm.set(shortCmd, (dm.get(shortCmd) || 0) + 1);
        const evType = (e.data.event as string) || "unknown";
        if (!dayHookEventMap.has(bk)) dayHookEventMap.set(bk, new Map());
        const devM = dayHookEventMap.get(bk)!;
        devM.set(evType, (devM.get(evType) || 0) + 1);
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
        command, event: v.event, count,
        avgMs: Math.round(avgMs),
        p50Ms: Math.round(percentile(sorted, 50)),
        p95Ms: Math.round(percentile(sorted, 95)),
        blocks: v.blocks, crashes: v.crashes, fullCommand: v.fullCommand,
        lastUsed: v.lastUsed || undefined,
      };
    })
    .sort((a, b) => b.count - a.count);

  const byDay = [...dayHookMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, hooks]) => ({
      date, count: [...hooks.values()].reduce((s, v) => s + v, 0),
      hooks: Object.fromEntries(hooks),
    }));

  const byDayLatency = [...dayHookLatencyMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, hookDurations]) => ({
      date, count: [...hookDurations.values()].reduce((s, v) => s + v.length, 0),
      hooks: Object.fromEntries([...hookDurations.entries()].map(([hook, durations]) => [
        hook, durations.length > 0 ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length) : 0,
      ])),
    }));

  const byDayErrors = [...dayHookErrorMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, hooks]) => ({
      date, count: [...hooks.values()].reduce((s, v) => s + v, 0), hooks: Object.fromEntries(hooks),
    }));

  const byDayEvent = [...dayHookEventMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, events]) => ({
      date, count: [...events.values()].reduce((s, v) => s + v, 0), events: Object.fromEntries(events),
    }));

  return { ranked, byDay, byDayLatency, byDayErrors, byDayEvent };
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

export function reduceSkills(events: TelemetryEvent[], granularity: Granularity = "day", validSkills?: Set<string>): SkillsData {
  const skillCounts = new Map<string, { count: number; errors: number; sessions: Set<string>; durations: number[]; lastUsed: string }>();
  const daySkillMap = new Map<string, Map<string, number>>();
  const daySkillSessionMap = new Map<string, Map<string, Set<string>>>();
  const daySkillErrorMap = new Map<string, Map<string, number>>();
  const daySkillLatencyMap = new Map<string, Map<string, number[]>>();

  for (const e of events) {
    if (e.kind === "tool" && e.data?.skill) {
      const skillName = e.data.skill as string;
      if (validSkills && !validSkills.has(skillName)) continue;
      const cur = skillCounts.get(skillName) || { count: 0, errors: 0, sessions: new Set<string>(), durations: [], lastUsed: "" };
      cur.count++;
      if (e.err) cur.errors++;
      cur.sessions.add(e.sid);
      if (e.ms != null) cur.durations.push(e.ms);
      if (!cur.lastUsed || e.ts > cur.lastUsed) cur.lastUsed = e.ts;
      skillCounts.set(skillName, cur);

      const bk = bucketKey(e.ts, granularity);
      if (!daySkillMap.has(bk)) daySkillMap.set(bk, new Map());
      const dm = daySkillMap.get(bk)!;
      dm.set(skillName, (dm.get(skillName) || 0) + 1);

      if (!daySkillSessionMap.has(bk)) daySkillSessionMap.set(bk, new Map());
      const dsm = daySkillSessionMap.get(bk)!;
      if (!dsm.has(skillName)) dsm.set(skillName, new Set());
      dsm.get(skillName)!.add(e.sid);

      if (e.err) {
        if (!daySkillErrorMap.has(bk)) daySkillErrorMap.set(bk, new Map());
        const dem = daySkillErrorMap.get(bk)!;
        dem.set(skillName, (dem.get(skillName) || 0) + 1);
      }

      if (e.ms != null) {
        if (!daySkillLatencyMap.has(bk)) daySkillLatencyMap.set(bk, new Map());
        const dlm = daySkillLatencyMap.get(bk)!;
        if (!dlm.has(skillName)) dlm.set(skillName, []);
        dlm.get(skillName)!.push(e.ms);
      }
    }
  }

  const total = [...skillCounts.values()].reduce((s, v) => s + v.count, 0);
  const ranked: SkillMetric[] = [...skillCounts.entries()]
    .map(([skill, v]) => {
      const sorted = [...v.durations].sort((a, b) => a - b);
      const avgMs = sorted.length > 0 ? sorted.reduce((s, x) => s + x, 0) / sorted.length : undefined;
      const p50Ms = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.5)] : undefined;
      const p95Ms = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.95)] : undefined;
      return {
        skill, count: v.count,
        pct: total > 0 ? (v.count / total) * 100 : 0,
        errors: v.errors, sessions: v.sessions.size,
        avgMs, p50Ms, p95Ms, lastUsed: v.lastUsed,
      };
    })
    .sort((a, b) => b.count - a.count);

  const byDay = [...daySkillMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, skills]) => ({
      date, count: [...skills.values()].reduce((s, v) => s + v, 0),
      skills: Object.fromEntries(skills),
    }));

  const byDaySessions = [...daySkillSessionMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, skillSessions]) => ({
      date, count: [...skillSessions.values()].reduce((s, v) => s + v.size, 0),
      skills: Object.fromEntries([...skillSessions.entries()].map(([skill, sids]) => [skill, sids.size])),
    }));

  const byDayErrors = [...daySkillErrorMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, skills]) => ({
      date, count: [...skills.values()].reduce((s, v) => s + v, 0), skills: Object.fromEntries(skills),
    }));

  const byDayLatency = [...daySkillLatencyMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, skillDurations]) => ({
      date, count: [...skillDurations.values()].reduce((s, v) => s + v.length, 0),
      skills: Object.fromEntries([...skillDurations.entries()].map(([skill, durations]) => [
        skill, durations.length > 0 ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length) : 0,
      ])),
    }));

  return { ranked, byDay, byDaySessions, byDayErrors, byDayLatency };
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

export function reduceTokens(events: TelemetryEvent[], granularity: Granularity = "day"): TokensData {
  const dayMap = new Map<string, TokenBucket>();
  let totalInput = 0, totalOutput = 0, totalCacheRead = 0, totalCacheCreation = 0;

  for (const e of events) {
    if (e.kind !== "tokens") continue;
    const d = e.data || {};
    const day = bucketKey(e.ts, granularity);
    const cur = dayMap.get(day) || { date: day, input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
    const input = (d.input as number) || 0;
    const output = (d.output as number) || 0;
    const cacheRead = (d.cacheRead as number) || 0;
    const cacheCreation = (d.cacheCreation as number) || 0;
    cur.input += input; cur.output += output; cur.cacheRead += cacheRead; cur.cacheCreation += cacheCreation;
    dayMap.set(day, cur);
    totalInput += input; totalOutput += output; totalCacheRead += cacheRead; totalCacheCreation += cacheCreation;
  }

  const cacheTotal = totalCacheRead + totalCacheCreation;
  const cacheEfficiency = cacheTotal > 0 ? (totalCacheRead / cacheTotal) * 100 : 0;
  const byDay = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date));
  return { cacheEfficiency, totalInput, totalOutput, totalCacheRead, totalCacheCreation, byDay };
}

// ---------------------------------------------------------------------------
// Cost
// ---------------------------------------------------------------------------

export function reduceCost(events: TelemetryEvent[], granularity: Granularity = "day"): CostData {
  let totalUsd = 0;
  const dayMap = new Map<string, number>();
  const modelMap = new Map<string, number>();

  for (const e of events) {
    if (e.kind !== "tokens") continue;
    const d = e.data || {};
    const model = (d.model as string) || "";
    if (!model) continue;
    const cost = costFromTokenEvent(e);
    totalUsd += cost;
    const day = bucketKey(e.ts, granularity);
    dayMap.set(day, (dayMap.get(day) || 0) + cost);
    modelMap.set(model, (modelMap.get(model) || 0) + cost);
  }

  const byDay: CostBucket[] = [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, usd]) => ({ date, usd }));

  const byModel: ModelCost[] = [...modelMap.entries()]
    .map(([model, usd]) => ({ model, usd, pct: totalUsd > 0 ? (usd / totalUsd) * 100 : 0 }))
    .sort((a, b) => b.usd - a.usd);

  return { totalUsd, byDay, byModel };
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export function reduceSessions(events: TelemetryEvent[], granularity: Granularity = "day"): SessionsData {
  const dayMap = new Map<string, { sessions: Set<string>; messages: number; userMessages: number; assistantMessages: number; cost: number; linesAdded: number; linesRemoved: number; commits: number }>();
  const projectMap = new Map<string, Set<string>>();
  const activityMap = new Map<string, number>();
  const dayProjectMap = new Map<string, Map<string, number>>();

  const sessionMap = new Map<string, {
    project: string; parentSessionId?: string;
    firstTs: string; lastTs: string;
    userMessages: number; assistantMessages: number;
    toolCalls: number; cost: number;
    linesAdded: number; linesRemoved: number;
    commits: number; compactions: number;
    hasSubagents: boolean; gitBranch?: string;
    firstUserMessage?: string;
    intent?: string;
  }>();

  // Track which sessions have a pending skill injection (next user message should be skipped)
  const pendingSkillInjection = new Map<string, boolean>();

  function getSession(sid: string, project: string, ts: string, parentSessionId?: string) {
    if (!sessionMap.has(sid)) {
      sessionMap.set(sid, {
        project, parentSessionId, firstTs: ts, lastTs: ts,
        userMessages: 0, assistantMessages: 0, toolCalls: 0, cost: 0,
        linesAdded: 0, linesRemoved: 0, commits: 0, compactions: 0, hasSubagents: false,
      });
    }
    const s = sessionMap.get(sid)!;
    if (ts < s.firstTs) s.firstTs = ts;
    if (ts > s.lastTs) s.lastTs = ts;
    return s;
  }

  for (const e of events) {
    const project = (e.data?.project as string) || "unknown";
    const day = bucketKey(e.ts, granularity);
    if (!dayMap.has(day)) dayMap.set(day, { sessions: new Set(), messages: 0, userMessages: 0, assistantMessages: 0, cost: 0, linesAdded: 0, linesRemoved: 0, commits: 0 });
    const bucket = dayMap.get(day)!;
    bucket.sessions.add(e.sid);

    const parentSessionId = e.data?.parentSessionId as string | undefined;
    const sess = getSession(e.sid, project, e.ts, parentSessionId);
    if (e.data?.gitBranch) sess.gitBranch = e.data.gitBranch as string;

    if (e.kind === "tokens") {
      bucket.messages++; bucket.assistantMessages++;
      sess.assistantMessages++;
      const tokenCost = costFromTokenEvent(e);
      sess.cost += tokenCost;
      bucket.cost += tokenCost;
    }

    if (e.kind === "message" && e.data?.role === "user") {
      bucket.messages++; bucket.userMessages++;
      sess.userMessages++;
      const raw = (e.data?.text as string) ?? "";
      // Clean a raw user-message text into a one-line display string.
      // Returns undefined when the message is noise (system caveats, file paths, etc.).
      const cleanUserMessage = (text: string): string | undefined => {
        if (!text) return undefined;
        const SKIP_COMMANDS = new Set(["clear", "reset"]);
        if (text.includes("local-command-caveat")) return undefined;
        if (text.includes("<task-notification>")) return undefined;
        if (text.includes("<command-name>")) {
          const nameMatch = text.match(/<command-name>([^<]+)<\/command-name>/);
          const argsMatch = text.match(/<command-args>([^<]*)<\/command-args>/);
          if (!nameMatch) return undefined;
          const name = nameMatch[1].trim();
          const bare = name.replace(/^\//, "");
          if (SKIP_COMMANDS.has(bare)) return undefined;
          const args = (argsMatch?.[1] ?? "").trim();
          const isDup = args === name || args === `/${bare}` || args === bare;
          return isDup || !args ? name : `${name} ${args}`;
        }
        const cleaned = text.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
        if (!cleaned || cleaned === "[Request interrupted by user]") return undefined;
        // Only filter when the message is JUST a bare URL or path — keep
        // messages where the user pasted a path/URL alongside substantive text.
        const isBareUrl = /^https?:\/\/\S+$/.test(cleaned);
        const isBareWinPath = /^[A-Za-z]:[\\\/][\S]+$/.test(cleaned) && !/\s/.test(cleaned);
        const isBareUnixPath = /^\/[\w/.-]+$/.test(cleaned);
        if (isBareUrl || isBareWinPath || isBareUnixPath) return undefined;
        return cleaned.slice(0, 200);
      };
      if (pendingSkillInjection.get(e.sid)) {
        pendingSkillInjection.set(e.sid, false);
      } else {
        const display = cleanUserMessage(raw);
        if (display) {
          if (!sess.firstUserMessage) sess.firstUserMessage = display;
          if (!sess.intent) sess.intent = display;
        }
      }
    }

    if (e.kind === "tool") {
      sess.toolCalls++;
      const tool = e.data?.tool as string;
      if (tool === "Agent") sess.hasSubagents = true;
      if (tool === "Skill") pendingSkillInjection.set(e.sid, true);
      const linesAdded = (e.data?.linesAdded as number) || 0;
      const linesRemoved = (e.data?.linesRemoved as number) || 0;
      if (linesAdded) { sess.linesAdded += linesAdded; bucket.linesAdded += linesAdded; }
      if (linesRemoved) { sess.linesRemoved += linesRemoved; bucket.linesRemoved += linesRemoved; }

      if (tool === "Bash" && e.data?.params) {
        const cmd = (e.data.params as Record<string, unknown>)?.command;
        if (typeof cmd === "string" && /\bgit\s+commit\b/.test(cmd)) { sess.commits++; bucket.commits++; }
      }
    }

    if (e.kind === "compact") sess.compactions++;

    if (!projectMap.has(project)) projectMap.set(project, new Set());
    projectMap.get(project)!.add(e.sid);

    if (!dayProjectMap.has(day)) dayProjectMap.set(day, new Map());
    const dpBucket = dayProjectMap.get(day)!;
    dpBucket.set(project, (dpBucket.get(project) || 0) + 1);

    const actKey = bucketKey(e.ts, granularity);
    activityMap.set(actKey, (activityMap.get(actKey) || 0) + 1);
  }

  const byDay: SessionBucket[] = [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      date, sessions: v.sessions.size, messages: v.messages,
      userMessages: v.userMessages, assistantMessages: v.assistantMessages,
      cost: v.cost, linesAdded: v.linesAdded, linesRemoved: v.linesRemoved, commits: v.commits,
    }));

  const byProject: ProjectBucket[] = [...projectMap.entries()]
    .map(([project, sessions]) => ({ project, sessions: sessions.size }))
    .sort((a, b) => b.sessions - a.sessions);

  const byActivity: TimeBucket[] = [...activityMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));

  const byDayProject = [...dayProjectMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, projects]) => ({
      date, count: [...projects.values()].reduce((s, v) => s + v, 0), projects: Object.fromEntries(projects),
    }));

  const sessions: SessionMetric[] = [...sessionMap.entries()]
    // Drop ghost sessions seeded only by hook/gate events (no transcript activity).
    .filter(([, s]) => s.userMessages + s.assistantMessages + s.toolCalls > 0)
    .map(([sessionId, s]) => ({
      sessionId, parentSessionId: s.parentSessionId, project: s.project,
      durationMs: new Date(s.lastTs).getTime() - new Date(s.firstTs).getTime(),
      userMessages: s.userMessages, assistantMessages: s.assistantMessages,
      toolCalls: s.toolCalls, cost: s.cost,
      linesAdded: s.linesAdded, linesRemoved: s.linesRemoved,
      commits: s.commits, compactions: s.compactions,
      firstTimestamp: s.firstTs, lastTimestamp: s.lastTs,
      gitBranch: s.gitBranch, hasSubagents: s.hasSubagents,
      firstUserMessage: s.firstUserMessage,
      intent: s.intent ? s.intent.slice(0, 200) : undefined,
    }))
    .sort((a, b) => b.lastTimestamp.localeCompare(a.lastTimestamp));

  const durations = sessions.map((s) => s.durationMs).filter((d) => d > 0);
  const avgDurationMs = durations.length > 0 ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length) : 0;

  return {
    byDay, byProject, byActivity, byDayProject, sessions, avgDurationMs,
    totalUserMessages: sessions.reduce((s, v) => s + v.userMessages, 0),
    totalAssistantMessages: sessions.reduce((s, v) => s + v.assistantMessages, 0),
    totalLinesAdded: sessions.reduce((s, v) => s + v.linesAdded, 0),
    totalLinesRemoved: sessions.reduce((s, v) => s + v.linesRemoved, 0),
    totalCommits: sessions.reduce((s, v) => s + v.commits, 0),
  };
}

// ---------------------------------------------------------------------------
// Subagent type lookup (shared by detail reducers)
// ---------------------------------------------------------------------------

function buildSubagentTypeMap(events: TelemetryEvent[]): Map<string, string> {
  // Build subagent session time windows by parent
  const subSessionMap = new Map<string, Map<string, { firstTs: number; lastTs: number }>>();
  for (const e of events) {
    const parentId = e.data?.parentSessionId as string | undefined;
    if (!parentId || e.sid === parentId) continue;
    const ts = new Date(e.ts).getTime();
    let parentMap = subSessionMap.get(parentId);
    if (!parentMap) { parentMap = new Map(); subSessionMap.set(parentId, parentMap); }
    const existing = parentMap.get(e.sid);
    if (!existing) parentMap.set(e.sid, { firstTs: ts, lastTs: ts });
    else { if (ts < existing.firstTs) existing.firstTs = ts; if (ts > existing.lastTs) existing.lastTs = ts; }
  }

  // Build duration map from tool_result events
  const durationMap = new Map<string, number>();
  for (const e of events) {
    if (e.kind === "tool_result" && e.data?.useId && e.ms != null) {
      durationMap.set(e.data.useId as string, e.ms);
    }
  }

  // Match each Agent call to a subagent session by ±2s time proximity
  const typeMap = new Map<string, string>();
  for (const e of events) {
    if (e.kind !== "tool" || (e.data?.tool as string) !== "Agent") continue;
    const params = (e.data?.params as Record<string, unknown>) ?? {};
    const subagentType = (params.subagent_type as string | undefined) || "claude";
    const useId = e.data?.useId as string | undefined;
    const durationMs = useId ? durationMap.get(useId) : undefined;
    if (!durationMs || durationMs <= 0) continue;
    const parentChildren = subSessionMap.get(e.sid);
    if (!parentChildren) continue;
    const toolStart = new Date(e.ts).getTime();
    const toolEnd = toolStart + durationMs;
    for (const [sid, times] of parentChildren) {
      if (times.firstTs >= toolStart - 2000 && times.firstTs <= toolEnd + 2000) {
        typeMap.set(sid, subagentType); break;
      }
    }
  }
  return typeMap;
}

// ---------------------------------------------------------------------------
// Tool Detail
// ---------------------------------------------------------------------------

export function reduceToolDetail(events: TelemetryEvent[], toolName: string): ToolDetailData {
  const subagentTypeMap = buildSubagentTypeMap(events);
  const useIdToTimestamp = new Map<string, string>();
  const errorByUseId = new Map<string, string | undefined>();
  const errorFullByUseId = new Map<string, string>();
  const resultByUseId = new Map<string, { timestamp: string; durationMs?: number }>();

  for (const e of events) {
    if (e.kind === "tool" && (e.data?.tool as string) === toolName && e.data?.useId) {
      useIdToTimestamp.set(e.data.useId as string, e.ts);
    }
    if (e.kind === "tool_result" && e.data?.useId) {
      if (e.data.isError) {
        errorByUseId.set(e.data.useId as string, e.err);
        const full = (e.data.resultContent as string | undefined) || e.err;
        if (full) errorFullByUseId.set(e.data.useId as string, full);
      }
      resultByUseId.set(e.data.useId as string, { timestamp: e.ts, durationMs: e.ms });
    }
  }

  const errorTimestamps = new Map<string, string | undefined>();
  const errorFullTimestamps = new Map<string, string>();
  for (const [useId, msg] of errorByUseId) {
    const ts = useIdToTimestamp.get(useId);
    if (ts) {
      errorTimestamps.set(ts, msg);
      const full = errorFullByUseId.get(useId);
      if (full) errorFullTimestamps.set(ts, full);
    }
  }

  // Positional fallback
  let lastToolUseTs: string | null = null;
  for (const e of events) {
    if (e.kind === "tool" && (e.data?.tool as string) === toolName) {
      lastToolUseTs = e.ts;
    } else if (e.kind === "tool_result" && e.data?.isError && lastToolUseTs && !e.data?.useId) {
      errorTimestamps.set(lastToolUseTs, e.err);
      const full = (e.data?.resultContent as string | undefined) || e.err;
      if (full) errorFullTimestamps.set(lastToolUseTs, full);
      lastToolUseTs = null;
    } else if (e.kind === "tool") {
      lastToolUseTs = null;
    }
  }

  const matched = events.filter((e) => e.kind === "tool" && (e.data?.tool as string) === toolName);
  let errorCount = 0;
  let totalLinesAdded = 0;
  let totalLinesRemoved = 0;
  const allSessions = new Set<string>();
  const skillCounts = new Map<string, number>();

  const dayMap = new Map<string, Map<number, number>>();
  const dayErrors = new Map<string, number>();
  const daySessions = new Map<string, Set<string>>();
  const dayChurn = new Map<string, { added: number; removed: number }>();
  const dayDurations = new Map<string, number[]>();

  const invocations: ToolDetailData["invocations"] = [];

  for (const e of matched) {
    const day = dateKey(e.ts);
    if (!dayMap.has(day)) dayMap.set(day, new Map());
    const hm = dayMap.get(day)!;
    const hour = hourKey(e.ts);
    hm.set(hour, (hm.get(hour) || 0) + 1);

    allSessions.add(e.sid);
    if (!daySessions.has(day)) daySessions.set(day, new Set());
    daySessions.get(day)!.add(e.sid);

    const isError = errorTimestamps.has(e.ts);
    if (isError) {
      errorCount++;
      dayErrors.set(day, (dayErrors.get(day) || 0) + 1);
    }

    const added = (e.data?.linesAdded as number) || 0;
    const removed = (e.data?.linesRemoved as number) || 0;
    totalLinesAdded += added;
    totalLinesRemoved += removed;
    if (added + removed > 0) {
      const dc = dayChurn.get(day) || { added: 0, removed: 0 };
      dc.added += added;
      dc.removed += removed;
      dayChurn.set(day, dc);
    }

    const skill = e.data?.skill as string | undefined;
    if (skill) skillCounts.set(skill, (skillCounts.get(skill) || 0) + 1);

    // Duration: adapter already joins tool_result ms onto tool events
    let durationMs: number | undefined = e.ms;
    if (durationMs == null) {
      const useId = e.data?.useId as string | undefined;
      if (useId) {
        const result = resultByUseId.get(useId);
        if (result) {
          durationMs = result.durationMs ?? (new Date(result.timestamp).getTime() - new Date(e.ts).getTime());
          if (durationMs != null && (durationMs < 0 || durationMs > 3600000)) durationMs = undefined;
        }
      }
    }

    if (durationMs != null) {
      if (!dayDurations.has(day)) dayDurations.set(day, []);
      dayDurations.get(day)!.push(durationMs);
    }

    const parentSessionId = e.data?.parentSessionId as string | undefined;
    const isSubagent = !!parentSessionId;
    invocations.push({
      timestamp: e.ts, sessionId: e.sid, project: (e.data?.project as string) || "",
      params: e.data?.params as Record<string, unknown> | undefined,
      durationMs,
      isError: isError || undefined,
      errorMessage: isError ? errorTimestamps.get(e.ts) : undefined,
      errorFull: isError ? errorFullTimestamps.get(e.ts) : undefined,
      skill: skill || undefined,
      linesAdded: added || undefined,
      linesRemoved: removed || undefined,
      isSubagent: isSubagent || undefined,
      subagentType: isSubagent ? (subagentTypeMap.get(e.sid) || "claude") : undefined,
      parentSessionId: parentSessionId || undefined,
    });
  }

  const percentile = (arr: number[], p: number) => {
    const s = arr.slice().sort((a, b) => a - b);
    return s.length > 0 ? s[Math.floor(s.length * p)] : undefined;
  };

  const byDay = [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, hours]) => {
      const count = [...hours.values()].reduce((s, v) => s + v, 0);
      const errors = dayErrors.get(date) || 0;
      const durations = dayDurations.get(date) || [];
      const churn = dayChurn.get(date) || { added: 0, removed: 0 };
      return {
        date, count,
        byHour: Object.fromEntries(hours) as Record<number, number>,
        errors,
        errorRate: count > 0 ? Math.round((errors / count) * 1000) / 10 : 0,
        sessions: daySessions.get(date)?.size || 0,
        linesAdded: churn.added,
        linesRemoved: churn.removed,
        p50Ms: percentile(durations, 0.5),
        p95Ms: percentile(durations, 0.95),
        avgMs: durations.length > 0 ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length) : undefined,
      };
    });

  const skills = [...skillCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));

  return {
    name: toolName, totalCount: matched.length, errorCount, byDay,
    totalLinesAdded, totalLinesRemoved,
    sessionCount: allSessions.size, skills,
    invocations: invocations.sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 200),
  };
}

// ---------------------------------------------------------------------------
// Hook Detail
// ---------------------------------------------------------------------------

export function reduceHookDetail(events: TelemetryEvent[], hookName: string): HookDetailData {
  const subagentTypeMap = buildSubagentTypeMap(events);
  const durations: number[] = [];
  let event = "", blocks = 0, crashes = 0, fullCommand = "";
  const dayMap = new Map<string, { durations: number[]; count: number }>();
  const invocations: HookDetailData["invocations"] = [];
  let hasStopSummary = false;

  for (const e of events) {
    if (e.kind === "hook_summary" && e.name === hookName) {
      hasStopSummary = true;
      const dur = e.ms ?? 0;
      durations.push(dur);
      const decision = (e.data?.hookDecision as string | undefined) ?? (e.data?.isError ? "crash" : "pass");
      if (decision === "block") blocks++;
      else if (decision === "crash") crashes++;
      fullCommand = (e.data?.command as string) || "";

      const day = dateKey(e.ts);
      if (!dayMap.has(day)) dayMap.set(day, { durations: [], count: 0 });
      const dm = dayMap.get(day)!;
      dm.durations.push(dur); dm.count++;

      const parentSessionId = e.data?.parentSessionId as string | undefined;
      const isSubagent = !!parentSessionId;
      invocations.push({
        timestamp: e.ts, sessionId: e.sid, durationMs: dur,
        exitCode: e.data?.exitCode as number | undefined,
        output: e.data?.output as string | undefined,
        decision: decision as "pass" | "block" | "crash",
        isError: decision === "crash" || undefined,
        errorMessage: e.err,
        isSubagent: isSubagent || undefined,
        subagentType: isSubagent ? (subagentTypeMap.get(e.sid) || "claude") : undefined,
        parentSessionId: parentSessionId || undefined,
      });
    }

    if (e.kind === "hook" && e.name === hookName) {
      if (e.data?.event) event = e.data.event as string;
      fullCommand = (e.data?.command as string) || fullCommand;
    }
  }

  if (!hasStopSummary) {
    for (const e of events) {
      if (e.kind === "hook" && e.name === hookName) {
        const trigger = (e.data?.hookName as string)?.includes(":")
          ? (e.data?.hookName as string).split(":").slice(1).join(":")
          : undefined;
        const parentSessionId = e.data?.parentSessionId as string | undefined;
        const isSubagent = !!parentSessionId;
        invocations.push({ timestamp: e.ts, sessionId: e.sid, durationMs: 0, trigger, decision: "pass", isSubagent: isSubagent || undefined, subagentType: isSubagent ? (subagentTypeMap.get(e.sid) || "claude") : undefined, parentSessionId: parentSessionId || undefined });
        const day = dateKey(e.ts);
        if (!dayMap.has(day)) dayMap.set(day, { durations: [], count: 0 });
        dayMap.get(day)!.count++;
      }
    }
  }

  const sorted = durations.slice().sort((a, b) => a - b);
  const timedCount = sorted.length;
  const avgMs = timedCount > 0 ? Math.round(sorted.reduce((s, d) => s + d, 0) / timedCount) : 0;

  const byDay = [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      date, count: v.count,
      avgMs: v.durations.length > 0 ? Math.round(v.durations.reduce((s, d) => s + d, 0) / v.durations.length) : 0,
    }));

  return {
    command: hookName, event, totalCount: invocations.length, avgMs,
    p50Ms: Math.round(percentile(sorted, 50)),
    p95Ms: Math.round(percentile(sorted, 95)),
    blocks, crashes, fullCommand, byDay,
    invocations: invocations.sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 200),
  };
}

// ---------------------------------------------------------------------------
// Skill Detail
// ---------------------------------------------------------------------------

export function reduceSkillDetail(events: TelemetryEvent[], skillName: string): SkillDetailData {
  const subagentTypeMap = buildSubagentTypeMap(events);
  const matched = events.filter((e) => e.kind === "tool" && (e.data?.skill as string) === skillName);
  const dayMap = new Map<string, number>();
  const invocations: SkillDetailData["invocations"] = [];

  for (const e of matched) {
    const day = dateKey(e.ts);
    dayMap.set(day, (dayMap.get(day) || 0) + 1);
    const parentSessionId = e.data?.parentSessionId as string | undefined;
    const isSubagent = !!parentSessionId;
    invocations.push({
      timestamp: e.ts, sessionId: e.sid, project: (e.data?.project as string) || "",
      params: e.data?.params as Record<string, unknown> | undefined,
      userRequest: e.data?.userRequest as string | undefined,
      isSubagent: isSubagent || undefined,
      subagentType: isSubagent ? (subagentTypeMap.get(e.sid) || "claude") : undefined,
      parentSessionId: parentSessionId || undefined,
    });
  }

  const byDay: TimeBucket[] = [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));

  return {
    skill: skillName, totalCount: matched.length, byDay,
    invocations: invocations.sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 200),
  };
}

// ---------------------------------------------------------------------------
// Hook Events
// ---------------------------------------------------------------------------

export function reduceHookEvents(events: TelemetryEvent[]): HookEventData {
  const eventMap = new Map<string, { count: number; hooks: Set<string> }>();
  const invocationMap = new Map<string, HookInvocation>();

  for (const e of events) {
    if (e.kind === "hook" && e.data?.event && e.data?.command) {
      const hookEvent = e.data.event as string;
      const shortCmd = e.name;
      if (!eventMap.has(hookEvent)) eventMap.set(hookEvent, { count: 0, hooks: new Set() });
      const ev = eventMap.get(hookEvent)!;
      ev.hooks.add(shortCmd);

      const key = `${e.sid}::${e.ts}::${hookEvent}`;
      if (!invocationMap.has(key)) {
        invocationMap.set(key, { timestamp: e.ts, sessionId: e.sid, event: hookEvent, hooks: [] });
        ev.count++;
      }
      const inv = invocationMap.get(key)!;
      if (!inv.hooks.find((h) => h.command === shortCmd)) {
        inv.hooks.push({ command: shortCmd });
      }
    }
  }

  const stopGroups = new Map<string, { timestamp: string; sessionId: string; hooks: Array<{ command: string; durationMs?: number; exitCode?: number; output?: string }> }>();
  for (const e of events) {
    if (e.kind === "hook_summary" && e.data?.command) {
      const key = `${e.sid}::${e.ts}`;
      if (!stopGroups.has(key)) stopGroups.set(key, { timestamp: e.ts, sessionId: e.sid, hooks: [] });
      stopGroups.get(key)!.hooks.push({
        command: e.name,
        durationMs: e.ms,
        exitCode: e.data.exitCode as number | undefined,
        output: e.data.output as string | undefined,
      });
    }
  }

  for (const [, group] of stopGroups) {
    const hookEvent = "Stop";
    const key = `${group.sessionId}::${group.timestamp}::${hookEvent}`;
    if (!eventMap.has(hookEvent)) eventMap.set(hookEvent, { count: 0, hooks: new Set() });
    const ev = eventMap.get(hookEvent)!;
    if (!invocationMap.has(key)) {
      invocationMap.set(key, { timestamp: group.timestamp, sessionId: group.sessionId, event: hookEvent, hooks: group.hooks });
      ev.count++;
    }
    for (const h of group.hooks) ev.hooks.add(h.command);
  }

  const KNOWN_EVENTS = ["SessionStart", "UserPromptSubmit", "Stop", "PostToolUse", "Notification"];
  const eventsList = [...eventMap.entries()]
    .map(([event, v]) => ({ event, count: v.count, hooks: [...v.hooks] }))
    .sort((a, b) => {
      const ai = KNOWN_EVENTS.indexOf(a.event);
      const bi = KNOWN_EVENTS.indexOf(b.event);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.event.localeCompare(b.event);
    });

  return {
    events: eventsList,
    invocations: [...invocationMap.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 500),
  };
}

// ---------------------------------------------------------------------------
// Memory Usage
// ---------------------------------------------------------------------------

export function reduceMemoryUsage(events: TelemetryEvent[], granularity: Granularity = "day"): MemoryUsageData {
  let stores = 0, searches = 0;
  const dayMap = new Map<string, { stores: number; searches: number }>();

  for (const e of events) {
    if (e.kind !== "tool" || !e.data?.tool) continue;
    const tool = e.data.tool as string;
    const isStore = tool === "memory_store" || tool === "mcp__memory__memory_store";
    const isSearch = tool === "memory_search" || tool === "mcp__memory__memory_search";
    if (!isStore && !isSearch) continue;

    const day = bucketKey(e.ts, granularity);
    if (!dayMap.has(day)) dayMap.set(day, { stores: 0, searches: 0 });
    const bucket = dayMap.get(day)!;
    if (isStore) { stores++; bucket.stores++; }
    if (isSearch) { searches++; bucket.searches++; }
  }

  const byDay = [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, stores: v.stores, searches: v.searches }));

  return { stores, searches, byDay };
}

// ---------------------------------------------------------------------------
// Memory Searches
// ---------------------------------------------------------------------------

const MEMORY_SEARCH_TOOLS = new Set(["memory_search", "mcp__memory__memory_search"]);

export function reduceMemorySearches(events: TelemetryEvent[]): MemorySearchData {
  // Build useId → resultContent map from tool_result events
  const resultByUseId = new Map<string, { content?: string; durationMs?: number; isError?: boolean; errorMessage?: string }>();
  for (const e of events) {
    if (e.kind === "tool_result" && e.data?.useId) {
      resultByUseId.set(e.data.useId as string, {
        content: e.data.resultContent as string | undefined,
        durationMs: e.ms,
        isError: e.data.isError as boolean | undefined,
        errorMessage: e.data.errorMessage as string | undefined,
      });
    }
  }

  const invocations: MemorySearchInvocation[] = [];

  for (const e of events) {
    if (e.kind !== "tool" || !e.data?.tool) continue;
    if (!MEMORY_SEARCH_TOOLS.has(e.data.tool as string)) continue;

    const params = e.data.params as Record<string, unknown> | undefined;
    const query = (params?.query ?? params?.content ?? "") as string;
    const mode = params?.mode as string | undefined;
    const tags = Array.isArray(params?.tags) ? (params!.tags as unknown[]).map(String) : undefined;

    const resultData = e.data.useId ? resultByUseId.get(e.data.useId as string) : undefined;

    // Parse text-format result from memory MCP server
    // Format: "Found N memories (mode: X) for query: '...'\n\n1. content...\n\n2. content..."
    let results: MemorySearchResult[] = [];
    if (resultData?.content) {
      const text = resultData.content;
      // Extract each numbered entry
      const entryRegex = /(?:^|\n)(\d+)\.\s+([\s\S]*?)(?=\n\d+\.\s+|$)/g;
      let m: RegExpExecArray | null;
      while ((m = entryRegex.exec(text)) !== null) {
        const raw = m[2].trim();
        if (raw) {
          // Strip trailing metadata lines (Hash:, Created:, Tags:)
          const contentLines = raw.split("\n").filter(l => !/^\s*(Hash:|Created:|Tags:|Updated:)/.test(l));
          const content = contentLines.join("\n").trim();
          if (content) results.push({ content });
        }
      }
    }

    invocations.push({
      timestamp: e.ts,
      sessionId: e.sid,
      query,
      mode,
      tags,
      durationMs: resultData?.durationMs ?? e.ms,
      isError: resultData?.isError,
      errorMessage: resultData?.errorMessage,
      results,
      resultCount: results.length,
    });
  }

  invocations.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return {
    totalSearches: invocations.length,
    invocations: invocations.slice(0, 500),
  };
}

// ---------------------------------------------------------------------------
// Compaction
// ---------------------------------------------------------------------------

export function reduceCompaction(events: TelemetryEvent[], granularity: Granularity = "day"): CompactionData {
  const dayMap = new Map<string, number>();
  const compEvents: CompactionData["events"] = [];
  let totalTokensAtCompaction = 0;

  for (const e of events) {
    if (e.kind !== "compact") continue;
    const preTokens = (e.data?.preTokens as number) || 0;
    totalTokensAtCompaction += preTokens;
    compEvents.push({
      timestamp: e.ts, sessionId: e.sid,
      trigger: (e.data?.trigger as string) || "unknown",
      preTokens,
      toolCallCount: (e.data?.toolCallCount as number) | 0 || undefined,
      contextPct: (e.data?.contextPct as number) || undefined,
    });
    const day = bucketKey(e.ts, granularity);
    dayMap.set(day, (dayMap.get(day) || 0) + 1);
  }

  const totalCompactions = compEvents.length;
  const avgPreTokens = totalCompactions > 0 ? Math.round(totalTokensAtCompaction / totalCompactions) : 0;
  const byDay: TimeBucket[] = [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));

  return {
    totalCompactions, totalTokensAtCompaction, avgPreTokens, byDay,
    events: compEvents.sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 100),
  };
}

// ---------------------------------------------------------------------------
// API Duration
// ---------------------------------------------------------------------------

export function reduceApiDuration(events: TelemetryEvent[], granularity: Granularity = "day"): ApiDurationData {
  const allDurations: number[] = [];
  const dayMap = new Map<string, number[]>();

  for (const e of events) {
    if (e.kind !== "turn" || !e.ms) continue;
    allDurations.push(e.ms);
    const day = bucketKey(e.ts, granularity);
    if (!dayMap.has(day)) dayMap.set(day, []);
    dayMap.get(day)!.push(e.ms);
  }

  const sorted = allDurations.slice().sort((a, b) => a - b);
  const avgMs = sorted.length > 0 ? Math.round(sorted.reduce((s, d) => s + d, 0) / sorted.length) : 0;

  const byDay = [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, durations]) => ({
      date, avgMs: Math.round(durations.reduce((s, d) => s + d, 0) / durations.length), count: durations.length,
    }));

  return { avgMs, p50Ms: Math.round(percentile(sorted, 50)), p95Ms: Math.round(percentile(sorted, 95)), byDay };
}

// ---------------------------------------------------------------------------
// Session Trace
// ---------------------------------------------------------------------------

export function reduceSessionTrace(events: TelemetryEvent[], sessionId: string): TraceData {
  const sessionEvents = events
    .filter((e) => e.sid === sessionId)
    .sort((a, b) => a.ts.localeCompare(b.ts));

  if (sessionEvents.length === 0) {
    return { sessionId, project: "", turns: [], compactions: [], totalDurationMs: 0, totalTokens: 0, totalCost: 0 };
  }

  const project = (sessionEvents[0].data?.project as string) || "";
  const parentSessionId = sessionEvents[0].data?.parentSessionId as string | undefined;

  // Build subagent session time ranges
  const subSessionMap = new Map<string, { firstTs: number; lastTs: number }>();
  for (const e of events) {
    if ((e.data?.parentSessionId as string) === sessionId && e.sid !== sessionId) {
      const ts = new Date(e.ts).getTime();
      const existing = subSessionMap.get(e.sid);
      if (!existing) subSessionMap.set(e.sid, { firstTs: ts, lastTs: ts });
      else { if (ts < existing.firstTs) existing.firstTs = ts; if (ts > existing.lastTs) existing.lastTs = ts; }
    }
  }
  const subagentTimes = [...subSessionMap.entries()].map(([sid, t]) => ({ sessionId: sid, ...t }));

  // Build useId → result maps
  const resultTimestamps = new Map<string, string>();
  const resultDurations = new Map<string, number>();
  const resultErrors = new Map<string, { isError: boolean; errorMessage?: string }>();
  const resultCharsMap = new Map<string, number>();
  for (const e of sessionEvents) {
    if (e.kind === "tool_result" && e.data?.useId) {
      const useId = e.data.useId as string;
      resultTimestamps.set(useId, e.ts);
      if (e.ms) resultDurations.set(useId, e.ms);
      if (e.data.isError) resultErrors.set(useId, { isError: true, errorMessage: e.err });
      if (e.data.resultChars) resultCharsMap.set(useId, e.data.resultChars as number);
    }
  }

  // Identify skill injection user messages: the Skill tool injects its content
  // back as a user message. We detect injections by scanning once and tracking
  // whether the next user message should be marked as an injection.
  const skillInjectionIndices = new Set<number>();
  let pendingSkillInjection = false;
  for (let i = 0; i < sessionEvents.length; i++) {
    const e = sessionEvents[i];
    if (e.kind === "tool" && (e.data?.tool as string) === "Skill") {
      pendingSkillInjection = true;
    } else if (pendingSkillInjection && e.kind === "message" && e.data?.role === "user") {
      skillInjectionIndices.add(i);
      pendingSkillInjection = false;
    }
  }

  // Split at user message events, but skip skill injections
  const turnBoundaries: number[] = [];
  for (let i = 0; i < sessionEvents.length; i++) {
    if (sessionEvents[i].kind === "message" && sessionEvents[i].data?.role === "user"
        && !skillInjectionIndices.has(i)) turnBoundaries.push(i);
  }

  const turns: TraceTurn[] = [];
  let totalTokens = 0, totalCost = 0;

  for (let t = 0; t < turnBoundaries.length; t++) {
    const startIdx = turnBoundaries[t];
    const endIdx = t + 1 < turnBoundaries.length ? turnBoundaries[t + 1] : sessionEvents.length;
    const turnEntries = sessionEvents.slice(startIdx, endIdx);
    const turnStart = new Date(turnEntries[0].ts).getTime();
    const userMessage = (turnEntries[0].data?.text as string) || "";

    const spans: TraceSpan[] = [];
    let turnTokens = 0, turnCost = 0, turnModel: string | undefined, turnDurationMs = 0, spanCounter = 0;
    let turnContextTokens = 0, turnOutputTokens = 0, turnInputTokens = 0, turnCacheReadTokens = 0, turnCacheCreationTokens = 0;
    let assistantText: string | undefined;

    for (const e of turnEntries) {
      const offsetMs = new Date(e.ts).getTime() - turnStart;

      if (e.kind === "tool" && e.data?.tool) {
        let durationMs = 0, isError = false;
        let detail: string | undefined;
        const useId = e.data.useId as string | undefined;

        if (useId) {
          const result = resultTimestamps.get(useId);
          if (result) {
            const explicitMs = resultDurations.get(useId);
            durationMs = explicitMs ?? (new Date(result).getTime() - new Date(e.ts).getTime());
            if (durationMs < 0 || durationMs > 3600000) durationMs = 0;
          }
          const err = resultErrors.get(useId);
          if (err) { isError = true; detail = err.errorMessage; }
        }

        if (!detail && e.data.params) {
          const params = e.data.params as Record<string, unknown>;
          const tool = e.data.tool as string;
          if (tool === "Agent") {
            const desc = params.description as string | undefined;
            const prompt = params.prompt as string | undefined;
            detail = desc || (prompt && prompt.length > 100 ? prompt.slice(0, 100) + "..." : prompt) || undefined;
          } else {
            const keys = Object.keys(params);
            if (keys.length <= 3) {
              detail = keys.map((k) => {
                const v = params[k];
                const s = typeof v === "string" ? v : JSON.stringify(v);
                return `${k}: ${s && s.length > 60 ? s.slice(0, 60) + "..." : s}`;
              }).join(", ");
            } else {
              detail = keys.join(", ");
            }
          }
        }

        let subagentSessionId: string | undefined;
        if ((e.data.tool as string) === "Agent" && durationMs > 0) {
          const toolStart = new Date(e.ts).getTime();
          const toolEnd = toolStart + durationMs;
          for (const sub of subagentTimes) {
            if (sub.firstTs >= toolStart - 2000 && sub.firstTs <= toolEnd + 2000) {
              subagentSessionId = sub.sessionId;
              break;
            }
          }
        }

        const skillName = e.data.skill as string | undefined;
        const resultChars = useId ? resultCharsMap.get(useId) : undefined;
        const resultTokens = resultChars !== undefined ? Math.ceil(resultChars / 4) : undefined;
        spans.push({
          id: `span-${t}-${spanCounter++}`, kind: "tool",
          label: skillName ? `Skill(${skillName})` : (e.data.tool as string),
          startMs: offsetMs, durationMs,
          isError: isError || undefined, detail,
          toolUseId: useId, subagentSessionId, resultTokens,
        });
      }

      if (e.kind === "hook_summary" && e.data?.command) {
        // e.name may be the string "null" if the command ends with "2>/dev/null"
        // (split("/").pop() bug in adapter). Re-derive from the command if needed.
        const rawLabel = (e.name === "null" || !e.name)
          ? hookBasename(e.data.command as string)
          : e.name;
        spans.push({
          id: `span-${t}-${spanCounter++}`, kind: "hook",
          label: rawLabel, startMs: offsetMs,
          durationMs: e.ms || 0,
          isError: (e.data.isError as boolean) || undefined,
          detail: (e.data.output as string) || e.err,
        });
      }

      if (e.kind === "hook" && e.data?.command) {
        spans.push({
          id: `span-${t}-${spanCounter++}`, kind: "hook",
          label: `${(e.data.event as string) || "hook"}: ${e.name}`,
          startMs: offsetMs, durationMs: 0,
          detail: e.data.output as string | undefined,
        });
      }

      if (e.kind === "hook_feedback") {
        spans.push({
          id: `span-${t}-${spanCounter++}`, kind: "hook",
          label: "stop.blocked",
          startMs: offsetMs, durationMs: 0,
          isError: true,
          detail: (e.data?.text as string) || e.err,
        });
      }

      if (e.kind === "tokens") {
        const d = e.data || {};
        const inp = (d.input as number) || 0;
        const out = (d.output as number) || 0;
        const cacheRead = (d.cacheRead as number) || 0;
        const cacheCreation = (d.cacheCreation as number) || 0;
        const tokens = inp + out;
        const cost = costFromTokenEvent(e);
        turnTokens += tokens; turnCost += cost;
        totalTokens += tokens; totalCost += cost;
        if (d.model) turnModel = d.model as string;
        // Total context window = fresh input + cached reads + newly cached
        turnContextTokens = inp + cacheRead + cacheCreation;
        turnOutputTokens = out;
        turnInputTokens = inp;
        turnCacheReadTokens = cacheRead;
        turnCacheCreationTokens = cacheCreation;
      }

      if (e.kind === "turn" && e.ms) turnDurationMs = e.ms;

      if (e.kind === "message" && e.data?.role === "assistant" && e.data?.text) {
        assistantText = e.data.text as string;
      }
    }

    if (turnDurationMs === 0 && spans.length > 0) {
      turnDurationMs = Math.max(...spans.map((s) => s.startMs + s.durationMs));
    }
    if (turnDurationMs === 0 && turnEntries.length > 1) {
      turnDurationMs = new Date(turnEntries[turnEntries.length - 1].ts).getTime() - turnStart;
    }

    turns.push({
      index: t, userMessage, startTime: turnEntries[0].ts, durationMs: turnDurationMs,
      spans: spans.sort((a, b) => a.startMs - b.startMs),
      tokenCount: turnTokens || undefined, cost: turnCost || undefined, model: turnModel,
      contextTokens: turnContextTokens || undefined, outputTokens: turnOutputTokens || undefined,
      inputTokens: turnInputTokens || undefined, cacheReadTokens: turnCacheReadTokens || undefined,
      cacheCreationTokens: turnCacheCreationTokens || undefined,
      assistantText: assistantText || undefined,
    });
  }

  const totalDurationMs = turns.length > 0
    ? new Date(sessionEvents[sessionEvents.length - 1].ts).getTime() - new Date(sessionEvents[0].ts).getTime()
    : 0;

  const compactions = sessionEvents
    .filter((e) => e.kind === "compact")
    .map((e) => ({
      timestamp: e.ts,
      trigger: (e.name as string) || "unknown",
      preTokens: (e.data?.preTokens as number) || undefined,
    }));

  return { sessionId, parentSessionId, project, turns, compactions, totalDurationMs, totalTokens, totalCost };
}

// ---------------------------------------------------------------------------
// Recent Events (generic query)
// ---------------------------------------------------------------------------

export function reduceRecentEvents(
  events: TelemetryEvent[],
  limit: number = 200,
  offset: number = 0,
  filters?: { entryType?: string; search?: string },
): { events: any[]; total: number } {
  // Convert TelemetryEvent back to the SessionEntry-like shape the API expects
  let filtered = events;

  if (filters?.entryType) {
    const typeMap: Record<string, string[]> = {
      tool_use: ["tool"],
      tool_result: ["tool_result"],
      hook_progress: ["hook"],
      stop_hook_summary: ["hook_summary"],
      turn_duration: ["turn"],
      tokens: ["tokens"],
      user_message: ["message"],            // user role only — see role filter below
      assistant_message: ["message"],
      compact_boundary: ["compact"],
      directive: ["directive"],
      hook_event: ["hook_event"],
      hook_feedback: ["hook_feedback"],
      gate: ["gate"],
      gate_marker: ["gate_marker"],
      feedback: ["feedback"],
      rating: ["rating"],
      re_edit: ["re_edit"],
      memory_write: ["memory_write"],
      compaction: ["compaction"],
    };
    const kinds = typeMap[filters.entryType] || [filters.entryType];
    filtered = filtered.filter((e) => {
      if (!kinds.includes(e.kind)) return false;
      if (filters.entryType === "user_message") return e.data?.role !== "assistant";
      if (filters.entryType === "assistant_message") return e.data?.role === "assistant";
      return true;
    });
  }

  if (filters?.search) {
    const q = filters.search.toLowerCase();
    filtered = filtered.filter((e) => {
      const text = [e.name, e.kind, e.err, JSON.stringify(e.data)].filter(Boolean).join(" ").toLowerCase();
      return text.includes(q);
    });
  }

  const sorted = filtered.sort((a, b) => b.ts.localeCompare(a.ts));

  // Map to SessionEntry-like shape for API compatibility
  const mapped = sorted.slice(offset, offset + limit).map((e) => {
    const d = e.data || {};
    const base: Record<string, unknown> = {
      sessionId: e.sid, timestamp: e.ts, project: d.project,
      model: d.model,
    };

    if (e.kind === "tool") {
      return { ...base, entryType: "tool_use", toolName: d.tool, toolParams: d.params, skillName: d.skill, toolUseId: d.useId, linesAdded: d.linesAdded, linesRemoved: d.linesRemoved };
    }
    if (e.kind === "tool_result") {
      return { ...base, entryType: "tool_result", toolUseId: d.useId, isError: d.isError, errorMessage: e.err, toolDurationMs: e.ms, resultContent: d.resultContent, resultChars: d.resultChars };
    }
    if (e.kind === "hook") {
      return { ...base, entryType: "hook_progress", hookEvent: d.event, hookName: d.hookName, hookCommand: d.command };
    }
    if (e.kind === "hook_summary") {
      return { ...base, entryType: "stop_hook_summary", hookName: e.name, hookCommand: d.command, hookDurationMs: e.ms, hookExitCode: d.exitCode, hookOutput: d.output, isError: d.isError, errorMessage: e.err };
    }
    if (e.kind === "tokens") {
      return { ...base, entryType: "tokens", role: "assistant", inputTokens: d.input, outputTokens: d.output, cacheReadTokens: d.cacheRead, cacheCreationTokens: d.cacheCreation };
    }
    if (e.kind === "message") {
      const isAssistant = d.role === "assistant";
      return { ...base, entryType: isAssistant ? "assistant_message" : "user_message", text: d.text, userRequest: isAssistant ? undefined : d.text };
    }
    if (e.kind === "turn") {
      return { ...base, entryType: "turn_duration", turnDurationMs: e.ms };
    }
    if (e.kind === "compact") {
      return { ...base, entryType: "compact_boundary", compactTrigger: d.trigger, compactPreTokens: d.preTokens };
    }
    if (e.kind === "directive") {
      return { ...base, entryType: "directive", directives: d.directives, promptWords: d.promptWords };
    }
    // events.jsonl-sourced kinds: pass through hook + event so the page can display
    // something meaningful instead of an empty row.
    if (e.kind === "hook_event") {
      return { ...base, entryType: "hook_event", hookName: e.name, hookEvent: d.event, hook: d.hook };
    }
    if (e.kind === "hook_feedback") {
      return { ...base, entryType: "hook_feedback", name: e.name, text: d.text };
    }
    if (e.kind === "gate") {
      return { ...base, entryType: "gate", hookName: e.name, hookEvent: d.event, tier: d.tier, decision: d.decision, reason: d.reason };
    }
    if (e.kind === "gate_marker") {
      return { ...base, entryType: "gate_marker", hookName: e.name, hookEvent: d.event };
    }
    if (e.kind === "feedback") {
      return { ...base, entryType: "feedback", polarity: d.polarity ?? e.name, target: d.target };
    }
    if (e.kind === "rating") {
      return { ...base, entryType: "rating", rating: d.rating };
    }
    if (e.kind === "re_edit") {
      return { ...base, entryType: "re_edit", file: e.name ?? d.file };
    }
    if (e.kind === "memory_write") {
      return { ...base, entryType: "memory_write", memoryType: e.name ?? d.memoryType, memoryId: d.memoryId };
    }
    if (e.kind === "compaction") {
      return { ...base, entryType: "compaction", hookName: e.name, workingFiles: d.workingFiles, recentPrompts: d.recentPrompts };
    }
    return { ...base, entryType: e.kind, name: e.name };
  });

  return { events: mapped, total: sorted.length };
}

// ---------------------------------------------------------------------------
// Subagents
// ---------------------------------------------------------------------------

export function reduceSubagents(events: TelemetryEvent[], granularity: Granularity = "day"): SubagentsData {
  // Build subagent session time map
  const subSessionMap = new Map<string, Map<string, { firstTs: number; lastTs: number }>>();
  for (const e of events) {
    const parentId = e.data?.parentSessionId as string | undefined;
    if (!parentId || e.sid === parentId) continue;
    const ts = new Date(e.ts).getTime();
    let parentMap = subSessionMap.get(parentId);
    if (!parentMap) { parentMap = new Map(); subSessionMap.set(parentId, parentMap); }
    const existing = parentMap.get(e.sid);
    if (!existing) parentMap.set(e.sid, { firstTs: ts, lastTs: ts });
    else { if (ts < existing.firstTs) existing.firstTs = ts; if (ts > existing.lastTs) existing.lastTs = ts; }
  }

  // Build useId → result info
  const resultMap = new Map<string, { durationMs?: number; isError?: boolean; errorMessage?: string }>();
  for (const e of events) {
    if (e.kind === "tool_result" && e.data?.useId) {
      resultMap.set(e.data.useId as string, { durationMs: e.ms, isError: e.data.isError as boolean | undefined, errorMessage: e.err });
    }
  }

  const agentCalls = events.filter((e) => e.kind === "tool" && (e.data?.tool as string) === "Agent");
  const durations: number[] = [];
  const parentSessions = new Set<string>();
  const dayBuckets = new Map<string, { count: number; bg: number; fg: number }>();
  const typeBuckets = new Map<string, { count: number; durations: number[]; errors: number }>();
  const recent: SubagentInvocation[] = [];
  let backgroundCount = 0;
  const now = Date.now();
  let activeNow = 0;

  for (const e of agentCalls) {
    const params = (e.data?.params as Record<string, unknown>) ?? {};
    const description = params.description as string | undefined;
    const subagentType = (params.subagent_type as string | undefined) || "unspecified";
    const runInBackground = params.run_in_background as boolean | undefined;
    const model = params.model as string | undefined;

    const useId = e.data?.useId as string | undefined;
    const result = useId ? resultMap.get(useId) : undefined;
    const durationMs = result?.durationMs;
    const isError = result?.isError;
    const errorMessage = result?.errorMessage;

    let subagentSessionId: string | undefined;
    const parentChildren = subSessionMap.get(e.sid);
    if (parentChildren && durationMs && durationMs > 0) {
      const toolStart = new Date(e.ts).getTime();
      const toolEnd = toolStart + durationMs;
      for (const [sid, times] of parentChildren) {
        if (times.firstTs >= toolStart - 2000 && times.firstTs <= toolEnd + 2000) {
          subagentSessionId = sid; break;
        }
      }
    }

    if (subagentSessionId && parentChildren) {
      const childTimes = parentChildren.get(subagentSessionId);
      if (childTimes && childTimes.firstTs >= now - 5 * 60 * 1000 && childTimes.lastTs >= now - 60 * 1000) activeNow++;
    }

    parentSessions.add(e.sid);
    if (runInBackground) backgroundCount++;
    if (durationMs && durationMs > 0) durations.push(durationMs);

    const day = bucketKey(e.ts, granularity);
    const db = dayBuckets.get(day) ?? { count: 0, bg: 0, fg: 0 };
    db.count++; if (runInBackground) db.bg++; else db.fg++;
    dayBuckets.set(day, db);

    const tb = typeBuckets.get(subagentType) ?? { count: 0, durations: [], errors: 0 };
    tb.count++; if (durationMs && durationMs > 0) tb.durations.push(durationMs); if (isError) tb.errors++;
    typeBuckets.set(subagentType, tb);

    recent.push({
      timestamp: e.ts, sessionId: e.sid, project: (e.data?.project as string) || "",
      description, subagentType, runInBackground, model, durationMs, isError, errorMessage, subagentSessionId,
    });
  }

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
        subagentType, count,
        pct: totalDispatches > 0 ? Math.round((count / totalDispatches) * 100) : 0,
        avgMs: d.length > 0 ? Math.round(d.reduce((s, v) => s + v, 0) / d.length) : 0,
        p95Ms: percentile(d, 95), errors,
      };
    })
    .sort((a, b) => b.count - a.count);

  recent.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return {
    activeNow, totalDispatches, backgroundDispatches: backgroundCount,
    parentSessionCount: parentSessions.size, avgMs,
    p50Ms: percentile(durations, 50), p95Ms: percentile(durations, 95),
    byDay, byType, recent: recent.slice(0, 100),
  };
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export function reduceVerifications(events: TelemetryEvent[], granularity: Granularity = "day"): VerificationData {
  type PhaseMap = Record<string, { pass: number; fail: number; skip: number }>;
  const phases: PhaseMap = {};
  const dayPass = new Map<string, number>();
  const dayFail = new Map<string, number>();
  const runMap = new Map<string, { timestamp: string; sessionId: string; phases: Record<string, { result: string; count?: number; coverage?: number }> }>();

  for (const e of events) {
    if (e.kind !== "verify") continue;
    const phase = (e.data?.phase as string) || "unknown";
    const result = (e.data?.result as string) || "skip";
    if (!phases[phase]) phases[phase] = { pass: 0, fail: 0, skip: 0 };
    if (result === "pass") phases[phase].pass++;
    else if (result === "fail") phases[phase].fail++;
    else phases[phase].skip++;

    const day = bucketKey(e.ts, granularity);
    if (result === "pass") dayPass.set(day, (dayPass.get(day) || 0) + 1);
    else if (result === "fail") dayFail.set(day, (dayFail.get(day) || 0) + 1);

    // Group by session+day for recent runs
    const runKey = `${e.sid}:${day}`;
    if (!runMap.has(runKey)) runMap.set(runKey, { timestamp: e.ts, sessionId: e.sid, phases: {} });
    runMap.get(runKey)!.phases[phase] = { result, count: e.data?.count as number | undefined, coverage: e.data?.coverage as number | undefined };
  }

  const allDays = new Set([...dayPass.keys(), ...dayFail.keys()]);
  const byDay = [...allDays]
    .sort()
    .map((date) => ({ date, pass: dayPass.get(date) || 0, fail: dayFail.get(date) || 0 }));

  const recentRuns = [...runMap.values()]
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 50)
    .map((r) => ({ ...r, phases: r.phases as Record<string, { result: "pass" | "fail" | "skip"; count?: number; coverage?: number }> }));

  const totalRuns = runMap.size;
  return { totalRuns, byPhase: phases, byDay, recentRuns };
}
