import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ciOf, ciRunning, ciState, ciStep, redCi, type Gh, type GhRun } from "./ci.ts";
import { health } from "./factory-status.ts";
import { reds } from "../roles/firefighter.ts";
import type { Repo } from "../records/ledger.ts";
import { writeRepos } from "../../../tests/projects.testkit.ts";

const KEYS = ["ALEPH_FACTORY_DIR", "ALEPH_ITEMS", "ALEPH_JOBS_DIR"];
let base: string;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-ci-"));
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  Object.assign(process.env, { ALEPH_FACTORY_DIR: join(base, "factory"), ALEPH_ITEMS: join(base, "items"), ALEPH_JOBS_DIR: join(base, "jobs") });
  writeRepos({ fac: { path: join(base, "repo"), sandbox: true, autoland: false } }, join(base, "items"));
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

/** A fake `gh` whose `run list` gives `runs`, or fails when they are null. */
const listing = (runs: GhRun[] | null): Gh => () => (runs ? { ok: true, out: JSON.stringify(runs) } : { ok: false, out: "gh failed" });

test("a red CI is a health line and one firefighter red at its latest failed head; a repo gh cannot read keeps its last state", async () => {
  let runs: GhRun[] | null = [run("failure", "c4", "2026-10-29T04:00:00Z"), run("failure", "c3", "2026-10-29T03:00:00Z"), run("success", "c2", "2026-10-29T02:00:00Z")];
  expect((await ciStep([repo], listing(runs))).map((c) => c.sinceSha)).toEqual(["c3"]);
  expect(health()).toContainEqual({ text: "health: fac CI on main has failed 2 runs in a row since 2026-10-29 03:00 UTC (c3): https://ci/c4", kind: "warn", key: "red-ci" });
  const ci = () => reds({ gh: () => ({ ok: true, out: "" }), after: () => {} }).filter((r) => r.source === "ci").map((r) => r.commit);
  expect(ci()).toEqual(["c4"]);
  // A third failed run is a new failing head.
  runs = [run("failure", "c5", "2026-10-29T05:00:00Z"), ...runs];
  await ciStep([repo], listing(runs));
  expect(ci()).toEqual(["c5"]);
  await ciStep([repo], listing(null));
  expect(redCi().map((c) => c.runs)).toEqual([3]);
  await ciStep([repo], listing([run("failure", "c9", "2026-10-29T09:00:00Z")]));
  expect(health().map((l) => l.text)).toContain("health: fac CI on main has failed at least 1 run in a row since before 2026-10-29 09:00 UTC (c9): https://ci/c9");
  await ciStep([repo], listing([run("success", "c6", "2026-10-29T06:00:00Z")]));
  expect(redCi()).toEqual([]);
  expect(health().some((l) => l.text.includes("CI on main"))).toBe(false);
});

test("the CI read asks gh for every repo at once", async () => {
  let live = 0, most = 0;
  const call = async () => { most = Math.max(most, ++live); await Promise.resolve(); live--; return { ok: true, out: "[]" }; };
  await ciStep([repo, { ...repo, key: "other" }, { ...repo, key: "third" }], call);
  expect(most).toBe(3);
});

test("the CI read keeps whether a run on main is not completed, and a later read of finished runs clears it", async () => {
  await ciStep([repo], listing([run("", "c2", "2026-10-29T02:00:00Z", "in_progress"), run("success", "c1", "2026-10-29T01:00:00Z")]));
  expect(ciRunning("fac")).toBe(true);
  // A read that fails keeps the mark.
  await ciStep([repo], listing(null));
  expect(ciRunning("fac")).toBe(true);
  await ciStep([repo], listing([run("success", "c2", "2026-10-29T02:00:00Z"), run("success", "c1", "2026-10-29T01:00:00Z")]));
  expect(ciRunning("fac")).toBe(false);
});

test("the CI read with the real runner keeps the last state of a repo whose gh cannot start, as the sync runner reports it", async () => {
  const before = ciOf("fac");
  await ciStep([repo]);
  expect(ciOf("fac")).toEqual(before);
});
