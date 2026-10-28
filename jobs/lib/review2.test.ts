import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Review2 } from "./ledger.ts";

let base: string, jobs: string;
const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const sh = (cwd: string, ...a: string[]) => {
  const p = Bun.spawnSync(a, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${a.join(" ")}: ${p.stderr}`);
};

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "review2-"));
  jobs = join(base, "jobs");
  const repo = join(base, "repo");
  mkdirSync(repo);
  sh(repo, "git", "init", "-q", "-b", "main");
  writeFileSync(join(repo, "a.txt"), "a\n");
  sh(repo, "git", "add", "."); sh(repo, "git", "commit", "-qm", "init");
  sh(repo, "git", "update-ref", "refs/remotes/origin/main", "HEAD");
  sh(repo, "git", "branch", "job/x");
  writeFileSync(join(base, "repos.json"), JSON.stringify({ demo: { path: repo, main: "main", checks: [{ name: "t", run: "true" }] } }));
  process.env.ALEPH_JOBS_DIR = jobs;
  process.env.ALEPH_REPOS = join(base, "repos.json");
  process.env.ALEPH_ITEMS = join(base, "items");
  // The stand-in for srt: the clean environment, as cli.test.ts has it.
  writeFileSync(join(base, "pass"), `#!/bin/bash\nshift\nexec env -i "$@"\n`, { mode: 0o755 });
  process.env.ALEPH_SANDBOX_CMD = join(base, "pass");
  process.env.ALEPH_RUNS_DIR = join(base, "runs");
  process.env.ALEPH_JOB_FOREGROUND = "1";
});
afterAll(() => {
  delete process.env.ALEPH_SANDBOX_CMD;
  rmSync(base, { recursive: true, force: true });
});

/** A held run in a job folder, with the spec. */
function held(id: string, extra: object = {}): string {
  const folder = join(jobs, id);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "spec.md"), "Goal: g\n");
  writeFileSync(join(folder, "state.json"), JSON.stringify({
    kind: "agent", job: id, name: id, repo: "demo", branch: "job/x", state: "needs-you", needs: "held", reason: "held path a.txt", told: false, started: "2026-10-27T10:00:00Z", ...extra,
  }));
  return folder;
}
const fakeClaude = (result: string) => {
  const f = join(base, `claude-${crypto.randomUUID()}`);
  writeFileSync(f, `#!/bin/bash\ncat > /dev/null\nprintf '%s\\n' '${JSON.stringify({ type: "result", is_error: false, result })}'\n`, { mode: 0o755 });
  return f;
};
const state = (folder: string) => JSON.parse(readFileSync(join(folder, "state.json"), "utf8"));
const review2 = async (folder: string) => (await import("./ledger.ts")).readReview2(folder);

describe("review2", () => {
  const cases: [string, string, Review2][] = [
    ["VERDICT: land", "land", { verdict: "land" }],
    ["Looked.\nVERDICT: back a test lost an assertion", "back", { verdict: "back", reason: "a test lost an assertion" }],
    ["VERDICT: chris keep the old name?", "chris", { verdict: "chris", reason: "keep the old name?" }],
  ];
  for (const [text, name, want] of cases) {
    test(`a ${name} verdict is written and recorded`, async () => {
      const { runReview2 } = await import("./review2.ts");
      const folder = held(`v-${name}`);
      process.env.ALEPH_REVIEW2_CMD = fakeClaude(text);
      await runReview2(folder);
      expect(readFileSync(join(folder, "review2.md"), "utf8")).toContain(text);
      expect(await review2(folder)).toEqual(want);
      expect(state(folder).review2).toBeUndefined();
      expect(state(folder)).toMatchObject({ state: "needs-you", needs: "held" });
      expect(existsSync(join(folder, "review2"))).toBe(false);
    });
  }

  test("a malformed verdict records error and leaves the run held", async () => {
    const { runReview2 } = await import("./review2.ts");
    const folder = held("bad");
    process.env.ALEPH_REVIEW2_CMD = fakeClaude("VERDICT: maybe");
    await runReview2(folder);
    expect((await review2(folder))?.verdict).toBe("error");
    expect(state(folder)).toMatchObject({ state: "needs-you", needs: "held" });
  });

  test("a held run starts one review, a second pass none", async () => {
    const { startReview2 } = await import("./review2.ts");
    process.env.ALEPH_REVIEW2_CMD = fakeClaude("VERDICT: land");
    const folder = held("once");
    expect(startReview2(folder)).toBe(true);
    expect(startReview2(folder)).toBe(false);
    for (let i = 0; i < 100 && (await review2(folder))?.verdict === "pending"; i++) await Bun.sleep(100);
    expect(await review2(folder)).toEqual({ verdict: "land" });
  });

  test("a drop that writes state.json while review2 runs loses no field", async () => {
    const { runReview2 } = await import("./review2.ts");
    const { updateRun } = await import("./ledger.ts");
    const folder = held("race");
    const slow = join(base, "claude-slow");
    writeFileSync(slow, `#!/bin/bash\ncat > /dev/null\nsleep 1\nprintf '%s\\n' '${JSON.stringify({ type: "result", is_error: false, result: "VERDICT: land" })}'\n`, { mode: 0o755 });
    process.env.ALEPH_REVIEW2_CMD = slow;
    const running = runReview2(folder);
    await Bun.sleep(300);
    updateRun(folder, { state: "dropped", reason: "dropped by Chris" });
    await running;
    expect(state(folder)).toMatchObject({ state: "dropped", reason: "dropped by Chris", needs: "held", branch: "job/x" });
    expect(await review2(folder)).toEqual({ verdict: "land" });
  });

  test("a second review2 on a folder refuses while one runs", async () => {
    const { runReview2 } = await import("./review2.ts");
    const folder = held("twice");
    const slow = join(base, "claude-slow2");
    writeFileSync(slow, `#!/bin/bash\ncat > /dev/null\nsleep 1\nprintf '%s\\n' '${JSON.stringify({ type: "result", is_error: false, result: "VERDICT: land" })}'\n`, { mode: 0o755 });
    process.env.ALEPH_REVIEW2_CMD = slow;
    const first = runReview2(folder);
    await Bun.sleep(300);
    await expect(runReview2(folder)).rejects.toThrow("already running");
    await first;
    expect(await review2(folder)).toEqual({ verdict: "land" });
  });

  test("a drop that removes the run folder does not throw from review2", async () => {
    const { runReview2 } = await import("./review2.ts");
    const folder = held("gone");
    const slow = join(base, "claude-slow3");
    writeFileSync(slow, `#!/bin/bash\ncat > /dev/null\nsleep 1\necho nothing\n`, { mode: 0o755 });
    process.env.ALEPH_REVIEW2_CMD = slow;
    const running = runReview2(folder);
    await Bun.sleep(300);
    rmSync(folder, { recursive: true, force: true });
    await running;
  });

  test("a run that is not held starts none", async () => {
    const { startReview2 } = await import("./review2.ts");
    expect(startReview2(held("passed", { state: "passed", needs: undefined }))).toBe(false);
    expect(startReview2(held("manual", { needs: "manual" }))).toBe(false);
  });
});

describe("review2 under srt", () => {
  test("the profile reads the run folder, writes review2/ and tmp/, and reaches the API and localhost", async () => {
    const { profile } = await import("./sandbox.ts");
    const { REVIEW2_SANDBOX } = await import("./review2.ts");
    const folder = held("profile");
    const s = JSON.parse(readFileSync(profile(folder, REVIEW2_SANDBOX), "utf8"));
    expect(s.network).toEqual({ allowedDomains: ["api.anthropic.com", "localhost"], allowLocalBinding: true, deniedDomains: [] });
    expect(s.filesystem.allowRead).not.toContain(folder);
    expect(s.filesystem.allowRead).toContain(join(folder, "state.json"));
    expect(s.filesystem.allowRead).not.toContain(join(folder, "review2"));
    expect(s.filesystem.allowRead).not.toContain(join(folder, "tmp"));
    expect(s.filesystem.allowRead).not.toContain(join(base));
    expect(s.filesystem.allowWrite).toEqual([join(folder, "review2"), join(folder, "tmp")]);
  });

  test("the reviewer runs with its own home and the run folder as its only read", async () => {
    const { runReview2 } = await import("./review2.ts");
    const folder = held("home");
    const seen = join(base, "seen");
    writeFileSync(join(base, "claude-home"), `#!/bin/bash\ncat > /dev/null\necho "$HOME|$PWD" > "${seen}"\necho '{"type":"result","is_error":false,"result":"VERDICT: land"}'\n`, { mode: 0o755 });
    process.env.ALEPH_REVIEW2_CMD = join(base, "claude-home");
    await runReview2(folder);
    const [home, cwd] = readFileSync(seen, "utf8").trim().split("|");
    expect(home).toBe(join(folder, "review2", "home"));
    expect(cwd).toBe(join(folder, "review2", "work"));
    expect(await review2(folder)).toEqual({ verdict: "land" });
  });
});

describe("parseVerdict", () => {
  test("takes the last VERDICT line and needs a reason for back and chris", async () => {
    const { parseVerdict } = await import("./review2.ts");
    expect(parseVerdict("VERDICT: back x\nVERDICT: land")).toEqual({ verdict: "land" });
    expect(parseVerdict("VERDICT: back")).toBeNull();
    expect(parseVerdict("nothing")).toBeNull();
  });
});
