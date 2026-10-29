import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, specFile, state, setup, teardown } from "./cli.helpers";

beforeAll(setup);
afterAll(teardown);

describe("a factory run", () => {
  const fjob = (name: string, action: string, extra: Record<string, string> = {}, more: string[] = []) =>
    aleph(["job", "fac", name, "--spec", specFile(`Goal: ${name}\nACTION: ${action}\n`), ...more], extra);
  const runsLeft = () => existsSync(join(base, "runs")) ? readdirSync(join(base, "runs")) : [];

  test("a worker past the time box ends stuck as \"time box\"", async () => {
    const r = await fjob("fslow", "sleep", { ALEPH_JOB_TIMEOUT: "1" });
    expect(state(r.json.run)).toMatchObject({ state: "stuck", reason: "time box" });
    expect(runsLeft()).toEqual([]);
    await aleph(["drop", "fslow"]);
  });

});
