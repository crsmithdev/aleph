import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeRun, type Entry, type Run } from "../records/ledger.ts";
import { isRunning, markEnded, markStarted, processState, STARTING_MS, stop, unitAlive } from "./process.ts";

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
  writeRun(folder, run);
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

test("stop kills a process that ignores SIGTERM once the grace time is over, and returns only when it is gone", async () => {
  const e = entry("a");
  await liveIn(e.folder, "trap '' TERM;");
  expect(await stop(e, 300)).toBe(true);
  expect(processState(e)).toBe("lost");
});
