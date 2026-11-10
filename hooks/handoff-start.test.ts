import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOOK = join(import.meta.dir, "handoff-start.ts");
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "aleph-handoff-"));
  mkdirSync(join(root, "handoffs", "projects"), { recursive: true });
  mkdirSync(join(root, "proj"));
  mkdirSync(join(root, "other"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function run(cwd: string, env: Record<string, string | undefined> = {}) {
  const r = Bun.spawnSync(["bun", HOOK], {
    stdin: Buffer.from(JSON.stringify({ hook_event_name: "SessionStart", source: "clear", cwd })),
    env: { ...process.env, ALEPH_HANDOFFS_DIR: join(root, "handoffs"), CLAUDE_CODE_ENTRYPOINT: "cli", ALEPH_JOB_ID: undefined, ...env },
    stdout: "pipe", stderr: "pipe",
  });
  expect(r.exitCode).toBe(0);
  return r.stdout.toString().trim();
}

const write = (scope: string, text: string) => writeFileSync(join(root, "handoffs", "projects", `${scope}.md`), text);

test("a project's handoff shows its summary and asks for a pickup", () => {
  write("proj", "summary: fix the two failing recall tests\n\n## Intent\nx\n");
  const out = JSON.parse(run(join(root, "proj")));
  expect(out.systemMessage).toMatch(/^handoff waiting \(proj, \d\d:\d\d\): fix the two failing recall tests$/);
  expect(out.hookSpecificOutput.additionalContext).toContain("run the aleph:pickup skill with no argument");
  expect(out.hookSpecificOutput.additionalContext).toContain(join(root, "handoffs", "projects", "proj.md"));
});

test("another project's handoff prints nothing", () => {
  write("proj", "summary: x\n");
  expect(run(join(root, "other"))).toBe("");
});

test("headless sessions and factory jobs print nothing", () => {
  write("proj", "summary: x\n");
  expect(run(join(root, "proj"), { CLAUDE_CODE_ENTRYPOINT: "sdk-cli" })).toBe("");
  expect(run(join(root, "proj"), { ALEPH_JOB_ID: "j1" })).toBe("");
});

test("a handoff with no summary line still shows", () => {
  write("proj", "## Intent\nx\n");
  expect(JSON.parse(run(join(root, "proj"))).systemMessage).toEndWith(": no summary line");
});

test("the context holds the handoff text, while the system message keeps the summary", () => {
  write("proj", "summary: s1\n\n## Intent\nunique-sentence-4417\n");
  const out = JSON.parse(run(join(root, "proj")));
  expect(out.hookSpecificOutput.additionalContext).toContain("unique-sentence-4417");
  expect(out.systemMessage).toEndWith(": s1");
});

test("the context holds git status and log in a repo, and none outside git", () => {
  write("proj", "summary: s\n");
  expect(JSON.parse(run(join(root, "proj"))).hookSpecificOutput.additionalContext).not.toContain("git status:");
  const dir = join(root, "proj");
  Bun.spawnSync(["git", "init", "-b", "trunk-x"], { cwd: dir });
  Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "--allow-empty", "-m", "marker commit 9921"], { cwd: dir });
  const ctx = JSON.parse(run(dir)).hookSpecificOutput.additionalContext;
  expect(ctx).toContain("marker commit 9921");
  expect(ctx).toContain("On branch trunk-x");
});

test("a handoff that makes the context too long falls back to the summary and path", () => {
  write("proj", `summary: s\n\nnear-limit-marker ${"x".repeat(9000)}\n`);
  const near = JSON.parse(run(join(root, "proj"))).hookSpecificOutput.additionalContext;
  expect(near).toContain("near-limit-marker");
  expect(near.length).toBeLessThanOrEqual(10000);
  write("proj", `summary: s\n\nlong-body-marker ${"x".repeat(10000)}\n`);
  const ctx = JSON.parse(run(join(root, "proj"))).hookSpecificOutput.additionalContext;
  expect(ctx.length).toBeLessThanOrEqual(10000);
  expect(ctx).not.toContain("long-body-marker");
  expect(ctx).toContain(join(root, "handoffs", "projects", "proj.md"));
  expect(ctx).toContain("run the aleph:pickup skill with no argument");
});

const named = (name: string, text: string) => writeFileSync(join(root, "handoffs", `${name}.md`), text);

test("a named handoff whose cwd holds the session's directory asks for a pickup by name", () => {
  named("voice", `summary: finish the bridge\ncwd: ${join(root, "proj")}\n\nnamed-body-3301\n`);
  mkdirSync(join(root, "proj", "sub"));
  for (const dir of [join(root, "proj"), join(root, "proj", "sub")]) {
    const out = JSON.parse(run(dir));
    expect(out.systemMessage).toMatch(/^handoff waiting \(voice, \d\d:\d\d\): finish the bridge$/);
    expect(out.hookSpecificOutput.additionalContext).toContain("run the aleph:pickup skill with the argument voice");
    expect(out.hookSpecificOutput.additionalContext).toContain("named-body-3301");
  }
});

test("a named handoff for another directory, with no cwd, or archived prints nothing", () => {
  named("voice", `summary: x\ncwd: ${join(root, "other")}\n`);
  named("bare", "summary: x\n");
  named("2026-11-10-120000-voice", `summary: x\ncwd: ${join(root, "proj")}\n`);
  mkdirSync(join(root, "proj-2"));
  named("near", `summary: x\ncwd: ${join(root, "proj")}\n`);
  expect(run(join(root, "proj"))).not.toBe("");
  expect(run(join(root, "proj-2"))).toBe("");
  expect(run(join(root, "proj"))).not.toContain("voice");
});

test("a project handoff and a named handoff both show", () => {
  write("proj", "summary: project work\n");
  named("voice", `summary: voice work\ncwd: ${join(root, "proj")}\n`);
  const out = JSON.parse(run(join(root, "proj")));
  expect(out.systemMessage.split("\n")).toHaveLength(2);
  expect(out.hookSpecificOutput.additionalContext).toContain("with no argument");
  expect(out.hookSpecificOutput.additionalContext).toContain("with the argument voice");
});
