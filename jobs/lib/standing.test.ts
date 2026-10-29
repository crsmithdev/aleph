import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REASONS, grant, handed, logStanding, readStanding, revoke, standing } from "./standing.ts";

let dir = "";
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "standing-")); process.env.ALEPH_FACTORY_DIR = dir; });
afterEach(() => { delete process.env.ALEPH_FACTORY_DIR; rmSync(dir, { recursive: true, force: true }); });

test("grant then standing round-trips; revoke removes it", () => {
  expect(standing("held")).toBeNull();
  expect(grant("held", "land")).toBeNull();
  expect(standing("held")?.action).toBe("land");
  expect(handed("held")).toBe(false);
  expect(grant("held", "firefighter")).toBeNull();
  expect(handed("held")).toBe(true);
  revoke("held");
  expect(standing("held")).toBeNull();
  expect(readStanding()).toEqual({});
});

test("grant refuses an unknown reason and an action the reason does not list", () => {
  expect(grant("nope", "land")).toContain("unknown reason");
  expect(grant("held", "rerun")).toContain("no action");
  expect(readStanding()).toEqual({});
});

test("REASONS names every reason with actions and an always", () => {
  expect(Object.keys(REASONS).sort()).toEqual(["acceptance-failed", "decision", "firefighter", "held", "no-commit", "proposal-check", "proposal-claude-md", "proposal-skill", "question", "rescue", "review", "triage-no-verdict"]);
  for (const r of Object.values(REASONS)) {
    expect(r.actions.length).toBeGreaterThan(0);
    expect([...r.actions, "firefighter", "recommended"]).toContain(r.always);
  }
});

test("logStanding appends one standing line to tick.log", () => {
  logStanding("held", "land", "fac-1");
  const lines = readFileSync(join(dir, "tick.log"), "utf8").trim().split("\n");
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain("standing: held: land on fac-1");
});
