import { expect, test } from "bun:test";
import { scan, tools } from "./content.ts";

const checks = (text: string) => scan(text).hits.map((h) => `${h.line}:${h.check}`);

test("flags emphasis, scaffolding, vague bars, unreasoned rules and dated text", () => {
  expect(checks("IMPORTANT: run the tests.")).toEqual(["1:emphasis"]);
  expect(checks("Think hard about it.")).toEqual(["1:scaffold"]);
  expect(checks("Format the output properly.")).toEqual(["1:vague"]);
  expect(checks("- Never push to main.")).toEqual(["1:unreasoned"]);
  expect(checks("As of today the API is v2.")).toEqual(["1:dated"]);
});

test("a rule with a reason, a negation inside a clause, and code pass", () => {
  expect(checks("Never push to main, because CI deploys it.")).toEqual([]);
  expect(checks("Never push to main: CI deploys it.")).toEqual([]);
  expect(checks("Say what you don't know.")).toEqual([]);
  expect(checks("Run `NEVER=1 make` here.")).toEqual([]);
  expect(checks("```\nIMPORTANT\n```\nok")).toEqual([]);
});

test("line numbers hold across fences", () => {
  expect(checks("a\n```\nx\n```\nTry to be brief.")).toEqual(["5:vague"]);
});

test("names each program a command shows, not a lone word in code", () => {
  expect(tools("Run `git status`, then `bun test`. The `config` key.\n```sh\nls -la\n```")).toEqual(["bun", "git", "ls"]);
});
