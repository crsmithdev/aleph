// Archived goal tests from jobs/cli.slots-check.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { base, job, repo, setup, teardown } from "../../jobs/cli.helpers";

beforeAll(() => {
  setup();
  const regs = JSON.parse(readFileSync(join(base, "repos.json"), "utf8"));
  const check = (log: string) => ({ name: "slot", run: `echo "$ALEPH_TEST_PARALLEL" > ${log}.env` });
  regs.slots = { path: repo, autoland: false, checks: [check(join(base, "slots.log"))] };
  writeFileSync(join(base, "repos.json"), JSON.stringify(regs));
});
afterAll(teardown);
const cores = availableParallelism();

describe("check slots", () => {
  beforeAll(async () => {
    await job("s1", "commit s1.txt", { ALEPH_CHECK_SLOTS: "1" }, "slots");
  }, 90_000);

  test("the check's env carries ALEPH_TEST_PARALLEL = cores / slots", () => {
    expect(readFileSync(join(base, "slots.log.env"), "utf8").trim()).toBe(String(Math.floor(cores / 1)));
  });
});
