import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Runner } from "./checks.ts";
import { git } from "./git.ts";
import type { Repo, Run } from "./ledger.ts";
import { branchPorts } from "./unit.ts";
import { workerVerdict } from "./worker-verdict.ts";
import { fixture } from "../../tests/git-fixture.ts";

let root = "";
let repo: Repo;
let folder = "";
const run = { kind: "build", job: "j1", name: "j1", condition: "running", checks: [{ name: "test", ok: true, seconds: 1 }] } as Run;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "unit-oracle-"));
  const path = join(root, "repo");
  fixture("unit-oracle", (path) => {
    git(path, "init", "-q", "-b", "main");
    git(path, "config", "user.email", "a@b.c");
    git(path, "config", "user.name", "a");
    writeFileSync(join(path, "a.txt"), "1");
    git(path, "add", "."); git(path, "commit", "-qm", "one");
    git(path, "branch", "work");
    git(path, "switch", "-q", "work");
    writeFileSync(join(path, "a.txt"), "2");
    git(path, "commit", "-qam", "two");
    git(path, "switch", "-q", "main");
  }, path);
  repo = { key: "r", path, main: "main", setup: [], checks: [{ name: "test", run: "bun run test" }], manual: [], autoland: true, sandbox: true, held: [] } as unknown as Repo;
  mkdirSync(join(root, "j1"));
  folder = join(root, "j1-run");
  mkdirSync(folder);
  writeFileSync(join(root, "j1", "spec.md"), "## Oracle\n- `bun run test` passes.\n- `bun test x.test.ts` passes.\n");
  writeFileSync(join(folder, "state.json"), JSON.stringify(run));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const go = (runner: Runner, earlier: Run[] | undefined = []) => {
  let reviews = 0;
  const review = async () => { reviews++; return { reason: null }; };
  const base = git(repo.path, "rev-parse", "main").out;
  const ports = { ...branchPorts("j1-run", folder, run, repo, root, base, "work", { changed: [], runner, review }), checks: async () => ({ stop: null }) };
  return workerVerdict({ earlier, rounds: 2, facts: {}, checked: {} }, ports).then((r) => ({ ...r, reviews }));
};

test("an Oracle command that fails twice is a fix round failed oracle, with no reviewer", async () => {
  const seen: string[] = [];
  const r = await go(async (_r, _s, c) => { seen.push(c); return { code: 1, output: "boom" }; });
  expect(seen).toEqual(["bun test x.test.ts", "bun test x.test.ts"]);
  expect(r.reviews).toBe(0);
  expect(r.code).toBe(1);
  expect(r.outcome).toMatchObject({ condition: "stuck", cause: "check", checkName: "oracle", failed: "oracle", round: 0 });
  expect(readFileSync(join(folder, "checks.log"), "utf8")).toContain("## oracle: exit 1 (second run)");
});

test("a command that fails once and then passes reaches the reviewer", async () => {
  let n = 0;
  const r = await go(async () => ({ code: n++ === 0 ? 1 : 0, output: "" }));
  expect(n).toBe(2);
  expect(r.reviews).toBe(1);
  expect(r.outcome.condition).toBe("passed");
});

test("a goal with no Oracle command, or only commands the checks ran, goes straight to the reviewer", async () => {
  writeFileSync(join(root, "j1", "spec.md"), "## Oracle\n- `bun run test` passes.\n");
  let n = 0;
  const r = await go(async () => { n++; return { code: 1, output: "" }; });
  expect(n).toBe(0);
  expect(r.reviews).toBe(1);
});
