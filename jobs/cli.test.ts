import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "cli.ts");
let base: string, remote: string, repo: string, other: string, jobsDir: string, fake: string, fakeLog: string, setupLog: string;
let server: ReturnType<typeof Bun.serve>;
const told: string[] = [];

const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
function sh(cwd: string, ...args: string[]): string {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
  return p.stdout.toString().trim();
}

function env(extra: Record<string, string> = {}): Record<string, string> {
  return {
    ...(process.env as Record<string, string>), ...gitEnv,
    ALEPH_JOBS_DIR: jobsDir, ALEPH_REPOS: join(base, "repos.json"), ALEPH_JOB_FOREGROUND: "1",
    ALEPH_WORKER_CMD: fake, XDG_RUNTIME_DIR: join(base, "run"), FAKE_LOG: fakeLog, SETUP_LOG: setupLog,
    SIDETONE_TELL_URL: `https://127.0.0.1:${server.port}/tell`, ...extra,
  };
}
async function aleph(args: string[], extra: Record<string, string> = {}, stdin?: string) {
  const p = Bun.spawn(["bun", CLI, ...args], { cwd: base, env: env(extra), stdin: stdin === undefined ? "ignore" : new Blob([stdin]), stdout: "pipe", stderr: "pipe" });
  const code = await p.exited;
  const stdout = await new Response(p.stdout).text();
  let json: any = null;
  try { json = JSON.parse(stdout); } catch {}
  return { code, stdout, stderr: await new Response(p.stderr).text(), json };
}
function specFile(text: string): string {
  const f = join(base, `spec-${crypto.randomUUID()}.md`);
  writeFileSync(f, text);
  return f;
}
const job = (name: string, action: string, extra: Record<string, string> = {}, repoKey = "demo") =>
  aleph(["job", repoKey, name, "--spec", specFile(`Goal: ${name}\nACTION: ${action}\n`)], extra);
const state = (run: string) => JSON.parse(readFileSync(join(jobsDir, run, "state.json"), "utf8"));
const file = (run: string, f: string) => readFileSync(join(jobsDir, run, f), "utf8");
const worktree = (name: string) => join(repo, ".worktrees", `job-${name}`);
const branchExists = (name: string) => Bun.spawnSync(["git", "-C", repo, "rev-parse", "--verify", "-q", `job/${name}`]).exitCode === 0;

const FAKE = `#!/bin/bash
prompt=$(cat)
printf '%s' "$prompt" > "$FAKE_LOG/prompt"
echo "$@" > "$FAKE_LOG/args"
env > "$FAKE_LOG/env"
action=$(printf '%s\\n' "$prompt" | grep '^ACTION:' | tail -1 | cut -d' ' -f2-)
case $action in
  commit\\ *) f=\${action#commit }; mkdir -p "$(dirname "$f")"; echo "$RANDOM" > "$f"; git add "$f"; git commit -qm "add $f" ;;
  commit-fixed\\ *) f=\${action#commit-fixed }; echo same > "$f"; git add "$f"; git commit -qm "add $f" ;;
  untracked) echo x > stray.txt ;;
  sleep) sleep 60 ;;
  exit3) exit 3 ;;
  question) echo '{"type":"result","result":"I looked.\\nQUESTION: which colour?"}'; exit 0 ;;
  push)
    GIT_SSH_COMMAND="$FAKE_LOG/ssh" git push git@github.com:x/y.git HEAD > /dev/null 2>&1; echo $? > "$FAKE_LOG/push.code"
    gh auth status > /dev/null 2>&1; echo $? > "$FAKE_LOG/gh.code" ;;
esac
echo '{"type":"assistant","message":{"content":[{"type":"text","text":"working"}]}}'
echo '{"type":"result","result":"did '"$action"'"}'
`;

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-jobs-"));
  for (const d of ["run", "fake", "jobs"]) mkdirSync(join(base, d));
  jobsDir = join(base, "jobs");
  fakeLog = join(base, "fake");
  setupLog = join(base, "setup.log");
  fake = join(base, "fake-worker");
  writeFileSync(fake, FAKE, { mode: 0o755 });
  writeFileSync(join(fakeLog, "ssh"), `#!/bin/sh\necho "$@" > "${join(base, "fake", "ssh.args")}"\nexit 1\n`, { mode: 0o755 });

  remote = join(base, "remote.git");
  sh(base, "git", "init", "-q", "--bare", "-b", "main", remote);
  const seed = join(base, "seed");
  sh(base, "git", "clone", "-q", remote, seed);
  writeFileSync(join(seed, ".gitignore"), ".worktrees/\n");
  writeFileSync(join(seed, "README"), "demo\n");
  sh(seed, "git", "add", "."); sh(seed, "git", "commit", "-qm", "init"); sh(seed, "git", "push", "-q", "origin", "main");
  repo = join(base, "repo");
  other = join(base, "other");
  sh(base, "git", "clone", "-q", remote, repo);
  sh(base, "git", "clone", "-q", remote, other);

  const checks = [
    { name: "tests", run: "test ! -f FAIL" },
    { name: "no job variables", run: 'test -z "$ALEPH_JOB_ID$ALEPH_JOB_RUN"' },
    { name: "android build", run: `echo built >> ${join(base, "android.log")}`, when: ["android/**"] },
    { name: "slow", run: "sleep 60", when: ["slow/**"] },
    // Pushes to the remote from another clone once, so the land's own push loses the race.
    { name: "race", run: `if [ -f ${join(base, "race-once")} ]; then rm ${join(base, "race-once")}; cd ${join(base, "other")} && git pull -q --rebase origin main && echo $RANDOM > raced && git add raced && git commit -qm race && git push -q origin main; fi`, when: ["race/**"] },
  ];
  writeFileSync(join(base, "repos.json"), JSON.stringify({
    demo: { path: repo, setup: [`echo ran >> "$SETUP_LOG"`], checks, manual: [{ when: ["android/**"], say: "run it on the phone" }] },
    other: { path: other, checks: [] },
  }));

  sh(base, "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "key.pem", "-out", "cert.pem", "-days", "1", "-subj", "/CN=tailnet");
  server = Bun.serve({
    port: 0,
    tls: { cert: readFileSync(join(base, "cert.pem"), "utf8"), key: readFileSync(join(base, "key.pem"), "utf8") },
    async fetch(req) {
      told.push((await req.json()).text);
      return new Response("ok");
    },
  });
});
afterAll(() => {
  server.stop(true);
  rmSync(base, { recursive: true, force: true });
});

describe("job", () => {
  test("refuses an unknown repo, prints the keys, creates nothing", async () => {
    const r = await aleph(["job", "nowhere", "alpha", "--spec", specFile("x")]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("demo, other");
    expect(readdirSync(jobsDir)).toEqual([]);
  });

  test("a worker that commits ends passed, with setup, checks, result and news", async () => {
    const r = await aleph(["job", "De mo", "alpha", "--spec", "-"], {}, "Goal: alpha\nACTION: commit a.txt\n");
    expect(r.code).toBe(0);
    const s = state(r.json.run);
    expect(s).toMatchObject({ kind: "agent", name: "alpha", repo: "demo", state: "passed", told: true, branch: "job/alpha", worktree: worktree("alpha") });
    expect(s.session).toMatch(/^[0-9a-f-]{36}$/);
    expect(s.phase).toBeUndefined();
    expect(file(r.json.run, "exit")).toBe("0");
    expect(file(r.json.run, "result.md")).toBe("did commit a.txt");
    expect(file(r.json.run, "checks.log")).toContain("## tests: exit 0");
    expect(file(r.json.run, "checks.log")).not.toContain("android");
    expect(readFileSync(setupLog, "utf8")).toBe("ran\n");
    expect(told).toContain("demo/alpha passed");
    const args = readFileSync(join(fakeLog, "args"), "utf8");
    expect(args).toContain(`--session-id ${s.session}`);
    expect(args).toContain("--output-format stream-json --verbose");
    const workerEnv = readFileSync(join(fakeLog, "env"), "utf8");
    expect(workerEnv).toContain(`ALEPH_JOB_ID=${r.json.run}`);
    expect(workerEnv).not.toMatch(/^(CLAUDECODE|ANTHROPIC_API_KEY)=/m);
  });

  test("a follow-up runs in the same worktree with the spec, notes and previous result", async () => {
    const r = await job("alpha", "commit b.txt");
    expect(r.code).toBe(0);
    const first = readdirSync(jobsDir).sort().find((d) => d.endsWith("-demo-alpha-agent"))!;
    expect(r.json.job).toBe(first);
    expect(r.json.run).not.toBe(first);
    expect(state(r.json.run).state).toBe("passed");
    expect(existsSync(join(jobsDir, first, "notes", "001.md"))).toBe(true);
    const prompt = readFileSync(join(fakeLog, "prompt"), "utf8");
    expect(prompt).toContain("You are a worker on job `alpha`");
    expect(prompt).toContain("## Spec\n\nGoal: alpha\nACTION: commit a.txt");
    expect(prompt).toContain("## Note 001\n\nGoal: alpha\nACTION: commit b.txt");
    expect(prompt).toContain("## Previous run: agent, passed");
    expect(prompt).toContain("did commit a.txt");
    expect(readFileSync(setupLog, "utf8")).toBe("ran\n");
    expect(sh(worktree("alpha"), "git", "log", "--format=%s")).toBe("add b.txt\nadd a.txt\ninit");
  });

  test("jobs lists open jobs; jobs <name> adds the result", async () => {
    const list = await aleph(["jobs"]);
    const alpha = list.json.find((j: any) => j.name === "alpha");
    expect(alpha).toMatchObject({ repo: "demo", goal: "Goal: alpha", state: "passed" });
    const one = await aleph(["jobs", "alpha"]);
    expect(one.json.result).toBe("did commit b.txt");
    expect(one.json.checks).toContain("## tests: exit 0");
  });

  test("a name open in another repo is refused, naming that repo", async () => {
    const r = await job("alpha", "commit c.txt", {}, "other");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("alpha is open in demo");
  });

  test("drop removes the worktree and branch and ends the job", async () => {
    const r = await aleph(["drop", "alpha", "not", "needed"]);
    expect(r.code).toBe(0);
    expect(r.json).toMatchObject({ state: "dropped", reason: "not needed" });
    expect(existsSync(worktree("alpha"))).toBe(false);
    expect(branchExists("alpha")).toBe(false);
    expect((await aleph(["jobs"])).json.find((j: any) => j.name === "alpha")).toBeUndefined();
    expect((await aleph(["drop", "alpha"])).code).toBe(1);
  });

  test("a new job with an ended job's name starts fresh, clearing a leftover branch", async () => {
    sh(repo, "git", "branch", "job/alpha", "origin/main");
    const r = await job("alpha", "commit d.txt");
    expect(r.json.job).toBe(r.json.run);
    expect(state(r.json.run).state).toBe("passed");
    expect(sh(worktree("alpha"), "git", "log", "--format=%s")).toBe("add d.txt\ninit");
    await aleph(["drop", "alpha"]);
  });
});

describe("the state rule", () => {
  test("a non-zero exit fails", async () => {
    const r = await job("exits", "exit3");
    expect(state(r.json.run)).toMatchObject({ state: "failed", reason: "worker exited 3" });
    expect(told).toContain("demo/exits failed");
  });

  test("a question needs Chris", async () => {
    const r = await job("asks", "question");
    expect(state(r.json.run)).toMatchObject({ state: "needs-you", needs: "question", question: "which colour?" });
    expect(told).toContain("demo/asks needs-you question");
  });

  test("an untracked file fails", async () => {
    const r = await job("messy", "untracked");
    expect(state(r.json.run)).toMatchObject({ state: "failed", reason: "uncommitted: stray.txt" });
  });

  test("no commits is done, and the worktree goes", async () => {
    const r = await job("idle", "none");
    expect(state(r.json.run)).toMatchObject({ state: "done" });
    expect(existsSync(worktree("idle"))).toBe(false);
    expect(branchExists("idle")).toBe(false);
  });

  test("a failing check fails, with its name in the news", async () => {
    const r = await job("broken", "commit FAIL");
    expect(state(r.json.run)).toMatchObject({ state: "failed", reason: "tests failed" });
    expect(told).toContain("demo/broken failed tests");
    expect(file(r.json.run, "checks.log")).toContain("## tests: exit 1");
  });

  test("a change under a manual glob runs its checks and waits for Chris", async () => {
    const r = await job("phone", "commit android/app.txt");
    expect(state(r.json.run)).toMatchObject({ state: "needs-you", needs: "manual", say: "run it on the phone" });
    expect(readFileSync(join(base, "android.log"), "utf8")).toBe("built\n");
  });

  test("a worker past its limit is stopped and fails as timed out", async () => {
    const start = Date.now();
    const r = await job("stuck", "sleep", { ALEPH_JOB_TIMEOUT: "1" });
    // The fake worker sleeps 60s, so anything well under that proves the limit
    // cut it short. The bound was 10s and flaked under load: the assertion is
    // that the sleep did not run, not that the machine was idle.
    expect(Date.now() - start).toBeLessThan(30_000);
    expect(state(r.json.run)).toMatchObject({ state: "failed", reason: "timed out: worker" });
  });

  test("a check past its limit is stopped and fails as timed out", async () => {
    const r = await job("slowcheck", "commit slow/x.txt", { ALEPH_CHECK_TIMEOUT: "1" });
    expect(state(r.json.run)).toMatchObject({ state: "failed", reason: "timed out: check slow" });
  });
});

describe("guards", () => {
  test("a worker's push goes to aleph-no-push and gh has no credentials", async () => {
    await job("pusher", "push");
    expect(readFileSync(join(fakeLog, "push.code"), "utf8").trim()).not.toBe("0");
    expect(readFileSync(join(fakeLog, "ssh.args"), "utf8")).toContain("aleph-no-push");
    expect(readFileSync(join(fakeLog, "gh.code"), "utf8").trim()).not.toBe("0");
    await aleph(["drop", "pusher"]);
  });

  test("six starts at once: five run, one is refused", async () => {
    const names = ["one", "two", "three", "four", "five", "six"];
    const started = names.map((n) => job(n, "sleep"));
    const deadline = Date.now() + 30_000;
    let refused: Awaited<ReturnType<typeof aleph>> | undefined;
    // Five sleep for a minute; the sixth comes back refused.
    refused = await Promise.race([Promise.any(started.map(async (p) => { const r = await p; if (r.code !== 1) throw 0; return r; })), Bun.sleep(30_000).then(() => undefined)]);
    expect(Date.now()).toBeLessThan(deadline);
    expect(refused?.stderr).toContain("5 agent runs are live");
    const live = (await aleph(["jobs"])).json.filter((j: any) => names.includes(j.name));
    expect(live.length).toBe(5);
    expect(live.every((j: any) => j.state === "running" && j.phase === "worker")).toBe(true);
    for (const j of live) expect((await aleph(["drop", j.name])).code).toBe(0);
    const ends = await Promise.all(started);
    expect(ends.filter((r) => r.code === 0).length).toBe(5);
    for (const j of live) expect(state(j.run).state).toBe("dropped");
    expect((await aleph(["jobs"])).json.filter((j: any) => names.includes(j.name))).toEqual([]);
  }, 60_000);
});

describe("news", () => {
  test("news that Sidetone missed is printed once by jobs --news", async () => {
    const r = await job("offline", "exit3", { SIDETONE_TELL_URL: "https://127.0.0.1:1/tell" });
    expect(state(r.json.run).told).toBe(false);
    const news = await aleph(["jobs", "--news"]);
    expect(news.json).toEqual([{ run: r.json.run, line: "demo/offline failed" }]);
    expect((await aleph(["jobs", "--news"])).json).toEqual([]);
  });

  test("a run whose process died shows as lost", async () => {
    const folder = join(jobsDir, "20200101-000000-demo-ghost-agent");
    mkdirSync(folder);
    writeFileSync(join(folder, "state.json"), JSON.stringify({ kind: "agent", job: "20200101-000000-demo-ghost-agent", name: "ghost", repo: "demo", state: "running", told: false, started: "2020-01-01T00:00:00Z" }));
    writeFileSync(join(folder, "pid"), "999999");
    expect((await aleph(["jobs"])).json.find((j: any) => j.name === "ghost")).toMatchObject({ state: "running", lost: true });
    expect((await aleph(["drop", "ghost"])).code).toBe(0);
  });
});

describe("run", () => {
  test("a plain command runs in the current directory and says it finished", async () => {
    const r = await aleph(["run", "build", "--", "bash", "-c", 'pwd; echo "it\'s done"']);
    expect(r.code).toBe(0);
    expect(state(r.json.run)).toMatchObject({ kind: "plain", state: "done", told: true });
    expect(file(r.json.run, "output.log")).toBe(`${base}\nit's done\n`);
    expect(told).toContain("build finished");
  });

  test("a failing plain command says it failed", async () => {
    const r = await aleph(["run", "build", "--", "false"]);
    expect(state(r.json.run)).toMatchObject({ state: "failed", reason: "exited 1" });
    expect(told).toContain("build failed");
  });
});

describe("land", () => {
  const remoteHead = () => sh(base, "git", "--git-dir", remote, "rev-parse", "main");
  function pushFromOther(f: string, content: string): void {
    sh(other, "git", "pull", "-q", "--rebase", "origin", "main");
    writeFileSync(join(other, f), content);
    sh(other, "git", "add", f);
    sh(other, "git", "commit", "-qm", `other ${f}`);
    sh(other, "git", "push", "-q", "origin", "main");
  }

  test("a job that has not passed is refused", async () => {
    await job("unpassed", "exit3");
    const r = await aleph(["land", "unpassed"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("unpassed is failed, not passed");
    await aleph(["drop", "unpassed"]);
  });

  test("a passed job lands as one commit on main, and the main checkout follows", async () => {
    await job("shipit", "commit ship.txt");
    const before = remoteHead();
    const r = await aleph(["land", "shipit"]);
    expect(r.code).toBe(0);
    const s = state(r.json.run);
    expect(s).toMatchObject({ kind: "land", state: "landed", told: true });
    expect(remoteHead()).toBe(s.commit);
    expect(sh(base, "git", "--git-dir", remote, "log", "-1", "--format=%s%n%b%n%P", "main")).toBe(`add ship.txt\nJob: ${r.json.job}\n\n${before}`);
    expect(sh(repo, "git", "rev-parse", "HEAD")).toBe(s.commit);
    expect(existsSync(worktree("shipit"))).toBe(false);
    expect(branchExists("shipit")).toBe(false);
    expect(told).toContain("demo/shipit landed");
    expect(file(r.json.run, "land.log")).toContain("## push: ok");
    expect((await aleph(["jobs"])).json.find((j: any) => j.name === "shipit")).toBeUndefined();
  });

  test("a manual check needs --checked", async () => {
    await job("phoneland", "commit android/land.txt");
    const r = await aleph(["land", "phoneland"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("run it on the phone");
    const ok = await aleph(["land", "phoneland", "--checked"]);
    expect(state(ok.json.run).state).toBe("landed");
  });

  test("a conflict leaves the remote alone and the job open", async () => {
    await job("clash", "commit-fixed clash.txt");
    pushFromOther("clash.txt", "different\n");
    const before = remoteHead();
    const r = await aleph(["land", "clash"]);
    expect(state(r.json.run)).toMatchObject({ state: "failed", reason: "rebase conflict" });
    expect(remoteHead()).toBe(before);
    expect(told).toContain("demo/clash failed");
    expect(sh(worktree("clash"), "git", "status", "--porcelain")).toBe("");
    expect((await aleph(["jobs", "clash"])).json).toMatchObject({ kind: "land", state: "failed" });
    await aleph(["drop", "clash"]);
  });

  test("a change main already has ends done with no net change", async () => {
    await job("twin", "commit-fixed twin.txt");
    pushFromOther("twin.txt", "same\n");
    const r = await aleph(["land", "twin"]);
    expect(state(r.json.run)).toMatchObject({ state: "done", reason: "no net change" });
    expect(existsSync(worktree("twin"))).toBe(false);
  });

  test("a push that loses a race fails, and the next land succeeds", async () => {
    await job("racer", "commit race/x.txt");
    writeFileSync(join(base, "race-once"), "");
    const r = await aleph(["land", "racer"]);
    expect(state(r.json.run)).toMatchObject({ state: "failed", reason: "push refused" });
    expect(sh(base, "git", "--git-dir", remote, "log", "-1", "--format=%s", "main")).toBe("race");
    const again = await aleph(["land", "racer"]);
    const s = state(again.json.run);
    expect(s.state).toBe("landed");
    expect(sh(base, "git", "--git-dir", remote, "log", "-2", "--format=%s", "main")).toBe("add race/x.txt\nrace");
  });

  test("a main checkout with tracked changes is not updated, and the news says so", async () => {
    await job("dirtyco", "commit dc.txt");
    writeFileSync(join(repo, "README"), "local edit\n");
    const head = sh(repo, "git", "rev-parse", "HEAD");
    const r = await aleph(["land", "dirtyco"]);
    expect(state(r.json.run)).toMatchObject({ state: "landed", reason: "main checkout not updated" });
    expect(sh(repo, "git", "rev-parse", "HEAD")).toBe(head);
    expect(told).toContain("demo/dirtyco landed; main checkout not updated");
    sh(repo, "git", "checkout", "README");
  });
});
