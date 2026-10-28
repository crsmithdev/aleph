import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ALREADY_MET, alreadyMet } from "./gate.ts";
import { prompt } from "./unit.ts";

const dir = mkdtempSync(join(tmpdir(), "unit-prompt-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("the sandbox prompt tells the worker to print the marker the already-met parser reads", () => {
  mkdirSync(join(dir, "run-1"), { recursive: true });
  mkdirSync(join(dir, "job-x"), { recursive: true });
  writeFileSync(join(dir, "job-x", "spec.md"), "# a goal\n");
  const run = { name: "job-x", job: "job-x", branch: "factory/job-x", kind: "agent", state: "running" } as any;
  const text = prompt("run-1", join(dir, "run-1"), run, { sandbox: true, main: "main" } as any);
  const line = text.split("\n").join(" ").match(/print exactly one line `([^`]*)`/)?.[1] ?? "";
  expect(line.startsWith(`${ALREADY_MET}:`)).toBe(true);
  expect(alreadyMet(line.replace("<evidence>", "foo.ts:3, abc123"))).toBe("foo.ts:3, abc123");
  expect(prompt("run-1", join(dir, "run-1"), run, { sandbox: false, main: "main" } as any)).not.toContain(ALREADY_MET);
});
