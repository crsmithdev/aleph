// Archived goal tests from jobs/lib/factory-gates.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { hold } from "../../../jobs/lib/factory-status.ts";
import { ctx, setup, teardown } from "../../../jobs/lib/factory.helpers.ts";

beforeEach(setup);
afterEach(teardown);

const entry = (kind: string, state: string, reason?: string): any =>
  ({ id: `x-${kind}-${state}`, folder: join(ctx.base, "none", `${kind}-${state}`), run: { kind, job: "j1", name: "n1", repo: "fac", condition: state, started: "2026-10-28T00:00:00Z", ...(reason ? { reason } : {}) } });

test("a land that failed for another reason holds the factory", () => {
  expect(hold([[entry("build", "passed"), entry("land", "failed", "not landed")]])?.name).toBe("n1");
});
