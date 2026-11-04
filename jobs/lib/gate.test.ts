import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reviewPrompt } from "./unit.ts";
import { heldRule, securityChange, testFindings, outcome, parseReview, parseWorker, replyOf } from "./gate.ts";

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

test("a security path is found by name, also when a rename takes it away; its test is not one", () => {
  const on = (change: () => void) => { rule(change); return securityChange(dir, "main", "b"); };
  git("switch", "-q", "main");
  put("jobs/lib/gate.ts", "// the gate\n".repeat(20));
  git("add", "-A"); git("commit", "-qm", "gate");
  expect(on(() => put("jobs/lib/gate.ts", "// changed\n"))).toBe("jobs/lib/gate.ts");
  expect(on(() => git("mv", "jobs/lib/gate.ts", "jobs/lib/box.ts"))).toBe("jobs/lib/gate.ts");
  expect(on(() => put("hooks/any.ts", "x\n"))).toBe("hooks/any.ts");
  expect(on(() => put("package.json", "{}\n"))).toBe("package.json");
  expect(on(() => put("identity/CLAUDE.md", "x\n"))).toBe("identity/CLAUDE.md");
  expect(on(() => put("jobs/lib/gate.test.ts", "x\n"))).toBeNull();
  expect(on(() => put("jobs/cli.ts", "// changed\n"))).toBeNull();
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
  const p = reviewPrompt("n", "goal", "diff", []);
  expect(p).toContain("ran the checks that this change reaches");
  expect(p).toContain("they passed");
  // The reviewer judges by the code-review skill, given as text: no frontmatter, and no Skill tool.
  expect(p).toContain("## Review method\n\nAdapted from the review rubric");
  expect(p).not.toContain("name: code-review");
  expect(p).toContain("Do not change tracked files.");
  expect(p).toContain("Do not run the full test suite");
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
});

test("replyOf reads the text and the cost of a result event; other stdout is the text", () => {
  const stream = '{"type":"system","subtype":"init"}\n{"type":"result","is_error":false,"total_cost_usd":0.25,"result":"{\\"route\\":\\"close\\"}"}\n';
  expect(replyOf(stream)).toEqual({ text: '{"route":"close"}', cost: 0.25 });
  expect(replyOf('{"type":"result","is_error":true,"total_cost_usd":0.1,"result":""}')).toEqual({ text: "", cost: 0.1 });
  expect(replyOf('Looked at it. {"route":"close"}\n')).toEqual({ text: 'Looked at it. {"route":"close"}\n' });
  expect(replyOf('{"route":"close"}\n')).toEqual({ text: '{"route":"close"}\n' });
});

test("parseReview names the failed clauses as the reason, and gives review.json and review.md", () => {
  const hold = parseReview({ verdict: "hold", summary: "Two fail.", failures: [{ clause: "flag test", observed: "none" }, { clause: "doc line", observed: "exit 1" }] });
  expect(hold).toMatchObject({ pass: false, reason: "flag test; doc line" });
  const text = (hold as { text: string }).text;
  expect(text).toBe("Two fail.\n\nCHECK: fail flag test: none\nCHECK: fail doc line: exit 1\nVERDICT: hold flag test; doc line\n");
  expect((hold as { json: object }).json).toEqual({ verdict: "hold", summary: "Two fail.", failures: [{ clause: "flag test", observed: "none" }, { clause: "doc line", observed: "exit 1" }] });
  expect(parseReview({ verdict: "pass", summary: "9 of 9 passed.", failures: [] })).toMatchObject({ pass: true, json: { verdict: "pass", summary: "9 of 9 passed.", failures: [] } });
  expect(parseReview(undefined)).toBe("no structured output");
  expect(parseReview({ verdict: "maybe" })).toBe('unknown verdict "maybe"');
});

test("parseWorker turns the worker's fields into the run's facts, and a reply with none into a reason", () => {
  expect(parseWorker({
    summary: "Done.", defaults: [{ choice: "which colour?", chose: "blue" }], followups: [{ title: "paint the fence" }],
    flakes: [{ file: "a.test.ts", name: "slow one", what: "timed out" }], already_met: { evidence: "abc123 has it" }, question: "which clause wins?",
  })).toEqual({ summary: "Done.", defaults: ["which colour? -> blue"], followups: ["paint the fence"], flakes: ["a.test.ts > slow one: timed out"], alreadyMet: "abc123 has it", question: "which clause wins?" });
  expect(parseWorker({ summary: "x", defaults: [], followups: [], flakes: [], already_met: null, question: null })).toMatchObject({ alreadyMet: null, question: null });
  expect(parseWorker(undefined)).toBe("no structured output");
  expect(parseWorker({ defaults: [] })).toBe("no summary");
});
