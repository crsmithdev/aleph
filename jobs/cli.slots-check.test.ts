import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { base, job, repo, setup, state, teardown } from "./cli.helpers";

beforeAll(() => {
  setup();
  const regs = JSON.parse(readFileSync(join(base, "repos.json"), "utf8"));
  // Each check runs 4 s under a 6 s limit: 2 s of slack on each side, so a loaded machine does not cut a check off.
  const check = (log: string) => ({ name: "slot", run: `echo "$(date +%s%N) start" >> ${log}; sleep 4; echo "$(date +%s%N) end" >> ${log}; echo "$ALEPH_TEST_PARALLEL" > ${log}.env` });
  regs.slots = { path: repo, autoland: false, checks: [check(join(base, "slots.log"))] };
  writeFileSync(join(base, "repos.json"), JSON.stringify(regs));
});
afterAll(teardown);

const lines = (f: string) => readFileSync(f, "utf8").trim().split("\n").map((l) => l.split(" ") as [string, string]);
const cores = availableParallelism();

describe("check slots", () => {
  let runs: Awaited<ReturnType<typeof job>>[] = [];
  const slotsLog = () => join(base, "slots.log");
  /** What a failed run needs to name its cause: the log, and each run's state, reason and checks. */
  const cause = () => {
    const st = (run: string) => {
      try {
        const { state: s, reason, checks } = state(run);
        return JSON.stringify({ state: s, reason, checks }, null, 2);
      } catch {
        return "(no state.json)";
      }
    };
    return [
      `--- slots.log\n${existsSync(slotsLog()) ? readFileSync(slotsLog(), "utf8") : "(none)"}`,
      ...runs.map((r) => `--- ${r.json.run}\n${st(r.json.run)}`),
    ].join("\n");
  };
  /** Both runs passed and the log has the four lines the test reads: a failure here throws with `cause`. */
  const ready = () => {
    const passed = runs.every((r) => { try { return state(r.json.run).state === "passed"; } catch { return false; } });
    const count = existsSync(slotsLog()) ? readFileSync(slotsLog(), "utf8").trim().split("\n").length : 0;
    if (!passed || count !== 4) throw new Error(`both runs must pass and slots.log must have 4 lines (it has ${count})\n${cause()}`);
  };
  beforeAll(async () => {
    // One slot, a 6 s limit, and a check of 4 s: the second check waits about 4 s and runs 4 s.
    // Both margins are 2 s: run time against the limit, and the limit against two checks back to back (8 s).
    const extra = { ALEPH_CHECK_SLOTS: "1", ALEPH_CHECK_TIMEOUT: "6" };
    runs = await Promise.all(["s1", "s2"].map((n) => job(n, `commit ${n}.txt`, extra, "slots")));
  }, 90_000);

  test("with one slot two checks started together run one after the other, and both pass", () => {
    ready();
    for (const r of runs) expect(state(r.json.run)).toMatchObject({ state: "passed" });
    const l = lines(slotsLog());
    expect(l.map((x) => x[1])).toEqual(["start", "end", "start", "end"]);
    expect(BigInt(l[2][0])).toBeGreaterThanOrEqual(BigInt(l[1][0]));
  });

  test("the wait for a slot does not count against ALEPH_CHECK_TIMEOUT", () => {
    ready();
    const l = lines(slotsLog());
    // The second check ended more than the 6 s limit after the first started, and was not timed out.
    expect(Number(BigInt(l[3][0]) - BigInt(l[0][0])) / 1e9).toBeGreaterThan(6);
    for (const r of runs) expect(state(r.json.run).checks.every((c: any) => c.ok)).toBe(true);
  });

  test("the check's env carries ALEPH_TEST_PARALLEL = cores / slots", () => {
    expect(readFileSync(join(base, "slots.log.env"), "utf8").trim()).toBe(String(Math.floor(cores / 1)));
  });
});
