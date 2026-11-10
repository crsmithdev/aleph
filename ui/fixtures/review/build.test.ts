import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
