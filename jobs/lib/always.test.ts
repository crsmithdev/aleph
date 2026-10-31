import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ASK_REASONS, always, grant, handed, logAlways, readAlways, revoke } from "./always.ts";

let dir = "";
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "always-")); process.env.ALEPH_FACTORY_DIR = dir; });
afterEach(() => { delete process.env.ALEPH_FACTORY_DIR; rmSync(dir, { recursive: true, force: true }); });

test("grant then always round-trips; revoke removes it", () => {
  expect(always("held-path")).toBeNull();
  expect(grant("held-path", "land")).toBeNull();
  expect(always("held-path")?.action).toBe("land");
  expect(handed("held-path")).toBe(false);
  expect(grant("held-path", "firefighter")).toBeNull();
  expect(handed("held-path")).toBe(true);
  revoke("held-path");
  expect(always("held-path")).toBeNull();
  expect(readAlways()).toEqual({});
});

test("grant refuses an unknown reason and an action the reason does not list", () => {
  expect(grant("nope", "land")).toContain("unknown reason");
  expect(grant("held-path", "rerun")).toContain("no action");
  expect(readAlways()).toEqual({});
});

test("grant accepts proposal-<kind>:<place> only", () => {
  expect(grant("proposal-claude-md:global", "approve")).toBeNull();
  expect(always("proposal-claude-md:global")?.action).toBe("approve");
  expect(grant("held:x", "land")).toContain("unknown reason");
  expect(grant("proposal-nope:global", "approve")).toContain("unknown reason");
});

test("ASK_REASONS names every reason with actions and an always", () => {
  expect(Object.keys(ASK_REASONS).sort()).toEqual(["acceptance-failed", "firefighter", "held-path", "host-check", "manual", "no-commit", "part-dropped", "proposal", "proposal-check", "proposal-claude-md", "proposal-skill", "question", "rescue", "review", "run-cap", "triage-failed"]);
  for (const r of Object.values(ASK_REASONS)) {
    expect(r.actions.length).toBeGreaterThan(0);
    expect([...r.actions, "firefighter", "recommended", ""]).toContain(r.always);
    expect(new Set(r.actions).size).toBe(r.actions.length);
  }
  expect(ASK_REASONS.question.always).toBe("recommended");
  expect(ASK_REASONS["triage-failed"].always).toBe("retry");
  expect(ASK_REASONS.proposal.always).toBe("start");
  expect(ASK_REASONS["host-check"].always).toBe("");
});

test("readAlways reads always.json only; a bad file is empty and a write goes to always.json", () => {
  expect(readAlways()).toEqual({});
  writeFileSync(join(dir, "always.json"), JSON.stringify({ "held-path": { action: "firefighter", at: "t" } }));
  expect(Object.keys(readAlways())).toEqual(["held-path"]);
  expect(handed("held-path")).toBe(true);
  expect(grant("rescue", "recommended")).toBeNull();
  expect(Object.keys(readAlways()).sort()).toEqual(["held-path", "rescue"]);
  writeFileSync(join(dir, "always.json"), "not json");
  expect(readAlways()).toEqual({});
});

const CLI = join(import.meta.dir, "..", "cli.ts");
const cli = (...args: string[]) => {
  const p = Bun.spawnSync(["bun", CLI, ...args], { env: { ...process.env, ALEPH_FACTORY_DIR: dir }, stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
};

test("aleph always grant, list and revoke work on always.json", () => {
  const g = cli("always", "grant", "rescue", "recommended");
  expect(g.code).toBe(0);
  const saved = JSON.parse(readFileSync(join(dir, "always.json"), "utf8"));
  expect(saved).toEqual({ rescue: { action: "recommended", at: expect.any(String) } });
  const l = cli("always", "list");
  expect(l.code).toBe(0);
  expect(JSON.parse(l.out).rescue.action).toBe("recommended");
  expect(cli("always", "revoke", "rescue").code).toBe(0);
  expect(JSON.parse(readFileSync(join(dir, "always.json"), "utf8"))).toEqual({});
  expect(cli("always", "list").out).not.toContain("rescue");
});

test("aleph always grant refuses an unknown reason and takes held-path", () => {
  const bad = cli("always", "grant", "held", "firefighter");
  expect(bad.code).toBe(1);
  expect(existsSync(join(dir, "always.json"))).toBe(false);
  expect(cli("always", "grant", "held-path", "firefighter").code).toBe(0);
  expect(cli("always", "grant", "held-path", "land").code).toBe(0);
  expect(JSON.parse(readFileSync(join(dir, "always.json"), "utf8"))["held-path"].action).toBe("land");
  expect(JSON.parse(cli("always", "list").out)["held-path"].action).toBe("land");
});

test("logAlways appends one always line to tick.log", () => {
  logAlways("held-path", "land", "fac-1");
  const lines = readFileSync(join(dir, "tick.log"), "utf8").trim().split("\n");
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain("always: held-path: land on fac-1");
});
