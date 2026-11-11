/**
 * No test reads the wall clock or sleeps. This test reads every test file and test helper
 * and fails when one of them uses a rule below and is not in tests/clock-exceptions.txt, or when a file in
 * that list no longer uses one. So the list only shrinks. A test reads time from an injected clock
 * (jobs/lib/infra/clock.ts) or setSystemTime, and waits for an event, not for a timer.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const LIST = "tests/clock-exceptions.txt";

/** Test files and the helpers that only tests import. */
const SCANNED = ["**/*.test.ts", "tests/**/*.ts", "**/*.helpers.ts", "**/*.fixture.ts", "**/fixture.ts", "**/*.testkit.ts", "**/test-*.ts", "ui/fixtures/**/*.ts"];
const SKIPPED = /^(node_modules|vendor|\.worktrees|acceptance)\//;

const RULES: [string, RegExp][] = [
  ["wall clock: Date.now()", /\bDate\.now\(/],
  ["wall clock: new Date() with no argument", /\bnew Date\(\s*\)/],
  ["wall clock: performance.now()", /\bperformance\.now\(/],
  ["wall clock: process.hrtime or Bun.nanoseconds", /\bprocess\.hrtime\b|\bBun\.nanoseconds\(/],
  ["timer: setInterval", /\bsetInterval\(/],
  ["timer: a loop of timer ticks", /\bfor\s*\(.*\bsetTimeout\(/],
  ["timer: setTimeout with a delay", /\bsetTimeout\((?!\s*[\w.]+\s*(?:,\s*0\s*)?\))/],
  ["sleep: Bun.sleep or sleepSync", /\bsleep(?:Sync)?\(/],
  ["sleep: in a shell command", /\bsleep\s+[\d.$]/],
  ["timeout as a wait: AbortSignal.timeout", /\bAbortSignal\.timeout\(/],
  ["timeout as a wait: a poll until a deadline (waitFor, until)", /\b(?:waitFor|until)\(/],
  ["timeout as a wait: a time limit of 1 s or less", /_TIMEOUT["']?\s*[:=]\s*["']?(?:0(?:\.\d+)?|1)["']?\s*[,;})]/],
];

/** Each line of `text` that breaks a rule, as "<line>: <rule>". */
function offences(text: string): string[] {
  const found: string[] = [];
  text.split("\n").forEach((line, i) => {
    for (const [name, re] of RULES) if (re.test(line)) found.push(`${i + 1}: ${name}`);
  });
  return found;
}

function scanned(): string[] {
  const files = new Set<string>();
  for (const pattern of SCANNED) {
    for (const f of new Bun.Glob(pattern).scanSync({ cwd: ROOT, dot: false })) if (!SKIPPED.test(f)) files.add(f);
  }
  files.delete("tests/clock-lint.test.ts");
  return [...files].sort();
}

test("no test file reads the wall clock or sleeps, except the files in tests/clock-exceptions.txt", () => {
  const listed = readFileSync(join(ROOT, LIST), "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const found = new Map(scanned().map((f) => [f, offences(readFileSync(join(ROOT, f), "utf8"))] as const).filter(([, o]) => o.length));
  const unlisted = [...found].filter(([f]) => !listed.includes(f)).map(([f, o]) => `${f}:${o.join(`\n  ${f}:`)}`);
  const clean = listed.filter((f) => !found.has(f)).map((f) => `${f} no longer reads the clock or sleeps: remove it from ${LIST}`);
  expect([...unlisted, ...clean]).toEqual([]);
});
