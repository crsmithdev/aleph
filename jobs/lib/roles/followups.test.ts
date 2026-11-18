import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as issues from "../../../lib/todo.ts";
import * as store from "../../../lib/store.ts";
import type { Followup } from "../gates/gate.ts";
import type { Repo, Run } from "../records/ledger.ts";
import { fileFollowups, sameTopic } from "./followups.ts";

const fu = (title: string, o: Partial<Followup> = {}): Followup => ({ title, location: "a.ts:3", saw: "it fails", why: "it breaks a run", impact: 3, risk: 2, effort: 3, ...o });

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
  const saved = Object.fromEntries(Object.keys(env).concat("ALEPH_ITEMS", "ALEPH_DB", "ALEPH_RULE_CMD").map((k) => [k, process.env[k]]));
  // The title writer's model fails, so each follow-up gets cutTitle's title.
  Object.assign(process.env, env, { ALEPH_ITEMS: join(dir, "items"), ALEPH_DB: join(dir, "aleph.db"), ALEPH_RULE_CMD: "false" });
  return { dir, restore: () => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } rmSync(dir, { recursive: true, force: true }); } };
}

test("a worker follow-up takes its priority from its score, not from the run's issue", async () => {
  const l = listIn();
  try {
    const repo = { key: "fup" } as Repo;
    store.writeList(repo, "start", (doc) => { issues.add(doc, "the job", { priority: "high" }); return true; }, true);
    const run = { name: "r1", repo: "fup", target: "issue.1" } as Run;
    await fileFollowups(repo, run, [
      fu("Fix the first loose end in a.ts", { impact: 1, risk: 1, effort: 5 }),
      fu("Mend the second gate in b.ts", { impact: 5, risk: 5, effort: 1 }),
      fu("Paint the third fence in c.ts", { impact: 3, risk: 2, effort: 3 }),
    ], []);
    expect(store.readList(repo)!.items.map((i) => [i.title, i.fm.priority])).toEqual([
      ["the job", "high"], ["Fix the first loose end in a.ts", "low"], ["Mend the second gate in b.ts", "high"], ["Paint the third fence in c.ts", "medium"],
    ]);
  } finally { l.restore(); }
});

test("five follow-ups file three issues, each with its location, what was seen, why it matters and its score", async () => {
  const l = listIn();
  try {
    const repo = { key: "fup" } as Repo;
    const names = ["Fix the loose end in a.ts", "Mend the gate in b.ts", "Paint the fence in c.ts", "Sweep the porch in d.ts", "Oil the hinge in e.ts"];
    await fileFollowups(repo, { name: "r1", repo: "fup" } as Run, names.map((t, n) => fu(t, { location: `f${n}.ts:${n + 1}`, saw: `saw ${n}`, why: `why ${n}` })), []);
    const items = store.readList(repo)!.items;
    expect(items.map((i) => i.title)).toEqual(names.slice(0, 3));
    items.forEach((i, n) => {
      for (const part of [`f${n}.ts:${n + 1}`, `saw ${n}`, `why ${n}`, "Score: 15 (impact 3, risk 2, effort 3)"]) expect(i.request).toContain(part);
    });
  } finally { l.restore(); }
});

test("a long follow-up files a task with a title the rule accepts and the whole line in its request", async () => {
  const l = listIn();
  try {
    const repo = { key: "fup" } as Repo;
    const line = `Gate check: ${"the reviewer drops a changed test and the run still lands on main ".repeat(3).trim()}.`;
    expect(line.length).toBeGreaterThanOrEqual(150);
    await fileFollowups(repo, { name: "r1", repo: "fup" } as Run, [fu(line)], []);
    const [item] = store.readList(repo)!.items;
    expect(item.fm.kind).toBe("task");
    expect(item.title.length).toBeLessThanOrEqual(60);
    expect(item.title).not.toContain(": ");
    expect(issues.titleProblem(item.title)).toBeNull();
    expect(item.request).toContain(`FOLLOWUP: ${line}`);
  } finally { l.restore(); }
});

test("a worker follow-up files parked, and a repeat of a parked one is a note", async () => {
  const l = listIn();
  try {
    const repo = { key: "fup" } as Repo;
    await fileFollowups(repo, { name: "r1", repo: "fup" } as Run, [fu("Fix the first loose end in a.ts")], []);
    await fileFollowups(repo, { name: "r2", repo: "fup" } as Run, [fu("Fix the first loose end in a.ts")], []);
    const items = store.readList(repo)!.items;
    expect(items.map((i) => issues.status(i))).toEqual(["parked"]);
  } finally { l.restore(); }
});
