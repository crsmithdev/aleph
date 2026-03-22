#!/usr/bin/env bun
import { execSync } from "child_process";
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, unlinkSync } from "fs";
import { resolve } from "path";
import { tmpdir } from "os";

const ROOT = import.meta.dir;
const BUN = process.argv[0];
const hook = (path: string) => resolve(ROOT, "src", path);
const ratingsFile = resolve(tmpdir(), `construct-test-ratings-${process.pid}.jsonl`);
const sessionsDir = resolve(ROOT, "src/memory/sessions");
mkdirSync(resolve(ROOT, "src/memory/signals"), { recursive: true });
mkdirSync(sessionsDir, { recursive: true });

let passed = 0;
let failed = 0;
const infoResults: { name: string; pass: boolean }[] = [];

// Run a hook, return stdout. Throws on unexpected exit code.
const testEnv = { ...process.env, RATINGS_FILE: ratingsFile };
const traceFile = resolve(ROOT, "src/.trace");
let lastTrace = ""; // captured trace output from most recent hook run

function runHook(hookPath: string, stdin: string): string {
  try {
    const result = execSync(
      `echo '${stdin.replace(/'/g, "'\\''")}' | ${BUN} ${hook(hookPath)} 2>/dev/null`,
      { encoding: "utf-8", timeout: 15000, env: testEnv, cwd: ROOT },
    );
    // Split stdout from trace lines (trace goes to stdout via console.log)
    const lines = result.split("\n");
    const traceLines = lines.filter(l => l.startsWith("[trace:"));
    const outLines = lines.filter(l => !l.startsWith("[trace:"));
    lastTrace = traceLines.join("\n");
    return outLines.join("\n");
  } catch (err: any) {
    const out = err.stdout ?? "";
    const lines = out.split("\n");
    lastTrace = lines.filter((l: string) => l.startsWith("[trace:")).join("\n");
    return lines.filter((l: string) => !l.startsWith("[trace:")).join("\n");
  }
}

// Assert a named boolean condition
function check(name: string, pass: boolean, info = false) {
  if (info) {
    infoResults.push({ name, pass });
    return;
  }
  if (pass) {
    console.log(`\u2713 ${name}`);
    passed++;
  } else {
    console.log(`\u2717 ${name}`);
    if (lastTrace) console.log(`  trace: ${lastTrace.split("\n").join("\n  trace: ")}`);
    failed++;
  }
}

// Run a hook and assert exit code + stdout substrings
function run(hookPath: string, name: string, stdin: string, opts: { expectExit?: number; expectStdout?: string[] } = {}) {
  const expectExit = opts.expectExit ?? 0;
  const label = `${hookPath.split("/").pop()!.replace(".ts", "")}: ${name}`;
  try {
    const raw = execSync(
      `echo '${stdin.replace(/'/g, "'\\''")}' | ${BUN} ${hook(hookPath)} 2>/dev/null`,
      { encoding: "utf-8", timeout: 15000, env: testEnv, cwd: ROOT },
    );
    const lines = raw.split("\n");
    lastTrace = lines.filter(l => l.startsWith("[trace:")).join("\n");
    const stdout = lines.filter(l => !l.startsWith("[trace:")).join("\n");
    if (expectExit !== 0) {
      console.log(`\u2717 ${label} \u2014 expected exit ${expectExit}, got 0`);
      if (lastTrace) console.log(`  trace: ${lastTrace.split("\n").join("\n  trace: ")}`);
      failed++;
      return;
    }
    if (opts.expectStdout) {
      for (const sub of opts.expectStdout) {
        if (!stdout.includes(sub)) {
          console.log(`\u2717 ${label} \u2014 stdout missing "${sub}"`);
          if (lastTrace) console.log(`  trace: ${lastTrace.split("\n").join("\n  trace: ")}`);
          failed++;
          return;
        }
      }
    }
    console.log(`\u2713 ${label}`);
    passed++;
  } catch (err: any) {
    const exitCode = err.status ?? 1;
    const out = err.stdout ?? "";
    lastTrace = out.split("\n").filter((l: string) => l.startsWith("[trace:")).join("\n");
    if (expectExit !== 0 && exitCode !== 0) {
      console.log(`\u2713 ${label}`);
      passed++;
    } else {
      console.log(`\u2717 ${label} \u2014 exited ${exitCode}`);
      if (lastTrace) console.log(`  trace: ${lastTrace.split("\n").join("\n  trace: ")}`);
      failed++;
    }
  }
}

// JSONL transcript helpers
function userMsg(text: string) {
  return JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }] } });
}
function assistantMsg(text: string, toolUses: { name: string; input?: Record<string, any> }[] = []) {
  const content: any[] = [{ type: "text", text }];
  for (const t of toolUses) content.push({ type: "tool_use", name: t.name, input: t.input ?? {}, id: `toolu_${Math.random().toString(36).slice(2)}` });
  return JSON.stringify({ type: "assistant", message: { role: "assistant", content } });
}

function writeTempJsonl(name: string, lines: string[]): string {
  const path = resolve(tmpdir(), `test-${name}-${Date.now()}.jsonl`);
  writeFileSync(path, lines.join("\n") + "\n");
  return path;
}

// ── Session start ────────────────────────────────────────────────────────────

console.log("--- session-start ---");
run("memory/hooks/session-start.ts", "smoke", "{}", { expectStdout: ["Session Start"] });

// Morning briefing: no new sessions since last interactive → no digest
{
  const briefingMarker = resolve(sessionsDir, ".last-briefing");
  try { unlinkSync(briefingMarker); } catch {}
  // Add a session in the far future so it's always newest
  const futureSession = resolve(sessionsDir, "9998-01-01-000000.md");
  writeFileSync(futureSession, "# Session: 9998-01-01\n\n- Intent: test\n- Outcome: done\n- Tools: none; files: none\n- Edits: 0 tool calls, 0 files\n- Messages: 4 (2 user, 2 assistant)\n");
  // Write marker pointing to the newest session (already seen)
  writeFileSync(briefingMarker, "9998-01-01-000000.md");
  const noDigestOut = runHook("memory/hooks/session-start.ts", "{}");
  check("morning-briefing: no digest when no new sessions", !noDigestOut.includes("Background Work"));
  // Preserve existing behavior
  check("morning-briefing: still shows session count", noDigestOut.includes("Sessions:"));
  check("morning-briefing: still shows last session header", noDigestOut.includes("Last session ("));
  try { unlinkSync(futureSession); } catch {}
  try { unlinkSync(briefingMarker); } catch {}
}

// Morning briefing: multiple new sessions since last interactive → digest shown
{
  const briefingMarker = resolve(sessionsDir, ".last-briefing");
  try { unlinkSync(briefingMarker); } catch {}

  // Session that was "last seen"
  const oldSession = resolve(sessionsDir, "2000-01-01-000000.md");
  writeFileSync(oldSession, "# Session: 2000-01-01\n\n- Intent: old work\n- Outcome: old done\n- Tools: none; files: none\n- Edits: 0 tool calls, 0 files\n- Messages: 4 (2 user, 2 assistant)\n");

  // Two new background sessions
  const bgSession1 = resolve(sessionsDir, "2000-01-02-100000.md");
  writeFileSync(bgSession1, "# Session: 2000-01-02\n\n- Intent: fix auth bug\n- Outcome: auth fixed and tests pass\n- Tools: Read, Edit, Bash; files: src/auth.ts\n- Edits: 3 tool calls, 1 files\n- Messages: 6 (3 user, 3 assistant)\n");

  const bgSession2 = resolve(sessionsDir, "2000-01-02-200000.md");
  writeFileSync(bgSession2, "# Session: 2000-01-02\n\n- Intent: refactor parser\n- Outcome: parser refactored but tests pending\n- Tools: Edit, Bash; files: src/parser.ts\n- Edits: 2 tool calls, 1 files\n- Messages: 8 (4 user, 4 assistant)\n- Notes:\n  - Tests are still failing for edge cases\n");

  // Mark old session as last seen
  writeFileSync(briefingMarker, "2000-01-01-000000.md");

  const digestOut = runHook("memory/hooks/session-start.ts", "{}");

  // Completion contract: structured digest with sections
  check("morning-briefing: shows background work header", digestOut.includes("Background Work"));
  check("morning-briefing: shows completed work section", digestOut.includes("Completed") || digestOut.includes("Done"));
  check("morning-briefing: shows in-progress section", digestOut.includes("In Progress") || digestOut.includes("pending") || digestOut.includes("failing"));
  check("morning-briefing: includes session content (auth)", digestOut.includes("auth"));
  check("morning-briefing: includes session content (parser)", digestOut.includes("parser"));
  // Existing behavior preserved
  check("morning-briefing: still shows Session Start", digestOut.includes("Session Start"));
  check("morning-briefing: still shows session count", digestOut.includes("Sessions:"));

  try { unlinkSync(oldSession); } catch {}
  try { unlinkSync(bgSession1); } catch {}
  try { unlinkSync(bgSession2); } catch {}
  try { unlinkSync(briefingMarker); } catch {}
}

// Morning briefing: no marker file + multiple sessions → treat all as new (first run)
{
  const briefingMarker = resolve(sessionsDir, ".last-briefing");
  try { unlinkSync(briefingMarker); } catch {}

  const s1 = resolve(sessionsDir, "2000-02-01-000000.md");
  const s2 = resolve(sessionsDir, "2000-02-01-010000.md");
  writeFileSync(s1, "# Session: 2000-02-01\n\n- Intent: first session\n- Outcome: done\n- Tools: none; files: none\n- Edits: 0 tool calls, 0 files\n- Messages: 4 (2 user, 2 assistant)\n");
  writeFileSync(s2, "# Session: 2000-02-01\n\n- Intent: second session background task\n- Outcome: completed background work\n- Tools: Bash; files: none\n- Edits: 0 tool calls, 0 files\n- Messages: 4 (2 user, 2 assistant)\n");

  const noMarkerOut = runHook("memory/hooks/session-start.ts", "{}");
  // With no marker and 2+ sessions, should show briefing
  check("morning-briefing: no marker + multiple sessions shows briefing", noMarkerOut.includes("Background Work"));

  try { unlinkSync(s1); } catch {}
  try { unlinkSync(s2); } catch {}
  try { unlinkSync(briefingMarker); } catch {}
}

// ── Rating capture ───────────────────────────────────────────────────────────

console.log("\n--- rating-capture ---");

function ratingTest(prompt: string): { rating: number | null; output: string } {
  let linesBefore = 0;
  try { linesBefore = readFileSync(ratingsFile, "utf-8").trim().split("\n").filter(Boolean).length; } catch {}
  const out = runHook("memory/hooks/rating-capture.ts", JSON.stringify({ prompt }));
  let linesAfter = 0;
  try { linesAfter = readFileSync(ratingsFile, "utf-8").trim().split("\n").filter(Boolean).length; } catch {}
  if (linesAfter > linesBefore) {
    const last = readFileSync(ratingsFile, "utf-8").trim().split("\n").pop()!;
    return { rating: JSON.parse(last).rating, output: out };
  }
  return { rating: null, output: out };
}

// Should match
check("rating: standalone 7", ratingTest("7").rating === 7);
check("rating: standalone 8", ratingTest("8").rating === 8);
check("rating: standalone 10", ratingTest("10").rating === 10);
check("rating: 7/10 pattern", ratingTest("7/10").rating === 7);
check("rating: 'I rate this 9'", ratingTest("I rate this 9").rating === 9);

// Should NOT match
check("rating: ignores 'hello'", ratingTest("hello world").rating === null);
check("rating: ignores '42'", ratingTest("42").rating === null);
check("rating: ignores 'there are 3 files'", ratingTest("there are 3 files to edit").rating === null);
check("rating: 'deploy to 3 servers' → no match", ratingTest("deploy to 3 servers").rating === null);
check("rating: '8 files changed' → no match", ratingTest("8 files changed in the PR").rating === null);
check("rating: 'rate this' alone → no match", ratingTest("rate this").rating === null);

// Edge: low rating warns
const lowResult = ratingTest("2");
check("rating: low rating warns", lowResult.rating === 2 && lowResult.output.includes("Low rating"));

// Error handling
run("memory/hooks/rating-capture.ts", "malformed", "not json", { expectExit: 1 });

// ── Session summary ──────────────────────────────────────────────────────────

console.log("\n--- session-summary ---");
const tinyTranscript = writeTempJsonl("tiny", [
  userMsg("hi"),
  assistantMsg("hello"),
]);
run("memory/hooks/session-summary.ts", "too few", JSON.stringify({ transcript_path: tinyTranscript }));
try { unlinkSync(tinyTranscript); } catch {}
run("memory/hooks/session-summary.ts", "malformed", "not json", { expectExit: 1 });

// ── Memory extraction ───────────────────────────────────────────────────────

console.log("\n--- memory-extract ---");

// Substantive session without memory_store → should extract
const extractFile = writeTempJsonl("extract-sub", [
  userMsg("fix the auth bug"),
  assistantMsg("found it", [{ name: "Read", input: { file_path: "/src/auth.ts" } }]),
  userMsg("ok"),
  assistantMsg("fixing", [{ name: "Edit", input: { file_path: "/src/auth.ts" } }]),
  userMsg("test it"),
  assistantMsg("running", [{ name: "Bash", input: { command: "bun test" } }]),
  userMsg("good"),
  assistantMsg("done"),
]);
run("memory/hooks/memory-extract.ts", "extracts from substantive session",
  JSON.stringify({ transcript_path: extractFile }));
try { unlinkSync(extractFile); } catch {}

// Session with memory_store → should skip
const extractStoreFile = writeTempJsonl("extract-store", [
  userMsg("fix the auth bug"),
  assistantMsg("found it", [{ name: "Edit", input: { file_path: "/src/auth.ts" } }]),
  userMsg("ok"),
  assistantMsg("storing", [{ name: "mcp__memory__memory_store", input: { content: "fixed auth" } }]),
  userMsg("test it"),
  assistantMsg("running", [{ name: "Bash", input: { command: "bun test" } }]),
  userMsg("good"),
  assistantMsg("done"),
]);
run("memory/hooks/memory-extract.ts", "skips when memory_store present",
  JSON.stringify({ transcript_path: extractStoreFile }));
try { unlinkSync(extractStoreFile); } catch {}

// Non-substantive → should skip
const extractSmall = writeTempJsonl("extract-small", [userMsg("hi"), assistantMsg("hello")]);
run("memory/hooks/memory-extract.ts", "skips non-substantive",
  JSON.stringify({ transcript_path: extractSmall }));
try { unlinkSync(extractSmall); } catch {}

// Malformed stdin
run("memory/hooks/memory-extract.ts", "malformed stdin", "not json");

// Heuristic tests via direct import
{
  const { parseTranscript } = await import("./src/memory/parse-transcript.ts");
  const { extractMemories, hasMemoryStore, CORRECTION_RE } = await import("./src/memory/extract.ts");

  // Correction detection
  check("extract: detects 'no' correction", CORRECTION_RE.test("no, do it this way"));
  check("extract: detects 'don't' correction", CORRECTION_RE.test("don't use that approach"));
  check("extract: detects 'actually' correction", CORRECTION_RE.test("actually, use the other one"));
  check("extract: ignores normal text", !CORRECTION_RE.test("looks good, thanks"));
  check("extract: ignores 'notice'", !CORRECTION_RE.test("notice how it works"));

  // Full extraction from transcript
  const correctionFile = writeTempJsonl("extract-correction", [
    userMsg("fix the auth bug"),
    assistantMsg("I'll use mocks", [{ name: "Edit", input: { file_path: "/src/auth.ts" } }]),
    userMsg("no, don't mock the database"),
    assistantMsg("ok, using real db", [{ name: "Edit", input: { file_path: "/src/auth.ts" } }]),
    userMsg("test it"),
    assistantMsg("running", [{ name: "Bash", input: { command: "bun test" } }]),
    userMsg("good"),
    assistantMsg("done"),
  ]);
  const corrTranscript = parseTranscript(correctionFile, { textLimit: 1000 });
  const corrMemories = extractMemories(corrTranscript!);
  check("extract: finds correction in transcript", corrMemories.some(m => m.tags.includes("preference")));
  check("extract: includes session summary", corrMemories.some(m => m.tags.includes("session_context")));
  check("extract: correction content has user text", corrMemories.some(m => m.content.includes("don't mock")));
  try { unlinkSync(correctionFile); } catch {}

  // memory_store detection
  const storeTranscript = parseTranscript(extractStoreFile);
  // File was already deleted, so test with a fresh one
  const storeFile2 = writeTempJsonl("extract-store2", [
    userMsg("fix it"),
    assistantMsg("storing", [{ name: "mcp__memory__memory_store", input: { content: "done" } }]),
    userMsg("ok"),
    assistantMsg("done", [{ name: "Bash", input: { command: "test" } }]),
  ]);
  const storeT = parseTranscript(storeFile2);
  check("extract: detects memory_store in transcript", hasMemoryStore(storeT!));
  try { unlinkSync(storeFile2); } catch {}
}

// ── Skill routing ────────────────────────────────────────────────────────────

console.log("\n--- skill routing ---");

function skillTest(prompt: string): { skills: string[]; depth: string } {
  const out = runHook("skills/hooks/format-reminder.ts", JSON.stringify({ prompt }));
  const skills = out.match(/Matched skills: ([^.]+)/)?.[1]?.split(", ") ?? [];
  const depth = out.includes("FULL") ? "FULL" : "QUICK";
  return { skills, depth };
}

// Should match
check("skill: 'debug the crash' → debugging", skillTest("debug the crash in auth module").skills.includes("debugging"));
check("skill: 'investigate redis' → research", skillTest("investigate how redis handles eviction policies").skills.includes("research"));
check("skill: 'verify the deploy' → verification", skillTest("verify that the deployment succeeded").skills.includes("verification"));
check("skill: 'doc sync' → docs-review", skillTest("run doc sync on the memory module").skills.includes("docs-review"));

// Should NOT match
check("skill: 'add dark mode' → no skill", skillTest("add dark mode to the settings page").skills.length === 0);
check("skill: 'fix the typo' → no skill", skillTest("fix the typo on line 42").skills.length === 0);

// Ambiguous: "error" matches debugging
check("skill: 'I see an error' → debugging", skillTest("I see an error when running the tests").skills.includes("debugging"));

// Error handling
run("skills/hooks/format-reminder.ts", "smoke", "{}" );
run("skills/hooks/format-reminder.ts", "short skip", '{"prompt":"do it"}');
run("skills/hooks/format-reminder.ts", "malformed", "not json", { expectExit: 1 });

// ── Depth classification ─────────────────────────────────────────────────────

console.log("\n--- depth classification ---");
check("depth: 'fix typo' → QUICK", skillTest("fix the typo on line 42").depth === "QUICK");
check("depth: 'refactor auth' → FULL", skillTest("refactor the auth module to use passkeys").depth === "FULL");
check("depth: 'migrate database' → FULL", skillTest("migrate the database schema to support multi-tenancy").depth === "FULL");
check("depth: 'read that file' → QUICK", skillTest("read that file for me").depth === "QUICK");
check("depth: 'plan this' → FULL", skillTest("plan this feature out").depth === "FULL");
check("depth: 'the design looks off' → QUICK", skillTest("the design looks off on the login button").depth === "QUICK");

const longPrompt = "update the button color from blue to green in the header component and also change the font size to 14px and make sure the hover state matches the new brand guidelines that were shared in the design doc last week";
check("depth: long non-architectural → FULL (≥40 words)", skillTest(longPrompt).depth === "FULL");

// Expanded keyword coverage
check("depth: 'add authentication' → FULL", skillTest("add authentication to the API routes").depth === "FULL");
check("depth: 'update all API endpoints' → FULL", skillTest("update all API endpoints to use the new schema").depth === "FULL");
check("depth: 'rename all references' → FULL", skillTest("rename all references to the old module name").depth === "FULL");
check("depth: 'end to end tests' → FULL", skillTest("write end to end tests for the checkout flow").depth === "FULL");
check("depth: 'integrate stripe' → FULL", skillTest("integrate stripe payments into the app").depth === "FULL");
check("depth: 'full stack feature' → FULL", skillTest("build a full stack feature for user profiles").depth === "FULL");
// Should still be QUICK
check("depth: 'fix the auth bug' → QUICK", skillTest("fix the auth bug on line 42").depth === "QUICK");
check("depth: 'read the file' → QUICK", skillTest("read the API response handler").depth === "QUICK");

// ── Session recall ───────────────────────────────────────────────────────────

console.log("\n--- session recall ---");

// A realistic multi-phase session transcript
const recallTranscript = writeTempJsonl("recall", [
  userMsg("the payments webhook is returning 500 on Stripe signature verification"),
  assistantMsg("Root cause: express.json() consumes the raw body before Stripe can verify the signature. Fix: use express.raw() for the webhook route.", [
    { name: "Read", input: { file_path: "/src/payments/webhook.ts" } },
    { name: "Edit", input: { file_path: "/src/payments/webhook.ts" } },
    { name: "Edit", input: { file_path: "/src/routes/index.ts" } },
    { name: "Bash", input: { command: "bun test payments" } },
  ]),
  userMsg("confirmed, 500s are gone. while you're in there, the retry logic in webhook.ts is a mess — can you refactor it to use exponential backoff?"),
  assistantMsg("The current retry logic uses a fixed 1s delay with 3 retries. Refactoring to exponential backoff with jitter: base 500ms, max 30s, max 5 retries.", [
    { name: "Read", input: { file_path: "/src/payments/retry.ts" } },
    { name: "Edit", input: { file_path: "/src/payments/retry.ts" } },
    { name: "Edit", input: { file_path: "/src/payments/webhook.ts" } },
    { name: "Edit", input: { file_path: "/src/payments/subscription.ts" } },
    { name: "Bash", input: { command: "bun test payments" } },
  ]),
  userMsg("looks good"),
  assistantMsg("While refactoring I noticed a race condition: two concurrent webhook deliveries with the same event ID can both pass the idempotency check because the SELECT and INSERT aren't atomic. Need a unique constraint (uq_idempotency_key) on the idempotency_key column plus an ON CONFLICT DO NOTHING upsert pattern.", [
    { name: "Read", input: { file_path: "/src/db/schema.ts" } },
    { name: "Edit", input: { file_path: "/src/db/schema.ts" } },
    { name: "Edit", input: { file_path: "/src/db/migrations/004-idempotency-unique.ts" } },
    { name: "Edit", input: { file_path: "/src/payments/idempotency.ts" } },
    { name: "Bash", input: { command: "bun test payments" } },
  ]),
  assistantMsg("Migration and upsert are in but 2 tests are failing — the test fixtures assume duplicate inserts succeed. Need to update test helpers."),
  userMsg("let's pick that up next time, I need to head out. commit what we have"),
  assistantMsg("Committed. The idempotency fix is in but tests need updating — 2 failures in test/payments/idempotency.test.ts around duplicate insert fixtures.", [
    { name: "Bash", input: { command: "git add -A && git commit -m 'fix webhook 500, refactor retries, start idempotency fix'" } },
  ]),
]);

// Run summary hook to generate session file
const beforeSessions = new Set(readdirSync(sessionsDir));
runHook("memory/hooks/session-summary.ts", JSON.stringify({ transcript_path: recallTranscript }));
const newSessions = readdirSync(sessionsDir).filter(f => !beforeSessions.has(f));

if (newSessions.length === 0) {
  console.log("\u2717 session-summary did not create a file");
  failed++;
} else {
  const summary = readFileSync(resolve(sessionsDir, newSessions[0]), "utf-8");

  // Intent: what were we doing?
  check("recall: knows initial task (webhook 500)", summary.includes("webhook") || summary.includes("500"));
  check("recall: knows about retry refactor", summary.includes("retry") || summary.includes("backoff"));
  check("recall: knows about idempotency fix", summary.includes("idempotency") || summary.includes("race"));

  // Understanding: why and how?
  check("recall: knows webhook root cause (express.json)", summary.includes("express.json") || summary.includes("raw body"));
  check("recall: knows retry approach (exponential backoff)", summary.includes("exponential") || summary.includes("backoff") || summary.includes("jitter"));
  check("recall: knows idempotency problem (race condition)", summary.includes("race") || summary.includes("atomic") || summary.includes("concurrent"));

  // State: what's done, what's not?
  check("recall: knows webhook fix is done", summary.includes("confirmed") || summary.includes("gone") || summary.includes("500s are gone"));
  check("recall: knows idempotency fix is incomplete", summary.includes("failing") || summary.includes("need to update") || summary.includes("pick that up") || summary.includes("2 test"));
  check("recall: knows which tests are broken", summary.includes("idempotency.test") || summary.includes("duplicate insert") || summary.includes("test fixtures"));

  // Fine detail past truncation boundary — informational only
  check("recall: knows constraint name (uq_idempotency_key)", summary.includes("uq_idempotency_key"), true);

  // Continuity: can the next agent pick up?
  const seedFile = resolve(sessionsDir, "9999-99-99-999999.md");
  writeFileSync(seedFile, summary);
  const startOut = runHook("memory/hooks/session-start.ts", "{}");
  check("recall: start shows what was worked on", startOut.includes("webhook") || startOut.includes("payments") || startOut.includes("500"));
  check("recall: start shows work is unfinished", startOut.includes("failing") || startOut.includes("pick that up") || startOut.includes("next time") || startOut.includes("2 test"));
  try { unlinkSync(seedFile); } catch {}
  // Clean up generated session file
  try { unlinkSync(resolve(sessionsDir, newSessions[0])); } catch {}
}
try { unlinkSync(recallTranscript); } catch {}

// ── Skill extensions ────────────────────────────────────────────────────────

console.log("\n--- skill extensions ---");

// format-reminder should include project extension content when .claude/skills/<skill>.md exists
// The test runs from the repo root which has .claude/skills/code-review.md
function extensionTest(prompt: string): string {
  return runHook("skills/hooks/format-reminder.ts", JSON.stringify({ prompt }));
}

const crOut = extensionTest("run a code review on the hooks");
check("extension: code-review includes base match", crOut.includes("Matched skills: code-review"));
check("extension: code-review injects project content", crOut.includes("Project skill extensions") && crOut.includes("Hook integrity"));

const dbgOut = extensionTest("debug the crash in the auth module");
check("extension: debugging includes base match", dbgOut.includes("Matched skills: debugging"));
check("extension: debugging injects project content", dbgOut.includes("construct trace"));

// Skills without an extension file should NOT have extension content
const resOut = extensionTest("investigate how redis handles eviction policies");
check("extension: research has no project extension", !resOut.includes("Project skill extensions"));

// ── Trace ───────────────────────────────────────────────────────────────────

console.log("\n--- trace ---");

// Enable tracing, run a hook, verify trace output appears
writeFileSync(traceFile, "");
const traceOut = runHook("memory/hooks/session-start.ts", "{}");
check("trace: produces [trace:] output when enabled", lastTrace.includes("[trace:session-start]"));
check("trace: includes hook name in output", lastTrace.includes("session-start"));
// Trace and normal output are both present
check("trace: normal output still works", traceOut.includes("Session Start"));

// Disable tracing, verify no trace output
try { unlinkSync(traceFile); } catch {}
runHook("memory/hooks/session-start.ts", "{}");
check("trace: no output when disabled", !lastTrace.includes("[trace:"));

// Verify multiple hooks produce trace
writeFileSync(traceFile, "");
runHook("skills/hooks/format-reminder.ts", JSON.stringify({ prompt: "debug the crash in auth module" }));
check("trace: format-reminder traces decisions", lastTrace.includes("[trace:format-reminder]"));
runHook("memory/hooks/rating-capture.ts", JSON.stringify({ prompt: "7" }));
check("trace: rating-capture traces matches", lastTrace.includes("[trace:rating-capture]"));
try { unlinkSync(traceFile); } catch {}

// ── Quality hook ─────────────────────────────────────────────────────────────

console.log("\n--- quality ---");
run("skills/hooks/quality.ts", "smoke", "{}");
run("skills/hooks/quality.ts", "missing file", '{"tool_input":{"file_path":"/nonexistent/file.ts"}}');
run("skills/hooks/quality.ts", "malformed", "not json", { expectExit: 1 });

// ── Notify hook ──────────────────────────────────────────────────────────────

console.log("\n--- notify ---");
run("skills/hooks/notify.ts", "smoke", "{}");
run("skills/hooks/notify.ts", "complete event", '{"type":"complete"}');
run("skills/hooks/notify.ts", "permission event", '{"type":"permission"}');
run("skills/hooks/notify.ts", "idle event", '{"type":"idle"}');
run("skills/hooks/notify.ts", "malformed", "not json", { expectExit: 1 });

// ── Install preservation ─────────────────────────────────────────────────────

console.log("\n--- install preservation ---");

const sentinelPath = resolve(Bun.env.HOME!, ".claude/construct/core/identity/TEST_SENTINEL.md");
const sentinelContent = "# Test Sentinel\n\nThis file tests upgrade preservation.\n";
writeFileSync(sentinelPath, sentinelContent);
check("install: sentinel file created", existsSync(sentinelPath));

try {
  execSync(`${BUN} ${resolve(ROOT, "install.ts")}`, { encoding: "utf-8", timeout: 30000, cwd: ROOT, stdio: "pipe" });
  check("install: sentinel survived upgrade", existsSync(sentinelPath));
  check("install: sentinel content preserved", readFileSync(sentinelPath, "utf-8") === sentinelContent);
} catch (err: any) {
  console.log(`\u2717 install: installer failed — ${err.message?.slice(0, 100)}`);
  failed++;
}
try { unlinkSync(sentinelPath); } catch {}

// ── Identity files ──────────────────────────────────────────────────────────

console.log("\n--- identity files ---");

const identityDir = resolve(ROOT, "src/core/identity");
const expectedIdentity = ["IDENTITY.md", "SOUL.md", "STYLE.md", "USER.md"];
for (const f of expectedIdentity) {
  const p = resolve(identityDir, f);
  check(`identity: ${f} exists`, existsSync(p));
  if (existsSync(p)) {
    const content = readFileSync(p, "utf-8");
    check(`identity: ${f} non-empty`, content.length > 10);
  }
}

// Verify identity files exist at installed path and are non-empty
// Note: installed files may differ from source (user customizations are preserved)
const installedIdentityDir = resolve(Bun.env.HOME!, ".claude/construct/core/identity");
if (existsSync(installedIdentityDir)) {
  for (const f of expectedIdentity) {
    const dst = resolve(installedIdentityDir, f);
    if (existsSync(dst)) {
      check(`identity: installed ${f} exists and non-empty`, readFileSync(dst, "utf-8").length > 10);
    }
  }
}

// ── Results ──────────────────────────────────────────────────────────────────

if (infoResults.length) {
  console.log("\n  Informational (not scored):");
  for (const c of infoResults) console.log(`  ${c.pass ? "\u2713" : "\u2717"} ${c.name}`);
}

// Clean up temp ratings file
try { unlinkSync(ratingsFile); } catch {}

const pct = Math.round((passed / (passed + failed)) * 100);
console.log(`\n${passed} passed, ${failed} failed (${pct}%)`);

if (pct < 90) {
  console.error(`FAIL: score ${pct}% is below 90% threshold`);
}
process.exit(failed > 0 ? 1 : 0);
