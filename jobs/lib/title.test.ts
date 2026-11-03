import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { titleProblem } from "../../todo/lib/todo.ts";
import { writeTitle } from "./title.ts";

const dir = mkdtempSync(join(tmpdir(), "aleph-title-"));
const saved = process.env.ALEPH_RULE_CMD;
afterAll(() => { if (saved === undefined) delete process.env.ALEPH_RULE_CMD; else process.env.ALEPH_RULE_CMD = saved; rmSync(dir, { recursive: true, force: true }); });

/** A stand-in for `claude -p` that prints `line` as its result, or fails. */
function stub(line: string | null): void {
  const f = join(dir, `stub-${Math.random().toString(36).slice(2)}`);
  writeFileSync(f, line === null ? "#!/bin/sh\nexit 1\n" : `#!/bin/sh\nprintf '%s' ${JSON.stringify(JSON.stringify({ result: line }))}\n`, { mode: 0o755 });
  process.env.ALEPH_RULE_CMD = f;
}

const SOURCE = `Check run-42: ${"the gate drops a test that the worker changed and nobody sees it ".repeat(3).trim()}.`;

test("writeTitle gives a title that titleProblem accepts, whatever the model says", async () => {
  for (const line of ["x".repeat(90), "Check foo: bar", null]) {
    stub(line);
    const t = await writeTitle(SOURCE);
    expect(titleProblem(t)).toBeNull();
    expect(t.length).toBeGreaterThan(0);
  }
  expect(SOURCE.length).toBeGreaterThanOrEqual(150);
  stub("Fix the gate that drops a changed test");
  expect(await writeTitle(SOURCE)).toBe("Fix the gate that drops a changed test");
  stub(null);
  expect(await writeTitle(SOURCE)).toBe("the gate drops a test that the worker changed and nobody");
});
