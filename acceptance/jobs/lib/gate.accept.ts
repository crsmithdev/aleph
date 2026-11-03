// Archived goal tests from jobs/lib/gate.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reviewPrompt } from "../../../jobs/lib/unit.ts";
import { verdict, outcome, alreadyMet } from "../../../jobs/lib/gate.ts";

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



test("the reviewer prompt asks for the verdict first, fail-only CHECK lines with a reason, a count of passes, and at most 80 words outside them", () => {
  const p = reviewPrompt("n", "goal", "diff", []);
  expect(p).toContain("each Oracle clause");
  expect(p).toContain("each requirement in the Goal section");
  expect(p).toContain("each sealed scenario");
  expect(p).toContain("Write the verdict first, in one sentence");
  expect(p).toContain("CHECK: fail <clause>: <what was observed>");
  expect(p).toContain("one line for each failure only, each with its reason");
  expect(p).toContain("Do not write a CHECK line for a pass");
  expect(p).toContain("count, such as `7 of 9 passed`");
  expect(p).toContain("at most 80 words");
  expect(p).toContain("does not repeat the CHECK lines");
  expect(p).not.toContain("pass|fail");
  expect(p).toContain("names every");
  expect(p).toContain("not only the first one");
  const s = reviewPrompt("n", "goal", "diff", [], "1. a scenario");
  expect(s).toContain("do not quote or mention the scenarios");
  expect(s).toContain("marked by its number only");
});

test("the reason is the result event's text, not a command_lifecycle line after it", () => {
  const life = '{"type":"command_lifecycle","phase":"end"}';
  const failed = '{"type":"result","is_error":true,"result":"Goal: Already met\\nmain has it"}';
  expect(outcome(`${failed}\n${life}\n`)).toMatchObject({ ok: false, line: "Goal: Already met\nmain has it" });
  expect(outcome(`${failed}\n${life}\n${life}\n`)).toMatchObject({ ok: false, line: "Goal: Already met\nmain has it" });
  expect(outcome(`${life}\n`)).toMatchObject({ ok: false, line: "no output" });
  expect(outcome(`{"type":"result","is_error":false,"result":"done"}\n${life}\n`)).toMatchObject({ ok: true, result: "done" });
});

test("a worker's claim that the goal is already met is its last such line, with the reason", () => {
  expect(alreadyMet("Looked.\nGoal: Already met — timeline.ts uses itemTimes")).toBe("timeline.ts uses itemTimes");
  expect(alreadyMet("goal: already met\nGoal: Already met: main has it")).toBe("main has it");
  expect(alreadyMet("Goal: Already met")).toBe("no reason given");
  expect(alreadyMet("Goal: Already met elsewhere\nDone.")).toBe("elsewhere");
  expect(alreadyMet("Goal: Already metal")).toBeNull();
  expect(alreadyMet("Goal: not met yet")).toBeNull();
  expect(alreadyMet("")).toBeNull();
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
  expect(verdict("CHECK: pass x: ok\nCHECK: fail y: bad\nCHECK: fail scenario 2: bad\nVERDICT: hold a; b")).toEqual({ pass: false, reason: "a; b" });
});
