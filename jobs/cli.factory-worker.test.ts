import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { aleph, jobsDir, specFile, state, setup, teardown } from "./cli.helpers";

beforeAll(setup);
afterAll(teardown);

describe("a factory run", () => {
  const fjob = (name: string, action: string, extra: Record<string, string> = {}, more: string[] = []) =>
    aleph(["job", "fac", name, "--spec", specFile(`Goal: ${name}\nACTION: ${action}\n`), ...more], extra);

  test("a worker silent for ALEPH_STALL_SECONDS is stuck as stalled, with no fix round", async () => {
    const t = performance.now();
    const r = await fjob("fstall", "quiet", { ALEPH_STALL_SECONDS: "2" });
    expect(performance.now() - t).toBeLessThan(10_000);
    expect(state(r.json.run)).toMatchObject({ state: "stuck", reason: "stalled: no output for 2 seconds" });
    await aleph(["drop", "fstall"]);
  }, 30_000);

  test("a worker that keeps printing is not stalled", async () => {
    const r = await fjob("fchat", "chatty", { ALEPH_STALL_SECONDS: "2" });
    expect(state(r.json.run).state).not.toBe("stuck");
    await aleph(["drop", "fchat"]);
  }, 30_000);

  test("a worker that commits only result.md is stuck with no commit, and no check, review or land starts", async () => {
    const r = await fjob("fresult", "commit result.md", { ALEPH_FIX_ROUNDS: "0" });
    const s = state(r.json.run);
    expect(s).toMatchObject({ state: "stuck", reason: "no commit" });
    expect(s.checks ?? []).toEqual([]);
    expect(s.review).toBeUndefined();
    expect(readdirSync(jobsDir).filter((d) => d.includes("-fac-fresult-")).map((d) => state(d).kind)).not.toContain("land");
    await aleph(["drop", "fresult"]);
  }, 30_000);

  test("a worker that commits result.md and another file does not end with no commit", async () => {
    const r = await fjob("fresult2", "commit-result-and other.txt");
    expect(state(r.json.run).reason).not.toBe("no commit");
    await aleph(["drop", "fresult2"]);
  }, 60_000);

});
