// Archived goal tests of the director: the rows moved from the firefighter's Ask and land tests and from the explainer's
// case-text tests when the director took both roles. `bun run accept` runs them, `bun run test` does not.
import { expect, test } from "bun:test";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as issues from "../../../todo/lib/todo.ts";
import { writeList } from "../../../todo/lib/store.ts";
import { plainAsk, setAsk } from "../../../jobs/lib/ask.ts";
import { MAX_RUNS_PER_HOUR } from "../../../jobs/lib/goal-decision.ts";
import { checkSpec } from "../../../jobs/lib/spec-check.ts";
import { openRun } from "../../../jobs/lib/agent-run.ts";
import { allRuns, loadRegistry, readRun } from "../../../jobs/lib/ledger.ts";
import { liveEntries, runsToday } from "../../../jobs/lib/factory-status.ts";
import { MAX_SPEC_EDITS, defaultPorts, directAll, parseCaseText, pendingCases, prompt } from "../../../jobs/lib/director.ts";
import { addGoal, asked, base, branch, calls, fresh, held, item, key, landed, log, n, plain, ports, reply, repoPath, run, sh, useFirefighterFixture } from "../../../jobs/lib/firefighter.fixture.ts";

useFirefighterFixture();

const repo = () => loadRegistry()[key];
const direct = (p = ports()) => directAll([repo()], p);
const promptText = () => readFileSync(join(base, "prompt.md"), "utf8");
const FULL = (goal: string) => `## Goal\n${goal}\n## Edit surface\na.ts\n## Oracle\nIt ships.\n`;

// Lands of held runs.

test("a held run off the security paths whose reviews both say land is landed by the director", async () => {
  fresh([{ title: "held", goal: true }]);
  branch(`b${n}`, "ui/views/x.js");
  held(`b${n}`);
  reply([{ do: "land" }]);
  const [d] = await direct();
  expect(calls()).toBe(1);
  expect(landed).toEqual([`${key}-1`]);
  expect(d).toMatchObject({ outcome: "decided", applied: ["land"] });
  expect(log()).toContain(`director: ${key}-1: held-path: decided: land`);
  // The prompt carries the run's review and the issue.
  expect(promptText()).toContain("VERDICT: pass");
  expect(promptText()).toContain(`Item ${key}-1: held`);
});

test("a land by the director writes Held-by: director, not Held-by: Chris", async () => {
  fresh([{ title: "held", goal: true }]);
  // A real remote for the land to push to, and a stand-in for srt; the land unit runs in the foreground.
  writeFileSync(join(base, "repos.json"), JSON.stringify({ [key]: { path: repoPath(), sandbox: true, autoland: false, checks: [] } }));
  writeFileSync(join(base, "pass"), "#!/bin/bash\nshift\nexec env -i \"$@\"\n", { mode: 0o755 });
  process.env.ALEPH_SANDBOX_CMD = join(base, "pass");
  const remote = join(base, `remote${n}.git`);
  sh(base, "git", "init", "-q", "--bare", "-b", "main", remote);
  Bun.spawnSync(["git", "remote", "remove", "origin"], { cwd: repoPath() });
  sh(repoPath(), "git", "remote", "add", "origin", remote);
  sh(repoPath(), "git", "push", "-q", "origin", "main");
  sh(repoPath(), "git", "fetch", "-q", "origin");
  branch(`b${n}`, "ui/views/x.js");
  held(`b${n}`);
  reply([{ do: "land" }]);
  process.env.ALEPH_JOB_FOREGROUND = "1";
  try {
    const [d] = await direct(defaultPorts);
    expect(d.applied).toEqual(["land"]);
  } finally {
    delete process.env.ALEPH_JOB_FOREGROUND;
    delete process.env.ALEPH_SANDBOX_CMD;
  }
  const trailers = sh(base, "git", "--git-dir", remote, "log", "-1", "--format=%(trailers:only)", "main");
  expect(trailers).toContain("Held-by: director");
  expect(trailers).not.toContain("Held-by: Chris");
});

test("the same run with a diff in jobs/lib/sandbox.ts is not landed: it is on the escalation list, with case text", async () => {
  fresh([{ title: "held", goal: true }]);
  branch(`b${n}`, "jobs/lib/sandbox.ts");
  const folder = held(`b${n}`);
  reply([{ do: "land" }]);
  const [d] = await direct();
  expect(landed).toEqual([]);
  expect(d).toMatchObject({ outcome: "escalated", why: "the run changes jobs/lib/sandbox.ts, a security path or bun.lock, so its land is Chris's" });
  expect(readRun(folder)!.ask!.situation).toBeTruthy();
  expect(readRun(folder)!.condition).toBe("awaiting");
});

test("a land before the review has a verdict is refused, and the Ask goes to Chris", async () => {
  fresh([{ title: "held", goal: true }]);
  branch(`b${n}`, "ui/views/y.js");
  held(`b${n}`, "PENDING\n");
  reply([{ do: "land" }]);
  const [d] = await direct();
  expect(landed).toEqual([]);
  expect(d.refused).toEqual([expect.stringContaining("review has no verdict yet")]);
  expect(d.outcome).toBe("escalated");
});

// Answers and spec edits.

test("answer with after clears the Ask and sets it; a missing goal is refused and the Ask goes to Chris", async () => {
  fresh([{ title: "a", ask: plain() }, { title: "b" }]);
  addGoal(2);
  reply([{ do: "answer", note: "wait", after: [`${key}-2.1`] }]);
  const [d] = await direct();
  expect(d.refused).toEqual([]);
  expect(asked(1)).toBeNull();
  expect(item(1).fm.after).toEqual([`${key}-2.1`]);
  fresh([{ title: "a", ask: plain() }]);
  reply([{ do: "answer", note: "wait", after: [`${key}-7.1`] }]);
  const [bad] = await direct();
  expect(bad.refused.length).toBe(1);
  expect(bad.outcome).toBe("escalated");
  expect(asked(1)).not.toBeNull();
});

test("an edit of only the dependencies, or one that still lacks Goal, Edit surface or Oracle, leaves the spec-check Ask", async () => {
  for (const edit of [{ after: [] as string[] }, { body: "## Goal\nShip.\n## Oracle\nIt ships.\n" }]) {
    fresh([{ title: "goal", body: "Ship the thing.\n", goal: true, ask: plainAsk("spec-check", "no Oracle") }]);
    reply([{ do: "edit-goal", ...edit }]);
    const [d] = await direct();
    expect(d.outcome).toBe("escalated");
    expect(asked(1)?.reason).toBe("spec-check");
  }
});

test("a spec check that always holds is edited by the director at most MAX_SPEC_EDITS times; the next Ask goes to Chris", async () => {
  fresh([{ title: "goal", body: "Ship the thing.\n", goal: true }]);
  sh(repoPath(), "git", "update-ref", "refs/remotes/origin/main", "HEAD");
  const bin = join(base, "holds.sh");
  const line = JSON.stringify({ type: "result", subtype: "success", result: "VERDICT: hold \"the oracle\": name a test", total_cost_usd: 0 });
  writeFileSync(bin, `#!/bin/sh\ncat > /dev/null\nprintf '%s\\n' '${line}'\n`);
  chmodSync(bin, 0o755);
  const old = process.env.ALEPH_SPECCHECK_CMD;
  process.env.ALEPH_SPECCHECK_CMD = bin;
  try {
    let edits = 0;
    for (let turn = 1; turn <= MAX_SPEC_EDITS + 3; turn++) {
      const c = await checkSpec({ key, path: repoPath(), main: "main" } as any, 1);
      expect(c.verdict).toBe("hold");
      // As unit.ts does on a hold.
      writeList({ key }, "spec check held", (doc) => {
        const it = issues.find(doc, 1)!;
        setAsk(it, plainAsk("spec-check", c.problems ?? ""));
        return issues.note(it, `asks Chris: ${c.problems}`);
      });
      reply([{ do: "edit-goal", body: FULL(`Ship ${turn}.`) }]);
      const [d] = await direct();
      if (d.outcome === "escalated") break;
      edits++;
    }
    expect(edits).toBe(MAX_SPEC_EDITS);
    // The loop reaches Chris within the run-cap: one build start per check, edits + the last check.
    expect(MAX_SPEC_EDITS + 1).toBeLessThanOrEqual(MAX_RUNS_PER_HOUR);
    expect(asked(1)?.reason).toBe("spec-check");
    expect(asked(1)?.question).toBe('"the oracle": name a test');
    expect(asked(1)?.situation).toBeTruthy();
  } finally {
    if (old === undefined) delete process.env.ALEPH_SPECCHECK_CMD; else process.env.ALEPH_SPECCHECK_CMD = old;
  }
});

// The case text and the prompt.

test("the prompt names the card's actions, the item's notes and the run's result tail", () => {
  fresh([{ title: "q", notes: ["NOTE-MARK: tried once"], ask: { kind: "input", reason: "question", question: "A or B?", options: [{ label: "A", line: "do a" }, { label: "B", line: "do b" }], why: ["one"] } }]);
  run({ name: `${key}-1`, on: `${key}-1`, ask: { kind: "approval", reason: "review", question: "Land x.ts?", options: [], why: [] } }, { "result.md": "work done\nRESULT-TAIL-MARK: changed x.ts\n" });
  const cases = pendingCases([repo()]);
  const onItem = prompt(cases.find((c) => c.at === "item")!, null, []);
  expect(onItem).toContain("decide:A, decide:B, deny");
  expect(onItem).toContain("NOTE-MARK: tried once");
  expect(onItem).toContain("A or B?");
  for (const act of ["answer", "drop", "edit-goal"]) expect(onItem.split("\n").find((l) => l.startsWith(`- {"do": "${act}"`))).toContain('"after"');
  expect(onItem).toContain("A note alone does not stop a rerun.");
  const onRun = prompt(cases.find((c) => c.at === "run")!, null, []);
  expect(onRun).toContain("land, drop");
  expect(onRun).toContain("RESULT-TAIL-MARK: changed x.ts");
  expect(onRun).toContain('{"do": "land"}');
});

test("the prompt states the case-text limits, asks for details, and shows the past decisions", () => {
  fresh([{ title: "q", ask: plainAsk("host-check", "check it") }]);
  const p = prompt(pendingCases([repo()])[0], "a host check is Chris's while host access is off", [{ at: "2026-11-01T10:00:00.000Z", ref: "x-9", on: "x-9", reason: "run-cap", question: "q", outcome: "decided", applied: ["rerun"], refused: [] }]);
  expect(p).toContain("at most 3 sentences and 600 characters");
  expect(p).toContain("only risks and gaps");
  expect(p).toContain("not a second summary");
  expect(p).toContain("at most 2 sentences and 220 characters");
  expect(p).toContain('"details"');
  expect(p).toContain("x-9 (run-cap): decided; did rerun");
  expect(p).toContain("Take no action");
});

test("parseCaseText wants a situation and an effect per action", () => {
  expect(parseCaseText(null, ["a"])).toBe("no JSON");
  expect(parseCaseText({ situation: "", effects: [] }, ["a"])).toBe("no situation");
  expect(parseCaseText({ situation: "s", effects: [{ action: "a", text: "t" }, { action: "z", text: "u" }], recommend: null }, ["a"])).toEqual({ situation: "s", effects: [{ action: "a", text: "t" }] });
});

test("parseCaseText keeps 3 sentences of the situation and 2 of an effect, and moves the rest to details whole", () => {
  const sit = Array.from({ length: 8 }, (_, i) => `S${i + 1}.`).join(" ");
  const t = parseCaseText({ situation: sit, effects: [{ action: "a", text: "E1. E2. E3. E4." }], details: "Own." }, ["a"]) as any;
  expect(t.situation).toBe("S1. S2. S3.");
  expect(t.effects[0].text).toBe("E1. E2.");
  expect(t.details).toBe("S4. S5. S6. S7. S8. E3. E4. Own.");
});

test("parseCaseText never cuts a sentence: the character limit moves whole sentences, and a long first sentence stays", () => {
  const long = "x".repeat(300) + ".";
  const t = parseCaseText({ situation: `Short. ${"y".repeat(595)}.`, effects: [{ action: "a", text: long + " Next." }] }, ["a"]) as any;
  expect(t.situation).toBe("Short.");
  expect(t.effects[0].text).toBe(long);
  expect(t.details).toBe(`${"y".repeat(595)}. Next.`);
  expect((parseCaseText({ situation: "A. B.", effects: [{ action: "a", text: "C." }] }, ["a"]) as any).details).toBeUndefined();
});

test("an escalation whose case text lacks an effect gets the fallback text, naming what was wrong", async () => {
  fresh([{ title: "check", ask: plainAsk("host-check", "check it") }]);
  writeFileSync(join(base, "reply.json"), JSON.stringify({ escalate: { situation: "x", effects: [{ action: "checked", text: "t" }] } }));
  const [d] = await direct();
  expect(d.outcome).toBe("escalated");
  expect(asked(1)!.situation).toContain("no effect for deny");
});

// The runs.

test("a director run is not a live entry and not in runsToday, and a run a dead process left is ended by the next sweep", async () => {
  fresh();
  const left = openRun({ role: "director", who: "the director", model: "m", seconds: 60, flags: [], name: "director-x", command: "director", shown: true, on: "x-1" });
  expect(allRuns().map((e) => e.run.kind)).toEqual(["director"]);
  expect(liveEntries()).toEqual([]);
  expect(runsToday()).toEqual([]);
  await direct();
  expect(readRun(left.folder)).toMatchObject({ condition: "done", reason: "failed: its process ended before its decision" });
});

test("ALEPH_DIRECTOR_CAP=1 takes one Ask a sweep", async () => {
  fresh([{ title: "a", ask: plain() }, { title: "b", ask: plain("which test?") }]);
  replyWith();
  process.env.ALEPH_DIRECTOR_CAP = "1";
  try {
    expect((await direct()).length).toBe(1);
    expect(asked(1)!.situation).toBeTruthy();
    expect(asked(2)!.situation).toBeUndefined();
    expect((await direct()).length).toBe(1);
    expect(asked(2)!.situation).toBeTruthy();
  } finally { delete process.env.ALEPH_DIRECTOR_CAP; }
});

/** A reply the fake gives that is no JSON: each Ask goes to Chris with the fallback text. */
function replyWith(): void { writeFileSync(join(base, "reply.json"), "no json"); }
