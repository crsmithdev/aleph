// One file that shows each gate that stops an issue start or a land: it holds or refuses.
import { afterEach, beforeEach, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { Runner } from "./checks.ts";
import { setup, teardown } from "../transitions/factory.helpers.ts";
import { git } from "../infra/git.ts";
import type { Repo, Run } from "../records/ledger.ts";
import { branchPorts } from "../roles/unit.ts";
import { workerVerdict } from "./worker-verdict.ts";
import { fixture } from "../../../tests/git-fixture.ts";
import { putRun } from "../records/record.ts";

setDefaultTimeout(120_000);

beforeEach(setup);
afterEach(teardown);
{

}

let root = "";
let repo: Repo;
let folder = "";
const base_run = { n: 1, kind: "build", job: "j1", name: "j1", condition: "running", checks: [{ name: "test", ok: true, seconds: 1 }] } as Run;

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
  putRun(basename(join(folder)), base_run as any);
  return git(path, "rev-parse", "main").out;
}
/** A runner that passes and writes, for a `bun test` command, a JUnit report of one passed test. */
const passes: Runner = async (_repo, _sha, command) => {
  const file = command.match(/--reporter-outfile='([^']+)'/)?.[1];
  if (file) writeFileSync(file, `<testsuites><testsuite name="x.test.ts" file="x.test.ts"><testcase name="ok" file="x.test.ts" /></testsuite></testsuites>`);
  return { code: 0, output: "" };
};
const held = (base: string, review: () => Promise<{ reason: string | null }>, runner: Runner = passes) =>
  workerVerdict({ earlier: [], done: 0, rounds: 2, facts: {}, checked: {} }, { ...branchPorts(folder, base_run, repo, base, "work", { changed: [], runner, review: review as never }), checks: async () => ({ stop: null }) });
const cleanup = () => { if (root) rmSync(root, { recursive: true, force: true }); root = ""; };

test("gate failed Oracle command: the worker verdict gives condition returned with checkName oracle and no review", async () => {
  try {
    const b = landSetup();
    let reviews = 0;
    const r = await held(b, async () => { reviews++; return { reason: null }; }, async () => ({ code: 1, output: "boom" }));
    expect(r.outcome).toMatchObject({ condition: "returned", checkName: "oracle" });
    expect(reviews).toBe(0);
  } finally { cleanup(); }
});

test("gate held path: a branch that changes a path in repo.held is awaiting, and gate.ts is held path jobs/lib/gates/gate.ts", async () => {
  try {
    const b = landSetup("held/x.txt", ["held/**"]);
    const r = await held(b, async () => ({ reason: null }));
    expect(r.outcome).toMatchObject({ condition: "waiting", reason: "held path held/x.txt" });
    expect(r.outcome.ask).toMatchObject({ reason: "held-path" });
  } finally { cleanup(); }
  try {
    const b = landSetup("jobs/lib/gates/gate.ts");
    const r = await held(b, async () => ({ reason: null }));
    expect(r.outcome).toMatchObject({ condition: "waiting", reason: "held path jobs/lib/gates/gate.ts" });
  } finally { cleanup(); }
});
