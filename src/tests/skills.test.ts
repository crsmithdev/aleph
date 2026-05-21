#!/usr/bin/env bun
import {
  createTestEnv, cleanupTestEnv, runHook, check, runAndCheck,
  createResults, printAndExit,
} from "../eval/harness.ts";

const te = createTestEnv("skills");
const r = createResults();

// ── Skill routing ────────────────────────────────────────────────────────────

console.log("--- skill routing ---");

function skillTest(prompt: string): { skills: string[] } {
  const { stdout } = runHook(te, "core/hooks/routing-classify-submit.ts", JSON.stringify({ prompt }));
  const skills = stdout.match(/Matched skills: ([^.]+)/)?.[1]?.split(", ") ?? [];
  return { skills };
}

// Generic code requests with no triggering keywords match nothing
const addDarkSkills = skillTest("add dark mode to the settings page").skills;
check(r, "skill: 'add dark mode' → no match", addDarkSkills.length === 0);
const fixTypoSkills = skillTest("fix the typo on line 42").skills;
check(r, "skill: 'fix the typo' → no match", fixTypoSkills.length === 0);

runAndCheck(te, r, "core/hooks/routing-classify-submit.ts", "smoke", "{}");
runAndCheck(te, r, "core/hooks/routing-classify-submit.ts", "short skip", '{"prompt":"do it"}');
runAndCheck(te, r, "core/hooks/routing-classify-submit.ts", "malformed", "not json", { expectExit: 1 });

// ── Skill extensions ────────────────────────────────────────────────────────

console.log("\n--- skill extensions ---");

const resOut = runHook(te, "core/hooks/routing-classify-submit.ts", JSON.stringify({ prompt: "search online for ssl pinning patterns" })).stdout;
check(r, "extension: search has no project extension", !resOut.includes("Project skill extensions"));

cleanupTestEnv(te);
printAndExit(r);
