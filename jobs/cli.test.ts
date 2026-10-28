import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "cli.ts");
let base: string, remote: string, repo: string, other: string, items: string, itemsRemote: string, jobsDir: string, fake: string, reviewer: string, fakeLog: string, setupLog: string;
let server: ReturnType<typeof Bun.serve>;
let lf: ReturnType<typeof Bun.serve>;
let lfStatus = 200;
let lfPosts: any[] = [];
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
    ALEPH_JOBS_DIR: jobsDir, ALEPH_REPOS: join(base, "repos.json"), ALEPH_ITEMS: items, ALEPH_JOB_FOREGROUND: "1",
    ALEPH_WORKER_CMD: fake, ALEPH_REVIEWER_CMD: reviewer, XDG_RUNTIME_DIR: join(base, "run"), FAKE_LOG: fakeLog, SETUP_LOG: setupLog,
    ALEPH_SANDBOX_CMD: join(base, "pass"), ALEPH_RUNS_DIR: join(base, "runs"), ALEPH_FACTORY_DIR: join(base, "factory"), ALEPH_WORKER_TOKEN: join(base, "token"),
    // The tests start more factory runs than a day's cap; the cap has its own test.
    ALEPH_DAY_CAP: "100",
    // The nightly sweep finds nothing unless a test gives it a table; no test reaches the registry.
    ALEPH_OUTDATED_CMD: "true",
    // The live cap's test starts six runs against a cap of five.
    ALEPH_LIVE_CAP: "5",
    // A run's end and `aleph issue` dispatch in production; the dispatch tests turn it on.
    ALEPH_DISPATCH: "off",
    // The tick triages no issue unless a test sets a cap and a fake command.
    ALEPH_TRIAGE_CAP: "0",
    // No Langfuse unless a test points one at the fake server.
    LANGFUSE_PUBLIC_KEY: "", LANGFUSE_SECRET_KEY: "",
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

// The reviewer: it keeps its prompt, then answers as the prompt's item asks (VERDICT in the goal), else passes.
const REVIEWER = `#!/bin/bash
prompt=$(cat)
printf '%s' "$prompt" > "$FAKE_LOG/review-prompt"
echo x >> "$FAKE_LOG/review-calls"
case $prompt in
  *REVIEW:hold*) echo '{"type":"result","is_error":false,"total_cost_usd":0.02,"result":"Looked.\\nVERDICT: hold tests do not cover the new flag"}' ;;
  *REVIEW:none*) echo '{"type":"result","is_error":false,"total_cost_usd":0.02,"result":"Looks fine to me."}' ;;
  *REVIEW:error*) echo '{"type":"result","is_error":true,"result":"API Error: 529"}' ;;
  *REVIEW:pass*) echo '{"type":"result","is_error":false,"total_cost_usd":0.02,"result":"Fine.\\nVERDICT: pass"}' ;;
  *) echo '{"type":"result","is_error":false,"result":"Fine.\\nVERDICT: pass"}' ;;
esac
`;

const FAKE = `#!/bin/bash
prompt=$(cat)
printf '%s' "$prompt" > "$FAKE_LOG/prompt"
echo "$@" > "$FAKE_LOG/args"
env > "$FAKE_LOG/env"
action=$(printf '%s\\n' "$prompt" | grep '^ACTION:' | tail -1 | cut -d' ' -f2-)
case $action in
  commit\\ *) f=\${action#commit }; mkdir -p "$(dirname "$f")"; echo "$RANDOM" > "$f"; git add "$f"; git commit -qm "add $f" ;;
  commit-fixed\\ *) f=\${action#commit-fixed }; echo same > "$f"; git add "$f"; git commit -qm "add $f" ;;
  resolve-later\\ *) f=\${action#resolve-later }
    if printf '%s' "$prompt" | grep -q 'The land conflicted'; then git fetch -q origin && git rebase -q -X theirs origin/main
    else echo mine > "$f"; git add "$f"; git commit -qm "add $f"; fi ;;
  own-list\\ *) f=\${action#own-list }
    if printf '%s' "$prompt" | grep -q 'The land refused'; then git fetch -q origin
      if git cat-file -e origin/main:docs/todo.md 2>/dev/null; then git checkout -q origin/main -- docs/todo.md; else git rm -q docs/todo.md; fi
      git commit -qm "restore the list"
    else mkdir -p docs; echo "$RANDOM" > "$f"; echo "# To do (by hand)" > docs/todo.md; git add "$f" docs/todo.md; git commit -qm "add $f"; fi ;;
  untracked) echo x > stray.txt ;;
  hold\\ *) f=\${action#hold }; while [ ! -e "$f" ]; do sleep 0.1; done; echo "$RANDOM" > "held-$(basename "$f").txt"; git add .; git commit -qm "held $f" ;;
  sleep) sleep 60 ;;
  quiet) echo '{"type":"system"}'; sleep 30 ;;
  chatty) echo c > c.txt; git add c.txt; git commit -qm "add c.txt"; for i in 1 2 3 4 5; do echo '{"type":"system"}'; sleep 1; done ;;
  exit3) exit 3 ;;
  question) echo '{"type":"result","result":"I looked.\\nQUESTION: which colour?"}'; exit 0 ;;
  error) echo '{"type":"result","is_error":true,"result":"API Error: 500"}'; exit 0 ;;
  noresult) echo '{"type":"assistant","message":{"content":[{"type":"text","text":"working"}]}}'; exit 0 ;;
  trailing) echo x > t.txt; git add t.txt; git commit -qm "add t.txt"; echo '{"type":"result","is_error":false,"result":"done"}'; echo 'one more line'; exit 0 ;;
  defaults) echo d > d.txt; git add d.txt; git commit -qm "add d.txt"
    echo '{"type":"result","is_error":false,"total_cost_usd":0.25,"result":"Done.\\nDEFAULT: which colour? -> blue\\nFOLLOWUP: paint the fence"}'; exit 0 ;;
  fail-then-fix) echo "$RANDOM" > f.txt; git add f.txt
    if printf '%s' "$prompt" | grep -q 'The check \`tests\` failed'; then git rm -q FAIL; else echo x > FAIL; git add FAIL; fi
    git commit -qm "work" ;;
  hidden-fix) echo "$RANDOM" > f.txt; git add f.txt
    if printf '%s' "$prompt" | grep -q 'hidden check failed'; then echo ok > hid.txt; git add hid.txt; fi
    git commit -qm "work" ;;
  flaky) mkdir -p flaky; echo "$RANDOM" > "flaky/$RANDOM"; git add flaky; git commit -qm "add flaky" ;;
  fail-always) echo "$RANDOM" > f.txt; echo x > FAIL; git add f.txt FAIL; git commit -qm "work" ;;
  branchlog) git log --format=%s > "$FAKE_LOG/branchlog"; git rm -q FAIL; git commit -qm "remove FAIL" ;;
  status\\ *) set -- \${action#status }; cli=$1; shift
    for i in "$@"; do bun "$cli" status "$i" --json; done > "$FAKE_LOG/status-inside"
    echo s > s.txt; git add s.txt; git commit -qm "add s.txt" ;;
  push)
    GIT_SSH_COMMAND="$FAKE_LOG/ssh" git push git@github.com:x/y.git HEAD > /dev/null 2>&1; echo $? > "$FAKE_LOG/push.code"
    gh auth status > /dev/null 2>&1; echo $? > "$FAKE_LOG/gh.code" ;;
esac
echo '{"type":"assistant","message":{"content":[{"type":"text","text":"working"}]}}'
echo '{"type":"result","is_error":false,"total_cost_usd":0.01,"result":"did '"$action"'"}'
`;

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-jobs-"));
  for (const d of ["run", "fake", "jobs"]) mkdirSync(join(base, d));
  jobsDir = join(base, "jobs");
  fakeLog = join(base, "fake");
  setupLog = join(base, "setup.log");
  fake = join(base, "fake-worker");
  reviewer = join(base, "fake-reviewer");
  writeFileSync(reviewer, REVIEWER, { mode: 0o755 });
  writeFileSync(fake, FAKE, { mode: 0o755 });
  // The tests' stand-in for srt: the clean environment, and FAKE_LOG for the fake worker.
  writeFileSync(join(base, "pass"), `#!/bin/bash\nshift\nexec env -i FAKE_LOG="$FAKE_LOG" "$@"\n`, { mode: 0o755 });
  writeFileSync(join(base, "token"), "tok-123\n");
  writeFileSync(join(fakeLog, "ssh"), `#!/bin/sh\necho "$@" > "${join(base, "fake", "ssh.args")}"\nexit 1\n`, { mode: 0o755 });

  remote = join(base, "remote.git");
  sh(base, "git", "init", "-q", "--bare", "-b", "main", remote);
  const seed = join(base, "seed");
  sh(base, "git", "clone", "-q", remote, seed);
  writeFileSync(join(seed, ".gitignore"), ".worktrees/\n");
  writeFileSync(join(seed, "README"), "demo\n");
  writeFileSync(join(seed, "old.test.ts"), "test(\"old\", () => {});\n");
  sh(seed, "git", "add", "."); sh(seed, "git", "commit", "-qm", "init"); sh(seed, "git", "push", "-q", "origin", "main");
  repo = join(base, "repo");
  other = join(base, "other");
  // The work store, empty: a list starts with its first item.
  itemsRemote = join(base, "items.git");
  items = join(base, "items");
  sh(base, "git", "init", "-q", "--bare", "-b", "main", itemsRemote);
  sh(base, "git", "clone", "-q", itemsRemote, items);
  sh(items, "git", "commit", "-q", "--allow-empty", "-m", "start");
  sh(items, "git", "push", "-q", "origin", "main");
  sh(base, "git", "clone", "-q", remote, repo);
  sh(base, "git", "clone", "-q", remote, other);

  const checks = [
    { name: "tests", run: "test ! -f FAIL" },
    { name: "no job variables", run: 'test -z "$ALEPH_JOB_ID$ALEPH_JOB_RUN"' },
    { name: "android build", run: `echo built >> ${join(base, "android.log")}`, when: ["android/**"] },
    { name: "slow", run: "sleep 60", when: ["slow/**"] },
    // Holds two lands between their fetch and their push at the same time.
    { name: "pause", run: "sleep 1", when: ["pair/**"] },
    // Pushes to the remote from another clone once, so the land's own push loses the race.
    // Writes a to-do note to main once, during the land's checks.
    { name: "todo race", run: `if [ -f ${join(base, "todo-once")} ]; then rm ${join(base, "todo-once")}; bun ${CLI} todo note demo 1 "during the land"; fi`, when: ["todo-race/**"] },
    { name: "race", run: `if [ -f ${join(base, "race-once")} ]; then rm ${join(base, "race-once")}; cd ${join(base, "other")} && git pull -q --rebase origin main && echo $RANDOM > raced && git add raced && git commit -qm race && git push -q origin main; fi`, when: ["race/**"] },
  ];
  writeFileSync(join(base, "repos.json"), JSON.stringify({
    // The tests land by hand; "auto" is the same clone with the default, landing by itself.
    demo: { path: repo, setup: [`echo ran >> "$SETUP_LOG"`], checks, manual: [{ when: ["android/**"], say: "run it on the phone" }], autoland: false },
    auto: { path: repo, checks: [], manual: [{ when: ["android/**"], say: "run it on the phone" }] },
    other: { path: other, checks: [], autoland: false },
    // The factory: the same clone, its runs under the stand-in sandbox.
    fac: {
      path: repo, sandbox: true, held: ["held/**"], autoland: false,
      checks: [{ name: "tests", run: 'if [ -f FAIL ]; then for i in 1 2 3; do echo "FAIL is present $i"; done; exit 1; fi' }, { name: "flaky", run: `for f in flaky/*; do m=${join(base, "flakym-")}$(basename $f); if [ ! -f $m ]; then touch $m; exit 1; fi; done`, when: ["flaky/**"] }, { name: "tree", run: `git rev-parse 'HEAD^{tree}' >> ${join(base, "trees")}` }],
    },
  }));

  sh(base, "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "key.pem", "-out", "cert.pem", "-days", "1", "-subj", "/CN=tailnet");
  lf = Bun.serve({ port: 0, async fetch(req) { lfPosts.push(await req.json()); return new Response("{}", { status: lfStatus }); } });
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
  lf.stop(true);
  rmSync(base, { recursive: true, force: true });
});

describe("job", () => {
  test("refuses an unknown repo, prints the keys, creates nothing", async () => {
    const r = await aleph(["job", "nowhere", "alpha", "--spec", specFile("x")]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("demo, auto, other, fac");
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
    expect(s.checks.map((c: any) => c.name)).toContain("tests");
    expect(s.checks.map((c: any) => c.name)).not.toContain("android build");
    for (const c of s.checks) expect(c).toMatchObject({ ok: true, seconds: expect.any(Number) });
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

  test("with no name, jobs lists the open jobs, then the jobs that ended in the last 24 hours, the latest first", async () => {
    await job("older", "commit older.txt");
    await aleph(["drop", "older"]);
    await job("newer", "commit newer.txt");
    await aleph(["drop", "newer"]);
    await job("stale", "commit stale.txt");
    await aleph(["drop", "stale"]);
    const folder = (await aleph(["jobs", "stale"])).json.run;
    const file = join(jobsDir, folder, "state.json");
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), ended: new Date(Date.now() - 25 * 3600_000).toISOString() }));
    await job("open", "commit open.txt");
    const names = (await aleph(["jobs"])).json.map((j: any) => j.name).filter((n: string) => ["older", "newer", "stale", "open"].includes(n));
    expect(names).toEqual(["open", "newer", "older"]);
    await aleph(["drop", "open"]);
  });

  test("drop removes the worktree and branch and ends the job", async () => {
    const r = await aleph(["drop", "alpha", "not", "needed"]);
    expect(r.code).toBe(0);
    expect(r.json).toMatchObject({ state: "dropped", reason: "not needed" });
    expect(existsSync(worktree("alpha"))).toBe(false);
    expect(branchExists("alpha")).toBe(false);
    expect((await aleph(["jobs"])).json.find((j: any) => j.name === "alpha")).toMatchObject({ state: "dropped" });
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

  test("a change under a manual glob runs its checks and passes, keeping what to check", async () => {
    const r = await job("phone", "commit android/app.txt");
    expect(state(r.json.run)).toMatchObject({ state: "passed", say: "run it on the phone" });
    expect(state(r.json.run).needs).toBeUndefined();
    expect(readFileSync(join(base, "android.log"), "utf8")).toBe("built\n");
    await aleph(["drop", "phone"]);
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
    expect((await aleph(["jobs"])).json.filter((j: any) => names.includes(j.name)).map((j: any) => j.state)).toEqual(live.map(() => "dropped"));
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
    mkdirSync(join(other, f, ".."), { recursive: true });
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

  test("a passed job lands as one commit on main, and the main checkout does not move", async () => {
    await job("shipit", "commit ship.txt");
    const before = remoteHead();
    const head = sh(repo, "git", "rev-parse", "HEAD");
    const r = await aleph(["land", "shipit"]);
    expect(r.code).toBe(0);
    const s = state(r.json.run);
    expect(s).toMatchObject({ kind: "land", state: "landed", told: true });
    expect(remoteHead()).toBe(s.commit);
    expect(sh(base, "git", "--git-dir", remote, "log", "-1", "--format=%s%n%b%n%P", "main")).toBe(`add ship.txt\nJob: ${r.json.job}\n\n${before}`);
    expect(sh(repo, "git", "rev-parse", "HEAD")).toBe(head);
    expect(existsSync(worktree("shipit"))).toBe(false);
    expect(branchExists("shipit")).toBe(false);
    expect(told).toContain("demo/shipit landed");
    expect(file(r.json.run, "land.log")).toContain("## push: ok");
    expect((await aleph(["jobs"])).json.find((j: any) => j.name === "shipit")).toMatchObject({ state: "landed" });
  });

  test("a manual check does not gate the land; --checked lands with no check open", async () => {
    await job("phoneland", "commit android/land.txt");
    const ok = await aleph(["land", "phoneland", "--checked"]);
    expect(state(ok.json.run).state).toBe("landed");
    expect(state(ok.json.run).check).toBeUndefined();
    expect((await aleph(["jobs", "phoneland"])).json.check).toBeUndefined();
  });

  test("a job with a manual check lands with the check open as a to-do item, until checked", async () => {
    await job("phonelater", "commit android/later.txt");
    const r = await aleph(["land", "phonelater"]);
    expect(r.code).toBe(0);
    const s = state(r.json.run);
    expect(s).toMatchObject({ kind: "land", state: "landed", check: "open", say: "run it on the phone" });
    expect(remoteHead()).toBe(s.commit);
    const item = (await aleph(["todo", "show", "demo", String(s.checkItem), "--json"])).json;
    expect(item).toMatchObject({ title: "Check phonelater: run it on the phone", status: "open", labels: ["check"] });
    expect(sh(base, "git", "--git-dir", remote, "diff", "--name-only", `${s.commit}~1`, s.commit)).toBe("android/later.txt");
    expect(told).toContain("demo/phonelater landed; check open");
    expect((await aleph(["jobs"])).json.find((j: any) => j.name === "phonelater")).toMatchObject({ check: "open" });

    const c = await aleph(["checked", "phonelater"]);
    expect(c.code).toBe(0);
    expect((await aleph(["jobs", "phonelater"])).json).toMatchObject({ state: "landed", check: "done" });
    expect((await aleph(["jobs"])).json.find((j: any) => j.name === "phonelater")).toMatchObject({ state: "landed", check: "done" });
    expect((await aleph(["todo", "show", "demo", String(s.checkItem), "--json"])).json.status).toBe("done");
    const again = await aleph(["checked", "phonelater"]);
    expect(again.code).toBe(1);
    expect(again.stderr).toContain("phonelater has no open check");
  });

  test("in a repo that lands by itself, a passed job lands with no aleph land", async () => {
    const r = await job("selfland", "commit selfland.txt", {}, "auto");
    expect(state(r.json.run)).toMatchObject({ state: "passed", next: "land" });
    const runs = readdirSync(jobsDir).filter((d) => d.includes("-auto-selfland-")).sort();
    expect(runs.map((d) => state(d).kind)).toEqual(["agent", "land"]);
    expect(state(runs[1])).toMatchObject({ state: "landed" });
    expect(remoteHead()).toBe(state(runs[1]).commit);
    expect(told).toContain("auto/selfland passed; landing");
  });

  const runsOf = (name: string) => readdirSync(jobsDir).filter((d) => d.includes(`-demo-${name}-`)).sort().map((d) => ({ id: d, ...state(d) }));

  test("a conflict records its paths, sends the job back to the worker, and the passed follow-up lands", async () => {
    await job("mend", "resolve-later mend.txt");
    pushFromOther("mend.txt", "theirs\n");
    const r = await aleph(["land", "mend"]);
    expect(state(r.json.run)).toMatchObject({ state: "failed", reason: "merge conflict", conflicts: ["mend.txt"], next: "worker" });
    expect(file(r.json.run, "land.log")).toContain("## conflicts\nmend.txt");
    expect(told).toContain("demo/mend failed; sent back to the worker");
    const runs = runsOf("mend");
    expect(runs.map((x) => [x.kind, x.state])).toEqual([["agent", "passed"], ["land", "failed"], ["agent", "passed"], ["land", "landed"]]);
    expect(runs[2].land).toBe(true);
    expect(sh(base, "git", "--git-dir", remote, "show", "main:mend.txt")).toBe("mine");
    expect(remoteHead()).toBe(runs[3].commit);
  }, 30_000);

  test("a conflict the worker cannot resolve goes back twice, then stops and leaves the remote alone", async () => {
    await job("clash", "commit-fixed clash.txt");
    pushFromOther("clash.txt", "different\n");
    const before = remoteHead();
    await aleph(["land", "clash"]);
    const runs = runsOf("clash");
    expect(runs.filter((x) => x.kind === "land").map((x) => x.next ?? null)).toEqual(["worker", "worker", null]);
    expect(runs.at(-1)).toMatchObject({ kind: "land", state: "failed", reason: "merge conflict" });
    expect(remoteHead()).toBe(before);
    expect(told).toContain("demo/clash failed");
    expect(sh(worktree("clash"), "git", "status", "--porcelain")).toBe("");
    await aleph(["drop", "clash"]);
  }, 30_000);

  test("a branch that changes the list is refused, goes back to the worker, and lands without the change", async () => {
    await job("byhand", "own-list byhand.txt");
    const r = await aleph(["land", "byhand"]);
    expect(state(r.json.run)).toMatchObject({ state: "failed", reason: "the branch changes docs/todo.md; change the list with aleph issue", conflicts: ["docs/todo.md"], next: "worker" });
    const runs = runsOf("byhand");
    expect(runs.map((x) => [x.kind, x.state])).toEqual([["agent", "passed"], ["land", "failed"], ["agent", "passed"], ["land", "landed"]]);
    expect(file(runs[2].id, "prompt.md")).toContain("Only aleph issue writes the list");
    expect(Bun.spawnSync(["git", "--git-dir", remote, "cat-file", "-e", "main:docs/todo.md"]).exitCode).not.toBe(0);
    expect(sh(base, "git", "--git-dir", remote, "diff", "--name-only", `${runs[3].commit}~1`, runs[3].commit)).toBe("byhand.txt");
  }, 30_000);

  test("a change main already has ends done with no net change", async () => {
    await job("twin", "commit-fixed twin.txt");
    pushFromOther("twin.txt", "same\n");
    const r = await aleph(["land", "twin"]);
    expect(state(r.json.run)).toMatchObject({ state: "done", reason: "no net change" });
    expect(existsSync(worktree("twin"))).toBe(false);
  });

  test("a push that loses a race merges again in the same land, and lands", async () => {
    await job("racer", "commit race/x.txt");
    writeFileSync(join(base, "race-once"), "");
    const r = await aleph(["land", "racer"]);
    expect(state(r.json.run)).toMatchObject({ state: "landed" });
    expect(state(r.json.run).next).toBeUndefined();
    expect(file(r.json.run, "land.log")).toContain("## main moved; merging again");
    expect(runsOf("racer").map((x) => x.kind)).toEqual(["agent", "land"]);
    expect(sh(base, "git", "--git-dir", remote, "log", "-2", "--format=%s", "main")).toBe("add race/x.txt\nrace");
  });

  test("a to-do write during the checks goes to the work store and leaves the land's main alone", async () => {
    await job("patient", "commit todo-race/patient.txt");
    const before = remoteHead();
    writeFileSync(join(base, "todo-once"), "");
    const l = await aleph(["land", "patient"]);
    const s = state(l.json.run);
    expect(s).toMatchObject({ state: "landed" });
    expect(sh(base, "git", "--git-dir", remote, "rev-parse", `${s.commit}~1`)).toBe(before);
    expect(sh(base, "git", "--git-dir", itemsRemote, "show", "main:demo/backlog/tasks/demo-1.md")).toContain("during the land");
  }, 30_000);

  test("two lands at once in one repo both reach main, neither undoing the other", async () => {
    await job("left", "commit pair/left.txt");
    await job("right", "commit pair/right.txt");
    const [l, r] = await Promise.all([aleph(["land", "left"]), aleph(["land", "right"])]);
    expect([state(l.json.run).state, state(r.json.run).state]).toEqual(["landed", "landed"]);
    expect(sh(base, "git", "--git-dir", remote, "ls-tree", "--name-only", "main:pair").split("\n")).toEqual(["left.txt", "right.txt"]);
    expect(sh(base, "git", "--git-dir", remote, "log", "-2", "--format=%s", "main").split("\n").sort()).toEqual(["add pair/left.txt", "add pair/right.txt"]);
  }, 30_000);

  test("a land changes no checkout: the main checkout's HEAD, index and working tree stay as they were", async () => {
    await job("still", "commit still.txt");
    writeFileSync(join(repo, "README"), "local edit\n");
    const before = [sh(repo, "git", "rev-parse", "HEAD"), sh(repo, "git", "status", "--porcelain"), sh(repo, "git", "diff")];
    const r = await aleph(["land", "still"]);
    expect(state(r.json.run)).toMatchObject({ state: "landed" });
    expect(state(r.json.run).reason).toBeUndefined();
    expect([sh(repo, "git", "rev-parse", "HEAD"), sh(repo, "git", "status", "--porcelain"), sh(repo, "git", "diff")]).toEqual(before);
    sh(repo, "git", "checkout", "README");
  });
});

describe("a job tied to a to-do item", () => {
  const list = () => sh(base, "git", "--git-dir", itemsRemote, "rev-parse", "main");
  const show = async (id: number) => (await aleph(["todo", "show", "demo", String(id), "--json"])).json;
  let landId: number, dropId: number;
  beforeAll(async () => {
    landId = (await aleph(["todo", "add", "demo", "ship the widget"])).json.added;
    dropId = (await aleph(["todo", "add", "demo", "paint the shed"])).json.added;
  });

  test("an id the list does not have is refused, and nothing starts", async () => {
    const before = readdirSync(jobsDir).length;
    const r = await aleph(["job", "demo", "badlink", "--spec", specFile("x"), "--todo", "99"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("demo has no issue 99");
    expect(readdirSync(jobsDir).length).toBe(before);
  });

  test("land marks the item done, naming the job and the landing commit", async () => {
    const j = await aleph(["job", "demo", "widget", "--spec", specFile("Goal: widget\nACTION: commit widget.txt\n"), "--todo", String(landId)]);
    expect(state(j.json.run)).toMatchObject({ state: "passed", todo: landId });
    const r = await aleph(["land", "widget"]);
    const s = state(r.json.run);
    expect(s).toMatchObject({ kind: "land", state: "landed", todo: landId });
    expect(s.reason).toBeUndefined();
    const item = await show(landId);
    expect(item.status).toBe("done");
    expect(item.notes.at(-1)).toContain("job widget landed");
    expect(file(r.json.run, "land.log")).toContain(`## todo ${landId} done`);
    // The item closes in the work store; the landing commit holds only the work.
    expect(sh(base, "git", "--git-dir", remote, "diff", "--name-only", `${s.commit}~1`, s.commit)).toBe("widget.txt");
    expect(sh(base, "git", "--git-dir", itemsRemote, "log", "-1", "--format=%s", "main")).toBe("demo: todo: job widget landed");
    expect(sh(repo, "git", "status", "--porcelain", "--untracked-files=no")).toBe("");
  });

  test("drop adds a note with the reason and leaves the item open", async () => {
    await aleph(["job", "demo", "shed", "--spec", specFile("Goal: shed\nACTION: commit shed.txt\n"), "--todo", String(dropId)]);
    expect((await aleph(["drop", "shed", "wrong", "colour"])).code).toBe(0);
    const item = await show(dropId);
    expect(item.status).toBe("open");
    expect(item.notes.at(-1)).toContain("job shed dropped: wrong colour");
  });

  test("a job without --todo records none and leaves the list alone", async () => {
    const before = list();
    const j = await job("plainjob", "commit plainjob.txt");
    expect(state(j.json.run).todo).toBeUndefined();
    const r = await aleph(["land", "plainjob"]);
    expect(state(r.json.run)).toMatchObject({ state: "landed" });
    expect(state(r.json.run).todo).toBeUndefined();
    expect(list()).toBe(before);
  });
});

describe("fate from git", () => {
  const remoteGit = (...a: string[]) => sh(base, "git", "--git-dir", remote, ...a);
  const listed = async (name: string) => (await aleph(["jobs"])).json.find((j: any) => j.name === name);

  test("each worker commit carries the job's trailer", async () => {
    const j = await job("stamped", "commit stamped.txt");
    expect(sh(worktree("stamped"), "git", "log", "-1", "--format=%B")).toContain(`Job: ${j.json.job}`);
    await aleph(["drop", "stamped"]);
  });

  test("work ported to main by hand reads as landed, and its to-do item closes", async () => {
    const id = (await aleph(["todo", "add", "demo", "port by hand"])).json.added;
    const j = await aleph(["job", "demo", "ported", "--spec", specFile("Goal: ported\nACTION: commit ported.txt\n"), "--todo", String(id)]);
    const tip = sh(repo, "git", "rev-parse", "job/ported");
    sh(other, "git", "pull", "-q", "--rebase", "origin", "main");
    sh(other, "git", "fetch", "-q", repo, "job/ported");
    sh(other, "git", "cherry-pick", tip);
    sh(other, "git", "push", "-q", "origin", "main");
    const picked = remoteGit("rev-parse", "main");
    expect(await listed("ported")).toMatchObject({ state: "landed" });
    expect(state(j.json.run)).toMatchObject({ state: "landed", reason: "found on main (Job trailer)", commit: picked });
    expect(existsSync(worktree("ported"))).toBe(false);
    expect((await aleph(["todo", "show", "demo", String(id), "--json"])).json.status).toBe("done");
  });

  test("a branch whose change main already has, under another message, reads as landed", async () => {
    const j = await job("twice", "commit-fixed twice.txt");
    sh(other, "git", "pull", "-q", "--rebase", "origin", "main");
    writeFileSync(join(other, "twice.txt"), "same\n");
    sh(other, "git", "add", "twice.txt");
    sh(other, "git", "commit", "-qm", "the same change, by hand");
    sh(other, "git", "push", "-q", "origin", "main");
    expect(await listed("twice")).toMatchObject({ state: "landed" });
    expect(state(j.json.run)).toMatchObject({ state: "landed", reason: "found on main (content)" });
  });

  test("a job with no branch and no worktree reads as gone, and land says the branch is gone", async () => {
    await job("vanished", "commit vanished.txt");
    sh(repo, "git", "worktree", "remove", "--force", worktree("vanished"));
    sh(repo, "git", "branch", "-D", "job/vanished");
    expect(await listed("vanished")).toMatchObject({ state: "passed", fate: "gone" });
    const r = await aleph(["land", "vanished"]);
    expect(state(r.json.run)).toMatchObject({ state: "failed", reason: "branch gone: job/vanished" });
    await aleph(["drop", "vanished"]);
  });

  test("an open job with its branch reads as unlanded", async () => {
    await job("waiting", "commit waiting.txt");
    expect(await listed("waiting")).toMatchObject({ state: "passed", fate: "unlanded" });
    await aleph(["drop", "waiting"]);
  });
});


describe("a factory run", () => {
  const remoteGit = (...a: string[]) => sh(base, "git", "--git-dir", remote, ...a);
  const fjob = (name: string, action: string, extra: Record<string, string> = {}, more: string[] = []) =>
    aleph(["job", "fac", name, "--spec", specFile(`Goal: ${name}\nACTION: ${action}\n`), ...more], extra);
  const factoryBranch = (name: string) => Bun.spawnSync(["git", "-C", repo, "rev-parse", "--verify", "-q", `factory/${name}`]).exitCode === 0;
  const runsLeft = () => existsSync(join(base, "runs")) ? readdirSync(join(base, "runs")) : [];

  describe("its Langfuse trace", () => {
    const langfuse = () => ({ LANGFUSE_BASE_URL: `http://127.0.0.1:${lf.port}`, LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk" });
    const spans = () => lfPosts.flatMap((p) => p.resourceSpans.flatMap((r: any) => r.scopeSpans.flatMap((x: any) => x.spans)));
    beforeEach(() => { lfPosts = []; lfStatus = 200; });

    test("one trace is posted, its session id the job id", async () => {
      const r = await fjob("ftrace", "commit ftrace.txt", langfuse());
      expect(state(r.json.run).state).toBe("passed");
      const all = spans();
      expect(all.length).toBeGreaterThan(0);
      const root = all.find((s: any) => !s.parentSpanId);
      expect(root.name).toBe("worker");
      expect(new Set(all.map((s: any) => s.traceId)).size).toBe(1);
      const a = (k: string) => root.attributes.find((x: any) => x.key === k)?.value.stringValue;
      expect(a("langfuse.session.id")).toBe(state(r.json.run).job);
      expect(a("langfuse.trace.name")).toBe("factory ftrace");
      expect(a("langfuse.trace.metadata.state")).toBe("passed");
    });

    test("with Langfuse answering 500 the verdict is unchanged and one line is logged", async () => {
      lfStatus = 500;
      const r = await fjob("ftrace500", "commit ftrace500.txt", langfuse());
      expect(state(r.json.run).state).toBe("passed");
      expect(file(r.json.run, "trace.log").trim().split("\n").length).toBe(1);
    });

    test("with no Langfuse config nothing is posted", async () => {
      await fjob("ftracenone", "commit ftracenone.txt");
      expect(lfPosts).toEqual([]);
    });
  });

  test("the worker's branch comes back as a bundle; the run passes and its run folder is gone", async () => {
    const r = await fjob("fpass", "commit fpass.txt");
    const s = state(r.json.run);
    expect(s).toMatchObject({ kind: "agent", state: "passed", branch: "factory/fpass", cost: 0.01, defaults: [] });
    expect(s.worktree).toBeUndefined();
    expect(factoryBranch("fpass")).toBe(true);
    expect(sh(repo, "git", "log", "-1", "--format=%s", "factory/fpass")).toBe("add fpass.txt");
    expect(runsLeft()).toEqual([]);
    expect(file(r.json.run, "prompt.md")).toContain("inside\na sandbox");
    expect(s.checks.map((c: any) => c.name)).toEqual(["tests", "tree"]);
    for (const c of s.checks) expect(c).toMatchObject({ ok: true, seconds: expect.any(Number) });
  });

  test("the sandbox's environment holds the worker token and nothing of Chris's", () => {
    const env = readFileSync(join(fakeLog, "env"), "utf8");
    expect(env).toContain("CLAUDE_CODE_OAUTH_TOKEN=tok-123");
    expect(env).toMatch(/^HOME=.*\/runs\/.*\/home$/m);
    expect(env).not.toMatch(/^(ALEPH_[A-Z_]+|SIDETONE_[A-Z_]+|GIT_AUTHOR_NAME|XDG_RUNTIME_DIR)=/m);
  });

  test("the land pushes the tested tree with Item and Job trailers, and moves no checkout", async () => {
    const id = (await aleph(["todo", "add", "fac", "a factory item"])).json.added;
    const j = await fjob("fitem", "commit fitem.txt", {}, ["--todo", String(id)]);
    const head = [sh(repo, "git", "rev-parse", "HEAD"), sh(repo, "git", "status", "--porcelain")];
    const r = await aleph(["land", "fitem"]);
    const s = state(r.json.run);
    expect(s).toMatchObject({ kind: "land", state: "landed" });
    expect(remoteGit("log", "-1", "--format=%B", "main").trim()).toBe(`add fitem.txt\n\nItem: fac-${id}\nJob: ${j.json.job}`);
    expect(remoteGit("log", "-1", "--format=%(trailers:only)", "main").trim()).toBe(`Item: fac-${id}\nJob: ${j.json.job}`);
    expect(readFileSync(join(base, "trees"), "utf8").trim().split("\n").at(-1)).toBe(remoteGit("rev-parse", "main^{tree}"));
    expect([sh(repo, "git", "rev-parse", "HEAD"), sh(repo, "git", "status", "--porcelain")]).toEqual(head);
    expect(factoryBranch("fitem")).toBe(false);
    expect((await aleph(["todo", "show", "fac", String(id), "--json"])).json.status).toBe("done");
    expect(runsLeft()).toEqual([]);
  });

  test("an error result, no result, a line after the result, or no commit ends stuck", async () => {
    expect(state((await fjob("ferr", "error")).json.run)).toMatchObject({ state: "stuck", reason: "API Error: 500" });
    expect(state((await fjob("fnone", "noresult")).json.run)).toMatchObject({ state: "stuck", reason: expect.stringContaining('"type":"assistant"') });
    expect(state((await fjob("ftrail", "trailing")).json.run)).toMatchObject({ state: "stuck", reason: "one more line" });
    expect(state((await fjob("fidle", "none")).json.run)).toMatchObject({ state: "stuck", reason: "no commit" });
    expect(told).toContain("fac/ferr stuck");
    for (const n of ["ferr", "fnone", "ftrail", "fidle"]) await aleph(["drop", n]);
  });

  describe("hidden checks", () => {
    const SOURCE = `import { expect, test } from "bun:test";\nimport { existsSync } from "node:fs";\n// SECRET-HIDDEN-LINE\ntest("hid file exists", () => { expect(existsSync("hid.txt")).toBe(true); });\n`;
    const hiddenItem = async () => {
      const id = (await aleph(["todo", "add", "fac", "an item with a hidden check"])).json.added;
      writeFileSync(join(base, "a.test.ts"), SOURCE);
      expect((await aleph(["todo", "hidden", "fac", String(id), join(base, "a.test.ts")])).code).toBe(0);
      return id;
    };
    const runs = (name: string) => readdirSync(jobsDir).filter((d) => d.includes(`-fac-${name}-`)).sort().map((d) => ({ id: d, ...state(d) }));

    test("a run whose code fails the hidden test is stuck with the count, and no source reaches the note", async () => {
      const id = await hiddenItem();
      const r = await fjob("hidbad", "commit hidbad.txt", { ALEPH_FIX_ROUNDS: "0" }, ["--todo", String(id)]);
      expect(state(r.json.run)).toMatchObject({ state: "stuck", reason: "hidden check failed: 1 of 1 tests" });
      expect(state(r.json.run).checks.map((c: any) => c.name)).toEqual(["tests", "tree", "hidden"]);
      expect(file(r.json.run, "hidden.log")).toContain("SECRET-HIDDEN-LINE");
      expect(file(r.json.run, "checks.log")).not.toContain("SECRET-HIDDEN-LINE");
      expect(file(r.json.run, "prompt.md")).not.toContain("SECRET-HIDDEN-LINE");
      expect(runsLeft()).toEqual([]);
      expect((await aleph(["report"])).stdout).toContain("hidden 0/1");
      await aleph(["drop", "hidbad"]);
    }, 30_000);

    test("the fix round's note has the line and the failing test names, and the job lands once it passes", async () => {
      const id = await hiddenItem();
      await fjob("hidfix", "hidden-fix", {}, ["--todo", String(id)]);
      const rs = runs("hidfix");
      expect(rs.map((x) => [x.kind, x.state])).toEqual([["agent", "stuck"], ["agent", "passed"], ["land", "landed"]]);
      expect(rs[0]).toMatchObject({ reason: "hidden check failed: 1 of 1 tests", failed: "hidden", next: "worker" });
      const p = readFileSync(join(fakeLog, "prompt"), "utf8");
      expect(p).toContain("hidden check failed: 1 of 1 tests");
      expect(p).toContain("hid file exists");
      expect(p).not.toContain("SECRET-HIDDEN-LINE");
      expect(p).not.toContain("expect(existsSync");
      // The land's checks ran the hidden check; its log is in the land run's folder.
      expect(rs[2].checks.map((c: any) => c.name)).toEqual(["tests", "tree", "hidden"]);
      expect(rs[2].checks.at(-1)).toMatchObject({ ok: true, passed: 1, total: 1 });
      expect(readFileSync(join(jobsDir, rs[2].id, "hidden.log"), "utf8")).toContain("1 pass");
      expect(runsLeft()).toEqual([]);
    }, 60_000);

    test("an item with no hidden files runs the same checks as before", async () => {
      const id = (await aleph(["todo", "add", "fac", "no hidden"])).json.added;
      const r = await fjob("hidnone", "commit hidnone.txt", {}, ["--todo", String(id)]);
      expect(state(r.json.run).checks.map((c: any) => c.name)).toEqual(["tests", "tree"]);
      expect(existsSync(join(jobsDir, r.json.run, "hidden.log"))).toBe(false);
      await aleph(["drop", "hidnone"]);
    }, 30_000);
  });

  describe("flaky checks", () => {
    const flaky = () => JSON.parse(readFileSync(join(base, "factory", "flaky.json"), "utf8"));

    test("a check that fails then passes on the same tree passes the run, is recorded and reported; two make a health line", async () => {
      const r = await fjob("flk1", "flaky");
      expect(state(r.json.run).state).toBe("passed");
      expect(state(r.json.run).checks.find((c: any) => c.name === "flaky")).toMatchObject({ ok: true, rerun: true });
      expect(file(r.json.run, "checks.log")).toContain("## flaky: exit 1, run again");
      expect(flaky()).toHaveLength(1);
      expect(flaky()[0]).toMatchObject({ repo: "fac", check: "flaky", run: r.json.run });
      const out = (await aleph(["report"])).stdout;
      expect(out).toContain("flaky passed on rerun");
      expect(out).not.toContain("on rerun 2 times");
      await fjob("flk2", "flaky");
      expect(flaky()).toHaveLength(2);
      expect((await aleph(["report"])).stdout).toContain("health: fac check flaky passed on rerun 2 times in 7 days");
      rmSync(join(base, "factory", "flaky.json"));
    }, 60_000);

    test("a check that always fails is still stuck, with one rerun in its log", async () => {
      const r = await fjob("flk3", "fail-always", { ALEPH_FIX_ROUNDS: "0" });
      expect(state(r.json.run)).toMatchObject({ state: "stuck", reason: "tests failed" });
      const log = file(r.json.run, "checks.log");
      expect(log.match(/## tests: exit 1/g)).toHaveLength(2);
      expect(log).toContain("run again");
      await aleph(["drop", "flk3"]);
    }, 30_000);
  });

  describe("fix rounds", () => {
    const runs = (name: string) => readdirSync(jobsDir).filter((d) => d.includes(`-fac-${name}-`)).sort().map((d) => ({ id: d, ...state(d) }));

    test("a failed check goes back to the worker, whose note names it with the log; the job passes after 1 fix round", async () => {
      const r = await fjob("fix1", "fail-then-fix");
      const rs = runs("fix1");
      expect(rs.map((x) => [x.kind, x.state])).toEqual([["agent", "stuck"], ["agent", "passed"], ["land", "landed"]]);
      expect(rs[0]).toMatchObject({ reason: "tests failed", failed: "tests", next: "worker" });
      expect(rs[1].round).toBe(1);
      const p = readFileSync(join(fakeLog, "prompt"), "utf8");
      expect(p).toContain("The check `tests` failed");
      expect(p).toContain("FAIL is present 3");
      expect(told).toContain("fac/fix1 stuck; sent back to the worker");
      expect(runsLeft()).toEqual([]);
      expect(state(r.json.run).state).toBe("stuck");
      expect((await aleph(["report"])).stdout).toContain("fac/fix1 passed after 1 fix rounds");
    }, 30_000);

    test("a worker that keeps failing is stuck after 2 fix rounds, in 3 runs", async () => {
      await fjob("fixn", "fail-always");
      const rs = runs("fixn");
      expect(rs.map((x) => x.state)).toEqual(["stuck", "stuck", "stuck"]);
      expect(rs.at(-1)).toMatchObject({ reason: "tests failed after 2 fix rounds" });
      expect(rs.at(-1).next).toBeUndefined();
      await aleph(["drop", "fixn"]);
    }, 30_000);

    test("ALEPH_FIX_ROUNDS=0 is stuck at once, as before", async () => {
      await fjob("fix0", "fail-always", { ALEPH_FIX_ROUNDS: "0" });
      const rs = runs("fix0");
      expect(rs.length).toBe(1);
      expect(rs[0]).toMatchObject({ state: "stuck", reason: "tests failed" });
      expect(rs[0].next).toBeUndefined();
      await aleph(["drop", "fix0"]);
    }, 30_000);

    test("the time box and an error result get no fix round", async () => {
      await fjob("fixbox", "sleep", { ALEPH_JOB_TIMEOUT: "1" });
      await fjob("fixerr", "error");
      expect(runs("fixbox").map((x) => x.reason)).toEqual(["time box"]);
      expect(runs("fixerr").map((x) => x.reason)).toEqual(["API Error: 500"]);
      for (const n of ["fixbox", "fixerr"]) await aleph(["drop", n]);
    }, 30_000);
  });

  test("a worker silent for ALEPH_STALL_SECONDS is stuck as stalled, with no fix round", async () => {
    const t = performance.now();
    const r = await fjob("fstall", "quiet", { ALEPH_STALL_SECONDS: "2" });
    expect(performance.now() - t).toBeLessThan(10_000);
    expect(state(r.json.run)).toMatchObject({ state: "stuck", reason: "stalled: no output for 2 seconds" });
    await aleph(["drop", "fstall"]);
  }, 30_000);

  test("a worker that keeps printing is not stalled", async () => {
    const r = await fjob("fchat", "chatty", { ALEPH_STALL_SECONDS: "2" });
    expect(state(r.json.run).state).not.toBe("stuck");
    await aleph(["drop", "fchat"]);
  }, 30_000);

  test("a worker past the time box ends stuck as \"time box\"", async () => {
    const r = await fjob("fslow", "sleep", { ALEPH_JOB_TIMEOUT: "1" });
    expect(state(r.json.run)).toMatchObject({ state: "stuck", reason: "time box" });
    expect(runsLeft()).toEqual([]);
    await aleph(["drop", "fslow"]);
  });

  test("a held path needs Chris with the rule and the diff stat; his land adds Held-by", async () => {
    const r = await fjob("fheld", "commit held/x.txt");
    const s = state(r.json.run);
    expect(s).toMatchObject({ state: "needs-you", needs: "held", reason: "held path held/x.txt" });
    expect(s.stat).toContain("held/x.txt");
    const before = remoteGit("rev-parse", "main");
    expect(remoteGit("rev-parse", "main")).toBe(before);
    const l = await aleph(["land", "fheld"]);
    expect(state(l.json.run)).toMatchObject({ state: "landed", held: true });
    expect(remoteGit("log", "-1", "--format=%(trailers:only)", "main")).toContain("Held-by: Chris");
  });

  describe("the reviewer", () => {
    const rjob = (name: string, mark: string, action = `commit ${name}.txt`) =>
      aleph(["job", "fac", name, "--spec", specFile(`Goal: ${name} ${mark}\nACTION: ${action}\n`)]);
    const calls = () => existsSync(join(fakeLog, "review-calls")) ? readFileSync(join(fakeLog, "review-calls"), "utf8").length : 0;

    test("a pass lands; the prompt holds the item and the diff; the cost adds up", async () => {
      const r = await rjob("rpass", "REVIEW:pass");
      expect(state(r.json.run)).toMatchObject({ state: "passed", cost: 0.03 });
      const p = readFileSync(join(fakeLog, "review-prompt"), "utf8");
      expect(p).toContain("Goal: rpass REVIEW:pass");
      expect(p).toContain("+++ b/rpass.txt");
      expect(runsLeft()).toEqual([]);
      expect(state((await aleph(["land", "rpass"])).json.run).state).toBe("landed");
    });

    test("a hold needs Chris, pushes nothing, and his land adds Held-by", async () => {
      const r = await rjob("rhold", "REVIEW:hold");
      expect(state(r.json.run)).toMatchObject({ state: "needs-you", needs: "review", reason: "reviewer: tests do not cover the new flag" });
      expect(state(r.json.run).stat).toContain("rhold.txt");
      const before = remoteGit("rev-parse", "main");
      expect(before).toBe(remoteGit("rev-parse", "main"));
      expect(remoteGit("log", "-1", "--format=%s", "main")).not.toBe("add rhold.txt");
      const l = await aleph(["land", "rhold"]);
      expect(state(l.json.run)).toMatchObject({ state: "landed", held: true });
      expect(remoteGit("log", "-1", "--format=%(trailers:only)", "main")).toContain("Held-by: Chris");
    });

    test("no verdict line, or an error result, holds the run", async () => {
      expect(state((await rjob("rnone", "REVIEW:none")).json.run)).toMatchObject({ state: "needs-you", needs: "review", reason: expect.stringMatching(/^reviewer: no verdict/) });
      expect(state((await rjob("rerr", "REVIEW:error")).json.run)).toMatchObject({ state: "needs-you", reason: "reviewer: no verdict (API Error: 529)" });
      for (const n of ["rnone", "rerr"]) await aleph(["drop", n]);
    });

    test("a reviewer past the time box holds the run", async () => {
      const slow = join(base, "slow-reviewer");
      writeFileSync(slow, "#!/bin/bash\nsleep 60\n", { mode: 0o755 });
      const t = await aleph(["job", "fac", "rslow2", "--spec", specFile("Goal: g\nACTION: commit rslow2.txt\n")], { ALEPH_REVIEWER_CMD: slow, ALEPH_REVIEW_TIMEOUT: "1" });
      expect(state(t.json.run)).toMatchObject({ state: "needs-you", reason: "reviewer: no verdict (time box)" });
      await aleph(["drop", "rslow2"]);
    });

    test("a held path holds without a review", async () => {
      const n = calls();
      const r = await rjob("rheld", "REVIEW:pass", "commit held/r.txt");
      expect(state(r.json.run)).toMatchObject({ needs: "held" });
      expect(calls()).toBe(n);
      await aleph(["drop", "rheld"]);
    });
  });

  test("a change to an existing test goes to the reviewer; its hold needs a review; drop leaves the item open", async () => {
    const id = (await aleph(["todo", "add", "fac", "tests"])).json.added;
    const r = await aleph(["job", "fac", "ftest", "--spec", specFile("Goal: ftest REVIEW:hold\nACTION: commit old.test.ts\n"), "--todo", String(id)]);
    expect(state(r.json.run)).toMatchObject({ state: "needs-you", needs: "review", reason: expect.stringMatching(/^reviewer: hold|^reviewer: tests do not/) });
    expect(readFileSync(join(fakeLog, "review-prompt"), "utf8")).toContain("The diff changes the test old.test.ts");
    expect((await aleph(["drop", "ftest"])).code).toBe(0);
    expect((await aleph(["todo", "show", "fac", String(id), "--json"])).json.status).toBe("open");
    expect(factoryBranch("ftest")).toBe(false);
  });

  test("a follow-up on a stuck job starts from the job's previous branch", async () => {
    const r = await fjob("fagain", "commit FAIL");
    expect(state(r.json.run)).toMatchObject({ state: "stuck", reason: "tests failed" });
    expect(state(r.json.run).checks).toEqual([{ name: "tests", ok: false, seconds: expect.any(Number) }]);
    const f = await fjob("fagain", "branchlog");
    expect(readFileSync(join(fakeLog, "branchlog"), "utf8")).toContain("add FAIL");
    expect(state(f.json.run).state).toBe("passed");
    await aleph(["drop", "fagain"]);
  });

  test("DEFAULT lines and the cost reach the report once; FOLLOWUP lines become items", async () => {
    const r = await fjob("fdefault", "defaults");
    expect(state(r.json.run)).toMatchObject({ state: "passed", cost: 0.25, defaults: ["which colour? -> blue"] });
    const items = (await aleph(["todo", "list", "fac", "--label", "followup", "--json"])).json;
    expect(items.map((i: any) => i.title)).toContain("paint the fence");
    const rep = await aleph(["report"]);
    expect(rep.stdout).toContain("fac/fdefault passed");
    expect(rep.stdout).toContain("DEFAULT: which colour? -> blue");
    expect(rep.stdout).toContain("cost $0.2500 at the API price");
    expect(rep.stdout).toContain("fac/fheld needs-you (held): held path held/x.txt");
    expect(rep.stdout).toContain("aleph land fheld");
    expect(rep.stdout).toMatch(/runs in the last 24 hours: \d+ of 100, \$\d+\.\d{4} at the API price/);
    expect(state(r.json.run)).toMatchObject({ shown: true, told: true });
    expect((await aleph(["report"])).stdout).not.toContain("fdefault");
    await aleph(["drop", "fdefault"]);
  });

  test("the report hook prints JSON for SessionStart, and nothing when nothing is new", async () => {
    const behind = await aleph(["report", "--hook"]);
    expect(behind.json.hookSpecificOutput.additionalContext).toMatch(/repo is \d+ commits? behind origin\/main; git pull brings:\n[\s\S]*held\/x\.txt/);
    sh(repo, "git", "merge", "-q", "--ff-only", "origin/main");
    const quiet = await aleph(["report", "--hook"]);
    expect(quiet.stdout.trim()).toBe("");
    await fjob("fhook", "error");
    const h = await aleph(["report", "--hook"]);
    expect(h.json.hookSpecificOutput.additionalContext).toContain("fac/fhook stuck: API Error: 500");
    expect(h.json.systemMessage).toContain("fac/fhook stuck");
    await aleph(["drop", "fhook"]);
  });

  test("a failed probe starts no run and puts a health line in the report", async () => {
    mkdirSync(join(base, "factory"), { recursive: true });
    writeFileSync(join(base, "factory", "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: false, failed: ["read ~/.ssh"] }));
    const id = (await aleph(["todo", "add", "fac", "blocked by the probe", "--labels", "goal"])).json.added;
    const t = await aleph(["tick"]);
    expect(t.json.started).toEqual([]);
    expect(t.json.skipped[0]).toContain("failed: read ~/.ssh");
    expect((await aleph(["report"])).stdout).toContain("health: the sandbox probe at");
    await aleph(["todo", "drop", "fac", String(id), "test over"]);
    writeFileSync(join(base, "factory", "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, failed: [] }));
  });

  test("the nightly sweep files one proposal per stale package, once, and a moved latest files one more", async () => {
    const table = (latest: string) => [
      "| Package          | Current | Update | Latest |",
      "|------------------|---------|--------|--------|",
      "| left-pad         | 1.0.0   | 1.0.0  | 1.2.0  |",
      `| typescript (dev) | 5.8.3   | 5.9.2  | ${latest} |`,
    ].join("\n");
    const cmd = join(base, "outdated.sh");
    // The probe runs with the tick; the hook makes it pass without the sandbox.
    const give = (latest: string) => writeFileSync(cmd, `#!/bin/bash\ncat <<'EOF'\n${table(latest)}\nEOF\n`, { mode: 0o755 });
    const stale = () => rmSync(join(base, "factory", "probe.json"), { force: true });
    const proposals = async () => ((await aleph(["todo", "list", "fac", "--json"])).json as any[]).filter((r) => r.title.startsWith("Update "));
    give("5.9.2");
    stale();
    await aleph(["tick"], { ALEPH_OUTDATED_CMD: cmd, ALEPH_PROBE_FAKE: "fail" });
    expect(await proposals()).toHaveLength(0);
    stale();
    await aleph(["tick"], { ALEPH_OUTDATED_CMD: cmd, ALEPH_PROBE_FAKE: "pass" });
    const first = await proposals();
    expect(first.map((r) => r.title).sort()).toEqual(["Update left-pad 1.0.0 to 1.2.0", "Update typescript 5.8.3 to 5.9.2"]);
    for (const r of first) {
      const item = (await aleph(["todo", "show", "fac", String(r.id), "--json"])).json;
      expect(item.labels).toEqual(["proposal", "deps"]);
    }
    const rep = (await aleph(["report"])).stdout;
    expect(rep).toContain("Update left-pad 1.0.0 to 1.2.0");
    expect((await aleph(["report"])).stdout).not.toContain("Update left-pad");
    stale();
    await aleph(["tick"], { ALEPH_OUTDATED_CMD: cmd, ALEPH_PROBE_FAKE: "pass" });
    expect(await proposals()).toHaveLength(2);
    give("5.9.3");
    stale();
    await aleph(["tick"], { ALEPH_OUTDATED_CMD: cmd, ALEPH_PROBE_FAKE: "pass" });
    expect((await proposals()).map((r) => r.title)).toContain("Update typescript 5.8.3 to 5.9.3");
    expect(await proposals()).toHaveLength(3);
    for (const r of await proposals()) await aleph(["todo", "drop", "fac", String(r.id), "test over"]);
    writeFileSync(join(base, "factory", "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, failed: [] }));
  }, 120_000);

  test("a tick starts one run per open goal, lands it, and then has nothing to start", async () => {
    const id = (await aleph(["todo", "add", "fac", "ship the goal", "--labels", "goal", "--body", "-"], {}, "ACTION: commit goal.txt\n")).json.added;
    const t = await aleph(["tick"]);
    expect(t.json.skipped).toEqual([]);
    expect(t.json.started).toEqual([`fac-${id}`]);
    const runs = readdirSync(jobsDir).filter((d) => d.includes(`-fac-fac-${id}-`)).sort();
    expect(runs.map((d) => [state(d).kind, state(d).state])).toEqual([["agent", "passed"], ["land", "landed"]]);
    expect((await aleph(["todo", "show", "fac", String(id), "--json"])).json.status).toBe("done");
    expect(remoteGit("log", "-1", "--format=%(trailers:only)", "main")).toContain(`Item: fac-${id}`);
    expect((await aleph(["tick"])).json.started).toEqual([]);
  }, 30_000);

  test("a tick skips a goal whose job is stuck, and the cap stops it", async () => {
    const id = (await aleph(["todo", "add", "fac", "a stuck goal", "--labels", "goal", "--body", "-"], {}, "ACTION: error\n")).json.added;
    expect((await aleph(["tick"])).json.started).toEqual([`fac-${id}`]);
    const again = await aleph(["tick"]);
    expect(again.json.started).toEqual([]);
    expect(again.json.skipped).toContain(`fac-${id}: stuck`);
    await aleph(["drop", `fac-${id}`]);
    const capped = await aleph(["tick"], { ALEPH_DAY_CAP: "0" });
    expect(capped.json.started).toEqual([]);
    expect(capped.json.skipped).toContain(`fac-${id}: cap of 0 runs in 24 hours`);
    await aleph(["todo", "drop", "fac", String(id), "test over"]);
  }, 30_000);

  test("a tick triages an open issue that is not a goal, and its line counts the verdicts", async () => {
    const cmd = join(base, "triage-fake");
    writeFileSync(cmd, `#!/bin/bash\ncat > /dev/null\necho '{"verdict":"live","note":"check the live site"}'\n`, { mode: 0o755 });
    const id = (await aleph(["todo", "add", "fac", "needs a live look"])).json.added;
    const first = (await aleph(["todo", "list", "fac", "--json"])).json.filter((i: any) => i.status === "open" && !i.labels.some((l: string) => ["goal", "needs-chris", "triaged", "proposal"].includes(l)))[0];
    const t = await aleph(["tick"], { ALEPH_TRIAGE_CAP: "1", ALEPH_TRIAGE_CMD: cmd });
    expect(t.json.triaged).toEqual({ live: 1 });
    expect((await aleph(["todo", "show", "fac", String(first.id), "--json"])).json.labels).toEqual(expect.arrayContaining(["live-check", "triaged"]));
    expect(readdirSync(jobsDir).filter((d) => d.endsWith("-triage")).map((d) => state(d).kind)).toContain("triage");
    expect(readFileSync(join(base, "factory", "tick.log"), "utf8")).toContain("triaged live 1");
    expect(id).toBeGreaterThan(0);
  }, 30_000);

  test("a tick starts no run while the waiting cap binds, and a drop frees a place", async () => {
    const env = { ALEPH_WAITING_CAP: "2" };
    await fjob("fwait1", "commit held/w1.txt");
    await fjob("fwait2", "commit held/w2.txt");
    const id = (await aleph(["todo", "add", "fac", "behind the cap", "--labels", "goal", "--body", "-"], {}, "ACTION: commit capped.txt\n")).json.added;
    const t = await aleph(["tick"], env);
    expect(t.json.started).toEqual([]);
    expect(t.json.skipped).toContain(`fac-${id}: 2 runs wait for Chris`);
    expect((await aleph(["report"], env)).stdout).toContain("health: 2 runs wait for Chris; no new run starts");
    await aleph(["drop", "fwait1"]);
    expect((await aleph(["tick"], env)).json.started).toEqual([`fac-${id}`]);
    await aleph(["drop", "fwait2"]);
  }, 30_000);

  test("pause stops the tick and the unit's follow-up land, but not Chris's land", async () => {
    expect((await aleph(["pause"])).json).toEqual({ paused: true });
    const id = (await aleph(["todo", "add", "fac", "while paused", "--labels", "goal", "--body", "-"], {}, "ACTION: commit paused.txt\n")).json.added;
    expect((await aleph(["tick"])).json).toMatchObject({ started: [], paused: true });
    expect(readFileSync(join(base, "factory", "tick.log"), "utf8")).toContain("paused");
    const r = await fjob("fpaused", "commit fpaused.txt", {}, ["--land"]);
    expect(state(r.json.run).state).toBe("passed");
    expect(state(r.json.run).next).toBeUndefined();
    expect(file(r.json.run, "next.log")).toContain("paused");
    const l = await aleph(["land", "fpaused"]);
    expect(state(l.json.run).state).toBe("landed");
    expect((await aleph(["resume"])).json).toEqual({ paused: false });
    expect((await aleph(["tick"])).json.started).toEqual([`fac-${id}`]);
  }, 30_000);

  test("a red main starts no run, is checked once per commit, and clears with a passing commit", async () => {
    const trees = () => existsSync(join(base, "trees")) ? readFileSync(join(base, "trees"), "utf8").trim().split("\n").length : 0;
    sh(other, "git", "pull", "-q", "--rebase", "origin", "main");
    writeFileSync(join(other, "FAIL"), "red\n");
    sh(other, "git", "add", "FAIL"); sh(other, "git", "commit", "-qm", "break main"); sh(other, "git", "push", "-q", "origin", "main");
    const sha7 = remoteGit("rev-parse", "main").slice(0, 7);
    const id = (await aleph(["todo", "add", "fac", "wait for green", "--labels", "goal", "--body", "-"], {}, "ACTION: commit green.txt\n")).json.added;
    const before = trees();
    const t = await aleph(["tick"]);
    expect(t.json.started).toEqual([]);
    expect(t.json.skipped).toEqual([`fac-${id}: main is red at ${sha7}: tests`]);
    expect((await aleph(["report"])).stdout).toContain(`health: fac main is red at ${sha7}: tests`);
    expect(trees()).toBe(before);
    expect((await aleph(["tick"])).json.skipped).toEqual([`fac-${id}: main is red at ${sha7}: tests`]);
    expect(trees()).toBe(before);
    sh(other, "git", "rm", "-q", "FAIL"); sh(other, "git", "commit", "-qm", "fix main"); sh(other, "git", "push", "-q", "origin", "main");
    expect((await aleph(["tick"])).json.started).toEqual([`fac-${id}`]);
    expect(trees()).toBeGreaterThan(before);
    expect((await aleph(["report"])).stdout).not.toContain("main is red");
  }, 60_000);

  describe("dispatch", () => {
    let startLog: string, startCmd: string;
    const on = (extra: Record<string, string> = {}) => ({ ALEPH_DISPATCH: "on", ALEPH_START_CMD: startCmd, START_LOG: startLog, ...extra });
    const started = () => (existsSync(startLog) ? readFileSync(startLog, "utf8").trim().split("\n").filter(Boolean) : []);
    const gate = (n: string) => join(base, `gate-${n}`);
    const goal = async (n: string) =>
      (await aleph(["todo", "add", "fac", `dispatch ${n}`, "--labels", "goal", "--body", "-"], {}, `ACTION: hold ${gate(n)}\n`)).json.added as number;
    const until = async (f: () => boolean) => { for (let i = 0; i < 300 && !f(); i++) await Bun.sleep(100); expect(f()).toBe(true); };
    const settled = (id: number) => readdirSync(jobsDir).filter((r) => r.includes(`-fac-fac-${id}-`)).every((r) => state(r).state === "passed");
    const ids: number[] = [];
    beforeAll(() => {
      startLog = join(base, "start.log");
      startCmd = join(base, "start-cmd");
      // Starts the job in the background, as `systemd-run` does, and returns once its unit has a pid.
      writeFileSync(startCmd, `#!/bin/bash\necho "$2" >> "$START_LOG"\nALEPH_JOB_FOREGROUND=1 bun ${CLI} job "$1" "$2" --spec - --todo "$3" > /dev/null 2>&1 < /dev/stdin &\nfor i in $(seq 100); do ls ${jobsDir}/*-fac-"$2"-*/pid > /dev/null 2>&1 && exit 0; sleep 0.1; done\n`, { mode: 0o755 });
    });
    beforeEach(() => { rmSync(startLog, { force: true }); });
    afterAll(async () => {
      for (const n of ["a", "b", "c", "d", "f"]) writeFileSync(gate(n), "");
      await Bun.sleep(3000);
      for (const id of ids) {
        await aleph(["drop", `fac-${id}`]);
        await aleph(["todo", "drop", "fac", String(id), "test over"]);
      }
    });

    test("starts ready goals up to the live cap, and the next when a run ends, with no tick", async () => {
      const a = await goal("a"), b = await goal("b"), c = await goal("c");
      ids.push(a, b, c);
      const d = await aleph(["dispatch"], on({ ALEPH_LIVE_CAP: "2" }));
      expect(d.json.started).toEqual([`fac-${a}`, `fac-${b}`]);
      expect(d.json.skipped).toEqual([`fac-${c}: 2 agent runs are live`]);
      expect(started()).toEqual([`fac-${a}`, `fac-${b}`]);
      writeFileSync(gate("a"), "");
      await until(() => started().length === 3);
      expect(started()[2]).toBe(`fac-${c}`);
      writeFileSync(gate("b"), "");
      writeFileSync(gate("c"), "");
      await until(() => ids.every(settled));
    }, 60_000);

    test("two dispatches at once start each goal once", async () => {
      const d = await goal("d");
      ids.push(d);
      const [x, y] = await Promise.all([aleph(["dispatch"], on({ ALEPH_LIVE_CAP: "5" })), aleph(["dispatch"], on({ ALEPH_LIVE_CAP: "5" }))]);
      expect(started().filter((n) => n === `fac-${d}`)).toHaveLength(1);
      expect([...x.json.started, ...y.json.started].filter((n: string) => n === `fac-${d}`)).toHaveLength(1);
      writeFileSync(gate("d"), "");
      await until(() => settled(d));
    }, 60_000);

    test("a dispatch while paused or with main red starts nothing, and adding a goal starts its run with no tick", async () => {
      await aleph(["pause"]);
      expect((await aleph(["dispatch"], on())).json).toMatchObject({ started: [], paused: true });
      const held = await aleph(["todo", "add", "fac", "added while paused", "--labels", "goal"], on());
      expect(started()).toEqual([]);
      await aleph(["resume"]);
      sh(other, "git", "pull", "-q", "--rebase", "origin", "main");
      writeFileSync(join(other, "FAIL"), "red\n");
      sh(other, "git", "add", "FAIL"); sh(other, "git", "commit", "-qm", "break main"); sh(other, "git", "push", "-q", "origin", "main");
      const red = await aleph(["dispatch"], on());
      expect(red.json.started).toEqual([]);
      expect(red.json.skipped[0]).toContain("main is red");
      sh(other, "git", "rm", "-q", "FAIL"); sh(other, "git", "commit", "-qm", "fix main"); sh(other, "git", "push", "-q", "origin", "main");
      await aleph(["todo", "drop", "fac", String(held.json.added), "test over"]);
      const add = await aleph(["todo", "add", "fac", "starts at once", "--labels", "goal", "--body", "-"], on(), `ACTION: hold ${gate("f")}\n`);
      ids.push(add.json.added);
      expect(add.code).toBe(0);
      expect(started()).toEqual([`fac-${add.json.added}`]);
      writeFileSync(gate("f"), "");
      await until(() => settled(add.json.added));
    }, 90_000);
  });
});

describe("milestone 2", () => {
  const remoteGit = (...a: string[]) => sh(base, "git", "--git-dir", remote, ...a);
  const status = async (item: string) => (await aleph(["status", item, "--json"])).json;
  function pushFromOther(message: string, f: string): void {
    sh(other, "git", "pull", "-q", "--rebase", "origin", "main");
    writeFileSync(join(other, f), `${Math.random()}\n`);
    sh(other, "git", "add", f);
    sh(other, "git", "commit", "-qm", message);
    sh(other, "git", "push", "-q", "origin", "main");
  }

  test("three ready branches land one at a time, in the order their lands were made", async () => {
    for (const n of ["qa", "qb", "qc"]) await job(n, `commit pair/${n}.txt`);
    const lands = await Promise.all(["qa", "qb", "qc"].map((n) => aleph(["land", n])));
    const order = lands.map((l) => state(l.json.run)).sort((a, b) => a.made - b.made).map((s) => s.name);
    expect(lands.map((l) => state(l.json.run).state)).toEqual(["landed", "landed", "landed"]);
    expect(remoteGit("log", "-3", "--reverse", "--format=%s", "main").split("\n")).toEqual(order.map((n) => `add pair/${n}.txt`));
    // Each is one squash commit on the one before: no merge commits.
    expect(remoteGit("rev-list", "--merges", "-3", "main")).toBe("");
  }, 60_000);

  test("a land whose push went through before it died finds its commit and does not merge again", async () => {
    const j = await job("crashed", "commit crashed.txt");
    pushFromOther(`add crashed.txt\n\nJob: ${j.json.job}`, "crashed.txt");
    const pushed = remoteGit("rev-parse", "main");
    const l = await aleph(["land", "crashed"]);
    expect(state(l.json.run)).toMatchObject({ state: "landed", commit: pushed });
    expect(remoteGit("rev-parse", "main")).toBe(pushed);
    expect(file(l.json.run, "land.log")).toContain(`## already on main as ${pushed}`);
  });

  test("an item is done while a commit on main names it in its trailers, and not once that commit is reverted", async () => {
    const id = (await aleph(["todo", "add", "fac", "derive me"])).json.added;
    expect(await status(`fac-${id}`)).toMatchObject({ state: "open" });
    await fjobFor("fderive", "commit derive.txt", id);
    expect(await status(`fac-${id}`)).toMatchObject({ state: "running", why: "its job is passed" });
    await aleph(["land", "fderive"]);
    const landed = remoteGit("rev-parse", "main");
    expect(await status(`fac-${id}`)).toMatchObject({ state: "done", why: `commit ${landed.slice(0, 7)} on origin/main` });
    sh(other, "git", "pull", "-q", "--rebase", "origin", "main");
    sh(other, "git", "revert", "--no-edit", landed);
    sh(other, "git", "push", "-q", "origin", "main");
    // The store still says done, but a factory run touched the item, so only a trailer makes it done.
    expect(await status(`fac-${id}`)).toMatchObject({ state: "open" });
  }, 30_000);

  test("only the trailer block counts; a hand-done item keeps the store's done; dropped wins", async () => {
    const id = (await aleph(["todo", "add", "fac", "named in prose"])).json.added;
    pushFromOther(`prose\n\nItem: fac-${id} is named here\n\nbut not as a trailer.`, "prose.txt");
    expect(await status(`fac-${id}`)).toMatchObject({ state: "open" });
    pushFromOther(`real\n\nItem: fac-${id}`, "real.txt");
    expect(await status(`fac-${id}`)).toMatchObject({ state: "done" });
    const hand = (await aleph(["todo", "add", "fac", "done by hand"])).json.added;
    await aleph(["todo", "done", "fac", String(hand)]);
    expect(await status(`fac-${hand}`)).toMatchObject({ state: "done", why: "the store says done" });
    await aleph(["todo", "drop", "fac", String(id), "no longer wanted"]);
    expect(await status(`fac-${id}`)).toMatchObject({ state: "dropped" });
    const stuck = (await aleph(["todo", "add", "fac", "a stuck one"])).json.added;
    await fjobFor("fstuckitem", "error", stuck);
    expect(await status(`fac-${stuck}`)).toMatchObject({ state: "stuck" });
    const held = (await aleph(["todo", "add", "fac", "a held one"])).json.added;
    await fjobFor("fhelditem", "commit held/y.txt", held);
    expect(await status(`fac-${held}`)).toMatchObject({ state: "needs-you" });
    for (const n of ["fstuckitem", "fhelditem"]) await aleph(["drop", n]);
    expect((await aleph(["status", "fac-999"])).stderr).toContain("fac has no issue 999");
  }, 30_000);

  test("aleph status with no item gives the derived state of each open item in the recent repos", async () => {
    const id = (await aleph(["todo", "add", "fac", "listed by status"])).json.added;
    const r = await aleph(["status", "--json"]);
    expect(r.code).toBe(0);
    expect(r.json.find((s: any) => s.item === `fac-${id}`)).toMatchObject({ state: "open" });
    await aleph(["todo", "done", "fac", String(id)]);
    expect((await aleph(["status", "--json"])).json.find((s: any) => s.item === `fac-${id}`)).toBeUndefined();
  }, 30_000);

  test("aleph status inside the sandbox, from the bundle, says what it says outside", async () => {
    const done = (await aleph(["todo", "add", "fac", "landed one"])).json.added;
    pushFromOther(`landed\n\nItem: fac-${done}`, "landed-one.txt");
    const open = (await aleph(["todo", "add", "fac", "open one"])).json.added;
    const items = [`fac-${done}`, `fac-${open}`];
    const r = await aleph(["job", "fac", "finside", "--spec", specFile(`Goal: inside\nACTION: status ${CLI} ${items.join(" ")}\n`)]);
    expect(state(r.json.run).state).toBe("passed");
    const inside = readFileSync(join(fakeLog, "status-inside"), "utf8").trim().split(/\n(?=\{)/).map((t) => JSON.parse(t));
    const outside = await Promise.all(items.map(status));
    expect(inside).toEqual(outside);
    expect(outside.map((s: any) => s.state)).toEqual(["done", "open"]);
    await aleph(["drop", "finside"]);
  }, 30_000);
});

async function fjobFor(name: string, action: string, id: number) {
  return aleph(["job", "fac", name, "--spec", specFile(`Goal: ${name}\nACTION: ${action}\n`), "--todo", String(id)]);
}

describe("prospective memory", () => {
  const NOW = { ALEPH_NOW: "2026-10-27T12:00:00" };
  // A fresh probe, so the tick does not run one.
  beforeAll(() => {
    mkdirSync(join(base, "factory"), { recursive: true });
    writeFileSync(join(base, "factory", "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, failed: [] }));
  });
  const add = async (title: string, ...more: string[]) => (await aleph(["todo", "add", "fac", title, ...more])).json.added as number;

  test("a tick skips a goal due tomorrow, and one that waits on an open item, until it is ready", async () => {
    const later = await add("due tomorrow", "--labels", "goal", "--due", "2026-10-28");
    const first = await add("the first thing");
    const second = await add("waits on the first", "--labels", "goal", "--waiting-on", `fac-${first}`);
    const t = await aleph(["tick"], NOW);
    expect(t.json.skipped).toContain(`fac-${later}: due 2026-10-28`);
    expect(t.json.skipped).toContain(`fac-${second}: waiting on fac-${first}`);
    expect(t.json.started).not.toContain(`fac-${later}`);
    expect(t.json.started).not.toContain(`fac-${second}`);
    await aleph(["todo", "done", "fac", String(first)]);
    expect((await aleph(["tick"], NOW)).json.started).toContain(`fac-${second}`);
    // The day after, the dated goal starts.
    expect((await aleph(["tick"], { ALEPH_NOW: "2026-10-28T08:00:00" })).json.started).toContain(`fac-${later}`);
    for (const id of [later, first, second]) await aleph(["todo", "drop", "fac", String(id), "test over"]);
  }, 60_000);

  test("one report after a gap lists every item that fell due under 'came due', and the next lists none", async () => {
    const ids = [await add("due one", "--due", "2026-11-01"), await add("due two", "--due", "2026-11-10"), await add("due three", "--due", "2026-11-20")];
    const future = await add("due much later", "--due", "2027-01-01");
    const first = await aleph(["report"], { ALEPH_NOW: "2026-12-01T09:00:00" });
    expect(first.stdout).toContain("came due");
    for (const [n, id] of ids.entries()) expect(first.stdout).toContain(`fac-${id} due ${["one", "two", "three"][n]}`);
    expect(first.stdout).not.toContain(`fac-${future}`);
    const second = await aleph(["report"], { ALEPH_NOW: "2026-12-01T09:00:00" });
    expect(second.stdout).not.toContain("came due");
    for (const id of ids) expect(second.stdout).not.toContain(`fac-${id} `);
    expect(readFileSync(join(base, "factory", "seen"), "utf8")).toContain(`fac-${ids[0]}`);
    for (const id of [...ids, future]) await aleph(["todo", "drop", "fac", String(id), "test over"]);
  }, 60_000);
});
