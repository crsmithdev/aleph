// A land runs the tests its change reaches, not the full suite: a failing test elsewhere does not stop it, and a failing related test does.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, file, job, other, remote, setup, sh, state, teardown } from "./cli.helpers";

beforeAll(() => {
  setup();
  const regs = JSON.parse(readFileSync(join(base, "repos.json"), "utf8"));
  regs.rel = { path: regs.demo.path, autoland: false, checks: [{ name: "unit", run: "bun test" }] };
  writeFileSync(join(base, "repos.json"), JSON.stringify(regs));
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
    expect(state(r.json.run).condition).toBe("passed");
  }
  // Then main gets a failing test that neither run reaches, and d.test.ts, which relbad reaches, fails.
  onMain({ "rel/z.test.ts": fails, "rel/d.test.ts": `import "./d.ts";\n${fails}` });

  const ok = await aleph(["land", "relok"]);
  expect(state(ok.json.run)).toMatchObject({ condition: "landed", checks: [{ name: "unit", ok: true, files: 1 }] });
  expect(file(ok.json.run, "land.log")).toContain("unit: 1 test file\nrel/c.test.ts");
  expect(sh(base, "git", "--git-dir", remote, "rev-parse", "main")).toBe(state(ok.json.run).commit);

  const bad = await aleph(["land", "relbad"]);
  expect(state(bad.json.run)).toMatchObject({ condition: "failed", cause: "check", checkName: "unit", checks: [{ name: "unit", ok: false, files: 1 }] });
  expect(file(bad.json.run, "checks.log")).toContain("d.test.ts");
}, 120_000);
