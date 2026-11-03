// Archived goal tests from jobs/cli.dispatch-paused.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, dispatching, jobsDir, other, passed, sh, startScript, setup, teardown, until as untilHelper } from "../../jobs/cli.helpers";

beforeAll(setup);
afterAll(teardown);

describe("a factory run", () => {

  describe("dispatch", () => {
    let startLog: string, startCmd: string;
    let testStart = 0;
    const on = (extra: Record<string, string> = {}) => ({ ALEPH_DISPATCH: "on", ALEPH_START_CMD: startCmd, START_LOG: startLog, ...extra });
    const started = () => (existsSync(startLog) ? readFileSync(startLog, "utf8").trim().split("\n").filter(Boolean) : []);
    const startLogText = () => (existsSync(startLog) ? readFileSync(startLog, "utf8") : "(none)");
    // Adds the start.log contents to an error, so a flake shows what was started.
    const withLog = (e: unknown, extra = "") => new Error([(e as Error).message, ...(extra ? [extra] : []), `--- start.log\n${startLogText()}`].join("\n"));
    const until = async (f: () => boolean) => {
      try { await untilHelper(f); } catch (e) { throw withLog(e, `elapsed since test start: ${Date.now() - testStart} ms`); }
    };
    const expectStarted = (check: () => void) => { try { check(); } catch (e) { throw withLog(e); } };
    const gate = (n: string) => join(base, `gate-${n}`);
    const settled = (id: string | number) => passed(startLog, id);
    // Goal refs (`<n>.1`): `aleph issue add --goal -` files the issue `<n>` and its goal.
    const ids: string[] = [];
    const dropGoal = async (ref: string) => {
      await aleph(["issue", "drop", "fac", ref.split(".")[0], "test over"]);
    };
    beforeAll(() => {
      startLog = join(base, "start.log");
      startCmd = join(base, "start-cmd");
      startScript(startCmd, jobsDir);
    });
    beforeEach(() => { rmSync(startLog, { force: true }); });
    afterAll(async () => {
      for (const n of ["f"]) writeFileSync(gate(n), "");
      // The released holds finish their runs; wait for that, at most as long as the fixed wait it replaces.
      for (let i = 0; i < 30 && !ids.every(settled); i++) await Bun.sleep(100);
      for (const id of ids) {
        await aleph(["drop", `fac-${id}`]);
        await dropGoal(id);
      }
    });

    test("a dispatch while paused or with main red starts nothing, and adding a goal starts its run with no tick", async () => {
      testStart = Date.now();
      await aleph(["pause"]);
      expect((await aleph(["dispatch"], on())).json).toMatchObject({ started: [], paused: true });
      const held = await aleph(["issue", "add", "fac", "added while paused", "--spec", "-"], on(), `ACTION: hold ${gate("f")}\n`);
      // The add's detached dispatch reads the pause when it boots: it must end before the resume.
      await until(() => !dispatching());
      expectStarted(() => expect(started()).toEqual([]));
      await aleph(["resume"]);
      sh(other, "git", "pull", "-q", "--rebase", "origin", "main");
      writeFileSync(join(other, "FAIL"), "red\n");
      sh(other, "git", "add", "FAIL"); sh(other, "git", "commit", "-qm", "break main"); sh(other, "git", "push", "-q", "origin", "main");
      const red = await aleph(["dispatch"], on());
      expect(red.json.started).toEqual([]);
      expect(red.json.skipped[0]).toContain("main is red");
      sh(other, "git", "rm", "-q", "FAIL"); sh(other, "git", "commit", "-qm", "fix main"); sh(other, "git", "push", "-q", "origin", "main");
      await dropGoal(`${held.json.added}`);
      // No explicit `aleph dispatch` follows: `issue add --goal -` starts the dispatch itself.
      const add = await aleph(["issue", "add", "fac", "starts at once", "--spec", "-"], on(), `ACTION: hold ${gate("f")}\n`);
      ids.push(`${add.json.added}`);
      expect(add.code).toBe(0);
      await until(() => started().length === 1);
      expectStarted(() => expect(started()).toEqual([`fac-${add.json.added}`]));
      writeFileSync(gate("f"), "");
      await until(() => settled(`${add.json.added}`));
      // A slow dispatch does not hold the add: the start waits for a file written only after the add returns, so an add that waited would never return.
      const slowCmd = join(base, "slow-cmd"), startGo = gate("start-go");
      writeFileSync(slowCmd, `#!/bin/bash\nwhile [ ! -f ${startGo} ]; do sleep 0.05; done\nexec ${startCmd} "$@"\n`, { mode: 0o755 });
      const slow = await aleph(["issue", "add", "fac", "slow dispatch", "--spec", "-"], on({ ALEPH_START_CMD: slowCmd }), `ACTION: hold ${gate("f")}\n`);
      expect(slow.code).toBe(0);
      writeFileSync(startGo, "");
      ids.push(`${slow.json.added}`);
      await until(() => started().length === 2);
      await until(() => settled(`${slow.json.added}`));
    }, 90_000);
  });
});
