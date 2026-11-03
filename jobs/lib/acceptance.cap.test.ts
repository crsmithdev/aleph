// The cap of goals that fail at one commit: the goals past it stay done until a later commit.
import { expect, test } from "bun:test";
import { writeList } from "../../todo/lib/store.ts";
import * as issues from "../../todo/lib/todo.ts";
import { readRecord } from "./status.ts";
import { acceptanceStep } from "./factory.ts";
import { closeAgain, item, land, repoDir, runner, sh, useAcceptanceFixture } from "./acceptance.fixture.ts";

useAcceptanceFixture();

test("the fifth goal failing at one commit does not reopen, the fourth does, and a later commit reopens as usual", async () => {
  delete process.env.ALEPH_ACCEPTANCE_FAIL_CAP;
  const ids = [1, 2, 3, 4, 5].map(() => writeList({ key: "fac" }, "add", (doc) => issues.add(doc, "thing", { spec: "## Goal\nx\n## Edit surface\na.ts\n## Oracle\n`bun run ok`\n## Time box\n40 minutes" }).id, true)!.value);
  for (const id of ids) land(id);
  for (const id of ids) closeAgain(id);
  const lines = await acceptanceStep(runner(1, "boom"));
  for (const id of ids.slice(0, 4)) expect(issues.status(item(id))).toBe("open");
  expect(readRecord("fac", ids[3])?.fails).toBe(1);
  const fifth = ids[4];
  expect(issues.status(item(fifth))).toBe("done");
  expect(readRecord("fac", fifth)?.result).toBe("fail");
  expect(readRecord("fac", fifth)?.fails).toBe(0);
  expect(readRecord("fac", fifth)?.retest).toBeUndefined();
  const cap = lines.filter((l) => l.includes("5 goals failed at"));
  expect(cap).toHaveLength(1);
  expect(cap[0]).toContain(sh(repoDir(), "git", "rev-parse", "--short=7", "origin/main"));
  // The same commit again: still held, no second cap line.
  const again = await acceptanceStep(runner(1, "boom"));
  expect(again.join("\n")).not.toContain("5 goals failed at");
  expect(again.join("\n")).toContain("held at");
  expect(again.join("\n")).toContain("held at");
  expect(issues.status(item(fifth))).toBe("done");
  expect(readRecord("fac", fifth)?.fails).toBe(0);
  // A later commit: the goal runs again and reopens as usual.
  land(fifth);
  const later = await acceptanceStep(runner(1, "boom"));
  expect(later.join("\n")).toContain("reopened for one more run");
  expect(issues.status(item(fifth))).toBe("open");
  expect(readRecord("fac", fifth)?.fails).toBe(1);
});

test("ALEPH_ACCEPTANCE_FAIL_CAP changes the limit", async () => {
  process.env.ALEPH_ACCEPTANCE_FAIL_CAP = "2";
  try {
    const ids = [1, 2].map(() => writeList({ key: "fac" }, "add", (doc) => issues.add(doc, "thing", { spec: "## Goal\nx\n## Edit surface\na.ts\n## Oracle\n`bun run ok`\n## Time box\n40 minutes" }).id, true)!.value);
    for (const id of ids) land(id);
    for (const id of ids) closeAgain(id);
    await acceptanceStep(runner(1, "boom"));
    expect(issues.status(item(ids[0]))).toBe("open");
    expect(issues.status(item(ids[1]))).toBe("done");
  } finally { delete process.env.ALEPH_ACCEPTANCE_FAIL_CAP; }
});
