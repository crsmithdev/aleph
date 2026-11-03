// The firefighter's edit of a goal: its after, its spec, and the spec-check Ask it may answer at most MAX_SPEC_EDITS times.
import { expect, test } from "bun:test";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as issues from "../../todo/lib/todo.ts";
import { writeList } from "../../todo/lib/store.ts";
import { firefighterStep } from "./factory.ts";
import { MAX_RUNS_PER_HOUR } from "./goal-decision.ts";
import { MAX_SPEC_EDITS, applyActions, snapshot } from "./firefighter.ts";
import { plainAsk, setAsk } from "./ask.ts";
import { checkSpec } from "./spec-check.ts";
import { addGoal, alwaysFile, asked, base, dropped, FIREFIGHTER, fresh, item, key, plain, ports, reply, repoPath, run, sh, useFirefighterFixture } from "./firefighter.fixture.ts";

useFirefighterFixture();

test("a drop with after drops the job, and the goal waits after that goal, with the note saying so", async () => {
  fresh([{ title: "waiter", goal: true }, { title: "blocker" }]);
  addGoal(2);
  run({ name: `${key}-1`, condition: "stuck", reason: "time box", on: `${key}-1` });
  reply([{ do: "drop", job: `${key}-1`, reason: "needs the blocker", after: [`${key}-2.1`] }]);
  const f = await firefighterStep(ports());
  expect(f?.refused).toEqual([]);
  expect(dropped.map((d) => d.name)).toEqual([`${key}-1`]);
  expect(item(1).fm.after).toEqual([`${key}-2.1`]);
  expect(item(1).notes.at(-1)).toContain(`after ${key}-2.1`);
});

test("an edit-goal with only after sets it and leaves the body unchanged", async () => {
  fresh([{ title: "goal", body: "Ship the thing.\n", goal: true }, { title: "blocker" }]);
  addGoal(2);
  const r = await applyActions([{ do: "edit-goal", repo: key, n: 1, after: [`${key}-2.1`] }], ports());
  expect(r.refused).toEqual([]);
  expect(item(1).fm.after).toEqual([`${key}-2.1`]);
  expect(item(1).spec.trim()).toBe("Ship the thing.");
});

test("an after naming no goal is refused", async () => {
  fresh([{ title: "goal", goal: true }]);
  const r = await applyActions([{ do: "edit-goal", repo: key, n: 1, after: [`${key}-9.1`] }], ports());
  expect(r.refused).toEqual([expect.stringContaining("names no issue")]);
});

test("answer with after clears the Ask and sets it; a malformed ref is ignored in parse, a missing goal is refused and keeps the Ask", async () => {
  fresh([{ title: "a", ask: plain() }, { title: "b" }]);
  addGoal(2);
  const r = await applyActions([{ do: "answer", repo: key, n: 1, note: "wait", after: [`${key}-2.1`] }], ports());
  expect(r.refused).toEqual([]);
  expect(asked(1)).toBeNull();
  expect(item(1).fm.after).toEqual([`${key}-2.1`]);
  fresh([{ title: "a", ask: plain() }]);
  const bad = await applyActions([{ do: "answer", repo: key, n: 1, note: "wait", after: [`${key}-7.1`] }], ports());
  expect(bad.refused.length).toBe(1);
  expect(asked(1)).not.toBeNull();
});

test("a handed spec-check Ask is an event with handed set, and the firefighter's edit-goal clears it and stores the spec", async () => {
  fresh([{ title: "goal", body: "Ship the thing.\n", goal: true, ask: { ...plain(), reason: "spec-check" } }]);
  alwaysFile({ "spec-check": FIREFIGHTER });
  expect(snapshot().find((x) => x.kind === "ask")).toMatchObject({ reason: "spec-check", handed: true });
  const r = await applyActions([{ do: "edit-goal", repo: key, n: 1, body: "## Goal\nShip.\n## Edit surface\na.ts\n## Oracle\nIt ships.\n" }], ports());
  expect(r.refused).toEqual([]);
  expect(item(1).spec).toContain("## Oracle");
  expect(asked(1)).toBeFalsy();
});

test("with no spec-check standing, the same edit-goal leaves the Ask with Chris and the event has no handed flag", async () => {
  fresh([{ title: "goal", body: "Ship the thing.\n", goal: true, ask: { ...plain(), reason: "spec-check" } }]);
  expect(snapshot().find((x) => x.kind === "ask")?.handed).toBeUndefined();
  const r = await applyActions([{ do: "edit-goal", repo: key, n: 1, body: "## Goal\nShip.\n## Edit surface\na.ts\n## Oracle\nIt ships.\n" }], ports());
  expect(r.refused).toEqual([]);
  expect(item(1).spec).toContain("## Oracle");
  expect(asked(1)?.reason).toBe("spec-check");
});

test("a firefighter edit of only the dependencies leaves a spec-check Ask", async () => {
  fresh([{ title: "goal", body: "Ship the thing.\n", goal: true, ask: { ...plain(), reason: "spec-check" } }]);
  await applyActions([{ do: "edit-goal", repo: key, n: 1, after: [] }], ports());
  expect(asked(1)?.reason).toBe("spec-check");
});

test("a firefighter edit that still lacks Goal, Edit surface or Oracle keeps the spec-check Ask", async () => {
  fresh([{ title: "goal", body: "Ship the thing.\n", goal: true, ask: { ...plain(), reason: "spec-check" } }]);
  await applyActions([{ do: "edit-goal", repo: key, n: 1, body: "## Goal\nShip.\n## Oracle\nIt ships.\n" }], ports());
  expect(asked(1)?.reason).toBe("spec-check");
});

test("a spec check that always holds is edited by the firefighter at most MAX_SPEC_EDITS times; the next Ask goes to Chris", async () => {
  fresh([{ title: "goal", body: "Ship the thing.\n", goal: true }]);
  alwaysFile({ "spec-check": FIREFIGHTER });
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
      const ev = snapshot().find((x) => x.kind === "ask")!;
      if (edits >= MAX_SPEC_EDITS) {
        expect(ev.handed).toBeUndefined();
        expect(ev.line).not.toContain("(handed to you by Chris)");
        break;
      }
      expect(ev.handed).toBe(true);
      const r = await applyActions([{ do: "edit-goal", repo: key, n: 1, body: `## Goal\nShip ${turn}.\n## Edit surface\na.ts\n## Oracle\nIt ships.\n` }], ports());
      expect(r.refused).toEqual([]);
      edits++;
    }
    expect(edits).toBe(MAX_SPEC_EDITS);
    // The loop reaches Chris within the run-cap: one build start per check, edits + the last check.
    expect(MAX_SPEC_EDITS + 1).toBeLessThanOrEqual(MAX_RUNS_PER_HOUR);
    expect(asked(1)?.reason).toBe("spec-check");
    expect(asked(1)?.question).toBe('"the oracle": name a test');
    // A further edit no longer answers the Ask.
    await applyActions([{ do: "edit-goal", repo: key, n: 1, body: "## Goal\nShip x.\n## Edit surface\na.ts\n## Oracle\nIt ships.\n" }], ports());
    expect(asked(1)?.reason).toBe("spec-check");
  } finally {
    if (old === undefined) delete process.env.ALEPH_SPECCHECK_CMD; else process.env.ALEPH_SPECCHECK_CMD = old;
  }
});
