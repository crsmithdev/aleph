import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLI, aleph, base, jobsDir, other, sh, state, setup, teardown } from "./cli.helpers";

beforeAll(setup);
afterAll(teardown);

describe("a factory run", () => {

  describe("dispatch", () => {
    let startLog: string, startCmd: string;
    const on = (extra: Record<string, string> = {}) => ({ ALEPH_DISPATCH: "on", ALEPH_START_CMD: startCmd, START_LOG: startLog, ...extra });
    const started = () => (existsSync(startLog) ? readFileSync(startLog, "utf8").trim().split("\n").filter(Boolean) : []);
    const gate = (n: string) => join(base, `gate-${n}`);
    const goal = async (n: string) =>
      (await aleph(["todo", "add", "fac", `dispatch ${n}`, "--labels", "goal", "--body", "-"], {}, `ACTION: hold ${gate(n)}\n`)).json.added as number;
    const until = async (f: () => boolean) => { for (let i = 0; i < 300 && !f(); i++) await Bun.sleep(100); expect(f()).toBe(true); };
    const settled = (id: number) => readdirSync(jobsDir).filter((r) => r.includes(`-fac-fac-${id}-`)).every((r) => state(r).state === "passed");
    const ids: number[] = [];
    beforeAll(() => {
      startLog = join(base, "start.log");
      startCmd = join(base, "start-cmd");
      // Starts the job in the background, as `systemd-run` does, and returns once its unit has a pid.
      writeFileSync(startCmd, `#!/bin/bash\necho "$2" >> "$START_LOG"\nALEPH_JOB_FOREGROUND=1 bun ${CLI} job "$1" "$2" --spec - --todo "$3" > /dev/null 2>&1 < /dev/stdin &\nfor i in $(seq 100); do ls ${jobsDir}/*-fac-"$2"-*/pid > /dev/null 2>&1 && exit 0; sleep 0.1; done\n`, { mode: 0o755 });
    });
    beforeEach(() => { rmSync(startLog, { force: true }); });
    afterAll(async () => {
      for (const n of ["a", "b", "c", "d", "f"]) writeFileSync(gate(n), "");
      // The released holds finish their runs; wait for that, at most as long as the fixed wait it replaces.
      for (let i = 0; i < 30 && !ids.every(settled); i++) await Bun.sleep(100);
      for (const id of ids) {
        await aleph(["drop", `fac-${id}`]);
        await aleph(["todo", "drop", "fac", String(id), "test over"]);
      }
    });

    test("starts ready goals up to the live cap, and the next when a run ends, with no tick", async () => {
      const a = await goal("a"), b = await goal("b"), c = await goal("c");
      ids.push(a, b, c);
      const d = await aleph(["dispatch"], on({ ALEPH_LIVE_CAP: "2" }));
      expect(d.json.started).toEqual([`fac-${a}`, `fac-${b}`]);
      expect(d.json.skipped).toEqual([`fac-${c}: 2 agent runs are live`]);
      expect(started()).toEqual([`fac-${a}`, `fac-${b}`]);
      writeFileSync(gate("a"), "");
      await until(() => started().length === 3);
      expect(started()[2]).toBe(`fac-${c}`);
      writeFileSync(gate("b"), "");
      writeFileSync(gate("c"), "");
      await until(() => ids.every(settled));
    }, 60_000);

    test("two dispatches at once start each goal once", async () => {
      const d = await goal("d");
      ids.push(d);
      const [x, y] = await Promise.all([aleph(["dispatch"], on({ ALEPH_LIVE_CAP: "5" })), aleph(["dispatch"], on({ ALEPH_LIVE_CAP: "5" }))]);
      expect(started().filter((n) => n === `fac-${d}`)).toHaveLength(1);
      expect([...x.json.started, ...y.json.started].filter((n: string) => n === `fac-${d}`)).toHaveLength(1);
      writeFileSync(gate("d"), "");
      await until(() => settled(d));
    }, 60_000);

    test("a dispatch while paused or with main red starts nothing, and adding a goal starts its run with no tick", async () => {
      await aleph(["pause"]);
      expect((await aleph(["dispatch"], on())).json).toMatchObject({ started: [], paused: true });
      const held = await aleph(["todo", "add", "fac", "added while paused", "--labels", "goal"], on());
      await Bun.sleep(1500);
      expect(started()).toEqual([]);
      await aleph(["resume"]);
      sh(other, "git", "pull", "-q", "--rebase", "origin", "main");
      writeFileSync(join(other, "FAIL"), "red\n");
      sh(other, "git", "add", "FAIL"); sh(other, "git", "commit", "-qm", "break main"); sh(other, "git", "push", "-q", "origin", "main");
      const red = await aleph(["dispatch"], on());
      expect(red.json.started).toEqual([]);
      expect(red.json.skipped[0]).toContain("main is red");
      sh(other, "git", "rm", "-q", "FAIL"); sh(other, "git", "commit", "-qm", "fix main"); sh(other, "git", "push", "-q", "origin", "main");
      await aleph(["todo", "drop", "fac", String(held.json.added), "test over"]);
      const add = await aleph(["todo", "add", "fac", "starts at once", "--labels", "goal", "--body", "-"], on(), `ACTION: hold ${gate("f")}\n`);
      ids.push(add.json.added);
      expect(add.code).toBe(0);
      await until(() => started().length === 1);
      expect(started()).toEqual([`fac-${add.json.added}`]);
      writeFileSync(gate("f"), "");
      await until(() => settled(add.json.added));
      // A slow dispatch does not hold the add.
      const slowCmd = join(base, "slow-cmd");
      writeFileSync(slowCmd, `#!/bin/bash\nsleep 4\nexec ${startCmd} "$@"\n`, { mode: 0o755 });
      const t0 = Date.now();
      const slow = await aleph(["todo", "add", "fac", "slow dispatch", "--labels", "goal", "--body", "-"], on({ ALEPH_START_CMD: slowCmd }), `ACTION: hold ${gate("f")}\n`);
      expect(Date.now() - t0).toBeLessThan(3000);
      expect(slow.code).toBe(0);
      ids.push(slow.json.added);
      await until(() => started().length === 2);
      await until(() => settled(slow.json.added));
    }, 90_000);
  });
});
