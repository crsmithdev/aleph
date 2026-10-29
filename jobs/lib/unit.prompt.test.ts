import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ALREADY_MET, alreadyMet } from "./gate.ts";
import { parseFacts } from "./facts.ts";
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

test("the sandbox prompt asks for FACT lines that parseFacts reads; the other prompt does not", () => {
  mkdirSync(join(dir, "run-2"), { recursive: true });
  mkdirSync(join(dir, "job-y"), { recursive: true });
  writeFileSync(join(dir, "job-y", "spec.md"), "# a goal\n");
  const run = { name: "job-y", job: "job-y", branch: "factory/job-y", kind: "agent", state: "running" } as any;
  const text = prompt("run-2", join(dir, "run-2"), run, { sandbox: true, main: "main" } as any);
  const line = text.split("\n").map((l) => l.trim()).find((l) => l.startsWith("`FACT:")) ?? "";
  expect(line).toContain("[source:");
  const filled = line.replace(/^`/, "").replace(/`.*$/, "").replace("<one sentence>", "x is y").replace(/\[source: [^\]]*\]/, "[source: a/b.ts:3]");
  expect(parseFacts(filled).facts).toEqual([{ fact: "x is y", source: "a/b.ts:3" }]);
  expect(prompt("run-2", join(dir, "run-2"), run, { sandbox: false, main: "main" } as any)).not.toContain("FACT:");
});

test("the sandbox prompt names aleph-shot and its options; the other prompt does not", () => {
  mkdirSync(join(dir, "run-3"), { recursive: true });
  mkdirSync(join(dir, "job-z"), { recursive: true });
  writeFileSync(join(dir, "job-z", "spec.md"), "# a goal\n");
  const run = { name: "job-z", job: "job-z", branch: "factory/job-z", kind: "agent", state: "running" } as any;
  const text = prompt("run-3", join(dir, "run-3"), run, { sandbox: true, main: "main" } as any);
  for (const w of ["aleph-shot", "--width", "--height", "--scheme", "--click", "--wait"]) expect(text).toContain(w);
  expect(prompt("run-3", join(dir, "run-3"), run, { sandbox: false, main: "main" } as any)).not.toContain("aleph-shot");
});
