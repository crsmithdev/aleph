// Archived goal tests from jobs/cli.slots-workers.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { aleph, base, fakeLog, repo, setup, specFile, state, teardown } from "../../jobs/cli.helpers";

beforeAll(() => {
  setup();
  const regs = JSON.parse(readFileSync(join(base, "repos.json"), "utf8"));
  const check = (log: string) => ({ name: "slot", run: `echo "$(date +%s%N) start" >> ${log}; sleep 2; echo "$(date +%s%N) end" >> ${log}; echo "$ALEPH_TEST_PARALLEL" > ${log}.env` });
  regs.slotfac = { path: repo, sandbox: true, autoland: false, checks: [check(join(base, "slotfac.log"))] };
  writeFileSync(join(base, "repos.json"), JSON.stringify(regs));
});
afterAll(teardown);

const cores = availableParallelism();

describe("test workers per suite", () => {
  test("a factory run's worker and its checks in the sandbox carry cores / slots", async () => {
    const r = await aleph(["job", "slotfac", "wenv", "--spec", specFile("Goal: wenv\nACTION: commit wenv.txt\n")], { ALEPH_CHECK_SLOTS: "4" });
    expect(state(r.json.run).condition).toBe("passed");
    const want = String(Math.floor(cores / 4));
    expect(readFileSync(join(fakeLog, "env"), "utf8")).toContain(`ALEPH_TEST_PARALLEL=${want}\n`);
    expect(readFileSync(join(base, "slotfac.log.env"), "utf8").trim()).toBe(want);
  }, 60_000);
});
