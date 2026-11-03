// Archived goal tests from jobs/lib/unit.prompt.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brief as prompt } from "../../../jobs/lib/continuation.ts";

const dir = mkdtempSync(join(tmpdir(), "unit-prompt-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("the sandbox prompt names aleph-shot and its options; the other prompt does not", () => {
  mkdirSync(join(dir, "run-3"), { recursive: true });
  mkdirSync(join(dir, "job-z"), { recursive: true });
  writeFileSync(join(dir, "job-z", "spec.md"), "# a goal\n");
  const run = { name: "job-z", job: "job-z", branch: "factory/job-z", kind: "build", condition: "running" } as any;
  const text = prompt("run-3", join(dir, "run-3"), run, { sandbox: true, main: "main" } as any);
  for (const w of ["aleph-shot", "--width", "--height", "--scheme", "--click", "--wait"]) expect(text).toContain(w);
  expect(prompt("run-3", join(dir, "run-3"), run, { sandbox: false, main: "main" } as any)).not.toContain("aleph-shot");
});
