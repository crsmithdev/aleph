// The dispatch's order and baseline: one start per goal, the live cap, intake order for an issue to plan, a green baseline, and parents closed on a red or held baseline.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeList } from "../../../issues/lib/store.ts";
import * as issues from "../../../issues/lib/todo.ts";
import { readList } from "../../../issues/lib/store.ts";
import { ctx, fakes, withChecks, setup, teardown } from "./factory.helpers.ts";
import { baselineConfig } from "./factory.ts";
import { loadRegistry } from "../records/ledger.ts";

beforeEach(setup);
afterEach(teardown);


const redBaseline = () => {
  const commit = Bun.spawnSync(["git", "rev-parse", "origin/main"], { cwd: join(ctx.base, "repo") }).stdout.toString().trim();
  mkdirSync(join(ctx.base, "factory"), { recursive: true });
  writeFileSync(join(ctx.base, "factory", "baseline.json"), JSON.stringify({ fac: { repo: "fac", commit, config: baselineConfig(loadRegistry().fac!), ok: false, failed: "x" } }));
  return commit;
};
const doneParent = (): number => writeList({ key: "fac" }, "add", (doc) => {
  const i = issues.add(doc, "parent");
  issues.setStatus(issues.addPart(doc, i, { title: "g", spec: "Do it." }), "done");
  return i.id;
}, true)!.value;
const parentStatus = (id: number) => issues.status(readList({ key: "fac" })!.items.find((i) => i.id === id)!);

test("a parent stays open while a child from it is open, and closes in the dispatch after its last child is done", async () => {
  redBaseline();
  const { id, last } = writeList({ key: "fac" }, "add", (doc) => {
    const i = issues.add(doc, "parent");
    issues.setStatus(issues.add(doc, "first", { spec: "Do it.", from: "fac-1" }), "done");
    return { id: i.id, last: issues.add(doc, "second", { spec: "Do it.", from: "fac-1", after: ["fac-2"] }).id };
  }, true)!.value;
  const f = fakes();
  await withChecks(f, async () => { throw new Error("no baseline run"); });
  expect(parentStatus(id)).toBe("open");
  writeList({ key: "fac" }, "done", (doc) => { issues.setStatus(issues.find(doc, last)!, "done"); return true; });
  await withChecks(f, async () => { throw new Error("no baseline run"); });
  expect(parentStatus(id)).toBe("done");
  expect(readList({ key: "fac" })!.items.find((i) => i.id === id)!.notes.at(-1)).toContain("fac-2 (no commit), fac-3 (no commit)");
});

test("a parent whose parts are all done closes in a dispatch where main's baseline is red", async () => {
  redBaseline();
  const id = doneParent();
  const f = fakes();
  await withChecks(f, async () => { throw new Error("no baseline run"); });
  expect(parentStatus(id)).toBe("done");
});
