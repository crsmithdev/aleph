import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readList, writeList } from "../../todo/lib/store.ts";
import * as issues from "../../todo/lib/todo.ts";
import { dispatchIssues } from "./factory.ts";
import { factoryDir } from "./factory-status.ts";
import { readRun, writeRun, allJobs, allRuns, lock } from "./ledger.ts";
import { ctx, goal, mk, lines, notes, ask, fakes, dispatch, claimed, withChecks, setup, teardown } from "./factory.helpers.ts";
import { askOf } from "./ask.ts";
import { waitFor } from "../../tests/wait.ts";

beforeEach(setup);
afterEach(teardown);

for (const red of [false, true]) {
  test(`a second claimed run after one rescued as claimed, main ${red ? "red: it asks Chris" : "green: the item is done"}`, async () => {
    const id = goal();
    const first = mk(`fac-${id}`, "build", "dropped", { reason: "no commit" }, { "result.md": "Goal: Already met\n" });
    writeFileSync(join(first.folder, "rescued"), "claimed\n");
    claimed(`fac-${id}`, "Goal: Already met\n");
    const f = fakes();
    await withChecks(f, async () => (red ? { cause: "check" as const, checkName: "tests", reason: "tests failed" } : null));
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

test("no commit, the item open, first time: dropped with no fate and the goal reruns once, with the last 20 lines of result.md", async () => {
  const id = goal();
  mk(`fac-${id}`, "build", "stuck", { reason: "no commit" }, { "result.md": lines(30) });
  const f = fakes();
  await dispatch(f);
  expect(f.calls).toEqual([`drop fac-${id}`, `start fac-${id}`]);
  expect(f.specs[0]).toContain("made no commit");
  expect(f.specs[0]).toContain("line 11\n");
  expect(f.specs[0]).toContain("line 30");
  expect(f.specs[0]).not.toContain("line 10\n");
  expect(notes(id)).toContain("made no commit");
  expect(allRuns().find((r) => r.run.condition === "dropped")!.run.fate).toBeUndefined();
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
  }, async () => null, undefined, undefined, undefined, undefined, undefined);
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

test("a land that failed with a merge conflict is dropped and the goal reruns; the second one gets an Ask", async () => {
  const id = goal();
  const a = mk(`fac-${id}`, "build", "passed", { land: true });
  mk(`fac-${id}`, "land", "failed", { reason: "merge conflict", conflicts: ["a.ts", "b.ts"], job: a.job });
  const f = fakes();
  await dispatch(f);
  expect(f.calls).toEqual([`drop fac-${id}`, `start fac-${id}`]);
  expect(f.specs[0]).toContain("merge conflict in a.ts, b.ts");
  expect(notes(id)).toContain("merge conflict in a.ts, b.ts");
  expect(ask(id)).toBeNull();

  const b = mk(`fac-${id}`, "build", "passed", { land: true });
  mk(`fac-${id}`, "land", "failed", { reason: "merge conflict", conflicts: ["a.ts"], job: b.job });
  await dispatch(f);
  expect(f.calls).toEqual([`drop fac-${id}`, `start fac-${id}`]);
  expect(ask(id)).not.toBeNull();
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

test("a rescue that finds the lock taken waits, then acts once on the state it finds under the lock", async () => {
  const id = goal();
  const name = `fac-${id}`;
  const { folder } = mk(name, "build", "stuck", { reason: "weird" });
  // Dispatch A holds the lock; the stuck state B must act on appears only after A is done.
  const release = (await lock(`rescue-fac-${name}`, 0))!;
  const f = fakes();
  const b = dispatch(f);
  // B waits on the lock: lock() makes its own `<name>.new.<pid>.<uuid>` directory before it tries the name.
  const waiting = () => readdirSync(join(ctx.base, "run", "aleph")).some((n) => n.startsWith(`rescue-fac-${name}.new.`));
  expect(await waitFor(waiting)).toBe(true);
  expect(f.calls).toEqual([]);
  writeRun(folder, { ...readRun(folder)!, condition: "failed", reason: "time box" });
  release();
  await b;
  expect(f.calls.filter((c) => c.startsWith("drop"))).toEqual([`drop ${name}`]);
  expect(notes(id)).toContain("the time box ran out");
});
