import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { askOf, hasLabel, readList, writeList } from "../../todo/lib/store.ts";
import * as issues from "../../todo/lib/todo.ts";
import { accept, oracleCommands, readRecord, resultLine, sandboxRunner, unshown, type Runner } from "./acceptance.ts";
import { acceptanceStep, dispatchGoals, reacceptReopened } from "./factory.ts";

const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
function sh(cwd: string, ...args: string[]): string {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
  return p.stdout.toString().trim();
}

const KEYS = ["ALEPH_ISSUES", "ALEPH_REPOS", "ALEPH_JOBS_DIR", "ALEPH_FACTORY_DIR", "ALEPH_SANDBOX_DIR", "XDG_RUNTIME_DIR", "ALEPH_DAY_CAP", "ALEPH_LIVE_CAP", "SIDETONE_TELL_URL", "ALEPH_DISPATCH", "ALEPH_SANDBOX_CMD"];
let base: string;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-accept-"));
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  Object.assign(process.env, {
    ALEPH_ISSUES: join(base, "items"), ALEPH_REPOS: join(base, "repos.json"), ALEPH_JOBS_DIR: join(base, "jobs"), ALEPH_SANDBOX_DIR: join(base, "runs"),
    ALEPH_FACTORY_DIR: join(base, "factory"), XDG_RUNTIME_DIR: join(base, "run"), ALEPH_DAY_CAP: "100", ALEPH_LIVE_CAP: "5",
    SIDETONE_TELL_URL: "http://127.0.0.1:1/tell", ALEPH_DISPATCH: "off",
  });
  sh(base, "git", "init", "-q", "--bare", "-b", "main", join(base, "repo.git"));
  sh(base, "git", "clone", "-q", join(base, "repo.git"), join(base, "repo"));
  writeFileSync(join(base, "repo", "package.json"), JSON.stringify({ scripts: { ok: "true", bad: "echo boom; exit 3" } }));
  mkdirSync(join(base, "repo", "jobs", "lib"), { recursive: true });
  writeFileSync(join(base, "repo", "jobs", "lib", "acceptance.test.ts"), "");
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
const item = (id: number) => issues.find(readList({ key: "fac" })!, id)!;
const notes = (id: number) => item(id).notes.join("\n");

/** A goal whose land is on origin/main (a commit with the Item trailer), with the store saying done. */
function doneGoal(oracle: string): number {
  const id = writeList({ key: "fac" }, "add a goal", (doc) => issues.addLegacy(doc, "thing", { labels: ["goal"], body: `## Goal\nx\n## Edit surface\na.ts\n## Oracle\n${oracle}\n## Time box\n40 minutes` }).id, true)!.value;
  land(id);
  writeList({ key: "fac" }, "close", (doc) => { issues.setStatus(issues.find(doc, id)!, "done"); return true; });
  return id;
}
function land(id: number): void {
  sh(repoDir(), "git", "commit", "-q", "--allow-empty", "-m", `work\n\nItem: fac-${id}`);
  sh(repoDir(), "git", "push", "-q", "origin", "main");
}
const closeAgain = (id: number) => writeList({ key: "fac" }, "close", (doc) => { issues.setStatus(issues.find(doc, id)!, "done"); return true; });

const ran: string[] = [];
const runner = (code: number, output = ""): Runner => async (_repo, _sha, command) => { ran.push(command); return { code, output }; };
beforeEach(() => { ran.length = 0; });

test("only backtick commands that start like the repo's checks are runnable", () => {
  const body = "## Goal\n`bun test x`\n## Oracle\n`bun test jobs/lib/a.test.ts` and `bun run lint`, then `bunx tsc --noEmit`; also `ls -la` and `bunx prettier`.\n## Time box\n1h";
  expect(oracleCommands(body)).toEqual(["bun test jobs/lib/a.test.ts", "bun run lint", "bunx tsc --noEmit"]);
  expect(oracleCommands("## Oracle\nIt works.")).toEqual([]);
});

test("shell loops that run a check are runnable; loops that run no check are not", () => {
  const a = "for i in 1 2 3 4; do bun test jobs/cli.basic.test.ts & done; wait";
  const b = "for j in 1 2 3 4; do (for i in $(seq 5); do bun test x || exit 1; done) & done; wait";
  const c = "for i in $(seq 10); do bun test x.test.ts || exit 1; done";
  const body = `## Oracle\n\`${a}\`\n\`${b}\`\n\`${c}\`\n\`bun test y\`\n\`ls -la\` \`bunx prettier\` \`for i in 1 2; do echo hi; done\``;
  expect(oracleCommands(body)).toEqual([a, b, c, "bun test y"]);
});

test("a placeholder of more than one word is not runnable; a redirection with a space is", () => {
  const body = "## Oracle\n`bun test <that file>`\n`bun test <test file path>`\n`bun test jobs/lib/a.test.ts 2>&1`\n`bun test jobs/lib/a.test.ts <in >out`\n`bun test jobs/lib/a.test.ts > out.log`";
  expect(oracleCommands(body)).toEqual(["bun test jobs/lib/a.test.ts 2>&1", "bun test jobs/lib/a.test.ts <in >out", "bun test jobs/lib/a.test.ts > out.log"]);
});

test("a command with an angle-bracket placeholder is not runnable; a redirection is", async () => {
  const body = "## Oracle\n`bun test <file>`\n`bun test jobs/<name>.test.ts`\n`bun test jobs/lib/a.test.ts 2>&1`";
  expect(oracleCommands(body)).toEqual(["bun test jobs/lib/a.test.ts 2>&1"]);
  const id = doneGoal("`bun test <file>`");
  const lines = await acceptanceStep(runner(2, "bash: syntax error near unexpected token `<'"));
  expect(ran).toEqual([]);
  expect(readRecord("fac", id)?.result).toBe("skipped");
  expect(lines[0]).toContain("acceptance skipped");
  expect(issues.status(item(id))).toBe("done");
});

test("a run with exit 0 whose bun test summary reports failures fails; with 0 fail it passes", async () => {
  const id = doneGoal("`for i in 1 2; do bun test x & done; wait`");
  await acceptanceStep(runner(0, "bun test\n 3 pass\n 1 fail\nRan 4 tests"));
  expect(notes(id)).toContain("acceptance: fail at");
  expect(issues.status(item(id))).toBe("open");
  expect(resultLine("fac", id)).toContain("fail");
  const id2 = doneGoal("`bun test x`");
  await acceptanceStep(runner(0, "bun test\n 4 pass\n 0 fail\nRan 4 tests"));
  expect(notes(id2)).toContain("acceptance: pass at");
});

test("a done goal whose Oracle command passes gets the pass note and stays done", async () => {
  const id = doneGoal("`bun test jobs/lib/acceptance.test.ts`");
  const sha = sh(repoDir(), "git", "rev-parse", "--short=7", "origin/main");
  const lines = await acceptanceStep(runner(0));
  expect(ran).toEqual(["bun test jobs/lib/acceptance.test.ts"]);
  expect(lines).toEqual([`fac-${id}: acceptance passed at ${sha}`]);
  expect(notes(id)).toContain(`acceptance: pass at ${sha}`);
  expect(issues.status(item(id))).toBe("done");
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
  expect(issues.status(item(id))).toBe("open");
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

test("a second failure sets an Ask, names the command, and dispatches nothing", async () => {
  const id = doneGoal("`bun run bad` `bun run ok`");
  await acceptanceStep(runner(3, "boom"));
  land(id);
  closeAgain(id);
  const lines = await acceptanceStep(runner(3, "boom again"));
  expect(lines[0]).toContain("asks Chris");
  expect(hasLabel(item(id), "needs-chris")).toBe(false);
  expect(askOf(item(id))).toMatchObject({ kind: "input", reason: "acceptance-failed" });
  expect(notes(id)).toMatch(/the Oracle command `bun run bad` still fails/);
  expect(issues.status(item(id))).toBe("done");
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
  expect(issues.status(item(id))).toBe("done");
  expect(item(id).notes).toEqual([]);
  expect(readRecord("fac", id)?.result).toBe("skipped");
  expect(await acceptanceStep(runner(1))).toEqual([]);
});

test("a command that names a test file missing on main is dropped; the real file's command runs", async () => {
  const id = doneGoal("`bun test jobs/lib/a.test.ts 2>&1` `bun test jobs/lib/acceptance.test.ts`");
  const lines = await acceptanceStep(runner(0));
  expect(ran).toEqual(["bun test jobs/lib/acceptance.test.ts"]);
  expect(lines).toEqual([`fac-${id}: acceptance passed at ${sh(repoDir(), "git", "rev-parse", "--short=7", "origin/main")}`]);
  expect(readRecord("fac", id)?.result).toBe("pass");
});

test("a done goal whose only command names a missing test file is skipped and runs nothing", async () => {
  const id = doneGoal("`bun test ./jobs/lib/a.test.ts 2>&1`");
  const lines = await acceptanceStep(runner(1));
  expect(ran).toEqual([]);
  expect(lines[0]).toContain("acceptance skipped");
  expect(issues.status(item(id))).toBe("done");
  expect(readRecord("fac", id)?.result).toBe("skipped");
});

test("a goal closed with no landing on main is not accepted", async () => {
  const id = writeList({ key: "fac" }, "add", (doc) => issues.addLegacy(doc, "by hand", { labels: ["goal"], body: "## Oracle\n`bun run ok`" }).id, true)!.value;
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

const infra = (output: string): Runner => async () => ({ code: 1, output, infra: true });

test("an infra result leaves the issue done, writes no record and says acceptance not run", async () => {
  const id = doneGoal("`bun run ok`");
  const lines = await acceptanceStep(infra("the command did not start (exit 1): sandbox said hi"));
  expect(lines[0]).toContain("acceptance not run");
  expect(lines[0]).toContain("sandbox said hi");
  expect(issues.status(item(id))).toBe("done");
  expect(readRecord("fac", id)).toBeNull();
});

test("an infra result after one real failure does not label needs-chris or change the record", async () => {
  const id = doneGoal("`bun run ok`");
  await acceptanceStep(runner(1, "boom"));
  const before = readRecord("fac", id);
  expect(before?.fails).toBe(1);
  land(id);
  closeAgain(id);
  const lines = await acceptanceStep(infra("bundle failed: x"));
  expect(lines[0]).toContain("acceptance not run");
  expect(hasLabel(item(id), "needs-chris")).toBe(false);
  expect(issues.status(item(id))).toBe("done");
  expect(readRecord("fac", id)).toEqual(before);
});

test("sandboxRunner: a sandbox that ends before writing code returns its stdout.log tail", async () => {
  const fake = join(base, "fake-sandbox.sh");
  writeFileSync(fake, "#!/bin/sh\necho sandbox-said-this\nexit 7\n");
  chmodSync(fake, 0o755);
  process.env.ALEPH_SANDBOX_CMD = fake;
  const sha = sh(repoDir(), "git", "rev-parse", "origin/main");
  const repo = { key: "fac", path: repoDir(), main: "main", setup: [] } as any;
  const r = await sandboxRunner(repo, sha, "bun run ok");
  expect(r.infra).toBe(true);
  expect(r.code).toBe(7);
  expect(r.output).toContain("the command did not start");
  expect(r.output).toContain("sandbox-said-this");
});

const withSetup = (setup: string[]) => ({ key: "fac", path: repoDir(), main: "main", setup }) as any;

test("sandboxRunner: a failing setup returns infra with the setup log, and the command does not run", async () => {
  process.env.ALEPH_SANDBOX_CMD = "/usr/bin/env";
  const sha = sh(repoDir(), "git", "rev-parse", "origin/main");
  const r = await sandboxRunner(withSetup(["false"]), sha, "bun run bad");
  expect(r.infra).toBe(true);
  expect(r.output).toContain("setup failed");
  expect(r.output).not.toContain("boom");
  const known = await sandboxRunner(withSetup(["echo KNOWN-SETUP-TEXT-716; false"]), sha, "bun run ok");
  expect(known.infra).toBe(true);
  expect(known.output).toContain("setup failed");
  expect(known.output).toContain("KNOWN-SETUP-TEXT-716");
});

test("accept through sandboxRunner with a failing setup leaves the goal done, writes no record and adds no fail note", async () => {
  process.env.ALEPH_SANDBOX_CMD = "/usr/bin/env";
  const id = doneGoal("`bun run bad`");
  const line = await accept(withSetup(["false"]), item(id), sandboxRunner);
  expect(line).toContain("acceptance not run");
  expect(line).toContain("setup failed");
  expect(issues.status(item(id))).toBe("done");
  expect(readRecord("fac", id)).toBeNull();
  expect(notes(id)).not.toContain("acceptance: fail");
  expect(hasLabel(item(id), "needs-chris")).toBe(false);
});

test("sandboxRunner: a passing setup and a command that exits nonzero is not infra and keeps the exit code", async () => {
  process.env.ALEPH_SANDBOX_CMD = "/usr/bin/env";
  const sha = sh(repoDir(), "git", "rev-parse", "origin/main");
  const r = await sandboxRunner(withSetup(["true"]), sha, "bun run bad");
  expect(r.infra).toBeUndefined();
  expect(r.code).toBe(3);
  expect(r.output).toContain("boom");
});

/** A landed goal the store says is open again, after an acceptance fail. */
function reopened(oracle: string): number {
  const id = doneGoal(oracle);
  writeList({ key: "fac" }, "reopen", (doc) => { const i = issues.find(doc, id)!; issues.setStatus(i, "open"); issues.note(i, "acceptance: fail at abc1234: `bun test x` exited 128: the command did not start (exit 128)"); return true; });
  return id;
}

test("reacceptReopened closes the goal whose Oracle passes and leaves the failing one open with a note", async () => {
  const good = reopened("`bun test good`");
  const bad = reopened("`bun test bad`");
  const lines = await reacceptReopened("fac", { run: async (_r, _s, c) => (c.includes("bad") ? { code: 1, output: "boom" } : { code: 0, output: "" }) });
  expect(lines.length).toBe(2);
  expect(issues.status(item(good))).toBe("done");
  expect(notes(good)).toContain("`bun test good` exited 0");
  expect(issues.status(item(bad))).toBe("open");
  expect(notes(bad)).toContain("re-accept: fail");
  expect(notes(bad)).toContain("`bun test bad` exited 1: boom");
  // a second pass does not run the failed goal again
  expect(await reacceptReopened("fac", { run: runner(0) })).toEqual([]);
});

test("reacceptReopened leaves the goal open after an infra error, notes the tail, and retries next time", async () => {
  const id = reopened("`bun test x`");
  await reacceptReopened("fac", { run: async () => ({ code: 1, output: "bundle failed: nope", infra: true }) });
  expect(issues.status(item(id))).toBe("open");
  expect(notes(id)).toContain("re-accept: not run");
  expect(notes(id)).toContain("bundle failed: nope");
  await reacceptReopened("fac", { run: runner(0) });
  expect(issues.status(item(id))).toBe("done");
});

test("reacceptReopened skips goals not landed, not reopened by acceptance, or outside the window", async () => {
  const unlanded = writeList({ key: "fac" }, "add", (doc) => { const i = issues.addLegacy(doc, "t", { labels: ["goal"], body: "## Oracle\n`bun test x`" }); issues.note(i, "acceptance: fail at abc1234: x"); return i.id; }, true)!.value;
  const plain = writeList({ key: "fac" }, "add", (doc) => issues.addLegacy(doc, "t", { labels: ["goal"], body: "## Oracle\n`bun test x`" }).id)!.value;
  land(plain);
  const old = reopened("`bun test x`");
  expect(await reacceptReopened("fac", { run: runner(0), since: "2999-01-01T00:00" })).toEqual([]);
  expect(await reacceptReopened("fac", { run: runner(0), before: "2000-01-01T00:00" })).toEqual([]);
  expect(ran).toEqual([]);
  const lines = await reacceptReopened("fac", { run: runner(0) });
  expect(lines.length).toBe(1);
  expect(issues.status(item(old))).toBe("done");
  expect(issues.status(item(unlanded))).toBe("open");
  expect(issues.status(item(plain))).toBe("open");
});
