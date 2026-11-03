import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { layout, factoryLog } from "../../../jobs/lib/layout.ts";
import { buildReviewFixture } from "./build.ts";

const KEYS = ["ALEPH_FACTORY_DIR", "ALEPH_JOBS_DIR", "ALEPH_REPOS", "ALEPH_ISSUES", "ALEPH_VAULT"];
let saved: Record<string, string | undefined>;
let dir: string;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  dir = mkdtempSync(join(tmpdir(), "review-build-"));
});

afterEach(() => {
  for (const k of KEYS) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  rmSync(dir, { recursive: true, force: true });
});

test("the environment the review fixture returns points the factory folder under its dest", () => {
  const dest = join(dir, "fx");
  const env = buildReviewFixture(dest);
  expect(env.ALEPH_FACTORY_DIR).toBe(join(dest, "factory"));
  Object.assign(process.env, env);
  expect(layout().factory).toBe(join(dest, "factory"));
});

test("a factory log line written under the fixture environment lands under the fixture, not the live factory", () => {
  const dest = join(dir, "fx");
  const env = buildReviewFixture(dest);
  Object.assign(process.env, env);
  factoryLog("demo: acceptance not run: fetch failed");
  expect(readFileSync(join(dest, "factory", "tick.log"), "utf8")).toContain("demo: acceptance not run: fetch failed");
  const live = join(process.env.HOME || "", ".aleph", "factory", "tick.log");
  if (existsSync(live)) expect(readFileSync(live, "utf8")).not.toContain("demo: acceptance not run: fetch failed");
});
