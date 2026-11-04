// Archived goal tests from jobs/lib/acceptance.cap.test.ts: `bun run accept` runs them, `bun run test` does not.
// The cap of goals that fail at one commit: the goals past it stay done until a later commit.
import { expect, test } from "bun:test";
import { writeList } from "../../../todo/lib/store.ts";
import * as issues from "../../../todo/lib/todo.ts";
import { readRecord } from "../../../jobs/lib/status.ts";
import { acceptanceStep } from "../../../jobs/lib/factory.ts";
import { closeAgain, item, land, runner, useAcceptanceFixture } from "../../../jobs/lib/acceptance.fixture.ts";

useAcceptanceFixture();

test("ALEPH_ACCEPTANCE_FAIL_CAP changes the limit", async () => {
  process.env.ALEPH_ACCEPTANCE_FAIL_CAP = "2";
  try {
    const ids = [1, 2].map(() => writeList({ key: "fac" }, "add", (doc) => issues.add(doc, "thing", { spec: "## Goal\nx\n## Edit surface\na.ts\n## Oracle\n`bun run ok`\n## Time box\n40 minutes" }).id, true)!.value);
    for (const id of ids) land(id);
    for (const id of ids) closeAgain(id);
    await acceptanceStep(runner(1, "boom"));
    expect(readRecord("fac", ids[0])?.followup).toMatch(/^fac-\d+$/);
    expect(readRecord("fac", ids[1])?.followup).toBeUndefined();
    expect(issues.status(item(ids[1]))).toBe("done");
  } finally { delete process.env.ALEPH_ACCEPTANCE_FAIL_CAP; }
});
