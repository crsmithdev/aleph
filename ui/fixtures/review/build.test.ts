import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildReviewFixture } from "./build.ts";
import { readEvents } from "../../../lib/layout.ts";
import { askOf } from "../../../jobs/lib/asks/ask.ts";
import { state } from "../../state.ts";

const KEYS = ["ALEPH_DB", "ALEPH_FACTORY_DIR", "ALEPH_JOBS_DIR", "ALEPH_ITEMS", "ALEPH_VAULT"];
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

test("the fixture's tools-34 is stored as an Ask and shows on Status as an escalated question", () => {
  Object.assign(process.env, buildReviewFixture(join(dir, "fx")));
  const ask = askOf("issue.34");
  expect(ask?.kind).toBe("input");
  expect(ask?.reason).toBe("question");
  expect(ask?.situation).toContain("second input file");
  expect(ask?.effects?.some((e) => e.action === "decide")).toBe(true);
  expect(ask?.recommend?.action).toBe("decide");
  const card = state().asks.find((a) => a.id === "tools-34");
  expect(card?.escalated).toBe(true);
  expect(card?.actions.length).toBeGreaterThan(0);
});

test("the fixture's run events go to its own aleph.db, not to the caller's", () => {
  process.env.ALEPH_FACTORY_DIR = join(dir, "outside");
  buildReviewFixture(join(dir, "fx"));
  const was = process.env.ALEPH_DB;
  expect(existsSync(join(dir, "fx", "aleph.db"))).toBe(true);
  process.env.ALEPH_DB = join(dir, "fx", "aleph.db");
  try { expect(readEvents().some((e) => e.object === "issue.27" && e.action === "question")).toBe(true); } finally { process.env.ALEPH_DB = was; }
  expect(process.env.ALEPH_FACTORY_DIR).toBe(join(dir, "outside"));
});
