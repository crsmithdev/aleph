import { afterAll, expect, setSystemTime, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { titleProblem } from "../../../issues/lib/todo.ts";
import { gpuSlot } from "../gates/factory-status.ts";
import { setModel } from "../routing/models.ts";
import { writeTitle } from "./title.ts";

const dir = mkdtempSync(join(tmpdir(), "aleph-title-"));
const KEYS = ["ALEPH_RULE_CMD", "ALEPH_JOBS_DIR", "XDG_RUNTIME_DIR"];
const savedKeys = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
// The GPU slot reads the live runs and a lock: both stay in the temp folder.
Object.assign(process.env, { ALEPH_JOBS_DIR: join(dir, "jobs"), XDG_RUNTIME_DIR: join(dir, "run") });
afterAll(() => { for (const k of KEYS) if (savedKeys[k] === undefined) delete process.env[k]; else process.env[k] = savedKeys[k]; rmSync(dir, { recursive: true, force: true }); });

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
    expect(setModel("title", { model: "gpt-oss-20b" })).toBeNull();
    await writeTitle(SOURCE);
    expect(readFileSync(join(dir, "args"), "utf8")).toContain("--model gpt-oss-20b");
    expect(readFileSync(join(dir, "env"), "utf8")).toContain("ANTHROPIC_BASE_URL=http://127.0.0.1:8012");
    expect(setModel("title", { model: "haiku" })).toBeNull();
    await writeTitle(SOURCE);
    expect(readFileSync(join(dir, "args"), "utf8")).toContain("--model haiku");
    expect(readFileSync(join(dir, "env"), "utf8")).not.toContain("ANTHROPIC_BASE_URL");
  } finally {
    if (saved === undefined) delete process.env.ALEPH_FACTORY_DIR; else process.env.ALEPH_FACTORY_DIR = saved;
  }
});

test("when the GPU slot stays taken past the title call's time box, the title comes from Claude and the log records the fallback", async () => {
  const saved = process.env.ALEPH_FACTORY_DIR;
  process.env.ALEPH_FACTORY_DIR = join(dir, "factory-busy");
  const f = join(dir, "record-busy");
  writeFileSync(f, `#!/bin/sh\necho "$@" > ${join(dir, "args-busy")}\nprintf '%s' '{"result":"A title from Claude"}'\n`, { mode: 0o755 });
  process.env.ALEPH_RULE_CMD = f;
  const T0 = Date.parse("2026-11-04T00:00:00Z");
  setSystemTime(T0);
  const release = (await gpuSlot(0))!;
  try {
    expect(setModel("title", { model: "gpt-oss-20b" })).toBeNull();
    const title = writeTitle(SOURCE);
    setSystemTime(T0 + 31_000); // the 30 s box ends while the slot stays taken
    expect(await title).toBe("A title from Claude");
    expect(readFileSync(join(dir, "args-busy"), "utf8")).toContain("--model haiku");
    expect(readFileSync(join(dir, "factory-busy", "tick.log"), "utf8")).toContain("title: the GPU slot stayed taken for 30 s; the call falls back to Claude");
  } finally {
    release();
    setSystemTime();
    if (saved === undefined) delete process.env.ALEPH_FACTORY_DIR; else process.env.ALEPH_FACTORY_DIR = saved;
  }
});
