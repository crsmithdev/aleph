// Which checks a land runs: the tests its change reaches, the repo's critical tests and the checks that are not tests; only the critical tests on an unchanged main; never a baseline.
import { getJson } from "../../../lib/db.ts";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { land } from "./landing.ts";
import { reseed } from "../../job.testkit.ts";
import { dir, job, landLog, moveMain, ports, remote, repo, sh, useLandingFixture } from "./landing.testkit.ts";

useLandingFixture();

const TESTS = { name: "tests", run: "bun run test", tests: ["**/*.test.ts"] };
const TYPES = { name: "types", run: "bunx tsc" };
const narrowed = (...files: string[]) => ({ ...TESTS, run: `bun run test ${files.map((f) => `'./${f}'`).join(" ")}` });

/** A run on `files`, checked on the current main, then `moved` lands on main from elsewhere. */
async function landed(name: string, files: [string, string][], moved: [string, string][] = []) {
  process.env.ALEPH_FACTORY_DIR = join(dir, "factory");
  repo.checks = [TESTS, TYPES];
  const e = job(name, files);
  const run = { ...e.run, checkedBase: remote("rev-parse", "main"), checkedTip: sh(repo.path, "git", "rev-parse", `job/${name}`) };
  reseed(e.id, { checkedBase: run.checkedBase, checkedTip: run.checkedTip });
  for (const [f, t] of moved) moveMain(f, t);
  const p = ports();
  const r = await land({ ...e, run }, repo, p);
  return { r, p, log: landLog(e) };
}

/** Main with a.ts, its test, an unrelated test, and a test that spawns cli.ts, which imports a.ts. */
function seedTree(): void {
  for (const [f, t] of [["a.ts", "export {};\n"], ["a.test.ts", `import "./a.ts";\n`], ["b.ts", "export {};\n"], ["b.test.ts", `import "./b";\n`],
    ["cli.ts", `import "./a.ts";\n`], ["sub/cli.test.ts", `Bun.spawn(["bun", "cli.ts"]);\n`], ["notes.md", "n\n"]] as const) moveMain(f, t);
}

test("a land runs the tests its change reaches and the checks that are not tests, and records no baseline", async () => {
  seedTree();
  const { r, p, log } = await landed("reach", [["a.ts", "export const a = 1;\n"]], [["b.ts", "export const b = 1;\n"]]);
  expect(r.outcome.state).toBe("landed");
  expect(p.only).toEqual([[narrowed("a.test.ts", "sub/cli.test.ts"), TYPES]]);
  expect(log).toContain("tests: 2 test files\na.test.ts\nsub/cli.test.ts");
  expect(getJson("state", "baseline", {})).toEqual({});
});

test("a land adds the repo's critical tests to the tests its change reaches", async () => {
  seedTree();
  repo.critical = ["b.test.ts"];
  const { p } = await landed("crit", [["a.ts", "export const a = 2;\n"]], [["b.ts", "export const b = 2;\n"]]);
  expect(p.only).toEqual([[narrowed("a.test.ts", "b.test.ts", "sub/cli.test.ts"), TYPES]]);
});

test("a land whose change no test reaches runs no test", async () => {
  seedTree();
  const { p } = await landed("lone", [["lone.ts", "export {};\n"]], [["b.ts", "export const b = 3;\n"]]);
  expect(p.only).toEqual([[TYPES]]);
});

test("a land whose change is not a module runs no test, or only the critical tests", async () => {
  seedTree();
  const { p } = await landed("prose", [["notes.md", "run\n"]], [["b.ts", "export const b = 4;\n"]]);
  expect(p.only).toEqual([[TYPES]]);
  repo.critical = ["b.test.ts"];
  const crit = await landed("prosecrit", [["notes.md", "run2\n"]], [["b.ts", "export const b = 7;\n"]]);
  expect(crit.p.only).toEqual([[narrowed("b.test.ts"), TYPES]]);
});

test("on an unchanged main a land skips the checks when the repo has no critical tests", async () => {
  seedTree();
  const { r, p, log } = await landed("same", [["a.ts", "export const a = 5;\n"]]);
  expect(r.outcome.state).toBe("landed");
  expect(p.calls).toEqual([]);
  expect(log).toContain("checks skipped: main unchanged since");
  expect(getJson("state", "baseline", {})).toEqual({});
});

test("on an unchanged main a land runs only the critical tests", async () => {
  seedTree();
  repo.critical = ["b.test.ts"];
  const { p, log } = await landed("samecrit", [["a.ts", "export const a = 6;\n"]]);
  expect(p.only).toEqual([[narrowed("b.test.ts")]]);
  expect(log).toContain("critical tests only: main unchanged since");
});

test("a commit added to the branch after its checks gets the checks on land", async () => {
  const e = job("tipped", [["tipped.txt", "t\n"]]);
  const run = { ...e.run, checkedBase: remote("rev-parse", "main"), checkedTip: "0000000" };
  reseed(e.id, { checkedBase: run.checkedBase, checkedTip: run.checkedTip });
  const p = ports();
  await land({ ...e, run }, repo, p);
  expect(p.calls).toEqual([["tipped"]]);
});

test("a land pushes to main though the repo's pre-push hook fails", async () => {
  const hook = join(repo.path, ".git", "hooks", "pre-push");
  await Bun.write(hook, "#!/bin/sh\nexit 1\n");
  sh(repo.path, "chmod", "+x", hook);
  const { r } = await landed("hooked", [["h.ts", "export {};\n"]]);
  expect(r.outcome.state).toBe("landed");
  expect(remote("rev-parse", "main")).toBe(r.outcome.commit!);
});
