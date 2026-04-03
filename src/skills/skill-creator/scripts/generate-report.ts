#!/usr/bin/env bun
/**
 * Generate an HTML report from run-loop.ts output.
 *
 * Takes the JSON output from run-loop.ts and generates a visual HTML report
 * showing each description attempt with check/x for each test case.
 * Distinguishes between train and test queries.
 */

import * as fs from "node:fs";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface EvalResult {
  query: string;
  should_trigger?: boolean;
  pass?: boolean;
  triggers?: number;
  runs?: number;
}

interface HistoryEntry {
  iteration?: number | string;
  description?: string;
  train_passed?: number;
  passed?: number;
  train_total?: number;
  total?: number;
  test_passed?: number | null;
  test_total?: number | null;
  train_results?: EvalResult[];
  results?: EvalResult[];
  test_results?: EvalResult[] | null;
  note?: string;
}

export function generateHtml(
  data: Record<string, unknown>,
  autoRefresh: boolean = false,
  skillName: string = ""
): string {
  const history = (data.history as HistoryEntry[]) ?? [];
  const titlePrefix = skillName ? escapeHtml(skillName + " \u2014 ") : "";

  // Get all unique queries from train and test sets, with should_trigger info
  const trainQueries: { query: string; should_trigger: boolean }[] = [];
  const testQueries: { query: string; should_trigger: boolean }[] = [];

  if (history.length > 0) {
    const firstEntry = history[0];
    const trainResults = firstEntry.train_results ?? firstEntry.results ?? [];
    for (const r of trainResults) {
      trainQueries.push({ query: r.query, should_trigger: r.should_trigger ?? true });
    }
    const testResults = firstEntry.test_results ?? [];
    if (testResults) {
      for (const r of testResults) {
        testQueries.push({ query: r.query, should_trigger: r.should_trigger ?? true });
      }
    }
  }

  const refreshTag = autoRefresh
    ? '    <meta http-equiv="refresh" content="5">\n'
    : "";

  const htmlParts: string[] = [
    `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
${refreshTag}    <title>${titlePrefix}Skill Description Optimization</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@500;600&family=Lora:wght@400;500&display=swap" rel="stylesheet">
    <style>
        body {
            font-family: 'Lora', Georgia, serif;
            max-width: 100%;
            margin: 0 auto;
            padding: 20px;
            background: #faf9f5;
            color: #141413;
        }
        h1 { font-family: 'Poppins', sans-serif; color: #141413; }
        .explainer {
            background: white;
            padding: 15px;
            border-radius: 6px;
            margin-bottom: 20px;
            border: 1px solid #e8e6dc;
            color: #b0aea5;
            font-size: 0.875rem;
            line-height: 1.6;
        }
        .summary {
            background: white;
            padding: 15px;
            border-radius: 6px;
            margin-bottom: 20px;
            border: 1px solid #e8e6dc;
        }
        .summary p { margin: 5px 0; }
        .best { color: #788c5d; font-weight: bold; }
        .table-container {
            overflow-x: auto;
            width: 100%;
        }
        table {
            border-collapse: collapse;
            background: white;
            border: 1px solid #e8e6dc;
            border-radius: 6px;
            font-size: 12px;
            min-width: 100%;
        }
        th, td {
            padding: 8px;
            text-align: left;
            border: 1px solid #e8e6dc;
            white-space: normal;
            word-wrap: break-word;
        }
        th {
            font-family: 'Poppins', sans-serif;
            background: #141413;
            color: #faf9f5;
            font-weight: 500;
        }
        th.test-col {
            background: #6a9bcc;
        }
        th.query-col { min-width: 200px; }
        td.description {
            font-family: monospace;
            font-size: 11px;
            word-wrap: break-word;
            max-width: 400px;
        }
        td.result {
            text-align: center;
            font-size: 16px;
            min-width: 40px;
        }
        td.test-result {
            background: #f0f6fc;
        }
        .pass { color: #788c5d; }
        .fail { color: #c44; }
        .rate {
            font-size: 9px;
            color: #b0aea5;
            display: block;
        }
        tr:hover { background: #faf9f5; }
        .score {
            display: inline-block;
            padding: 2px 6px;
            border-radius: 4px;
            font-weight: bold;
            font-size: 11px;
        }
        .score-good { background: #eef2e8; color: #788c5d; }
        .score-ok { background: #fef3c7; color: #d97706; }
        .score-bad { background: #fceaea; color: #c44; }
        .train-label { color: #b0aea5; font-size: 10px; }
        .test-label { color: #6a9bcc; font-size: 10px; font-weight: bold; }
        .best-row { background: #f5f8f2; }
        th.positive-col { border-bottom: 3px solid #788c5d; }
        th.negative-col { border-bottom: 3px solid #c44; }
        th.test-col.positive-col { border-bottom: 3px solid #788c5d; }
        th.test-col.negative-col { border-bottom: 3px solid #c44; }
        .legend { font-family: 'Poppins', sans-serif; display: flex; gap: 20px; margin-bottom: 10px; font-size: 13px; align-items: center; }
        .legend-item { display: flex; align-items: center; gap: 6px; }
        .legend-swatch { width: 16px; height: 16px; border-radius: 3px; display: inline-block; }
        .swatch-positive { background: #141413; border-bottom: 3px solid #788c5d; }
        .swatch-negative { background: #141413; border-bottom: 3px solid #c44; }
        .swatch-test { background: #6a9bcc; }
        .swatch-train { background: #141413; }
    </style>
</head>
<body>
    <h1>${titlePrefix}Skill Description Optimization</h1>
    <div class="explainer">
        <strong>Optimizing your skill's description.</strong> This page updates automatically as Claude tests different versions of your skill's description. Each row is an iteration — a new description attempt. The columns show test queries: green checkmarks mean the skill triggered correctly (or correctly didn't trigger), red crosses mean it got it wrong. The "Train" score shows performance on queries used to improve the description; the "Test" score shows performance on held-out queries the optimizer hasn't seen. When it's done, Claude will apply the best-performing description to your skill.
    </div>
`,
  ];

  // Summary section
  const bestTestScore = data.best_test_score;
  htmlParts.push(`
    <div class="summary">
        <p><strong>Original:</strong> ${escapeHtml(String(data.original_description ?? "N/A"))}</p>
        <p class="best"><strong>Best:</strong> ${escapeHtml(String(data.best_description ?? "N/A"))}</p>
        <p><strong>Best Score:</strong> ${data.best_score ?? "N/A"} ${bestTestScore ? "(test)" : "(train)"}</p>
        <p><strong>Iterations:</strong> ${data.iterations_run ?? 0} | <strong>Train:</strong> ${data.train_size ?? "?"} | <strong>Test:</strong> ${data.test_size ?? "?"}</p>
    </div>
`);

  // Legend
  htmlParts.push(`
    <div class="legend">
        <span style="font-weight:600">Query columns:</span>
        <span class="legend-item"><span class="legend-swatch swatch-positive"></span> Should trigger</span>
        <span class="legend-item"><span class="legend-swatch swatch-negative"></span> Should NOT trigger</span>
        <span class="legend-item"><span class="legend-swatch swatch-train"></span> Train</span>
        <span class="legend-item"><span class="legend-swatch swatch-test"></span> Test</span>
    </div>
`);

  // Table header
  htmlParts.push(`
    <div class="table-container">
    <table>
        <thead>
            <tr>
                <th>Iter</th>
                <th>Train</th>
                <th>Test</th>
                <th class="query-col">Description</th>
`);

  // Add column headers for train queries
  for (const qinfo of trainQueries) {
    const polarity = qinfo.should_trigger ? "positive-col" : "negative-col";
    htmlParts.push(`                <th class="${polarity}">${escapeHtml(qinfo.query)}</th>\n`);
  }

  // Add column headers for test queries (different color)
  for (const qinfo of testQueries) {
    const polarity = qinfo.should_trigger ? "positive-col" : "negative-col";
    htmlParts.push(`                <th class="test-col ${polarity}">${escapeHtml(qinfo.query)}</th>\n`);
  }

  htmlParts.push(`            </tr>
        </thead>
        <tbody>
`);

  // Find best iteration for highlighting
  let bestIter: number | string | undefined;
  if (testQueries.length > 0) {
    bestIter = history.reduce(
      (best, h) => ((h.test_passed ?? 0) > (best.test_passed ?? 0) ? h : best),
      history[0]
    )?.iteration;
  } else {
    bestIter = history.reduce(
      (best, h) =>
        (h.train_passed ?? h.passed ?? 0) > (best.train_passed ?? best.passed ?? 0) ? h : best,
      history[0]
    )?.iteration;
  }

  // Add rows for each iteration
  for (const h of history) {
    const iteration = h.iteration ?? "?";
    const trainResults = h.train_results ?? h.results ?? [];
    const testResults = h.test_results ?? [];
    const description = h.description ?? "";

    // Create lookups for results by query
    const trainByQuery: Record<string, EvalResult> = {};
    for (const r of trainResults) {
      trainByQuery[r.query] = r;
    }
    const testByQuery: Record<string, EvalResult> = {};
    if (testResults) {
      for (const r of testResults) {
        testByQuery[r.query] = r;
      }
    }

    // Compute aggregate correct/total runs across all retries
    function aggregateRuns(results: EvalResult[]): [number, number] {
      let correct = 0;
      let total = 0;
      for (const r of results) {
        const runs = r.runs ?? 0;
        const triggers = r.triggers ?? 0;
        total += runs;
        if (r.should_trigger ?? true) {
          correct += triggers;
        } else {
          correct += runs - triggers;
        }
      }
      return [correct, total];
    }

    const [trainCorrect, trainRuns] = aggregateRuns(trainResults);
    const [testCorrect, testTotalRuns] = aggregateRuns(testResults ?? []);

    // Determine score classes
    function scoreClass(correct: number, total: number): string {
      if (total > 0) {
        const ratio = correct / total;
        if (ratio >= 0.8) return "score-good";
        if (ratio >= 0.5) return "score-ok";
      }
      return "score-bad";
    }

    const trainClass = scoreClass(trainCorrect, trainRuns);
    const testClass = scoreClass(testCorrect, testTotalRuns);
    const rowClass = iteration === bestIter ? "best-row" : "";

    htmlParts.push(`            <tr class="${rowClass}">
                <td>${iteration}</td>
                <td><span class="score ${trainClass}">${trainCorrect}/${trainRuns}</span></td>
                <td><span class="score ${testClass}">${testCorrect}/${testTotalRuns}</span></td>
                <td class="description">${escapeHtml(description)}</td>
`);

    // Add result for each train query
    for (const qinfo of trainQueries) {
      const r = trainByQuery[qinfo.query] ?? {};
      const didPass = r.pass ?? false;
      const triggers = r.triggers ?? 0;
      const runs = r.runs ?? 0;
      const icon = didPass ? "✓" : "✗";
      const cssClass = didPass ? "pass" : "fail";
      htmlParts.push(
        `                <td class="result ${cssClass}">${icon}<span class="rate">${triggers}/${runs}</span></td>\n`
      );
    }

    // Add result for each test query (with different background)
    for (const qinfo of testQueries) {
      const r = testByQuery[qinfo.query] ?? {};
      const didPass = r.pass ?? false;
      const triggers = r.triggers ?? 0;
      const runs = r.runs ?? 0;
      const icon = didPass ? "✓" : "✗";
      const cssClass = didPass ? "pass" : "fail";
      htmlParts.push(
        `                <td class="result test-result ${cssClass}">${icon}<span class="rate">${triggers}/${runs}</span></td>\n`
      );
    }

    htmlParts.push("            </tr>\n");
  }

  htmlParts.push(`        </tbody>
    </table>
    </div>
`);

  htmlParts.push(`
</body>
</html>
`);

  return htmlParts.join("");
}

function main() {
  const args = process.argv.slice(2);
  let inputPath = "";
  let outputPath = "";
  let skillName = "";

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "-o" || args[i] === "--output") && i + 1 < args.length) {
      outputPath = args[++i];
    } else if (args[i] === "--skill-name" && i + 1 < args.length) {
      skillName = args[++i];
    } else if (!args[i].startsWith("-")) {
      inputPath = args[i];
    }
  }

  if (!inputPath) {
    process.stderr.write("Usage: bun scripts/generate-report.ts <input.json> [-o output.html] [--skill-name NAME]\n");
    process.exit(1);
  }

  let data: Record<string, unknown>;
  if (inputPath === "-") {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => {
      data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const htmlOutput = generateHtml(data, false, skillName);
      if (outputPath) {
        fs.writeFileSync(outputPath, htmlOutput, "utf8");
        process.stderr.write(`Report written to ${outputPath}\n`);
      } else {
        process.stdout.write(htmlOutput);
      }
    });
    return;
  }

  data = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const htmlOutput = generateHtml(data, false, skillName);

  if (outputPath) {
    fs.writeFileSync(outputPath, htmlOutput, "utf8");
    process.stderr.write(`Report written to ${outputPath}\n`);
  } else {
    process.stdout.write(htmlOutput);
  }
}

if (import.meta.main) {
  main();
}
