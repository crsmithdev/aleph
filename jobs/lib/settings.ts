/**
 * The factory's own settings: caps, time limits, rounds, switches and the agent commands. Each setting
 * has one name, one default and one parser here. The three directory variables ALEPH_ISSUES,
 * ALEPH_JOBS_DIR and ALEPH_FACTORY_DIR are read in layout.ts. A command that
 * only one call site uses stays at that call site.
 *
 * Each function reads at each call: a test changes the environment in-process, and launch.ts hands
 * every ALEPH_* variable to the units it starts.
 */
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { availableParallelism, homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { layout } from "./layout.ts";

const num = (name: string, dflt: number): number => Number(process.env[name] ?? dflt);

/** `caps.json` in the factory directory: `{ "live" }`. A missing or bad file is empty; other keys are left alone. */
function capsFile(): Record<string, unknown> {
  try {
    const c = JSON.parse(readFileSync(join(layout().factory, "caps.json"), "utf8"));
    return c && typeof c === "object" && !Array.isArray(c) ? c : {};
  } catch { return {}; }
}

export const CAP_KEYS = ["live"] as const;
export type CapKey = (typeof CAP_KEYS)[number];

/** Merges the given caps into caps.json: whole file to a temp file, then a rename. Throws on a value that is not an integer of 1 or more. */
export function writeCaps(patch: Partial<Record<CapKey, unknown>>): Record<string, unknown> {
  for (const k of CAP_KEYS) {
    const v = patch[k];
    if (v !== undefined && !(typeof v === "number" && Number.isInteger(v) && v >= 1)) throw new Error(`${k} must be an integer of 1 or more`);
  }
  const next: Record<string, unknown> = { ...capsFile() };
  for (const k of CAP_KEYS) if (patch[k] !== undefined) next[k] = patch[k];
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
  const f = capsFile()[key];
  return typeof f === "number" && Number.isFinite(f) ? f : dflt;
}

/**
 * The most agent runs live at once: a sixth of the cores (4 of 24). A run's checks use half the cores (package.json),
 * so two suites fill the load limit while the other runs are in their worker step; more starts would only queue.
 */
export const LIVE_CAP = () => cap("ALEPH_LIVE_CAP", "live", Math.max(1, Math.floor(availableParallelism() / 6)));
/** The most director runs one tick starts, one per Ask. */
export const DIRECTOR_CAP = () => num("ALEPH_DIRECTOR_CAP", 3);
export const INTAKE_CAP = () => num("ALEPH_INTAKE_CAP", 5);
export const INTAKE_TRIES = () => num("ALEPH_INTAKE_TRIES", 2);
/** How many signals make a lesson a proposal. */
export const PROPOSE_AT = (): number => {
  const n = Number(process.env.ALEPH_PROPOSE_AT);
  return Number.isFinite(n) && n >= 1 ? n : 3;
};

export const jobSeconds = () => num("ALEPH_JOB_TIMEOUT", 1800);
export const checkSeconds = () => num("ALEPH_CHECK_TIMEOUT", 1200);
/** The seconds a repo's full suite may take before the Status page warns. */
export const suiteBudgetSeconds = () => num("ALEPH_SUITE_BUDGET_S", 120);
export const reviewSeconds = () => num("ALEPH_REVIEW_TIMEOUT", 600);
export const reviewDiffMax = () => num("ALEPH_REVIEW_DIFF_MAX", 200000);
export const fixRounds = () => num("ALEPH_FIX_ROUNDS", 2);
/** How long a dispatch waits for another dispatch's goal lock before it skips the goal. */
export const goalLockWaitMs = () => num("ALEPH_GOAL_LOCK_WAIT_MS", 20_000);
export const rescueWaitMs = () => num("ALEPH_RESCUE_WAIT_MS", 60_000);
export const pidWaitMs = () => Number(process.env.ALEPH_PID_WAIT_MS) || 10_000;
export const landBatch = () => Math.max(1, Math.floor(num("ALEPH_LAND_BATCH", 8)) || 1);
/** A check, a worker or a land starts only while the 1-minute load average is under this. */
export const loadLimit = () => num("ALEPH_LOAD_LIMIT", availableParallelism());
/** How long the UI keeps a computed read, 0 when off. */
export const uiCacheMs = () => { const n = num("ALEPH_UI_CACHE_TTL", 300); return Number.isFinite(n) && n > 0 ? n * 1000 : 0; };

export const dispatchOn = () => process.env.ALEPH_DISPATCH !== "off";
/** The tick's daily monitor step; tests turn it off, as a tick there must not start the reader. */
export const monitorOn = () => process.env.ALEPH_MONITOR !== "off";
export const rescueOn = () => process.env.ALEPH_RESCUE !== "off";

export const workerCmd = () => process.env.ALEPH_WORKER_CMD ?? "claude";
export const reviewerCmd = () => process.env.ALEPH_REVIEWER_CMD ?? workerCmd();

/** The vault folder. */
export function vaultDir(): string { return process.env.ALEPH_VAULT ?? join(homedir(), ".aleph", "vault"); }
/** The handoffs folder: beside the vault (the link, not its target) unless the environment names it. */
/** Chris's log of what reached him and why: the director reads it, and code does not. */
export const needsYouLog = (): string => process.env.ALEPH_NEEDS_YOU_LOG ?? join(dirname(resolve(vaultDir())), "needs-you-log.md");
export const handoffsDir = (): string => process.env.ALEPH_HANDOFFS_DIR ?? join(dirname(resolve(vaultDir())), "handoffs");

/** The id of the job this process runs for, if any. */
export const jobId = (): string | undefined => process.env.ALEPH_JOB_ID;
/** The command for an agent role (`worker`, `reviewer`, ...), `claude` by default. */
export const roleCmd = (role: string): string => process.env[`ALEPH_${role}_CMD`] ?? "claude";
/** The time limit in seconds for an agent role, given the call's own default. */
export const roleSeconds = (role: string, dflt: number): number => Number(process.env[`ALEPH_${role}_TIMEOUT`] ?? dflt);
export const windowsTimeCmd = (): string | undefined => process.env.ALEPH_WINDOWS_TIME_CMD;
export const ruleCmd = () => process.env.ALEPH_RULE_CMD ?? "claude";
export const doctorClockMs = () => Number(process.env.ALEPH_DOCTOR_CLOCK_MS ?? 15_000);
export const homeUrl = () => process.env.ALEPH_HOME_URL ?? "http://aleph.home/";
export const systemctlBin = () => process.env.ALEPH_SYSTEMCTL ?? "systemctl";
export const jobForeground = (): boolean => process.env.ALEPH_JOB_FOREGROUND === "1";
/** The repos file, unexpanded. */
export const reposFile = () => process.env.ALEPH_REPOS ?? "~/.aleph/repos.json";
/** The port aleph-ui listens on, and the one the smoke check calls. */
export const uiPort = (): string => process.env.ALEPH_UI_PORT ?? "3020";
export const startCmd = (): string | undefined => process.env.ALEPH_START_CMD;
export const runEnvFile = (): string | undefined => process.env.ALEPH_RUN_ENV;
export const uiFetchTtl = () => Number(process.env.ALEPH_UI_FETCH_TTL ?? 30);
export const nowOverride = (): string | undefined => process.env.ALEPH_NOW;
export const skillsDir = () => process.env.ALEPH_SKILLS_DIR ?? join(import.meta.dir, "..", "..", "skills");
/** The skills store. */
export const skillsStore = () => process.env.ALEPH_SKILLS_STORE ?? join(homedir(), ".aleph", "skills-store.json");
export const uiPassword = () => process.env.ALEPH_UI_PASSWORD ?? "";
export const cliOverride = (): string | undefined => process.env.ALEPH_CLI;
export const stateSlowMs = () => Number(process.env.ALEPH_STATE_SLOW_MS ?? 0);
/** The usage file, unexpanded. */
export const usageFileSetting = () => process.env.ALEPH_USAGE_FILE ?? "~/.aleph/usage.jsonl";
export const usageFileSet = (): boolean => !!process.env.ALEPH_USAGE_FILE;
/** The credentials file, unexpanded. */
export const credentialsFileSetting = () => process.env.ALEPH_CLAUDE_CREDENTIALS ?? "~/.claude/.credentials.json";
export const usageUrl = () => process.env.ALEPH_USAGE_URL ?? "https://api.anthropic.com/api/oauth/usage";
