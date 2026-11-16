/** The factory's capacity: the runs live now and today, the live caps and the GPU slot. */
import { getJson, putJson } from "../../../lib/db.ts";
import { logEvent } from "../../../lib/layout.ts";
import { allRuns, isBuild, loadRegistry, type Entry, type Run } from "../records/ledger.ts";
import { detailOf } from "../../../lib/naming.ts";
import { lock } from "../infra/locks.ts";
import { isRunning } from "../infra/process.ts";
import { LOCAL_CAP } from "../infra/settings.ts";
import { readModels, viaOfRun, type Name, type Setting } from "../routing/models.ts";

export const DAY = 24 * 3600_000;

/** Logs the live cap turning on (`full`: its `N / M jobs`) or off (null); a cap that stays as it is logs nothing. */
export function logCap(full: string | null): void {
  if ((full !== null) === getJson("state", "cap-on", false)) return;
  putJson("state", "cap-on", full !== null);
  logEvent({ subject: "gate", action: "changed", object: "settings", detail: detailOf("changed", "cap", full === null ? "off" : `on: ${full}`) });
}

/** The registry's factory repos: those whose runs are sandboxed. */
export const sandboxRepos = () => Object.values(loadRegistry()).filter((r) => r.sandbox);

/** Factory agent and intake runs (triage and planner runs before them) started in the last 24 hours. */
/** `runs` is every run, when the caller has read them already. */
export function runsToday(now = Date.now(), runs: Entry[] = allRuns()): Entry[] {
  const keys = new Set(sandboxRepos().map((r) => r.key));
  return runs.filter((e) => (isBuild(e.run.role) || e.run.role === "intake") && e.run.repo && keys.has(e.run.repo) && now - Date.parse(e.run.started) < DAY);
}

/** The dollars of the runs started in the last 24 hours: `runsToday`, and the firefighter and director runs (and the explain runs from before the director), which `runsToday` does not count. A director run has no repo (its `on` is an item ref, a run folder or a lesson id), so it is not filtered by one, as a firefighter run is not. */
export function spentToday(now = Date.now(), runs: Entry[] = allRuns()): number {
  const others = runs.filter((e) => (e.run.role === "director") && now - Date.parse(e.run.started) < DAY);
  return [...runsToday(now, runs), ...others].reduce((a, e) => a + (e.run.cost ?? 0), 0);
}

/** Agent runs live now, and those started whose unit has not written `pid` yet. */
export const liveEntries = (runs: Entry[] = allRuns()): Entry[] => runs.filter((e) => isBuild(e.run.role) && isRunning(e));

/** Whether a build run is on the local backend: unit.ts sets its model to its size's, and before that its size's model is the local one. */
export const onLocal = (run: Pick<Run, "model" | "merge">, models: Record<Name, Setting>): boolean => viaOfRun(run, models) === "local";

/** Live agent runs on Claude, the count the live cap checks: a local-backend run counts against LOCAL_CAP only. */
export const liveRuns = (runs?: Entry[]): number => { const models = readModels(); return liveEntries(runs).filter((e) => !onLocal(e.run, models)).length; };

/** Live agent runs on the local backend, the count LOCAL_CAP checks. */
export const liveLocal = (runs?: Entry[], models = readModels()): number => liveEntries(runs).filter((e) => onLocal(e.run, models)).length;

/**
 * Takes the GPU slot for one local call: no local agent run is live and the `gpu` lock is free. Waits up to `waitMs`;
 * null when the slot stays taken. The caller calls the release when its call ends.
 */
export async function gpuSlot(waitMs: number): Promise<(() => void) | null> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    // Take the lock first: a local run's start holds it from its cap check until its run record is written.
    const release = await lock("gpu", 0);
    if (release) {
      if (liveLocal() < LOCAL_CAP) return release;
      release();
    }
    if (Date.now() >= deadline) return null;
    await Bun.sleep(100);
  }
}
