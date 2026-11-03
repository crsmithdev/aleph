// Acceptance reruns: the retest wait, a filter that matches no test, a failure that names no test, and an error on the rerun.
import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import * as issues from "../../todo/lib/todo.ts";
import { rerunOf } from "./acceptance.ts";
import { readRecord } from "./status.ts";
import { acceptanceStep } from "./factory.ts";
import { answers, base, doneGoal, FAILED, flakeNotes, item, landFile, notes, ran, RERUN_FAIL, runner, useAcceptanceFixture } from "./acceptance.fixture.ts";

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

test("a failure pinned to the wrong file does not reopen the goal when the original command passes", async () => {
  const id = doneGoal("`bun run test`");
  landFile(id, "jobs/lib/acceptance.test.ts");
  const none = { code: 1, output: 'bun test\nerror: regex "^one$" matched 0 tests. Searched 1 file\n' };
  await acceptanceStep(answers(RERUN_FAIL, none, { code: 0, output: " 1 pass\n 0 fail\n" }));
  expect(ran[1]).toContain("-t");
  expect(ran[2]).toBe("bun run test");
  expect(issues.status(item(id))).toBe("done");
  expect(readRecord("fac", id)?.result).toBe("pass");
  expect(notes(id)).not.toContain("acceptance: fail");
});

test("real bun test reports a filter that matches nothing as 'matched 0 tests'", () => {
  writeFileSync(join(base, "n.test.ts"), `import { test } from "bun:test";\ntest("one", () => {});\n`);
  const p = Bun.spawnSync(["bash", "-c", rerunOf("x", [{ file: "n.test.ts", name: "missing" }])], { cwd: base, stdout: "pipe", stderr: "pipe" });
  expect(p.exitCode).not.toBe(0);
  expect(p.stderr.toString() + p.stdout.toString()).toContain("matched 0 tests");
});

test("a failure that names no test reopens only if the command fails again", async () => {
  const id = doneGoal("`bunx tsc`");
  await acceptanceStep(answers({ code: 2, output: "a.ts(1,1): error" }, { code: 0, output: "" }));
  expect(ran).toEqual(["bunx tsc", "bunx tsc"]);
  expect(issues.status(item(id))).toBe("done");
  expect(flakeNotes()).toContain("`bunx tsc`: failed under load");
  const id2 = doneGoal("`bunx tsc`");
  await acceptanceStep(runner(2, "a.ts(1,1): error"));
  expect(issues.status(item(id2))).toBe("open");
});

test("an infra error on the rerun keeps the failure waiting and reopens nothing", async () => {
  const id = doneGoal("`bun run test`");
  const lines = await acceptanceStep(answers({ code: 1, output: FAILED }, { code: 1, output: "bun install: ConnectionRefused", infra: true }));
  expect(lines[0]).toContain("acceptance not run");
  expect(issues.status(item(id))).toBe("done");
  expect(readRecord("fac", id)?.retest?.command).toBe("bun run test");
  await acceptanceStep(answers({ code: 0, output: "" }));
  expect(readRecord("fac", id)?.result).toBe("pass");
});
