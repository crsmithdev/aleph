/**
 * The factory's own settings: caps, time limits, rounds, switches and the agent commands. Each setting
 * has one name, one default and one parser here. Paths under home are read in lib/paths.ts. A command that
 * only one call site uses stays at that call site.
 *
 * Each function reads at each call: a test changes the environment in-process, and launch.ts hands
 * every ALEPH_* variable to the units it starts.
 */
import { availableParallelism } from "node:os";
import { dirname, join, resolve } from "node:path";
import { alephPath, expand, home, vaultDir } from "../../../lib/paths.ts";
import { getJson, putJson } from "../../../lib/db.ts";

/** A numeric setting: an empty or missing variable is unset and gives the default. */
const num = (name: string, dflt: number): number => Number(process.env[name] || dflt);

/**
 * The raw rows of the settings that other modules parse: `paused`, `always`, `timeouts` and `models`. The row's reader
 * and writer are here; the caller keeps the meaning of the value (ask.ts, timeout.ts, models.ts, factory-status.ts).
 */
/** The time the factory paused, or null when it runs. */
export const pausedAt = (): string | null => getJson<string | null>("settings", "paused", null);
export const setPausedAt = (at: string | null): void => putJson("settings", "paused", at);
export const alwaysRow = <T>(): Record<string, T> => getJson("settings", "always", {});
export const setAlwaysRow = (row: unknown): void => putJson("settings", "always", row);
export const timeoutsRow = <T>(): Record<string, T> => getJson("settings", "timeouts", {});
export const setTimeoutsRow = (row: unknown): void => putJson("settings", "timeouts", row);
export const modelsRow = (): any => getJson("settings", "models", {});
export const setModelsRow = (row: unknown): void => putJson("settings", "models", row);

/** The `caps` setting: the caps and settings of CAP_KEYS. A missing row is empty; other keys are left alone. */
const capsRow = (): Record<string, unknown> => getJson("settings", "caps", {});

export const CAP_KEYS = ["live", "run", "intakeTries", "jobSeconds", "fixRounds", "landBatch", "loadLimit"] as const;
type CapKey = (typeof CAP_KEYS)[number];
/** The environment variable that overrides each key of the `caps` setting. */
export const CAP_ENV: Record<CapKey, string> = {
  live: "ALEPH_LIVE_CAP", run: "ALEPH_RUN_CAP", intakeTries: "ALEPH_INTAKE_TRIES", jobSeconds: "ALEPH_JOB_TIMEOUT",
  fixRounds: "ALEPH_FIX_ROUNDS", landBatch: "ALEPH_LAND_BATCH", loadLimit: "ALEPH_LOAD_LIMIT",
};
/** The least value of each key: a job may have no fix round; every other key needs 1. */
export const capMin = (k: CapKey): number => (k === "fixRounds" ? 0 : 1);

/** Merges the given caps into the `caps` setting. Throws on a value that is not an integer of at least its key's least value. */
export function writeCaps(patch: Partial<Record<CapKey, unknown>>): Record<string, unknown> {
  for (const k of CAP_KEYS) {
    const v = patch[k];
    if (v !== undefined && !(typeof v === "number" && Number.isInteger(v) && v >= capMin(k))) throw new Error(`${k} must be an integer of ${capMin(k)} or more`);
  }
  const next: Record<string, unknown> = { ...capsRow() };
  for (const k of CAP_KEYS) if (patch[k] !== undefined) next[k] = patch[k];
  putJson("settings", "caps", next);
  return next;
}

/** Whether the environment variable overrides the `caps` setting: the same rule as cap(). */
export const capEnvSet = (envName: string): boolean => (process.env[envName] ?? "") !== "";

/** The environment variable first, then the `caps` setting, then the default. */
function cap(key: CapKey, dflt: number): number {
  const envName = CAP_ENV[key];
  if (capEnvSet(envName)) return num(envName, 0);
  const f = capsRow()[key];
  return typeof f === "number" && Number.isFinite(f) ? f : dflt;
}

/**
 * The most agent runs live at once: a sixth of the cores (4 of 24). A run's checks use half the cores (package.json),
 * so two suites fill the load limit while the other runs are in their worker step; more starts would only queue.
 */
/** The live cap's default as the docs state it; the number depends on the machine. */
export const LIVE_CAP_DEFAULT = "cores / 6, at least 1";
export const LIVE_CAP = () => cap("live", Math.max(1, Math.floor(availableParallelism() / 6)));
/** The most local-backend agent runs live at once, apart from the live cap: the one GPU serves one gpt-oss call. */
export const LOCAL_CAP = 1;
/** The most agent runs one issue starts in any 60 minutes, whatever the trigger: the next start is an Ask. */
export const RUN_CAP_DEFAULT = 3;
export const RUN_CAP = () => cap("run", RUN_CAP_DEFAULT);
/** The most director runs one tick starts, one per Ask. */
export const DIRECTOR_CAP = () => num("ALEPH_DIRECTOR_CAP", 3);
export const INTAKE_CAP = () => num("ALEPH_INTAKE_CAP", 5);
export const INTAKE_TRIES_DEFAULT = 2;
export const INTAKE_TRIES = () => cap("intakeTries", INTAKE_TRIES_DEFAULT);
/** How many signals make a lesson a proposal. */
export const PROPOSE_AT = (): number => {
  const n = num("ALEPH_PROPOSE_AT", 3);
  return Number.isFinite(n) && n >= 1 ? n : 3;
};

export const JOB_SECONDS_DEFAULT = 1800;
export const jobSeconds = () => cap("jobSeconds", JOB_SECONDS_DEFAULT);
/** How long an agent call may print nothing before the stall watch stops it. */
export const stallSeconds = (): number => num("ALEPH_STALL_SECONDS", 600);
export const checkSeconds = () => num("ALEPH_CHECK_TIMEOUT", 1200);
/** The seconds a repo's full suite may take before the Status page warns. */
export const suiteBudgetSeconds = () => num("ALEPH_SUITE_BUDGET_S", 120);
export const reviewSeconds = () => num("ALEPH_REVIEW_TIMEOUT", 600);
export const reviewDiffMax = () => num("ALEPH_REVIEW_DIFF_MAX", 200000);
export const FIX_ROUNDS_DEFAULT = 2;
export const fixRounds = () => cap("fixRounds", FIX_ROUNDS_DEFAULT);
/** How long a dispatch waits for another dispatch's issue lock before it skips the issue. */
export const issueLockWaitMs = () => num("ALEPH_GOAL_LOCK_WAIT_MS", 20_000);
export const rescueWaitMs = () => num("ALEPH_RESCUE_WAIT_MS", 60_000);
export const pidWaitMs = () => num("ALEPH_PID_WAIT_MS", 10_000);
export const LAND_BATCH_DEFAULT = 8;
export const landBatch = () => Math.max(1, Math.floor(cap("landBatch", LAND_BATCH_DEFAULT)) || 1);
/** The load limit's default as the docs state it; the number depends on the machine. */
export const LOAD_LIMIT_DEFAULT = "cores";
/** A check, a worker or a land starts only while the 1-minute load average is under this. */
export const loadLimit = () => cap("loadLimit", availableParallelism());
/** How long the UI keeps a computed read, 0 when off. */

export const dispatchOn = () => process.env.ALEPH_DISPATCH !== "off";
/** The tick's daily monitor step; tests turn it off, as a tick there must not start the reader. */
export const monitorOn = () => process.env.ALEPH_MONITOR !== "off";
/** The local hour from which the tick's monitor step may run: the `monitorHour` setting, 0 by default. */
export const monitorHour = (): number => getJson<number>("settings", "monitorHour", 0);
/** Stores the monitor hour. Throws on a value that is not a whole number from 0 to 23. */
export function writeMonitorHour(hour: unknown): void {
  if (!(typeof hour === "number" && Number.isInteger(hour) && hour >= 0 && hour <= 23)) throw new Error("the hour is a whole number from 0 to 23");
  putJson("settings", "monitorHour", hour);
}
export const rescueOn = () => process.env.ALEPH_RESCUE !== "off";

export const workerCmd = () => process.env.ALEPH_WORKER_CMD ?? "claude";
export const reviewerCmd = () => process.env.ALEPH_REVIEWER_CMD ?? workerCmd();

/** Chris's log of what reached him and why: the director reads it, and code does not. */
export const needsYouLog = (): string => process.env.ALEPH_NEEDS_YOU_LOG ?? join(dirname(resolve(vaultDir())), "needs-you-log.md");

/** The command for an agent role (`worker`, `reviewer`, ...), `claude` by default. */
export const roleCmd = (role: string): string => process.env[`ALEPH_${role}_CMD`] ?? "claude";
/** How long the chat panel's process waits for the next turn before it ends. The prompt cache lives 5 minutes, so a turn after more costs a cache write whether or not the process lives; 10 minutes covers a pause to read and think. */
export const chatIdleMs = (): number => Number(process.env.ALEPH_CHAT_IDLE_MS ?? 600_000);
/** The time limit in seconds for an agent role, given the call's own default. */
export const roleSeconds = (role: string, dflt: number): number => num(`ALEPH_${role}_TIMEOUT`, dflt);
export const windowsTimeCmd = (): string | undefined => process.env.ALEPH_WINDOWS_TIME_CMD;
export const ruleCmd = () => process.env.ALEPH_RULE_CMD ?? "claude";
export const doctorClockMs = () => num("ALEPH_DOCTOR_CLOCK_MS", 15_000);
export const homeUrl = () => process.env.ALEPH_HOME_URL ?? "http://aleph.home/";
export const unitDir = () => process.env.ALEPH_UNIT_DIR ?? join(home(), ".config", "systemd", "user");
export const systemctlBin = () => process.env.ALEPH_SYSTEMCTL ?? "systemctl";
export const jobForeground = (): boolean => process.env.ALEPH_JOB_FOREGROUND === "1";
/** The port aleph-ui listens on, and the one the smoke check calls. */
export const uiPort = (): string => process.env.ALEPH_UI_PORT ?? "3020";
export const startCmd = (): string | undefined => process.env.ALEPH_START_CMD;
export const runEnvFile = (): string | undefined => process.env.ALEPH_RUN_ENV;
export const skillsDir = () => process.env.ALEPH_SKILLS_DIR ?? join(import.meta.dir, "..", "..", "..", "skills");
/** The skills store. */
export const skillsStore = () => alephPath("ALEPH_SKILLS_STORE", "skills-store.json");
export const cliOverride = (): string | undefined => process.env.ALEPH_CLI;
export const stateSlowMs = () => num("ALEPH_STATE_SLOW_MS", 0);
/** The credentials file. */
export const credentialsFile = () => expand(process.env.ALEPH_CLAUDE_CREDENTIALS ?? join(home(), ".claude", ".credentials.json"));
export const usageUrl = () => process.env.ALEPH_USAGE_URL ?? "https://api.anthropic.com/api/oauth/usage";
