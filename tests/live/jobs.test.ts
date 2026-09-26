/**
 * LIVE: one agent job through a real systemd-run unit and a real claude -p
 * worker, on a trivial spec in a scratch repo. It must end passed with a
 * session id (criteria 5 and 18). ALEPH_LIVE=1 bun test tests/live/jobs.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const live = process.env.ALEPH_LIVE === "1";
const describeLive = live ? describe : describe.skip;
const CLI = join(import.meta.dir, "../../jobs/cli.ts");
const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };

describeLive("live job", () => {
  let base: string;
  const sh = (cwd: string, ...args: string[]) => {
    const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
    if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
    return p.stdout.toString().trim();
  };

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), "aleph-livejob-"));
    sh(base, "git", "init", "-q", "--bare", "-b", "main", "remote.git");
    sh(base, "git", "clone", "-q", "remote.git", "seed");
    writeFileSync(join(base, "seed", ".gitignore"), ".worktrees/\n");
    sh(join(base, "seed"), "git", "add", ".");
    sh(join(base, "seed"), "git", "commit", "-qm", "init");
    sh(join(base, "seed"), "git", "push", "-q", "origin", "main");
    sh(base, "git", "clone", "-q", "remote.git", "repo");
    writeFileSync(join(base, "repos.json"), JSON.stringify({
      scratch: { path: join(base, "repo"), checks: [{ name: "hello", run: "grep -q hi hello.txt" }] },
    }));
    writeFileSync(join(base, "spec.md"), "Create hello.txt containing the word hi, and commit it with the message \"add hello\". Do nothing else.\n");
  });
  afterAll(() => rmSync(base, { recursive: true, force: true }));

  test("a real job in a systemd unit ends passed with a session id", async () => {
    const env: Record<string, string | undefined> = {
      ...process.env, ...gitEnv, ALEPH_JOBS_DIR: join(base, "jobs"), ALEPH_REPOS: join(base, "repos.json"),
      SIDETONE_TELL_URL: "https://127.0.0.1:1/tell", ALEPH_JOB_FOREGROUND: undefined,
    };
    const p = Bun.spawnSync(["bun", CLI, "job", "scratch", "hello", "--spec", join(base, "spec.md"), "--model", "sonnet"], { cwd: base, env, stdout: "pipe", stderr: "pipe" });
    expect(p.exitCode).toBe(0);
    const folder: string = JSON.parse(p.stdout.toString()).folder;
    const run = folder.split("/").at(-1);

    // The dispatcher has exited; the run lives on in its own unit.
    const pid = readFileSync(join(folder, "pid"), "utf8").trim();
    expect(readFileSync(`/proc/${pid}/cgroup`, "utf8")).toContain(`aleph-${run}.service`);

    const deadline = Date.now() + 280_000;
    while (!existsSync(join(folder, "exit")) && Date.now() < deadline) await Bun.sleep(2000);
    const state = JSON.parse(readFileSync(join(folder, "state.json"), "utf8"));
    expect(state.state).toBe("passed");
    expect(state.session).toMatch(/^[0-9a-f-]{36}$/);
    expect(readFileSync(join(folder, "output.log"), "utf8")).toContain(state.session);
    expect(sh(join(base, "repo", ".worktrees", "job-hello"), "git", "log", "-1", "--format=%s")).toBe("add hello");
  }, 300_000);
});
