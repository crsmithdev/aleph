import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as issues from "../../../issues/lib/todo.ts";
import * as store from "../../../issues/lib/store.ts";
import type { Repo, Run } from "../records/ledger.ts";
import { fileFollowups, sameTopic } from "./unit.ts";

test("the same follow-up in other words is the same topic", () => {
  const pairs = [
    ["ui/api/issues.ts derives goals and the label filter from labels; move to kindOf so the UI tests can seed kind: goal", "ui/api/issues.ts derived() and the label filter read the goal label; switch them to kindOf"],
    ["ui/fixtures/review/build.ts still imports addLegacy; convert it before addLegacy is deleted", "ui/fixtures/review/build.ts:10 still imports addLegacy; convert it before addLegacy is deleted"],
    ["ui/fixtures/review/build.ts still imports addLegacy; convert it before addLegacy is deleted", "ui/fixtures/review/build.ts still imports addLegacy"],
    ["Decide whether `aleph issue --waiting-on` should return (spec aleph-840 assumes it exists) or drop aleph-840 in favour of `--after`", "Decide whether `aleph issue --waiting-on` should return, or drop aleph-840 in favour of `--after`"],
  ];
  for (const [a, b] of pairs) expect(sameTopic(a, b)).toBe(true);
});

test("different work in one busy file is not the same topic", () => {
  expect(sameTopic("jobs/lib/transitions/factory.ts `record(text, { unlabel: \"goal\" })` is a no-op on a kind goal", "jobs/lib/transitions/factory.ts retries a fetch that loses the ref lock")).toBe(false);
  expect(sameTopic("paint the fence", "mend the gate")).toBe(false);
  expect(sameTopic("...", "...")).toBe(false);
});

function listIn(): { dir: string; restore: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "aleph-followups-"));
  const env = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  const sh = (cwd: string, ...a: string[]) => { const p = Bun.spawnSync(a, { cwd, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" }); if (p.exitCode !== 0) throw new Error(`${a.join(" ")}: ${p.stderr}`); };
  sh(dir, "git", "init", "-q", "--bare", "-b", "main", "items.git");
  sh(dir, "git", "clone", "-q", "items.git", "items");
  sh(join(dir, "items"), "git", "commit", "-q", "--allow-empty", "-m", "start");
  sh(join(dir, "items"), "git", "push", "-q", "origin", "main");
  const saved = Object.fromEntries(Object.keys(env).concat("ALEPH_ISSUES", "ALEPH_RULE_CMD").map((k) => [k, process.env[k]]));
  // The title writer's model fails, so each follow-up gets cutTitle's title.
  Object.assign(process.env, env, { ALEPH_ISSUES: join(dir, "items"), ALEPH_RULE_CMD: "false" });
  return { dir, restore: () => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } rmSync(dir, { recursive: true, force: true }); } };
}

test("a worker follow-up takes the priority of the run's issue, medium when there is none", async () => {
  const l = listIn();
  try {
    const repo = { key: "fup" } as Repo;
    store.writeList(repo, "start", (doc) => { issues.add(doc, "the job", { priority: "high" }); return true; }, true);
    await fileFollowups(repo, { name: "r1", repo: "fup", on: "fup-1" } as Run, ["Fix the first loose end in a.ts"]);
    await fileFollowups(repo, { name: "r2", repo: "fup", on: "fup-9" } as Run, ["Mend the second gate in b.ts"]);
    await fileFollowups(repo, { name: "r3", repo: "fup" } as Run, ["Paint the third fence in c.ts"]);
    const doc = store.readList(repo)!;
    expect(doc.items.map((i) => [i.title, i.fm.priority])).toEqual([
      ["the job", "high"], ["Fix the first loose end in a.ts", "high"], ["Mend the second gate in b.ts", "medium"], ["Paint the third fence in c.ts", "medium"],
    ]);
  } finally { l.restore(); }
});

test("a long follow-up files a task with a title the rule accepts and the whole line in its request", async () => {
  const l = listIn();
  try {
    const repo = { key: "fup" } as Repo;
    const line = `Gate check: ${"the reviewer drops a changed test and the run still lands on main ".repeat(3).trim()}.`;
    expect(line.length).toBeGreaterThanOrEqual(150);
    await fileFollowups(repo, { name: "r1", repo: "fup" } as Run, [line]);
    const [item] = store.readList(repo)!.items;
    expect(item.fm.kind).toBe("task");
    expect(item.title.length).toBeLessThanOrEqual(60);
    expect(item.title).not.toContain(": ");
    expect(issues.titleProblem(item.title)).toBeNull();
    expect(item.request).toContain(`FOLLOWUP: ${line}`);
  } finally { l.restore(); }
});
