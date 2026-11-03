// reacceptReopened: a goal that acceptance reopened is run again and closed on a pass.
import { expect, test } from "bun:test";
import { writeList } from "../../todo/lib/store.ts";
import * as issues from "../../todo/lib/todo.ts";
import { reacceptReopened } from "./factory.ts";
import { item, land, notes, ran, reopened, runner, useAcceptanceFixture } from "./acceptance.fixture.ts";

useAcceptanceFixture();

test("reacceptReopened closes the goal whose Oracle passes and leaves the failing one open with a note", async () => {
  const good = reopened("`bun test good`");
  const bad = reopened("`bun test bad`");
  const lines = await reacceptReopened("fac", { run: async (_r, _s, c) => (c.includes("bad") ? { code: 1, output: "boom" } : { code: 0, output: "" }) });
  expect(lines.length).toBe(2);
  expect(issues.status(item(good))).toBe("done");
  expect(notes(good)).toContain("`bun test good` exited 0");
  expect(issues.status(item(bad))).toBe("open");
  expect(notes(bad)).toContain("re-accept: fail");
  expect(notes(bad)).toContain("`bun test bad` exited 1: boom");
  // a second pass does not run the failed goal again
  expect(await reacceptReopened("fac", { run: runner(0) })).toEqual([]);
});

test("reacceptReopened leaves the goal open after an infra error, notes the tail, and retries next time", async () => {
  const id = reopened("`bun test x`");
  await reacceptReopened("fac", { run: async () => ({ code: 1, output: "bundle failed: nope", infra: true }) });
  expect(issues.status(item(id))).toBe("open");
  expect(notes(id)).toContain("re-accept: not run");
  expect(notes(id)).toContain("bundle failed: nope");
  await reacceptReopened("fac", { run: runner(0) });
  expect(issues.status(item(id))).toBe("done");
});

test("reacceptReopened skips goals not landed, not reopened by acceptance, or outside the window", async () => {
  const unlanded = writeList({ key: "fac" }, "add", (doc) => { const i = issues.add(doc, "t", { spec: "## Oracle\n`bun test x`" }); issues.note(i, "acceptance: fail at abc1234: x"); return i.id; }, true)!.value;
  const plain = writeList({ key: "fac" }, "add", (doc) => { const i = issues.add(doc, "t", { spec: "## Oracle\n`bun test x`" }); return i.id; })!.value;
  land(plain);
  const old = reopened("`bun test x`");
  expect(await reacceptReopened("fac", { run: runner(0), since: "2999-01-01T00:00" })).toEqual([]);
  expect(await reacceptReopened("fac", { run: runner(0), before: "2000-01-01T00:00" })).toEqual([]);
  expect(ran).toEqual([]);
  const lines = await reacceptReopened("fac", { run: runner(0) });
  expect(lines.length).toBe(1);
  expect(issues.status(item(old))).toBe("done");
  expect(issues.status(item(unlanded))).toBe("open");
  expect(issues.status(item(plain))).toBe("open");
});
