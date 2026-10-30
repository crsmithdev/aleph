import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeRun, type Run } from "./lib/ledger.ts";
import { config as storeConfig } from "../todo/lib/store.ts";
import { renderItem } from "../todo/lib/todo.ts";

export const CLI = join(import.meta.dir, "cli.ts");
export let base: string, remote: string, repo: string, other: string, items: string, itemsRemote: string, jobsDir: string, fake: string, reviewer: string, fakeLog: string, setupLog: string;
export let server: ReturnType<typeof Bun.serve>;
export let lf: ReturnType<typeof Bun.serve>;
export let lfStatus = 200;
export let lfPosts: any[] = [];
export const told: string[] = [];
export let onTell: ((text: string) => void) | undefined;

/**
 * Writes the fake start command: it starts the job in the background, as `systemd-run` does, and exits 0 once
 * a run folder that was not there before the start has a pid. It exits 1 when the job process is gone or has
 * warned that its unit wrote no pid: the job bounds its own waits (the locks, and 10 s for the pid), so a start
 * queued behind others under load is not cut off by a fixed window here.
 * While it runs, `$START_LOG.busy.<pid>` exists: see `starting`.
 */
export function startScript(path: string, jobsDir: string): void {
  writeFileSync(path, `#!/bin/bash
busy="$START_LOG.busy.$$"
touch "$busy"
joberr="$START_LOG.err.$$"
trap 'rm -f "$busy" "$joberr"' EXIT
echo "$2" >> "$START_LOG"
before=$(ls -d ${jobsDir}/*-fac-"$2"-* 2>/dev/null)
ALEPH_JOB_FOREGROUND=1 bun ${CLI} job "$1" "$2" --spec - --todo "$3" > /dev/null 2> "$joberr" < /dev/stdin &
job=$!
for ((;;)); do
  for d in $(ls -d ${jobsDir}/*-fac-"$2"-* 2>/dev/null); do
    [ -e "$d/pid" ] && ! grep -qxF "$d" <<< "$before" && exit 0
  done
  kill -0 $job 2>/dev/null || { cat "$joberr" >&2; exit 1; }
  grep -q "wrote no pid" "$joberr" && { cat "$joberr" >&2; exit 1; }
  sleep 0.1
done
`, { mode: 0o755 });
}

/** A start command from `startScript` that logs to `startLog` has not exited: its run folder may not be there yet. */
export const starting = (startLog: string): boolean => {
  const dir = join(startLog, ".."), name = startLog.slice(dir.length + 1) + ".busy.";
  return readdirSync(dir).some((f) => f.startsWith(name));
};

/**
 * A run's unit process is alive. Unlike `isLive`, this ignores `exit`: the unit writes `exit` and then awaits its
 * run-end dispatch, which may still start goals or hold the dispatch locks.
 */
export const unitAlive = (folder: string): boolean => {
  try {
    const pid = Number(readFileSync(join(folder, "pid"), "utf8").trim());
    return Number.isInteger(pid) && pid > 0 && readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " ").includes(folder);
  } catch {
    return false;
  }
};

/** An `aleph dispatch` or `aleph triage` of this test file's factory is running, e.g. a detached one from a transition. */
export const dispatching = (): boolean => {
  const mine = `ALEPH_FACTORY_DIR=${join(base, "factory")}\0`;
  return readdirSync("/proc").filter((p) => /^\d+$/.test(p)).some((p) => {
    try {
      const cmd = readFileSync(`/proc/${p}/cmdline`, "utf8").split("\0");
      return cmd.includes(CLI) && ["dispatch", "triage"].includes(cmd[cmd.indexOf(CLI) + 1]) && readFileSync(`/proc/${p}/environ`, "utf8").includes(mine);
    } catch {
      return false;
    }
  });
};

const tail = (f: string, n = 15) => (existsSync(f) ? readFileSync(f, "utf8").trimEnd().split("\n").slice(-n).join("\n") : "(none)");
/** What a failed concurrency test needs to name its cause: the runs of the given goal ids with their pid and exit, and the factory logs. */
export function diagnose(label: string, ids: number[], ...results: { code: number; stdout: string; stderr: string }[]): string {
  const runs = existsSync(jobsDir) ? readdirSync(jobsDir).sort().filter((r) => ids.some((id) => r.includes(`-fac-fac-${id}-`)))
    .map((r) => `--- ${r}: pid ${tail(join(jobsDir, r, "pid"), 1)}, exit ${tail(join(jobsDir, r, "exit"), 1)}`) : [];
  return [`${label}`, ...results.map((x, i) => `--- dispatch ${"xy"[i] ?? i}: exit ${x.code}\nstdout: ${x.stdout.trim()}\nstderr: ${tail_(x.stderr)}`), ...runs,
    `--- factory/tick.log\n${tail(join(base, "factory", "tick.log"))}`, `--- factory/dispatch.log\n${tail(join(base, "factory", "dispatch.log"))}`].join("\n");
}
const tail_ = (s: string) => s.trimEnd().split("\n").slice(-15).join("\n");

/**
 * Waits up to 30 s for `f`. When it fails, the error holds the tails of the factory's tick.log (every dispatch
 * writes why it skipped a goal there) and dispatch.log, and of the run-end dispatch logs, so a flake names its cause.
 */
export async function until(f: () => boolean): Promise<void> {
  for (let i = 0; i < 300 && !f(); i++) await Bun.sleep(100);
  if (f()) return;
  const runEnd = existsSync(jobsDir) ? readdirSync(jobsDir).sort().slice(-4).map((r) => `--- ${r}/dispatch.log\n${tail(join(jobsDir, r, "dispatch.log"), 5)}`) : [];
  throw new Error([`until: not true after 30 s`, `--- factory/tick.log\n${tail(join(base, "factory", "tick.log"))}`,
    `--- factory/dispatch.log\n${tail(join(base, "factory", "dispatch.log"))}`, ...runEnd].join("\n"));
}

export const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
export function sh(cwd: string, ...args: string[]): string {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
  return p.stdout.toString().trim();
}

export function env(extra: Record<string, string> = {}): Record<string, string> {
  return {
    ...(process.env as Record<string, string>), ...gitEnv,
    ALEPH_JOBS_DIR: jobsDir, ALEPH_REPOS: join(base, "repos.json"), ALEPH_ITEMS: items, ALEPH_JOB_FOREGROUND: "1",
    ALEPH_WORKER_CMD: fake, ALEPH_REVIEWER_CMD: reviewer, ALEPH_REVIEW2_CMD: join(base, "fake-review2"), ALEPH_FIREFIGHTER_CMD: join(base, "fake-firefighter"), XDG_RUNTIME_DIR: join(base, "run"), FAKE_LOG: fakeLog, SETUP_LOG: setupLog,
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
    // The vault is empty and under base, so no test reads or writes the real ~/.aleph/vault.
    ALEPH_VAULT: join(base, "vault"),
    SIDETONE_TELL_URL: `https://127.0.0.1:${server.port}/tell`, ...extra,
  };
}
export async function aleph(args: string[], extra: Record<string, string> = {}, stdin?: string) {
  const p = Bun.spawn(["bun", CLI, ...args], { cwd: base, env: env(extra), stdin: stdin === undefined ? "ignore" : new Blob([stdin]), stdout: "pipe", stderr: "pipe" });
  const code = await p.exited;
  const stdout = await new Response(p.stdout).text();
  let json: any = null;
  try { json = JSON.parse(stdout); } catch {}
  return { code, stdout, stderr: await new Response(p.stderr).text(), json };
}
export function specFile(text: string): string {
  const f = join(base, `spec-${crypto.randomUUID()}.md`);
  writeFileSync(f, text);
  return f;
}
export const job = (name: string, action: string, extra: Record<string, string> = {}, repoKey = "demo") =>
  aleph(["job", repoKey, name, "--spec", specFile(`Goal: ${name}\nACTION: ${action}\n`)], extra);
/** A commit on origin/main from the other clone, so a land's checks see a main the run's own checks did not. */
export function moveMain(): void {
  sh(other, "git", "pull", "-q", "--rebase", "origin", "main");
  writeFileSync(join(other, `moved-${Math.random()}`), "x\n");
  sh(other, "git", "add", ".");
  sh(other, "git", "commit", "-qm", "moved");
  sh(other, "git", "push", "-q", "origin", "main");
}
export const state = (run: string) => JSON.parse(readFileSync(join(jobsDir, run, "state.json"), "utf8"));
/** `state` for a run that may be starting: its folder exists a moment before its state.json, so a missing file reads as no state yet. */
export const stateNow = (run: string): { state: string } => { try { return state(run); } catch { return { state: "" }; } };
export const file = (run: string, f: string) => readFileSync(join(jobsDir, run, f), "utf8");
export const worktree = (name: string) => join(repo, ".worktrees", `job-${name}`);
export const branchExists = (name: string) => Bun.spawnSync(["git", "-C", repo, "rev-parse", "--verify", "-q", `job/${name}`]).exitCode === 0;

// The reviewer: it keeps its prompt, then answers as the prompt's item asks (VERDICT in the goal), else passes.
export const REVIEWER = `#!/bin/bash
prompt=$(cat)
printf '%s' "$prompt" > "$FAKE_LOG/review-prompt"
echo x >> "$FAKE_LOG/review-calls"
case $prompt in
  *REVIEW:holdonce*) if [ -e "$FAKE_LOG/holdonce" ]; then echo '{"type":"result","is_error":false,"result":"Fine.\\nVERDICT: pass"}'; else touch "$FAKE_LOG/holdonce"; echo '{"type":"result","is_error":false,"result":"Looked.\\nVERDICT: hold the flag has no test"}'; fi ;;
  *REVIEW:noneonce*) if [ -e "$FAKE_LOG/noneonce" ]; then echo '{"type":"result","is_error":false,"result":"Fine.\\nVERDICT: pass"}'; else touch "$FAKE_LOG/noneonce"; echo '{"type":"result","is_error":true,"result":"API Error: 529"}'; fi ;;
  *REVIEW:hold*) echo '{"type":"result","is_error":false,"total_cost_usd":0.02,"result":"Looked.\\nVERDICT: hold tests do not cover the new flag"}' ;;
  *REVIEW:none*) echo '{"type":"result","is_error":false,"total_cost_usd":0.02,"result":"Looks fine to me."}' ;;
  *REVIEW:error*) echo '{"type":"result","is_error":true,"result":"API Error: 529"}' ;;
  *REVIEW:pass*) echo '{"type":"result","is_error":false,"total_cost_usd":0.02,"result":"Fine.\\nVERDICT: pass"}' ;;
  *) echo '{"type":"result","is_error":false,"result":"Fine.\\nVERDICT: pass"}' ;;
esac
`;

export const FAKE = `#!/bin/bash
prompt=$(cat)
printf '%s' "$prompt" > "$FAKE_LOG/prompt"
echo "$@" > "$FAKE_LOG/args"
env > "$FAKE_LOG/env"
action=$(printf '%s\\n' "$prompt" | grep '^ACTION:' | tail -1 | cut -d' ' -f2-)
case $action in
  commit\\ *) f=\${action#commit }; mkdir -p "$(dirname "$f")"; echo "$RANDOM" > "$f"; git add "$f"; git commit -qm "add $f" ;;
  commit-big\\ *) f=\${action#commit-big }; for i in $(seq 1 60); do echo "line $i of the big file"; done > "$f"; git add "$f"; git commit -qm "add $f" ;;
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
  already-met) echo '{"type":"result","is_error":false,"total_cost_usd":0.01,"result":"Looked.\\nGoal: Already met — main has the change"}'; echo '{"type":"command_lifecycle","phase":"end"}'; exit 0 ;;
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
  shot\\ *) url=\${action#shot }; aleph-shot "$url" shot.png --width 1440 --height 900 > "$FAKE_LOG/shot.out" 2>&1; echo $? > "$FAKE_LOG/shot.code"; git add shot.png; git commit -qm "add shot.png" ;;
  push)
    GIT_SSH_COMMAND="$FAKE_LOG/ssh" git push git@github.com:x/y.git HEAD > /dev/null 2>&1; echo $? > "$FAKE_LOG/push.code"
    gh auth status > /dev/null 2>&1; echo $? > "$FAKE_LOG/gh.code" ;;
esac
echo '{"type":"assistant","message":{"content":[{"type":"text","text":"working"}]}}'
echo '{"type":"result","is_error":false,"total_cost_usd":0.01,"result":"did '"$action"'"}'
`;

export function setup(): void {
  base = mkdtempSync(join(tmpdir(), "aleph-jobs-"));
  for (const d of ["run", "fake", "jobs", "vault"]) mkdirSync(join(base, d));
  jobsDir = join(base, "jobs");
  fakeLog = join(base, "fake");
  setupLog = join(base, "setup.log");
  fake = join(base, "fake-worker");
  reviewer = join(base, "fake-reviewer");
  writeFileSync(reviewer, REVIEWER, { mode: 0o755 });
  // The verdict follows a REVIEW2:back or REVIEW2:land mark in the goal; otherwise Chris is asked.
  writeFileSync(join(base, "fake-review2"), `#!/bin/bash
p=$(cat)
case "$p" in
  *REVIEW2:back*) v="VERDICT: back fix the held path" ;;
  *REVIEW2:land*) v="VERDICT: land" ;;
  *) v="VERDICT: chris decide the held path" ;;
esac
echo '{"type":"result","is_error":false,"result":"Checked.\\n'"$v"'"}'
`, { mode: 0o755 });
  writeFileSync(fake, FAKE, { mode: 0o755 });
  // The fake firefighter: reads the prompt, takes no action.
  writeFileSync(join(base, "fake-firefighter"), `#!/bin/bash\ncat > /dev/null\necho '{"actions":[]}'\n`, { mode: 0o755 });
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
    // Pushes a commit that names an item (its trailer is in item-once) from another clone once, during the land's checks.
    { name: "item race", run: `if [ -f ${join(base, "item-once")} ]; then m=$(cat ${join(base, "item-once")}); rm ${join(base, "item-once")}; cd ${join(base, "other")} && git fetch -q origin && git reset -q --hard origin/main && echo $RANDOM > item-hand && git add item-hand && git -c user.name=t -c user.email=t@t commit -qm hand -m "$m" && git push -q origin main; fi`, when: ["item-race/**"] },
    // The batch tests: one line per call; the second fails once the first run's file is there with it.
    { name: "count", run: `echo x >> ${join(base, "batch-count")}`, when: ["batch/**"] },
    { name: "retrybad", run: "! { [ -f retry/a.txt ] && [ -f retry/bad.txt ]; }", when: ["retry/**"] },
    { name: "batchbad", run: "! { [ -f batch/a.txt ] && [ -f batch/bad.txt ]; }", when: ["batch/**"] },
    { name: "twicebad", run: "! { [ -f twice/a.txt ] && [ -f twice/bad.txt ]; }", when: ["twice/**"] },
    // race-once holds the number of races still to run; empty means one.
    { name: "race", run: `if [ -f ${join(base, "race-once")} ]; then n=$(cat ${join(base, "race-once")}); rm ${join(base, "race-once")}; [ "$n" = 2 ] && echo 1 > ${join(base, "race-once")}; cd ${join(base, "other")} && git pull -q --rebase origin main && echo $RANDOM > raced && git add raced && git commit -qm race && git push -q origin main; fi`, when: ["race/**"] },
    { name: "racebad", run: "! { [ -f race/l2.txt ] && [ -f race/bad.txt ]; }", when: ["race/**"] },
  ];
  writeFileSync(join(base, "repos.json"), JSON.stringify({
    // The tests land by hand; "auto" is the same clone with the default, landing by itself.
    demo: { path: repo, setup: [`echo ran >> "$SETUP_LOG"`], checks, manual: [{ when: ["android/**"], say: "run it on the phone" }], autoland: false },
    auto: { path: repo, checks: [], manual: [{ when: ["android/**"], say: "run it on the phone" }] },
    other: { path: other, checks: [], autoland: false },
    // The factory: the same clone, its runs under the stand-in sandbox.
    fac: {
      path: repo, sandbox: true, held: ["held/**"], autoland: false,
      checks: [{ name: "tests", run: 'if [ -f FAIL ]; then for i in 1 2 3; do echo "FAIL is present $i"; done; exit 1; fi' }, { name: "flaky", run: `for f in flaky/*; do m=${join(base, "flakym-")}$(basename $f); if [ ! -f $m ]; then touch $m; exit 1; fi; done`, when: ["flaky/**"] }, { name: "tree", run: `git rev-parse 'HEAD^{tree}' >> ${join(base, "trees")}; while [ -f ${join(base, "slowbase")} ]; do sleep 0.1; done` }],
    },
    // Last, so the unknown-repo listing keeps its order up to fac.
    aleph: { path: repo, checks: [], autoland: false },
  }));

  sh(base, "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "key.pem", "-out", "cert.pem", "-days", "1", "-subj", "/CN=tailnet");
  lf = Bun.serve({ port: 0, async fetch(req) { lfPosts.push(await req.json()); return new Response("{}", { status: lfStatus }); } });
  server = Bun.serve({
    port: 0,
    tls: { cert: readFileSync(join(base, "cert.pem"), "utf8"), key: readFileSync(join(base, "key.pem"), "utf8") },
    async fetch(req) {
      const text = (await req.json()).text;
      told.push(text);
      onTell?.(text);
      return new Response("ok");
    },
  });
}
export function teardown(): void {
  server.stop(true);
  lf.stop(true);
  rmSync(base, { recursive: true, force: true });
}
export function resetLf(): void { lfPosts = []; lfStatus = 200; }
export function setLfStatus(n: number): void { lfStatus = n; }
export function setOnTell(f: ((text: string) => void) | undefined): void { onTell = f; }
export async function fjobFor(name: string, action: string, id: number) {
  return aleph(["job", "fac", name, "--spec", specFile(`Goal: ${name}\nACTION: ${action}\n`), "--todo", String(id)]);
}

/**
 * Files an item in the test store as one commit, with the given frontmatter fields (`kind`, `goals`, `after`, `ask`,
 * `labels` ...) beside the ones every item has, and returns its number. This is how a test seeds a new-shape item,
 * which no verb of `aleph issue` writes yet, or an old-shape one with a field the verbs do not set.
 */
export function seedItem(repoKey: string, title: string, fm: Record<string, unknown> = {}, body = "Body."): number {
  sh(items, "git", "pull", "-q", "--rebase", "origin", "main");
  const dir = join(items, repoKey, "backlog", "tasks");
  mkdirSync(dir, { recursive: true });
  if (!existsSync(join(items, repoKey, "backlog", "config.yml"))) writeFileSync(join(items, repoKey, "backlog", "config.yml"), storeConfig(repoKey));
  const id = Math.max(0, ...readdirSync(dir).map((f) => Number(/^.+-(\d+)\.md$/.exec(f)?.[1] ?? 0))) + 1;
  const item = { id, title, fm: { id: String(id), status: "open", created: "2026-10-30", updated: "2026-10-30", priority: "medium", labels: [], ...fm }, body, notes: [], legacy: false };
  writeFileSync(join(dir, `${repoKey}-${id}.md`), renderItem(repoKey, item as any));
  sh(items, "git", "add", "-A");
  sh(items, "git", "commit", "-qm", `seed ${repoKey}-${id}`);
  sh(items, "git", "push", "-q", "origin", "main");
  return id;
}

/** Writes a run folder into the test ledger: `run` holds the fields the test cares about. */
let seeded = 0;
export function seedRun(repoKey: string, run: Partial<Run> & Pick<Run, "kind" | "state">): string {
  const id = `20261030-${String(++seeded).padStart(6, "0")}-${repoKey}-seed-${run.kind}`;
  const folder = join(jobsDir, id);
  mkdirSync(folder, { recursive: true });
  writeRun(folder, { job: id, name: id, repo: repoKey, told: true, shown: true, started: new Date().toISOString(), ...run } as Run);
  return id;
}
