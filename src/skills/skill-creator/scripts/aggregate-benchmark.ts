#!/usr/bin/env bun
/**
 * Aggregate individual run results into benchmark summary statistics.
 *
 * Reads grading.json files from run directories and produces:
 * - run_summary with mean, stddev, min, max for each metric
 * - delta between with_skill and without_skill configurations
 *
 * Usage:
 *     bun scripts/aggregate-benchmark.ts <benchmark_dir>
 *
 * Example:
 *     bun scripts/aggregate-benchmark.ts benchmarks/2026-01-15T10-30-00/
 *
 * The script supports two directory layouts:
 *
 *     Workspace layout (from skill-creator iterations):
 *     <benchmark_dir>/
 *     └── eval-N/
 *         ├── with_skill/
 *         │   ├── run-1/grading.json
 *         │   └── run-2/grading.json
 *         └── without_skill/
 *             ├── run-1/grading.json
 *             └── run-2/grading.json
 *
 *     Legacy layout (with runs/ subdirectory):
 *     <benchmark_dir>/
 *     └── runs/
 *         └── eval-N/
 *             ├── with_skill/
 *             │   └── run-1/grading.json
 *             └── without_skill/
 *                 └── run-1/grading.json
 */

import * as fs from "node:fs";
import * as path from "node:path";

interface Stats {
  mean: number;
  stddev: number;
  min: number;
  max: number;
}

interface RunResult {
  eval_id: number;
  run_number: number;
  pass_rate: number;
  passed: number;
  failed: number;
  total: number;
  time_seconds: number;
  tokens: number;
  tool_calls: number;
  errors: number;
  expectations: unknown[];
  notes: string[];
}

interface ConfigSummary {
  pass_rate: Stats;
  time_seconds: Stats;
  tokens: Stats;
}

function calculateStats(values: number[]): Stats {
  if (values.length === 0) {
    return { mean: 0.0, stddev: 0.0, min: 0.0, max: 0.0 };
  }

  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;

  let stddev = 0.0;
  if (n > 1) {
    const variance = values.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (n - 1);
    stddev = Math.sqrt(variance);
  }

  return {
    mean: Math.round(mean * 10000) / 10000,
    stddev: Math.round(stddev * 10000) / 10000,
    min: Math.round(Math.min(...values) * 10000) / 10000,
    max: Math.round(Math.max(...values) * 10000) / 10000,
  };
}

function loadRunResults(benchmarkDir: string): Record<string, RunResult[]> {
  /**
   * Load all run results from a benchmark directory.
   *
   * Returns dict keyed by config name (e.g. "with_skill"/"without_skill"),
   * each containing a list of run results.
   */
  const runsDir = path.join(benchmarkDir, "runs");
  let searchDir: string;

  if (fs.existsSync(runsDir)) {
    searchDir = runsDir;
  } else {
    const evalDirs = fs
      .readdirSync(benchmarkDir)
      .filter((name) => name.startsWith("eval-"))
      .map((name) => path.join(benchmarkDir, name))
      .filter((p) => fs.statSync(p).isDirectory());

    if (evalDirs.length === 0) {
      process.stdout.write(
        `No eval directories found in ${benchmarkDir} or ${runsDir}\n`
      );
      return {};
    }
    searchDir = benchmarkDir;
  }

  const results: Record<string, RunResult[]> = {};

  const evalDirs = fs
    .readdirSync(searchDir)
    .filter((name) => name.startsWith("eval-"))
    .map((name) => path.join(searchDir, name))
    .filter((p) => fs.statSync(p).isDirectory())
    .sort();

  for (let evalIdx = 0; evalIdx < evalDirs.length; evalIdx++) {
    const evalDir = evalDirs[evalIdx];
    const metadataPath = path.join(evalDir, "eval_metadata.json");
    let evalId = evalIdx;

    if (fs.existsSync(metadataPath)) {
      try {
        const metaData = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
        evalId = metaData.eval_id ?? evalIdx;
      } catch {
        evalId = evalIdx;
      }
    } else {
      const parts = path.basename(evalDir).split("-");
      const parsed = parseInt(parts[1], 10);
      evalId = isNaN(parsed) ? evalIdx : parsed;
    }

    // Discover config directories dynamically
    const configDirs = fs
      .readdirSync(evalDir)
      .map((name) => path.join(evalDir, name))
      .filter((p) => fs.statSync(p).isDirectory())
      .sort();

    for (const configDir of configDirs) {
      const config = path.basename(configDir);

      // Skip non-config directories (those without run-* subdirs)
      const runDirs = fs
        .readdirSync(configDir)
        .filter((name) => name.startsWith("run-"))
        .map((name) => path.join(configDir, name))
        .filter((p) => fs.statSync(p).isDirectory());

      if (runDirs.length === 0) continue;

      if (!(config in results)) {
        results[config] = [];
      }

      for (const runDir of runDirs.sort()) {
        const runNumber = parseInt(path.basename(runDir).split("-")[1], 10);
        const gradingFile = path.join(runDir, "grading.json");

        if (!fs.existsSync(gradingFile)) {
          process.stdout.write(`Warning: grading.json not found in ${runDir}\n`);
          continue;
        }

        let grading: Record<string, unknown>;
        try {
          grading = JSON.parse(fs.readFileSync(gradingFile, "utf8"));
        } catch (e) {
          process.stdout.write(`Warning: Invalid JSON in ${gradingFile}: ${e}\n`);
          continue;
        }

        const summary = (grading.summary as Record<string, number>) ?? {};
        const result: RunResult = {
          eval_id: evalId,
          run_number: runNumber,
          pass_rate: summary.pass_rate ?? 0.0,
          passed: summary.passed ?? 0,
          failed: summary.failed ?? 0,
          total: summary.total ?? 0,
          time_seconds: 0.0,
          tokens: 0,
          tool_calls: 0,
          errors: 0,
          expectations: [],
          notes: [],
        };

        // Extract timing — check grading.json first, then sibling timing.json
        const timing = (grading.timing as Record<string, number>) ?? {};
        result.time_seconds = timing.total_duration_seconds ?? 0.0;

        const timingFile = path.join(runDir, "timing.json");
        if (result.time_seconds === 0.0 && fs.existsSync(timingFile)) {
          try {
            const timingData = JSON.parse(fs.readFileSync(timingFile, "utf8"));
            result.time_seconds = timingData.total_duration_seconds ?? 0.0;
            result.tokens = timingData.total_tokens ?? 0;
          } catch {
            // ignore
          }
        }

        // Extract metrics if available
        const metrics = (grading.execution_metrics as Record<string, number>) ?? {};
        result.tool_calls = metrics.total_tool_calls ?? 0;
        if (!result.tokens) {
          result.tokens = metrics.output_chars ?? 0;
        }
        result.errors = metrics.errors_encountered ?? 0;

        // Extract expectations — viewer requires fields: text, passed, evidence
        const rawExpectations = (grading.expectations as unknown[]) ?? [];
        for (const exp of rawExpectations) {
          const e = exp as Record<string, unknown>;
          if (!("text" in e) || !("passed" in e)) {
            process.stdout.write(
              `Warning: expectation in ${gradingFile} missing required fields (text, passed, evidence): ${JSON.stringify(exp)}\n`
            );
          }
        }
        result.expectations = rawExpectations;

        // Extract notes from user_notes_summary
        const notesSummary = (grading.user_notes_summary as Record<string, string[]>) ?? {};
        const notes: string[] = [];
        notes.push(...(notesSummary.uncertainties ?? []));
        notes.push(...(notesSummary.needs_review ?? []));
        notes.push(...(notesSummary.workarounds ?? []));
        result.notes = notes;

        results[config].push(result);
      }
    }
  }

  return results;
}

function aggregateResults(results: Record<string, RunResult[]>): Record<string, unknown> {
  const runSummary: Record<string, unknown> = {};
  const configs = Object.keys(results);

  for (const config of configs) {
    const runs = results[config] ?? [];

    if (runs.length === 0) {
      runSummary[config] = {
        pass_rate: { mean: 0.0, stddev: 0.0, min: 0.0, max: 0.0 },
        time_seconds: { mean: 0.0, stddev: 0.0, min: 0.0, max: 0.0 },
        tokens: { mean: 0, stddev: 0, min: 0, max: 0 },
      };
      continue;
    }

    const passRates = runs.map((r) => r.pass_rate);
    const times = runs.map((r) => r.time_seconds);
    const tokens = runs.map((r) => r.tokens ?? 0);

    runSummary[config] = {
      pass_rate: calculateStats(passRates),
      time_seconds: calculateStats(times),
      tokens: calculateStats(tokens),
    };
  }

  // Calculate delta between the first two configs (if two exist)
  const primary =
    configs.length >= 1
      ? (runSummary[configs[0]] as Record<string, Record<string, number>>)
      : {};
  const baseline =
    configs.length >= 2
      ? (runSummary[configs[1]] as Record<string, Record<string, number>>)
      : {};

  const deltaPassRate =
    (primary?.pass_rate?.mean ?? 0) - (baseline?.pass_rate?.mean ?? 0);
  const deltaTime =
    (primary?.time_seconds?.mean ?? 0) - (baseline?.time_seconds?.mean ?? 0);
  const deltaTokens =
    (primary?.tokens?.mean ?? 0) - (baseline?.tokens?.mean ?? 0);

  runSummary["delta"] = {
    pass_rate: (deltaPassRate >= 0 ? "+" : "") + deltaPassRate.toFixed(2),
    time_seconds: (deltaTime >= 0 ? "+" : "") + deltaTime.toFixed(1),
    tokens: (deltaTokens >= 0 ? "+" : "") + Math.round(deltaTokens).toString(),
  };

  return runSummary;
}

function generateBenchmark(
  benchmarkDir: string,
  skillName: string = "",
  skillPath: string = ""
): Record<string, unknown> {
  const results = loadRunResults(benchmarkDir);
  const runSummary = aggregateResults(results);

  // Build runs array for benchmark.json
  const runs: unknown[] = [];
  for (const config of Object.keys(results)) {
    for (const result of results[config]) {
      runs.push({
        eval_id: result.eval_id,
        configuration: config,
        run_number: result.run_number,
        result: {
          pass_rate: result.pass_rate,
          passed: result.passed,
          failed: result.failed,
          total: result.total,
          time_seconds: result.time_seconds,
          tokens: result.tokens ?? 0,
          tool_calls: result.tool_calls ?? 0,
          errors: result.errors ?? 0,
        },
        expectations: result.expectations,
        notes: result.notes,
      });
    }
  }

  // Determine eval IDs from results
  const evalIdSet = new Set<number>();
  for (const configRuns of Object.values(results)) {
    for (const r of configRuns) {
      evalIdSet.add(r.eval_id);
    }
  }
  const evalIds = [...evalIdSet].sort((a, b) => a - b);

  const benchmark = {
    metadata: {
      skill_name: skillName || "<skill-name>",
      skill_path: skillPath || "<path/to/skill>",
      executor_model: "<model-name>",
      analyzer_model: "<model-name>",
      timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      evals_run: evalIds,
      runs_per_configuration: 3,
    },
    runs,
    run_summary: runSummary,
    notes: [], // To be filled by analyzer
  };

  return benchmark;
}

function generateMarkdown(benchmark: Record<string, unknown>): string {
  const metadata = benchmark.metadata as Record<string, unknown>;
  const runSummary = benchmark.run_summary as Record<string, Record<string, Record<string, number>>>;

  const configs = Object.keys(runSummary).filter((k) => k !== "delta");
  const configA = configs[0] ?? "config_a";
  const configB = configs[1] ?? "config_b";
  const labelA = configA.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const labelB = configB.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  const evalsRun = metadata.evals_run as number[];
  const lines: string[] = [
    `# Skill Benchmark: ${metadata.skill_name}`,
    "",
    `**Model**: ${metadata.executor_model}`,
    `**Date**: ${metadata.timestamp}`,
    `**Evals**: ${evalsRun.join(", ")} (${metadata.runs_per_configuration} runs each per configuration)`,
    "",
    "## Summary",
    "",
    `| Metric | ${labelA} | ${labelB} | Delta |`,
    "|--------|------------|---------------|-------|",
  ];

  const aSummary = runSummary[configA] ?? {};
  const bSummary = runSummary[configB] ?? {};
  const delta = (runSummary["delta"] ?? {}) as Record<string, string>;

  const aPr = aSummary.pass_rate ?? { mean: 0, stddev: 0 };
  const bPr = bSummary.pass_rate ?? { mean: 0, stddev: 0 };
  lines.push(
    `| Pass Rate | ${(aPr.mean * 100).toFixed(0)}% ± ${(aPr.stddev * 100).toFixed(0)}% | ${(bPr.mean * 100).toFixed(0)}% ± ${(bPr.stddev * 100).toFixed(0)}% | ${delta.pass_rate ?? "—"} |`
  );

  const aTime = aSummary.time_seconds ?? { mean: 0, stddev: 0 };
  const bTime = bSummary.time_seconds ?? { mean: 0, stddev: 0 };
  lines.push(
    `| Time | ${aTime.mean.toFixed(1)}s ± ${aTime.stddev.toFixed(1)}s | ${bTime.mean.toFixed(1)}s ± ${bTime.stddev.toFixed(1)}s | ${delta.time_seconds ?? "—"}s |`
  );

  const aTokens = aSummary.tokens ?? { mean: 0, stddev: 0 };
  const bTokens = bSummary.tokens ?? { mean: 0, stddev: 0 };
  lines.push(
    `| Tokens | ${aTokens.mean.toFixed(0)} ± ${aTokens.stddev.toFixed(0)} | ${bTokens.mean.toFixed(0)} ± ${bTokens.stddev.toFixed(0)} | ${delta.tokens ?? "—"} |`
  );

  const notes = benchmark.notes as string[];
  if (notes && notes.length > 0) {
    lines.push("", "## Notes", "");
    for (const note of notes) {
      lines.push(`- ${note}`);
    }
  }

  return lines.join("\n");
}

function main() {
  const args = process.argv.slice(2);
  let benchmarkDir = "";
  let skillName = "";
  let skillPath = "";
  let outputPath = "";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--skill-name" && i + 1 < args.length) {
      skillName = args[++i];
    } else if (args[i] === "--skill-path" && i + 1 < args.length) {
      skillPath = args[++i];
    } else if ((args[i] === "--output" || args[i] === "-o") && i + 1 < args.length) {
      outputPath = args[++i];
    } else if (!args[i].startsWith("-")) {
      benchmarkDir = args[i];
    }
  }

  if (!benchmarkDir) {
    process.stderr.write("Usage: bun scripts/aggregate-benchmark.ts <benchmark_dir> [--skill-name NAME] [--skill-path PATH] [-o OUTPUT]\n");
    process.exit(1);
  }

  if (!fs.existsSync(benchmarkDir)) {
    process.stdout.write(`Directory not found: ${benchmarkDir}\n`);
    process.exit(1);
  }

  const benchmark = generateBenchmark(benchmarkDir, skillName, skillPath);

  const outputJson = outputPath || path.join(benchmarkDir, "benchmark.json");
  const outputMd = outputJson.replace(/\.json$/, ".md");

  fs.writeFileSync(outputJson, JSON.stringify(benchmark, null, 2), "utf8");
  process.stdout.write(`Generated: ${outputJson}\n`);

  const markdown = generateMarkdown(benchmark);
  fs.writeFileSync(outputMd, markdown, "utf8");
  process.stdout.write(`Generated: ${outputMd}\n`);

  // Print summary
  const runSummary = benchmark.run_summary as Record<string, Record<string, Record<string, number>>>;
  const configs = Object.keys(runSummary).filter((k) => k !== "delta");
  const delta = (runSummary["delta"] ?? {}) as Record<string, string>;

  process.stdout.write("\nSummary:\n");
  for (const config of configs) {
    const pr = runSummary[config]?.pass_rate?.mean ?? 0;
    const label = config.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    process.stdout.write(`  ${label}: ${(pr * 100).toFixed(1)}% pass rate\n`);
  }
  process.stdout.write(`  Delta:         ${delta.pass_rate ?? "—"}\n`);
}

if (import.meta.main) {
  main();
}
