// A land's merge and push: no net change, a refused branch, a lost push race, a job already on main, and what happens after a failed land.
import { afterAll, beforeAll, expect, setSystemTime, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterLand, bounceNote, brief as unitPrompt, isMergeBounce, MERGE_MODEL } from "../transitions/continuation.ts";
import { land, landTerms } from "./landing.ts";
import { type Run } from "../records/ledger.ts";
import { seed, reseed } from "../../job.testkit.ts";
import { dir, job, landLog, mainFiles, moveMain, ports, remote, repo, sh, useLandingFixture } from "./landing.testkit.ts";

// The test's clock: the code under test reads it, and the fixtures sit at known distances from it.
const NOW = Date.parse("2026-11-04T12:00:00Z");
beforeAll(() => setSystemTime(NOW));
afterAll(() => setSystemTime());

useLandingFixture();

test("a change main already has ends done with no net change and takes the branch", async () => {
  const e = job("twin", [["twin.txt", "same\n"]]);
  moveMain("twin.txt", "same\n");
  const r = await land(e, repo, ports());
  expect(r).toMatchObject({ outcome: { state: "done", reason: "no net change" }, code: 0 });
  expect(sh(repo.path, "git", "branch", "--list", "job/twin")).toBe("");
});

test("a branch that changes the list is refused, and the note names the list", async () => {
  const e = job("own", [["docs/todo.md", "x\n"]]);
  const before = remote("rev-parse", "main");
  const r = await land(e, repo, ports());
  expect(r.outcome).toMatchObject({ state: "failed", conflicts: ["docs/todo.md"] });
  expect(remote("rev-parse", "main")).toBe(before);
  expect(bounceNote(r.outcome as Run)).toContain("Only aleph issue writes the list");
});

test("a branch that is gone fails", async () => {
  const r = await land(job("nobranch", []), repo, ports());
  expect(r.outcome).toMatchObject({ state: "failed", reason: "branch gone: job/nobranch" });
});

test("a push that loses a race merges again in the same land, and lands", async () => {
  const e = job("racer", [["x.txt", "x\n"]]);
  const r = await land(e, repo, ports({ races: 1 }));
  expect(r.outcome.state).toBe("landed");
  expect(landLog(e)).toContain("## main moved; merging again");
  expect(remote("log", "-1", "--format=%s", "main")).toBe("add x.txt");
});

test("a push that keeps losing fails as moved, and the unit lands again", async () => {
  const e = job("loser", [["x.txt", "x\n"]]);
  const r = await land(e, repo, ports({ races: 99 }));
  expect(r.code).toBe(1);
  reseed(e.id, r.outcome as Partial<Run>);
  expect(afterLand({ ...e.run, ...r.outcome } as Run)).toBe("land");
  expect(mainFiles()).not.toContain("x.txt");
});

test("a push the remote refuses with main in place fails and leaves main alone", async () => {
  writeFileSync(join(dir, "repo.git", "hooks", "pre-receive"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  const before = remote("rev-parse", "main");
  const r = await land(job("nope", [["x.txt", "x\n"]]), repo, ports());
  expect(r.outcome).toMatchObject({ state: "failed", reason: "push refused" });
  expect(remote("rev-parse", "main")).toBe(before);
});

test("a job already on main by its Job trailer lands as that commit and does not merge again", async () => {
  const e = job("pushed", [["p.txt", "p\n"]]);
  const o = join(dir, "other");
  sh(o, "git", "pull", "-q", "origin", "main");
  sh(o, "git", "commit", "-q", "--allow-empty", "-m", `hand\n\nJob: ${e.run.prev}`);
  sh(o, "git", "push", "-q", "origin", "main");
  const p = ports();
  const r = await land(e, repo, p);
  expect(r.outcome).toEqual({ state: "landed", commit: remote("rev-parse", "main") });
  expect(p.calls).toEqual([]);
  expect(sh(repo.path, "git", "branch", "--list", "job/pushed")).toBe("");
});

test("afterLand sends a conflict back to the worker at most twice", () => {
  const e = job("clash", []);
  const fail = { ...e.run, state: "failed", cause: "conflict", reason: "merge conflict", conflicts: ["f"] } as Run;
  reseed(e.id, fail);
  expect(afterLand(fail)).toBe("worker");
  expect(afterLand({ ...fail, state: "landed" })).toBeUndefined();
  expect(afterLand({ ...fail, conflicts: undefined, cause: "check", reason: "x failed" })).toBeUndefined();
  for (const n of [2, 3]) {
    seed({ ...fail, role: "land", prev: e.run.prev, state: "failed" });
    expect(afterLand(fail)).toBe(n === 2 ? "worker" : undefined);
  }
});

test("landTerms: which runs may land, and how", () => {
  const ask = (reason: string, kind = "review") => ({ state: "waiting", ask: { kind, reason, question: "", options: [], why: [] } });
  const needs = (n: Partial<Run>) => landTerms({ role: "build", ...n } as Run);
  expect(needs({ state: "passed" })).toEqual({ manual: false, held: false, asked: false });
  expect(needs({ state: "passed", say: "look" })).toEqual({ manual: true, held: false, asked: false });
  expect(landTerms({ role: "recheck", state: "passed" } as Run)).toEqual({ manual: false, held: false, asked: false });
  expect(needs(ask("held-path") as Partial<Run>)).toEqual({ manual: false, held: true, asked: true });
  expect(needs(ask("review-held") as Partial<Run>)).toEqual({ manual: false, held: true, asked: true });
  expect(needs(ask("question", "input") as Partial<Run>)).toBeNull();
  expect(needs({ state: "failed" })).toBeNull();
  expect(landTerms({ role: "land", state: "passed" } as Run)).toBeNull();
});

test("the run after a conflicted land has a merge prompt: the paths and the last commit on main, no spec text", async () => {
  const e = job("mrg", [["clash.txt", "branch\n"]]);
  moveMain("clash.txt", "main\n");
  const spec = "SPEC-SECRET-TEXT: build the whole thing";
  writeFileSync(join(e.folder, "..", e.run.job.slice(4), "spec.md"), spec);
  const r = await land(e, repo, ports());
  expect(r.outcome).toMatchObject({ state: "failed", conflicts: ["clash.txt"] });
  reseed(e.id, r.outcome as Partial<Run>);
  const b = seed({ name: "mrg", repo: "demo", prev: e.run.prev, role: "build", state: "running", merge: true, model: MERGE_MODEL, made: 99, started: new Date(NOW).toISOString() });
  const text = unitPrompt(b.id, b.run, repo);
  expect(text).toContain("clash.txt");
  expect(text).toContain("other clash.txt");
  expect(text).toContain("origin/main");
  expect(text).not.toContain("SPEC-SECRET");
  expect(text).not.toContain("## Spec");
  expect(isMergeBounce({ ...e.run, ...r.outcome } as Run)).toBe(true);
  expect(isMergeBounce({ ...e.run, cause: "other", conflicts: ["docs/todo.md"] } as Run)).toBe(false);
});

/** Points ALEPH_SYSTEMCTL at a script that appends its arguments to a file, prints `say` and exits `code`. */
function stand(code: number, say = ""): string {
  const log = join(dir, "systemctl.log");
  const bin = join(dir, "systemctl.sh");
  writeFileSync(bin, `#!/bin/sh\necho "$@" >> ${log}\n${say ? `echo ${say}\n` : ""}exit ${code}\n`, { mode: 0o755 });
  process.env.ALEPH_SYSTEMCTL = bin;
  return log;
}

test("a land that adds a unit file reloads systemd once and logs it", async () => {
  const calls = stand(0);
  const e = job("unit", [["jobs/systemd/x.service", "[Unit]\n"]]);
  const r = await land(e, repo, ports());
  expect(r.outcome.state).toBe("landed");
  expect(readFileSync(calls, "utf8")).toBe("--user daemon-reload\n");
  expect(landLog(e)).toContain("systemd reloaded");
});

test("a failed systemd reload is logged and does not fail the land", async () => {
  stand(1, "boom");
  const e = job("unitbad", [["jobs/systemd/x.service", "[Unit]\n"]]);
  const r = await land(e, repo, ports());
  expect(r.outcome.state).toBe("landed");
  expect(landLog(e)).toContain("systemd reload failed: boom");
});

test("guard: a land that changes no unit file makes no systemctl call", async () => {
  const calls = stand(0);
  const e = job("plain", [["x.txt", "x\n"]]);
  const r = await land(e, repo, ports());
  expect(r.outcome.state).toBe("landed");
  expect(existsSync(calls)).toBe(false);
  expect(landLog(e)).not.toContain("systemd reload");
});
