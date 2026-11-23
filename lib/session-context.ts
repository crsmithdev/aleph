/**
 * How full the session's context is, read from the transcript, and what to do
 * about it. The window comes from the same places Claude Code reads it:
 * CLAUDE_CODE_AUTO_COMPACT_WINDOW, then the autoCompactWindow setting, then the
 * model default of 1M. Compaction fires at window - min(maxOutput, 20k) - 13k
 * (measured in 2.1.283); 33k is that headroom.
 *
 * Only compact_boundary counts as compaction. A microcompact_boundary evicts
 * old tool results and leaves the conversation intact, so the context is still
 * the conversation rather than a summary of one; it also fires early in a
 * tool-heavy session and lowers the fill, which would gate a healthy session at
 * a low reading.
 *
 * The budget is what the setting asks for, not a prediction. Measured over 99
 * sessions on 2026-09-27: three compacted within 12k of the threshold and five
 * ran past it untouched, one to 314k. The warn names the budget for that
 * reason.
 */
import { readJsonOr } from "./json.ts";
import { homedir } from "node:os";
import { join } from "node:path";
import { entriesBackward, readText } from "./jsonl.ts";

const HEADROOM = 33_000;
const DEFAULT_WINDOW = 1_000_000;
const DEFAULT_WARN = 0.75;

export interface Reading {
  fill: number;
  compacted: boolean;
}

/** The last assistant request's context size, and whether the session has compacted. Both are read from the end, parsing only the lines that can answer. */
export function read(transcriptPath: string): Reading {
  const text = readText(transcriptPath);
  let fill = 0;
  for (const e of entriesBackward(text, /"usage"/)) {
    const usage = e.type === "assistant" && !e.isSidechain ? e.message?.usage : undefined;
    if (!usage) continue;
    fill = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
    break;
  }
  let compacted = false;
  for (const e of entriesBackward(text, /"compact_boundary"|"isCompactSummary"/)) {
    if (e.isSidechain || !(e.isCompactSummary || (e.type === "system" && e.subtype === "compact_boundary"))) continue;
    compacted = true;
    break;
  }
  return { fill, compacted };
}

/** Claude Code's settings file: ALEPH_CLAUDE_SETTINGS, else ~/.claude/settings.json. */
export const claudeSettings = (): string => process.env.ALEPH_CLAUDE_SETTINGS ?? join(homedir(), ".claude", "settings.json");

/** The context window Claude Code runs with. */
export function window(settingsPath = claudeSettings()): number {
  const env = Number(process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW);
  if (Number.isFinite(env) && env > 0) return env;
  const configured = Number(readJsonOr<any>(settingsPath, {}).autoCompactWindow);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_WINDOW;
}

/** Tokens the session can hold before Claude Code compacts it. */
export function threshold(settingsPath = claudeSettings()): number {
  return Math.max(1000, window(settingsPath) - HEADROOM);
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
      reason: `this session has compacted, so its context is now a summary. Write the handoff with the aleph:handoff skill; the save ends the turn and says whether Chris runs /clear or the session clears itself. Do not start new work in this session.`,
    };
  }
  const fraction = Number(process.env.ALEPH_CONTEXT_WARN ?? DEFAULT_WARN);
  const warnAt = limit * (Number.isFinite(fraction) && fraction > 0 ? fraction : DEFAULT_WARN);
  if (reading.fill >= warnAt && !reading.compacted) {
    return { kind: "warn", message: `Context ${k(reading.fill)} of the ${k(limit)} budget. /aleph:handoff then /clear keeps the next turn sharp.` };
  }
  return { kind: "quiet" };
}
