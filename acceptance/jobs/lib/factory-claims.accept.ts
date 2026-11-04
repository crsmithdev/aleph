// Archived goal tests from jobs/lib/factory-claims.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readList } from "../../../todo/lib/store.ts";
import * as verbs from "../../../todo/lib/issues.ts";
import * as issues from "../../../todo/lib/todo.ts";
import { dispatchIssues } from "../../../jobs/lib/factory.ts";
import { readRun, allRuns, lock } from "../../../jobs/lib/ledger.ts";
import { ctx, sh, goal, mk, lines, notes, ask, fakes, dispatch, claimed, withChecks, setup, teardown } from "../../../jobs/lib/factory.helpers.ts";
import { askOf } from "../../../jobs/lib/ask.ts";

beforeEach(setup);
afterEach(teardown);

test("no commit and the worker says the goal is already met, the checks pass on main: dropped and the item done", async () => {
  const id = goal();
  claimed(`fac-${id}`, "Looked.\nGoal: Already met — timeline.ts uses itemTimes\n");
  const f = fakes();
  await withChecks(f, async () => null);
  expect(f.calls).toEqual([`drop fac-${id}`]);
  expect(f.specs).toEqual([]);
  expect(issues.status(readList({ key: "fac" })!.items.find((i) => i.id === id)!)).toBe("done");
  expect(notes(id)).toContain("says the goal is already met (timeline.ts uses itemTimes), and the checks pass on origin/main");
  expect(ask(id)).toBeNull();
  expect(allRuns()[0].run.reason).toContain("the item is done");
  expect(allRuns()[0].run.fate).toBe("already-met");
});

test("no commit and the worker says the goal is already met, but main is red: dropped with the claim; the goal reruns once main is green", async () => {
  const id = goal();
  claimed(`fac-${id}`, "Goal: Already met — main has it\n");
  const f = fakes();
  // Red main holds every start, so the goal waits; the rerun is the next dispatch on green main.
  await withChecks(f, async () => ({ cause: "check" as const, checkName: "tests", reason: "tests failed" }));
  expect(f.calls).toEqual([`drop fac-${id}`]);
  expect(notes(id)).toContain("but main is red at");
  expect(allRuns()[0].run.fate).toBeUndefined();
  expect(issues.status(readList({ key: "fac" })!.items.find((i) => i.id === id)!)).toBe("open");
  expect(ask(id)).toBeNull();
  sh(join(ctx.base, "repo"), "git", "commit", "-q", "--allow-empty", "-m", "fix main");
  sh(join(ctx.base, "repo"), "git", "push", "-q", "origin", "main");
  await withChecks(f, async () => null);
  expect(f.calls).toEqual([`drop fac-${id}`, `start fac-${id}`]);
  expect(f.specs[0]).toContain("The last run said the goal is already met (main has it)");
});

test("no commit and the claim, but main cannot be checked: the run waits for the next dispatch", async () => {
  const id = goal();
  claimed(`fac-${id}`, "Goal: Already met\n");
  const f = fakes();
  await withChecks(f, async () => ({ cause: "infra" as const, reason: "checks did not start" }));
  expect(f.calls).toEqual([]);
  expect(allRuns()[0].run.condition).toBe("stuck");
  expect(issues.status(readList({ key: "fac" })!.items.find((i) => i.id === id)!)).toBe("open");
});

test("a met goal: the claim waits on an unchecked main, then the next dispatch on green main drops it and the item is done", async () => {
  const id = goal();
  claimed(`fac-${id}`, "Goal: Already met — main has it\n");
  const f = fakes();
  await withChecks(f, async () => ({ cause: "infra" as const, reason: "checks did not start" }));
  expect(f.calls).toEqual([]);
  await withChecks(f, async () => null);
  expect(f.calls).toEqual([`drop fac-${id}`]);
  expect(issues.status(readList({ key: "fac" })!.items.find((i) => i.id === id)!)).toBe("done");
  expect(ask(id)).toBeNull();
});



test("an infrastructure failure of an agent run is rechecked once; of a land, landed again once", async () => {
  const id = goal();
  sh(join(ctx.base, "repo"), "git", "branch", `factory/fac-${id}`);
  mk(`fac-${id}`, "build", "failed", { reason: "fetch failed", branch: `factory/fac-${id}` });
  const f = fakes();
  await dispatch(f);
  expect(f.calls).toEqual([`recheck fac-${id}`]);
  expect(notes(id)).toContain("failed for infrastructure (fetch failed)");
  expect(notes(id)).toContain("rechecked, once");

  const id2 = goal();
  const a = mk(`fac-${id2}`, "build", "passed", { land: true });
  mk(`fac-${id2}`, "land", "stuck", { reason: "bundle failed: no space", job: a.job });
  await dispatch(f);
  expect(f.calls).toEqual([`recheck fac-${id}`, `land fac-${id2}`]);
  expect(notes(id2)).toContain("landed again, once");
});

test("failed checks after a land merge, first time: dropped and the goal reruns once on the new main", async () => {
  const id = goal();
  const a = mk(`fac-${id}`, "build", "passed", { land: true });
  mk(`fac-${id}`, "land", "stuck", { reason: "tests failed", job: a.job }, { "checks.log": `## tests: exit 1\n${lines(30)}` });
  const f = fakes();
  await dispatch(f);
  expect(f.calls).toEqual([`drop fac-${id}`, `start fac-${id}`]);
  expect(f.specs[0]).toContain("checks failed after the land merged main");
  expect(f.specs[0]).toContain("line 30");
  expect(notes(id)).toContain("checks failed after the land merged main");
});

test("a run that is not safe gets an Ask with a question and does not hold the factory; another goal starts", async () => {
  const id = goal();
  const other = goal();
  mk(`fac-${id}`, "build", "stuck", { reason: "tests failed after 2 fix rounds" });
  const f = fakes();
  await dispatch(f);
  expect(ask(id)).not.toBeNull();
  expect(notes(id)).toContain("asks Chris: fac-");
  const stored = () => readList({ key: "fac" })!.items.find((i) => i.id === id)!;
  expect(stored().fm).toMatchObject({ ask: "input", reason: "rescue", recommended: "Rerun" });
  expect(askOf(stored())!.options.map((o) => o.label)).toEqual(["Rerun", "Another way"]);
  expect(existsSync(join(readdirSync(join(ctx.base, "jobs")).map((d) => join(ctx.base, "jobs", d))[0], "asked"))).toBe(true);
  verbs.decide({ key: "fac" }, id, "drop it");
  expect("reason" in stored().fm).toBe(false);
  expect(f.calls).toEqual([`start fac-${other}`]);
  expect(readRun(allRuns()[0].folder)!.condition).toBe("stuck");
});

test("without rescue actions a stuck run stays, and its open job keeps its goal not ready", async () => {
  const id = goal();
  mk(`fac-${id}`, "build", "stuck", { reason: "time box" });
  const out = await dispatchIssues(async () => null, async () => null, undefined, undefined, undefined, undefined, undefined, () => {});
  expect(out.skipped).toContain(`fac-${id}: its job is stuck`);
});

test("two dispatches at once rescue one stuck job once", async () => {
  const id = goal();
  const name = `fac-${id}`;
  mk(name, "build", "stuck", { reason: "time box" });
  const f = fakes();
  const slow = { ...f.rescue, drop: async (n: string, r: string) => { await Bun.sleep(300); return f.rescue.drop(n, r); } };
  await Promise.all([dispatchIssues(f.start, async () => null, f.land, slow, undefined, undefined, undefined, () => {}), dispatchIssues(f.start, async () => null, f.land, slow, undefined, undefined, undefined, () => {})]);
  expect(f.calls.filter((c) => c.startsWith("drop"))).toEqual([`drop ${name}`]);
});

test("a rescue whose lock wait runs out skips the job and does not throw", async () => {
  const id = goal();
  const name = `fac-${id}`;
  mk(name, "build", "stuck", { reason: "time box" });
  const release = (await lock(`rescue-fac-${name}`, 0))!;
  process.env.ALEPH_RESCUE_WAIT_MS = "200";
  try {
    const f = fakes();
    await dispatch(f);
    expect(f.calls).toEqual([]);
  } finally { delete process.env.ALEPH_RESCUE_WAIT_MS; release(); }
});
