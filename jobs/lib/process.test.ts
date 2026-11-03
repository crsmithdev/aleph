import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { waitFor } from "../../tests/wait.ts";
import { writeRun, type Entry, type Run } from "./ledger.ts";
import { isRunning, markEnded, markStarted, processState, STARTING_MS, stop, unitAlive } from "./process.ts";

let base: string;
const kids: { kill: () => void }[] = [];
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-process-"));
  process.env.ALEPH_JOBS_DIR = join(base, "runs");
  mkdirSync(join(base, "runs"));
});
afterEach(() => {
  for (const k of kids.splice(0)) k.kill();
  delete process.env.ALEPH_JOBS_DIR;
  rmSync(base, { recursive: true, force: true });
});

function entry(id: string, extra: Partial<Run> = {}): Entry {
  const folder = join(base, "runs", id);
  mkdirSync(folder);
  const run = { kind: "build", job: id, name: "x", repo: "demo", condition: "running", told: true, started: "2026-11-03T00:00:00Z", made: Date.now(), ...extra } as Run;
  writeRun(folder, run);
  return { id, folder, run };
}

/** A process whose command line names the folder, as a unit's does; it returns once the child has exec'd bash. */
async function liveIn(folder: string): Promise<number> {
  const p = Bun.spawn(["bash", "-c", `sleep 30; : ${folder}`]);
  kids.push(p);
  const named = () => { try { return readFileSync(`/proc/${p.pid}/cmdline`, "utf8").includes(folder); } catch { return false; } };
  await waitFor(named, { timeout: 5000, every: 10 });
  markStarted(folder, p.pid);
  return p.pid;
}

test("each state of a run's process", async () => {
  const starting = entry("a");
  expect(processState(starting)).toBe("starting");
  expect(processState(entry("b", { made: Date.now() - STARTING_MS - 1000 }))).toBe("none");
  expect(processState(entry("c", { condition: "done" }))).toBe("none");
  const lost = entry("d");
  markStarted(lost.folder, 999_999_999);
  expect(processState(lost)).toBe("lost");
  const live = entry("e");
  await liveIn(live.folder);
  expect(processState(live)).toBe("live");
  expect(isRunning(live) && isRunning(starting)).toBe(true);
  markEnded(live.folder, 0);
  expect(processState(live)).toBe("ended");
  expect(unitAlive(live.folder)).toBe(true);
});

test("the first end is the one kept", () => {
  const e = entry("a");
  markEnded(e.folder, 0);
  markEnded(e.folder, 143);
  expect(readFileSync(join(e.folder, "exit"), "utf8")).toBe("0");
});

test("stop ends a live run's process", async () => {
  const e = entry("a");
  await liveIn(e.folder);
  expect(processState(e)).toBe("live");
  await stop(e, 5000);
  expect(processState(e)).toBe("lost");
});
