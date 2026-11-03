/**
 * The factory's own settings: caps, time limits, rounds, switches and the agent commands. Each setting
 * has one name, one default and one parser here. Paths are in layout.ts. The security paths
 * (sandbox.ts, review.ts, review-browser.ts, probe.ts) read their own variables, and a command that
 * only one call site uses stays at that call site.
 *
 * Each function reads at each call: a test changes the environment in-process, and launch.ts hands
 * every ALEPH_* variable to the units it starts.
 */
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { layout } from "./layout.ts";

const num = (name: string, dflt: number): number => Number(process.env[name] ?? dflt);

/** `caps.json` in the factory directory: `{ "day", "live", "awaiting" }`. A missing or bad file is empty. */
function capsFile(): Record<string, unknown> {
  try {
    const c = JSON.parse(readFileSync(join(layout().factory, "caps.json"), "utf8"));
    return c && typeof c === "object" && !Array.isArray(c) ? c : {};
  } catch { return {}; }
}

export const CAP_KEYS = ["day", "live", "awaiting"] as const;
export type CapKey = (typeof CAP_KEYS)[number];

/** Merges the given caps into caps.json: whole file to a temp file, then a rename. Writes `awaiting`, drops the old `waiting`. Throws on a value that is not an integer of 1 or more. */
export function writeCaps(patch: Partial<Record<CapKey, unknown>>): Record<string, unknown> {
  for (const k of CAP_KEYS) {
    const v = patch[k];
    if (v !== undefined && !(typeof v === "number" && Number.isInteger(v) && v >= 1)) throw new Error(`${k} must be an integer of 1 or more`);
  }
  const next: Record<string, unknown> = { ...capsFile() };
  for (const k of CAP_KEYS) if (patch[k] !== undefined) next[k] = patch[k];
  if (patch.awaiting !== undefined) delete next.waiting;
  const file = join(layout().factory, "caps.json");
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n");
  renameSync(tmp, file);
  return next;
}

/** Whether the environment variable overrides caps.json: the same rule as cap(). */
export const capEnvSet = (envName: string): boolean => (process.env[envName] ?? "") !== "";

/** The environment variable first, then caps.json, then the default. */
function cap(envName: string, key: string, dflt: number): number {
  const e = process.env[envName];
  if (e !== undefined && e !== "") return Number(e);
  const f = capsFile()[key] ?? (key === "awaiting" ? capsFile().waiting : undefined);
  return typeof f === "number" && Number.isFinite(f) ? f : dflt;
}

/** Runs that start a worker, in any 24 hours. Checks and probes start none. */
export const DAY_CAP = () => cap("ALEPH_DAY_CAP", "day", 12);
/** The most agent runs live at once. */
export const LIVE_CAP = () => cap("ALEPH_LIVE_CAP", "live", 10);
/** The most open jobs awaiting Chris before no new run starts. */
export const AWAITING_CAP = () => cap("ALEPH_AWAITING_CAP", "awaiting", 5);
export const EXPLAIN_CAP = () => num("ALEPH_EXPLAIN_CAP", 3);
export const EXPLAIN_TRIES = () => num("ALEPH_EXPLAIN_TRIES", 2);
/** Goals failing acceptance at one commit, at which none of them reopens. */
export const acceptanceFailCap = () => { const n = Math.floor(Number(process.env.ALEPH_ACCEPTANCE_FAIL_CAP)); return n >= 1 ? n : 5; };
export const TRIAGE_CAP = () => num("ALEPH_TRIAGE_CAP", 5);
export const TRIAGE_TRIES = () => num("ALEPH_TRIAGE_TRIES", 2);
/** How many signals make a lesson a proposal. */
export const PROPOSE_AT = (): number => {
  const n = Number(process.env.ALEPH_PROPOSE_AT);
  return Number.isFinite(n) && n >= 1 ? n : 3;
};

export const jobSeconds = () => num("ALEPH_JOB_TIMEOUT", 1800);
export const checkSeconds = () => num("ALEPH_CHECK_TIMEOUT", 1200);
export const reviewSeconds = () => num("ALEPH_REVIEW_TIMEOUT", 600);
export const reviewDiffMax = () => num("ALEPH_REVIEW_DIFF_MAX", 200000);
export const fixRounds = () => num("ALEPH_FIX_ROUNDS", 2);
export const rescueWaitMs = () => num("ALEPH_RESCUE_WAIT_MS", 60_000);
export const pidWaitMs = () => Number(process.env.ALEPH_PID_WAIT_MS) || 10_000;
export const landBatch = () => Math.max(1, Math.floor(num("ALEPH_LAND_BATCH", 8)) || 1);
export const checkSlots = () => Math.max(1, Math.floor(Number(process.env.ALEPH_CHECK_SLOTS)) || 2);
/** The load average under which the machine counts as quiet. */
export const quietLoad = () => Number(process.env.ALEPH_QUIET_LOAD) || availableParallelism() / 2;
/** How long the UI keeps a computed read, 0 when off. */
export const uiCacheMs = () => { const n = num("ALEPH_UI_CACHE_TTL", 300); return Number.isFinite(n) && n > 0 ? n * 1000 : 0; };

export const dispatchOn = () => process.env.ALEPH_DISPATCH !== "off";
export const rescueOn = () => process.env.ALEPH_RESCUE !== "off";

export const workerCmd = () => process.env.ALEPH_WORKER_CMD ?? "claude";
export const reviewerCmd = () => process.env.ALEPH_REVIEWER_CMD ?? workerCmd();
