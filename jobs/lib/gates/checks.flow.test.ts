import { afterAll, beforeAll, describe, expect, setSystemTime, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { base, file, state, setup, teardown } from "../../cli.helpers";
import { call, job } from "../../inproc.ts";
import { reportText } from "../infra/flow.testkit.ts";
import { noteFlake } from "../../../issues/lib/store.ts";

// The runs start in-process, as `aleph job` starts them; each run's unit is a process of its own.
beforeAll(setup);
afterAll(teardown);

describe("a factory run's checks", () => {
  const fjob = (name: string, action: string, extra: Record<string, string> = {}, o: { on?: number } = {}) =>
    job("fac", name, `Goal: ${name}\nACTION: ${action}\n`, o.on === undefined ? {} : { on: String(o.on) }, extra);

  describe("flaky checks", () => {
    const flaky = () => JSON.parse(readFileSync(join(base, "factory", "flaky.json"), "utf8"));

    test("a check that fails then passes on the same tree passes the run, is recorded and reported; two make a health line", async () => {
      const r = await fjob("flk1", "flaky");
      expect(state(r.json.run).condition).toBe("passed");
      expect(state(r.json.run).checks.find((c: any) => c.name === "flaky")).toMatchObject({ ok: true, rerun: true });
      expect(file(r.json.run, "checks.log")).toContain("## flaky: exit 1, run again");
      expect(flaky()).toHaveLength(1);
      expect(flaky()[0]).toMatchObject({ repo: "fac", check: "flaky", run: r.json.run });
      const out = (await reportText());
      expect(out).toContain("flaky passed on rerun");
      expect(out).not.toContain("on rerun 2 times");
      await fjob("flk2", "flaky");
      expect(flaky()).toHaveLength(2);
      expect((await reportText())).toContain("health: fac check flaky passed on rerun 2 times in 7 days");
      rmSync(join(base, "factory", "flaky.json"));
    }, 60_000);
  });
});

test("the report's health lines name an issue in its short form", async () => {
  setSystemTime(Date.parse("2026-11-05T12:00:00Z"));
  try {
    const repos = join(base, "repos.json"), reg = JSON.parse(readFileSync(repos, "utf8"));
    writeFileSync(repos, JSON.stringify({ ...reg, fac: { ...reg.fac, code: "f" } }));
    const noted = await call(() => noteFlake({ key: "fac" }, "a.test.ts > a.test.ts"));
    const id = (noted.json as { id: number }).id;
    const dir = join(base, "factory", "monitor");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "2026-11-05.json"), JSON.stringify({ day: "2026-11-05", findings: ["fac-9 is the cause"] }));
    const out = await reportText();
    expect(out).toContain(`health: f${id} holds 1 flake notes in 7 days`);
    expect(out).toContain("names 1 thing that looks off; first: f9 is the cause");
    expect(out).not.toContain(`fac-${id}`);
    expect(out).not.toContain("fac-9");
  } finally {
    setSystemTime();
  }
});
