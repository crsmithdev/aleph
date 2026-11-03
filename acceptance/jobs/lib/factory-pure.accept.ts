// Archived goal tests from jobs/lib/factory-pure.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeList } from "../../../todo/lib/store.ts";
import * as issues from "../../../todo/lib/todo.ts";
import { correctionsDue, episodeStep, report, setPaused } from "../../../jobs/lib/factory.ts";
import { writeRun } from "../../../jobs/lib/ledger.ts";
import { type Run } from "../../../jobs/lib/ledger.ts";
import { ctx, sh, mk, setup, teardown } from "../../../jobs/lib/factory.helpers.ts";
import { vault as newVault } from "../../../tests/git-fixture.ts";

beforeEach(setup);
afterEach(teardown);

const storeAt = (lessons: unknown[], minedAt = "") => {
  mkdirSync(join(ctx.base, "factory"), { recursive: true });
  writeFileSync(join(ctx.base, "factory", "corrections.json"), JSON.stringify({ minedAt, lessons }));
};

test("correctionsDue: from 03:00 local, once per local day", () => {
  const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();
  expect(correctionsDue(at(28, 2, 59))).toBe(false);
  expect(correctionsDue(at(28, 3))).toBe(true);
  storeAt([], new Date(at(28, 3, 1)).toISOString());
  expect(correctionsDue(at(28, 15))).toBe(false);
  expect(correctionsDue(at(29, 2, 59))).toBe(false);
  expect(correctionsDue(at(29, 3))).toBe(true);
});

test("report lists a proposed lesson on every report until decided", () => {
  storeAt([{ id: "L1", sentence: "run the tests before ending", state: "proposed", kind: "check", signals: [], count: 3 }]);
  const line = "  L1 check: run the tests before ending (3 signals)";
  expect(report()).toContain(`proposed lessons (Yes or No on Status):\n${line}`);
  expect(report()).toContain(line);
});

test("report prints no proposed lessons block with none", () => {
  storeAt([{ id: "L2", sentence: "x", state: "open", signals: [], count: 1 }]);
  expect(report()).not.toContain("proposed lessons");
});

/** A temp vault under ALEPH_VAULT for one test; the old value is restored by `done`. */
function withVault(): { vault: string; done: () => void } {
  const old = process.env.ALEPH_VAULT;
  const vault = join(ctx.base, "vault");
  process.env.ALEPH_VAULT = vault;
  newVault(vault);
  return { vault, done: () => { if (old === undefined) delete process.env.ALEPH_VAULT; else process.env.ALEPH_VAULT = old; } };
}

test("episodeStep writes nothing while paused", async () => {
  const v = withVault();
  try {
    setPaused(true);
    expect(await episodeStep()).toEqual([]);
    expect(existsSync(join(v.vault, "wiki", "episodes")) ? readdirSync(join(v.vault, "wiki", "episodes")).filter((f) => f.endsWith(".md")) : []).toEqual([]);
  } finally { v.done(); }
});

test("episodeStep writes the page of a done goal and logs its title", async () => {
  const v = withVault();
  try {
    const id = writeList({ key: "fac" }, "add", (doc) => {
      const item = issues.add(doc, "ship it", { spec: "## Goal\nShip it." });

      issues.setStatus(item, "done");
      return item.id;
    }, true)!.value;
    const repo = join(ctx.base, "repo");
    writeFileSync(join(repo, "f.txt"), "x\n");
    sh(repo, "git", "add", ".");
    sh(repo, "git", "commit", "-q", "-m", "ship thing", "-m", `Issue: fac-${id}`);
    sh(repo, "git", "push", "-q", "origin", "main");
    const folder = join(ctx.base, "jobs", `20261028-100000-fac-${id}-agent`);
    mkdirSync(folder, { recursive: true });
    writeRun(folder, { kind: "build", job: "j", name: `fac-${id}`, repo: "fac", condition: "landed", told: true, on: `fac-${id}`, started: "2026-10-28T10:00:00Z", ended: "2026-10-28T10:20:00Z" });
    expect(await episodeStep()).toEqual([`fac-${id} ship it`]);
    expect(readdirSync(join(v.vault, "wiki", "episodes")).filter((f) => f.endsWith(".md"))).toEqual([`fac-${id} ship it.md`]);
    expect(readFileSync(join(ctx.base, "factory", "tick.log"), "utf8")).toContain(`episodes fac-${id} ship it\n`);
  } finally { v.done(); }
});

test("report prints the kept and rejected lines of a facts run, once", () => {
  const folder = join(ctx.base, "jobs", "20261028-000001-facts-n1-facts");
  mkdirSync(folder, { recursive: true });
  writeRun(folder, { kind: "facts", job: "j1", name: "facts-n1", repo: "fac", condition: "done", reason: "kept 1, rejected 1", told: true, shown: false, started: "2026-10-28T00:00:00Z", kept: ["Lemons Float"], rejected: [{ fact: "pears sink", reason: "b.ts says otherwise" }] } as Run);
  const old = join(ctx.base, "jobs", "20261028-000002-facts-n2-facts");
  mkdirSync(old, { recursive: true });
  writeRun(old, { kind: "facts", job: "j2", name: "facts-n2", repo: "fac", condition: "done", reason: "kept 0, rejected 1", told: true, shown: false, started: "2026-10-28T00:00:01Z", kept: [], rejected: ["old: string form"] } as unknown as Run);
  const out = report();
  expect(out).toContain("fac/facts-n1 done: kept 1, rejected 1\n  kept: Lemons Float");
  expect(out).toContain("  rejected: old: string form");
  expect(out).toContain("  rejected: pears sink: b.ts says otherwise");
  expect(out.split("rejected: pears sink").length).toBe(2);
  expect(report()).not.toContain("fac/facts-n1");
});

test("report puts a done triage run under other", () => {
  const triage = join(ctx.base, "jobs", "20261102-000002-triage-t1-triage");
  mkdirSync(triage, { recursive: true });
  writeRun(triage, { kind: "triage", job: "t1", name: "triage-t1", repo: "fac", condition: "done", reason: "built 1", told: true, shown: false, started: "2026-11-02T00:00:01Z" } as Run);
  const out = report();
  expect(out.indexOf("other:")).toBeLessThan(out.indexOf("fac/triage-t1 done"));
});

test("report adds the priority to a delivered line at high or critical, not at medium", () => {
  const ids = [["critical", "a"], ["medium", "b"]].map(([p]) => writeList({ key: "fac" }, "add", (doc) => issues.add(doc, `t ${p}`, { priority: p, spec: "x" }).id, true)!.value);
  ids.forEach((id) => mk(`fac-${id}`, "build", "landed", { shown: false, on: `fac-${id}` }));
  const out = report();
  expect(out).toContain(`fac/fac-${ids[0]} landed [critical]`);
  expect(out).toContain(`fac/fac-${ids[1]} landed`);
  expect(out).not.toContain(`fac/fac-${ids[1]} landed [`);
});
