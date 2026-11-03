// Archived goal tests from jobs/lib/landing.checks.test.ts: `bun run accept` runs them, `bun run test` does not.
// Which checks a land runs: none on an unchanged main, fewer when main's new commits do not reach the run, and the green baseline it records.
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { land } from "../../../jobs/lib/landing.ts";
import { writeRun } from "../../../jobs/lib/ledger.ts";
import { dir, job, landLog, moveMain, ports, remote, repo, sh, useLandingFixture } from "../../../jobs/lib/landing.fixture.ts";

useLandingFixture();

test("a run whose checked base is origin/main lands with no check call; one behind main runs the checks", async () => {
  const fresh = job("fresh", [["fresh.txt", "f\n"]]);
  const stamp = { checkedBase: remote("rev-parse", "main"), checkedTip: sh(repo.path, "git", "rev-parse", "job/fresh") };
  const p = ports();
  const e = { ...fresh, run: { ...fresh.run, ...stamp } };
  writeRun(e.folder, e.run);
  expect((await land(e, repo, p)).outcome.condition).toBe("landed");
  expect(p.calls).toEqual([]);
  expect(landLog(e)).toContain("checks skipped: main unchanged since");

  const stale = job("stale", [["stale.txt", "s\n"]]);
  const staleStamp = { checkedBase: remote("rev-parse", "main"), checkedTip: sh(repo.path, "git", "rev-parse", "job/stale") };
  moveMain();
  const q = ports();
  const e2 = { ...stale, run: { ...stale.run, ...staleStamp } };
  writeRun(e2.folder, e2.run);
  expect((await land(e2, repo, q)).outcome.condition).toBe("landed");
  expect(q.calls).toEqual([["stale"]]);
});




const baselineJson = () => {
  const f = join(dir, "factory", "baseline.json");
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {};
};

test("a land whose checks run and pass records the pushed commit as green in baseline.json", async () => {
  process.env.ALEPH_FACTORY_DIR = join(dir, "factory");
  repo.checks = [{ name: "all", run: "true" }];
  const e = job("g1", [["g1.txt", "1\n"]]);
  expect(await land(e, repo, ports())).toMatchObject({ code: 0, outcome: { condition: "landed" } });
  expect(baselineJson()).toEqual({ demo: { repo: "demo", commit: remote("rev-parse", "main"), ok: true } });
});

test("a land whose diff matches no globs of a check records no baseline", async () => {
  process.env.ALEPH_FACTORY_DIR = join(dir, "factory");
  repo.checks = [{ name: "all", run: "true" }, { name: "android", run: "true", when: ["android/**"] }];
  const e = job("g3", [["g3.txt", "3\n"]]);
  expect((await land(e, repo, ports())).outcome.condition).toBe("landed");
  expect(baselineJson()).toEqual({});
});

test("a failed land records no baseline, and a newer entry is kept", async () => {
  process.env.ALEPH_FACTORY_DIR = join(dir, "factory");
  const bad = job("g4", [["bad.txt", "x\n"]]);
  expect((await land(bad, repo, ports({ bad: () => "all failed" }))).outcome.condition).toBe("failed");
  expect(baselineJson()).toEqual({});
  moveMain();
  const newer = remote("rev-parse", "main");
  mkdirSync(join(dir, "factory"), { recursive: true });
  writeFileSync(join(dir, "factory", "baseline.json"), JSON.stringify({ demo: { repo: "demo", commit: newer, ok: false } }));
  const e = job("g5", [["g5.txt", "5\n"]]);
  // The branch is cut from main, so main moves past the entry once this land pushes: the entry is an ancestor and is replaced.
  expect((await land(e, repo, ports())).outcome.condition).toBe("landed");
  expect(baselineJson().demo).toEqual({ repo: "demo", commit: remote("rev-parse", "main"), ok: true });
});
