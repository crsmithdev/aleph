#!/usr/bin/env bun
import { readFileSync, writeFileSync, readdirSync, unlinkSync, existsSync } from "fs";
import { resolve } from "path";
import {
  createTestEnv, cleanupTestEnv, runHook, check, checkInfo, runAndCheck,
  createResults, printAndExit, userMsg, assistantMsg, writeTranscript,
} from "../eval/harness.ts";

const te = createTestEnv("memory");
const r = createResults();
const sessionsDir = resolve(te.tmpBase, "sessions");
import { mkdirSync } from "fs";
mkdirSync(sessionsDir, { recursive: true });

const ratingsFile = resolve(te.tmpBase, "ratings.jsonl");
te.env.RATINGS_FILE = ratingsFile;

// ── Session start ────────────────────────────────────────────────────────────

console.log("--- context-restore-start ---");
runAndCheck(te, r, "memory/hooks/context-restore-start.ts", "smoke", "{}", { expectStdout: ["Session Start"] });

// Morning briefing: no new sessions since last interactive → no digest
{
  const briefingMarker = resolve(sessionsDir, ".last-briefing");
  try { unlinkSync(briefingMarker); } catch {}
  const futureSession = resolve(sessionsDir, "9998-01-01-000000.md");
  writeFileSync(futureSession, "# Session: 9998-01-01\n\n- Intent: test\n- Outcome: done\n- Tools: none; files: none\n- Edits: 0 tool calls, 0 files\n- Messages: 4 (2 user, 2 assistant)\n");
  writeFileSync(briefingMarker, "9998-01-01-000000.md");
  const { stdout } = runHook(te, "memory/hooks/context-restore-start.ts", "{}");
  check(r, "morning-briefing: no digest when no new sessions", !stdout.includes("Background Work"));
  check(r, "morning-briefing: still shows session count", stdout.includes("Sessions:"));
  check(r, "morning-briefing: still shows last session header", stdout.includes("Last session ("));
  try { unlinkSync(futureSession); } catch {}
  try { unlinkSync(briefingMarker); } catch {}
}

// Morning briefing: multiple new sessions since last interactive → digest shown
{
  const briefingMarker = resolve(sessionsDir, ".last-briefing");
  try { unlinkSync(briefingMarker); } catch {}

  const oldSession = resolve(sessionsDir, "2000-01-01-000000.md");
  writeFileSync(oldSession, "# Session: 2000-01-01\n\n- Intent: old work\n- Outcome: old done\n- Tools: none; files: none\n- Edits: 0 tool calls, 0 files\n- Messages: 4 (2 user, 2 assistant)\n");

  const bgSession1 = resolve(sessionsDir, "2000-01-02-100000.md");
  writeFileSync(bgSession1, "# Session: 2000-01-02\n\n- Intent: fix auth bug\n- Outcome: auth fixed and tests pass\n- Tools: Read, Edit, Bash; files: src/auth.ts\n- Edits: 3 tool calls, 1 files\n- Messages: 6 (3 user, 3 assistant)\n");

  const bgSession2 = resolve(sessionsDir, "2000-01-02-200000.md");
  writeFileSync(bgSession2, "# Session: 2000-01-02\n\n- Intent: refactor parser\n- Outcome: parser refactored but tests pending\n- Tools: Edit, Bash; files: src/parser.ts\n- Edits: 2 tool calls, 1 files\n- Messages: 8 (4 user, 4 assistant)\n- Notes:\n  - Tests are still failing for edge cases\n");

  writeFileSync(briefingMarker, "2000-01-01-000000.md");

  const { stdout } = runHook(te, "memory/hooks/context-restore-start.ts", "{}");

  check(r, "morning-briefing: shows background work header", stdout.includes("Background Work"));
  check(r, "morning-briefing: shows completed work section", stdout.includes("Completed") || stdout.includes("Done"));
  check(r, "morning-briefing: shows in-progress section", stdout.includes("In Progress") || stdout.includes("pending") || stdout.includes("failing"));
  check(r, "morning-briefing: includes session content (auth)", stdout.includes("auth"));
  check(r, "morning-briefing: includes session content (parser)", stdout.includes("parser"));
  check(r, "morning-briefing: still shows Session Start", stdout.includes("Session Start"));
  check(r, "morning-briefing: still shows session count", stdout.includes("Sessions:"));

  try { unlinkSync(oldSession); } catch {}
  try { unlinkSync(bgSession1); } catch {}
  try { unlinkSync(bgSession2); } catch {}
  try { unlinkSync(briefingMarker); } catch {}
}

// Morning briefing: no marker file + multiple sessions → treat all as new
{
  const briefingMarker = resolve(sessionsDir, ".last-briefing");
  try { unlinkSync(briefingMarker); } catch {}

  const s1 = resolve(sessionsDir, "2000-02-01-000000.md");
  const s2 = resolve(sessionsDir, "2000-02-01-010000.md");
  writeFileSync(s1, "# Session: 2000-02-01\n\n- Intent: first session\n- Outcome: done\n- Tools: none; files: none\n- Edits: 0 tool calls, 0 files\n- Messages: 4 (2 user, 2 assistant)\n");
  writeFileSync(s2, "# Session: 2000-02-01\n\n- Intent: second session background task\n- Outcome: completed background work\n- Tools: Bash; files: none\n- Edits: 0 tool calls, 0 files\n- Messages: 4 (2 user, 2 assistant)\n");

  const { stdout } = runHook(te, "memory/hooks/context-restore-start.ts", "{}");
  check(r, "morning-briefing: no marker + multiple sessions shows briefing", stdout.includes("Background Work"));

  try { unlinkSync(s1); } catch {}
  try { unlinkSync(s2); } catch {}
  try { unlinkSync(briefingMarker); } catch {}
}

// ── Rating capture ───────────────────────────────────────────────────────────

console.log("\n--- rating-capture ---");

function ratingTest(prompt: string): { rating: number | null; output: string } {
  let linesBefore = 0;
  try { linesBefore = readFileSync(ratingsFile, "utf-8").trim().split("\n").filter(Boolean).length; } catch {}
  const { stdout } = runHook(te, "memory/hooks/rating-capture-submit.ts", JSON.stringify({ prompt }));
  let linesAfter = 0;
  try { linesAfter = readFileSync(ratingsFile, "utf-8").trim().split("\n").filter(Boolean).length; } catch {}
  if (linesAfter > linesBefore) {
    const last = readFileSync(ratingsFile, "utf-8").trim().split("\n").pop()!;
    return { rating: JSON.parse(last).rating, output: stdout };
  }
  return { rating: null, output: stdout };
}

check(r, "rating: standalone 7", ratingTest("7").rating === 7);
check(r, "rating: standalone 8", ratingTest("8").rating === 8);
check(r, "rating: standalone 10", ratingTest("10").rating === 10);
check(r, "rating: 7/10 pattern", ratingTest("7/10").rating === 7);
check(r, "rating: 'I rate this 9'", ratingTest("I rate this 9").rating === 9);

check(r, "rating: ignores 'hello'", ratingTest("hello world").rating === null);
check(r, "rating: ignores '42'", ratingTest("42").rating === null);
check(r, "rating: ignores 'there are 3 files'", ratingTest("there are 3 files to edit").rating === null);
check(r, "rating: 'deploy to 3 servers' → no match", ratingTest("deploy to 3 servers").rating === null);
check(r, "rating: '8 files changed' → no match", ratingTest("8 files changed in the PR").rating === null);
check(r, "rating: 'rate this' alone → no match", ratingTest("rate this").rating === null);

const lowResult = ratingTest("2");
check(r, "rating: low rating warns", lowResult.rating === 2 && lowResult.output.includes("Low rating"));

runAndCheck(te, r, "memory/hooks/rating-capture-submit.ts", "malformed", "not json");

// ── Session summary ──────────────────────────────────────────────────────────

console.log("\n--- session-summary ---");
{
  const tinyTranscript = writeTranscript(te, "tiny", [userMsg("hi"), assistantMsg("hello")]);
  runAndCheck(te, r, "memory/hooks/context-save-stop.ts", "too few", JSON.stringify({ transcript_path: tinyTranscript }));
  try { unlinkSync(tinyTranscript); } catch {}
}
runAndCheck(te, r, "memory/hooks/context-save-stop.ts", "malformed", "not json");

// ── Memory extraction ───────────────────────────────────────────────────────

console.log("\n--- memory-extract ---");

{
  const extractFile = writeTranscript(te, "extract-sub", [
    userMsg("fix the auth bug"),
    assistantMsg("found it", [{ name: "Read", input: { file_path: "/src/auth.ts" } }]),
    userMsg("ok"),
    assistantMsg("fixing", [{ name: "Edit", input: { file_path: "/src/auth.ts" } }]),
    userMsg("test it"),
    assistantMsg("running", [{ name: "Bash", input: { command: "bun test" } }]),
    userMsg("good"),
    assistantMsg("done"),
  ]);
  runAndCheck(te, r, "memory/hooks/memory-extract-stop.ts", "extracts from substantive session",
    JSON.stringify({ transcript_path: extractFile }));
  try { unlinkSync(extractFile); } catch {}
}

{
  const extractStoreFile = writeTranscript(te, "extract-store", [
    userMsg("fix the auth bug"),
    assistantMsg("found it", [{ name: "Edit", input: { file_path: "/src/auth.ts" } }]),
    userMsg("ok"),
    assistantMsg("storing", [{ name: "mcp__memory__memory_store", input: { content: "fixed auth" } }]),
    userMsg("test it"),
    assistantMsg("running", [{ name: "Bash", input: { command: "bun test" } }]),
    userMsg("good"),
    assistantMsg("done"),
  ]);
  runAndCheck(te, r, "memory/hooks/memory-extract-stop.ts", "skips when memory_store present",
    JSON.stringify({ transcript_path: extractStoreFile }));
  try { unlinkSync(extractStoreFile); } catch {}
}

{
  const extractSmall = writeTranscript(te, "extract-small", [userMsg("hi"), assistantMsg("hello")]);
  runAndCheck(te, r, "memory/hooks/memory-extract-stop.ts", "skips non-substantive",
    JSON.stringify({ transcript_path: extractSmall }));
  try { unlinkSync(extractSmall); } catch {}
}

runAndCheck(te, r, "memory/hooks/memory-extract-stop.ts", "malformed stdin", "not json");

// Heuristic tests via direct import
{
  const { parseTranscript } = await import("../memory/parse-transcript.ts");
  const { extractMemories, hasMemoryStore, CORRECTION_RE } = await import("../memory/extract.ts");

  check(r, "extract: detects 'no' correction", CORRECTION_RE.test("no, do it this way"));
  check(r, "extract: detects 'don't' correction", CORRECTION_RE.test("don't use that approach"));
  check(r, "extract: detects 'actually' correction", CORRECTION_RE.test("actually, use the other one"));
  check(r, "extract: ignores normal text", !CORRECTION_RE.test("looks good, thanks"));
  check(r, "extract: ignores 'notice'", !CORRECTION_RE.test("notice how it works"));

  const correctionFile = writeTranscript(te, "extract-correction", [
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
  check(r, "extract: finds correction in transcript", corrMemories.some(m => m.tags.includes("preference")));
  check(r, "extract: includes session summary", corrMemories.some(m => m.tags.includes("session_context")));
  check(r, "extract: correction content has user text", corrMemories.some(m => m.content.includes("don't mock")));
  try { unlinkSync(correctionFile); } catch {}

  const storeFile2 = writeTranscript(te, "extract-store2", [
    userMsg("fix it"),
    assistantMsg("storing", [{ name: "mcp__memory__memory_store", input: { content: "done" } }]),
    userMsg("ok"),
    assistantMsg("done", [{ name: "Bash", input: { command: "test" } }]),
  ]);
  const storeT = parseTranscript(storeFile2);
  check(r, "extract: detects memory_store in transcript", hasMemoryStore(storeT!));
  try { unlinkSync(storeFile2); } catch {}
}

// ── Session recall ───────────────────────────────────────────────────────────

console.log("\n--- session recall ---");

{
  const recallTranscript = writeTranscript(te, "recall", [
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

  const beforeSessions = new Set(readdirSync(sessionsDir));
  runHook(te, "memory/hooks/context-save-stop.ts", JSON.stringify({ transcript_path: recallTranscript }));
  const newSessions = readdirSync(sessionsDir).filter(f => !beforeSessions.has(f));

  if (newSessions.length === 0) {
    check(r, "context-save-stop did not create a file", false);
  } else {
    const summary = readFileSync(resolve(sessionsDir, newSessions[0]), "utf-8");

    check(r, "recall: knows initial task (webhook 500)", summary.includes("webhook") || summary.includes("500"));
    check(r, "recall: knows about retry refactor", summary.includes("retry") || summary.includes("backoff"));
    check(r, "recall: knows about idempotency fix", summary.includes("idempotency") || summary.includes("race"));
    check(r, "recall: knows webhook root cause (express.json)", summary.includes("express.json") || summary.includes("raw body"));
    check(r, "recall: knows retry approach (exponential backoff)", summary.includes("exponential") || summary.includes("backoff") || summary.includes("jitter"));
    check(r, "recall: knows idempotency problem (race condition)", summary.includes("race") || summary.includes("atomic") || summary.includes("concurrent"));
    check(r, "recall: knows webhook fix is done", summary.includes("confirmed") || summary.includes("gone") || summary.includes("500s are gone"));
    check(r, "recall: knows idempotency fix is incomplete", summary.includes("failing") || summary.includes("need to update") || summary.includes("pick that up") || summary.includes("2 test"));
    check(r, "recall: knows which tests are broken", summary.includes("idempotency.test") || summary.includes("duplicate insert") || summary.includes("test fixtures"));
    checkInfo(r, "recall: knows constraint name (uq_idempotency_key)", summary.includes("uq_idempotency_key"));

    const seedFile = resolve(sessionsDir, "9999-99-99-999999.md");
    writeFileSync(seedFile, summary);
    const { stdout: startOut } = runHook(te, "memory/hooks/context-restore-start.ts", "{}");
    check(r, "recall: start shows what was worked on", startOut.includes("webhook") || startOut.includes("payments") || startOut.includes("500"));
    check(r, "recall: start shows work is unfinished", startOut.includes("failing") || startOut.includes("pick that up") || startOut.includes("next time") || startOut.includes("2 test"));
    try { unlinkSync(seedFile); } catch {}
    try { unlinkSync(resolve(sessionsDir, newSessions[0])); } catch {}
  }
  try { unlinkSync(recallTranscript); } catch {}
}

cleanupTestEnv(te);
printAndExit(r);
