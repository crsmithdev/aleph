#!/usr/bin/env bun
import { execSync } from "child_process";
import { readdirSync } from "fs";
import { resolve } from "path";

const ROOT = import.meta.dir;
const BUN = process.argv[0];
const testsDir = resolve(ROOT, "src/tests");

const testFiles = readdirSync(testsDir)
  .filter(f => f.endsWith(".test.ts"))
  .sort();

let totalPassed = 0;
let totalFailed = 0;
const failures: string[] = [];

for (const file of testFiles) {
  const label = file.replace(".test.ts", "");
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ${label}`);
  console.log("═".repeat(60));

  try {
    const output = execSync(`${BUN} ${resolve(testsDir, file)}`, {
      encoding: "utf-8",
      timeout: 120000,
      cwd: ROOT,
      env: process.env,
    });
    process.stdout.write(output);

    const summaryMatch = output.match(/(\d+) passed, (\d+) failed/);
    if (summaryMatch) {
      totalPassed += parseInt(summaryMatch[1]);
      totalFailed += parseInt(summaryMatch[2]);
    }
  } catch (err: any) {
    const output = err.stdout ?? "";
    process.stdout.write(output);

    const summaryMatch = output.match(/(\d+) passed, (\d+) failed/);
    if (summaryMatch) {
      totalPassed += parseInt(summaryMatch[1]);
      totalFailed += parseInt(summaryMatch[2]);
    } else {
      totalFailed++;
    }
    failures.push(label);
  }
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
