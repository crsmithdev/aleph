import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flakes, runChecks, type CheckExec } from "./checks.ts";
import type { CheckResult, Repo } from "./ledger.ts";

const KEYS = ["ALEPH_FACTORY_DIR", "XDG_RUNTIME_DIR", "ALEPH_CHECK_SLOTS", "ALEPH_CHECK_TIMEOUT"];
let base: string;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "checks-"));
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  Object.assign(process.env, { ALEPH_FACTORY_DIR: join(base, "factory"), XDG_RUNTIME_DIR: join(base, "run"), ALEPH_CHECK_SLOTS: "4" });
  delete process.env.ALEPH_CHECK_TIMEOUT;
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(base, { recursive: true, force: true });
});

type Reply = { code: number; timedOut?: boolean; print?: string };
const repo = (...names: string[]) => ({ key: "r", checks: names.map((name) => ({ name, run: name })) }) as unknown as Repo;

/** Runs the repo's checks with a fake exec that gives the replies in order. */
async function run(r: Repo, replies: Reply[], changed: string[] = []) {
  const calls: string[] = [];
  const results: CheckResult[] = [];
  const exec: CheckExec = async (check, out) => {
    calls.push(check.name);
    const reply = replies.shift()!;
    writeFileSync(out, reply.print ?? "");
    return { code: reply.code, timedOut: reply.timedOut ?? false };
  };
  const failed = await runChecks({ folder: base, repo: r, changed, phase: () => {}, record: (c) => results.push(c) }, exec);
  return { failed, calls, results, log: readFileSync(join(base, "checks.log"), "utf8") };
}

test("a check that passes runs once", async () => {
  const r = await run(repo("a"), [{ code: 0 }]);
  expect(r).toMatchObject({ failed: null, calls: ["a"] });
  expect(r.results[0].rerun).toBeUndefined();
  expect(flakes()).toEqual([]);
});

test("a pass on the second run is a flake that names the failed tests once each", async () => {
  const print = "x.test.ts:\n(fail) suite > one [12.50ms]\n(pass) two\n\n1 tests failed:\n(fail) suite > one [12.50ms]\n(fail) three\n";
  const r = await run(repo("a"), [{ code: 1, print }, { code: 0, print: "fine\n" }]);
  expect(r).toMatchObject({ failed: null, calls: ["a", "a"], results: [{ name: "a", ok: true, rerun: true }] });
  expect(r.log).toContain("## a: exit 1, run again\nx.test.ts:");
  expect(r.log).toContain("## a: exit 0 (second run)\nfine\n");
  expect(flakes()).toMatchObject([{ repo: "r", check: "a", tests: ["suite > one", "three"] }]);
});

test("a failure on both runs fails the check, records no flake and stops the loop", async () => {
  const r = await run(repo("a", "b"), [{ code: 1 }, { code: 2 }]);
  expect(r).toMatchObject({ failed: "a failed", calls: ["a", "a"], results: [{ name: "a", ok: false }] });
  expect(flakes()).toEqual([]);
});

test("a timeout has no rerun", async () => {
  const r = await run(repo("a"), [{ code: 124, timedOut: true }]);
  expect(r).toMatchObject({ failed: "timed out: check a", calls: ["a"] });
  expect(r.log).toContain("exit 124 (timed out)");
});

test("a second run that times out is a timeout", async () => {
  const r = await run(repo("a"), [{ code: 1 }, { code: 124, timedOut: true }]);
  expect(r).toMatchObject({ failed: "timed out: check a", results: [{ ok: false }] });
  expect(flakes()).toEqual([]);
});

test("exit code 124 without the clock is an ordinary failure", async () => {
  const r = await run(repo("a"), [{ code: 124 }, { code: 124 }]);
  expect(r).toMatchObject({ failed: "a failed", calls: ["a", "a"] });
});

test("a check with `when` runs only when a changed file matches", async () => {
  const r = { key: "r", checks: [{ name: "android", run: "x", when: ["android/**"] }, { name: "all", run: "y" }] } as unknown as Repo;
  expect((await run(r, [{ code: 0 }], ["ui/a.ts"])).calls).toEqual(["all"]);
  expect((await run(r, [{ code: 0 }, { code: 0 }], ["android/b.kt"])).calls).toEqual(["android", "all"]);
});

test("flake rows from parallel processes all survive", async () => {
  const script = join(base, "flake.ts");
  writeFileSync(script, `
import { runChecks } from ${JSON.stringify(join(import.meta.dir, "checks.ts"))};
let n = 0;
const repo = { key: "r", checks: Array.from({ length: 25 }, (_, i) => ({ name: process.argv[2] + "-" + i, run: "x" })) };
await runChecks({ folder: ${JSON.stringify(base)}, repo, changed: [], phase: () => {} }, async () => ({ code: n++ % 2 ? 0 : 1, timedOut: false }));
`);
  const names = Array.from({ length: 8 }, (_, i) => `c${i}`);
  const procs = names.map((n) => Bun.spawn([process.execPath, script, n], { env: process.env, stdout: "ignore", stderr: "pipe" }));
  const codes = await Promise.all(procs.map((p) => p.exited));
  expect(codes).toEqual(names.map(() => 0));
  expect(flakes().length).toBe(names.length * 25);
});
