import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { aleph, specFile, state, setup, teardown } from "./cli.helpers";

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

});
