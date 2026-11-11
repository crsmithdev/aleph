import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { type Entry, type Run } from "../records/ledger.ts";
import { putRun } from "../records/record.ts";
import { holdsWork, isRunning, markEnded, markStarted, processState, runHealth, STARTING_MS, stop, unitAlive } from "./process.ts";

const NOW = Date.parse("2026-11-03T00:00:00Z");
let base: string;
const kids: { kill: (s?: NodeJS.Signals) => void }[] = [];
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-process-"));
  process.env.ALEPH_JOBS_DIR = join(base, "runs");
  mkdirSync(join(base, "runs"));
});
afterEach(() => {
  setSystemTime();
  for (const k of kids.splice(0)) k.kill("SIGKILL");
  delete process.env.ALEPH_JOBS_DIR;
  rmSync(base, { recursive: true, force: true });
});

function entry(id: string, extra: Partial<Run> = {}): Entry {
  const folder = join(base, "runs", id);
  mkdirSync(folder);
  const run = { kind: "build", job: id, name: "x", repo: "demo", condition: "running", told: true, started: "2026-11-03T00:00:00Z", made: NOW, ...extra } as Run;
  putRun(basename(folder), run);
  return { id, folder, run };
}

/**
 * A bash whose command line names the folder, as a unit's does. It runs `script` (builtins only, so bash execs
 * nothing that would lose the folder) and then blocks on its stdin until killed. It returns once bash has said
 * `up`, so its command line is bash's.
 */
async function liveIn(folder: string, script = ""): Promise<number> {
  const p = Bun.spawn(["bash", "-c", `${script} echo up; read; : ${folder}`], { stdin: "pipe", stdout: "pipe" });
  kids.push(p);
  await p.stdout.getReader().read();
  markStarted(folder, p.pid);
  return p.pid;
}

// Only this test fixes the clock: stop() times its grace with the real one.
test("each state of a run's process", async () => {
  setSystemTime(NOW);
  const starting = entry("a");
  expect(processState(starting)).toBe("starting");
  expect(processState(entry("b", { made: NOW - STARTING_MS - 1000 }))).toBe("none");
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

test("stop waits for a unit that wrote exit but still runs", async () => {
  const e = entry("a");
  await liveIn(e.folder);
  markEnded(e.folder, 0);
  expect(processState(e)).toBe("ended");
  expect(await stop(e, 300)).toBe(true);
  expect(unitAlive(e.folder)).toBe(false);
});

test("stop kills a process that ignores SIGTERM once the grace time is over, and returns only when it is gone", async () => {
  const e = entry("a");
  await liveIn(e.folder, "trap '' TERM;");
  expect(await stop(e, 300)).toBe(true);
  expect(processState(e)).toBe("lost");
});

test("a running run with a dead pid is killed when it started before the boot, and lost when it started after", () => {
  setSystemTime(NOW);
  const e = entry("r-dead");
  markStarted(e.folder, 999_999_999);
  expect(runHealth(e, NOW + 1)).toBe("killed");
  expect(runHealth(e, NOW - 1)).toBe("lost");
  expect(runHealth({ ...e, run: { ...e.run, condition: "done" } }, NOW + 1)).toBe("lost");
  expect(runHealth(entry("r-new"), NOW + 1)).toBe("starting");
});

test("a lost director run frees its work and a live one holds it", async () => {
  const dead = entry("r-dir", { kind: "director", on: "x1" });
  markStarted(dead.folder, 999_999_999);
  expect(holdsWork([dead], "director", "x1")).toBe(false);
  const live = entry("r-dir2", { kind: "director", on: "x2" });
  await liveIn(live.folder);
  expect(holdsWork([live], "director", "x2")).toBe(true);
});
