/**
 * How full the session's context is, read from the transcript, and what to do
 * about it. The window comes from the same places Claude Code reads it:
 * CLAUDE_CODE_AUTO_COMPACT_WINDOW, then the autoCompactWindow setting, then the
 * model default of 1M. Compaction fires at window - min(maxOutput, 20k) - 13k
 * (measured in 2.1.283); 33k is that headroom.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HEADROOM = 33_000;
const DEFAULT_WINDOW = 1_000_000;
const DEFAULT_WARN = 0.75;

export interface Reading {
  fill: number;
  compacted: boolean;
  requests: number;
}

/** The last assistant request's context size, and whether the session has compacted. */
export function read(transcriptPath: string): Reading {
  let raw: string;
  try { raw = readFileSync(transcriptPath, "utf8"); } catch { return { fill: 0, compacted: false, requests: 0 }; }
  let fill = 0;
  let compacted = false;
  let requests = 0;
  for (const line of raw.split("\n")) {
    if (!line) continue;
    let e: Record<string, any>;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.isSidechain) continue;
    if (e.type === "system" && (e.subtype === "compact_boundary" || e.subtype === "microcompact_boundary")) compacted = true;
    if (e.isCompactSummary) compacted = true;
    const usage = e.type === "assistant" ? e.message?.usage : undefined;
    if (!usage) continue;
    requests++;
    fill = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
  }
  return { fill, compacted, requests };
}

/** Tokens the session can hold before Claude Code compacts it. */
export function threshold(settingsPath = join(homedir(), ".claude", "settings.json")): number {
  const env = Number(process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW);
  let window = Number.isFinite(env) && env > 0 ? env : 0;
  if (!window) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
      const configured = Number(settings.autoCompactWindow);
      if (Number.isFinite(configured) && configured > 0) window = configured;
    } catch { /* no settings, or not JSON */ }
  }
  if (!window) window = DEFAULT_WINDOW;
  return Math.max(1000, window - HEADROOM);
}

export type Verdict =
  | { kind: "quiet" }
  | { kind: "warn"; message: string }
  | { kind: "gate"; reason: string };

/**
 * Quiet below the warn fraction. A warning to Chris above it. A block once the
 * session has compacted: from there on the context is a summary of a summary,
 * and a handoff written now is better than one written later.
 */
export function assess(reading: Reading, limit: number, blocked: boolean, retry: boolean): Verdict {
  const k = (n: number) => `${Math.round(n / 1000)}k`;
  if (reading.compacted && !blocked && !retry) {
    return {
      kind: "gate",
      reason: `this session has compacted, so its context is now a summary. Write the handoff with the aleph:handoff skill, then tell Chris to run /clear and /aleph:pickup. Do not start new work in this session.`,
    };
  }
  const fraction = Number(process.env.ALEPH_CONTEXT_WARN ?? DEFAULT_WARN);
  const warnAt = limit * (Number.isFinite(fraction) && fraction > 0 ? fraction : DEFAULT_WARN);
  if (reading.fill >= warnAt && !reading.compacted) {
    return { kind: "warn", message: `Context ${k(reading.fill)} of ${k(limit)} before compaction. /aleph:handoff then /clear keeps the next turn sharp.` };
  }
  return { kind: "quiet" };
}
