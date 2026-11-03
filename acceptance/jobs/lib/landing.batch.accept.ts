// Archived goal tests from jobs/lib/landing.batch.test.ts: `bun run accept` runs them, `bun run test` does not.
// A land and its batch: one check call and one push for the batch, a member that fails or conflicts taken out, and the room the land asks for.
import { expect, test } from "bun:test";
import { land } from "../../../jobs/lib/landing.ts";
import { given, job, landLog, mainFiles, ports, queued, repo, useLandingFixture } from "../../../jobs/lib/landing.fixture.ts";

useLandingFixture();

test("a conflict in one run takes only that run out", async () => {
  const [k1, k2, k3] = [job("k1", [["k.txt", "one\n"]]), queued(job("k2", [["k.txt", "two\n"]])), queued(job("k3", [["k3.txt", "3\n"]]))];
  const r = await land(k1, repo, ports());
  expect(r.outcome.condition).toBe("landed");
  expect(given(k2).verdict).toMatchObject({ condition: "failed", reason: "merge conflict", conflicts: ["k.txt"] });
  expect(landLog(k2)).toContain("k.txt");
  expect(given(k3).verdict.condition).toBe("landed");
  expect(mainFiles()).toEqual(["k.txt", "k3.txt"]);
});
