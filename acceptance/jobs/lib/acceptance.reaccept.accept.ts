// Archived goal tests from jobs/lib/acceptance.reaccept.test.ts: `bun run accept` runs them, `bun run test` does not.
// reacceptReopened: a goal that acceptance reopened is run again and closed on a pass.
import { expect, test } from "bun:test";
import { writeList } from "../../../todo/lib/store.ts";
import * as issues from "../../../todo/lib/todo.ts";
import { reaccept } from "../../../jobs/lib/acceptance.ts";
import { reacceptReopened } from "../../../jobs/lib/factory.ts";
import { item, ran, reopened, repoDir, runner, useAcceptanceFixture } from "../../../jobs/lib/acceptance.fixture.ts";

useAcceptanceFixture();

test("a parked issue is not reopened by acceptance", async () => {
  const id = reopened("`bun test x`");
  writeList({ key: "fac" }, "park", (doc) => { issues.setStatus(issues.find(doc, id)!, "parked"); return true; });
  expect(await reacceptReopened("fac", { run: runner(0) })).toEqual([]);
  expect(ran).toEqual([]);
  expect(issues.status(item(id))).toBe("parked");
  const repo = { key: "fac", path: repoDir(), main: "main" } as any;
  expect(await reaccept(repo, item(id), runner(0))).toContain("skipped");
  expect(ran).toEqual([]);
  expect(issues.status(item(id))).toBe("parked");
});
