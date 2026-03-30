#!/usr/bin/env bun
/**
 * Quality gate E2E test.
 *
 * Tests the full verification gate lifecycle by running hooks as real
 * subprocesses with shared marker state. Verifies the pipeline:
 *
 *   quality-stop-check-e2e (Stop)
 *     → scans transcript for e2e evidence + artifacts, writes/clears marker
 *   quality-pre-require-e2e (PreToolUse)
 *     → reads marker, blocks Edit/Write if present
 *
 * Each scenario builds a realistic JSONL transcript, runs the stop hook,
 * then runs the pre-tool hook to verify the gate state.
 */

import { execSync } from "child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";

const BUN = process.argv[0];
// __tests__ → hooks → skills → src → repo root
const ROOT = resolve(import.meta.dir, "../../../..");
const hook = (path: string) => join(ROOT, "src", path);

const tmpBase = mkdtempSync(join(tmpdir(), "construct-quality-e2e-"));
const signalsDir = join(tmpBase, "signals");
mkdirSync(signalsDir, { recursive: true });

const env = { ...process.env, CONSTRUCT_DATA_ROOT: tmpBase };

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    const msg = detail ? `${name} — ${detail}` : name;
    console.log(`  ✗ ${msg}`);
    failures.push(msg);
    failed++;
  }
}

function runHook(hookPath: string, stdin: string): { stdout: string; exitCode: number } {
  try {
    const stdout = execSync(
      `echo '${stdin.replace(/'/g, "'\\''")}' | ${BUN} ${hook(hookPath)} 2>/dev/null`,
      { encoding: "utf-8", timeout: 15000, env, cwd: ROOT },
    );
    return { stdout, exitCode: 0 };
  } catch (err: any) {
    return { stdout: err.stdout ?? "", exitCode: err.status ?? 1 };
  }
}

function clearFile(path: string) {
  try { unlinkSync(path); } catch {}
}

// Transcript line builders
function userMsg(text: string): string {
  return JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }] } });
}

function assistantMsg(text: string, toolUses: { name: string; input?: Record<string, any> }[] = []): string {
  const content: any[] = [{ type: "text", text }];
  for (const t of toolUses) {
    content.push({ type: "tool_use", name: t.name, input: t.input ?? {}, id: `toolu_${Math.random().toString(36).slice(2)}` });
  }
  return JSON.stringify({ type: "assistant", message: { role: "assistant", content } });
}

function writeTranscript(name: string, lines: string[]): string {
  const path = join(tmpBase, `transcript-${name}-${Date.now()}.jsonl`);
  writeFileSync(path, lines.join("\n") + "\n");
  return path;
}

const markerPath = join(signalsDir, "require-e2e");

// Run the stop hook with a transcript
function runStopHook(transcriptLines: string[], stopHookActive: any = false): { stdout: string; exitCode: number; markerExists: boolean } {
  const transcriptPath = writeTranscript("stop", transcriptLines);
  const stdin = JSON.stringify({ transcript_path: transcriptPath, stop_hook_active: stopHookActive });
  const result = runHook("skills/hooks/quality-stop-check-e2e.ts", stdin);
  const markerExists = existsSync(markerPath);
  try { unlinkSync(transcriptPath); } catch {}
  return { ...result, markerExists };
}

// Run the pre-tool hook (checks marker)
function runPreToolHook(): { stdout: string; exitCode: number } {
  return runHook("skills/hooks/quality-pre-require-e2e.ts", "{}");
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 1: Stop hook creates marker when edits lack e2e evidence
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n--- Phase 1: Stop hook marker creation ---");

clearFile(markerPath);

// Edits without any e2e → marker created
{
  const { stdout, markerExists } = runStopHook([
    userMsg("fix the bug"),
    assistantMsg("fixing", [{ name: "Edit", input: { file_path: "/src/foo.ts" } }]),
  ]);
  check("edits without e2e: marker created", markerExists);
  check("edits without e2e: warns about verification gate", stdout.includes("Verification gate"));
  check("edits without e2e: shows edited file", stdout.includes("foo.ts"));
  check("edits without e2e: mentions e2e requirement",
    stdout.includes("e2e") || stdout.includes("dev server") || stdout.includes("end-to-end"));
}

// Verify marker content
{
  if (existsSync(markerPath)) {
    const marker = JSON.parse(readFileSync(markerPath, "utf-8"));
    check("marker has files field", typeof marker.files === "string" && marker.files.includes("foo.ts"));
    check("marker has missing field", Array.isArray(marker.missing) && marker.missing.length > 0);
    check("marker has timestamp", typeof marker.ts === "string");
  }
}

// Edits + unit tests only → marker created (unit tests don't count)
{
  clearFile(markerPath);
  const { markerExists } = runStopHook([
    userMsg("fix the bug"),
    assistantMsg("fixing", [{ name: "Edit", input: { file_path: "/src/bar.ts" } }]),
    assistantMsg("testing", [{ name: "Bash", input: { command: "bun test" } }]),
  ]);
  check("edits + unit tests: marker created (not sufficient)", markerExists);
}

// npm test → marker created
{
  clearFile(markerPath);
  const { markerExists } = runStopHook([
    userMsg("fix it"),
    assistantMsg("fixing", [{ name: "Edit", input: { file_path: "/src/baz.ts" } }]),
    assistantMsg("testing", [{ name: "Bash", input: { command: "npm test" } }]),
  ]);
  check("edits + npm test: marker created (not sufficient)", markerExists);
}

// jest → marker created
{
  clearFile(markerPath);
  const { markerExists } = runStopHook([
    userMsg("fix it"),
    assistantMsg("fixing", [{ name: "Edit", input: { file_path: "/src/baz.ts" } }]),
    assistantMsg("testing", [{ name: "Bash", input: { command: "npx jest" } }]),
  ]);
  check("edits + jest: marker created (not sufficient)", markerExists);
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 2: Stop hook clears marker when e2e evidence present
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n--- Phase 2: Stop hook marker clearing ---");

// Edits + playwright + screenshot → no marker
{
  clearFile(markerPath);
  const { markerExists, stdout } = runStopHook([
    userMsg("fix the bug"),
    assistantMsg("fixing", [{ name: "Edit", input: { file_path: "/src/foo.ts" } }]),
    assistantMsg("running e2e", [{ name: "Bash", input: { command: "npx playwright test --screenshot" } }]),
  ]);
  check("edits + playwright + screenshot: no marker", !markerExists);
  check("edits + playwright + screenshot: no warning", !stdout.includes("Verification gate"));
}

// Edits + devserver + chrome screenshot → no marker
{
  clearFile(markerPath);
  const { markerExists } = runStopHook([
    userMsg("fix the bug"),
    assistantMsg("fixing", [{ name: "Edit", input: { file_path: "/src/foo.ts" } }]),
    assistantMsg("starting server", [{ name: "Bash", input: { command: "bun run dev" } }]),
    assistantMsg("checking", [{ name: "mcp__chrome-devtools__take_screenshot" }]),
  ]);
  check("edits + devserver + chrome screenshot: no marker", !markerExists);
}

// Edits + cypress + screenshot → no marker
{
  clearFile(markerPath);
  const { markerExists } = runStopHook([
    userMsg("fix it"),
    assistantMsg("fixing", [{ name: "Edit", input: { file_path: "/src/foo.ts" } }]),
    assistantMsg("e2e", [{ name: "Bash", input: { command: "npx cypress run --screenshot" } }]),
  ]);
  check("edits + cypress + screenshot: no marker", !markerExists);
}

// Edits + vite dev + output capture → no marker
{
  clearFile(markerPath);
  const { markerExists } = runStopHook([
    userMsg("fix it"),
    assistantMsg("fixing", [{ name: "Edit", input: { file_path: "/src/foo.ts" } }]),
    assistantMsg("dev server", [{ name: "Bash", input: { command: "vite dev" } }]),
    assistantMsg("capture", [{ name: "Bash", input: { command: "curl localhost:5173 > output.html" } }]),
  ]);
  check("edits + vite dev + output capture: no marker", !markerExists);
}

// Existing marker gets cleared when e2e evidence appears
{
  writeFileSync(markerPath, JSON.stringify({ files: "old.ts", missing: ["e2e"], ts: "old" }));
  check("pre-existing marker exists", existsSync(markerPath));

  const { markerExists } = runStopHook([
    userMsg("verify"),
    assistantMsg("fixing", [{ name: "Edit", input: { file_path: "/src/foo.ts" } }]),
    assistantMsg("e2e", [{ name: "Bash", input: { command: "npx playwright test --screenshot" } }]),
  ]);
  check("pre-existing marker cleared by e2e evidence", !markerExists);
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 3: Pre-tool hook reads marker and blocks/allows
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n--- Phase 3: Pre-tool hook enforcement ---");

// No marker → allowed
{
  clearFile(markerPath);
  const { exitCode } = runPreToolHook();
  check("no marker: edit allowed", exitCode === 0, `exitCode=${exitCode}`);
}

// Marker present → blocked (exit 2)
{
  writeFileSync(markerPath, JSON.stringify({ files: "component.tsx", missing: ["e2e verification"], ts: new Date().toISOString() }));
  const { stdout, exitCode } = runPreToolHook();
  check("marker present: edit blocked", exitCode === 2, `exitCode=${exitCode}`);
  check("block message mentions files", stdout.includes("component.tsx"));
  check("block message mentions verification", stdout.includes("verify") || stdout.includes("e2e"));
}

// Clear marker → allowed again
{
  clearFile(markerPath);
  const { exitCode } = runPreToolHook();
  check("marker cleared: edit allowed again", exitCode === 0, `exitCode=${exitCode}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 4: No-edit scenarios
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n--- Phase 4: No-edit scenarios ---");

// No edits → no marker, no warning
{
  clearFile(markerPath);
  const { markerExists, stdout } = runStopHook([
    userMsg("explain the code"),
    assistantMsg("here is what it does", [{ name: "Read", input: { file_path: "/src/foo.ts" } }]),
  ]);
  check("read-only session: no marker", !markerExists);
  check("read-only session: no warning", !stdout.includes("Verification gate"));
}

// Pure text conversation → no marker
{
  clearFile(markerPath);
  const { markerExists } = runStopHook([
    userMsg("what is a monad"),
    assistantMsg("a monoid in the category of endofunctors"),
  ]);
  check("pure text conversation: no marker", !markerExists);
}

// No edits clears existing marker
{
  writeFileSync(markerPath, JSON.stringify({ files: "old.ts", missing: ["e2e"], ts: "old" }));
  const { markerExists } = runStopHook([
    userMsg("explain the code"),
    assistantMsg("sure", [{ name: "Read", input: { file_path: "/src/foo.ts" } }]),
  ]);
  check("no-edit turn clears existing marker", !markerExists);
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 5: stop_hook_active bypass
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n--- Phase 5: stop_hook_active bypass ---");

{
  clearFile(markerPath);
  const { markerExists, stdout } = runStopHook([
    userMsg("fix it"),
    assistantMsg("fixing", [{ name: "Edit", input: { file_path: "/src/foo.ts" } }]),
  ], true);
  check("stop_hook_active=true: skips (no marker)", !markerExists);
  check("stop_hook_active=true: no output", !stdout.includes("Verification gate"));
}

// String truthy value
{
  clearFile(markerPath);
  const { markerExists } = runStopHook([
    userMsg("fix it"),
    assistantMsg("fixing", [{ name: "Edit", input: { file_path: "/src/foo.ts" } }]),
  ], "true");
  check("stop_hook_active='true': skips", !markerExists);
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 6: Full lifecycle — edit → block → verify → unblock
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n--- Phase 6: Full lifecycle ---");

{
  clearFile(markerPath);

  // Step 1: Session with edits, no e2e → stop hook creates marker
  const { markerExists: step1Marker } = runStopHook([
    userMsg("add the feature"),
    assistantMsg("adding", [
      { name: "Edit", input: { file_path: "/src/components/Feature.tsx" } },
      { name: "Write", input: { file_path: "/src/components/Feature.test.tsx" } },
    ]),
    assistantMsg("testing", [{ name: "Bash", input: { command: "bun test" } }]),
  ]);
  check("lifecycle step 1: marker created after edits without e2e", step1Marker);

  // Step 2: Pre-tool hook blocks next edit
  const { exitCode: step2Exit, stdout: step2Out } = runPreToolHook();
  check("lifecycle step 2: next edit blocked", step2Exit === 2, `exitCode=${step2Exit}`);
  check("lifecycle step 2: block mentions files", step2Out.includes("Feature"));

  // Step 3: Session runs e2e + artifact → stop hook clears marker
  const { markerExists: step3Marker } = runStopHook([
    userMsg("verify the changes"),
    assistantMsg("verifying", [
      { name: "Edit", input: { file_path: "/src/components/Feature.tsx" } },
    ]),
    assistantMsg("starting server", [{ name: "Bash", input: { command: "bun run dev" } }]),
    assistantMsg("screenshot", [{ name: "mcp__chrome-devtools__take_screenshot" }]),
  ]);
  check("lifecycle step 3: marker cleared after e2e + artifact", !step3Marker);

  // Step 4: Pre-tool hook now allows edits
  const { exitCode: step4Exit } = runPreToolHook();
  check("lifecycle step 4: edit allowed after verification", step4Exit === 0, `exitCode=${step4Exit}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 7: E2E signal detection edge cases
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n--- Phase 7: E2E signal detection ---");

// bun run e2e → counts as e2e
{
  clearFile(markerPath);
  const { markerExists } = runStopHook([
    userMsg("fix it"),
    assistantMsg("fixing", [{ name: "Edit", input: { file_path: "/src/foo.ts" } }]),
    assistantMsg("e2e", [{ name: "Bash", input: { command: "bun run e2e > results.txt" } }]),
  ]);
  check("'bun run e2e' detected as e2e + artifact", !markerExists);
}

// next dev → counts as e2e
{
  clearFile(markerPath);
  const { markerExists } = runStopHook([
    userMsg("fix it"),
    assistantMsg("fixing", [{ name: "Edit", input: { file_path: "/src/foo.ts" } }]),
    assistantMsg("server", [{ name: "Bash", input: { command: "next dev" } }]),
    assistantMsg("capture", [{ name: "Bash", input: { command: "curl localhost:3000 > out.html" } }]),
  ]);
  check("'next dev' + capture detected as e2e + artifact", !markerExists);
}

// chrome devtools click + screenshot → counts as e2e + artifact
{
  clearFile(markerPath);
  const { markerExists } = runStopHook([
    userMsg("fix it"),
    assistantMsg("fixing", [{ name: "Edit", input: { file_path: "/src/foo.ts" } }]),
    assistantMsg("interacting", [{ name: "mcp__chrome-devtools__click", input: { selector: "#btn" } }]),
    assistantMsg("screenshot", [{ name: "mcp__chrome-devtools__take_screenshot" }]),
  ]);
  check("chrome devtools click + screenshot: no marker", !markerExists);
}

// e2e without artifact → marker created
{
  clearFile(markerPath);
  const { markerExists, stdout } = runStopHook([
    userMsg("fix it"),
    assistantMsg("fixing", [{ name: "Edit", input: { file_path: "/src/foo.ts" } }]),
    assistantMsg("e2e", [{ name: "Bash", input: { command: "npx playwright test" } }]),
  ]);
  check("e2e without artifact: marker created", markerExists);
  check("e2e without artifact: mentions artifact requirement", stdout.includes("artifact"));
}

// artifact without e2e → marker created
{
  clearFile(markerPath);
  const { markerExists } = runStopHook([
    userMsg("fix it"),
    assistantMsg("fixing", [{ name: "Edit", input: { file_path: "/src/foo.ts" } }]),
    assistantMsg("saving", [{ name: "Bash", input: { command: "cat output > result.txt" } }]),
  ]);
  check("artifact without e2e: marker created", markerExists);
}

// Write tool detected as edit
{
  clearFile(markerPath);
  const { markerExists } = runStopHook([
    userMsg("create file"),
    assistantMsg("creating", [{ name: "Write", input: { file_path: "/src/new.ts" } }]),
  ]);
  check("Write tool detected as edit → marker created", markerExists);
}

// NotebookEdit detected as edit
{
  clearFile(markerPath);
  const { markerExists } = runStopHook([
    userMsg("update notebook"),
    assistantMsg("updating", [{ name: "NotebookEdit", input: { file_path: "/notebooks/analysis.ipynb" } }]),
  ]);
  check("NotebookEdit detected as edit → marker created", markerExists);
}

// Multiple edited files → deduplicated in marker
{
  clearFile(markerPath);
  runStopHook([
    userMsg("fix everything"),
    assistantMsg("fixing", [
      { name: "Edit", input: { file_path: "/src/foo.ts" } },
      { name: "Edit", input: { file_path: "/src/foo.ts" } },
      { name: "Edit", input: { file_path: "/src/bar.ts" } },
    ]),
  ]);
  if (existsSync(markerPath)) {
    const marker = JSON.parse(readFileSync(markerPath, "utf-8"));
    const fooCount = (marker.files.match(/foo\.ts/g) || []).length;
    check("duplicate files deduplicated in marker", fooCount === 1, `fooCount=${fooCount}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 8: Malformed input handling
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n--- Phase 8: Malformed input ---");

// No transcript_path → graceful exit
{
  clearFile(markerPath);
  const { exitCode } = runHook("skills/hooks/quality-stop-check-e2e.ts",
    JSON.stringify({ stop_hook_active: false }));
  check("no transcript_path: graceful exit", exitCode === 0, `exitCode=${exitCode}`);
}

// Nonexistent transcript → graceful exit
{
  const { exitCode } = runHook("skills/hooks/quality-stop-check-e2e.ts",
    JSON.stringify({ transcript_path: "/nonexistent/transcript.jsonl", stop_hook_active: false }));
  check("nonexistent transcript: graceful exit", exitCode === 0, `exitCode=${exitCode}`);
}

// Malformed JSON in transcript → graceful handling
{
  clearFile(markerPath);
  const transcriptPath = writeTranscript("malformed", [
    "not json",
    "also not json",
    userMsg("fix it"),
    "still broken",
    assistantMsg("fixing", [{ name: "Edit", input: { file_path: "/src/foo.ts" } }]),
  ]);
  const stdin = JSON.stringify({ transcript_path: transcriptPath, stop_hook_active: false });
  const { exitCode } = runHook("skills/hooks/quality-stop-check-e2e.ts", stdin);
  check("malformed JSON lines handled gracefully", exitCode === 0, `exitCode=${exitCode}`);
  check("edit still detected despite malformed lines", existsSync(markerPath));
  try { unlinkSync(transcriptPath); } catch {}
}

// Empty transcript → graceful exit
{
  clearFile(markerPath);
  const transcriptPath = writeTranscript("empty", []);
  const stdin = JSON.stringify({ transcript_path: transcriptPath, stop_hook_active: false });
  const { exitCode } = runHook("skills/hooks/quality-stop-check-e2e.ts", stdin);
  check("empty transcript: graceful exit", exitCode === 0, `exitCode=${exitCode}`);
  check("empty transcript: no marker", !existsSync(markerPath));
  try { unlinkSync(transcriptPath); } catch {}
}

// Pre-tool hook with unreadable marker → still blocks
{
  writeFileSync(markerPath, "not valid json");
  const { exitCode } = runPreToolHook();
  check("unreadable marker: still blocks", exitCode === 2, `exitCode=${exitCode}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 9: Hook script invocations excluded from e2e detection
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n--- Phase 9: Hook invocation exclusion ---");

{
  clearFile(markerPath);
  const { markerExists } = runStopHook([
    userMsg("test the hook"),
    assistantMsg("fixing", [{ name: "Edit", input: { file_path: "/src/foo.ts" } }]),
    assistantMsg("testing hook", [{ name: "Bash", input: { command: "bun src/skills/hooks/quality-stop-check-e2e.ts --screenshot" } }]),
  ]);
  check("hook invocation not counted as e2e", markerExists);
}

// ═══════════════════════════════════════════════════════════════════════════
// Cleanup & results
// ═══════════════════════════════════════════════════════════════════════════

try { rmSync(tmpBase, { recursive: true }); } catch {}

console.log(`\n${"=".repeat(50)}`);
console.log(`${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failed > 0 ? 1 : 0);
