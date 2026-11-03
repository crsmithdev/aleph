import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseFacts } from "./facts.ts";
import { brief as prompt } from "./continuation.ts";

const dir = mkdtempSync(join(tmpdir(), "unit-prompt-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("the sandbox prompt asks for FACT lines that parseFacts reads; the other prompt does not", () => {
  mkdirSync(join(dir, "run-2"), { recursive: true });
  mkdirSync(join(dir, "job-y"), { recursive: true });
  writeFileSync(join(dir, "job-y", "spec.md"), "# a goal\n");
  const run = { name: "job-y", job: "job-y", branch: "factory/job-y", kind: "build", condition: "running" } as any;
  const text = prompt("run-2", join(dir, "run-2"), run, { sandbox: true, main: "main" } as any);
  const line = text.split("\n").map((l) => l.trim()).find((l) => l.startsWith("`FACT:")) ?? "";
  expect(line).toContain("[source:");
  const filled = line.replace(/^`/, "").replace(/`.*$/, "").replace("<one sentence>", "x is y").replace(/\[source: [^\]]*\]/, "[source: a/b.ts:3]");
  expect(parseFacts(filled).facts).toEqual([{ fact: "x is y", source: "a/b.ts:3" }]);
  expect(prompt("run-2", join(dir, "run-2"), run, { sandbox: false, main: "main" } as any)).not.toContain("FACT:");
});
