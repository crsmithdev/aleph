// Archived goal tests from jobs/lib/firefighter.land.test.ts: `bun run accept` runs them, `bun run test` does not.
// The firefighter's drop on a repo with an origin: the fate it writes. Lands of held runs are the director's (director.accept.ts).
import { expect, test } from "bun:test";
import { join } from "node:path";
import { firefighterStep } from "../../../jobs/lib/factory.ts";
import { defaultPorts } from "../../../jobs/lib/firefighter.ts";
import { readRun } from "../../../jobs/lib/ledger.ts";
import { base, fresh, key, n, reply, repoPath, run, sh, useFirefighterFixture } from "../../../jobs/lib/firefighter.fixture.ts";

useFirefighterFixture();

test("a firefighter drop of a run whose goal another job landed writes fate duplicate when the reply names none", async () => {
  fresh([{ title: "dup", goal: true }]);
  const name = `${key}-1`;
  const remote = join(base, `remote-dup${n}.git`);
  sh(base, "git", "init", "-q", "--bare", "-b", "main", remote);
  Bun.spawnSync(["git", "remote", "remove", "origin"], { cwd: repoPath() });
  sh(repoPath(), "git", "remote", "add", "origin", remote);
  sh(repoPath(), "git", "commit", "-q", "--allow-empty", "-m", `the work, by another goal\n\nJob: other-job\nIssue: ${key}-2`);
  sh(repoPath(), "git", "push", "-q", "origin", "main");
  sh(repoPath(), "git", "fetch", "-q", "origin");
  const folder = run({ name, job: name, condition: "stuck", reason: "no commit", on: name }, {}, 2);
  reply([{ do: "drop", job: name, reason: `${key}-2 did this work` }]);
  const f = await firefighterStep(defaultPorts);
  expect(f?.applied).toEqual([`drop ${name}: ${key}-2 did this work`]);
  expect(readRun(folder)!.fate).toBe("duplicate");
});

test("a firefighter drop of a run whose goal's own Issue commit is on main writes already-met, not duplicate", async () => {
  fresh([{ title: "met", goal: true }]);
  const name = `${key}-1`;
  const remote = join(base, `remote-own${n}.git`);
  sh(base, "git", "init", "-q", "--bare", "-b", "main", remote);
  Bun.spawnSync(["git", "remote", "remove", "origin"], { cwd: repoPath() });
  sh(repoPath(), "git", "remote", "add", "origin", remote);
  sh(repoPath(), "git", "commit", "-q", "--allow-empty", "-m", `the goal, by an earlier job\n\nJob: other-job\nIssue: ${name}`);
  sh(repoPath(), "git", "push", "-q", "origin", "main");
  sh(repoPath(), "git", "fetch", "-q", "origin");
  const folder = run({ name, job: name, condition: "stuck", reason: "no commit", on: name }, {}, 2);
  reply([{ do: "drop", job: name, reason: "nothing left to do" }]);
  await firefighterStep(defaultPorts);
  expect(readRun(folder)!.fate).toBe("already-met");
});
