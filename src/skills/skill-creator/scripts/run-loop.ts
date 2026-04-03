#!/usr/bin/env bun
/**
 * Run the eval + improve loop until all pass or max iterations reached.
 *
 * Combines run-eval.ts and improve-description.ts in a loop, tracking history
 * and returning the best description found. Supports train/test split to prevent
 * overfitting.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawnSync } from "node:child_process";
import { generateHtml } from "./generate-report.js";
import { improveDescription } from "./improve-description.js";
import { findProjectRoot, runEval } from "./run-eval.js";
import { parseSkillMd } from "./utils.js";

interface EvalItem {
  query: string;
  should_trigger: boolean;
}

interface EvalResult {
  query: string;
  should_trigger: boolean;
  pass: boolean;
  triggers: number;
  runs: number;
}

interface EvalResultSet {
  results: EvalResult[];
  summary: {
    passed: number;
    failed: number;
    total: number;
  };
}

function splitEvalSet(
  evalSet: EvalItem[],
  holdout: number,
  seed: number = 42
): [EvalItem[], EvalItem[]] {
  /** Split eval set into train and test sets, stratified by should_trigger. */

  // Simple seeded shuffle using mulberry32
  function mulberry32(a: number) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const rand = mulberry32(seed);

  function shuffleCopy<T>(arr: T[]): T[] {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  const trigger = shuffleCopy(evalSet.filter((e) => e.should_trigger));
  const noTrigger = shuffleCopy(evalSet.filter((e) => !e.should_trigger));

  const nTriggerTest = Math.max(1, Math.floor(trigger.length * holdout));
  const nNoTriggerTest = Math.max(1, Math.floor(noTrigger.length * holdout));

  const testSet = [...trigger.slice(0, nTriggerTest), ...noTrigger.slice(0, nNoTriggerTest)];
  const trainSet = [...trigger.slice(nTriggerTest), ...noTrigger.slice(nNoTriggerTest)];

  return [trainSet, testSet];
}

function openBrowser(url: string): void {
  // Try xdg-open first (Linux), fall back to open (macOS)
  const result = spawnSync("xdg-open", [url], { stdio: "ignore" });
  if (result.status !== 0) {
    spawnSync("open", [url], { stdio: "ignore" });
  }
}

export async function runLoop(params: {
  evalSet: EvalItem[];
  skillPath: string;
  descriptionOverride: string | null;
  numWorkers: number;
  timeout: number;
  maxIterations: number;
  runsPerQuery: number;
  triggerThreshold: number;
  holdout: number;
  model: string;
  verbose: boolean;
  liveReportPath?: string | null;
  logDir?: string | null;
}): Promise<Record<string, unknown>> {
  const {
    evalSet,
    skillPath,
    descriptionOverride,
    numWorkers,
    timeout,
    maxIterations,
    runsPerQuery,
    triggerThreshold,
    holdout,
    model,
    verbose,
    liveReportPath = null,
    logDir = null,
  } = params;

  const projectRoot = findProjectRoot();
  const [name, originalDescription, content] = parseSkillMd(skillPath);
  let currentDescription = descriptionOverride ?? originalDescription;

  // Split into train/test if holdout > 0
  let trainSet: EvalItem[];
  let testSet: EvalItem[];
  if (holdout > 0) {
    [trainSet, testSet] = splitEvalSet(evalSet, holdout);
    if (verbose) {
      process.stderr.write(
        `Split: ${trainSet.length} train, ${testSet.length} test (holdout=${holdout})\n`
      );
    }
  } else {
    trainSet = evalSet;
    testSet = [];
  }

  const history: Record<string, unknown>[] = [];
  let exitReason = "unknown";

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    if (verbose) {
      process.stderr.write(`\n${"=".repeat(60)}\n`);
      process.stderr.write(`Iteration ${iteration}/${maxIterations}\n`);
      process.stderr.write(`Description: ${currentDescription}\n`);
      process.stderr.write(`${"=".repeat(60)}\n`);
    }

    // Evaluate train + test together in one batch for parallelism
    const allQueries = [...trainSet, ...testSet];
    const t0 = Date.now();
    const allResults = (await runEval({
      evalSet: allQueries,
      skillName: name,
      description: currentDescription,
      numWorkers,
      timeout,
      projectRoot,
      runsPerQuery,
      triggerThreshold,
      model,
    })) as { results: EvalResult[]; summary: Record<string, number>; skill_name: string; description: string };
    const evalElapsed = (Date.now() - t0) / 1000;

    // Split results back into train/test by matching queries
    const trainQueriesSet = new Set(trainSet.map((q) => q.query));
    const trainResultList = allResults.results.filter((r) => trainQueriesSet.has(r.query));
    const testResultList = allResults.results.filter((r) => !trainQueriesSet.has(r.query));

    const trainPassed = trainResultList.filter((r) => r.pass).length;
    const trainTotal = trainResultList.length;
    const trainSummary = { passed: trainPassed, failed: trainTotal - trainPassed, total: trainTotal };
    const trainResultsObj: EvalResultSet = { results: trainResultList, summary: trainSummary };

    let testResultsObj: EvalResultSet | null = null;
    let testSummary: { passed: number; failed: number; total: number } | null = null;

    if (testSet.length > 0) {
      const testPassed = testResultList.filter((r) => r.pass).length;
      const testTotal = testResultList.length;
      testSummary = { passed: testPassed, failed: testTotal - testPassed, total: testTotal };
      testResultsObj = { results: testResultList, summary: testSummary };
    }

    history.push({
      iteration,
      description: currentDescription,
      train_passed: trainSummary.passed,
      train_failed: trainSummary.failed,
      train_total: trainSummary.total,
      train_results: trainResultList,
      test_passed: testSummary?.passed ?? null,
      test_failed: testSummary?.failed ?? null,
      test_total: testSummary?.total ?? null,
      test_results: testResultsObj?.results ?? null,
      // For backward compat with report generator
      passed: trainSummary.passed,
      failed: trainSummary.failed,
      total: trainSummary.total,
      results: trainResultList,
    });

    // Write live report if path provided
    if (liveReportPath) {
      const partialOutput = {
        original_description: originalDescription,
        best_description: currentDescription,
        best_score: "in progress",
        iterations_run: history.length,
        holdout,
        train_size: trainSet.length,
        test_size: testSet.length,
        history,
      };
      fs.writeFileSync(liveReportPath, generateHtml(partialOutput, true, name), "utf8");
    }

    if (verbose) {
      function printEvalStats(
        label: string,
        results: EvalResult[],
        elapsed: number
      ) {
        const pos = results.filter((r) => r.should_trigger);
        const neg = results.filter((r) => !r.should_trigger);
        const tp = pos.reduce((s, r) => s + r.triggers, 0);
        const posRuns = pos.reduce((s, r) => s + r.runs, 0);
        const fn = posRuns - tp;
        const fp = neg.reduce((s, r) => s + r.triggers, 0);
        const negRuns = neg.reduce((s, r) => s + r.runs, 0);
        const tn = negRuns - fp;
        const total = tp + tn + fp + fn;
        const precision = tp + fp > 0 ? tp / (tp + fp) : 1.0;
        const recall = tp + fn > 0 ? tp / (tp + fn) : 1.0;
        const accuracy = total > 0 ? (tp + tn) / total : 0.0;
        process.stderr.write(
          `${label}: ${tp + tn}/${total} correct, precision=${(precision * 100).toFixed(0)}% recall=${(recall * 100).toFixed(0)}% accuracy=${(accuracy * 100).toFixed(0)}% (${elapsed.toFixed(1)}s)\n`
        );
        for (const r of results) {
          const status = r.pass ? "PASS" : "FAIL";
          const rateStr = `${r.triggers}/${r.runs}`;
          process.stderr.write(
            `  [${status}] rate=${rateStr} expected=${r.should_trigger}: ${r.query.slice(0, 60)}\n`
          );
        }
      }

      printEvalStats("Train", trainResultsObj.results, evalElapsed);
      if (testSummary && testResultsObj) {
        printEvalStats("Test ", testResultsObj.results, 0);
      }
    }

    if (trainSummary.failed === 0) {
      exitReason = `all_passed (iteration ${iteration})`;
      if (verbose) {
        process.stderr.write(`\nAll train queries passed on iteration ${iteration}!\n`);
      }
      break;
    }

    if (iteration === maxIterations) {
      exitReason = `max_iterations (${maxIterations})`;
      if (verbose) {
        process.stderr.write(`\nMax iterations reached (${maxIterations}).\n`);
      }
      break;
    }

    // Improve the description based on train results
    if (verbose) {
      process.stderr.write("\nImproving description...\n");
    }

    const t1 = Date.now();
    // Strip test scores from history so improvement model can't see them
    const blindedHistory = history.map((h) => {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(h)) {
        if (!k.startsWith("test_")) {
          result[k] = v;
        }
      }
      return result;
    });

    const newDescription = improveDescription({
      skillName: name,
      skillContent: content,
      currentDescription,
      evalResults: {
        results: trainResultsObj.results,
        summary: trainSummary,
        description: currentDescription,
      },
      history: blindedHistory as Array<{
        description: string;
        passed?: number;
        total?: number;
        results?: EvalResult[];
        note?: string;
      }>,
      model,
      logDir: logDir ?? null,
      iteration,
    });
    const improveElapsed = (Date.now() - t1) / 1000;

    if (verbose) {
      process.stderr.write(`Proposed (${improveElapsed.toFixed(1)}s): ${newDescription}\n`);
    }

    currentDescription = newDescription;
  }

  // Find the best iteration by TEST score (or train if no test set)
  let best: Record<string, unknown>;
  let bestScore: string;

  if (testSet.length > 0) {
    best = history.reduce((b, h) =>
      ((h.test_passed as number) ?? 0) > ((b.test_passed as number) ?? 0) ? h : b
    );
    bestScore = `${best.test_passed}/${best.test_total}`;
  } else {
    best = history.reduce((b, h) =>
      ((h.train_passed as number) ?? 0) > ((b.train_passed as number) ?? 0) ? h : b
    );
    bestScore = `${best.train_passed}/${best.train_total}`;
  }

  if (verbose) {
    process.stderr.write(`\nExit reason: ${exitReason}\n`);
    process.stderr.write(`Best score: ${bestScore} (iteration ${best.iteration})\n`);
  }

  return {
    exit_reason: exitReason,
    original_description: originalDescription,
    best_description: best.description,
    best_score: bestScore,
    best_train_score: `${best.train_passed}/${best.train_total}`,
    best_test_score: testSet.length > 0 ? `${best.test_passed}/${best.test_total}` : null,
    final_description: currentDescription,
    iterations_run: history.length,
    holdout,
    train_size: trainSet.length,
    test_size: testSet.length,
    history,
  };
}

async function main() {
  const args = process.argv.slice(2);
  let evalSetPath = "";
  let skillPath = "";
  let descriptionOverride: string | null = null;
  let numWorkers = 10;
  let timeout = 30;
  let maxIterations = 5;
  let runsPerQuery = 3;
  let triggerThreshold = 0.5;
  let holdout = 0.4;
  let model = "";
  let verbose = false;
  let reportArg = "auto";
  let resultsDir: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--eval-set" && i + 1 < args.length) {
      evalSetPath = args[++i];
    } else if (args[i] === "--skill-path" && i + 1 < args.length) {
      skillPath = args[++i];
    } else if (args[i] === "--description" && i + 1 < args.length) {
      descriptionOverride = args[++i];
    } else if (args[i] === "--num-workers" && i + 1 < args.length) {
      numWorkers = parseInt(args[++i], 10);
    } else if (args[i] === "--timeout" && i + 1 < args.length) {
      timeout = parseInt(args[++i], 10);
    } else if (args[i] === "--max-iterations" && i + 1 < args.length) {
      maxIterations = parseInt(args[++i], 10);
    } else if (args[i] === "--runs-per-query" && i + 1 < args.length) {
      runsPerQuery = parseInt(args[++i], 10);
    } else if (args[i] === "--trigger-threshold" && i + 1 < args.length) {
      triggerThreshold = parseFloat(args[++i]);
    } else if (args[i] === "--holdout" && i + 1 < args.length) {
      holdout = parseFloat(args[++i]);
    } else if (args[i] === "--model" && i + 1 < args.length) {
      model = args[++i];
    } else if (args[i] === "--verbose") {
      verbose = true;
    } else if (args[i] === "--report" && i + 1 < args.length) {
      reportArg = args[++i];
    } else if (args[i] === "--results-dir" && i + 1 < args.length) {
      resultsDir = args[++i];
    }
  }

  if (!evalSetPath || !skillPath || !model) {
    process.stderr.write(
      "Usage: bun scripts/run-loop.ts --eval-set <path> --skill-path <path> --model <model> [--description DESC] [--num-workers N] [--timeout N] [--max-iterations N] [--runs-per-query N] [--trigger-threshold F] [--holdout F] [--verbose] [--report PATH|auto|none] [--results-dir PATH]\n"
    );
    process.exit(1);
  }

  const evalSet: EvalItem[] = JSON.parse(fs.readFileSync(evalSetPath, "utf8"));

  if (!fs.existsSync(path.join(skillPath, "SKILL.md"))) {
    process.stderr.write(`Error: No SKILL.md found at ${skillPath}\n`);
    process.exit(1);
  }

  const [name] = parseSkillMd(skillPath);

  // Set up live report path
  let liveReportPath: string | null = null;
  if (reportArg !== "none") {
    if (reportArg === "auto") {
      const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "")
        .replace("T", "_")
        .slice(0, 15);
      liveReportPath = path.join(
        os.tmpdir(),
        `skill_description_report_${path.basename(skillPath)}_${timestamp}.html`
      );
    } else {
      liveReportPath = reportArg;
    }
    // Open the report immediately so the user can watch
    fs.writeFileSync(
      liveReportPath,
      "<html><body><h1>Starting optimization loop...</h1><meta http-equiv='refresh' content='5'></body></html>",
      "utf8"
    );
    openBrowser(`file://${liveReportPath}`);
  }

  // Determine output directory
  let outputResultsDir: string | null = null;
  let logDir: string | null = null;
  if (resultsDir) {
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .replace("T", "_")
      .slice(0, 19);
    outputResultsDir = path.join(resultsDir, timestamp);
    fs.mkdirSync(outputResultsDir, { recursive: true });
    logDir = path.join(outputResultsDir, "logs");
  }

  const output = await runLoop({
    evalSet,
    skillPath,
    descriptionOverride,
    numWorkers,
    timeout,
    maxIterations,
    runsPerQuery,
    triggerThreshold,
    holdout,
    model,
    verbose,
    liveReportPath,
    logDir,
  });

  // Save JSON output
  const jsonOutput = JSON.stringify(output, null, 2);
  process.stdout.write(jsonOutput + "\n");
  if (outputResultsDir) {
    fs.writeFileSync(path.join(outputResultsDir, "results.json"), jsonOutput, "utf8");
  }

  // Write final HTML report (without auto-refresh)
  if (liveReportPath) {
    fs.writeFileSync(liveReportPath, generateHtml(output, false, name), "utf8");
    process.stderr.write(`\nReport: ${liveReportPath}\n`);
  }

  if (outputResultsDir && liveReportPath) {
    fs.writeFileSync(
      path.join(outputResultsDir, "report.html"),
      generateHtml(output, false, name),
      "utf8"
    );
  }

  if (outputResultsDir) {
    process.stderr.write(`Results saved to: ${outputResultsDir}\n`);
  }
}

function openBrowser(url: string): void {
  const result = spawnSync("xdg-open", [url], { stdio: "ignore" });
  if (result.status !== 0) {
    spawnSync("open", [url], { stdio: "ignore" });
  }
}

if (import.meta.main) {
  main().catch((e) => {
    process.stderr.write(`Error: ${e}\n`);
    process.exit(1);
  });
}
