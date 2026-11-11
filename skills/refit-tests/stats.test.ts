import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flakes, growth, lost, runtime, smells } from "./stats.ts";

const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
let root: string;

const sh = (args: string[], extra: Record<string, string> = {}) => {
  const p = Bun.spawnSync(args, { cwd: root, env: { ...env, ...extra }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
};
const write = (file: string, text: string) => {
  mkdirSync(join(root, file, ".."), { recursive: true });
  writeFileSync(join(root, file), text);
};
const commit = (date: string) => {
  sh(["git", "add", "-A"]);
  sh(["git", "commit", "-qm", date], { GIT_AUTHOR_DATE: `${date}T12:00:00Z`, GIT_COMMITTER_DATE: `${date}T12:00:00Z` });
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "refit-tests-"));
  sh(["git", "init", "-q", "-b", "main"]);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

test("runtime gives the percentiles, the slowest test and the tests with no assertion", () => {
  const xml = `<testsuites time="3.5"><testsuite>
    <testcase name="a &amp; b" file="x.test.ts" line="3" time="0.1" assertions="2" />
    <testcase name="slow" file="x.test.ts" line="9" time="3" assertions="1" />
    <testcase name="empty" file="y.test.ts" line="1" time="0.2" assertions="0" />
  </testsuite></testsuites>`;
  const r = runtime(xml, 1);
  expect(r).toMatchObject({ tests: 3, wall: 3.5, sum: 3.3, p50: 0.2, max: 3, topShare: 0.909 });
  expect(r.slowest).toEqual([{ name: "slow", file: "x.test.ts", line: 9, s: 3 }]);
  expect(r.slowestFiles).toEqual([{ file: "x.test.ts", tests: 2, s: 3.1 }]);
  expect(r.noAsserts).toEqual([{ name: "empty", file: "y.test.ts", line: 1 }]);
});

test("growth counts the test files and cases at each month's end, and the files added that month", () => {
  write("a.ts", "export const a = 1;\n");
  write("a.test.ts", 'test("one", () => {});\n');
  commit("2026-09-10");
  write("b.test.ts", 'test("two", () => {});\ntest.skip("three", () => {});\n');
  commit("2026-10-05");
  const { months } = growth(root, 2, new Date(Date.UTC(2026, 9, 20)));
  expect(months.map((m) => [m!.month, m!.testFiles, m!.cases, m!.skipped, m!.added])).toEqual([
    ["2026-09", 1, 1, 0, 1],
    ["2026-10", 2, 3, 1, 1],
  ]);
});

test("smells finds each rule in test files only, and a function named fit is not a focused test", () => {
  // Built from parts so that the clock lint and the commit scan do not read this file as a sleep or a focused test.
  const nap = "await Bun.sle" + "ep(50);";
  write("a.test.ts", [nap, "test.on" + 'ly("x", () => {});', "const y = fit(rows, 3);", "expect(true).toBe(true);"].join("\n"));
  write("a.ts", nap);
  commit("2026-10-01");
  const { files, counts, hits } = smells(root);
  expect(files).toBe(1);
  expect(hits.map((h) => [h.rule, h.at])).toEqual([
    ["sleep", "a.test.ts:1"],
    ["focused test", "a.test.ts:2"],
    ["always-true assertion", "a.test.ts:4"],
  ]);
  expect(counts["focused test"]).toBe(1);
});

test("flakes groups aleph's rows for the repo by test, most often first", () => {
  const home = join(root, "home");
  write("home/factory/flaky.json", JSON.stringify([
    { repo: "r", check: "test", run: "j1", at: "2026-10-01T00:00:00Z", tests: ["a > b"] },
    { repo: "r", check: "test", run: "j2", at: "2026-10-03T00:00:00Z", tests: ["a > b", "c"] },
    { repo: "other", check: "test", run: "j3", at: "2026-10-04T00:00:00Z", tests: ["c"] },
  ]));
  const was = process.env.ALEPH_FACTORY_DIR;
  process.env.ALEPH_FACTORY_DIR = join(home, "factory");
  try {
    expect(flakes("r").tests).toEqual([
      { test: "a > b", count: 2, first: "2026-10-01", last: "2026-10-03", runs: ["j1", "j2"] },
      { test: "c", count: 1, first: "2026-10-03", last: "2026-10-03", runs: ["j2"] },
    ]);
  } finally {
    if (was === undefined) delete process.env.ALEPH_FACTORY_DIR;
    else process.env.ALEPH_FACTORY_DIR = was;
  }
});

test("lost gives the lines that only the removed tests covered", () => {
  const before = "SF:a.ts\nDA:1,3\nDA:2,1\nDA:3,0\nend_of_record\nSF:b.ts\nDA:1,1\nend_of_record\n";
  const after = "SF:a.ts\nDA:1,2\nDA:2,0\nDA:3,0\nend_of_record\nSF:b.ts\nDA:1,1\nend_of_record\n";
  expect(lost(before, after)).toEqual([{ file: "a.ts", lines: [2] }]);
  expect(lost(before, before)).toEqual([]);
});
