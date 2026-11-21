import { afterEach, beforeEach, expect, test } from "bun:test";
import * as issues from "../../../lib/issue-file.ts";
import { loadRegistry } from "../records/ledger.ts";
import { change, newIssue, setup, teardown } from "../transitions/factory.testkit.ts";
import { decider } from "./decider.ts";

beforeEach(setup);
afterEach(teardown);

test("guard: done reads an item that only the newer read holds", () => {
  const repo = loadRegistry().fac;
  // Each decider reads the repo's list now, before the item is filed: its read lacks the item.
  const sawOpen = decider({ fresh: true });
  const sawDone = decider({ fresh: true });
  sawOpen.stagesOf(repo);
  sawDone.stagesOf(repo);
  const id = newIssue();
  // Open in the newer read alone: not done.
  expect(sawOpen.done(`fac-${id}`)).toBe(false);
  change(id, (i) => issues.setStatus(i, "done"));
  // Done in the newer read: done.
  expect(sawDone.done(`fac-${id}`)).toBe(true);
});
