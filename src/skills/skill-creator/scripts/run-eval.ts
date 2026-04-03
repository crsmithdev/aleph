#!/usr/bin/env bun
/**
 * Run trigger evaluation for a skill description.
 *
 * Tests whether a skill's description causes Claude to trigger (read the skill)
 * for a set of queries. Outputs results as JSON.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { spawn } from "node:child_process";
import { parseSkillMd } from "./utils.js";

export function findProjectRoot(): string {
  /**
   * Find the project root by walking up from cwd looking for .claude/.
   *
   * Mimics how Claude Code discovers its project root, so the command file
   * we create ends up where claude -p will look for it.
   */
  let current = process.cwd();
  const visited = new Set<string>();
  while (true) {
    if (visited.has(current)) break;
    visited.add(current);
    if (fs.existsSync(path.join(current, ".claude")) && fs.statSync(path.join(current, ".claude")).isDirectory()) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return process.cwd();
}

async function runSingleQuery(
  query: string,
  skillName: string,
  skillDescription: string,
  timeout: number,
  projectRoot: string,
  model: string | null = null
): Promise<boolean> {
  /**
   * Run a single query and return whether the skill was triggered.
   *
   * Creates a command file in .claude/commands/ so it appears in Claude's
   * available_skills list, then runs `claude -p` with the raw query.
   * Uses --include-partial-messages to detect triggering early from
   * stream events (content_block_start) rather than waiting for the
   * full assistant message.
   */
  const uniqueId = crypto.randomBytes(4).toString("hex");
  const cleanName = `${skillName}-skill-${uniqueId}`;
  const projectCommandsDir = path.join(projectRoot, ".claude", "commands");
  const commandFile = path.join(projectCommandsDir, `${cleanName}.md`);

  try {
    fs.mkdirSync(projectCommandsDir, { recursive: true });

    // Use YAML block scalar to avoid breaking on quotes in description
    const indentedDesc = skillDescription.split("\n").join("\n  ");
    const commandContent =
      `---\n` +
      `description: |\n` +
      `  ${indentedDesc}\n` +
      `---\n\n` +
      `# ${skillName}\n\n` +
      `This skill handles: ${skillDescription}\n`;

    fs.writeFileSync(commandFile, commandContent, "utf8");

    const cmd = [
      "claude",
      "-p", query,
      "--output-format", "stream-json",
      "--verbose",
      "--include-partial-messages",
    ];
    if (model) {
      cmd.push("--model", model);
    }

    // Remove CLAUDECODE env var to allow nesting claude -p inside a
    // Claude Code session.
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (k !== "CLAUDECODE" && v !== undefined) {
        env[k] = v;
      }
    }

    return await new Promise<boolean>((resolve) => {
      const proc = spawn(cmd[0], cmd.slice(1), {
        cwd: projectRoot,
        env,
        stdio: ["ignore", "pipe", "ignore"],
      });

      let triggered = false;
      let buffer = "";
      let pendingToolName: string | null = null;
      let accumulatedJson = "";
      let settled = false;

      const startTime = Date.now();

      const timeoutHandle = setTimeout(() => {
        if (!settled) {
          settled = true;
          proc.kill();
          resolve(false);
        }
      }, timeout * 1000);

      function settle(value: boolean) {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutHandle);
          proc.kill();
          resolve(value);
        }
      }

      proc.stdout.on("data", (chunk: Buffer) => {
        if (settled) return;
        buffer += chunk.toString("utf8");

        while (buffer.includes("\n")) {
          const newlineIdx = buffer.indexOf("\n");
          const line = buffer.slice(0, newlineIdx).trim();
          buffer = buffer.slice(newlineIdx + 1);

          if (!line) continue;

          let event: Record<string, unknown>;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }

          // Early detection via stream events
          if (event.type === "stream_event") {
            const se = (event.event as Record<string, unknown>) ?? {};
            const seType = se.type as string ?? "";

            if (seType === "content_block_start") {
              const cb = (se.content_block as Record<string, unknown>) ?? {};
              if (cb.type === "tool_use") {
                const toolName = cb.name as string ?? "";
                if (toolName === "Skill" || toolName === "Read") {
                  pendingToolName = toolName;
                  accumulatedJson = "";
                } else {
                  settle(false);
                  return;
                }
              }
            } else if (seType === "content_block_delta" && pendingToolName) {
              const delta = (se.delta as Record<string, unknown>) ?? {};
              if (delta.type === "input_json_delta") {
                accumulatedJson += (delta.partial_json as string) ?? "";
                if (accumulatedJson.includes(cleanName)) {
                  settle(true);
                  return;
                }
              }
            } else if (seType === "content_block_stop" || seType === "message_stop") {
              if (pendingToolName) {
                settle(accumulatedJson.includes(cleanName));
                return;
              }
              if (seType === "message_stop") {
                settle(false);
                return;
              }
            }
          }
          // Fallback: full assistant message
          else if (event.type === "assistant") {
            const message = (event.message as Record<string, unknown>) ?? {};
            const content = (message.content as unknown[]) ?? [];
            for (const contentItem of content) {
              const item = contentItem as Record<string, unknown>;
              if (item.type !== "tool_use") continue;
              const toolName = item.name as string ?? "";
              const toolInput = (item.input as Record<string, string>) ?? {};
              if (toolName === "Skill" && (toolInput.skill ?? "").includes(cleanName)) {
                triggered = true;
              } else if (toolName === "Read" && (toolInput.file_path ?? "").includes(cleanName)) {
                triggered = true;
              }
              settle(triggered);
              return;
            }
          } else if (event.type === "result") {
            settle(triggered);
            return;
          }
        }
      });

      proc.on("close", () => {
        settle(triggered);
      });

      proc.on("error", () => {
        settle(false);
      });
    });
  } finally {
    if (fs.existsSync(commandFile)) {
      fs.unlinkSync(commandFile);
    }
  }
}

interface EvalItem {
  query: string;
  should_trigger: boolean;
}

export async function runEval(params: {
  evalSet: EvalItem[];
  skillName: string;
  description: string;
  numWorkers: number;
  timeout: number;
  projectRoot: string;
  runsPerQuery?: number;
  triggerThreshold?: number;
  model?: string | null;
}): Promise<Record<string, unknown>> {
  const {
    evalSet,
    skillName,
    description,
    numWorkers,
    timeout,
    projectRoot,
    runsPerQuery = 1,
    triggerThreshold = 0.5,
    model = null,
  } = params;

  // Build all tasks: (item, runIdx)
  const tasks: Array<{ item: EvalItem; runIdx: number }> = [];
  for (const item of evalSet) {
    for (let runIdx = 0; runIdx < runsPerQuery; runIdx++) {
      tasks.push({ item, runIdx });
    }
  }

  // Process with concurrency limit (numWorkers)
  const queryTriggers: Record<string, boolean[]> = {};
  const queryItems: Record<string, EvalItem> = {};

  let idx = 0;
  const inFlight: Array<Promise<void>> = [];

  async function runTask(task: { item: EvalItem; runIdx: number }): Promise<void> {
    const { item } = task;
    const query = item.query;
    queryItems[query] = item;
    if (!(query in queryTriggers)) {
      queryTriggers[query] = [];
    }
    try {
      const result = await runSingleQuery(query, skillName, description, timeout, projectRoot, model);
      queryTriggers[query].push(result);
    } catch (e) {
      process.stderr.write(`Warning: query failed: ${e}\n`);
      queryTriggers[query].push(false);
    }
  }

  // Use a worker pool approach
  const allPromises = tasks.map((task) => runTask(task));
  // Run numWorkers at a time using a semaphore approach
  const semaphore = new Semaphore(numWorkers);
  await Promise.all(
    tasks.map((task) =>
      semaphore.acquire().then(async (release) => {
        try {
          await runTask(task);
        } finally {
          release();
        }
      })
    )
  );

  const results: unknown[] = [];
  for (const [query, triggers] of Object.entries(queryTriggers)) {
    const item = queryItems[query];
    const triggerRate = triggers.reduce((a, b) => a + (b ? 1 : 0), 0) / triggers.length;
    const shouldTrigger = item.should_trigger;
    let didPass: boolean;
    if (shouldTrigger) {
      didPass = triggerRate >= triggerThreshold;
    } else {
      didPass = triggerRate < triggerThreshold;
    }
    results.push({
      query,
      should_trigger: shouldTrigger,
      trigger_rate: triggerRate,
      triggers: triggers.filter(Boolean).length,
      runs: triggers.length,
      pass: didPass,
    });
  }

  const passed = (results as Array<{ pass: boolean }>).filter((r) => r.pass).length;
  const total = results.length;

  return {
    skill_name: skillName,
    description,
    results,
    summary: {
      total,
      passed,
      failed: total - passed,
    },
  };
}

class Semaphore {
  private permits: number;
  private queue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      if (this.permits > 0) {
        this.permits--;
        resolve(() => this.release());
      } else {
        this.queue.push(() => {
          this.permits--;
          resolve(() => this.release());
        });
      }
    });
  }

  private release() {
    this.permits++;
    const next = this.queue.shift();
    if (next) next();
  }
}

async function main() {
  const args = process.argv.slice(2);
  let evalSetPath = "";
  let skillPath = "";
  let descriptionOverride: string | null = null;
  let numWorkers = 10;
  let timeout = 30;
  let runsPerQuery = 3;
  let triggerThreshold = 0.5;
  let model: string | null = null;
  let verbose = false;

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
    } else if (args[i] === "--runs-per-query" && i + 1 < args.length) {
      runsPerQuery = parseInt(args[++i], 10);
    } else if (args[i] === "--trigger-threshold" && i + 1 < args.length) {
      triggerThreshold = parseFloat(args[++i]);
    } else if (args[i] === "--model" && i + 1 < args.length) {
      model = args[++i];
    } else if (args[i] === "--verbose") {
      verbose = true;
    }
  }

  if (!evalSetPath || !skillPath) {
    process.stderr.write(
      "Usage: bun scripts/run-eval.ts --eval-set <path> --skill-path <path> [--description DESC] [--num-workers N] [--timeout N] [--runs-per-query N] [--trigger-threshold F] [--model MODEL] [--verbose]\n"
    );
    process.exit(1);
  }

  const evalSet: EvalItem[] = JSON.parse(fs.readFileSync(evalSetPath, "utf8"));

  if (!fs.existsSync(path.join(skillPath, "SKILL.md"))) {
    process.stderr.write(`Error: No SKILL.md found at ${skillPath}\n`);
    process.exit(1);
  }

  const [name, originalDescription] = parseSkillMd(skillPath);
  const description = descriptionOverride ?? originalDescription;
  const projectRoot = findProjectRoot();

  if (verbose) {
    process.stderr.write(`Evaluating: ${description}\n`);
  }

  const output = await runEval({
    evalSet,
    skillName: name,
    description,
    numWorkers,
    timeout,
    projectRoot,
    runsPerQuery,
    triggerThreshold,
    model,
  });

  if (verbose) {
    const summary = output.summary as Record<string, number>;
    process.stderr.write(`Results: ${summary.passed}/${summary.total} passed\n`);
    for (const r of output.results as Array<Record<string, unknown>>) {
      const status = r.pass ? "PASS" : "FAIL";
      const rateStr = `${r.triggers}/${r.runs}`;
      process.stderr.write(
        `  [${status}] rate=${rateStr} expected=${r.should_trigger}: ${String(r.query).slice(0, 70)}\n`
      );
    }
  }

  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
}

if (import.meta.main) {
  main().catch((e) => {
    process.stderr.write(`Error: ${e}\n`);
    process.exit(1);
  });
}
