import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { base, job, repo, setup, sh, state, teardown } from "./cli.helpers";

beforeAll(setup);
afterAll(teardown);

test("a fetch that fails keeps git's error text in the reason", async () => {
  const missing = join(base, "no-such-origin.git");
  sh(repo, "git", "remote", "set-url", "origin", missing);
  const r = await job("nofetch", "commit-fixed nofetch.txt");
  const s = state(r.json.run);
  expect(s.state).toBe("failed");
  expect(s.reason).toStartWith("fetch failed: ");
  expect(s.reason).toContain("no-such-origin.git");
}, 30_000);
