import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { passed, type Plan } from "./keep-earn.ts";

test("passed decodes the entities of a junit case name", () => {
  const dir = mkdtempSync(join(tmpdir(), "keep-earn-"));
  writeFileSync(join(dir, ".keep-earn.xml"), `<testsuites><testsuite name="a.test.ts"><testcase name="a &quot;b&quot; &amp; c" classname="x" file="a.test.ts"/></testsuite></testsuites>`);
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    expect(passed(["a.test.ts"])?.has(`a.test.ts > a "b" & c`)).toBe(true);
  } finally {
    process.chdir(cwd);
  }
});

/** Runs the script on `plan` in a fresh folder that holds src.ts and t.test.ts, and returns its KEEP-EARN result and src.ts as the script left it. */
function earn(plan: Omit<Plan, "cases" | "files">) {
  const dir = mkdtempSync(join(tmpdir(), "keep-earn-"));
  writeFileSync(join(dir, "src.ts"), SRC);
  writeFileSync(join(dir, "t.test.ts"), `import { expect, test } from "bun:test";
import { add, sub } from "./src.ts";
test("adds", () => { expect(add(1, 2)).toBe(3); });
test("adds loosely", () => { add(1, 2); });
test("subtracts loosely", () => { sub(3, 1); });
test("does nothing", () => {});
`);
  const cases = ["adds", "adds loosely", "subtracts loosely", "does nothing"].map((name) => ({ file: "t.test.ts", name }));
  writeFileSync(join(dir, "plan.json"), JSON.stringify({ cases, files: ["t.test.ts"], ...plan }));
  const p = Bun.spawnSync(["bun", join(import.meta.dir, "keep-earn.ts"), "plan.json"], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  const last = p.stdout.toString().trim().split("\n").at(-1)!;
  const src = readFileSync(join(dir, "src.ts"), "utf8");
  rmSync(dir, { recursive: true, force: true });
  expect(last).toStartWith("KEEP-EARN ");
  return { out: JSON.parse(last.slice("KEEP-EARN ".length)), src };
}
const SRC = "export function add(a: number, b: number) {\n  return a + b;\n}\nexport function sub(a: number, b: number) {\n  return a - b;\n}\n";

test("with no mutant, a case earns its keep when it runs a changed line beyond the load of the modules", () => {
  const { out } = earn({ changed: { "src.ts": [2, 5] }, mutants: [] });
  expect(out).toEqual({ unearned: ["t.test.ts > does nothing"], mutants: 0 });
});

test("with mutants, a case earns its keep when it alone covers a changed line or fails on a mutant, and each mutated file is put back", () => {
  const { out, src } = earn({ changed: { "src.ts": [2, 5] }, mutants: [{ path: "src.ts", line: 2, text: "  return a * b;" }] });
  // "adds" fails on the mutant; "subtracts loosely" alone covers line 5; "adds loosely" shares line 2 and passes on the mutant.
  expect(out).toEqual({ unearned: ["t.test.ts > adds loosely", "t.test.ts > does nothing"], mutants: 1 });
  expect(src).toBe(SRC);
});
