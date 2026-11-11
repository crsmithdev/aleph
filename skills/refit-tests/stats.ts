#!/usr/bin/env bun
/**
 * The numbers of a test retro, as JSON. No command runs the suite: each reads a report, the tree or git.
 *
 *   bun stats.ts runtime <junit.xml>     seconds per test: p50, p95, max, the slowest tests and files, zero-assertion tests
 *   bun stats.ts growth [--months 12]    per month: test files, test cases, test and source lines, files added and deleted
 *   bun stats.ts smells [path ...]       each test-file line that a rule of SMELLS.md or HERMETIC.md matches
 *   bun stats.ts flakes [--repo <key>]   aleph's flake rows per test: count, first and last seen
 *   bun stats.ts lcov <before> <after>   per source file, the lines covered before and not after
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isTestFile } from "../../jobs/lib/gates/test-files.ts";
import { loadRegistry } from "../../jobs/lib/records/ledger.ts";
import { git as run } from "../../lib/git.ts";
import { layout } from "../../lib/layout.ts";

export type Case = { name: string; file: string; line: number; s: number; asserts?: number };

const attr = (tag: string, key: string) => tag.match(new RegExp(`\\b${key}="([^"]*)"`))?.[1];
const unxml = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** Each test case of a JUnit report. `asserts` is set only when the runner writes it (bun does). */
export function cases(xml: string): Case[] {
  return [...xml.matchAll(/<testcase\b[^>]*>/g)].map(([tag]) => {
    const asserts = attr(tag, "assertions");
    return {
      name: unxml(attr(tag, "name") ?? ""),
      file: attr(tag, "file") ?? attr(tag, "classname") ?? "",
      line: Number(attr(tag, "line") ?? 0),
      s: Number(attr(tag, "time") ?? 0),
      ...(asserts === undefined ? {} : { asserts: Number(asserts) }),
    };
  });
}

/** The value at fraction `q` of sorted `xs`. */
const at = (xs: number[], q: number) => xs[Math.min(xs.length - 1, Math.floor(q * xs.length))] ?? 0;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** The runtime summary of a JUnit report. */
export function runtime(xml: string, top = 10) {
  const all = cases(xml);
  const secs = all.map((c) => c.s).sort((a, b) => a - b);
  const sum = secs.reduce((a, b) => a + b, 0);
  const files = Object.entries(Object.groupBy(all, (c) => c.file)).map(([file, cs]) => ({ file, tests: cs!.length, s: r3(cs!.reduce((a, c) => a + c.s, 0)) }));
  const slow = [...all].sort((a, b) => b.s - a.s).slice(0, top);
  return {
    tests: all.length,
    wall: Number(attr(xml.match(/<testsuites\b[^>]*>/)?.[0] ?? "", "time") ?? 0),
    sum: r3(sum),
    p50: at(secs, 0.5), p95: at(secs, 0.95), max: at(secs, 1),
    topShare: r3(slow.reduce((a, c) => a + c.s, 0) / (sum || 1)),
    slowest: slow.map(({ name, file, line, s }) => ({ name, file, line, s })),
    slowestFiles: files.sort((a, b) => b.s - a.s).slice(0, top),
    noAsserts: all.filter((c) => c.asserts === 0).map(({ name, file, line }) => ({ name, file, line })),
  };
}

const git = (cwd: string, ...args: string[]) => { const r = run(cwd, ...args); return r.ok ? r.out : ""; };

const SKIP = /(^|\/)(node_modules|vendor|dist|build|\.worktrees)\//;
const CODE = /\.([cm]?[jt]sx?|py|go|rs|rb|java|kt|swift|c|cc|cpp|h|hpp|cs|php)$/;
/** A test case opens: test(, it(, test.skip(, def test_, func Test. */
const CASE = String.raw`^\s*(test|it)(\.\w+)*\(|^\s*def test_|^func Test`;
const SKIPPED = String.raw`\b(test|it|describe)\.(skip|todo)\b|\bxit\(|@pytest\.mark\.skip|t\.Skip\(`;

/** Per file at `rev`, the count of lines that match `re` ("" counts every line). */
function counts(cwd: string, rev: string, re: string): Map<string, number> {
  const out = git(cwd, "grep", "-cE", re || "^", rev, "--");
  return new Map(out.split("\n").filter(Boolean).map((l) => {
    const [, path, n] = l.match(/^[^:]+:(.+):(\d+)$/)!;
    return [path, Number(n)] as const;
  }).filter(([p]) => CODE.test(p) && !SKIP.test(p)));
}

const total = (m: Map<string, number>, keep: (p: string) => boolean) => [...m].filter(([p]) => keep(p)).reduce((a, [, n]) => a + n, 0);

/** The last `months` calendar months to now, each as [first day, first day of the next], YYYY-MM-DD. */
function spans(months: number, now = new Date()): [string, string][] {
  const day = (k: number) => {
    const m = now.getUTCFullYear() * 12 + now.getUTCMonth() + k;
    return `${Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, "0")}-01`;
  };
  return Array.from({ length: months }, (_, i) => [day(i - months + 1), day(i - months + 2)]);
}

/** Per month: the tree at the month's end, and the test files added and deleted in the month. */
export function growth(cwd: string, months = 12, now = new Date()) {
  const rows = spans(months, now).map(([start, end]) => {
    const rev = git(cwd, "rev-list", "-1", `--before=${end}`, "HEAD").trim();
    if (!rev) return null;
    const lines = counts(cwd, rev, "");
    const changed = (f: string) => git(cwd, "log", `--since=${start}`, `--until=${end}`, `--diff-filter=${f}`, "--name-only", "--format=", "HEAD")
      .split("\n").filter((p) => p && isTestFile(p) && !SKIP.test(p)).length;
    const testLines = total(lines, isTestFile), srcLines = total(lines, (p) => !isTestFile(p));
    return {
      month: start.slice(0, 7),
      commit: rev.slice(0, 8),
      testFiles: [...lines.keys()].filter(isTestFile).length,
      cases: total(counts(cwd, rev, CASE), isTestFile),
      skipped: total(counts(cwd, rev, SKIPPED), isTestFile),
      testLines, srcLines,
      ratio: r3(testLines / (srcLines || 1)),
      added: changed("A"), deleted: changed("D"),
    };
  }).filter(Boolean);
  return { months: rows, suite: suiteHistory(cwd) };
}

const FACTORY = () => layout().factory;
/** aleph's registry key of the repo at `cwd`, also from a worktree; else the folder name. */
function repoKey(cwd: string): string {
  const root = git(cwd, "rev-parse", "--path-format=absolute", "--git-common-dir").trim().replace(/\/\.git$/, "");
  return Object.values(loadRegistry()).find((r) => resolve(r.path) === root)?.key ?? root.split("/").pop() ?? "";
}

/** aleph's full-suite records for this repo, one per month (the last of each): ran, failed, skipped. Empty outside aleph. */
function suiteHistory(cwd: string) {
  const file = join(FACTORY(), "suite-history.jsonl");
  if (!existsSync(file)) return [];
  const key = repoKey(cwd);
  const rows: { repo: string; at: string; ran: number; failed: number; skipped: number; rerunPassed: number }[] =
    readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.repo === key);
  const last = new Map(rows.map((r) => [r.at.slice(0, 7), r]));
  return [...last].map(([month, r]) => ({ month, ran: r.ran, failed: r.failed, skipped: r.skipped, rerunPassed: r.rerunPassed }));
}

// prettier-ignore
/** [rule, lens, pattern]. A rule names what the line does; SMELLS.md and HERMETIC.md say why it is a finding. */
export const RULES: [string, "smells" | "hermetic", RegExp][] = [
  ["sleep",                  "smells",   /\bsleep(Sync)?\(|\btime\.sleep\(|\bsleep\s+[\d.$]/],
  ["timer wait",             "smells",   /\bsetTimeout\((?!\s*[\w.]+\s*(,\s*0\s*)?\))|\bsetInterval\(/],
  ["poll until a deadline",  "smells",   /\b(waitFor|until|eventually)\(/],
  ["focused test",           "smells",   /\b(test|it|describe)\.only\(|\bfit\(\s*["'`]|\bfdescribe\(/],
  ["skipped test",           "smells",   new RegExp(SKIPPED)],
  ["print in a test",        "smells",   /\bconsole\.(log|error|warn)\(|^\s*print\(/],
  ["random with no seed",    "smells",   /\bMath\.random\(|\brandom\.(random|randint|choice)\(/],
  ["always-true assertion",  "smells",   /expect\((true|1|null|undefined)\)\.(toBe|toEqual)\(\1\)|assert\s+True\b/],
  ["snapshot",               "smells",   /\.toMatch(Inline)?Snapshot\(/],
  ["wall clock",             "hermetic", /\bDate\.now\(|\bnew Date\(\s*\)|\bperformance\.now\(|\btime\.time\(|datetime\.now\(/],
  ["network",                "hermetic", /\bfetch\(\s*["'`]https?:|https?:\/\/(?!localhost|127\.0\.0\.1|example\.(com|org))[\w.-]+\.\w+/],
  ["fixed port",             "hermetic", /\b(localhost|127\.0\.0\.1):\d{2,5}\b|\bport:\s*\d{4,5}\b/],
  ["shared path",            "hermetic", /["'`]\/tmp\/|\bhomedir\(\)|\$HOME\b|process\.env\.HOME\b|expanduser\(/],
  ["environment read",       "hermetic", /\bprocess\.env\.\w+|\bos\.environ\b|\bos\.Getenv\(/],
];

/** Each line of the test files under `paths` (default: the repo) that a rule matches. */
export function smells(cwd: string, paths: string[] = []) {
  const files = git(cwd, "ls-files", "--", ...paths).split("\n").filter((p) => p && isTestFile(p) && CODE.test(p) && !SKIP.test(p));
  const hits = files.flatMap((f) => readFileSync(join(cwd, f), "utf8").split("\n").flatMap((text, i) =>
    RULES.filter(([, , re]) => re.test(text)).map(([rule, lens]) => ({ rule, lens, at: `${f}:${i + 1}`, text: text.trim().slice(0, 120) }))));
  const byRule = Object.fromEntries(RULES.map(([rule]) => [rule, hits.filter((h) => h.rule === rule).length]));
  return { files: files.length, counts: byRule, hits };
}

/** aleph's flake rows for `repo`, per test, most often first. Empty outside aleph. */
export function flakes(repo: string) {
  const file = join(FACTORY(), "flaky.json");
  if (!existsSync(file)) return { source: null, tests: [] };
  const rows: { repo: string; run: string; at: string; tests?: string[] }[] = JSON.parse(readFileSync(file, "utf8"));
  const seen = rows.filter((r) => r.repo === repo).flatMap((r) => (r.tests ?? ["(no test named)"]).map((t) => ({ t, at: r.at, run: r.run })));
  const tests = Object.entries(Object.groupBy(seen, (s) => s.t)).map(([test, ss]) => ({
    test, count: ss!.length, first: ss![0].at.slice(0, 10), last: ss!.at(-1)!.at.slice(0, 10), runs: ss!.slice(-3).map((s) => s.run),
  }));
  return { source: file, tests: tests.sort((a, b) => b.count - a.count) };
}

/** Per source file of an lcov report, the set of lines with a hit count above 0. */
export function covered(lcov: string): Map<string, Set<number>> {
  return new Map(lcov.split("end_of_record").map((rec) => {
    const file = rec.match(/^SF:(.+)$/m)?.[1];
    const hit = [...rec.matchAll(/^DA:(\d+),(\d+)/gm)].filter((m) => Number(m[2]) > 0).map((m) => Number(m[1]));
    return [file, new Set(hit)] as const;
  }).filter((e): e is [string, Set<number>] => !!e[0]));
}

/** Per source file, the lines `before` covers and `after` does not. */
export function lost(before: string, after: string) {
  const a = covered(after);
  return [...covered(before)].map(([file, lines]) => ({ file, lines: [...lines].filter((l) => !a.get(file)?.has(l)) }))
    .filter((f) => f.lines.length);
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args.splice(i, 2)[1];
}

if (import.meta.main) {
  const [cmd, ...args] = Bun.argv.slice(2);
  const cwd = process.cwd();
  const out =
    cmd === "runtime" ? runtime(readFileSync(args[0], "utf8")) :
    cmd === "growth" ? growth(cwd, Number(flag(args, "--months") ?? 12)) :
    cmd === "smells" ? smells(cwd, args) :
    cmd === "flakes" ? flakes(flag(args, "--repo") ?? repoKey(cwd)) :
    cmd === "lcov" ? lost(readFileSync(args[0], "utf8"), readFileSync(args[1], "utf8")) :
    null;
  if (!out) {
    console.error("usage: stats.ts runtime <junit.xml> | growth [--months N] | smells [path ...] | flakes [--repo key] | lcov <before> <after>");
    process.exit(2);
  }
  console.log(JSON.stringify(out, null, 2));
}
