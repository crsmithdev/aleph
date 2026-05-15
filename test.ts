#!/usr/bin/env bun
import { readdirSync } from "fs";
import { resolve } from "path";

const ROOT = import.meta.dir;
const BUN = process.argv[0];

type Result = { label: string; passed: number; failed: number; output: string; error: boolean };

// ── Custom harness suite (src/tests/) ────────────────────────────────────────
// Files print "N passed, N failed" via printAndExit(); exit 1 on any failure.

const testsDir = resolve(ROOT, "src/tests");
const harnessFiles = readdirSync(testsDir).filter(f => f.endsWith(".test.ts")).sort();

async function runHarnessFile(file: string): Promise<Result> {
  const label = file.replace(".test.ts", "");
  try {
    const proc = Bun.spawn([BUN, resolve(testsDir, file)], {
      cwd: ROOT, env: process.env, stdout: "pipe", stderr: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    const m = output.match(/(\d+) passed, (\d+) failed/);
    const passed = m ? parseInt(m[1]) : 0;
    const failed = m ? parseInt(m[2]) : (exitCode !== 0 ? 1 : 0);
    return { label, passed, failed, output, error: exitCode !== 0 };
  } catch (err: any) {
    return { label, passed: 0, failed: 1, output: err.message ?? "", error: true };
  }
}

// ── bun:test suite runner ─────────────────────────────────────────────────────
// Parses bun test's "N pass / N fail" summary lines.

async function runBunTest(label: string, dir: string | string[], cwd = ROOT): Promise<Result> {
  const dirs = Array.isArray(dir) ? dir : [dir];
  try {
    const proc = Bun.spawn([BUN, "test", ...dirs], {
      cwd, env: process.env, stdout: "pipe", stderr: "pipe",
    });
    const [out, err] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    const output = out + err;
    const passMatch = output.match(/(\d+) pass/);
    const failMatch = output.match(/(\d+) fail/);
    const passed = passMatch ? parseInt(passMatch[1]) : 0;
    const failed = failMatch ? parseInt(failMatch[1]) : (exitCode !== 0 ? 1 : 0);
    return { label, passed, failed, output, error: exitCode !== 0 };
  } catch (err: any) {
    return { label, passed: 0, failed: 1, output: err.message ?? "", error: true };
  }
}

// ── Run all suites in parallel ────────────────────────────────────────────────

const [harnessResults, loopResult, providersResult, telemetryResult, apiResult] =
  await Promise.all([
    Promise.all(harnessFiles.map(runHarnessFile)),
    runBunTest("research/loop",      "src/research/src/loop"),
    runBunTest("research/providers", "src/research/src/providers"),
    // e2e.test.ts reads live session data — excluded from the gate
    runBunTest("telemetry", [
      "__tests__/aggregator.test.ts",
      "__tests__/parser.test.ts",
      "__tests__/pricing.test.ts",
    ], resolve(ROOT, "src/telemetry")),
    runBunTest("api",                "src/__tests__", resolve(ROOT, "src/ui/api")),
  ]);

const allResults: Result[] = [
  ...harnessResults,
  loopResult,
  providersResult,
  telemetryResult,
  apiResult,
];

// ── Report ────────────────────────────────────────────────────────────────────

let totalPassed = 0;
let totalFailed = 0;
const failures: string[] = [];

for (const r of allResults) {
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
