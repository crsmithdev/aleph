#!/usr/bin/env bun
import { execSync } from "child_process";
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, unlinkSync } from "fs";
import { resolve } from "path";
import { tmpdir } from "os";

const ROOT = import.meta.dir;
const BUN = process.argv[0];
const hook = (path: string) => resolve(ROOT, "construct", path);
const ratingsFile = resolve(ROOT, "construct/memory/signals/ratings.jsonl");
const sessionsDir = resolve(ROOT, "construct/memory/sessions");
mkdirSync(resolve(ROOT, "construct/memory/signals"), { recursive: true });
mkdirSync(sessionsDir, { recursive: true });

let passed = 0;
let failed = 0;
const infoResults: { name: string; pass: boolean }[] = [];

// Run a hook, return stdout. Throws on unexpected exit code.
function runHook(hookPath: string, stdin: string): string {
  try {
    return execSync(
      `echo '${stdin.replace(/'/g, "'\\''")}' | ${BUN} ${hook(hookPath)} 2>/dev/null`,
      { encoding: "utf-8", timeout: 15000, env: { ...process.env, CONSTRUCT_TRACE: "0" }, cwd: ROOT },
    );
  } catch (err: any) {
    return err.stdout ?? "";
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
    failed++;
  }
}

// Run a hook and assert exit code + stdout substrings
function run(hookPath: string, name: string, stdin: string, opts: { expectExit?: number; expectStdout?: string[] } = {}) {
  const expectExit = opts.expectExit ?? 0;
  const label = `${hookPath.split("/").pop()!.replace(".ts", "")}: ${name}`;
  try {
    const stdout = execSync(
      `echo '${stdin.replace(/'/g, "'\\''")}' | ${BUN} ${hook(hookPath)} 2>/dev/null`,
      { encoding: "utf-8", timeout: 15000, env: { ...process.env, CONSTRUCT_TRACE: "0" }, cwd: ROOT },
    );
    if (expectExit !== 0) {
      console.log(`\u2717 ${label} \u2014 expected exit ${expectExit}, got 0`);
      failed++;
      return;
    }
    if (opts.expectStdout) {
      for (const sub of opts.expectStdout) {
        if (!stdout.includes(sub)) {
          console.log(`\u2717 ${label} \u2014 stdout missing "${sub}"`);
          failed++;
          return;
        }
      }
    }
    console.log(`\u2713 ${label}`);
    passed++;
  } catch (err: any) {
    const exitCode = err.status ?? 1;
    if (expectExit !== 0 && exitCode !== 0) {
      console.log(`\u2713 ${label}`);
      passed++;
    } else {
      console.log(`\u2717 ${label} \u2014 exited ${exitCode}`);
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

// ── Memory gate ──────────────────────────────────────────────────────────────

console.log("\n--- memory-gate ---");
const gateLock = resolve(ROOT, "construct/memory/.memory-gate.lock");

// Substantive session without memory_store → should block
const gateBlockFile = writeTempJsonl("gate-block", [
  userMsg("fix the bug"),
  assistantMsg("found it", [{ name: "Read", input: { file_path: "/src/a.ts" } }]),
  userMsg("ok"),
  assistantMsg("fixing", [{ name: "Edit", input: { file_path: "/src/a.ts" } }]),
  userMsg("test it"),
  assistantMsg("running", [{ name: "Bash", input: { command: "bun test" } }]),
  userMsg("good"),
  assistantMsg("done"),
]);
try { unlinkSync(gateLock); } catch {}
run("memory/hooks/memory-gate.ts", "blocks substantive session",
  JSON.stringify({ transcript_path: gateBlockFile }), { expectStdout: ['"decision":"block"'] });
try { unlinkSync(gateLock); } catch {}
try { unlinkSync(gateBlockFile); } catch {}

// Session with memory_store → should pass
const gatePassFile = writeTempJsonl("gate-pass", [
  userMsg("fix the bug"),
  assistantMsg("found it", [{ name: "Edit", input: { file_path: "/src/a.ts" } }]),
  userMsg("ok"),
  assistantMsg("storing", [{ name: "mcp__memory__memory_store" }]),
  userMsg("test it"),
  assistantMsg("running", [{ name: "Bash", input: { command: "bun test" } }]),
  userMsg("good"),
  assistantMsg("done"),
]);
run("memory/hooks/memory-gate.ts", "passes with memory_store",
  JSON.stringify({ transcript_path: gatePassFile }));
try { unlinkSync(gatePassFile); } catch {}

// Non-substantive session → should pass
const gateSmallFile = writeTempJsonl("gate-small", [userMsg("hi"), assistantMsg("hello")]);
run("memory/hooks/memory-gate.ts", "passes non-substantive",
  JSON.stringify({ transcript_path: gateSmallFile }));
try { unlinkSync(gateSmallFile); } catch {}

run("memory/hooks/memory-gate.ts", "malformed", "not json", { expectExit: 1 });

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
check("skill: 'spec diff' → docs-review", skillTest("run spec diff on the memory module").skills.includes("docs-review"));

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
check("depth: long non-architectural → FULL (>40 words)", skillTest(longPrompt).depth === "FULL");

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

// ── Quality hook ─────────────────────────────────────────────────────────────

console.log("\n--- quality ---");
run("dev/hooks/quality.ts", "smoke", "{}");
run("dev/hooks/quality.ts", "missing file", '{"tool_input":{"file_path":"/nonexistent/file.ts"}}');
run("dev/hooks/quality.ts", "malformed", "not json", { expectExit: 1 });

// ── Notify hook ──────────────────────────────────────────────────────────────

console.log("\n--- notify ---");
run("dev/hooks/notify.ts", "smoke", "{}");
run("dev/hooks/notify.ts", "complete event", '{"type":"complete"}');
run("dev/hooks/notify.ts", "permission event", '{"type":"permission"}');
run("dev/hooks/notify.ts", "idle event", '{"type":"idle"}');
run("dev/hooks/notify.ts", "malformed", "not json", { expectExit: 1 });

// ── Results ──────────────────────────────────────────────────────────────────

if (infoResults.length) {
  console.log("\n  Informational (not scored):");
  for (const c of infoResults) console.log(`  ${c.pass ? "\u2713" : "\u2717"} ${c.name}`);
}

const pct = Math.round((passed / (passed + failed)) * 100);
console.log(`\n${passed} passed, ${failed} failed (${pct}%)`);

if (pct < 90) {
  console.error(`FAIL: score ${pct}% is below 90% threshold`);
}
process.exit(failed > 0 ? 1 : 0);
