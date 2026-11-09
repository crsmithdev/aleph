// The run's unit process. The only module that reads or writes a run folder's `pid` and `exit` files.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Entry, Run } from "../records/ledger.ts";

/**
 * A run's process: `starting` (made, no `pid` yet, for STARTING_MS), `live` (`pid`, no `exit`, and that process names
 * the folder), `lost` (`pid`, no `exit`, the process is gone), `ended` (`exit`), or `none` (none of these).
 */
export type ProcessState = "starting" | "live" | "lost" | "ended" | "none";

/**
 * A run that was started and has not written `pid` yet: its unit is still coming up, or `dispatch` gave up waiting
 * for it. It counts as running for STARTING_MS after it was made, so a later start cannot slip past a gate.
 */
export const STARTING_MS = 120_000;

const pidOf = (folder: string): number | null => {
  try {
    const pid = Number(readFileSync(join(folder, "pid"), "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
};

const names = (pid: number, folder: string): boolean => {
  try { return readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " ").includes(folder); } catch { return false; }
};

/** The state of the run's process. */
export function processState(e: { folder: string; run: Pick<Run, "condition" | "made"> }): ProcessState {
  if (existsSync(join(e.folder, "exit"))) return "ended";
  if (existsSync(join(e.folder, "pid"))) {
    const pid = pidOf(e.folder);
    return pid !== null && names(pid, e.folder) ? "live" : "lost";
  }
  return e.run.condition === "running" && Date.now() - (e.run.made ?? 0) < STARTING_MS ? "starting" : "none";
}

/** The run's process is live or still starting: a second run of its job must not start. */
export const isRunning = (e: Entry): boolean => ["live", "starting"].includes(processState(e));

/** Sidetone's rule (spec 14.10.4): `pid`, no `exit`, and that process names the folder. */
export const isLive = (folder: string): boolean => processState({ folder, run: { condition: "done" } }) === "live";

/** Made, running, and no `pid` yet, for STARTING_MS. */
export const isStarting = (e: Entry): boolean => processState(e) === "starting";

/** `pid`, no `exit`, and the process is gone: the run died without an end. */
export const isLost = (folder: string): boolean => processState({ folder, run: { condition: "done" } }) === "lost";

/**
 * The unit process is alive, whether or not it wrote `exit`: the unit writes `exit` and then awaits its run-end
 * dispatch, which may still start issues or hold the dispatch locks.
 */
export function unitAlive(folder: string): boolean {
  const pid = pidOf(folder);
  return pid !== null && names(pid, folder);
}

/** The unit records its own process. */
export const markStarted = (folder: string, pid = process.pid): void => writeFileSync(join(folder, "pid"), String(pid));

/** The run ended with `code`. An `exit` already there stays: the first end is the true one. */
export function markEnded(folder: string, code: number): void {
  if (!existsSync(join(folder, "exit"))) writeFileSync(join(folder, "exit"), String(code));
}

/**
 * Wait until the unit writes `pid`, up to `ms`, or until `gone()` says it cannot: its unit exited, or its folder is
 * gone. True when `pid` is there.
 */
export async function waitForPid(folder: string, ms: number, gone: () => boolean): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (!existsSync(join(folder, "pid")) && Date.now() < deadline && existsSync(folder) && !gone()) await Bun.sleep(25);
  return existsSync(join(folder, "pid"));
}

/** Wait up to `ms` for the unit process to go. True when it is gone. */
async function gone(folder: string, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (unitAlive(folder) && Date.now() < deadline) await Bun.sleep(50);
  return !unitAlive(folder);
}

/**
 * Stop a live run and wait until its process is gone: its systemd unit (the whole cgroup), else SIGTERM to its process
 * group and its pid; after `ms`, SIGKILL to both. False when the process still lives after that: the caller treats the
 * run as stuck, never as failed.
 */
export async function stop(e: Entry, ms = 35_000): Promise<boolean> {
  // The unit is `aleph-<subject>-<n>`, the folder name after its stamp; a run from before job IDs has no `n` and its unit has the whole folder name.
  Bun.spawnSync(["systemctl", "--user", "stop", `aleph-${e.run.n === undefined ? e.id : e.id.slice(16)}`], { stdout: "ignore", stderr: "ignore" });
  const pid = pidOf(e.folder);
  if (pid === null || !unitAlive(e.folder)) return true;
  const signal = (s: NodeJS.Signals) => { for (const p of [-pid, pid]) try { process.kill(p, s); } catch {} };
  signal("SIGTERM");
  if (await gone(e.folder, ms)) return true;
  signal("SIGKILL");
  return gone(e.folder, 5_000);
}

/**
 * The run with `ended` pulled back to its last worker activity: the newest file in its folder (state.json and `exit` aside),
 * and no later than the `exit` file. `ended` is stamped when something notices the run stopped, which can be hours after a
 * killed worker. A run with no such file keeps its `ended`; the end never goes before `started`.
 */
export function activeEnd(e: Entry): Run {
  const r = e.run as Run, a = Date.parse(r.started), b = Date.parse(r.ended ?? "");
  if (!(b >= a)) return r;
  // A folder that has had no writes for SETTLED_MS keeps its end; this read stats every file of it.
  const key = `${e.folder}@${r.ended}`, kept = ends.get(key);
  if (kept !== undefined) return kept === b ? r : { ...r, ended: new Date(kept).toISOString() };
  let end = b;
  try {
    let last = -Infinity;
    for (const f of readdirSync(e.folder)) if (f !== "state.json" && f !== "exit") last = Math.max(last, statSync(join(e.folder, f)).mtimeMs);
    if (last > -Infinity) end = Math.min(end, last);
    if (existsSync(join(e.folder, "exit"))) end = Math.min(end, statSync(join(e.folder, "exit")).mtimeMs);
  } catch { return r; }
  end = Math.max(a, end);
  if (Date.now() - b > SETTLED_MS) ends.set(key, end);
  return end === b ? r : { ...r, ended: new Date(end).toISOString() };
}

/** How long after `ended` a run folder is taken to be done changing. */
const SETTLED_MS = 10 * 60_000;
/** The end `activeEnd` found for a settled run, by folder and `ended`. */
const ends = new Map<string, number>();
