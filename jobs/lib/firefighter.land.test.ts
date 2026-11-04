// The firefighter's drop on a repo with an origin: the fate it writes.
import { expect, test } from "bun:test";
import { join } from "node:path";
import { firefighterStep } from "./factory.ts";
import { defaultPorts } from "./firefighter.ts";
import { readRun } from "./ledger.ts";
import { base, fresh, key, n, reply, repoPath, run, sh, useFirefighterFixture } from "./firefighter.fixture.ts";

useFirefighterFixture();

test("a firefighter drop of a run whose goal is on main writes fate already-met to the run's state", async () => {
  fresh([{ title: "met", goal: true }]);
  const name = `${key}-1`;
  const remote = join(base, `remote-met${n}.git`);
  sh(base, "git", "init", "-q", "--bare", "-b", "main", remote);
  Bun.spawnSync(["git", "remote", "remove", "origin"], { cwd: repoPath() });
  sh(repoPath(), "git", "remote", "add", "origin", remote);
  sh(repoPath(), "git", "commit", "-q", "--allow-empty", "-m", `the goal\n\nJob: ${name}`);
  sh(repoPath(), "git", "push", "-q", "origin", "main");
  sh(repoPath(), "git", "fetch", "-q", "origin");
  const folder = run({ name, job: name, condition: "stuck", reason: "no commit", on: name }, {}, 2);
  reply([{ do: "drop", job: name, reason: "the goal is already met on main" }]);
  const f = await firefighterStep(defaultPorts);
  expect(f?.applied).toEqual([`drop ${name}: the goal is already met on main`]);
  const state = readRun(folder)!;
  expect(state.condition).toBe("dropped");
  expect(state.fate).toBe("already-met");
});
