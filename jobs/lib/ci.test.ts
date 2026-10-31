import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ciState, ciStep, redCi, type GhRun } from "./ci.ts";
import { health } from "./factory.ts";
import { snapshot } from "./firefighter.ts";
import type { Repo } from "./ledger.ts";

const KEYS = ["ALEPH_FACTORY_DIR", "ALEPH_REPOS", "ALEPH_ISSUES", "ALEPH_JOBS_DIR"];
let base: string;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-ci-"));
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  Object.assign(process.env, { ALEPH_FACTORY_DIR: join(base, "factory"), ALEPH_REPOS: join(base, "repos.json"), ALEPH_ISSUES: join(base, "items"), ALEPH_JOBS_DIR: join(base, "jobs") });
  writeFileSync(join(base, "repos.json"), JSON.stringify({ fac: { path: join(base, "repo"), sandbox: true, autoland: false } }));
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(base, { recursive: true, force: true });
});

const run = (conclusion: string, sha: string, at: string, status = "completed"): GhRun => ({ conclusion, status, headSha: sha, url: `https://ci/${sha}`, createdAt: at });
const repo = { key: "fac", path: "/nowhere", main: "main" } as Repo;

test("ciState: green when the latest finished run passed; red counts the failed runs since the last pass", () => {
  expect(ciState("fac", [run("success", "c3", "2026-10-29T03:00:00Z")])).toEqual({ repo: "fac", ok: true, sha: "c3", url: "https://ci/c3" });
  const red = ciState("fac", [
    run("", "c5", "2026-10-29T05:00:00Z", "in_progress"),
    run("failure", "c4", "2026-10-29T04:00:00Z"),
    run("cancelled", "cx", "2026-10-29T03:30:00Z"),
    run("failure", "c3", "2026-10-29T03:00:00Z"),
    run("success", "c2", "2026-10-29T02:00:00Z"),
  ]);
  expect(red).toEqual({ repo: "fac", ok: false, sha: "c4", url: "https://ci/c4", since: "2026-10-29T03:00:00Z", sinceSha: "c3", runs: 2 });
  expect(ciState("fac", [run("", "c1", "2026-10-29T01:00:00Z", "queued")])).toBeNull();
  // No pass among the runs read: the streak is longer than what was read.
  expect(ciState("fac", [run("failure", "c4", "2026-10-29T04:00:00Z")])).toMatchObject({ runs: 1, older: true });
});

test("a red CI is a health line and one firefighter event per streak; a repo gh cannot read keeps its last state", () => {
  let runs: GhRun[] | null = [run("failure", "c4", "2026-10-29T04:00:00Z"), run("failure", "c3", "2026-10-29T03:00:00Z"), run("success", "c2", "2026-10-29T02:00:00Z")];
  expect(ciStep([repo], () => runs).map((c) => c.sinceSha)).toEqual(["c3"]);
  expect(health()).toContain("health: fac CI on main has failed 2 runs in a row since 2026-10-29 03:00 UTC (c3): https://ci/c4");
  const key = snapshot().find((e) => e.kind === "red")?.key;
  expect(key).toBe("ci:fac:c3");
  // A third failed run is the same streak, so the same event.
  runs = [run("failure", "c5", "2026-10-29T05:00:00Z"), ...runs];
  ciStep([repo], () => runs);
  expect(snapshot().find((e) => e.kind === "red")?.key).toBe(key);
  ciStep([repo], () => null);
  expect(redCi().map((c) => c.runs)).toEqual([3]);
  ciStep([repo], () => [run("failure", "c9", "2026-10-29T09:00:00Z")]);
  expect(health()).toContain("health: fac CI on main has failed at least 1 run in a row since before 2026-10-29 09:00 UTC (c9): https://ci/c9");
  ciStep([repo], () => [run("success", "c6", "2026-10-29T06:00:00Z")]);
  expect(redCi()).toEqual([]);
  expect(health().some((l) => l.includes("CI on main"))).toBe(false);
});
