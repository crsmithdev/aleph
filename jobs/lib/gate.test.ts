import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { heldRule, outcome, tagged } from "./gate.ts";

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

test("a held path, a deleted, renamed or changed test, or an added .skip each need Chris", () => {
  expect(rule(() => put("jobs/cli.ts", "// changed\n"))).toBe("held path jobs/cli.ts");
  expect(rule(() => git("rm", "-q", "a.test.ts"))).toBe("deletes the test a.test.ts");
  expect(rule(() => git("mv", "a.test.ts", "b.test.ts"))).toBe("renames the test a.test.ts to b.test.ts");
  expect(rule(() => put("a.test.ts", 'test("a", () => { expect(1).toBe(1); });\n'))).toBe("changes the test a.test.ts");
  expect(rule(() => put("tests/new.test.ts", 'test.skip("later", () => {});\n'))).toBe("adds .skip, .only or .todo in tests/new.test.ts");
});

test("additions to an existing test pass the gate, also under a held path", () => {
  expect(rule(() => put("a.test.ts", 'const run = () => 1;\ntest("a", () => {});\ntest("b", () => { expect(run()).toBe(1); });\n'))).toBeNull();
  expect(rule(() => put("jobs/cli.test.ts", 'test("held", () => {});\ntest("more", () => {});\n'))).toBeNull();
  expect(rule(() => put("a.test.ts", 'test("a", () => {});\ntest.only("b", () => {});\n'))).toBe("adds .skip, .only or .todo in a.test.ts");
  expect(rule(() => put("jobs/cli.test.ts", 'test("held", () => { expect(1).toBe(2); });\n'))).toBe("changes the test jobs/cli.test.ts");
});

test("new code and a new test pass the gate", () => {
  expect(rule(() => { put("src/y.ts", "export const y = 2;\n"); put("src/y.test.ts", 'test("y", () => {});\n'); })).toBeNull();
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
