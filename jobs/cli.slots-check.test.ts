import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { base, job, jobsDir, repo, setup, state, teardown } from "./cli.helpers";

beforeAll(() => {
  setup();
  const regs = JSON.parse(readFileSync(join(base, "repos.json"), "utf8"));
  // Each check runs 5 s under a 9 s limit: 4 s of slack, so a loaded machine does not cut a check off.
  const check = (log: string) => ({ name: "slot", run: `echo "$(date +%s%N) start" >> ${log}; sleep 5; echo "$(date +%s%N) end" >> ${log}; echo "$ALEPH_TEST_PARALLEL" > ${log}.env` });
  regs.slots = { path: repo, autoland: false, checks: [check(join(base, "slots.log"))] };
  writeFileSync(join(base, "repos.json"), JSON.stringify(regs));
});
afterAll(teardown);

const lines = (f: string) => readFileSync(f, "utf8").trim().split("\n").map((l) => l.split(" ") as [string, string]);

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
    const setupLog = (run: string) => {
      const f = join(jobsDir, run, "setup.log");
      return existsSync(f) ? `\n--- ${run}/setup.log\n${readFileSync(f, "utf8")}` : "";
    };
    return [
      `--- slots.log\n${existsSync(slotsLog()) ? readFileSync(slotsLog(), "utf8") : "(none)"}`,
      ...runs.map((r) => `--- ${r.json.run}\n${st(r.json.run)}${setupLog(r.json.run)}`),
    ].join("\n");
  };
  /** Both runs passed and the log has the four lines the test reads: a failure here throws with `cause`. */
  const ready = () => {
    const passed = runs.every((r) => { try { return state(r.json.run).condition === "passed"; } catch { return false; } });
    const count = existsSync(slotsLog()) ? readFileSync(slotsLog(), "utf8").trim().split("\n").length : 0;
    if (!passed || count !== 4) throw new Error(`both runs must pass and slots.log must have 4 lines (it has ${count})\n${cause()}`);
  };
  beforeAll(async () => {
    // One slot, a 9 s limit, and a check of 5 s: the second check waits about 5 s and runs 5 s.
    // A check has 4 s of slack against the limit. Two checks back to back take at least 10 s, more than the limit;
    // load only makes them take longer, so that side needs no slack.
    const extra = { ALEPH_CHECK_SLOTS: "1", ALEPH_CHECK_TIMEOUT: "9" };
    runs = await Promise.all(["s1", "s2"].map((n) => job(n, `commit ${n}.txt`, extra, "slots")));
  }, 90_000);

  test("with one slot two checks started together run one after the other, and both pass", () => {
    ready();
    for (const r of runs) expect(state(r.json.run)).toMatchObject({ condition: "passed" });
    const l = lines(slotsLog());
    expect(l.map((x) => x[1])).toEqual(["start", "end", "start", "end"]);
    expect(BigInt(l[2][0])).toBeGreaterThanOrEqual(BigInt(l[1][0]));
  });

  test("the wait for a slot does not count against ALEPH_CHECK_TIMEOUT", () => {
    ready();
    const l = lines(slotsLog());
    // The second check ended more than the 9 s limit after the first started, and was not timed out.
    expect(Number(BigInt(l[3][0]) - BigInt(l[0][0])) / 1e9).toBeGreaterThan(9);
    for (const r of runs) expect(state(r.json.run).checks.every((c: any) => c.ok)).toBe(true);
  });
});
