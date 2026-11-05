import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOOK = join(import.meta.dir, "handoff-saved.ts");
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "aleph-saved-"));
  mkdirSync(join(root, "projects"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function run(file_path: string) {
  const r = Bun.spawnSync(["bun", HOOK], {
    stdin: Buffer.from(JSON.stringify({ hook_event_name: "PostToolUse", tool_name: "Write", tool_input: { file_path } })),
    env: { ...process.env, ALEPH_HANDOFFS_DIR: root },
    stdout: "pipe", stderr: "pipe",
  });
  expect(r.exitCode).toBe(0);
  return r.stdout.toString().trim();
}

test("a project handoff ends the turn and names the path and /clear", () => {
  const path = join(root, "projects", "proj.md");
  const out = JSON.parse(run(path));
  expect(out.continue).toBe(false);
  expect(out.stopReason).toContain("Handoff saved to");
  expect(out.stopReason).toContain(path);
  expect(out.stopReason).toContain("/clear");
});

test("a named handoff and a path outside the folder print nothing", () => {
  expect(run(join(root, "sidetone.md"))).toBe("");
  expect(run(join(tmpdir(), "projects", "proj.md"))).toBe("");
});

test("hooks.json runs the hook after a Write", () => {
  const hooks = JSON.parse(readFileSync(join(import.meta.dir, "hooks.json"), "utf8")).hooks.PostToolUse;
  const entry = hooks.find((h: any) => h.matcher === "Write");
  expect(JSON.stringify(entry)).toContain("hooks/handoff-saved.ts");
});
