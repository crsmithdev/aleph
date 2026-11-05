import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brief as prompt } from "../transitions/continuation.ts";

const dir = mkdtempSync(join(tmpdir(), "unit-prompt-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("the fixed brief ends with the summary, then the tag lines, then QUESTION last; the factory brief asks for the `question` field and no tag line; neither tells the worker to merge main", () => {
  mkdirSync(join(dir, "job-y"), { recursive: true });
  writeFileSync(join(dir, "job-y", "spec.md"), "# a goal\n");
  const run = { name: "job-y", job: "job-y", branch: "factory/job-y", kind: "build", condition: "running" } as any;
  for (const sandbox of [true, false]) {
    const text = prompt("run-2", join(dir, "run-2"), run, { sandbox, main: "main" } as any);
    if (sandbox) {
      expect(text).toContain("set `question` to a question that names the clause");
      expect(text).not.toContain("QUESTION:");
    } else expect(text).toContain("After the summary come your tag lines, and the `QUESTION:` line, when you have one, is the last line.");
    expect(text).not.toContain("make your last line");
    expect(text).not.toContain("End the result with");
    expect(text).not.toContain("merge `origin/main`");
  }
});
