// Archived goal tests from jobs/cli.issue-list.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { aleph, setup, teardown } from "../../jobs/cli.helpers";

beforeAll(setup);
afterAll(teardown);

test("issue list prints each row's priority, medium when none", async () => {
  const env = { ALEPH_DISPATCH: "off" };
  const a = await aleph(["issue", "add", "fac", "Urgent one", "--priority", "critical"], env);
  const b = await aleph(["issue", "add", "fac", "Plain one"], env);
  const r = await aleph(["issue", "list", "fac"], env);
  const rows = r.stdout.split("\n");
  expect(rows.find((l) => l.includes("Urgent one"))).toMatch(/open\s+critical\s+Urgent one/);
  expect(rows.find((l) => l.includes("Plain one"))).toMatch(/open\s+medium\s+Plain one/);
  for (const x of [a, b]) await aleph(["issue", "drop", "fac", String(x.json.added), "done"], env);
});
