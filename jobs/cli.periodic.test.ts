import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { base, other, setup, sh, teardown } from "./cli.helpers";
import { cli } from "./flow.testkit.ts";
import { memory, use } from "../lib/langfuse.ts";

// The wiring in jobs/commands.ts of `aleph doctor --fix`, `aleph tick` and `aleph suite`, each outside call faked.
beforeAll(setup);
afterAll(teardown);

/** An executable script at `base/<name>` with `body`. */
const script = (name: string, body: string): string => {
  const f = join(base, name);
  writeFileSync(f, `#!/bin/bash\n${body}\n`);
  chmodSync(f, 0o755);
  return f;
};

describe("doctor --fix", () => {
  // Every unit is active and every timer has a next run; the log has each call's arguments.
  const ctl = () => script("ctl", `echo "$@" >> ${join(base, "ctl.log")}\nif [ "$2" = list-timers ]; then echo '[{"unit":"'$5'","next":'$(( ($(date +%s) + 60) * 1000000 ))'}]'; else echo active; fi`);

  test("guard: prints the checks and what it fixed, and exits 1 only when a check fails", async () => {
    mkdirSync(join(base, "units"));
    const home = (status: number) => Bun.serve({ port: 0, fetch: () => Response.json({}, { status }) });
    const env = (s: ReturnType<typeof home>) => ({
      ALEPH_SYSTEMCTL: ctl(), ALEPH_HOME_URL: `http://127.0.0.1:${s.port}/`, ALEPH_UNIT_DIR: join(base, "units"),
      ALEPH_WINDOWS_TIME_CMD: "date +%s%3N", ALEPH_DOCTOR_CLOCK_MS: "50",
    });
    const up = home(200), down = home(500);
    try {
      const good = await cli(["doctor", "--fix", "--json"], env(up));
      expect(good.json.fixed).toEqual(["started aleph-tick.service"]);
      expect(good.json.checks.filter((c: any) => !c.ok)).toEqual([]);
      expect(good.code).toBe(0);
      const bad = await cli(["doctor", "--fix", "--json"], env(down));
      expect(bad.json.fixed).toEqual(["started aleph-tick.service"]);
      expect(bad.json.checks.filter((c: any) => !c.ok).map((c: any) => c.name)).toEqual(["aleph.home"]);
      expect(bad.code).toBe(1);
    } finally {
      up.stop(true);
      down.stop(true);
    }
    expect(readFileSync(join(base, "ctl.log"), "utf8").split("\n")).toContain("--user start --no-block aleph-tick.service");
  });
});

describe("tick", () => {
  test("guard: exits 0 with its JSON, reads the CI with gh, and records the step in tick.json", async () => {
    mkdirSync(join(base, "bin"));
    script("bin/gh", `echo "$@" >> ${join(base, "gh.log")}\necho '[]'`);
    const r = await cli(["tick"], { PATH: `${join(base, "bin")}:${process.env.PATH}` });
    expect(r.code).toBe(0);
    expect(r.json).toEqual(expect.any(Object));
    expect(readFileSync(join(base, "gh.log"), "utf8")).toContain("run list --branch main");
    expect(JSON.parse(readFileSync(join(base, "factory", "tick.json"), "utf8")).last.ci).toEqual(expect.any(String));
  });
});

describe("suite", () => {
  test("guard: prints green for the sandbox repo while its checks pass, then the failing line once main has a FAIL file", async () => {
    expect((await cli(["suite"])).json).toEqual({ fac: "green" });
    sh(other, "git", "pull", "-q", "--rebase", "origin", "main");
    writeFileSync(join(other, "FAIL"), "x\n");
    sh(other, "git", "add", ".");
    sh(other, "git", "commit", "-qm", "break main");
    sh(other, "git", "push", "-q", "origin", "main");
    const red = await cli(["suite"]);
    expect(red.json).toEqual({ fac: expect.stringMatching(/^main is red at [0-9a-f]{7}: tests$/) });
  });
});

describe("memory maintain", () => {
  test("guard: --dry runs the mechanical pass, the corrections mining and the compile of yesterday, and reports all three", async () => {
    const env = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
    expect((await cli(["memory", "init"], env)).code).toBe(0);
    use(memory({ traces: [], observations: [] }));
    try {
      const r = await cli(["memory", "maintain", "--dry"], env);
      expect(r.code).toBe(0);
      expect(r.json).toMatchObject({ op: "maintain", dry: true, ok: true, corrections: { lessons: 0 }, compile: { dry: true, notes: [], skipped: "nothing on the day" } });
      expect(r.json.counts).toMatchObject({ fixed: 0, lessons: 0, notes: 0 });
    } finally {
      use(null);
    }
  });
});
