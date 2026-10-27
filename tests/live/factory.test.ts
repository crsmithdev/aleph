/**
 * LIVE: the factory's sandbox on this machine, criteria 11-14 of the seed
 * spec. The probe, then real runs under srt in real systemd units: one with
 * a real claude -p worker, and one whose setup outlives the time box.
 * ALEPH_LIVE=1 bun test tests/live/factory.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const live = process.env.ALEPH_LIVE === "1";
const describeLive = live ? describe : describe.skip;
const CLI = join(import.meta.dir, "../../jobs/cli.ts");
const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const runs = join(homedir(), ".aleph", "runs");

describeLive("live factory sandbox", () => {
  let base: string;
  const sh = (cwd: string, ...args: string[]) => {
    const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
    if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
    return p.stdout.toString().trim();
  };
  const env = (extra: Record<string, string> = {}): Record<string, string | undefined> => ({
    ...process.env, ...gitEnv, ALEPH_JOBS_DIR: join(base, "jobs"), ALEPH_REPOS: join(base, "repos.json"), ALEPH_FACTORY_DIR: join(base, "factory"),
    SIDETONE_TELL_URL: "https://127.0.0.1:1/tell", ALEPH_JOB_FOREGROUND: undefined, ...extra,
  });
  async function run(name: string, extra: Record<string, string> = {}): Promise<{ folder: string; state: any }> {
    const p = Bun.spawnSync(["bun", CLI, "job", "scratch", name, "--spec", join(base, "spec.md")], { cwd: base, env: env(extra), stdout: "pipe", stderr: "pipe" });
    expect(p.exitCode).toBe(0);
    const folder: string = JSON.parse(p.stdout.toString()).folder;
    const deadline = Date.now() + 400_000;
    while (!existsSync(join(folder, "exit")) && Date.now() < deadline) await Bun.sleep(2000);
    return { folder, state: JSON.parse(readFileSync(join(folder, "state.json"), "utf8")) };
  }

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), "aleph-livefactory-"));
    sh(base, "git", "init", "-q", "--bare", "-b", "main", "remote.git");
    sh(base, "git", "clone", "-q", "remote.git", "seed");
    writeFileSync(join(base, "seed", "README"), "scratch\n");
    sh(join(base, "seed"), "git", "add", ".");
    sh(join(base, "seed"), "git", "commit", "-qm", "init");
    sh(join(base, "seed"), "git", "push", "-q", "origin", "main");
    sh(base, "git", "clone", "-q", "remote.git", "repo");
    // The setup runs inside the worker's sandbox before claude; its output goes to stderr.log.
    const look = `echo "HOME: $(ls -A "$HOME" | tr '\\n' ' ')"; echo "CLAUDE: $(ls -A "$HOME/.claude" | tr '\\n' ' ')"; echo "ENV: $(env | cut -d= -f1 | sort | tr '\\n' ' ')"`;
    writeFileSync(join(base, "repos.json"), JSON.stringify({
      scratch: { path: join(base, "repo"), sandbox: true, autoland: false, setup: [look], checks: [{ name: "hello", run: "grep -q hi hello.txt" }] },
      hang: { path: join(base, "repo"), sandbox: true, autoland: false, setup: ["(setsid bash -c 'exec -a factory-live-child sleep 3000' &)", "sleep 600"], checks: [] },
    }));
    writeFileSync(join(base, "repos-aleph.json"), JSON.stringify({ aleph: { path: join(homedir(), "aleph"), sandbox: true, setup: ["bun install"], checks: [] } }));
    writeFileSync(join(base, "spec.md"), "Create hello.txt containing the word hi, and commit it with the message \"add hello\". Do nothing else.\n");
  });
  afterAll(() => rmSync(base, { recursive: true, force: true }));

  test("criterion 11: the probe finds every private place out of reach, and claude -p and bun test work", () => {
    const p = Bun.spawnSync(["bun", CLI, "sandbox", "probe"], { cwd: base, env: env({ ALEPH_REPOS: join(base, "repos-aleph.json") }), stdout: "pipe", stderr: "pipe" });
    const r = JSON.parse(p.stdout.toString());
    expect(r.failed).toEqual([]);
    expect(r.results.length).toBe(11);
    expect(p.exitCode).toBe(0);
  }, 1_300_000);

  test("criteria 12 and 14: a real worker under srt passes; its home was empty, its env clean, and the run folder is gone", async () => {
    const { folder, state } = await run("hello");
    expect(state).toMatchObject({ state: "passed", branch: "factory/hello" });
    expect(state.cost).toBeGreaterThan(0);
    const err = readFileSync(join(folder, "stderr.log"), "utf8");
    expect(err).toContain("HOME: .claude .gitconfig \n");
    expect(err).toContain("CLAUDE: settings.json \n");
    const names = err.match(/^ENV: (.*)$/m)![1].trim().split(" ");
    expect(names).toContain("CLAUDE_CODE_OAUTH_TOKEN");
    // Only what aleph sets, and srt's proxy variables.
    const ours = ["HOME", "CLAUDE_CONFIG_DIR", "TMPDIR", "PATH", "LANG", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "DISABLE_AUTOUPDATER", "CLAUDE_CODE_OAUTH_TOKEN", "PWD", "SHLVL", "_"];
    const srt = /proxy|PROXY|SANDBOX_RUNTIME|CLOUDSDK_|^GIT_CONFIG_PARAMETERS$|^GIT_SSH_COMMAND$|^JAVA_TOOL_OPTIONS$/;
    expect(names.filter((n) => !ours.includes(n) && !srt.test(n))).toEqual([]);
    expect(sh(join(base, "repo"), "git", "log", "-1", "--format=%s", "factory/hello")).toBe("add hello");
    expect(existsSync(join(runs, folder.split("/").at(-1)!))).toBe(false);
  }, 450_000);

  test("criterion 13: at the time box the run is stuck, and no process of it is left", async () => {
    const p = Bun.spawnSync(["bun", CLI, "job", "hang", "hang", "--spec", join(base, "spec.md")], { cwd: base, env: env({ ALEPH_JOB_TIMEOUT: "20" }), stdout: "pipe", stderr: "pipe" });
    const folder: string = JSON.parse(p.stdout.toString()).folder;
    const id = folder.split("/").at(-1)!;
    let seen = false;
    while (!existsSync(join(folder, "exit"))) {
      seen ||= Bun.spawnSync(["pgrep", "-f", "^factory-live-child"]).exitCode === 0;
      await Bun.sleep(1000);
    }
    expect(seen).toBe(true);
    expect(JSON.parse(readFileSync(join(folder, "state.json"), "utf8"))).toMatchObject({ state: "stuck", reason: "time box" });
    expect(Bun.spawnSync(["pgrep", "-f", "^factory-live-child"]).exitCode).toBe(1);
    expect(Bun.spawnSync(["systemctl", "--user", "is-active", `aleph-${id}`]).stdout.toString().trim()).not.toBe("active");
    expect(readdirSync(runs)).not.toContain(id);
  }, 200_000);
});
