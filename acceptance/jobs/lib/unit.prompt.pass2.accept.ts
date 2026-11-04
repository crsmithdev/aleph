// Archived goal tests from jobs/lib/unit.prompt.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ALREADY_MET, alreadyMet } from "../../../jobs/lib/gate.ts";
import { brief as prompt } from "../../../jobs/lib/continuation.ts";

const dir = mkdtempSync(join(tmpdir(), "unit-prompt-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("the sandbox prompt tells the worker to print the marker the already-met parser reads", () => {
  mkdirSync(join(dir, "run-1"), { recursive: true });
  mkdirSync(join(dir, "job-x"), { recursive: true });
  writeFileSync(join(dir, "job-x", "spec.md"), "# a goal\n");
  const run = { name: "job-x", job: "job-x", branch: "factory/job-x", kind: "build", condition: "running" } as any;
  const text = prompt("run-1", join(dir, "run-1"), run, { sandbox: true, main: "main" } as any);
  const line = text.split("\n").join(" ").match(/print exactly one line `([^`]*)`/)?.[1] ?? "";
  expect(line.startsWith(`${ALREADY_MET}:`)).toBe(true);
  expect(alreadyMet(line.replace("<evidence>", "foo.ts:3, abc123"))).toBe("foo.ts:3, abc123");
  expect(prompt("run-1", join(dir, "run-1"), run, { sandbox: false, main: "main" } as any)).not.toContain(ALREADY_MET);
});

test("the sandbox prompt lists the repo's checks, or keeps the tests sentence without any", () => {
  mkdirSync(join(dir, "run-4"), { recursive: true });
  mkdirSync(join(dir, "job-c"), { recursive: true });
  writeFileSync(join(dir, "job-c", "spec.md"), "# a goal\n");
  const run = { name: "job-c", job: "job-c", branch: "factory/job-c", kind: "build", condition: "running" } as any;
  const checks = [{ name: "tests", run: "bun run test" }, { name: "types", run: "bunx tsc --noEmit -p ." }];
  const withChecks = prompt("run-4", join(dir, "run-4"), run, { sandbox: true, main: "main", checks } as any);
  expect(withChecks).toContain("bun run test");
  expect(withChecks).toContain("bunx tsc --noEmit -p .");
  expect(withChecks).not.toContain("Run the repo's tests before you end.");
  const none = prompt("run-4", join(dir, "run-4"), run, { sandbox: true, main: "main", checks: [] } as any);
  expect(none).toContain("Run the repo's tests before you end.");
});

test("the sandbox prompt sends a clause the worker cannot meet to a QUESTION line, not DEFAULT or FOLLOWUP", () => {
  mkdirSync(join(dir, "run-5"), { recursive: true });
  mkdirSync(join(dir, "job-q"), { recursive: true });
  writeFileSync(join(dir, "job-q", "spec.md"), "# a goal\n");
  const run = { name: "job-q", job: "job-q", branch: "factory/job-q", kind: "build", condition: "running" } as any;
  const text = prompt("run-5", join(dir, "run-5"), run, { sandbox: true, main: "main" } as any).replace(/\s+/g, " ");
  expect(text).toContain("`QUESTION: <question that names the clause>`");
  expect(text).toContain("cannot meet a clause of the Oracle");
  expect(text).toContain("never defer that clause with `DEFAULT:` or `FOLLOWUP:`");
  expect(text).toContain("`FOLLOWUP: <title>`; it must not cover anything the Oracle names");
  expect(text).toContain("For a choice the Oracle does not settle, take the answer you would recommend and print `DEFAULT:");
  expect(text).toContain("DEFAULT:");
  expect(text).toContain("FOLLOWUP:");
});

test("the worker brief asks for a result of at most 120 words of prose, plus a list only for separate items", () => {
  const dir = mkdtempSync(join(tmpdir(), "brief-"));
  try {
    mkdirSync(join(dir, "job-w"), { recursive: true });
    writeFileSync(join(dir, "job-w", "spec.md"), "# a goal\n");
    const run = { name: "job-w", job: "job-w", branch: "factory/job-w", kind: "build", condition: "running" } as any;
    for (const sandbox of [true, false]) {
      const text = prompt("run-w", join(dir, "run-w"), run, { sandbox, main: "main" } as any);
      expect(text).toContain("at most 120 words of prose, plus a list only for separate items");
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
