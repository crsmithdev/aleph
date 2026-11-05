import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { titleProblem } from "../../todo/lib/todo.ts";
import { setModel } from "./models.ts";
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

test("a title slot set to local runs claude on gpt-oss-20b at the local base URL, and a claude slot on haiku", async () => {
  const saved = process.env.ALEPH_FACTORY_DIR;
  process.env.ALEPH_FACTORY_DIR = join(dir, "factory");
  const f = join(dir, "record");
  writeFileSync(f, `#!/bin/sh\necho "$@" > ${join(dir, "args")}\nenv > ${join(dir, "env")}\nprintf '%s' '{"result":"A title"}'\n`, { mode: 0o755 });
  process.env.ALEPH_RULE_CMD = f;
  try {
    expect(setModel("title", "local")).toBeNull();
    await writeTitle(SOURCE);
    expect(readFileSync(join(dir, "args"), "utf8")).toContain("--model gpt-oss-20b");
    expect(readFileSync(join(dir, "env"), "utf8")).toContain("ANTHROPIC_BASE_URL=http://127.0.0.1:8081");
    expect(setModel("title", "claude")).toBeNull();
    await writeTitle(SOURCE);
    expect(readFileSync(join(dir, "args"), "utf8")).toContain("--model haiku");
    expect(readFileSync(join(dir, "env"), "utf8")).not.toContain("ANTHROPIC_BASE_URL");
  } finally {
    if (saved === undefined) delete process.env.ALEPH_FACTORY_DIR; else process.env.ALEPH_FACTORY_DIR = saved;
  }
});
