import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasLabel, readList, writeList } from "../../todo/lib/store.ts";
import * as todos from "../../todo/lib/todo.ts";
import { oracleCommands, readRecord, resultLine, sandboxRunner, unshown, type Runner } from "./acceptance.ts";
import { acceptanceStep, dispatchGoals } from "./factory.ts";

const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
function sh(cwd: string, ...args: string[]): string {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
  return p.stdout.toString().trim();
}

const KEYS = ["ALEPH_ITEMS", "ALEPH_REPOS", "ALEPH_JOBS_DIR", "ALEPH_FACTORY_DIR", "ALEPH_RUNS_DIR", "XDG_RUNTIME_DIR", "ALEPH_DAY_CAP", "ALEPH_LIVE_CAP", "SIDETONE_TELL_URL", "ALEPH_DISPATCH", "ALEPH_SANDBOX_CMD"];
let base: string;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-accept-"));
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  Object.assign(process.env, {
    ALEPH_ITEMS: join(base, "items"), ALEPH_REPOS: join(base, "repos.json"), ALEPH_JOBS_DIR: join(base, "jobs"), ALEPH_RUNS_DIR: join(base, "runs"),
    ALEPH_FACTORY_DIR: join(base, "factory"), XDG_RUNTIME_DIR: join(base, "run"), ALEPH_DAY_CAP: "100", ALEPH_LIVE_CAP: "5",
    SIDETONE_TELL_URL: "http://127.0.0.1:1/tell", ALEPH_DISPATCH: "off",
  });
  sh(base, "git", "init", "-q", "--bare", "-b", "main", join(base, "repo.git"));
  sh(base, "git", "clone", "-q", join(base, "repo.git"), join(base, "repo"));
  writeFileSync(join(base, "repo", "package.json"), JSON.stringify({ scripts: { ok: "true", bad: "echo boom; exit 3" } }));
  sh(join(base, "repo"), "git", "add", ".");
  sh(join(base, "repo"), "git", "commit", "-q", "-m", "init");
  sh(join(base, "repo"), "git", "push", "-q", "origin", "main");
  sh(base, "git", "init", "-q", "--bare", "-b", "main", join(base, "items.git"));
  sh(base, "git", "clone", "-q", join(base, "items.git"), join(base, "items"));
  sh(join(base, "items"), "git", "commit", "-q", "--allow-empty", "-m", "start");
  sh(join(base, "items"), "git", "push", "-q", "origin", "main");
  writeFileSync(join(base, "repos.json"), JSON.stringify({ fac: { path: join(base, "repo"), sandbox: true, autoland: false } }));
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(base, { recursive: true, force: true });
});

const repoDir = () => join(base, "repo");
const item = (id: number) => todos.find(readList({ key: "fac" })!, id)!;
const notes = (id: number) => item(id).notes.join("\n");

/** A goal whose land is on origin/main (a commit with the Item trailer), with the store saying done. */
function doneGoal(oracle: string): number {
  const id = writeList({ key: "fac" }, "add a goal", (doc) => todos.add(doc, "thing", { labels: ["goal"], body: `## Goal\nx\n## Edit surface\na.ts\n## Oracle\n${oracle}\n## Time box\n40 minutes` }).id, true)!.value;
  land(id);
  writeList({ key: "fac" }, "close", (doc) => { todos.setStatus(todos.find(doc, id)!, "done"); return true; });
  return id;
}
function land(id: number): void {
  sh(repoDir(), "git", "commit", "-q", "--allow-empty", "-m", `work\n\nItem: fac-${id}`);
  sh(repoDir(), "git", "push", "-q", "origin", "main");
}
const closeAgain = (id: number) => writeList({ key: "fac" }, "close", (doc) => { todos.setStatus(todos.find(doc, id)!, "done"); return true; });

const ran: string[] = [];
const runner = (code: number, output = ""): Runner => async (_repo, _sha, command) => { ran.push(command); return { code, output }; };
beforeEach(() => { ran.length = 0; });

test("only backtick commands that start like the repo's checks are runnable", () => {
  const body = "## Goal\n`bun test x`\n## Oracle\n`bun test jobs/lib/a.test.ts` and `bun run lint`, then `bunx tsc --noEmit`; also `ls -la` and `bunx prettier`.\n## Time box\n1h";
  expect(oracleCommands(body)).toEqual(["bun test jobs/lib/a.test.ts", "bun run lint", "bunx tsc --noEmit"]);
  expect(oracleCommands("## Oracle\nIt works.")).toEqual([]);
});

test("a done goal whose Oracle command passes gets the pass note and stays done", async () => {
  const id = doneGoal("`bun test jobs/lib/a.test.ts`");
  const sha = sh(repoDir(), "git", "rev-parse", "--short=7", "origin/main");
  const lines = await acceptanceStep(runner(0));
  expect(ran).toEqual(["bun test jobs/lib/a.test.ts"]);
  expect(lines).toEqual([`fac-${id}: acceptance passed at ${sha}`]);
  expect(notes(id)).toContain(`acceptance: pass at ${sha}`);
  expect(todos.status(item(id))).toBe("done");
  expect(resultLine("fac", id)).toBe(`acceptance: pass at ${sha}`);
  expect(unshown()).toEqual([`fac-${id} acceptance: pass at ${sha}`]);
  expect(unshown()).toEqual([]);
  // Once: a second step runs nothing.
  await acceptanceStep(runner(0));
  expect(ran.length).toBe(1);
});

test("a failing command reopens the goal with the last 40 lines and it is dispatched once", async () => {
  const id = doneGoal("`bun run bad`");
  const output = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join("\n");
  await acceptanceStep(runner(3, output));
  expect(todos.status(item(id))).toBe("open");
  expect(notes(id)).toContain("acceptance: fail at");
  expect(notes(id)).toContain("`bun run bad` exited 3");
  expect(notes(id)).toContain("line 60");
  expect(notes(id)).toContain("line 21");
  expect(notes(id)).not.toContain("line 20 ");
  expect(notes(id)).not.toContain("line 1 ");
  const specs: string[] = [];
  const out = await dispatchGoals(async (_r, _name, _id, spec) => { specs.push(spec); return null; }, async () => null);
  expect(out.started).toEqual([`fac-${id}`]);
  expect(specs).toHaveLength(1);
  expect(specs[0]).toContain("acceptance: fail at");
  expect(specs[0]).toContain("line 60");
  expect(hasLabel(item(id), "needs-chris")).toBe(false);
  // The goal is not done again until a later commit names it.
  expect(await acceptanceStep(runner(0))).toEqual([]);
});

test("a second failure labels it needs-chris, names the command, and dispatches nothing", async () => {
  const id = doneGoal("`bun run bad` `bun run ok`");
  await acceptanceStep(runner(3, "boom"));
  land(id);
  closeAgain(id);
  const lines = await acceptanceStep(runner(3, "boom again"));
  expect(lines[0]).toContain("needs-chris");
  expect(hasLabel(item(id), "needs-chris")).toBe(true);
  expect(notes(id)).toMatch(/needs-chris: the Oracle command `bun run bad` still fails/);
  expect(todos.status(item(id))).toBe("done");
  expect(readRecord("fac", id)?.fails).toBe(2);
  const started: string[] = [];
  const out = await dispatchGoals(async (_r, name) => { started.push(name); return null; }, async () => null);
  expect(out.started).toEqual([]);
  expect(started).toEqual([]);
  expect(await acceptanceStep(runner(3))).toEqual([]);
  expect(resultLine("fac", id)).toBe("acceptance: fail twice: bun run bad");
});

test("a rerun that passes the Oracle ends with the pass note", async () => {
  const id = doneGoal("`bun run ok`");
  await acceptanceStep(runner(1, "x"));
  land(id);
  closeAgain(id);
  await acceptanceStep(runner(0));
  expect(notes(id)).toContain("acceptance: pass at");
  expect(readRecord("fac", id)?.result).toBe("pass");
});

test("an Oracle with no runnable command is skipped and the goal stays done", async () => {
  const id = doneGoal("Open the page and look. `ls -la`");
  const lines = await acceptanceStep(runner(1));
  expect(ran).toEqual([]);
  expect(lines[0]).toContain("acceptance skipped");
  expect(todos.status(item(id))).toBe("done");
  expect(item(id).notes).toEqual([]);
  expect(readRecord("fac", id)?.result).toBe("skipped");
  expect(await acceptanceStep(runner(1))).toEqual([]);
});

test("a goal closed with no landing on main is not accepted", async () => {
  const id = writeList({ key: "fac" }, "add", (doc) => todos.add(doc, "by hand", { labels: ["goal"], body: "## Oracle\n`bun run ok`" }).id, true)!.value;
  closeAgain(id);
  expect(await acceptanceStep(runner(0))).toEqual([]);
});

test("the default runner runs the command on origin/main in a clone", async () => {
  process.env.ALEPH_SANDBOX_CMD = "/usr/bin/env";
  const sha = sh(repoDir(), "git", "rev-parse", "origin/main");
  const repo = { key: "fac", path: repoDir(), main: "main", setup: [] } as any;
  expect(await sandboxRunner(repo, sha, "bun run ok")).toEqual({ code: 0, output: expect.any(String) });
  const bad = await sandboxRunner(repo, sha, "bun run bad");
  expect(bad.code).toBe(3);
  expect(bad.output).toContain("boom");
});

test("sandboxRunner: two runs for one repo at the same time do not remove each other's folder", async () => {
  process.env.ALEPH_SANDBOX_CMD = "/usr/bin/env";
  const sha = sh(repoDir(), "git", "rev-parse", "origin/main");
  const repo = { key: "fac", path: repoDir(), main: "main", setup: [] } as any;
  const [a, b] = await Promise.all([sandboxRunner(repo, sha, "bun run ok"), sandboxRunner(repo, sha, "bun run bad")]);
  expect(a.output).not.toContain("bundle failed");
  expect(b.output).not.toContain("bundle failed");
  expect(a.code).toBe(0);
  expect(b.code).toBe(3);
});
