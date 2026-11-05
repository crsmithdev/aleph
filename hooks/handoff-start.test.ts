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
