// A land runs the tests its change reaches, not the full suite: a failing test elsewhere does not stop it, and a failing related test does.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, job, other, remote, section, setup, sh, state, teardown } from "./cli.testkit";
import { readRepos, writeRepos } from "../tests/projects.testkit.ts";

beforeAll(() => {
  setup();
  const regs = readRepos(join(base, "items"));
  regs.rel = { path: regs.demo.path, autoland: false, checks: [{ name: "unit", run: "bun test" }] };
  writeRepos(regs, join(base, "items"));
});
afterAll(teardown);

/** One commit of `files` on origin/main, from the other clone. */
function onMain(files: Record<string, string>): void {
  sh(other, "git", "pull", "-q", "--rebase", "origin", "main");
  for (const [f, t] of Object.entries(files)) { mkdirSync(join(other, f, ".."), { recursive: true }); writeFileSync(join(other, f), t); }
  sh(other, "git", "add", ".");
  sh(other, "git", "commit", "-qm", "main moves");
  sh(other, "git", "push", "-q", "origin", "main");
}

const passes = (mod: string) => `import { test } from "bun:test";\nimport "./${mod}";\ntest("loads", () => {});\n`;
const fails = `import { test, expect } from "bun:test";\ntest("fails", () => { expect(1).toBe(2); });\n`;

test("a land with a failing test that its change does not reach lands; one with a failing test it reaches does not", async () => {
  onMain({ "rel/c.ts": "export {};\n", "rel/c.test.ts": passes("c.ts"), "rel/d.ts": "export {};\n", "rel/d.test.ts": passes("d.ts") });
  // Both runs pass their own checks, the whole suite on their branch.
  for (const [name, f] of [["relok", "rel/c.ts"], ["relbad", "rel/d.ts"]]) {
    const r = await job(name, `commit ${f}`, {}, "rel");
    expect(state(r.json.run).state).toBe("passed");
  }
  // Then main gets a failing test that neither run reaches, and d.test.ts, which relbad reaches, fails.
  onMain({ "rel/z.test.ts": fails, "rel/d.test.ts": `import "./d.ts";\n${fails}` });

  const ok = await aleph(["land", "relok"]);
  expect(state(ok.json.run)).toMatchObject({ state: "landed", checks: [{ name: "unit", ok: true, files: 1 }] });
  expect(section(ok.json.run, "land")).toContain("unit: 1 test file\nrel/c.test.ts");
  expect(sh(base, "git", "--git-dir", remote, "rev-parse", "main")).toBe(state(ok.json.run).commit);

  const bad = await aleph(["land", "relbad"]);
  expect(state(bad.json.run)).toMatchObject({ state: "failed", cause: "check", checkName: "unit", checks: [{ name: "unit", ok: false, files: 1 }] });
  expect(section(bad.json.run, "checks")).toContain("d.test.ts");
}, 120_000);
