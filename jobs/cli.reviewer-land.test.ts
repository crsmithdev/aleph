import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, other, repo, sh, setup, teardown } from "./cli.helpers";
import { actionJob, drop } from "./inproc";

// The wiring of `aleph report`; the reviewer and the land run in-process in jobs/lib/review.land.test.ts.
beforeAll(setup);
afterAll(teardown);

test("the report hook prints JSON for SessionStart, and nothing when nothing is new", async () => {
  // A commit that adds held/x.txt reaches origin/main from the other clone, so the main checkout is behind it.
  mkdirSync(join(other, "held"), { recursive: true });
  writeFileSync(join(other, "held", "x.txt"), "x\n");
  sh(other, "git", "add", ".");
  sh(other, "git", "commit", "-qm", "add held/x.txt");
  sh(other, "git", "push", "-q", "origin", "main");
  const behind = await aleph(["report", "--hook"]);
  expect(behind.json.hookSpecificOutput.additionalContext).toMatch(/repo is \d+ commits? behind origin\/main; git pull brings:\n[\s\S]*held\/x\.txt/);
  sh(repo, "git", "merge", "-q", "--ff-only", "origin/main");
  const quiet = await aleph(["report", "--hook"]);
  expect(quiet.stdout.trim()).toBe("");
  await actionJob("fhook", "error", {}, "fac");
  const h = await aleph(["report", "--hook"]);
  expect(h.json.hookSpecificOutput.additionalContext).toContain("fac/fhook stuck: API Error: 500");
  expect(h.json.systemMessage).toContain("fac/fhook stuck");
  await drop("fhook");
}, 60_000);
