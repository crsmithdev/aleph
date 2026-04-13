#!/usr/bin/env bun
import { readdirSync } from "fs";
import { resolve } from "path";

const ROOT = import.meta.dir;
const BUN = process.argv[0];
const testsDir = resolve(ROOT, "src/tests");

const testFiles = readdirSync(testsDir)
  .filter(f => f.endsWith(".test.ts"))
  .sort();

type Result = { label: string; passed: number; failed: number; output: string; error: boolean };

const results = await Promise.all(testFiles.map(async (file): Promise<Result> => {
  const label = file.replace(".test.ts", "");
  try {
    const proc = Bun.spawn([BUN, resolve(testsDir, file)], {
      cwd: ROOT,
      env: process.env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    const summaryMatch = output.match(/(\d+) passed, (\d+) failed/);
    const passed = summaryMatch ? parseInt(summaryMatch[1]) : 0;
    const failed = summaryMatch ? parseInt(summaryMatch[2]) : (exitCode !== 0 ? 1 : 0);
    return { label, passed, failed, output, error: exitCode !== 0 };
  } catch (err: any) {
    return { label, passed: 0, failed: 1, output: err.message ?? "", error: true };
  }
}));

let totalPassed = 0;
let totalFailed = 0;
const failures: string[] = [];

for (const r of results) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ${r.label}`);
  console.log("═".repeat(60));
  process.stdout.write(r.output);
  totalPassed += r.passed;
  totalFailed += r.failed;
  if (r.error) failures.push(r.label);
}

const pct = totalPassed + totalFailed > 0
  ? Math.round((totalPassed / (totalPassed + totalFailed)) * 100)
  : 0;

console.log(`\n${"═".repeat(60)}`);
console.log(`  TOTAL: ${totalPassed} passed, ${totalFailed} failed (${pct}%)`);
if (failures.length > 0) {
  console.log(`\n  Failed suites: ${failures.join(", ")}`);
}
console.log("═".repeat(60));

if (pct < 90) {
  console.error(`FAIL: score ${pct}% is below 90% threshold`);
}

process.exit(totalFailed > 0 ? 1 : 0);
