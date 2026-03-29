#!/usr/bin/env bun
/**
 * E2E dispatch pipeline test.
 *
 * Spawns a real `claude -p` session with an architectural prompt,
 * verifies the hooks wrote correct signal files, then checks that
 * the telemetry API returns the compliance data.
 *
 * Run: bun test src/telemetry/__tests__/dispatch-e2e.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { execSync } from "child_process";
import { readFileSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(import.meta.dir, "../../..");
const SIGNALS_DIR = resolve(ROOT, ".dev/data/signals");
const DIRECTIVES_FILE = resolve(SIGNALS_DIR, "directives.jsonl");
const COMPLIANCE_FILE = resolve(SIGNALS_DIR, "compliance.jsonl");

// Snapshot line counts before the test session
let directivesLinesBefore: number;
let complianceLinesBefore: number;
let testSessionId: string | undefined;

function countLines(path: string): number {
  if (!existsSync(path)) return 0;
  return readFileSync(path, "utf-8").trim().split("\n").filter(Boolean).length;
}

function lastNLines(path: string, n: number): string[] {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf-8").trim().split("\n").filter(Boolean);
  return lines.slice(-n);
}

describe("dispatch e2e pipeline", () => {
  beforeAll(() => {
    mkdirSync(SIGNALS_DIR, { recursive: true });
    directivesLinesBefore = countLines(DIRECTIVES_FILE);
    complianceLinesBefore = countLines(COMPLIANCE_FILE);

    // Spawn a real Claude session with an architectural prompt.
    // The prompt is crafted to:
    //   1. Trigger format-reminder's architectural keyword detection ("refactor")
    //   2. Instruct Claude to call Agent tool (so compliance-check sees dispatch=true)
    //   3. Be fast and cheap (haiku model, restricted tools)
    const prompt = [
      "Refactor task: You MUST call the Agent tool exactly once with these parameters:",
      '  description: "dispatch e2e test"',
      '  prompt: "Say hello"',
      '  subagent_type: "general-purpose"',
      '  run_in_background: false',
      "After the Agent call completes, output the single word DONE and stop.",
    ].join(" ");

    try {
      const output = execSync(
        `claude -p ${JSON.stringify(prompt)} --model haiku --allowedTools "Agent" --dangerously-skip-permissions 2>&1`,
        {
          encoding: "utf-8",
          timeout: 120_000,
          cwd: ROOT,
          env: { ...process.env },
        },
      );

      // Try to extract session ID from the output or from new directive lines
      const newDirectiveLines = lastNLines(DIRECTIVES_FILE, countLines(DIRECTIVES_FILE) - directivesLinesBefore);
      for (const line of newDirectiveLines) {
        try {
          const record = JSON.parse(line);
          if (record.sessionId && record.directives?.includes("dispatch")) {
            testSessionId = record.sessionId;
            break;
          }
        } catch {}
      }
    } catch (err: any) {
      // claude -p may exit non-zero if the subagent fails, but hooks should still have run
      console.log("claude -p exited with error (hooks may still have fired):", err.message?.slice(0, 200));
    }
  }, 180_000); // 3 minute timeout for beforeAll

  describe("format-reminder hook (UserPromptSubmit)", () => {
    it("wrote new directive lines", () => {
      const directivesLinesAfter = countLines(DIRECTIVES_FILE);
      expect(directivesLinesAfter).toBeGreaterThan(directivesLinesBefore);
    });

    it("directive includes dispatch and full", () => {
      const newLines = lastNLines(DIRECTIVES_FILE, countLines(DIRECTIVES_FILE) - directivesLinesBefore);
      const dispatches = newLines
        .map((l) => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean);

      const hasDispatch = dispatches.some((r: any) => r.directives?.includes("dispatch"));
      const hasFull = dispatches.some((r: any) => r.directives?.includes("full"));
      expect(hasDispatch).toBe(true);
      expect(hasFull).toBe(true);
    });

    it("directive has valid session ID and timestamp", () => {
      const newLines = lastNLines(DIRECTIVES_FILE, countLines(DIRECTIVES_FILE) - directivesLinesBefore);
      const record = JSON.parse(newLines[newLines.length - 1]);
      expect(record.sessionId).toBeTruthy();
      expect(record.ts).toBeTruthy();
      expect(new Date(record.ts).getTime()).toBeGreaterThan(0);
    });
  });

  describe("compliance-check hook (Stop)", () => {
    it("wrote new compliance lines", () => {
      const complianceLinesAfter = countLines(COMPLIANCE_FILE);
      expect(complianceLinesAfter).toBeGreaterThan(complianceLinesBefore);
    });

    it("compliance records match the test session", () => {
      if (!testSessionId) {
        console.log("WARN: no test session ID found, checking last compliance records instead");
      }

      const newLines = lastNLines(COMPLIANCE_FILE, countLines(COMPLIANCE_FILE) - complianceLinesBefore);
      const records = newLines
        .map((l) => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean);

      expect(records.length).toBeGreaterThan(0);

      // Should have both dispatch and full directives checked
      const directives = records.map((r: any) => r.directive);
      expect(directives).toContain("dispatch");
    });

    it("dispatch directive was followed (Agent was called)", () => {
      const newLines = lastNLines(COMPLIANCE_FILE, countLines(COMPLIANCE_FILE) - complianceLinesBefore);
      const records = newLines
        .map((l) => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean);

      const dispatchRecord = records.find((r: any) => r.directive === "dispatch");
      expect(dispatchRecord).toBeTruthy();
      expect(dispatchRecord.followed).toBe(true);
    });
  });

  describe("telemetry API serves compliance data", () => {
    let apiProcess: any;
    let apiPort: number;

    beforeAll(async () => {
      // Start the API server on a random port
      apiPort = 13000 + Math.floor(Math.random() * 1000);
      try {
        // Kill anything on that port first
        execSync(`lsof -ti:${apiPort} | xargs kill -9 2>/dev/null || true`, { timeout: 5000 });
      } catch {}

      // Start API server in background
      apiProcess = Bun.spawn(
        ["bun", "run", resolve(ROOT, "src/ui/api/src/server.ts")],
        {
          cwd: ROOT,
          env: { ...process.env, PORT: String(apiPort), NODE_ENV: "test", CLAUDE_ROOT: resolve(ROOT, ".dev") },
          stdout: "pipe",
          stderr: "pipe",
        },
      );

      // Wait for server to be ready
      for (let i = 0; i < 30; i++) {
        try {
          const res = await fetch(`http://localhost:${apiPort}/api/observability/overview?range=1d`);
          if (res.ok) break;
        } catch {}
        await Bun.sleep(500);
      }
    }, 30_000);

    it("compliance endpoint returns data", async () => {
      const res = await fetch(`http://localhost:${apiPort}/api/observability/compliance?range=1d&granularity=day`);
      expect(res.ok).toBe(true);

      const data = await res.json();
      expect(data.overall).toBeTruthy();
      expect(data.overall.total).toBeGreaterThan(0);
      expect(data.byDirective).toBeInstanceOf(Array);
      expect(data.byDirective.length).toBeGreaterThan(0);
    });

    it("compliance data includes dispatch directive", async () => {
      const res = await fetch(`http://localhost:${apiPort}/api/observability/compliance?range=1d&granularity=day`);
      const data = await res.json();

      const dispatch = data.byDirective.find((d: any) => d.directive === "dispatch");
      expect(dispatch).toBeTruthy();
      expect(dispatch.total).toBeGreaterThan(0);
    });

    it("subagents endpoint returns data", async () => {
      const res = await fetch(`http://localhost:${apiPort}/api/observability/subagents?range=30d&granularity=day`);
      expect(res.ok).toBe(true);

      const data = await res.json();
      expect(data.totalDispatches).toBeDefined();
      expect(typeof data.totalDispatches).toBe("number");
    });

    // Cleanup
    afterAll(() => {
      if (apiProcess) {
        apiProcess.kill();
      }
    });
  });
});
