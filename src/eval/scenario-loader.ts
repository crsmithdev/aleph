/**
 * Loader for hook enforcement scenarios (scenario.yaml format).
 *
 * Each hook scenario lives in src/eval/scenarios/<name>/scenario.yaml and
 * declares the hook to exercise, the expected decision (block/advisory/pass),
 * the depth classification to inject (full/quick), and success criteria.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { resolve } from "path";
import { parse as parseYaml } from "yaml";

export interface HookScenario {
  name: string;
  description: string;
  hook: string;
  event: string;
  expect: "block" | "advisory" | "pass";
  setup: {
    depth: "full" | "quick";
    prompt: string;
    constraints?: string[];
  };
  success: Array<{
    type: string;
    expected?: string;
    description?: string;
  }>;
  trials: number;
}

export function loadScenario(scenarioDir: string): HookScenario {
  const yamlPath = resolve(scenarioDir, "scenario.yaml");
  if (!existsSync(yamlPath)) throw new Error(`No scenario.yaml in ${scenarioDir}`);
  const raw = readFileSync(yamlPath, "utf8");
  const parsed = parseYaml(raw) as HookScenario;
  validateScenario(parsed, yamlPath);
  return parsed;
}

function validateScenario(s: HookScenario, path: string) {
  if (!s.name) throw new Error(`${path}: missing 'name'`);
  if (!s.hook) throw new Error(`${path}: missing 'hook'`);
  if (!["block", "advisory", "pass"].includes(s.expect)) {
    throw new Error(`${path}: 'expect' must be block|advisory|pass, got '${s.expect}'`);
  }
  if (!["full", "quick"].includes(s.setup?.depth)) {
    throw new Error(`${path}: setup.depth must be full|quick, got '${s.setup?.depth}'`);
  }
  if (!s.setup?.prompt) throw new Error(`${path}: missing setup.prompt`);
  if (!Array.isArray(s.success) || s.success.length === 0) {
    throw new Error(`${path}: 'success' must be a non-empty array`);
  }
  if (typeof s.trials !== "number" || s.trials < 1) {
    throw new Error(`${path}: 'trials' must be a positive number`);
  }
}

/** List all scenario directory names that contain a scenario.yaml. */
export function listHookScenarios(scenariosDir: string): string[] {
  return readdirSync(scenariosDir)
    .filter((d) => {
      const full = resolve(scenariosDir, d);
      return statSync(full).isDirectory() && existsSync(resolve(full, "scenario.yaml"));
    })
    .sort();
}

/** Build the system prompt for a hook scenario trial. */
export function buildSystemPrompt(scenario: HookScenario): string {
  const lines = [
    `You are a software engineer working on a codebase.`,
  ];

  if (scenario.setup.constraints && scenario.setup.constraints.length > 0) {
    lines.push(`\nIMPORTANT constraints for this task:`);
    for (const c of scenario.setup.constraints) {
      lines.push(`- ${c}`);
    }
  }

  return lines.join("\n");
}
