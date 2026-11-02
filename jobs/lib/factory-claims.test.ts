import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { askOf, readList, writeList } from "../../todo/lib/store.ts";
import * as verbs from "../../todo/lib/issues.ts";
import * as issues from "../../todo/lib/todo.ts";
import { dispatchIssues } from "./factory.ts";
import { hold, factoryDir } from "./factory-status.ts";
import { readRun, writeRun, allJobs, allRuns, lock } from "./ledger.ts";
import { ctx, sh, goal, mk, lines, notes, ask, fakes, dispatch, claimed, withChecks, setup, teardown } from "./factory.helpers.ts";

beforeEach(setup);
afterEach(teardown);

test("no commit and the worker says the goal is already met, the checks pass on main: dropped and the item done", async () => {
  const id = goal();
  claimed(`fac-${id}`, "Looked.\nGoal: Already met — timeline.ts uses itemTimes\n");
  const f = fakes();
  const out = await withChecks(f, async () => null);
  expect(f.calls).toEqual([`drop fac-${id}`]);
  expect(f.specs).toEqual([]);
  expect(out.held).toBeUndefined();
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
  await withChecks(f, async () => "tests failed");
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
  await withChecks(f, async () => "checks did not start");
  expect(f.calls).toEqual([]);
  expect(allRuns()[0].run.condition).toBe("stuck");
  expect(issues.status(readList({ key: "fac" })!.items.find((i) => i.id === id)!)).toBe("open");
});

test("a met goal: the claim waits on an unchecked main, then the next dispatch on green main drops it and the item is done", async () => {
  const id = goal();
  claimed(`fac-${id}`, "Goal: Already met — main has it\n");
  const f = fakes();
  await withChecks(f, async () => "checks did not start");
  expect(f.calls).toEqual([]);
  await withChecks(f, async () => null);
  expect(f.calls).toEqual([`drop fac-${id}`]);
  expect(issues.status(readList({ key: "fac" })!.items.find((i) => i.id === id)!)).toBe("done");
  expect(ask(id)).toBeNull();
});

for (const red of [false, true]) {
  test(`a second claimed run after one rescued as claimed, main ${red ? "red: it asks Chris" : "green: the item is done"}`, async () => {
    const id = goal();
    const first = mk(`fac-${id}`, "build", "dropped", { reason: "no commit" }, { "result.md": "Goal: Already met\n" });
    writeFileSync(join(first.folder, "rescued"), "claimed\n");
    claimed(`fac-${id}`, "Goal: Already met\n");
    const f = fakes();
    await withChecks(f, async () => (red ? "tests failed" : null));
    if (red) {
      expect(f.calls).toEqual([]);
      expect(ask(id)).not.toBeNull();
      expect(issues.status(readList({ key: "fac" })!.items.find((i) => i.id === id)!)).toBe("open");
    } else {
      expect(f.calls).toEqual([`drop fac-${id}`]);
      expect(ask(id)).toBeNull();
      expect(issues.status(readList({ key: "fac" })!.items.find((i) => i.id === id)!)).toBe("done");
    }
  });
}

test("no commit, the item open, first time: dropped and the goal reruns once, with the last 20 lines of result.md", async () => {
  const id = goal();
  mk(`fac-${id}`, "build", "stuck", { reason: "no commit" }, { "result.md": lines(30) });
  const f = fakes();
  const out = await dispatch(f);
  expect(f.calls).toEqual([`drop fac-${id}`, `start fac-${id}`]);
  expect(out.held).toBeUndefined();
  expect(f.specs[0]).toContain("made no commit");
  expect(f.specs[0]).toContain("line 11\n");
  expect(f.specs[0]).toContain("line 30");
  expect(f.specs[0]).not.toContain("line 10\n");
  expect(notes(id)).toContain("made no commit");
});

const dottedGoal = (): string => writeList({ key: "fac" }, "add a dotted goal", (doc) => issues.refOf(issues.addPart(doc, issues.add(doc, "parent"), { title: "g", spec: "Do the thing." })), true)!.value;
const dotted = (ref: string) => readList({ key: "fac" })!.items.find((i) => issues.refOf(i) === ref)!;

test("a dotted goal's rescue note reaches the goal, and a second no-commit run asks Chris on it", async () => {
  const ref = dottedGoal();
  mk(`fac-${ref}`, "build", "stuck", { reason: "no commit" });
  const f = fakes();
  await dispatch(f);
  expect(dotted(ref).notes.join("\n")).toContain("the last run made no commit");
  mk(`fac-${ref}`, "build", "stuck", { reason: "no commit" });
  await dispatch(f);
  expect(askOf(dotted(ref))).not.toBeNull();
});

test("a pass that began before a pause starts nothing after it", async () => {
  const first = goal();
  goal();
  const calls: string[] = [];
  const out = await dispatchIssues(async (_repo, name) => {
    calls.push(name);
    mkdirSync(factoryDir(), { recursive: true });
    writeFileSync(join(factoryDir(), "paused"), "");
    return null;
  }, async () => null);
  expect(calls).toEqual([`fac-${first}`]);
  expect(out.skipped.at(-1)).toEndWith(": paused");
});

test("the second no-commit run with no claim asks Chris: no drop and the issue stays open", async () => {
  const id = goal();
  mk(`fac-${id}`, "build", "stuck", { reason: "no commit" }, { "result.md": lines(3) });
  const f = fakes();
  await dispatch(f);
  expect(f.calls).toEqual([`drop fac-${id}`, `start fac-${id}`]);
  mk(`fac-${id}`, "build", "stuck", { reason: "no commit" }, { "result.md": lines(30) });
  await dispatch(f);
  expect(f.calls).toEqual([`drop fac-${id}`, `start fac-${id}`]);
  expect(ask(id)).not.toBeNull();
  expect(notes(id)).toContain("hit the same case again");
});

test("a repeated no-commit run on an issue already sent back to triage once gets an Ask", async () => {
  const id = goal();
  const f = fakes();
  mk(`fac-${id}`, "build", "stuck", { reason: "no commit" }, { "result.md": lines(3) });
  await dispatch(f);
  mk(`fac-${id}`, "build", "stuck", { reason: "no commit" }, { "result.md": lines(3) });
  await dispatch(f);
  // Triage rewrote the goal and the run ends with no commit again.
  mk(`fac-${id}`, "build", "stuck", { reason: "no commit" }, { "result.md": lines(3) });
  await dispatch(f);
  expect(ask(id)).not.toBeNull();
});

test("an infrastructure failure of an agent run is rechecked once; of a land, landed again once", async () => {
  const id = goal();
  sh(join(ctx.base, "repo"), "git", "branch", `factory/fac-${id}`);
  mk(`fac-${id}`, "build", "failed", { reason: "fetch failed", branch: `factory/fac-${id}` });
  const f = fakes();
  const out = await dispatch(f);
  expect(f.calls).toEqual([`recheck fac-${id}`]);
  expect(out.held).toBeUndefined();
  expect(notes(id)).toContain("failed for infrastructure (fetch failed)");
  expect(notes(id)).toContain("rechecked, once");

  const id2 = goal();
  const a = mk(`fac-${id2}`, "build", "passed", { land: true });
  mk(`fac-${id2}`, "land", "stuck", { reason: "bundle failed: no space", job: a.job });
  await dispatch(f);
  expect(f.calls).toEqual([`recheck fac-${id}`, `land fac-${id2}`]);
  expect(notes(id2)).toContain("landed again, once");
});

test("a second infrastructure failure of one goal gets an Ask", async () => {
  const id = goal();
  const a = mk(`fac-${id}`, "build", "passed", { land: true });
  mk(`fac-${id}`, "land", "stuck", { reason: "fetch failed", job: a.job });
  const f = fakes();
  await dispatch(f);
  expect(f.calls).toEqual([`land fac-${id}`]);
  // The land again fails the same way (the fake land started nothing, so the run still stands).
  const b = allJobs()[0];
  mk(`fac-${id}`, "land", "failed", { reason: "fetch failed", job: b[0].run.job });
  await dispatch(f);
  expect(f.calls).toEqual([`land fac-${id}`]);
  expect(ask(id)).not.toBeNull();
});

test("failed checks after a land merge, first time: dropped and the goal reruns once on the new main", async () => {
  const id = goal();
  const a = mk(`fac-${id}`, "build", "passed", { land: true });
  mk(`fac-${id}`, "land", "stuck", { reason: "tests failed", job: a.job }, { "checks.log": `## tests: exit 1\n${lines(30)}` });
  const f = fakes();
  const out = await dispatch(f);
  expect(f.calls).toEqual([`drop fac-${id}`, `start fac-${id}`]);
  expect(out.held).toBeUndefined();
  expect(f.specs[0]).toContain("checks failed after the land merged main");
  expect(f.specs[0]).toContain("line 30");
  expect(notes(id)).toContain("checks failed after the land merged main");
});

test("a land that failed with a merge conflict is dropped and the goal reruns; the second one gets an Ask", async () => {
  const id = goal();
  const a = mk(`fac-${id}`, "build", "passed", { land: true });
  mk(`fac-${id}`, "land", "failed", { reason: "merge conflict", conflicts: ["a.ts", "b.ts"], job: a.job });
  const f = fakes();
  const out = await dispatch(f);
  expect(f.calls).toEqual([`drop fac-${id}`, `start fac-${id}`]);
  expect(out.held).toBeUndefined();
  expect(f.specs[0]).toContain("merge conflict in a.ts, b.ts");
  expect(notes(id)).toContain("merge conflict in a.ts, b.ts");
  expect(ask(id)).toBeNull();

  const b = mk(`fac-${id}`, "build", "passed", { land: true });
  mk(`fac-${id}`, "land", "failed", { reason: "merge conflict", conflicts: ["a.ts"], job: b.job });
  await dispatch(f);
  expect(f.calls).toEqual([`drop fac-${id}`, `start fac-${id}`]);
  expect(ask(id)).not.toBeNull();
});

test("a run that is not safe gets an Ask with a question and does not hold the factory; another goal starts", async () => {
  const id = goal();
  const other = goal();
  mk(`fac-${id}`, "build", "stuck", { reason: "tests failed after 2 fix rounds" });
  const f = fakes();
  const out = await dispatch(f);
  expect(ask(id)).not.toBeNull();
  expect(notes(id)).toContain("asks Chris: fac-");
  const stored = () => readList({ key: "fac" })!.items.find((i) => i.id === id)!;
  expect(stored().fm).toMatchObject({ ask: "input", reason: "rescue", recommended: "Rerun" });
  expect(askOf(stored())!.options.map((o) => o.label)).toEqual(["Rerun", "Another way"]);
  expect(existsSync(join(readdirSync(join(ctx.base, "jobs")).map((d) => join(ctx.base, "jobs", d))[0], "asked"))).toBe(true);
  verbs.decide({ key: "fac" }, id, "drop it");
  expect("reason" in stored().fm).toBe(false);
  expect(out.held).toBeUndefined();
  expect(f.calls).toEqual([`start fac-${other}`]);
  expect(hold()).toBeNull();
  expect(readRun(allRuns()[0].folder)!.condition).toBe("stuck");
});

test("a standing rescue: recommended drops the unsafe stuck run, no Ask, an always: Rerun note", async () => {
  mkdirSync(join(ctx.base, "factory"), { recursive: true });
  writeFileSync(join(ctx.base, "factory", "always.json"), JSON.stringify({ rescue: { action: "recommended", at: new Date().toISOString() } }));
  const id = goal();
  mk(`fac-${id}`, "build", "stuck", { reason: "tests failed after 2 fix rounds" });
  const f = fakes();
  await dispatch(f);
  expect(f.calls).toContain(`drop fac-${id}`);
  expect(ask(id)).toBeNull();
  expect(notes(id)).toContain("always: Rerun");
  expect(readFileSync(join(ctx.base, "factory", "tick.log"), "utf8")).toContain(`always: rescue: recommended on fac-${id}`);
});

test("without rescue actions a stuck run still holds the factory", async () => {
  const id = goal();
  mk(`fac-${id}`, "build", "stuck", { reason: "time box" });
  const out = await dispatchIssues(async () => null, async () => null);
  expect(out.held).toContain("Held:");
});

test("a rescue that finds the lock taken waits, then acts once on the state it finds under the lock", async () => {
  const id = goal();
  const name = `fac-${id}`;
  const { folder } = mk(name, "build", "stuck", { reason: "weird" });
  // Dispatch A holds the lock; the stuck state B must act on appears only after A is done.
  const release = (await lock(`rescue-fac-${name}`, 0))!;
  const f = fakes();
  const b = dispatch(f);
  await Bun.sleep(300);
  expect(f.calls).toEqual([]);
  writeRun(folder, { ...readRun(folder)!, condition: "failed", reason: "time box" });
  release();
  await b;
  expect(f.calls.filter((c) => c.startsWith("drop"))).toEqual([`drop ${name}`]);
  expect(notes(id)).toContain("the time box ran out");
});

test("two dispatches at once rescue one stuck job once", async () => {
  const id = goal();
  const name = `fac-${id}`;
  mk(name, "build", "stuck", { reason: "time box" });
  const f = fakes();
  const slow = { ...f.rescue, drop: async (n: string, r: string) => { await Bun.sleep(300); return f.rescue.drop(n, r); } };
  await Promise.all([dispatchIssues(f.start, async () => null, f.land, slow), dispatchIssues(f.start, async () => null, f.land, slow)]);
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

test("a first no-commit run on an open item is dropped for a rerun and states no fate", async () => {
  const id = goal();
  mk(`fac-${id}`, "build", "stuck", { reason: "no commit" });
  const f = fakes();
  await dispatch(f);
  expect(f.calls[0]).toBe(`drop fac-${id}`);
  expect(allRuns().find((r) => r.run.condition === "dropped")!.run.fate).toBeUndefined();
});
