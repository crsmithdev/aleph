// The dispatch's order and baseline: one start per issue, the live cap, intake order for an issue to plan, a green baseline, and parents closed on a red or held baseline.
import { putJson } from "../../../lib/db.ts";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { writeList } from "../../../lib/store.ts";
import * as issues from "../../../lib/todo.ts";
import { addPart } from "../../../issues/lib/parts.testkit.ts";
import { readList } from "../../../lib/store.ts";
import { ctx, fakes, withChecks, setup, teardown } from "./factory.testkit.ts";
import { baselineConfig } from "./baseline.ts";
import { loadRegistry } from "../records/ledger.ts";

beforeEach(setup);
afterEach(teardown);


const redBaseline = () => {
  const commit = Bun.spawnSync(["git", "rev-parse", "origin/main"], { cwd: join(ctx.base, "repo") }).stdout.toString().trim();
  putJson("state", "baseline", { fac: { repo: "fac", commit, config: baselineConfig(loadRegistry().fac!), ok: false, failed: "x" } });
  return commit;
};
const doneParent = (): number => writeList({ key: "fac" }, "add", (doc) => {
  const i = issues.add(doc, "parent");
  issues.setStatus(addPart(doc, i, { title: "g", spec: "Do it." }), "done");
  return i.id;
}, true)!.value;
const parentStatus = (id: number) => issues.status(readList({ key: "fac" })!.items.find((i) => i.id === id)!);

test("a parent stays open while a child from it is open, and closes in the dispatch after its last child is done", async () => {
  redBaseline();
  const { id, last } = writeList({ key: "fac" }, "add", (doc) => {
    const i = issues.add(doc, "parent");
    issues.setStatus(issues.add(doc, "first", { spec: "Do it.", from: "issue.1" }), "done");
    return { id: i.id, last: issues.add(doc, "second", { spec: "Do it.", from: "issue.1", after: ["issue.2"] }).id };
  }, true)!.value;
  const f = fakes();
  await withChecks(f, async () => { throw new Error("no baseline run"); });
  expect(parentStatus(id)).toBe("open");
  writeList({ key: "fac" }, "done", (doc) => { issues.setStatus(issues.find(doc, last)!, "done"); return true; });
  await withChecks(f, async () => { throw new Error("no baseline run"); });
  expect(parentStatus(id)).toBe("done");
  expect(readList({ key: "fac" })!.items.find((i) => i.id === id)!.fm.closed_why).toContain("fac-2 (no commit), fac-3 (no commit)");
});

test("a parent whose parts are all done closes in a dispatch where main's baseline is red", async () => {
  redBaseline();
  const id = doneParent();
  const f = fakes();
  await withChecks(f, async () => { throw new Error("no baseline run"); });
  expect(parentStatus(id)).toBe("done");
});
