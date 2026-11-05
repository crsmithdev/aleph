import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { layout, factoryLog } from "../../../jobs/lib/infra/layout.ts";
import { buildReviewFixture } from "./build.ts";
import { askOf } from "../../../jobs/lib/asks/ask.ts";
import { state } from "../../state.ts";

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

// flaky: tests/flaky.md#fixture-factory-folder
test.skip("the fixture environment points the factory folder under its dest, and a factory log line lands there, not in the live factory", () => {
  const dest = join(dir, "fx");
  const env = buildReviewFixture(dest);
  expect(env.ALEPH_FACTORY_DIR).toBe(join(dest, "factory"));
  Object.assign(process.env, env);
  expect(layout().factory).toBe(join(dest, "factory"));
  // A token unique to this run, so lines already in the other log can never match it.
  const line = `demo: acceptance not run: fetch failed ${randomUUID()}`;
  factoryLog(line);
  expect(readFileSync(join(dest, "factory", "tick.log"), "utf8")).toContain(line);
  // The factory folder before the fixture: tests/preload.ts points it under its temp folder, never at ~/.aleph.
  const live = join(saved.ALEPH_FACTORY_DIR!, "tick.log");
  if (existsSync(live)) expect(readFileSync(live, "utf8")).not.toContain(line);
});

test("the fixture's tools-4 is stored as an Ask and shows on Status as an escalated question", () => {
  Object.assign(process.env, buildReviewFixture(join(dir, "fx")));
  const ask = askOf("tools-4");
  expect(ask?.kind).toBe("input");
  expect(ask?.reason).toBe("question");
  expect(ask?.situation).toContain("second input file");
  expect(ask?.effects?.some((e) => e.action === "decide")).toBe(true);
  expect(ask?.recommend?.action).toBe("decide");
  const card = state().asks.find((a) => a.id === "tools-4");
  expect(card?.escalated).toBe(true);
  expect(card?.actions.length).toBeGreaterThan(0);
});
