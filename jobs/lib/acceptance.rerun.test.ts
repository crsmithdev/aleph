// Acceptance reruns a failed test: a pass on the rerun is a flake; a repeat in a test the goal touched reopens the goal.
import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import * as issues from "../../todo/lib/todo.ts";
import { rerunOf } from "./acceptance.ts";
import { readRecord, resultLine } from "./status.ts";
import { acceptanceStep } from "./factory.ts";
import { answers, base, doneGoal, FAILED, flakeNotes, item, landFile, notes, ran, repoDir, runner, sh, shas, useAcceptanceFixture } from "./acceptance.fixture.ts";

useAcceptanceFixture();

test("rerunOf's command runs only the named test under real bun test", () => {
  writeFileSync(join(base, "n.test.ts"), `import { describe, test } from "bun:test";\ndescribe("outer (x)", () => { test("one", () => {}); test("one more", () => {}); });\ntest("other", () => {});\n`);
  const p = Bun.spawnSync(["bash", "-c", rerunOf("x", [{ file: "n.test.ts", name: "outer (x) > one" }])], { cwd: base, stdout: "pipe", stderr: "pipe" });
  const out = p.stderr.toString() + p.stdout.toString();
  expect(out).toContain("1 pass");
  expect(out).toContain("2 filtered out");
});

test("a failure that passes on the rerun keeps the goal done, passes it, and notes the flake", async () => {
  const id = doneGoal("`bun run test`");
  landFile(id, "jobs/lib/acceptance.test.ts");
  const lines = await acceptanceStep(answers({ code: 1, output: FAILED }, { code: 0, output: " 2 pass\n 0 fail\n" }));
  expect(ran[1]).toContain("bun test --timeout=30000 ./jobs/lib/acceptance.test.ts ./b.test.ts -t");
  expect(lines[0]).toContain("acceptance passed");
  expect(issues.status(item(id))).toBe("done");
  expect(readRecord("fac", id)?.result).toBe("pass");
  expect(flakeNotes()).toContain("b.test.ts > two: failed under load, passed on the quiet rerun");
});

test("on a busy machine the rerun waits, and then runs on the commit that failed even if main moved", async () => {
  const id = doneGoal("`bun run test` `bun run ok`");
  const failedAt = sh(repoDir(), "git", "rev-parse", "origin/main");
  process.env.ALEPH_QUIET_LOAD = "-1";
  const lines = await acceptanceStep(answers({ code: 1, output: FAILED }));
  expect(lines[0]).toContain("the rerun waits for a quiet machine");
  expect(issues.status(item(id))).toBe("done");
  expect(notes(id)).not.toContain("acceptance: fail");
  expect(resultLine("fac", id)).toBe("acceptance: fail, waits for a rerun: bun run test");
  ran.length = 0;
  expect((await acceptanceStep(runner(0)))[0]).toContain("waits for a quiet machine");
  expect(ran).toEqual([]);
  sh(repoDir(), "git", "commit", "-q", "--allow-empty", "-m", "later");
  sh(repoDir(), "git", "push", "-q", "origin", "main");
  process.env.ALEPH_QUIET_LOAD = "100000";
  await acceptanceStep(answers({ code: 0, output: "" }));
  // The rerun (three times: the goal touches every test) and the Oracle command after it, and not the command that came before.
  expect(ran.slice(0, 3).every((c) => c.includes("-t"))).toBe(true);
  expect(ran[3]).toBe("bun run ok");
  expect(new Set(shas)).toEqual(new Set([failedAt]));
  expect(readRecord("fac", id)?.result).toBe("pass");
});

test("a repeat in a test the goal touched reopens; a repeat only in others goes to the flake list", async () => {
  const mine = doneGoal("`bun run test`");
  landFile(mine, "jobs/lib/acceptance.test.ts");
  await acceptanceStep(runner(1, FAILED));
  expect(issues.status(item(mine))).toBe("open");
  expect(notes(mine)).toContain("acceptance: fail at");
  expect(notes(mine)).toContain("(fail) jobs/lib/acceptance.test.ts > outer (x) > one");
  // The other failure of that run did not touch this goal's files.
  expect(flakeNotes()).toContain("b.test.ts > two: failed twice");
  const other = doneGoal("`bun run test`");
  landFile(other, "c.ts");
  const lines = await acceptanceStep(runner(1, FAILED));
  expect(lines.find((l) => l.startsWith(`fac-${other}:`))).toContain("acceptance passed");
  expect(issues.status(item(other))).toBe("done");
  expect(notes(other)).toContain("on the flake list");
});
