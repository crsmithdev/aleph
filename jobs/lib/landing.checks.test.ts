// Which checks a land runs: none on an unchanged main, fewer when main's new commits do not reach the run, and the green baseline it records.
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { land } from "./landing.ts";
import { writeRun } from "./ledger.ts";
import { dir, job, landLog, moveMain, ports, remote, repo, sh, useLandingFixture } from "./landing.fixture.ts";

useLandingFixture();

test("a run whose checked base is origin/main lands with no check call; one behind main runs the checks", async () => {
  const fresh = job("fresh", [["fresh.txt", "f\n"]]);
  const stamp = { checkedBase: remote("rev-parse", "main"), checkedTip: sh(repo.path, "git", "rev-parse", "job/fresh") };
  const p = ports();
  const e = { ...fresh, run: { ...fresh.run, ...stamp } };
  writeRun(e.folder, e.run);
  expect((await land(e, repo, p)).outcome.condition).toBe("landed");
  expect(p.calls).toEqual([]);
  expect(landLog(e)).toContain("checks skipped: main unchanged since");

  const stale = job("stale", [["stale.txt", "s\n"]]);
  const staleStamp = { checkedBase: remote("rev-parse", "main"), checkedTip: sh(repo.path, "git", "rev-parse", "job/stale") };
  moveMain();
  const q = ports();
  const e2 = { ...stale, run: { ...stale.run, ...staleStamp } };
  writeRun(e2.folder, e2.run);
  expect((await land(e2, repo, q)).outcome.condition).toBe("landed");
  expect(q.calls).toEqual([["stale"]]);
});

const LINES = Array.from({ length: 12 }, (_, i) => `line ${i}`);
const edit = (n: number, text: string) => LINES.map((l, i) => (i === n ? text : l)).join("\n") + "\n";

/** A run on `files`, checked on the current main, then `moved` lands on main from elsewhere. */
async function behind(name: string, files: [string, string][], moved: [string, string][]) {
  process.env.ALEPH_FACTORY_DIR = join(dir, "factory");
  repo.checks = [{ name: "tests", run: "bun run test", tests: ["**/*.test.ts"] }, { name: "types", run: "bunx tsc" }];
  const e = job(name, files);
  const run = { ...e.run, checkedBase: remote("rev-parse", "main"), checkedTip: sh(repo.path, "git", "rev-parse", `job/${name}`) };
  writeRun(e.folder, run);
  for (const [f, t] of moved) moveMain(f, t);
  const p = ports();
  const r = await land({ ...e, run }, repo, p);
  return { r, p, log: landLog(e) };
}

/** Main with a.ts, its test, an unrelated test, and a test that spawns cli.ts, which imports a.ts. */
function seedTree(): void {
  for (const [f, t] of [["a.ts", edit(-1, "")], ["a.test.ts", `import "./a.ts";\n`], ["b.ts", "export {};\n"], ["b.test.ts", `import "./b";\n`],
    ["cli.ts", `import "./a.ts";\n`], ["sub/cli.test.ts", `Bun.spawn(["bun", "cli.ts"]);\n`], ["notes.md", edit(-1, "")]] as const) moveMain(f, t);
}

test("a run behind main whose files main's new commits do not touch runs the checks without tests, and does not cover the tip", async () => {
  seedTree();
  const { r, p, log } = await behind("apart", [["b.ts", "export const b = 1;\n"]], [["a.ts", edit(1, "main")]]);
  expect(r.outcome.condition).toBe("landed");
  expect(p.only).toEqual([[{ name: "types", run: "bunx tsc" }]]);
  expect(log).toContain("checks narrowed: main's new commits share no file with the run");
  expect(existsSync(join(dir, "factory", "baseline.json"))).toBe(false);
});

test("a run behind main that shares a module with main's new commits runs only the tests that reach it", async () => {
  seedTree();
  const { r, p, log } = await behind("shared", [["a.ts", edit(1, "run")]], [["a.ts", edit(9, "main")]]);
  expect(r.outcome.condition).toBe("landed");
  expect(p.only).toEqual([[{ name: "tests", run: "bun run test './a.test.ts' './sub/cli.test.ts'", tests: ["**/*.test.ts"] }, { name: "types", run: "bunx tsc" }]]);
  expect(log).toContain("1 file changed on both sides, 2 related test files");
});

test("a run behind main that shares a file that is not a module runs every check", async () => {
  seedTree();
  const { p, log } = await behind("prose", [["notes.md", edit(1, "run")]], [["notes.md", edit(9, "main")]]);
  expect(p.only).toEqual([undefined]);
  expect(log).not.toContain("checks narrowed");
});

test("a run whose build ran only the tests its change reaches gets every check on land, also on an unchanged main", async () => {
  const e = job("part", [["part.txt", "p\n"]]);
  const run = { ...e.run, checkedBase: remote("rev-parse", "main"), checkedTip: sh(repo.path, "git", "rev-parse", "job/part"), checks: [{ name: "tests", ok: true, seconds: 1, files: 2 }] };
  writeRun(e.folder, run);
  const p = ports();
  await land({ ...e, run }, repo, p);
  expect(p.calls).toEqual([["part"]]);
  expect(p.only).toEqual([undefined]);
});

test("a commit added to the branch after its checks gets the checks on land", async () => {
  const e = job("tipped", [["tipped.txt", "t\n"]]);
  const run = { ...e.run, checkedBase: remote("rev-parse", "main"), checkedTip: "0000000" };
  writeRun(e.folder, run);
  const p = ports();
  await land({ ...e, run }, repo, p);
  expect(p.calls).toEqual([["tipped"]]);
});

const baselineJson = () => {
  const f = join(dir, "factory", "baseline.json");
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {};
};

test("a land whose checks run and pass records the pushed commit as green in baseline.json", async () => {
  process.env.ALEPH_FACTORY_DIR = join(dir, "factory");
  repo.checks = [{ name: "all", run: "true" }];
  const e = job("g1", [["g1.txt", "1\n"]]);
  expect(await land(e, repo, ports())).toMatchObject({ code: 0, outcome: { condition: "landed" } });
  expect(baselineJson()).toEqual({ demo: { repo: "demo", commit: remote("rev-parse", "main"), ok: true } });
});

test("a land with checks skipped: main unchanged since records the pushed commit as green", async () => {
  process.env.ALEPH_FACTORY_DIR = join(dir, "factory");
  const fresh = job("g2", [["g2.txt", "2\n"]]);
  const e = { ...fresh, run: { ...fresh.run, checkedBase: remote("rev-parse", "main"), checkedTip: sh(repo.path, "git", "rev-parse", "job/g2") } };
  writeRun(e.folder, e.run);
  const p = ports();
  expect((await land(e, repo, p)).outcome.condition).toBe("landed");
  expect(p.calls).toEqual([]);
  expect(landLog(e)).toContain("checks skipped: main unchanged since");
  expect(baselineJson().demo).toEqual({ repo: "demo", commit: remote("rev-parse", "main"), ok: true });
});

test("a land whose diff matches no globs of a check records no baseline", async () => {
  process.env.ALEPH_FACTORY_DIR = join(dir, "factory");
  repo.checks = [{ name: "all", run: "true" }, { name: "android", run: "true", when: ["android/**"] }];
  const e = job("g3", [["g3.txt", "3\n"]]);
  expect((await land(e, repo, ports())).outcome.condition).toBe("landed");
  expect(baselineJson()).toEqual({});
});

test("a failed land records no baseline, and a newer entry is kept", async () => {
  process.env.ALEPH_FACTORY_DIR = join(dir, "factory");
  const bad = job("g4", [["bad.txt", "x\n"]]);
  expect((await land(bad, repo, ports({ bad: () => "all failed" }))).outcome.condition).toBe("failed");
  expect(baselineJson()).toEqual({});
  moveMain();
  const newer = remote("rev-parse", "main");
  mkdirSync(join(dir, "factory"), { recursive: true });
  writeFileSync(join(dir, "factory", "baseline.json"), JSON.stringify({ demo: { repo: "demo", commit: newer, ok: false } }));
  const e = job("g5", [["g5.txt", "5\n"]]);
  // The branch is cut from main, so main moves past the entry once this land pushes: the entry is an ancestor and is replaced.
  expect((await land(e, repo, ports())).outcome.condition).toBe("landed");
  expect(baselineJson().demo).toEqual({ repo: "demo", commit: remote("rev-parse", "main"), ok: true });
});
