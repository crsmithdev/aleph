import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { aleph, base, fakeLog, job, repo, setup, specFile, state, teardown } from "./cli.helpers";

beforeAll(() => {
  setup();
  const regs = JSON.parse(readFileSync(join(base, "repos.json"), "utf8"));
  const check = (log: string) => ({ name: "slot", run: `echo "$(date +%s%N) start" >> ${log}; sleep 2; echo "$(date +%s%N) end" >> ${log}; echo "$ALEPH_TEST_PARALLEL" > ${log}.env` });
  regs.slots = { path: repo, autoland: false, checks: [check(join(base, "slots.log"))] };
  regs.slotfac = { path: repo, sandbox: true, autoland: false, checks: [check(join(base, "slotfac.log"))] };
  writeFileSync(join(base, "repos.json"), JSON.stringify(regs));
});
afterAll(teardown);

const lines = (f: string) => readFileSync(f, "utf8").trim().split("\n").map((l) => l.split(" ") as [string, string]);
const cores = availableParallelism();

describe("check slots", () => {
  let runs: Awaited<ReturnType<typeof job>>[] = [];
  beforeAll(async () => {
    // One slot, a 3 s limit, and a check of 2 s: the second check waits about 2 s and runs 2 s.
    const extra = { ALEPH_CHECK_SLOTS: "1", ALEPH_CHECK_TIMEOUT: "3" };
    runs = await Promise.all(["s1", "s2"].map((n) => job(n, `commit ${n}.txt`, extra, "slots")));
  }, 60_000);

  test("with one slot two checks started together run one after the other, and both pass", () => {
    for (const r of runs) expect(state(r.json.run)).toMatchObject({ state: "passed" });
    const l = lines(join(base, "slots.log"));
    expect(l.map((x) => x[1])).toEqual(["start", "end", "start", "end"]);
    expect(BigInt(l[2][0])).toBeGreaterThanOrEqual(BigInt(l[1][0]));
  });

  test("the wait for a slot does not count against ALEPH_CHECK_TIMEOUT", () => {
    const l = lines(join(base, "slots.log"));
    // The second check ended more than the 3 s limit after the first started, and was not timed out.
    expect(Number(BigInt(l[3][0]) - BigInt(l[0][0])) / 1e9).toBeGreaterThan(3);
    for (const r of runs) expect(state(r.json.run).checks.every((c: any) => c.ok)).toBe(true);
  });

  test("the check's env carries ALEPH_TEST_PARALLEL = cores / slots", () => {
    expect(readFileSync(join(base, "slots.log.env"), "utf8").trim()).toBe(String(Math.floor(cores / 1)));
  });
});

describe("test workers per suite", () => {
  test("a factory run's worker and its checks in the sandbox carry cores / slots", async () => {
    const r = await aleph(["job", "slotfac", "wenv", "--spec", specFile("Goal: wenv\nACTION: commit wenv.txt\n")], { ALEPH_CHECK_SLOTS: "4" });
    expect(state(r.json.run).state).toBe("passed");
    const want = String(Math.floor(cores / 4));
    expect(readFileSync(join(fakeLog, "env"), "utf8")).toContain(`ALEPH_TEST_PARALLEL=${want}\n`);
    expect(readFileSync(join(base, "slotfac.log.env"), "utf8").trim()).toBe(want);
  }, 60_000);

  test("package.json reads ALEPH_TEST_PARALLEL and falls back to the core count", () => {
    const run = (extra: Record<string, string>) => {
      const e: Record<string, string> = { ...(process.env as Record<string, string>) };
      delete e.ALEPH_TEST_PARALLEL;
      const script = JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf8")).scripts.test.replace(/^bun test/, "echo");
      const dir = join(base, "pkg");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { test: script } }));
      return Bun.spawnSync(["bun", "run", "test"], { cwd: dir, env: { ...e, ...extra }, stdout: "pipe" }).stdout.toString();
    };
    expect(run({})).toContain(`--parallel=${cores}\n`);
    expect(run({ ALEPH_TEST_PARALLEL: "7" })).toContain("--parallel=7\n");
  });
});

describe("run units get a low priority", () => {
  const argvLog = () => join(base, "systemd-run.log");
  const entries = () => readFileSync(argvLog(), "utf8").trim().split("\n").filter(Boolean);
  beforeAll(() => {
    mkdirSync(join(base, "fakebin"), { recursive: true });
    writeFileSync(join(base, "fakebin", "systemd-run"), `#!/bin/bash\necho "$@" >> ${argvLog()}\n`);
    chmodSync(join(base, "fakebin", "systemd-run"), 0o755);
    writeFileSync(argvLog(), "");
  });
  const viaSystemd = () => ({ ALEPH_JOB_FOREGROUND: "0", PATH: `${join(base, "fakebin")}:${process.env.PATH}` });

  test("the systemd-run argv of an agent run and of a land has CPUWeight=20 and --nice=10", async () => {
    await aleph(["job", "demo", "unitprio", "--spec", specFile("Goal: unitprio\nACTION: commit unitprio.txt\n")], viaSystemd());
    const agent = entries().find((e) => e.includes(" unit "))!;
    expect(agent).toContain("--property=CPUWeight=20");
    expect(agent).toContain("--nice=10");
    const r = await job("landprio", "commit landprio.txt");
    expect(state(r.json.run).state).toBe("passed");
    await aleph(["land", "landprio"], viaSystemd());
    const land = entries().find((e) => e.includes("-demo-landprio-land"))!;
    expect(land).toContain("--property=CPUWeight=20");
    expect(land).toContain("--nice=10");
  }, 60_000);
});
