import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, statSync, watch, writeFileSync } from "node:fs";
import { probe } from "../lib/git.ts";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { allRuns, type Run } from "./lib/records/ledger.ts";
import { getRun, numbered, putRun } from "./lib/records/record.ts";
import { unitAlive } from "./lib/infra/process.ts";
import { config as storeConfig } from "../issues/lib/store.ts";
import { renderItem } from "../issues/lib/todo.ts";
import { parseId, subjectOf } from "../lib/naming.ts";
import { fixture } from "../tests/git-fixture.ts";

export const CLI = join(import.meta.dir, "cli.ts");
export let base: string, remote: string, repo: string, other: string, itemsRemote: string, jobsDir: string, fakeLog: string, setupLog: string;
let items: string, fake: string, reviewer: string;
let server: ReturnType<typeof Bun.serve>;
let lf: ReturnType<typeof Bun.serve>;
let lfStatus = 200;
let lfPosts: any[] = [];
/** The test's clock: the time setup made `base`, read once from its folder. The stamps a test writes sit at known distances from it. */
export let now: number;
export const told: string[] = [];
let onTell: ((text: string) => void) | undefined;

/**
 * Writes the fake start command: it starts the job in the background, as `systemd-run` does, and exits 0 once
 * a run folder that was not there before the start has a pid. It exits 1 when the job process is gone or has
 * warned that its unit wrote no pid: the job bounds its own waits (the locks, and 10 s for the pid), so a start
 * queued behind others under load is not cut off by a fixed window here.
 * While it runs, `$START_LOG.busy.<pid>` exists: see `starting`.
 */
export function startScript(path: string, jobsDir: string): void {
  writeFileSync(path, `#!/usr/bin/env bun
import { appendFileSync, existsSync, readdirSync, readFileSync, rmSync, watch, writeFileSync } from "node:fs";
const [kind, name, on] = process.argv.slice(2), log = process.env.START_LOG!, dir = ${JSON.stringify(jobsDir)};
const busy = log + ".busy." + process.pid, joberr = log + ".err." + process.pid;
writeFileSync(busy, "");
writeFileSync(joberr, "");
appendFileSync(log, name + "\\n");
const runs = () => readdirSync(dir).filter((d) => d.includes("-" + name + "-"));
const before = runs();
const job = Bun.spawn(["bun", ${JSON.stringify(CLI)}, "job", kind, name, "--spec", "-", "--on", on], { env: { ...process.env, ALEPH_JOB_FOREGROUND: "1" }, stdin: "inherit", stdout: "ignore", stderr: Bun.file(joberr) });
let gone = false;
const end = (code: number) => {
  const err = readFileSync(joberr);
  rmSync(busy, { force: true });
  rmSync(joberr, { force: true });
  if (code) process.stderr.write(err);
  process.exit(code);
};
const check = () => {
  if (runs().some((d) => !before.includes(d) && existsSync(dir + "/" + d + "/pid"))) end(0);
  if (gone || readFileSync(joberr, "utf8").includes("wrote no pid")) end(1);
};
watch(dir, { recursive: true }, check);
watch(joberr, check);
job.exited.then(() => { gone = true; check(); });
check();
`, { mode: 0o755 });
}

/** The pids of the start commands from `startScript` that log to `startLog` and have not exited: their run folder may not be there yet. */
const startPids = (startLog: string): number[] => {
  const dir = join(startLog, ".."), name = startLog.slice(dir.length + 1) + ".busy.";
  return readdirSync(dir).filter((f) => f.startsWith(name)).map((f) => Number(f.slice(name.length)));
};

/** The pids of the `aleph dispatch` and `aleph intake` processes of this test file's factory, e.g. a detached one from a transition. */
const dispatchPids = (): number[] => {
  const mine = `ALEPH_FACTORY_DIR=${join(base, "factory")}\0`;
  return readdirSync("/proc").filter((p) => /^\d+$/.test(p)).filter((p) => {
    try {
      const cmd = readFileSync(`/proc/${p}/cmdline`, "utf8").split("\0");
      return cmd.includes(CLI) && ["dispatch", "intake"].includes(cmd[cmd.indexOf(CLI) + 1]) && readFileSync(`/proc/${p}/environ`, "utf8").includes(mine);
    } catch {
      return false;
    }
  }).map(Number);
};

/** Returns when process `pid` has exited: `tail --pid` waits on the process, not on a timer. */
const exited = (pid: number): Promise<number> => Bun.spawn(["tail", `--pid=${pid}`, "-f", "/dev/null"], { stdio: ["ignore", "ignore", "ignore"] }).exited;
/** Waits for the exit of every process `pids` lists, until it lists none. */
async function drained(pids: () => number[]): Promise<void> {
  for (let p = pids(); p.length; p = pids()) await Promise.all(p.map(exited));
}
/** Returns when no `aleph dispatch` or `aleph intake` of this test file's factory is running. */
export const dispatched = (): Promise<void> => drained(dispatchPids);
/**
 * Returns when nothing of this test file's factory is moving: no start in flight, no dispatch, and no unit alive. A run writes its
 * state before its run-end dispatch, so a state alone does not show this.
 */
export const idle = (startLog: string): Promise<void> => drained(() => [...startPids(startLog), ...dispatchPids(),
  ...readdirSync(jobsDir).filter((r) => unitAlive(join(jobsDir, r))).map((r) => Number(readFileSync(join(jobsDir, r, "pid"), "utf8")))]);

/** Returns when `f` holds. It checks on each change in the folder `dir` (and below), so no timer decides. */
export async function when(f: () => boolean, dir = base): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  const w = watch(dir, { recursive: true }, () => f() && resolve());
  try { if (!f()) await promise; } finally { w.close(); }
}

/** The run folders on the issue `fac-<id>`, by name: `<stamp>-fac-<id>-<n>`. A folder is there a moment before its record. */
export const issueRuns = (id: string | number): string[] => (existsSync(jobsDir) ? readdirSync(jobsDir).filter((r) => new RegExp(`^\\d{8}-\\d{6}-fac-${id}-\\d+$`).test(r)) : []);
/** The runs of the job `name`, oldest first, only those of `kind` when given: a folder name has the subject, not the job's name or kind. */
export const jobRuns = (name: string, kind?: string): string[] => allRuns().filter((e) => e.run.name === name && (!kind || e.run.kind === kind)).map((e) => e.id);

const tail = (f: string, n = 15) => (existsSync(f) ? readFileSync(f, "utf8").trimEnd().split("\n").slice(-n).join("\n") : "(none)");
/** What a failed concurrency test needs to name its cause: the runs of the given issue ids with their pid and exit, and the factory logs. */
export function diagnose(label: string, ids: number[], ...results: { code: number; stdout: string; stderr: string }[]): string {
  const runs = existsSync(jobsDir) ? readdirSync(jobsDir).sort().filter((r) => ids.some((id) => issueRuns(id).includes(r)))
    .map((r) => `--- ${r}: pid ${tail(join(jobsDir, r, "pid"), 1)}, exit ${tail(join(jobsDir, r, "exit"), 1)}`) : [];
  return [`${label}`, ...results.map((x, i) => `--- dispatch ${"xy"[i] ?? i}: exit ${x.code}\nstdout: ${x.stdout.trim()}\nstderr: ${tail_(x.stderr)}`), ...runs,
    `--- factory/dispatch.log\n${tail(join(base, "factory", "dispatch.log"))}`].join("\n");
}
const tail_ = (s: string) => s.trimEnd().split("\n").slice(-15).join("\n");

const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
export function sh(cwd: string, ...args: string[]): string {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
  return p.stdout.toString().trim();
}

export function env(extra: Record<string, string> = {}): Record<string, string> {
  return {
    ...(process.env as Record<string, string>), CLAUDECODE: "", ...gitEnv,
    ALEPH_JOBS_DIR: jobsDir, ALEPH_REPOS: join(base, "repos.json"), ALEPH_ISSUES: items, ALEPH_JOB_FOREGROUND: "1",
    ALEPH_WORKER_CMD: fake, ALEPH_REVIEWER_CMD: reviewer, XDG_RUNTIME_DIR: join(base, "run"), FAKE_LOG: fakeLog, SETUP_LOG: setupLog,
    ALEPH_FACTORY_DIR: join(base, "factory"),
    // No test reaches the live router: its tier for a seed varies, so a start does not rate it.
    ALEPH_JUDGE: "haiku",
    // The live cap's test starts six runs against a cap of five.
    ALEPH_LIVE_CAP: "5",
    // A run's end and `aleph issue` dispatch in production; the dispatch tests turn it on.
    ALEPH_DISPATCH: "off",
    // Nor does a tick start the monitor's reader; monitor.test.ts runs it with a fake.
    ALEPH_MONITOR: "off",
    // The tick takes in no issue unless a test sets a cap and a fake command.
    ALEPH_INTAKE_CAP: "0",
    // Nor does it start a director run on an Ask: no test reaches the live director.
    ALEPH_DIRECTOR_CAP: "0",
    // The title writer's model fails, so a follow-up or a check gets cutTitle's title and no test reaches Haiku.
    ALEPH_RULE_CMD: "false",
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
function specFile(text: string): string {
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
/** The run's state: its entry in its job record. Throws when no record holds it yet. */
export const state = (run: string): any => getRun(run) ?? (() => { throw new Error(`no record holds ${run}`); })();
/** `state` for a run that may be starting: its folder exists a moment before its record has it, so a missing run reads as no state yet. */
export const stateNow = (run: string): { condition: string } => getRun(run) ?? { condition: "" };
export const file = (run: string, f: string) => readFileSync(join(jobsDir, run, f), "utf8");
export const worktree = (name: string) => join(repo, ".worktrees", `job-${name}`);
export const branchExists = (name: string) => probe(repo, "rev-parse", "--verify", "-q", `job/${name}`).ok;

// The reviewer: it keeps its prompt, then answers as the prompt's item asks (REVIEW: in the issue) with structured output, else passes.
// REVIEW:none gives text with no structured output.
const REVIEWER = `#!/bin/bash
prompt=$(cat)
printf '%s' "$prompt" > "$FAKE_LOG/review-prompt"
echo x >> "$FAKE_LOG/review-calls"
env > "$FAKE_LOG/review-env"
case $prompt in
  *REVIEW:holdonce*) if [ -e "$FAKE_LOG/holdonce" ]; then echo '{"type":"result","is_error":false,"result":"","structured_output":{"verdict":"pass","summary":"Fine.","failures":[]}}'; else touch "$FAKE_LOG/holdonce"; echo '{"type":"result","is_error":false,"result":"","structured_output":{"verdict":"hold","summary":"Looked.","failures":[{"clause":"the flag has no test","observed":"seen"}]}}'; fi ;;
  *REVIEW:noneonce*) if [ -e "$FAKE_LOG/noneonce" ]; then echo '{"type":"result","is_error":false,"result":"","structured_output":{"verdict":"pass","summary":"Fine.","failures":[]}}'; else touch "$FAKE_LOG/noneonce"; echo '{"type":"result","is_error":true,"result":"API Error: 529"}'; fi ;;
  *REVIEW:hold*) echo '{"type":"result","is_error":false,"result":"","total_cost_usd":0.02,"structured_output":{"verdict":"hold","summary":"Looked.","failures":[{"clause":"tests do not cover the new flag","observed":"seen"}]}}' ;;
  *REVIEW:none*) echo '{"type":"result","is_error":false,"total_cost_usd":0.02,"result":"Looks fine to me."}' ;;
  *REVIEW:error*) echo '{"type":"result","is_error":true,"result":"API Error: 529"}' ;;
  *REVIEW:pass*) echo '{"type":"result","is_error":false,"result":"","total_cost_usd":0.02,"structured_output":{"verdict":"pass","summary":"Fine.","failures":[]}}' ;;
  *) echo '{"type":"result","is_error":false,"result":"","structured_output":{"verdict":"pass","summary":"Fine.","failures":[]}}' ;;
esac
`;

// Returns once `file` exists (mode "exists") or is gone (mode "gone"): it watches the folder, so no timer decides.
const WAIT = `#!/usr/bin/env bun
import { existsSync, watch } from "node:fs";
import { dirname } from "node:path";
const [mode, file] = process.argv.slice(2), done = () => existsSync(file) === (mode === "exists") && process.exit(0);
watch(dirname(file), done);
done();
`;
/** A shell command that returns once `file` exists or is gone. */
export const waitCmd = (mode: "exists" | "gone", file: string): string => `${join(base, "wait")} ${mode} ${file}`;

const FAKE = `#!/bin/bash
prompt=$(cat)
printf '%s' "$prompt" > "$FAKE_LOG/prompt"
echo "$@" > "$FAKE_LOG/args"
env > "$FAKE_LOG/env"
action=$(printf '%s\\n' "$prompt" | grep '^ACTION:' | tail -1 | cut -d' ' -f2-)
if printf '%s' "$prompt" | grep -q '^# Merge '; then
  # A merge run has no ACTION: it merges main, except in clash.txt, which this worker cannot resolve.
  if printf '%s' "$prompt" | grep -q 'clash.txt'; then git commit -q --allow-empty -m "unresolved"
  else git fetch -q origin && git rebase -q -X theirs origin/main; fi
  exit 0
fi
case $action in
  commit\\ *) f=\${action#commit }; mkdir -p "$(dirname "$f")"; echo "$RANDOM" > "$f"; git add "$f"; git commit -qm "add $f" ;;
  commit-all\\ *) for f in \${action#commit-all }; do mkdir -p "$(dirname "$f")"; echo "$RANDOM" > "$f"; git add "$f"; done; git commit -qm "add \${action#commit-all }" ;;
  commit-big\\ *) f=\${action#commit-big }; for i in $(seq 1 60); do echo "line $i of the big file"; done > "$f"; git add "$f"; git commit -qm "add $f" ;;
  commit-fixed\\ *) f=\${action#commit-fixed }; echo same > "$f"; git add "$f"; git commit -qm "add $f" ;;
  commit-result-and\\ *) f=\${action#commit-result-and }; echo "$RANDOM" > result.md; echo "$RANDOM" > "$f"; git add result.md "$f"; git commit -qm "result and $f" ;;
  two-commits\\ *) set -- \${action#two-commits }; echo "$2" > "$1"; git add "$1"; git commit -qm "first $1"; echo "$3" > "$1"; git add "$1"; git commit -qm "second $1" ;;
  resolve-later\\ *) f=\${action#resolve-later }
    if printf '%s' "$prompt" | grep -q 'The land conflicted'; then git fetch -q origin && git rebase -q -X theirs origin/main
    else echo mine > "$f"; git add "$f"; git commit -qm "add $f"; fi ;;
  own-list\\ *) f=\${action#own-list }
    if printf '%s' "$prompt" | grep -q 'The land refused'; then git fetch -q origin
      if git cat-file -e origin/main:docs/todo.md 2>/dev/null; then git checkout -q origin/main -- docs/todo.md; else git rm -q docs/todo.md; fi
      git commit -qm "restore the list"
    else mkdir -p docs; echo "$RANDOM" > "$f"; echo "# To do (by hand)" > docs/todo.md; git add "$f" docs/todo.md; git commit -qm "add $f"; fi ;;
  untracked) echo x > stray.txt ;;
  hold\\ *) f=\${action#hold }; "$FAKE_LOG/../wait" exists "$f"; echo "$RANDOM" > "held-$(basename "$f").txt"; git add .; git commit -qm "held $f" ;;
  sleep) tail --pid=$PPID -f /dev/null ;;
  exit3) exit 3 ;;
  question) echo '{"type":"result","result":"I looked.\\nQUESTION: which colour?","structured_output":{"summary":"I looked.","defaults":[],"followups":[],"flakes":[],"already_met":null,"question":"which colour?"}}'; exit 0 ;;
  error) echo '{"type":"result","is_error":true,"result":"API Error: 500"}'; exit 0 ;;
  noresult) echo '{"type":"assistant","message":{"content":[{"type":"text","text":"working"}]}}'; exit 0 ;;
  nostructured) echo n > n.txt; git add n.txt; git commit -qm "add n.txt"; echo '{"type":"result","is_error":false,"result":"done"}'; exit 0 ;;
  already-met) echo '{"type":"result","is_error":false,"total_cost_usd":0.01,"result":"","structured_output":{"summary":"Looked.","defaults":[],"followups":[],"flakes":[],"already_met":{"evidence":"main has the change"},"question":null}}'; echo '{"type":"command_lifecycle","phase":"end"}'; exit 0 ;;
  defaults) echo d > d.txt; git add d.txt; git commit -qm "add d.txt"
    echo '{"type":"result","is_error":false,"total_cost_usd":0.25,"result":"","structured_output":{"summary":"Done.","defaults":[{"choice":"which colour?","chose":"blue"}],"followups":[{"title":"paint the fence"}],"flakes":[],"already_met":null,"question":null}}'; exit 0 ;;
  flake-followup) echo f > fu.txt; git add fu.txt; git commit -qm "add fu.txt"
    echo '{"type":"result","is_error":false,"total_cost_usd":0.25,"result":"","structured_output":{"summary":"Done.","defaults":[],"followups":[{"title":"Fix the flaky paint test in a.test.ts"}],"flakes":[],"already_met":null,"question":null}}'; exit 0 ;;
  flake) echo f > fl.txt; git add fl.txt; git commit -qm "add fl.txt"
    echo '{"type":"result","is_error":false,"total_cost_usd":0.25,"result":"","structured_output":{"summary":"Done.","defaults":[],"followups":[{"title":"mend the gate"}],"flakes":[{"file":"a.test.ts","name":"slow one","what":"timed out, passed alone"}],"already_met":null,"question":null}}'; exit 0 ;;
  fail-then-fix) echo "$RANDOM" > f.txt; git add f.txt
    if printf '%s' "$prompt" | grep -q 'The check \`tests\` failed'; then git rm -q FAIL; else echo x > FAIL; git add FAIL; fi
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
echo '{"type":"result","is_error":false,"total_cost_usd":0.01,"usage":{"input_tokens":1000000,"output_tokens":1000000,"cache_read_input_tokens":0,"cache_creation_input_tokens":0},"result":"did '"$action"'","structured_output":{"summary":"did '"$action"'","defaults":[],"followups":[],"flakes":[],"already_met":null,"question":null}}'
`;

/** Pids (not this process) whose cmdline, environ or cwd holds `dir`. */
function referring(dir: string): number[] {
  const out: number[] = [];
  for (const p of readdirSync("/proc").filter((p) => /^\d+$/.test(p))) {
    if (Number(p) === process.pid) continue;
    let hit = false;
    for (const f of ["cmdline", "environ"]) {
      try { if (readFileSync(`/proc/${p}/${f}`, "utf8").includes(dir)) hit = true; } catch {}
    }
    if (!hit) { try { hit = readlinkSync(`/proc/${p}/cwd`).startsWith(dir); } catch {} }
    if (hit) out.push(Number(p));
  }
  // Their descendants too: a child such as dash's `sleep` need not hold `dir` itself.
  const kids = new Map<number, number[]>();
  for (const p of readdirSync("/proc").filter((p) => /^\d+$/.test(p))) {
    try {
      const st = readFileSync(`/proc/${p}/stat`, "utf8");
      const ppid = Number(st.slice(st.lastIndexOf(")") + 2).split(" ")[1]);
      kids.set(ppid, [...(kids.get(ppid) ?? []), Number(p)]);
    } catch {}
  }
  for (let i = 0; i < out.length; i++) for (const k of kids.get(out[i]) ?? []) if (k !== process.pid && !out.includes(k)) out.push(k);
  return out;
}

/** SIGKILLs every process that refers to `dir` and waits until none is left. */
async function killReferring(dir: string): Promise<void> {
  for (let pids = referring(dir); pids.length; pids = referring(dir)) {
    for (const pid of pids) { try { process.kill(pid, "SIGKILL"); } catch {} }
    await Promise.all(pids.map(exited));
  }
}

/** Removes `aleph-jobs-*` folders of killed test runs: more than 2 hours old, and no live process refers to them. */
function sweepLeftovers(): void {
  try {
    for (const name of readdirSync(tmpdir()).filter((n) => n.startsWith("aleph-jobs-"))) {
      try {
        const dir = join(tmpdir(), name);
        if (now - statSync(dir).mtimeMs < 2 * 3600_000 || referring(dir).length) continue;
        rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
  } catch {}
}

/**
 * The repos and the TLS key of a test file, built once per test process: the remote with one commit "init" and two
 * clones of it (`repo`, `other`), and the empty work store `items.git` with its clone `items` (one empty commit "start").
 */
function buildRepos(dir: string): void {
  const remote = join(dir, "remote.git"), seed = join(dir, "seed"), items = join(dir, "items");
  sh(dir, "git", "init", "-q", "--bare", "-b", "main", remote);
  sh(dir, "git", "clone", "-q", remote, seed);
  writeFileSync(join(seed, ".gitignore"), ".worktrees/\n");
  writeFileSync(join(seed, "README"), "demo\n");
  writeFileSync(join(seed, "old.test.ts"), "test(\"old\", () => {});\n");
  sh(seed, "git", "add", "."); sh(seed, "git", "commit", "-qm", "init"); sh(seed, "git", "push", "-q", "origin", "main");
  sh(dir, "git", "init", "-q", "--bare", "-b", "main", join(dir, "items.git"));
  sh(dir, "git", "clone", "-q", join(dir, "items.git"), items);
  sh(items, "git", "commit", "-q", "--allow-empty", "-m", "start");
  sh(items, "git", "push", "-q", "origin", "main");
  sh(dir, "git", "clone", "-q", remote, join(dir, "repo"));
  sh(dir, "git", "clone", "-q", remote, join(dir, "other"));
  sh(dir, "openssl", "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-keyout", "key.pem", "-out", "cert.pem", "-days", "1", "-subj", "/CN=tailnet");
}

export function setup(): void {
  base = mkdtempSync(join(tmpdir(), "aleph-jobs-"));
  now = statSync(base).mtimeMs;
  sweepLeftovers();
  for (const d of ["run", "fake", "jobs", "vault"]) mkdirSync(join(base, d));
  jobsDir = join(base, "jobs");
  // The test process reads and seeds the records the units write.
  process.env.ALEPH_RECORDS_DIR = join(jobsDir, ".records");
  fakeLog = join(base, "fake");
  setupLog = join(base, "setup.log");
  fake = join(base, "fake-worker");
  reviewer = join(base, "fake-reviewer");
  writeFileSync(reviewer, REVIEWER, { mode: 0o755 });
  writeFileSync(fake, FAKE, { mode: 0o755 });
  writeFileSync(join(base, "wait"), WAIT, { mode: 0o755 });
  // A fake ssh, so that no test reaches a real host.
  writeFileSync(join(fakeLog, "ssh"), `#!/bin/sh\necho "$@" > "${join(base, "fake", "ssh.args")}"\nexit 1\n`, { mode: 0o755 });

  remote = join(base, "remote.git");
  repo = join(base, "repo");
  other = join(base, "other");
  itemsRemote = join(base, "items.git");
  items = join(base, "items");
  fixture("cli-jobs", buildRepos, base);

  // Says it started, then waits while the hold file is there, so a test can kill the land at this check.
  const gate = { name: "gate", run: `touch ${join(base, "gate-reached")}; ${waitCmd("gone", join(base, "gate-hold"))}`, when: ["gate/**"] };
  const checks = [
    { name: "tests", run: "test ! -f FAIL" },
    { name: "no job variables", run: 'test -z "$ALEPH_JOB_ID$ALEPH_JOB_RUN"' },
    { name: "android build", run: `echo built >> ${join(base, "android.log")}`, when: ["android/**"] },
    { name: "slow", run: "tail --pid=$PPID -f /dev/null", when: ["slow/**"] },
    // Says it started, then waits while the hold file is there, so a test can kill the land at this check.
    // Holds two lands between their fetch and their push at the same time, while the pair-hold file is there.
    { name: "pause", run: waitCmd("gone", join(base, "pair-hold")), when: ["pair/**"] },
    // Pushes to the remote from another clone once, so the land's own push loses the race.
    // Writes a to-do note to main once, during the land's checks.
    { name: "todo race", run: `if [ -f ${join(base, "todo-once")} ]; then rm ${join(base, "todo-once")}; bun ${CLI} issue note demo 1 "during the land"; fi`, when: ["todo-race/**"] },
    // Pushes a commit that names an item (its trailer is in item-once) from another clone once, during the land's checks.
    { name: "item race", run: `if [ -f ${join(base, "item-once")} ]; then m=$(cat ${join(base, "item-once")}); rm ${join(base, "item-once")}; cd ${join(base, "other")} && git fetch -q origin && git reset -q --hard origin/main && echo $RANDOM > item-hand && git add item-hand && git -c user.name=t -c user.email=t@t commit -qm hand -m "$m" && git push -q origin main; fi`, when: ["item-race/**"] },
  ];
  writeFileSync(join(base, "repos.json"), JSON.stringify({
    // The tests land by hand; "auto" is the same clone with the default, landing by itself.
    demo: { path: repo, setup: [`echo ran >> "$SETUP_LOG"`], checks, manual: [{ when: ["android/**"], say: "run it on the phone" }], autoland: false },
    auto: { path: repo, checks: [], manual: [{ when: ["android/**"], say: "run it on the phone" }] },
    other: { path: other, checks: [], autoland: false },
    // The factory: the same clone, its runs on the host.
    fac: {
      path: repo, sandbox: true, held: ["held/**"], autoland: false,
      checks: [gate, { name: "tests", run: 'if [ -f FAIL ]; then for i in 1 2 3; do echo "FAIL is present $i"; done; exit 1; fi' }, { name: "flaky", run: `for f in flaky/*; do m=${join(base, "flakym-")}$(basename $f); if [ ! -f $m ]; then touch $m; exit 1; fi; done`, when: ["flaky/**"] }, { name: "tree", run: `git rev-parse 'HEAD^{tree}' >> ${join(base, "trees")}; ${waitCmd("gone", join(base, "slowbase"))}` }],
    },
    // Last, so the unknown-repo listing keeps its order up to fac.
    aleph: { path: repo, checks: [], autoland: false },
  }));

  lf =Bun.serve({ port: 0, async fetch(req) { lfPosts.push(await req.json()); return new Response("{}", { status: lfStatus }); } });
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
export async function teardown(): Promise<void> {
  try { server?.stop(true); } catch {}
  try { lf?.stop(true); } catch {}
  try { if (base) await killReferring(base); } catch {}
  if (base) rmSync(base, { recursive: true, force: true });
  delete process.env.ALEPH_RECORDS_DIR;
}

/** Brings the test store's checkout up to origin/main. A detached dispatch or intake writing the store at the same moment can make one fetch find no ref, so it retries. */
function pullItems(): void {
  for (let attempt = 1; ; attempt++) {
    try { sh(items, "git", "pull", "-q", "--rebase", "origin", "main"); return; } catch (e) { if (attempt === 5) throw e; }
  }
}

/** Pushes the test store's commit. A detached dispatch can write the store first, so a refused push rebases and tries again, as the store's own writes do. */
function pushItems(): void {
  for (let attempt = 1; ; attempt++) {
    try { sh(items, "git", "push", "-q", "origin", "main"); return; } catch (e) { if (attempt === 5) throw e; pullItems(); }
  }
}

/**
 * Files an item in the test store as one commit, with the given frontmatter fields (`kind`, `goals`, `after`, `ask`,
 * `labels` ...) beside the ones every item has, and returns its number. This is how a test seeds a new-shape item,
 * which no verb of `aleph issue` writes yet, or an old-shape one with a field the verbs do not set.
 */
/** A seed's fields and text in the stored shape: `status` becomes `closed_as`, and `kind: "goal"` puts the text in the spec. */
function seedShape(id: string, fm: Record<string, unknown>, body: string, spec: boolean) {
  const { status, kind, issue: _issue, goals: _parts, ...rest } = fm as Record<string, any>;
  const closed = status && status !== "open" ? { closed_as: status, closed_at: "2026-10-30" } : {};
  const isSpec = spec || kind === "goal";
  return { fm: { id, created: "2026-10-30", updated: "2026-10-30", priority: "medium", ...closed, ...rest }, request: isSpec ? "" : body, spec: isSpec ? body : "", notes: [] as string[] };
}

export function seedItem(repoKey: string, title: string, fm: Record<string, unknown> = {}, body = "Body."): number {
  pullItems();
  const dir = join(items, repoKey, "backlog", "tasks");
  mkdirSync(dir, { recursive: true });
  if (!existsSync(join(items, repoKey, "backlog", "config.yml"))) writeFileSync(join(items, repoKey, "backlog", "config.yml"), storeConfig(repoKey));
  const id = Math.max(0, ...readdirSync(dir).map((f) => parseId(f.replace(/\.md$/, ""))?.n ?? 0)) + 1;
  const item = { id, title, ...seedShape(String(id), fm, body, false) };
  writeFileSync(join(dir, `${repoKey}-${id}.md`), renderItem(repoKey, item as any));
  sh(items, "git", "add", "-A");
  sh(items, "git", "commit", "-qm", `seed ${repoKey}-${id}`);
  pushItems();
  return id;
}

/** Files the part `<repo>-<n>.<k>` of issue `<repo>-<n>` in one commit on the test store's origin/main; returns `"<n>.<k>"`. */
export function seedPart(repoKey: string, n: number, k: number, fm: Record<string, unknown> = {}, title = "Goal", body = "Body."): string {
  pullItems();
  const dir = join(items, repoKey, "backlog", "tasks");
  mkdirSync(dir, { recursive: true });
  if (!existsSync(join(items, repoKey, "backlog", "config.yml"))) writeFileSync(join(items, repoKey, "backlog", "config.yml"), storeConfig(repoKey));
  const ref = `${n}.${k}`;
  const item = { id: n, sub: k, title, ...seedShape(ref, fm, body, true) };
  writeFileSync(join(dir, `${repoKey}-${ref}.md`), renderItem(repoKey, item as any));
  sh(items, "git", "add", "-A");
  sh(items, "git", "commit", "-qm", `seed ${repoKey}-${ref}`);
  pushItems();
  return ref;
}

/** Writes a run folder into the test ledger: `run` holds the fields the test cares about. */
let seeded = 0;
export function seedRun(repoKey: string, run: Partial<Run> & Pick<Run, "kind" | "condition">): string {
  const id = `20261030-${String(++seeded).padStart(6, "0")}-${repoKey}-seed-${run.kind}`;
  const folder = join(jobsDir, id);
  mkdirSync(folder, { recursive: true });
  const r = { job: id, name: id, repo: repoKey, told: true, shown: true, started: new Date(now).toISOString(), ...run } as Omit<Run, "n">;
  putRun(basename(folder), { ...r, n: run.n ?? numbered(subjectOf(r), allRuns()).length + 1 });
  return id;
}

/**
 * Files an old-shape item the way `aleph issue add <repo> <title> <flags> --body -` did before the store wrote only the new
 * shape: `--labels` with `goal` becomes `kind: "goal"`, the other labels `areas`, `--after a,b` becomes `after: ["a", "b"]`, `--due` its field, `action` the body. No verb of `aleph issue`
 * writes that shape now, so the item is seeded; an open issue then gets the dispatch that `add` ran, with `env` (which may turn it off).
 */
export async function addOld(title: string, action: string, extra: string[] = [], env: Record<string, string> = {}): Promise<number> {
  const flag = (n: string) => { const i = extra.indexOf(`--${n}`); return i >= 0 ? extra[i + 1] : undefined; };
  const labels = (flag("labels") ?? "").split(",").filter(Boolean);
  const isPart = labels.includes("goal"), areas = labels.filter((l) => l !== "goal");
  const id = seedItem("fac", title, { ...(isPart ? { kind: "goal" } : {}), ...(areas.length ? { areas } : {}), ...(flag("after") ? { after: flag("after")!.split(",").filter(Boolean) } : {}) }, action ? `ACTION: ${action}` : "");
  if (isPart && env.ALEPH_DISPATCH !== "off") await aleph(["dispatch"], env);
  return id;
}

