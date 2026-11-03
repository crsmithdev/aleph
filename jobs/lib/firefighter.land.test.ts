// The firefighter's land and drop of a held run: the security paths, the land standing, and a real land and drop on a repo with an origin.
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { firefighterStep } from "./factory.ts";
import { defaultPorts } from "./firefighter.ts";
import { readRun } from "./ledger.ts";
import { alwaysFile, base, branch, fresh, held, key, landed, log, n, ports, reply, repoPath, run, sh, told, useFirefighterFixture } from "./firefighter.fixture.ts";

useFirefighterFixture();

test("a diff that changes REVIEW_SANDBOX in jobs/lib/review.ts is not landed", async () => {
  fresh([{ title: "held", goal: true }]);
  branch(`b${n}`, "jobs/lib/review.ts", "export const REVIEW_SANDBOX = {};\n");
  held(`b${n}`);
  reply([{ do: "land", job: `${key}-1` }]);
  await firefighterStep(ports());
  expect(landed).toEqual([]);
  expect(told.length).toBe(1);
});

test("a firefighter land standing lets the firefighter land a held run on a security path, and logs it", async () => {
  fresh([{ title: "held", goal: true }]);
  branch(`b${n}`, "hooks/x.ts");
  const folder = held(`b${n}`);
  alwaysFile({ firefighter: { action: "land", at: "2026-10-28T00:00:00.000Z" } });
  reply([{ do: "land", job: `${key}-1` }]);
  const f = await firefighterStep(ports());
  expect(landed).toEqual([`${key}-1`]);
  expect(f?.chris).toEqual([]);
  expect(existsSync(join(folder, "asked"))).toBe(false);
  expect(told).toEqual([]);
  expect(log()).toContain("always: firefighter: land");
});

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
