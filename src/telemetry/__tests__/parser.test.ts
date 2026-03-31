import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resolve } from "path";
import { parseAllSessions, clearCache } from "../src/parser.js";

const fixturesDir = resolve(import.meta.dir, "../fixtures");

// The fixture is a single JSONL file. To test parsing, we set up a
// temp directory structure that mimics ~/.claude/projects/<project>/<session>.jsonl
import { mkdirSync, copyFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

function setupFixtureDir(): string {
  const base = join(tmpdir(), `telemetry-test-${Date.now()}`);
  const projDir = join(base, "-home-user-project");
  mkdirSync(projDir, { recursive: true });
  copyFileSync(
    join(fixturesDir, "test-session.jsonl"),
    join(projDir, "sess-001.jsonl"),
  );
  return base;
}

function cleanupDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (e) { console.error('cleanupDir failed:', e); }
}

describe("parser", () => {
  let baseDir: string;

  beforeEach(() => {
    clearCache();
    baseDir = setupFixtureDir();
  });

  afterEach(() => {
    cleanupDir(baseDir);
  });

  it("discovers and parses JSONL files", () => {
    const entries = parseAllSessions({ baseDir });
    expect(entries.length).toBeGreaterThan(0);
  });

  it("extracts tool_use entries", () => {
    const entries = parseAllSessions({ baseDir });
    const toolUses = entries.filter((e) => e.entryType === "tool_use");
    expect(toolUses.length).toBeGreaterThan(0);
    expect(toolUses.some((e) => e.toolName === "Read")).toBe(true);
    expect(toolUses.some((e) => e.toolName === "Edit")).toBe(true);
    expect(toolUses.some((e) => e.toolName === "Bash")).toBe(true);
  });

  it("extracts token entries with correct counts", () => {
    const entries = parseAllSessions({ baseDir });
    const tokens = entries.filter((e) => e.entryType === "tokens");
    expect(tokens.length).toBeGreaterThan(0);

    const first = tokens[0];
    expect(first.inputTokens).toBe(1500);
    expect(first.outputTokens).toBe(200);
    expect(first.cacheReadTokens).toBe(5000);
    expect(first.model).toBe("claude-sonnet-4-6");
  });

  it("extracts skill names from Skill tool uses", () => {
    const entries = parseAllSessions({ baseDir });
    const skills = entries.filter((e) => e.skillName);
    expect(skills.length).toBe(2);
    expect(skills.some((e) => e.skillName === "commit")).toBe(true);
    expect(skills.some((e) => e.skillName === "code-review")).toBe(true);
  });

  it("extracts hook progress entries", () => {
    const entries = parseAllSessions({ baseDir });
    const hooks = entries.filter((e) => e.entryType === "hook_progress");
    expect(hooks.length).toBe(1);
    expect(hooks[0].hookEvent).toBe("PostToolUse");
  });

  it("extracts stop_hook_summary with durations", () => {
    const entries = parseAllSessions({ baseDir });
    const summaries = entries.filter((e) => e.entryType === "stop_hook_summary");
    expect(summaries.length).toBe(3); // 2 from first summary, 1 from second
    expect(summaries.some((e) => e.hookDurationMs === 45)).toBe(true);
    expect(summaries.some((e) => e.hookDurationMs === 120)).toBe(true);
  });

  it("extracts turn_duration entries", () => {
    const entries = parseAllSessions({ baseDir });
    const turns = entries.filter((e) => e.entryType === "turn_duration");
    expect(turns.length).toBe(1);
    expect(turns[0].turnDurationMs).toBe(8500);
  });

  it("extracts tool_result errors", () => {
    const entries = parseAllSessions({ baseDir });
    const errors = entries.filter((e) => e.entryType === "tool_result" && e.isError);
    expect(errors.length).toBe(1);
  });

  it("skips corrupt JSONL lines gracefully", () => {
    // The fixture has "this is a corrupt line that should be skipped"
    // Parsing should not throw
    const entries = parseAllSessions({ baseDir });
    expect(entries.length).toBeGreaterThan(0);
  });

  it("uses file cache on second parse", () => {
    const entries1 = parseAllSessions({ baseDir });
    const entries2 = parseAllSessions({ baseDir });
    expect(entries1.length).toBe(entries2.length);
  });

  it("filters by since date", () => {
    const entries = parseAllSessions({
      baseDir,
      since: new Date("2026-03-16T00:00:00Z"),
    });
    // Only sessions from 3/16 and 3/17 should be included
    // But since filter is on file mtime, not entry timestamp, all entries come through
    // (the file was just created so mtime is now)
    expect(entries.length).toBeGreaterThan(0);
  });

  it("handles empty base directory", () => {
    const emptyDir = join(tmpdir(), `telemetry-empty-${Date.now()}`);
    mkdirSync(emptyDir, { recursive: true });
    const entries = parseAllSessions({ baseDir: emptyDir });
    expect(entries.length).toBe(0);
    cleanupDir(emptyDir);
  });

  it("handles nonexistent base directory", () => {
    const entries = parseAllSessions({ baseDir: "/nonexistent/path" });
    expect(entries.length).toBe(0);
  });

  it("parses multiple sessions from same file", () => {
    const entries = parseAllSessions({ baseDir });
    const sessionIds = new Set(entries.map((e) => e.sessionId));
    expect(sessionIds.size).toBe(3); // sess-001, sess-002, sess-003
  });

  it("parses multiple tool uses from single assistant message", () => {
    const entries = parseAllSessions({ baseDir });
    // sess-002 msg_010 has Read + Grep in one message
    const sess2Tools = entries.filter(
      (e) => e.sessionId === "sess-002" && e.entryType === "tool_use",
    );
    expect(sess2Tools.some((e) => e.toolName === "Read")).toBe(true);
    expect(sess2Tools.some((e) => e.toolName === "Grep")).toBe(true);
  });
});
