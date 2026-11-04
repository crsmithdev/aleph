// Archived goal tests from jobs/lib/ask.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as issues from "../../../todo/lib/todo.ts";
import { always, ASK_REASONS, askNote, askOf, clearAsk, grant, logAlways, readAlways, revoke, setAsk, type Ask } from "../../../jobs/lib/ask.ts";

const item = (fm: Record<string, unknown> = {}): issues.Issue => ({ id: 1, title: "t", fm: fm as any, request: "", spec: "", notes: [] });
const ask: Ask = { kind: "approval", reason: "held-path", question: "A or B?", options: [{ label: "A", line: "do a", after: "fac-2.1" }, { label: "B", line: "do b" }], recommended: "B", why: ["w"] };

const cased: Ask = {
  ...ask,
  situation: "The path is held. Chris decides where it goes.",
  effects: [
    { action: "decide:A", text: "lands the path on A" },
    { action: "decide:B", text: "lands the path on B" },
    { action: "drop", text: "drops the path" },
  ],
  recommend: { action: "decide:B", why: "B keeps the path small" },
};

test("clearAsk removes situation, effects and recommend with the rest", () => {
  const i = item({ kind: "issue", priority: "low" });
  setAsk(i, cased);
  clearAsk(i);
  expect(i.fm).toEqual({ kind: "issue", priority: "low" });
  expect(askOf(i)).toBeNull();
});

test("an Ask without situation, effects or recommend writes no such key and reads without them", () => {
  const i = item();
  setAsk(i, ask);
  expect("situation" in i.fm).toBe(false);
  expect("effects" in i.fm).toBe(false);
  expect("recommend" in i.fm).toBe(false);
  expect(Object.keys(askOf(i)!).sort()).toEqual(["kind", "options", "question", "reason", "recommended", "why"]);
  setAsk(i, { ...ask, situation: " ", effects: [], recommend: undefined });
  expect("situation" in i.fm || "effects" in i.fm || "recommend" in i.fm).toBe(false);
});

test("a case text with :: or a line break round-trips cleaned", () => {
  const i = item();
  setAsk(i, {
    ...ask,
    situation: "Two lines:\nfirst :: second",
    effects: [{ action: "decide:A :: B", text: "does\nthis \\ that :: now" }],
    recommend: { action: "drop", why: "too\nlong :: a \"quote\"" },
  });
  expect(i.fm.situation).toBe("Two lines: first : second");
  expect(i.fm.effects).toEqual(["decide:A : B :: does this / that : now"]);
  expect(i.fm.recommend).toBe("drop :: too long : a 'quote'");
  expect(askOf(i)).toMatchObject({
    situation: "Two lines: first : second",
    effects: [{ action: "decide:A : B", text: "does this / that : now" }],
    recommend: { action: "drop", why: "too long : a 'quote'" },
  });
});

test("setAsk and clearAsk write and remove every ask field and keep the rest", () => {
  const i = item({ kind: "issue", priority: "low" });
  setAsk(i, ask);
  expect(askOf(i)).toEqual(ask);
  clearAsk(i);
  for (const k of ["ask", "reason", "question", "options", "recommended", "why"]) expect(k in i.fm).toBe(false);
  expect(i.fm).toEqual({ kind: "issue", priority: "low" });
  expect(askOf(i)).toBeNull();
  clearAsk(i);
});

test("askNote reads as a sentence", () => {
  expect(askNote(ask)).toBe("A or B? Options: A: do a (waits on fac-2.1); B: do b. My recommendation is B. Why: w.");
});

let dir = "";
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "always-")); process.env.ALEPH_FACTORY_DIR = dir; });
afterEach(() => { delete process.env.ALEPH_FACTORY_DIR; rmSync(dir, { recursive: true, force: true }); });

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
  expect(Object.keys(ASK_REASONS).sort()).toEqual(["acceptance-failed", "held-path", "host-check", "no-commit", "part-dropped", "proposal", "proposal-check", "proposal-claude-md", "proposal-skill", "question", "rescue", "review", "run-cap", "spec-check", "triage-failed"]);
  for (const r of Object.values(ASK_REASONS)) {
    expect(r.actions.length).toBeGreaterThan(0);
    expect([...r.actions, "recommended", ""]).toContain(r.always);
    expect(new Set(r.actions).size).toBe(r.actions.length);
  }
  expect(ASK_REASONS.question.always).toBe("recommended");
  expect(ASK_REASONS["triage-failed"].always).toBe("retry");
  expect(ASK_REASONS.proposal.always).toBe("start");
  expect(ASK_REASONS["host-check"].always).toBe("");
  // No reason hands its Ask to the firefighter: the director takes every Ask first.
  for (const r of Object.values(ASK_REASONS)) expect(r.always).not.toBe("firefighter");
});

test("readAlways reads always.json only; a bad file is empty and a write goes to always.json", () => {
  expect(readAlways()).toEqual({});
  writeFileSync(join(dir, "always.json"), JSON.stringify({ "held-path": { action: "land", at: "t" } }));
  expect(Object.keys(readAlways())).toEqual(["held-path"]);
  expect(grant("rescue", "recommended")).toBeNull();
  expect(Object.keys(readAlways()).sort()).toEqual(["held-path", "rescue"]);
  writeFileSync(join(dir, "always.json"), "not json");
  expect(readAlways()).toEqual({});
});

const CLI = join((import.meta.dir + "/../../../jobs/lib"), "..", "cli.ts");
const cli = (...args: string[]) => {
  const p = Bun.spawnSync(["bun", CLI, ...args], { env: { ...process.env, ALEPH_FACTORY_DIR: dir }, stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
};

test("aleph always grant refuses an unknown reason and the firefighter, and takes held-path", () => {
  const bad = cli("always", "grant", "held", "land");
  expect(bad.code).toBe(1);
  expect(existsSync(join(dir, "always.json"))).toBe(false);
  expect(cli("always", "grant", "held-path", "firefighter").code).toBe(1);
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



test("revoke writes one tick.log line naming the reason; a revoke with no grant writes none", () => {
  revoke("held-path");
  expect(existsSync(join(dir, "tick.log"))).toBe(false);
  grant("held-path", "land");
  revoke("held-path");
  const lines = readFileSync(join(dir, "tick.log"), "utf8").trim().split("\n");
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain("always: revoked held-path");
  revoke("held-path");
  expect(readFileSync(join(dir, "tick.log"), "utf8").trim().split("\n")).toHaveLength(1);
});

test("every reason has a non-empty display name", () => {
  for (const [reason, r] of Object.entries(ASK_REASONS)) expect(r.name.trim().length, reason).toBeGreaterThan(0);
  expect(ASK_REASONS["spec-check"].name).toBe("Spec check");
  expect(ASK_REASONS["proposal-skill"].name).toBe("Lesson");
});

test("details round-trips through setAsk and askOf", () => {
  const i = item();
  setAsk(i, { ...ask, details: "More text." });
  expect(askOf(i)?.details).toBe("More text.");
  expect(askOf(item({ ask: "input", question: "q" }))?.details).toBeUndefined();
});
