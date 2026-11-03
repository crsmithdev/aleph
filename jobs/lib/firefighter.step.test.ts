// The firefighter's tick: when it starts a run, loops, drops and closes, a pause, and the action limit.
import { openRun } from "./agent-run.ts";
import { beforeAll, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as issues from "../../todo/lib/todo.ts";
import { firefighterStep } from "./factory.ts";
import { snapshot } from "./firefighter.ts";
import { readRun } from "./ledger.ts";
import { dropped, fresh, item, key, plain, ports, reply, repoPath, run, sh, useFirefighterFixture } from "./firefighter.fixture.ts";

useFirefighterFixture();
// The repo has an origin/main, as the earlier land test left it when these tests shared one file. With no origin/main,
// `git log origin/main` fails, and the drop reads its error text as a Job commit on main: the fate becomes already-met.
beforeAll(() => { sh(repoPath(), "git", "update-ref", "refs/remotes/origin/main", "HEAD"); });

test("a firefighter run that a dead process left running is ended as failed by the next look", async () => {
  fresh();
  const left = openRun({ role: "firefighter", who: "firefighter", model: "m", seconds: 60, flags: [], name: "firefighter", command: "firefighter", shown: true });
  await firefighterStep(ports());
  expect(readRun(left.folder)).toMatchObject({ condition: "done", reason: "failed: its process ended before a reply" });
});

test("a goal with 4 runs in 30 minutes is an event, and a drop from the reply is applied", async () => {
  fresh([{ title: "loops", goal: true }]);
  const name = `${key}-1`;
  for (const m of [25, 18, 10]) run({ name, condition: "dropped", reason: "no commit", on: `${key}-1` }, {}, m);
  run({ name, condition: "stuck", reason: "no commit", on: `${key}-1` }, {}, 2);
  const kinds = snapshot().map((e) => e.kind);
  expect(kinds).toContain("loop");
  reply([{ do: "drop", job: name, reason: "the goal is already met on main" }]);
  const f = await firefighterStep(ports());
  expect(f?.events.some((l) => l.includes("4 runs in 30 minutes"))).toBe(true);
  expect(dropped).toEqual([{ name, reason: "the goal is already met on main" }]);
  expect(readFileSync(join(process.env.ALEPH_FACTORY_DIR!, "rerun", `${name}.md`), "utf8")).toContain("already met on main");
  expect(item(1).notes.at(-1)).toContain("firefighter: dropped");
});

test("a close reply drops the stuck job, writes no rerun file, and marks the issue done with the note", async () => {
  fresh([{ title: "met", goal: true }]);
  const name = `${key}-1`;
  run({ name, condition: "stuck", reason: "no commit", on: `${key}-1` }, {}, 2);
  reply([{ do: "close", repo: key, n: 1, note: "the goal is already met on main" }]);
  await firefighterStep(ports());
  expect(dropped.map((d) => d.name)).toEqual([name]);
  expect(existsSync(join(process.env.ALEPH_FACTORY_DIR!, "rerun", `${name}.md`))).toBe(false);
  expect(issues.status(item(1))).toBe("done");
  expect(item(1).notes.at(-1)).toContain("firefighter: closed: the goal is already met on main");
});

test("an 11th action in one reply is not applied", async () => {
  fresh([{ title: "q", ask: plain("which helper?") }]);
  reply(Array.from({ length: 11 }, (_, i) => ({ do: "note", repo: key, n: 1, text: `note ${i + 1}` })));
  const f = await firefighterStep(ports());
  expect(f?.applied.length).toBe(10);
  expect(f?.refused).toEqual([expect.stringContaining("more than 10 actions")]);
  const notes = item(1).notes.filter((x) => x.includes("firefighter: note"));
  expect(notes.length).toBe(10);
  expect(notes.some((x) => x.includes("note 11"))).toBe(false);
});
