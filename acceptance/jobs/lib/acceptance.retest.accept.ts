// Archived goal tests from jobs/lib/acceptance.retest.test.ts: `bun run accept` runs them, `bun run test` does not.
// Acceptance reruns: the retest wait, a filter that matches no test, a failure that names no test, and an error on the rerun.
import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { rerunOf } from "../../../jobs/lib/acceptance.ts";
import { readRecord } from "../../../jobs/lib/status.ts";
import { acceptanceStep } from "../../../jobs/lib/factory.ts";
import { answers, base, doneGoal, ran, RERUN_FAIL, runner, useAcceptanceFixture } from "../../../jobs/lib/acceptance.fixture.ts";

useAcceptanceFixture();

test("a retest older than 24 hours runs on a busy machine, also when the goal is older than ACCEPTANCE_DAYS", async () => {
  const id = doneGoal("`bun run test`");
  process.env.ALEPH_QUIET_LOAD = "-1";
  const t0 = new Date();
  await acceptanceStep(answers(RERUN_FAIL), t0);
  expect(readRecord("fac", id)?.retest?.since).toBeTruthy();
  ran.length = 0;
  const soon = new Date(t0.getTime() + 3_600_000);
  expect((await acceptanceStep(runner(0), soon))[0]).toContain("waits for a quiet machine");
  expect(ran).toEqual([]);
  const later = new Date(t0.getTime() + 3 * 86_400_000);
  const lines = await acceptanceStep(runner(0), later);
  expect(lines[0]).toContain("acceptance passed");
  expect(readRecord("fac", id)?.result).toBe("pass");
});

test("real bun test reports a filter that matches nothing as 'matched 0 tests'", () => {
  writeFileSync(join(base, "n.test.ts"), `import { test } from "bun:test";\ntest("one", () => {});\n`);
  const p = Bun.spawnSync(["bash", "-c", rerunOf("x", [{ file: "n.test.ts", name: "missing" }])], { cwd: base, stdout: "pipe", stderr: "pipe" });
  expect(p.exitCode).not.toBe(0);
  expect(p.stderr.toString() + p.stdout.toString()).toContain("matched 0 tests");
});
