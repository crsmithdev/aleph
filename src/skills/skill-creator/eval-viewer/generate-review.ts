#!/usr/bin/env bun
/**
 * Generate and serve a review page for eval results.
 *
 * Reads the workspace directory, discovers runs (directories with outputs/),
 * embeds all output data into a self-contained HTML page, and serves it via
 * a tiny HTTP server. Feedback auto-saves to feedback.json in the workspace.
 *
 * Usage:
 *     bun eval-viewer/generate-review.ts <workspace-path> [--port PORT] [--skill-name NAME]
 *     bun eval-viewer/generate-review.ts <workspace-path> --previous-feedback /path/to/old/feedback.json
 *
 * No external dependencies required.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as http from "node:http";
import * as net from "node:net";
import { spawnSync } from "node:child_process";

// Files to exclude from output listings
const METADATA_FILES = new Set(["transcript.md", "user_notes.md", "metrics.json"]);

// Extensions we render as inline text
const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".json", ".csv", ".py", ".js", ".ts", ".tsx", ".jsx",
  ".yaml", ".yml", ".xml", ".html", ".css", ".sh", ".rb", ".go", ".rs",
  ".java", ".c", ".cpp", ".h", ".hpp", ".sql", ".r", ".toml",
]);

// Extensions we render as inline images
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"]);

// MIME type map for common types
const MIME_MAP: Record<string, string> = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".csv": "text/csv",
  ".py": "text/x-python",
  ".js": "application/javascript",
  ".ts": "application/typescript",
  ".html": "text/html",
  ".css": "text/css",
  ".sh": "application/x-sh",
  ".yaml": "application/x-yaml",
  ".yml": "application/x-yaml",
  ".xml": "application/xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_MAP[ext] ?? "application/octet-stream";
}

interface OutputFile {
  name: string;
  type: string;
  content?: string;
  mime?: string;
  data_uri?: string;
  data_b64?: string;
}

interface Run {
  id: string;
  prompt: string;
  eval_id: number | null;
  outputs: OutputFile[];
  grading: Record<string, unknown> | null;
}

function findRuns(workspace: string): Run[] {
  const runs: Run[] = [];
  findRunsRecursive(workspace, workspace, runs);
  runs.sort((a, b) => {
    const aId = a.eval_id ?? Infinity;
    const bId = b.eval_id ?? Infinity;
    if (aId !== bId) return aId - bId;
    return a.id.localeCompare(b.id);
  });
  return runs;
}

function findRunsRecursive(root: string, current: string, runs: Run[]): void {
  if (!fs.existsSync(current) || !fs.statSync(current).isDirectory()) return;

  const outputsDir = path.join(current, "outputs");
  if (fs.existsSync(outputsDir) && fs.statSync(outputsDir).isDirectory()) {
    const run = buildRun(root, current);
    if (run) runs.push(run);
    return;
  }

  const skip = new Set(["node_modules", ".git", "__pycache__", "skill", "inputs"]);
  const children = fs.readdirSync(current).sort();
  for (const child of children) {
    const childPath = path.join(current, child);
    if (fs.statSync(childPath).isDirectory() && !skip.has(child)) {
      findRunsRecursive(root, childPath, runs);
    }
  }
}

function buildRun(root: string, runDir: string): Run | null {
  let prompt = "";
  let evalId: number | null = null;

  // Try eval_metadata.json
  const metadataCandidates = [
    path.join(runDir, "eval_metadata.json"),
    path.join(path.dirname(runDir), "eval_metadata.json"),
  ];
  for (const candidate of metadataCandidates) {
    if (fs.existsSync(candidate)) {
      try {
        const metadata = JSON.parse(fs.readFileSync(candidate, "utf8"));
        prompt = metadata.prompt ?? "";
        evalId = metadata.eval_id ?? null;
      } catch {
        // ignore
      }
      if (prompt) break;
    }
  }

  // Fall back to transcript.md
  if (!prompt) {
    const transcriptCandidates = [
      path.join(runDir, "transcript.md"),
      path.join(runDir, "outputs", "transcript.md"),
    ];
    for (const candidate of transcriptCandidates) {
      if (fs.existsSync(candidate)) {
        try {
          const text = fs.readFileSync(candidate, "utf8");
          const match = text.match(/## Eval Prompt\n\n([\s\S]*?)(?=\n##|$)/);
          if (match) {
            prompt = match[1].trim();
          }
        } catch {
          // ignore
        }
        if (prompt) break;
      }
    }
  }

  if (!prompt) {
    prompt = "(No prompt found)";
  }

  const runId = path
    .relative(root, runDir)
    .replace(/\\/g, "-")
    .replace(/\//g, "-");

  // Collect output files
  const outputsDir = path.join(runDir, "outputs");
  const outputFiles: OutputFile[] = [];
  if (fs.existsSync(outputsDir) && fs.statSync(outputsDir).isDirectory()) {
    const files = fs.readdirSync(outputsDir).sort();
    for (const file of files) {
      const filePath = path.join(outputsDir, file);
      if (fs.statSync(filePath).isFile() && !METADATA_FILES.has(file)) {
        outputFiles.push(embedFile(filePath));
      }
    }
  }

  // Load grading if present
  let grading: Record<string, unknown> | null = null;
  const gradingCandidates = [
    path.join(runDir, "grading.json"),
    path.join(path.dirname(runDir), "grading.json"),
  ];
  for (const candidate of gradingCandidates) {
    if (fs.existsSync(candidate)) {
      try {
        grading = JSON.parse(fs.readFileSync(candidate, "utf8"));
      } catch {
        // ignore
      }
      if (grading) break;
    }
  }

  return {
    id: runId,
    prompt,
    eval_id: evalId,
    outputs: outputFiles,
    grading,
  };
}

function embedFile(filePath: string): OutputFile {
  const ext = path.extname(filePath).toLowerCase();
  const mime = getMimeType(filePath);
  const name = path.basename(filePath);

  if (TEXT_EXTENSIONS.has(ext)) {
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch {
      content = "(Error reading file)";
    }
    return { name, type: "text", content };
  } else if (IMAGE_EXTENSIONS.has(ext)) {
    try {
      const raw = fs.readFileSync(filePath);
      const b64 = raw.toString("base64");
      return { name, type: "image", mime, data_uri: `data:${mime};base64,${b64}` };
    } catch {
      return { name, type: "error", content: "(Error reading file)" };
    }
  } else if (ext === ".pdf") {
    try {
      const raw = fs.readFileSync(filePath);
      const b64 = raw.toString("base64");
      return { name, type: "pdf", data_uri: `data:${mime};base64,${b64}` };
    } catch {
      return { name, type: "error", content: "(Error reading file)" };
    }
  } else if (ext === ".xlsx") {
    try {
      const raw = fs.readFileSync(filePath);
      const b64 = raw.toString("base64");
      return { name, type: "xlsx", data_b64: b64 };
    } catch {
      return { name, type: "error", content: "(Error reading file)" };
    }
  } else {
    // Binary / unknown — base64 download link
    try {
      const raw = fs.readFileSync(filePath);
      const b64 = raw.toString("base64");
      return { name, type: "binary", mime, data_uri: `data:${mime};base64,${b64}` };
    } catch {
      return { name, type: "error", content: "(Error reading file)" };
    }
  }
}

function loadPreviousIteration(workspace: string): Record<string, { feedback: string; outputs: OutputFile[] }> {
  const result: Record<string, { feedback: string; outputs: OutputFile[] }> = {};

  // Load feedback
  const feedbackMap: Record<string, string> = {};
  const feedbackPath = path.join(workspace, "feedback.json");
  if (fs.existsSync(feedbackPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(feedbackPath, "utf8"));
      for (const r of data.reviews ?? []) {
        if (r.feedback?.trim()) {
          feedbackMap[r.run_id] = r.feedback;
        }
      }
    } catch {
      // ignore
    }
  }

  // Load runs (to get outputs)
  const prevRuns = findRuns(workspace);
  for (const run of prevRuns) {
    result[run.id] = {
      feedback: feedbackMap[run.id] ?? "",
      outputs: run.outputs ?? [],
    };
  }

  // Also add feedback for run_ids that had feedback but no matching run
  for (const [runId, fb] of Object.entries(feedbackMap)) {
    if (!(runId in result)) {
      result[runId] = { feedback: fb, outputs: [] };
    }
  }

  return result;
}

function generateHtml(
  runs: Run[],
  skillName: string,
  previous: Record<string, { feedback: string; outputs: OutputFile[] }> | null = null,
  benchmark: Record<string, unknown> | null = null
): string {
  const templatePath = path.join(path.dirname(import.meta.url.replace("file://", "")), "viewer.html");
  const template = fs.readFileSync(templatePath, "utf8");

  // Build previous_feedback and previous_outputs maps for the template
  const previousFeedback: Record<string, string> = {};
  const previousOutputs: Record<string, OutputFile[]> = {};
  if (previous) {
    for (const [runId, data] of Object.entries(previous)) {
      if (data.feedback) previousFeedback[runId] = data.feedback;
      if (data.outputs?.length) previousOutputs[runId] = data.outputs;
    }
  }

  const embedded: Record<string, unknown> = {
    skill_name: skillName,
    runs,
    previous_feedback: previousFeedback,
    previous_outputs: previousOutputs,
  };
  if (benchmark) {
    embedded.benchmark = benchmark;
  }

  const dataJson = JSON.stringify(embedded);
  return template.replace("/*__EMBEDDED_DATA__*/", `const EMBEDDED_DATA = ${dataJson};`);
}

function killPort(port: number): void {
  try {
    const result = spawnSync("lsof", ["-ti", `:${port}`], {
      encoding: "utf8",
      timeout: 5000,
    });
    const pids = (result.stdout as string).trim().split("\n").filter(Boolean);
    for (const pidStr of pids) {
      try {
        process.kill(parseInt(pidStr.trim(), 10), "SIGTERM");
      } catch {
        // ignore
      }
    }
    if (pids.length > 0) {
      // Brief pause after killing
      Bun.sleepSync(500);
    }
  } catch {
    // lsof not available or other error — ignore
  }
}

function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(true));
    server.once("listening", () => {
      server.close();
      resolve(false);
    });
    server.listen(port, "127.0.0.1");
  });
}

function openBrowser(url: string): void {
  const result = spawnSync("xdg-open", [url], { stdio: "ignore" });
  if (result.status !== 0) {
    spawnSync("open", [url], { stdio: "ignore" });
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let workspaceArg = "";
  let port = 3117;
  let skillName: string | null = null;
  let previousWorkspace: string | null = null;
  let benchmarkPath: string | null = null;
  let staticPath: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "--port" || args[i] === "-p") && i + 1 < args.length) {
      port = parseInt(args[++i], 10);
    } else if ((args[i] === "--skill-name" || args[i] === "-n") && i + 1 < args.length) {
      skillName = args[++i];
    } else if (args[i] === "--previous-workspace" && i + 1 < args.length) {
      previousWorkspace = path.resolve(args[++i]);
    } else if (args[i] === "--benchmark" && i + 1 < args.length) {
      benchmarkPath = path.resolve(args[++i]);
    } else if ((args[i] === "--static" || args[i] === "-s") && i + 1 < args.length) {
      staticPath = args[++i];
    } else if (!args[i].startsWith("-")) {
      workspaceArg = args[i];
    }
  }

  if (!workspaceArg) {
    process.stderr.write(
      "Usage: bun eval-viewer/generate-review.ts <workspace> [--port PORT] [--skill-name NAME] [--previous-workspace PATH] [--benchmark PATH] [--static PATH]\n"
    );
    process.exit(1);
  }

  const workspace = path.resolve(workspaceArg);
  if (!fs.existsSync(workspace) || !fs.statSync(workspace).isDirectory()) {
    process.stderr.write(`Error: ${workspace} is not a directory\n`);
    process.exit(1);
  }

  const runs = findRuns(workspace);
  if (runs.length === 0) {
    process.stderr.write(`No runs found in ${workspace}\n`);
    process.exit(1);
  }

  const resolvedSkillName = skillName ?? path.basename(workspace).replace(/-workspace$/, "");
  const feedbackPath = path.join(workspace, "feedback.json");

  let previous: Record<string, { feedback: string; outputs: OutputFile[] }> | null = null;
  if (previousWorkspace) {
    previous = loadPreviousIteration(previousWorkspace);
  }

  let benchmark: Record<string, unknown> | null = null;
  if (benchmarkPath && fs.existsSync(benchmarkPath)) {
    try {
      benchmark = JSON.parse(fs.readFileSync(benchmarkPath, "utf8"));
    } catch {
      // ignore
    }
  }

  if (staticPath) {
    const html = generateHtml(runs, resolvedSkillName, previous, benchmark);
    fs.mkdirSync(path.dirname(path.resolve(staticPath)), { recursive: true });
    fs.writeFileSync(staticPath, html, "utf8");
    process.stdout.write(`\n  Static viewer written to: ${staticPath}\n\n`);
    process.exit(0);
  }

  // Kill any existing process on the target port
  killPort(port);

  const inUse = await isPortInUse(port);
  if (inUse) {
    // Find a free port
    const tempServer = net.createServer();
    await new Promise<void>((resolve) => {
      tempServer.listen(0, "127.0.0.1", () => {
        const addr = tempServer.address() as net.AddressInfo;
        port = addr.port;
        tempServer.close(() => resolve());
      });
    });
  }

  const server = http.createServer((req, res) => {
    const urlPath = req.url ?? "/";

    if (req.method === "GET" && (urlPath === "/" || urlPath === "/index.html")) {
      // Regenerate HTML on each request (re-scans workspace for new outputs)
      const freshRuns = findRuns(workspace);
      let freshBenchmark: Record<string, unknown> | null = null;
      if (benchmarkPath && fs.existsSync(benchmarkPath)) {
        try {
          freshBenchmark = JSON.parse(fs.readFileSync(benchmarkPath, "utf8"));
        } catch {
          // ignore
        }
      }
      const html = generateHtml(freshRuns, resolvedSkillName, previous, freshBenchmark);
      const content = Buffer.from(html, "utf8");
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": content.length,
      });
      res.end(content);
    } else if (req.method === "GET" && urlPath === "/api/feedback") {
      let data = Buffer.from("{}");
      if (fs.existsSync(feedbackPath)) {
        data = fs.readFileSync(feedbackPath);
      }
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Length": data.length,
      });
      res.end(data);
    } else if (req.method === "POST" && urlPath === "/api/feedback") {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const body = Buffer.concat(chunks);
        try {
          const parsed = JSON.parse(body.toString("utf8"));
          if (typeof parsed !== "object" || !parsed || !("reviews" in parsed)) {
            throw new Error("Expected JSON object with 'reviews' key");
          }
          fs.writeFileSync(feedbackPath, JSON.stringify(parsed, null, 2) + "\n", "utf8");
          const resp = Buffer.from('{"ok":true}');
          res.writeHead(200, {
            "Content-Type": "application/json",
            "Content-Length": resp.length,
          });
          res.end(resp);
        } catch (e) {
          const resp = Buffer.from(JSON.stringify({ error: String(e) }));
          res.writeHead(500, {
            "Content-Type": "application/json",
            "Content-Length": resp.length,
          });
          res.end(resp);
        }
      });
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  server.listen(port, "127.0.0.1", () => {
    const url = `http://localhost:${port}`;
    process.stdout.write("\n  Eval Viewer\n");
    process.stdout.write("  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n");
    process.stdout.write(`  URL:       ${url}\n`);
    process.stdout.write(`  Workspace: ${workspace}\n`);
    process.stdout.write(`  Feedback:  ${feedbackPath}\n`);
    if (previous) {
      process.stdout.write(`  Previous:  ${previousWorkspace} (${Object.keys(previous).length} runs)\n`);
    }
    if (benchmarkPath) {
      process.stdout.write(`  Benchmark: ${benchmarkPath}\n`);
    }
    process.stdout.write("\n  Press Ctrl+C to stop.\n\n");

    openBrowser(url);
  });

  process.on("SIGINT", () => {
    process.stdout.write("\nStopped.\n");
    server.close();
    process.exit(0);
  });
}

if (import.meta.main) {
  main().catch((e) => {
    process.stderr.write(`Error: ${e}\n`);
    process.exit(1);
  });
}
