import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resolve } from "path";
import { adaptAllSessions as parseAllSessions, clearCache } from "../src/adapter.js";
import { mkdirSync, copyFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const fixturesDir = resolve(import.meta.dir, "../fixtures");

function setupFixtureDir(): string {
  const base = join(tmpdir(), `telemetry-test-${Date.now()}`);
  const projDir = join(base, "-home-user-project");
  mkdirSync(projDir, { recursive: true });
  copyFileSync(join(fixturesDir, "test-session.jsonl"), join(projDir, "sess-001.jsonl"));
  return base;
}

function cleanupDir(dir: string): void {
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
}

const ISO = { includeEvents: false as const };

describe("parser", () => {
  let baseDir: string;

  beforeEach(() => {
    clearCache();
    baseDir = setupFixtureDir();
  });

  afterEach(() => cleanupDir(baseDir));

  it("discovers and parses JSONL files", () => {
    const entries = parseAllSessions({ baseDir, ...ISO });
    expect(entries.length).toBeGreaterThan(0);
  });

  it("extracts tool entries (kind=tool)", () => {
    const entries = parseAllSessions({ baseDir, ...ISO });
    const tools = entries.filter((e) => e.kind === "tool");
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.some((e) => e.name === "Read")).toBe(true);
    expect(tools.some((e) => e.name === "Edit")).toBe(true);
    expect(tools.some((e) => e.name === "Bash")).toBe(true);
  });

  it("extracts token entries with correct counts", () => {
    const entries = parseAllSessions({ baseDir, ...ISO });
    const tokens = entries.filter((e) => e.kind === "tokens");
    expect(tokens.length).toBeGreaterThan(0);
    const first = tokens[0];
    const d = first.data as { input: number; output: number; cacheRead: number; model: string };
    expect(d.input).toBe(1500);
    expect(d.output).toBe(200);
    expect(d.cacheRead).toBe(5000);
    expect(d.model).toBe("claude-sonnet-4-6");
  });

  it("extracts skill names from Skill tool uses", () => {
    const entries = parseAllSessions({ baseDir, ...ISO });
    const skills = entries.filter((e) => e.kind === "tool" && e.name.startsWith("Skill("));
    expect(skills.length).toBe(2);
    expect(skills.some((e) => e.name === "Skill(commit)")).toBe(true);
    expect(skills.some((e) => e.name === "Skill(code-review)")).toBe(true);
  });

  it("extracts hook progress entries (kind=hook)", () => {
    const entries = parseAllSessions({ baseDir, ...ISO });
    const hooks = entries.filter((e) => e.kind === "hook");
    expect(hooks.length).toBeGreaterThan(0);
    const postToolUse = hooks.find((e) => (e.data as any)?.event === "PostToolUse");
    expect(postToolUse).toBeDefined();
  });

  it("extracts stop_hook_summary with durations", () => {
    const entries = parseAllSessions({ baseDir, ...ISO });
    const summaries = entries.filter((e) => e.kind === "hook_summary");
    expect(summaries.length).toBeGreaterThanOrEqual(2);
    expect(summaries.some((e) => e.ms === 45)).toBe(true);
    expect(summaries.some((e) => e.ms === 120)).toBe(true);
  });

  it("extracts turn_duration entries", () => {
    const entries = parseAllSessions({ baseDir, ...ISO });
    const turns = entries.filter((e) => e.kind === "turn");
    expect(turns.length).toBeGreaterThan(0);
    expect(turns.some((e) => e.ms === 8500)).toBe(true);
  });

  it("extracts tool_result errors", () => {
    const entries = parseAllSessions({ baseDir, ...ISO });
    const errors = entries.filter((e) => e.kind === "tool_result" && (e.data as any)?.isError);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("skips corrupt JSONL lines gracefully", () => {
    const entries = parseAllSessions({ baseDir, ...ISO });
    expect(entries.length).toBeGreaterThan(0);
  });

  it("uses file cache on second parse", () => {
    const entries1 = parseAllSessions({ baseDir, ...ISO });
    const entries2 = parseAllSessions({ baseDir, ...ISO });
    expect(entries1.length).toBe(entries2.length);
  });

  it("filters by since date", () => {
    const entries = parseAllSessions({ baseDir, since: new Date("2026-03-16T00:00:00Z"), ...ISO });
    expect(entries.length).toBeGreaterThan(0);
  });

  it("handles empty base directory", () => {
    const emptyDir = join(tmpdir(), `telemetry-empty-${Date.now()}`);
    mkdirSync(emptyDir, { recursive: true });
    const entries = parseAllSessions({ baseDir: emptyDir, ...ISO });
    expect(entries.length).toBe(0);
    cleanupDir(emptyDir);
  });

  it("handles nonexistent base directory", () => {
    const entries = parseAllSessions({ baseDir: "/nonexistent/path", ...ISO });
    expect(entries.length).toBe(0);
  });

  it("parses multiple sessions from same file", () => {
    const entries = parseAllSessions({ baseDir, ...ISO });
    const sessionIds = new Set(entries.map((e) => e.sid));
    expect(sessionIds.size).toBe(3);
  });

  it("parses multiple tool uses from single assistant message", () => {
    const entries = parseAllSessions({ baseDir, ...ISO });
    const sess2Tools = entries.filter((e) => e.sid === "sess-002" && e.kind === "tool");
    expect(sess2Tools.some((e) => e.name === "Read")).toBe(true);
    expect(sess2Tools.some((e) => e.name === "Grep")).toBe(true);
  });
});
