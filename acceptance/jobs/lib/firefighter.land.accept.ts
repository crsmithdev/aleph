// Archived goal tests from jobs/lib/firefighter.land.test.ts: `bun run accept` runs them, `bun run test` does not.
// The firefighter's land and drop of a held run: the security paths, the land standing, and a real land and drop on a repo with an origin.
import { expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { firefighterStep } from "../../../jobs/lib/factory.ts";
import { defaultPorts } from "../../../jobs/lib/firefighter.ts";
import { readRun } from "../../../jobs/lib/ledger.ts";
import { asked, base, branch, calls, fresh, held, item, key, landed, log, n, ports, reply, repoPath, run, sh, told, useFirefighterFixture } from "../../../jobs/lib/firefighter.fixture.ts";

useFirefighterFixture();

test("a new held run whose reviews both say land, off the security paths, is landed", async () => {
  fresh([{ title: "held", goal: true }]);
  branch(`b${n}`, "ui/views/x.js");
  held(`b${n}`);
  reply([{ do: "land", job: `${key}-1` }]);
  const f = await firefighterStep(ports());
  expect(calls()).toBe(1);
  expect(landed).toEqual([`${key}-1`]);
  expect(f?.applied).toEqual([`land ${key}-1`]);
  expect(told).toEqual([]);
  expect(log()).toContain(`firefighter: did land ${key}-1`);
  // The prompt carries the run's review files and the issue.
  const p = readFileSync(join(base, "prompt.md"), "utf8");
  expect(p).toContain("VERDICT: land");
  expect(p).toContain(`Issue ${key}-1: held`);
});

test("a land by the firefighter writes Held-by: firefighter, not Held-by: Chris", async () => {
  fresh([{ title: "held", goal: true }]);
  // A real remote for the land to push to, and a stand-in for srt; the land unit runs in the foreground.
  writeFileSync(join(base, "repos.json"), JSON.stringify({ [key]: { path: repoPath(), sandbox: true, autoland: false, checks: [] } }));
  writeFileSync(join(base, "pass"), "#!/bin/bash\nshift\nexec env -i \"$@\"\n", { mode: 0o755 });
  process.env.ALEPH_SANDBOX_CMD = join(base, "pass");
  const remote = join(base, `remote${n}.git`);
  sh(base, "git", "init", "-q", "--bare", "-b", "main", remote);
  sh(repoPath(), "git", "remote", "add", "origin", remote);
  sh(repoPath(), "git", "push", "-q", "origin", "main");
  branch(`b${n}`, "ui/views/x.js");
  held(`b${n}`);
  reply([{ do: "land", job: `${key}-1` }]);
  process.env.ALEPH_JOB_FOREGROUND = "1";
  try {
    const f = await firefighterStep(defaultPorts);
    expect(f?.applied).toEqual([`land ${key}-1`]);
  } finally {
    delete process.env.ALEPH_JOB_FOREGROUND;
    delete process.env.ALEPH_SANDBOX_CMD;
  }
  const trailers = sh(base, "git", "--git-dir", remote, "log", "-1", "--format=%(trailers:only)", "main");
  expect(trailers).toContain("Held-by: firefighter");
  expect(trailers).not.toContain("Held-by: Chris");
});

test("the same run with a diff in jobs/lib/sandbox.ts is not landed: an Ask of approval and one tell", async () => {
  fresh([{ title: "held", goal: true }]);
  branch(`b${n}`, "jobs/lib/sandbox.ts");
  const folder = held(`b${n}`);
  reply([{ do: "land", job: `${key}-1` }]);
  const f = await firefighterStep(ports());
  expect(landed).toEqual([]);
  expect(f?.chris.length).toBe(1);
  expect(asked(1)).toMatchObject({ kind: "approval", reason: "held-path" });
  expect(item(1).notes.at(-1)).toContain("jobs/lib/sandbox.ts");
  expect(existsSync(join(folder, "asked"))).toBe(true);
  expect(told.length).toBe(1);
  expect(JSON.parse(told[0]).text).toContain("needs your review");
});

test("a land before the review has a verdict is refused", async () => {
  fresh([{ title: "held", goal: true }]);
  branch(`b${n}`, "ui/views/y.js");
  held(`b${n}`, "PENDING\n");
  reply([{ do: "land", job: `${key}-1` }]);
  const f = await firefighterStep(ports());
  expect(landed).toEqual([]);
  expect(f?.refused).toEqual([expect.stringContaining("review has no verdict yet")]);
  expect(log()).toContain("firefighter: tell: refused land");
  expect(told).toEqual([]);
});

test("the same held hooks/ run without a land standing goes to Chris", async () => {
  fresh([{ title: "held", goal: true }]);
  branch(`b${n}`, "hooks/x.ts");
  const folder = held(`b${n}`);
  reply([{ do: "land", job: `${key}-1` }]);
  const f = await firefighterStep(ports());
  expect(landed).toEqual([]);
  expect(f?.chris.length).toBe(1);
  expect(existsSync(join(folder, "asked"))).toBe(true);
  expect(log()).not.toContain("always: firefighter: land");
});

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
