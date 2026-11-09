import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, other, repo, seedItem, sh, setup, teardown } from "./cli.helpers";
import { clearAsk, setAsk } from "./lib/asks/ask.ts";
import { allRuns } from "./lib/records/ledger.ts";
import { actionJob, drop } from "./inproc";

// The wiring of `aleph report`; the reviewer and the land run in-process in jobs/lib/land/review.land.test.ts.
beforeAll(setup);
afterAll(teardown);

test("the report hook prints one line for each thing to act on, and nothing when there is none", async () => {
  // A commit that adds held/x.txt reaches origin/main from the other clone, so the main checkout is behind it.
  mkdirSync(join(other, "held"), { recursive: true });
  for (const f of ["x", "y"]) {
    writeFileSync(join(other, "held", `${f}.txt`), "x\n");
    sh(other, "git", "add", ".");
    sh(other, "git", "commit", "-qm", `add held/${f}.txt`);
  }
  sh(other, "git", "push", "-q", "origin", "main");
  await aleph(["pause"]);
  const id = seedItem("fac", "Needs Chris");
  setAsk(`fac-${id}`, { kind: "input", reason: "question", question: "Which?", options: [], why: [] });
  const text = (await aleph(["report", "--hook"])).json.hookSpecificOutput.additionalContext;
  const lines = text.split("\n").filter(Boolean);
  expect(lines).toHaveLength(3);
  expect(lines[0]).toBe("factory paused");
  expect(lines[1]).toStartWith("1 asks wait for Chris: ");
  expect(lines[1]).toContain(`fac-${id}`);
  expect(lines[2]).toBe("fac is 2 commits behind origin/main");
  expect(text).not.toContain("git pull brings");
  await aleph(["resume"]);
  clearAsk(`fac-${id}`);
  sh(repo, "git", "merge", "-q", "--ff-only", "origin/main");
  const quiet = await aleph(["report", "--hook"]);
  expect(quiet.stdout.trim()).toBe("");
  expect(quiet.code).toBe(0);
}, 60_000);

test("the report hook marks no run shown and rewrites no episodes-seen file", async () => {
  const episodes = join(base, "factory", "episodes"), seen = join(base, "factory", "episodes-seen");
  mkdirSync(episodes, { recursive: true });
  writeFileSync(join(episodes, "page.md"), "x\n");
  writeFileSync(seen, "old\n");
  await actionJob("fhook", "error", {}, "fac");
  const h = await aleph(["report", "--hook"]);
  expect(h.stdout).not.toContain("fhook failed");
  expect(allRuns().find((e) => e.run.name === "fhook")!.run.shown).toBe(false);
  expect(readFileSync(seen, "utf8")).toBe("old\n");
  await drop("fhook");
}, 60_000);
