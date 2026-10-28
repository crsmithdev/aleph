import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { base, job, repo, setup, state, teardown } from "./cli.helpers";

beforeAll(() => {
  setup();
  const regs = JSON.parse(readFileSync(join(base, "repos.json"), "utf8"));
  const check = (log: string) => ({ name: "slot", run: `echo "$(date +%s%N) start" >> ${log}; sleep 2; echo "$(date +%s%N) end" >> ${log}; echo "$ALEPH_TEST_PARALLEL" > ${log}.env` });
  regs.slots = { path: repo, autoland: false, checks: [check(join(base, "slots.log"))] };
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
