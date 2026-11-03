// Archived goal tests from jobs/lib/factory-restart.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, utimesSync, writeFileSync } from "node:fs";
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


// A review that a host restart killed: the run is awaiting a held-path ask, call.md says PENDING.
const heldRun = (id: number, call: string, mtime: Date) => {
  const r = mk(`fac-${id}`, "build", "awaiting", { ask: { kind: "approval", reason: "held-path", question: "q", options: [], why: [] } }, { "call.md": call });
  utimesSync(join(r.folder, "call.md"), mtime, mtime);
  return r;
};
const reviewDispatch = (starts: string[]) => {
  const f = fakes();
  // Like startReview: the start writes a new PENDING.
  f.rescue.review = (folder) => { starts.push(folder); writeFileSync(join(folder, "call.md"), "PENDING\n"); return true; };
  return dispatch(f);
};

test("a held run whose PENDING call.md was written after the boot gets no start", async () => {
  heldRun(goal(), "PENDING\n", new Date());
  const starts: string[] = [];
  await reviewDispatch(starts);
  expect(starts).toEqual([]);
});

test("a held run with a verdict or an ERROR in an old call.md gets no start", async () => {
  heldRun(goal(), "VERDICT: land\n", new Date(BEFORE_BOOT));
  heldRun(goal(), "ERROR: could not start: x\n", new Date(BEFORE_BOOT));
  const starts: string[] = [];
  await reviewDispatch(starts);
  expect(starts).toEqual([]);
});
