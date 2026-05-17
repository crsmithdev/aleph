#!/usr/bin/env bun
/**
 * Full behavioral tests for rating-capture-submit.ts hook.
 *
 * Tests both rating mechanisms end-to-end without polluting real data:
 *   1. N/10 slash notation ("7/10", "10/10")
 *   2. Rate-keyword prompts ("rate 7", "rating 8", "I rate this 9")
 *
 * Uses CONSTRUCT_DATA_ROOT isolation via createTestEnv so all writes go
 * to a temp directory, not ~/.construct/signals/events.jsonl.
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import {
  createTestEnv,
  cleanupTestEnv,
  runHook,
  check,
  createResults,
  printAndExit,
  writeTranscript,
  userMsg,
  assistantMsg,
} from "../eval/harness.ts";

const te = createTestEnv("rating-capture");
const r = createResults();

const HOOK = "memory/hooks/rating-capture-submit.ts";

function eventsFile(): string {
  return join(te.tmpBase, "signals", "events.jsonl");
}

function readRatings(): Array<Record<string, unknown>> {
  const path = eventsFile();
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter((e): e is Record<string, unknown> => e !== null)
    .filter((e) => e.hook === "rating-capture-submit" && typeof e.rating === "number");
}

function lastRating(): Record<string, unknown> | undefined {
  const ratings = readRatings();
  return ratings.length > 0 ? ratings[ratings.length - 1] : undefined;
}

function countRatings(): number {
  return readRatings().length;
}

// ── File isolation ─────────────────────────────────────────────────────────────

console.log("--- isolation ---");

// Run with no match — verify no file pollution occurs in real ~/.construct
const noMatchResult = runHook(te, HOOK, JSON.stringify({ prompt: "update the readme" }));
check(r, "no-match: exits 0", noMatchResult.exitCode === 0);
check(r, "no-match: no stdout emitted", noMatchResult.stdout.trim() === "");
check(r, "no-match: real events.jsonl not touched",
  !existsSync(join(process.env.HOME ?? "", ".construct", "signals", "events.jsonl"))
  || (() => {
    const real = readFileSync(
      join(process.env.HOME ?? "", ".construct", "signals", "events.jsonl"), "utf-8"
    );
    return !real.includes("rating-capture-test-sentinel");
  })()
);

// ── Mechanism 1: N/10 slash notation ──────────────────────────────────────────

console.log("\n--- mechanism 1: N/10 notation ---");

{
  const result = runHook(te, HOOK, JSON.stringify({
    session_id: "test-slash-01",
    prompt: "7/10",
  }));
  check(r, "7/10: exits 0", result.exitCode === 0);
  check(r, "7/10: no stdout (not low rating)", result.stdout.trim() === "");
  const entry = lastRating();
  check(r, "7/10: rating written to isolated file", entry !== undefined);
  check(r, "7/10: rating value is 7", entry?.rating === 7);
  check(r, "7/10: ratingType is explicit", entry?.ratingType === "explicit");
  check(r, "7/10: sessionId captured", entry?.sessionId === "test-slash-01");
  check(r, "7/10: has ts", typeof entry?.ts === "string");
}

{
  const result = runHook(te, HOOK, JSON.stringify({
    session_id: "test-slash-02",
    prompt: "10/10",
  }));
  check(r, "10/10: exits 0", result.exitCode === 0);
  const entry = lastRating();
  check(r, "10/10: rating value is 10", entry?.rating === 10);
}

{
  const result = runHook(te, HOOK, JSON.stringify({
    session_id: "test-slash-03",
    prompt: "1/10",
  }));
  check(r, "1/10: exits 0", result.exitCode === 0);
  const entry = lastRating();
  check(r, "1/10: rating value is 1", entry?.rating === 1);
}

{
  const result = runHook(te, HOOK, JSON.stringify({
    session_id: "test-slash-04",
    prompt: "  8 / 10  ",
  }));
  check(r, "8 / 10 (with spaces): captured", result.exitCode === 0 && lastRating()?.rating === 8);
}

// ── Mechanism 1 non-matches ────────────────────────────────────────────────────

console.log("\n--- mechanism 1: non-matches ---");

{
  const beforeCount = countRatings();
  runHook(te, HOOK, JSON.stringify({ prompt: "11/10" }));
  check(r, "11/10: not captured (out of range)", countRatings() === beforeCount);
}

{
  const beforeCount = countRatings();
  runHook(te, HOOK, JSON.stringify({ prompt: "0/10" }));
  check(r, "0/10: not captured (out of range)", countRatings() === beforeCount);
}

{
  const beforeCount = countRatings();
  runHook(te, HOOK, JSON.stringify({ prompt: "the PR was 8/10 quality" }));
  check(r, "mid-sentence N/10: not captured", countRatings() === beforeCount);
}

// ── Mechanism 2: rate-keyword ──────────────────────────────────────────────────

console.log("\n--- mechanism 2: rate-keyword ---");

{
  const result = runHook(te, HOOK, JSON.stringify({ session_id: "test-kw-01", prompt: "rate 7" }));
  check(r, "'rate 7': captured", result.exitCode === 0 && lastRating()?.rating === 7);
}

{
  const result = runHook(te, HOOK, JSON.stringify({ session_id: "test-kw-02", prompt: "rating 8" }));
  check(r, "'rating 8': captured", result.exitCode === 0 && lastRating()?.rating === 8);
}

{
  const result = runHook(te, HOOK, JSON.stringify({ session_id: "test-kw-03", prompt: "rating: 9" }));
  check(r, "'rating: 9' (with colon): captured", result.exitCode === 0 && lastRating()?.rating === 9);
}

{
  const result = runHook(te, HOOK, JSON.stringify({ session_id: "test-kw-04", prompt: "I rate this 6" }));
  check(r, "'I rate this 6': captured", result.exitCode === 0 && lastRating()?.rating === 6);
}

{
  const result = runHook(te, HOOK, JSON.stringify({ session_id: "test-kw-05", prompt: "I rate it 5" }));
  check(r, "'I rate it 5': captured", result.exitCode === 0 && lastRating()?.rating === 5);
}

{
  const result = runHook(te, HOOK, JSON.stringify({ session_id: "test-kw-06", prompt: "rated 10" }));
  check(r, "'rated 10': captured", result.exitCode === 0 && lastRating()?.rating === 10);
}

{
  const result = runHook(te, HOOK, JSON.stringify({ session_id: "test-kw-07", prompt: "I rated it 4" }));
  check(r, "'I rated it 4': captured", result.exitCode === 0 && lastRating()?.rating === 4);
}

// ── Rate-keyword non-matches ───────────────────────────────────────────────────

console.log("\n--- mechanism 2: non-matches ---");

{
  const beforeCount = countRatings();
  runHook(te, HOOK, JSON.stringify({ prompt: "the rate limit hit 7 times" }));
  check(r, "'rate limit hit 7': not captured (rate-limit false positive)", countRatings() === beforeCount);
}

{
  const beforeCount = countRatings();
  runHook(te, HOOK, JSON.stringify({ prompt: "I did not intend to rate you 2/5" }));
  check(r, "mid-sentence 'rate you 2/5': not captured", countRatings() === beforeCount);
}

{
  const beforeCount = countRatings();
  runHook(te, HOOK, JSON.stringify({ prompt: "my rating for this approach was high" }));
  check(r, "'rating ... was high': not captured (no digit)", countRatings() === beforeCount);
}

// ── Standalone digit (NOT a rating mechanism — excluded to avoid false positives) ──

console.log("\n--- standalone digit: excluded ---");

{
  const beforeCount = countRatings();
  runHook(te, HOOK, JSON.stringify({ prompt: "7" }));
  check(r, "standalone '7': NOT captured (excluded mechanism)", countRatings() === beforeCount);
}

{
  const beforeCount = countRatings();
  runHook(te, HOOK, JSON.stringify({ prompt: "2" }));
  check(r, "standalone '2': NOT captured", countRatings() === beforeCount);
}

// ── Low rating behavior ────────────────────────────────────────────────────────

console.log("\n--- low rating behavior ---");

{
  const result = runHook(te, HOOK, JSON.stringify({ session_id: "test-low-01", prompt: "3/10" }));
  check(r, "3/10: captured as rating 3", lastRating()?.rating === 3);
  check(r, "3/10: emits low-rating reminder to stdout", result.stdout.includes("Low rating"));
  check(r, "3/10: reminder includes the rating number", result.stdout.includes("3"));
}

{
  const result = runHook(te, HOOK, JSON.stringify({ session_id: "test-low-02", prompt: "1/10" }));
  check(r, "1/10: emits low-rating reminder", result.stdout.includes("Low rating"));
}

{
  const result = runHook(te, HOOK, JSON.stringify({ session_id: "test-low-03", prompt: "rate 2" }));
  check(r, "'rate 2': emits low-rating reminder", result.stdout.includes("Low rating"));
}

{
  const result = runHook(te, HOOK, JSON.stringify({ session_id: "test-hi-01", prompt: "4/10" }));
  check(r, "4/10: does NOT emit low-rating reminder (threshold is ≤3)", !result.stdout.includes("Low rating"));
}

// ── System event skip ─────────────────────────────────────────────────────────

console.log("\n--- system event skip ---");

{
  const beforeCount = countRatings();
  runHook(te, HOOK, JSON.stringify({ prompt: "<task-notification>rate 7 things done</task-notification>" }));
  check(r, "task-notification: not captured", countRatings() === beforeCount);
}

{
  const beforeCount = countRatings();
  runHook(te, HOOK, JSON.stringify({ prompt: "<system-reminder>rated 9/10 by the evaluator</system-reminder>" }));
  check(r, "system-reminder: not captured", countRatings() === beforeCount);
}

// ── With transcript context ────────────────────────────────────────────────────

console.log("\n--- with transcript context ---");

{
  const transcriptPath = writeTranscript(te, "rating-ctx", [
    userMsg("refactor the login module"),
    assistantMsg("I'll refactor it now.", [{ name: "Edit", input: { file_path: "/src/auth/login.ts" } }]),
    userMsg("9/10"),
  ]);
  const result = runHook(te, HOOK, JSON.stringify({
    session_id: "test-ctx-01",
    prompt: "9/10",
    transcript_path: transcriptPath,
  }));
  check(r, "with transcript: exits 0", result.exitCode === 0);
  const entry = lastRating();
  check(r, "with transcript: rating captured", entry?.rating === 9);
  check(r, "with transcript: priorTools populated", Array.isArray(entry?.priorTools));
  check(r, "with transcript: priorFiles populated", Array.isArray(entry?.priorFiles));
  check(r, "with transcript: turnIndex is a number", typeof entry?.turnIndex === "number");
}

// ── Stdin safety ───────────────────────────────────────────────────────────────

console.log("\n--- stdin safety ---");

{
  const result = runHook(te, HOOK, "not valid json at all {{{");
  check(r, "malformed stdin: exits 0 (advisory hook)", result.exitCode === 0);
}

{
  const result = runHook(te, HOOK, "{}");
  check(r, "empty prompt: exits 0", result.exitCode === 0);
}

// ── Final data audit ───────────────────────────────────────────────────────────

console.log("\n--- data audit ---");

const allRatings = readRatings();
check(r, "all entries have required fields",
  allRatings.every(e =>
    typeof e.ts === "string" &&
    typeof e.rating === "number" &&
    typeof e.ratingType === "string" &&
    typeof e.context === "string"
  )
);
check(r, "all captured ratings are in 1-10 range",
  allRatings.every(e => (e.rating as number) >= 1 && (e.rating as number) <= 10)
);
check(r, "ratingType field is always 'explicit'",
  allRatings.every(e => e.ratingType === "explicit")
);
check(r, "events file in isolated temp dir, not ~/.construct",
  eventsFile().startsWith("/tmp/") || eventsFile().includes("construct-rating-capture-")
);

cleanupTestEnv(te);
printAndExit(r);
