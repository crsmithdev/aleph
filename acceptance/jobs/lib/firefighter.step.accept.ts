import { beforeAll, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { firefighterStep } from "../../../jobs/lib/factory.ts";
import { snapshot } from "../../../jobs/lib/firefighter.ts";
import { readRun } from "../../../jobs/lib/ledger.ts";
import { calls, dropped, firefighterRuns, fresh, key, ports, reply, repoPath, run, sh, useFirefighterFixture } from "../../../jobs/lib/firefighter.fixture.ts";

useFirefighterFixture();
// The repo has an origin/main, as the earlier land test left it when these tests shared one file. With no origin/main,
// `git log origin/main` fails, and the drop reads its error text as a Job commit on main: the fate becomes already-met.
beforeAll(() => { sh(repoPath(), "git", "update-ref", "refs/remotes/origin/main", "HEAD"); });

test("a tick with no new events starts no firefighter run", async () => {
  fresh([{ title: "a" }]);
  expect(await firefighterStep(ports())).toMatchObject({ events: [] });
  expect(calls()).toBe(0);
  expect(firefighterRuns()).toEqual([]);
  // An event is judged once: the next tick with the same snapshot starts nothing.
  run({ name: `${key}-1`, condition: "stuck", reason: "time box", on: `${key}-1` });
  await firefighterStep(ports());
  expect(calls()).toBe(1);
  await firefighterStep(ports());
  expect(calls()).toBe(1);
  expect(firefighterRuns().length).toBe(1);
  expect(readRun(join(process.env.ALEPH_JOBS_DIR!, firefighterRuns()[0]))).toMatchObject({ kind: "firefighter", condition: "done", model: "claude-opus-5-5" });
});

test("three runs in 30 minutes are no loop", () => {
  fresh();
  for (const m of [25, 18]) run({ name: `${key}-1`, condition: "dropped", reason: "no commit" }, {}, m);
  run({ name: `${key}-1`, condition: "dropped", reason: "no commit" }, {}, 5);
  expect(snapshot().map((e) => e.kind)).not.toContain("loop");
});

test("a paused factory takes no snapshot and starts no run", async () => {
  fresh();
  run({ name: `${key}-1`, condition: "stuck", reason: "time box" });
  mkdirSync(process.env.ALEPH_FACTORY_DIR!, { recursive: true });
  writeFileSync(join(process.env.ALEPH_FACTORY_DIR!, "paused"), "x\n");
  expect(await firefighterStep(ports())).toBeNull();
  expect(calls()).toBe(0);
});

test("an applied drop passes its fate to the drop port", async () => {
  fresh([{ title: "met", goal: true }]);
  const name = `${key}-1`;
  run({ name, condition: "stuck", reason: "no commit", on: `${key}-1` }, {}, 2);
  reply([{ do: "drop", job: name, reason: "another goal did it", fate: "duplicate" }]);
  await firefighterStep(ports());
  expect(dropped.at(-1)?.fate).toBe("duplicate");
});

test("a close action drops the open job with already-met", async () => {
  fresh([{ title: "met", goal: true }]);
  const name = `${key}-1`;
  run({ name, condition: "stuck", reason: "no commit", on: `${key}-1` }, {}, 2);
  reply([{ do: "close", repo: key, n: 1, note: "met on main" }]);
  await firefighterStep(ports());
  expect(dropped.map((d) => d.fate)).toEqual(["already-met"]);
});
