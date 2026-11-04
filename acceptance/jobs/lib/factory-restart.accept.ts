// Archived goal tests from jobs/lib/factory-restart.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readRun, writeRun } from "../../../jobs/lib/ledger.ts";
import { type Run } from "../../../jobs/lib/ledger.ts";
import { ctx, goal, mk, ask, fakes, dispatch, setup, sh, teardown } from "../../../jobs/lib/factory.helpers.ts";

beforeEach(setup);
afterEach(teardown);

// A run that a host restart killed: `running`, started before this boot, its process gone.
const BEFORE_BOOT = "2020-01-01T00:00:00.000Z";
const killedRun = (name: string, kind: Run["kind"] = "build", files: Record<string, string> = { pid: "999999999" }) => mk(name, kind, "running", { started: BEFORE_BOOT }, files);

test("a build a host restart killed, with its branch at main and no commit, is dropped for a new run of the goal", async () => {
  const id = goal();
  const repo = join(ctx.base, "repo");
  sh(repo, "git", "branch", "idle");
  const r = killedRun(`fac-${id}`, "build", {});
  writeRun(r.folder, { ...readRun(r.folder)!, branch: "idle" });
  const f = fakes();
  await dispatch(f);
  expect(f.calls).toEqual([`drop fac-${id}`, `start fac-${id}`]);
  expect(f.specs[0]).toContain("a host restart killed build run");
  expect(ask(id)).toBeNull();
});

test("a recheck a host restart killed, with its branch at main and no commit, is dropped for a new run of the goal, and uses no rerun", async () => {
  const id = goal();
  const repo = join(ctx.base, "repo");
  sh(repo, "git", "branch", "idle");
  const r = killedRun(`fac-${id}`, "recheck", {});
  writeRun(r.folder, { ...readRun(r.folder)!, branch: "idle" });
  const f = fakes();
  await dispatch(f);
  expect(f.calls).toEqual([`drop fac-${id}`, `start fac-${id}`]);
  expect(f.specs[0]).toContain("a host restart killed recheck run");
  expect(ask(id)).toBeNull();
  expect(existsSync(join(r.folder, "rescued"))).toBe(false);
});
