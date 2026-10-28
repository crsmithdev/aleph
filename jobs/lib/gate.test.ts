import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reviewPrompt } from "./unit.ts";
import { heldRule, testFindings, verdict, outcome, tagged } from "./gate.ts";

let dir: string;
const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (...a: string[]) => Bun.spawnSync(["git", ...a], { cwd: dir, env, stdout: "pipe" }).stdout.toString().trim();
const put = (f: string, text: string) => { mkdirSync(join(dir, f, ".."), { recursive: true }); writeFileSync(join(dir, f), text); };

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "aleph-gate-"));
  git("init", "-q", "-b", "main");
  put("a.test.ts", 'test("a", () => {});\n');
  put("src/x.ts", "export const x = 1;\n");
  put("jobs/cli.ts", "// held\n");
  put("jobs/cli.test.ts", 'test("held", () => {});\n');
  git("add", "."); git("commit", "-qm", "init");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** The rule a branch made by `change` breaks. */
function rule(change: () => void): string | null {
  git("switch", "-q", "-C", "b", "main");
  change();
  git("add", "-A"); git("commit", "-qm", "change", "--allow-empty");
  return heldRule(dir, ["jobs/**"], "main", "b");
}

const findings = (change: () => void) => { rule(change); return testFindings(dir, "main", "b"); };

test("a held path that is not a test needs Chris; test changes are findings, not holds", () => {
  expect(rule(() => put("jobs/cli.ts", "// changed\n"))).toBe("held path jobs/cli.ts");
  expect(rule(() => git("rm", "-q", "a.test.ts"))).toBeNull();
  expect(findings(() => git("rm", "-q", "a.test.ts"))).toEqual(["deletes the test a.test.ts"]);
  expect(findings(() => git("mv", "a.test.ts", "b.test.ts"))).toEqual(["renames the test a.test.ts to b.test.ts"]);
  expect(findings(() => put("a.test.ts", 'test("a", () => { expect(1).toBe(1); });\n'))).toEqual(["changes the test a.test.ts"]);
  expect(findings(() => put("tests/new.test.ts", 'test.skip("later", () => {});\n'))).toEqual(["adds .skip, .only or .todo in tests/new.test.ts"]);
});

test("additions to an existing test give no finding, also under a held path", () => {
  expect(findings(() => put("a.test.ts", 'const run = () => 1;\ntest("a", () => {});\ntest("b", () => { expect(run()).toBe(1); });\n'))).toEqual([]);
  expect(findings(() => put("jobs/cli.test.ts", 'test("held", () => {});\ntest("more", () => {});\n'))).toEqual([]);
  expect(rule(() => put("jobs/cli.test.ts", 'test("held", () => { expect(1).toBe(2); });\n'))).toBeNull();
  expect(findings(() => put("a.test.ts", 'test("a", () => {});\ntest.only("b", () => {});\n'))).toEqual(["adds .skip, .only or .todo in a.test.ts"]);
});

test("the reviewer prompt names a deleted test; without findings it has no test section", () => {
  const f = findings(() => git("rm", "-q", "a.test.ts"));
  expect(reviewPrompt("n", "goal", "diff", f)).toContain("The diff deletes the test a.test.ts");
  expect(reviewPrompt("n", "goal", "diff", [])).not.toContain("Test changes");
});

test("new code and a new test pass the gate", () => {
  expect(findings(() => { put("src/y.ts", "export const y = 2;\n"); put("src/y.test.ts", 'test("y", () => {});\n'); })).toEqual([]);
});

test("only a last line that is a result event with is_error false is a finished run", () => {
  const ok = '{"type":"result","is_error":false,"total_cost_usd":0.5,"result":"done\\nDEFAULT: a? -> b"}';
  expect(outcome(`{"type":"assistant"}\n${ok}\n`)).toMatchObject({ ok: true, cost: 0.5, result: "done\nDEFAULT: a? -> b" });
  expect(outcome(`${ok}\nafter\n`)).toMatchObject({ ok: false, line: "after" });
  expect(outcome('{"type":"result","is_error":true,"result":"API Error"}')).toMatchObject({ ok: false, line: "API Error" });
  expect(outcome('{"type":"result","result":"no flag"}').ok).toBe(false);
  expect(outcome("")).toMatchObject({ ok: false, line: "no output" });
  expect(tagged("x\n DEFAULT: a? -> b\nDEFAULT:\nFOLLOWUP: c", "DEFAULT")).toEqual(["a? -> b"]);
});

test("the reviewer's verdict is its last VERDICT line", () => {
  expect(verdict("Looked.\nVERDICT: pass")).toEqual({ pass: true });
  expect(verdict("VERDICT: hold tests do not cover the flag")).toEqual({ pass: false, reason: "tests do not cover the flag" });
  expect(verdict("VERDICT: hold a\nVERDICT: pass")).toEqual({ pass: true });
  expect(verdict("VERDICT: hold")).toEqual({ pass: false, reason: "no reason given" });
  expect(verdict("no verdict here")).toBeNull();
  expect(verdict("VERDICT: maybe")).toBeNull();
  expect(verdict("VERDICT: holdup")).toBeNull();
  expect(verdict("")).toBeNull();
});
