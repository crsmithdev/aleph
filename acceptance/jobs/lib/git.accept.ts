// Archived goal tests from jobs/lib/git.test.ts: `bun run accept` runs them, `bun run test` does not.
import { expect, test } from "bun:test";
import { git } from "../../../jobs/lib/git";

test("a git call in a missing directory says which directory and that it does not exist", () => {
  expect(() => git("/nonexistent/dir", "status")).toThrow(/"\/nonexistent\/dir" and does not exist/);
});
