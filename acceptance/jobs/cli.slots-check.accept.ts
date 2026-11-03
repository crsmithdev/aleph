// Archived goal tests from jobs/cli.slots-check.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { base, job, repo, setup, teardown } from "../../jobs/cli.helpers";

beforeAll(() => {
  setup();
  const regs = JSON.parse(readFileSync(join(base, "repos.json"), "utf8"));
  // Each check runs 5 s under a 9 s limit: 4 s of slack, so a loaded machine does not cut a check off.
  const check = (log: string) => ({ name: "slot", run: `echo "$(date +%s%N) start" >> ${log}; sleep 5; echo "$(date +%s%N) end" >> ${log}; echo "$ALEPH_TEST_PARALLEL" > ${log}.env` });
  regs.slots = { path: repo, autoland: false, checks: [check(join(base, "slots.log"))] };
  writeFileSync(join(base, "repos.json"), JSON.stringify(regs));
});
afterAll(teardown);
const cores = availableParallelism();

describe("check slots", () => {
  beforeAll(async () => {
    // One slot, a 9 s limit, and a check of 5 s: the second check waits about 5 s and runs 5 s.
    // A check has 4 s of slack against the limit. Two checks back to back take at least 10 s, more than the limit;
    // load only makes them take longer, so that side needs no slack.
    const extra = { ALEPH_CHECK_SLOTS: "1", ALEPH_CHECK_TIMEOUT: "9" };
    await Promise.all(["s1", "s2"].map((n) => job(n, `commit ${n}.txt`, extra, "slots")));
  }, 90_000);

  test("the check's env carries ALEPH_TEST_PARALLEL = cores / slots", () => {
    expect(readFileSync(join(base, "slots.log.env"), "utf8").trim()).toBe(String(Math.floor(cores / 1)));
  });
});
