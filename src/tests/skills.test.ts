#!/usr/bin/env bun
import {
  createTestEnv, cleanupTestEnv, runHook, check, runAndCheck,
  createResults, printAndExit,
} from "../eval/harness.ts";

const te = createTestEnv("skills");
const r = createResults();

// ── Skill routing ────────────────────────────────────────────────────────────

console.log("--- skill routing ---");

function skillTest(prompt: string): { skills: string[]; depth: string } {
  const { stdout } = runHook(te, "skills/hooks/routing-submit-classify.ts", JSON.stringify({ prompt }));
  const skills = stdout.match(/Matched skills: ([^.]+)/)?.[1]?.split(", ") ?? [];
  const depth = stdout.includes("FULL") ? "FULL" : "QUICK";
  return { skills, depth };
}

check(r, "skill: 'debug the crash' → debugging", skillTest("debug the crash in auth module").skills.includes("debugging"));
check(r, "skill: 'investigate redis' → research", skillTest("investigate how redis handles eviction policies").skills.includes("research"));
check(r, "skill: 'verify the deploy' → verification", skillTest("verify that the deployment succeeded").skills.includes("verification"));
check(r, "skill: 'doc sync' → docs-review", skillTest("run doc sync on the memory module").skills.includes("docs-review"));

check(r, "skill: 'add dark mode' → no skill", skillTest("add dark mode to the settings page").skills.length === 0);
check(r, "skill: 'fix the typo' → no skill", skillTest("fix the typo on line 42").skills.length === 0);

check(r, "skill: 'I see an error' → debugging", skillTest("I see an error when running the tests").skills.includes("debugging"));

runAndCheck(te, r, "skills/hooks/routing-submit-classify.ts", "smoke", "{}");
runAndCheck(te, r, "skills/hooks/routing-submit-classify.ts", "short skip", '{"prompt":"do it"}');
runAndCheck(te, r, "skills/hooks/routing-submit-classify.ts", "malformed", "not json");

// ── Depth classification ─────────────────────────────────────────────────────

console.log("\n--- depth classification ---");
check(r, "depth: 'fix typo' → QUICK", skillTest("fix the typo on line 42").depth === "QUICK");
check(r, "depth: 'refactor auth' → FULL", skillTest("refactor the auth module to use passkeys").depth === "FULL");
check(r, "depth: 'migrate database' → FULL", skillTest("migrate the database schema to support multi-tenancy").depth === "FULL");
check(r, "depth: 'read that file' → QUICK", skillTest("read that file for me").depth === "QUICK");
check(r, "depth: 'plan this' → FULL", skillTest("plan this feature out").depth === "FULL");
check(r, "depth: 'the design looks off' → QUICK", skillTest("the design looks off on the login button").depth === "QUICK");

const longPrompt = "update the button color from blue to green in the header component and also change the font size to 14px and make sure the hover state matches the new brand guidelines that were shared in the design doc last week";
check(r, "depth: long non-architectural → FULL (≥40 words)", skillTest(longPrompt).depth === "FULL");

check(r, "depth: 'add authentication' → FULL", skillTest("add authentication to the API routes").depth === "FULL");
check(r, "depth: 'update all API endpoints' → FULL", skillTest("update all API endpoints to use the new schema").depth === "FULL");
check(r, "depth: 'rename all references' → FULL", skillTest("rename all references to the old module name").depth === "FULL");
check(r, "depth: 'end to end tests' → FULL", skillTest("write end to end tests for the checkout flow").depth === "FULL");
check(r, "depth: 'integrate stripe' → FULL", skillTest("integrate stripe payments into the app").depth === "FULL");
check(r, "depth: 'full stack feature' → FULL", skillTest("build a full stack feature for user profiles").depth === "FULL");
check(r, "depth: 'fix the auth bug' → QUICK", skillTest("fix the auth bug on line 42").depth === "QUICK");
check(r, "depth: 'read the file' → QUICK", skillTest("read the API response handler").depth === "QUICK");

// ── Skill extensions ────────────────────────────────────────────────────────

console.log("\n--- skill extensions ---");

const crOut = runHook(te, "skills/hooks/routing-submit-classify.ts", JSON.stringify({ prompt: "run a code review on the hooks" })).stdout;
check(r, "extension: code-review includes base match", crOut.includes("Matched skills: code-review"));
check(r, "extension: code-review injects project content", crOut.includes("Project skill extensions") && crOut.includes("Hook integrity"));

const dbgOut = runHook(te, "skills/hooks/routing-submit-classify.ts", JSON.stringify({ prompt: "debug the crash in the auth module" })).stdout;
check(r, "extension: debugging includes base match", dbgOut.includes("Matched skills: debugging"));
check(r, "extension: debugging injects project content", dbgOut.includes("telemetry"));

const resOut = runHook(te, "skills/hooks/routing-submit-classify.ts", JSON.stringify({ prompt: "investigate how redis handles eviction policies" })).stdout;
check(r, "extension: research has no project extension", !resOut.includes("Project skill extensions"));

cleanupTestEnv(te);
printAndExit(r);
