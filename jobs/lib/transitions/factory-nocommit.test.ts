import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test";
import { join } from "node:path";
import { readList } from "../../../issues/lib/store.ts";
import * as issues from "../../../issues/lib/todo.ts";
import { ctx, sh, newIssue, mk, notes, ask, fakes, dispatch, setup, teardown } from "./factory.helpers.ts";
import { clearAsk } from "../asks/ask.ts";

// The test's clock: the run cap's hour, the streak and the notes read it.
const NOW = Date.parse("2026-11-04T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
beforeEach(() => { setSystemTime(NOW); setup(); });
afterEach(() => { setSystemTime(); teardown(); });

test("no commit, the item on main by its Item trailer: the open item is closed with a note naming the commit", async () => {
  const id = newIssue();
  mk(`fac-${id}`, "build", "failed", { reason: "no commit" });
  sh(join(ctx.base, "repo"), "git", "commit", "-q", "--allow-empty", "-m", `the work\n\nIssue: fac-${id}\nJob: other`);
  sh(join(ctx.base, "repo"), "git", "push", "-q", "origin", "main");
  const sha = Bun.spawnSync(["git", "rev-parse", "--short=7", "HEAD"], { cwd: join(ctx.base, "repo") }).stdout.toString().trim();
  const f = fakes();
  await dispatch(f);
  expect(f.calls).toEqual([`drop fac-${id}`]);
  expect(notes(id)).toContain(`on main as ${sha}: dropped as a duplicate`);
  expect(issues.status(readList({ key: "fac" })!.items.find((i) => i.id === id)!)).toBe("done");
  expect(f.specs).toEqual([]);
});

test("a fourth no-commit run in a row is not dispatched; the item gets an Ask", async () => {
  const id = newIssue();
  for (let i = 0; i < 3; i++) mk(`fac-${id}`, "build", "dropped", { reason: "no commit, run X ended with no commit: dropped as a duplicate", noCommit: true, started: ago((4 - i) * 60_000) });
  const f = fakes();
  const out = await dispatch(f);
  expect(out.started).toEqual([]);
  expect(out.skipped.join()).toContain("3 runs in a row with no commit");
  expect(ask(id)).not.toBeNull();
  expect(notes(id)).toContain("ended with no commit");
  expect(ask(id)?.reason).toBe("no-commit");
  await dispatch(f);
  expect(f.specs).toEqual([]);
});

const noCommitRuns = (id: number, n: number, back: number) => {
  for (let i = 0; i < n; i++) mk(`fac-${id}`, "build", "dropped", { reason: "run X ended with no commit: dropped", noCommit: true, started: ago((back - i) * 1000) });
};
const unlabel = async (id: number) => clearAsk(`fac-${id}`);
const chrisNotes = (id: number) => notes(id).split("asks Chris:").length - 1;

test("answering the Ask restarts the no-commit streak; three more no-commit runs give it another Ask", async () => {
  const id = newIssue();
  // Two hours back: outside the run cap's hour, so only the streak holds the issue.
  noCommitRuns(id, 3, 7200);
  const f = fakes();
  expect((await dispatch(f)).started).toEqual([]);
  expect(ask(id)).not.toBeNull();
  // The clock is the test's: each step moves it a second, so the Ask's answer comes after the runs before it.
  setSystemTime(NOW + 1000);
  await unlabel(id);
  expect((await dispatch(f)).started).toEqual([`fac-${id}`]);
  // the started run is not a no-commit run; three more finish after the mark
  setSystemTime(NOW + 2000);
  noCommitRuns(id, 3, 0);
  const g = fakes();
  expect((await dispatch(g)).started).toEqual([]);
  expect(g.specs).toEqual([]);
  expect(ask(id)).not.toBeNull();
  expect(chrisNotes(id)).toBe(2);
});

test("while the Ask stays on the item, dispatches start nothing and write one note", async () => {
  const id = newIssue();
  noCommitRuns(id, 3, 600);
  const f = fakes();
  await dispatch(f);
  await dispatch(f);
  expect(f.specs).toEqual([]);
  expect(ask(id)).not.toBeNull();
  expect(chrisNotes(id)).toBe(1);
});

// The run cap: a fourth agent run of an issue in 60 minutes is not started; one Ask note says so.
const RUN_CAP_NOTE = "the factory started this goal 3 times in the last hour; it stops starting it until Chris reruns it";
test("a fourth start in an hour is skipped with one Ask note, and the issue is not started", async () => {
  const id = newIssue();
  for (let i = 0; i < 3; i++) mk(`fac-${id}`, "build", "dropped", { reason: "time box", started: ago((i + 1) * 60_000) });
  const f = fakes();
  const out = await dispatch(f);
  expect(out.started).toEqual([]);
  expect(out.skipped.join()).toContain("3 runs in the last hour");
  expect(f.specs).toEqual([]);
  expect(ask(id)).not.toBeNull();
  expect(notes(id)).toContain(RUN_CAP_NOTE);
  await dispatch(f);
  await dispatch(f);
  expect(f.specs).toEqual([]);
  expect(notes(id).split("asks Chris:").length - 1).toBe(1);
});

