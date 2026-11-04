// One file that shows each gate that stops a goal start or a land: it holds or refuses.
import { afterEach, beforeEach, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Runner } from "./checks.ts";
import { setup, teardown } from "./factory.helpers.ts";
import { git } from "./git.ts";
import type { Repo, Run } from "./ledger.ts";
import { branchPorts } from "./unit.ts";
import { workerVerdict } from "./worker-verdict.ts";
import { fixture } from "../../tests/git-fixture.ts";

setDefaultTimeout(120_000);

// ---- Dispatch gates: the start port is not called for the goal, and a hold record says why.
beforeEach(setup);
afterEach(teardown);
{

}

// ---- Land gates.
let root = "";
let repo: Repo;
let folder = "";
const base_run = { kind: "build", job: "j1", name: "j1", condition: "running", checks: [{ name: "test", ok: true, seconds: 1 }] } as Run;

/** A repo with main, and a branch `work` that changes `file` (default a.txt). */
function landSetup(file = "a.txt", held: string[] = []): string {
  root = mkdtempSync(join(tmpdir(), "every-gate-"));
  const path = join(root, "repo");
  fixture(`every-gate-${file.replaceAll("/", "_")}`, (path) => {
    git(path, "init", "-q", "-b", "main");
    git(path, "config", "user.email", "a@b.c");
    git(path, "config", "user.name", "a");
    writeFileSync(join(path, "a.txt"), "1");
    git(path, "add", "."); git(path, "commit", "-qm", "one");
    git(path, "switch", "-q", "-c", "work");
    mkdirSync(join(path, file, ".."), { recursive: true });
    writeFileSync(join(path, file), "2");
    git(path, "add", "."); git(path, "commit", "-qm", "two");
    git(path, "switch", "-q", "main");
  }, path);
  repo = { key: "r", path, main: "main", setup: [], checks: [{ name: "test", run: "bun run test" }], manual: [], autoland: true, sandbox: true, held } as unknown as Repo;
  mkdirSync(join(root, "j1"));
  folder = join(root, "j1-run");
  mkdirSync(folder);
  writeFileSync(join(root, "j1", "spec.md"), "## Oracle\n- `bun run test` passes.\n- `bun test x.test.ts` passes.\n");
  writeFileSync(join(folder, "state.json"), JSON.stringify(base_run));
  return git(path, "rev-parse", "main").out;
}
const held = (base: string, review: () => Promise<{ reason: string | null }>, runner: Runner = async () => ({ code: 0, output: "" })) =>
  workerVerdict({ earlier: [], rounds: 2, facts: {}, checked: {} }, { ...branchPorts(folder, base_run, repo, base, "work", { changed: [], runner, review: review as never }), checks: async () => ({ stop: null }) });
const cleanup = () => { if (root) rmSync(root, { recursive: true, force: true }); root = ""; };

test("gate failed Oracle command: the worker verdict gives condition stuck with checkName oracle and no review", async () => {
  try {
    const b = landSetup();
    let reviews = 0;
    const r = await held(b, async () => { reviews++; return { reason: null }; }, async () => ({ code: 1, output: "boom" }));
    expect(r.outcome).toMatchObject({ condition: "stuck", checkName: "oracle" });
    expect(reviews).toBe(0);
  } finally { cleanup(); }
});

test("gate held path: a branch that changes a path in repo.held is awaiting, and gate.ts is held path jobs/lib/gate.ts", async () => {
  try {
    const b = landSetup("held/x.txt", ["held/**"]);
    const r = await held(b, async () => ({ reason: null }));
    expect(r.outcome).toMatchObject({ condition: "awaiting", reason: "held path held/x.txt" });
    expect(r.outcome.ask).toMatchObject({ reason: "held-path" });
  } finally { cleanup(); }
  try {
    const b = landSetup("jobs/lib/gate.ts");
    const r = await held(b, async () => ({ reason: null }));
    expect(r.outcome).toMatchObject({ condition: "awaiting", reason: "held path jobs/lib/gate.ts" });
  } finally { cleanup(); }
});
