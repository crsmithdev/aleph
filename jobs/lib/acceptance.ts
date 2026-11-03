/**
 * The acceptance run: a done goal's own Oracle, run again on origin/<main> under srt.
 * See "Acceptance run" in docs/specs/2026-10-26-seed-factory.md.
 *
 * The result of each goal is kept in <factory>/acceptance/<repo>-<n>.json. A failure is not yet a
 * result: only the failed tests run again, on the same commit, when the machine is quiet. Tests that
 * pass then, and tests the goal did not touch, go to the flake list. A repeat in a test the goal
 * touched reopens the goal for one more worker run; a second sets an Ask (input, acceptance-failed).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import * as issues from "../../todo/lib/todo.ts";
import { section } from "../../todo/lib/todo.ts";
import { plainAsk, setAsk, type Ask } from "./ask.ts";
import { note, noteFlake, readHidden, reopen as storeReopen, writeList } from "../../todo/lib/store.ts";
import { cloneAndSetup } from "./checks.ts";
import { git } from "./git.ts";
import { SCENARIOS } from "./author.ts";
import { gitPrelude, q } from "./agent-call.ts";
import { outcome as agentOutcome } from "./gate.ts";
import { checkSlot, tell, type Repo } from "./ledger.ts";
import { makeRunFolder, removeRunFolder, sandboxed, stallReason, stallSeconds, workerToken } from "./sandbox.ts";
import { acceptanceDir, commitsNaming, readRecord, resultLine, writeRecord, type Accepted, type FailedTest } from "./status.ts";
import { acceptanceFailCap, quietLoad, reviewSeconds, reviewerCmd } from "./settings.ts";

/** The longest a rerun waits for a quiet machine. */
export const MAX_WAIT_MS = 24 * 3_600_000;
/** Reruns of a touched test that passed once, before it counts as a flake. */
const EXTRA_RERUNS = 2;


/** A record that ends the goal's acceptance: nothing runs again for it. */
export const final = (r: Accepted | null): boolean => !!r && (r.result !== "fail" || r.fails >= 2);

const CHECK = "(?:bun test|bun run|bunx tsc)";
/** A plain check command, or a shell `for` loop whose body runs one. */
const RUNNABLE = new RegExp(`^${CHECK}(\\s|$)|^for\\s.*;\\s*do\\b.*[\\s;&|(]${CHECK}(?=[\\s;&|)]|$)`);
/** A placeholder such as `<file>`, `<repo>-<n>` or `<that file>` that the Oracle leaves for the reader to fill in. Not a redirection: a space inside the brackets must be followed by a letter, so `<in >out` does not match. */
const PLACEHOLDER = /<[A-Za-z][A-Za-z0-9_-]*(?: [A-Za-z][A-Za-z0-9_-]*)*>/;
/** A `bun test` summary line that counts failures, such as ` 2 fail`. */
const FAIL_SUMMARY = /^\s*[1-9]\d* fail\s*$/m;

/** A test file by its name, as `bun test` takes one. */
const TEST_FILE = /\.(?:test|spec)\.(?:ts|js)$/;

/** A plain `bun test` that names a test file the commit `sha` does not have. Such a command is the Oracle's quoted fixture text, not a check. */
function namesMissingTestFile(repo: Repo, sha: string, command: string): boolean {
  if (!/^bun test(\s|$)/.test(command)) return false;
  return command.split(/\s+/).some((arg) => {
    const path = arg.replace(/^\.\//, "");
    return TEST_FILE.test(path) && !git(repo.path, "cat-file", "-e", `${sha}:${path}`).ok;
  });
}

/** A file's header in `bun test` output, and a failure under it. A failing `beforeAll` shows as the name `(unnamed)`. */
const TEST_HEADER = /^(\S+\.(?:test|spec)\.[jt]sx?):$/;
const FAIL_LINE = /^\(fail\) (.*?)(?: \[[\d.]+m?s\])?$/;

/** The failed tests that a `bun test` output names. */
export function failedTests(output: string): FailedTest[] {
  const tests: FailedTest[] = [];
  let file: string | undefined;
  for (const line of output.split("\n")) {
    file = TEST_HEADER.exec(line)?.[1] ?? file;
    const name = FAIL_LINE.exec(line)?.[1];
    if (name) tests.push({ file, name });
  }
  return tests;
}

/**
 * Clears the `file` of a failure whose file, at `sha`, does not hold the last ` > ` part of its name as literal
 * text (or is missing there): the header above a `(fail)` line is only a guess. `(unnamed)` keeps its file.
 */
export function checkPins(repo: Repo, sha: string, tests: FailedTest[]): FailedTest[] {
  const texts = new Map<string, string | null>();
  return tests.map((t) => {
    if (!t.file || t.name === "(unnamed)") return t;
    if (!texts.has(t.file)) {
      const r = git(repo.path, "show", `${sha}:${t.file}`);
      texts.set(t.file, r.ok ? r.out : null);
    }
    const text = texts.get(t.file);
    if (text != null && text.includes(t.name.split(" > ").at(-1)!)) return t;
    return { ...t, file: undefined };
  });
}

const regexEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");

/**
 * The command that runs only `tests` again. `-t` matches the name with spaces between its parts, where the
 * output has ` > `. An `(unnamed)` failure is a whole file's hook, so its files run whole. With no test
 * or no file to name, as for `bunx tsc`, the command itself runs again.
 */
export function rerunOf(command: string, tests: FailedTest[]): string {
  if (!tests.length || tests.some((t) => !t.file)) return command;
  const files = [...new Set(tests.map((t) => `./${t.file}`))].join(" ");
  const named = !tests.some((t) => t.name === "(unnamed)");
  const pattern = tests.map((t) => `^${t.name.split(" > ").map(regexEscape).join("( > | )")}$`).join("|");
  return `bun test --timeout=30000 ${files}${named ? ` -t ${q(pattern)}` : ""}`;
}

/** The machine is quiet when the 1-minute load is under half the cores; `ALEPH_QUIET_LOAD` changes the limit. */
const quiet = () => loadavg()[0] < quietLoad();

/** The files of the commits on origin/<main> that name the goal. */
function goalFiles(repo: Repo, name: string): Set<string> {
  const commits = commitsNaming(repo.path, `origin/${repo.main}`, name);
  if (!commits.length) return new Set();
  return new Set(git(repo.path, "log", "--no-walk", "--name-only", "--format=", ...commits).out.split("\n").filter(Boolean));
}

const testLabel = (t: FailedTest) => `${t.file ?? "(no file)"} > ${t.name}`;
/** How `bun test -t` reports a filter that matches no test: `error: regex "..." matched 0 tests`, exit 1. */
const NO_MATCH = /matched 0 tests/;
const failing = (r: Ran) => r.code !== 0 || FAIL_SUMMARY.test(r.output);

/** The commands in backticks in the issue's `## Oracle` section that start with a command the repo's checks use. */
export function oracleCommands(body: string): string[] {
  return [...section(body, "Oracle").matchAll(/`([^`\n]+)`/g)].map((m) => m[1].trim()).filter((c) => RUNNABLE.test(c) && !PLACEHOLDER.test(c));
}

/** `infra` marks a fault of the sandbox, not a result of the command: the acceptance is not run. */
export interface Ran { code: number; output: string; infra?: boolean }
/** Run one command on the commit `sha` of the repo's main. */
export type Runner = (repo: Repo, sha: string, command: string, hidden?: Record<string, string>) => Promise<Ran>;

/** The default runner: the commit goes in as a bundle, and the repo's setup and then the command run under srt, as the checks do. */
let calls = 0;
export const sandboxRunner: Runner = async (repo, sha, command, hidden) => {
  // Each call has its own folder and ref, so overlapping runs for one repo cannot remove or overwrite each other's files.
  const uid = `${process.pid}-${++calls}`;
  const run = makeRunFolder(`accept-${repo.key}-${uid}`);
  const ref = `refs/aleph/accept/${repo.key}/${uid}`;
  try {
    git(repo.path, "update-ref", ref, sha);
    const b = git(repo.path, "bundle", "create", join(run, "out", "accept.bundle"), ref);
    if (!b.ok) return { code: 1, output: `bundle failed: ${b.out}`, infra: true };
    if (hidden) {
      mkdirSync(join(run, "out", "hidden"), { recursive: true });
      for (const [name, text] of Object.entries(hidden)) writeFileSync(join(run, "out", "hidden", name), text);
    }
    const script = [
      cloneAndSetup(repo.setup, "out/accept.bundle", ref, "> ../checklog/setup.log 2>&1 || { echo setup failed >> ../checklog/out.log; cat ../checklog/setup.log >> ../checklog/out.log; touch ../checklog/setup-failed; echo 1 > ../checklog/code; exit 0; }"),
      ...(hidden ? ["cp -r ../out/hidden .hidden"] : []),
      `timeout -k 30 1200 bash -c ${q(command)} > ../checklog/out.log 2>&1; echo $? > ../checklog/code`,
    ].join("\n");
    const logs = join(run, "stdout.log");
    // The slot covers the sandboxed call only; the time limit is in the script, so the wait does not count against it.
    const free = await checkSlot();
    let r;
    try {
      r = await sandboxed(run, script, { read: ["out"], write: ["check", "checklog", "home", "tmp"], cwd: "check", env: { TZ: "UTC" }, hideCiMissing: true, stdout: logs, stderr: logs });
    } finally {
      free();
    }
    const at = (f: string) => join(run, "checklog", f);
    // The Oracle did not run: a setup failure is an infra error, and its log is in out.log.
    if (existsSync(at("setup-failed"))) return { code: 1, output: existsSync(at("out.log")) ? readFileSync(at("out.log"), "utf8") : "setup failed", infra: true };
    if (!existsSync(at("code"))) {
      const tail = existsSync(logs) ? lastLines(readFileSync(logs, "utf8")) : "";
      return { code: r.code || 1, output: `the command did not start (exit ${r.code})${tail ? `: ${tail}` : ""}`, infra: true };
    }
    return { code: Number(readFileSync(at("code"), "utf8").trim()), output: existsSync(at("out.log")) ? readFileSync(at("out.log"), "utf8") : "" };
  } finally {
    git(repo.path, "update-ref", "-d", ref);
    removeRunFolder(run);
  }
};

/** The numbers of the scenarios in a `scenarios.md` text, in order (`1.` or `1)` at a line start). */
export const scenarioNumbers = (text: string): number[] => [...text.matchAll(/^\s*(\d+)[.)]\s+\S/gm)].map((m) => Number(m[1]));

/** `pass` or `fail` by scenario number, from the `CHECK: pass|fail scenario <n>: ...` lines of an agent's reply. A fail wins over a pass for one number. */
export function scenarioMarks(output: string): Map<number, "pass" | "fail"> {
  const marks = new Map<number, "pass" | "fail">();
  for (const m of output.matchAll(/^\s*CHECK:\s*(pass|fail)\s+scenario\s+(\d+)\b/gim)) {
    const n = Number(m[2]), v = m[1].toLowerCase() as "pass" | "fail";
    if (v === "fail" || !marks.has(n)) marks.set(n, v);
  }
  return marks;
}

/** What the scenario agent said; `infra` marks a fault of the sandbox or the agent call, not a result. */
export interface Checked { output: string; infra?: boolean }
/** Check the sealed `scenarios` text against the commit `sha` of the repo's main, with one agent call. */
export type ScenarioCheck = (repo: Repo, sha: string, scenarios: string) => Promise<Checked>;

const SCENARIO_PROMPT = `You check sealed scenarios of a goal that landed. The working directory is a clone of the repo at the
commit that holds the goal. Check each scenario below by observing behaviour: read the code, and run a few
commands of your own, each well under a minute: write throwaway scripts outside the repo's tracked files and
run them. Do not change any tracked file. Do not run the full test suite. Be sceptical: do not talk yourself
out of a defect you found. For each scenario write one line, \`CHECK: pass|fail scenario <n>: <what was observed>\`,
by its number only; do not quote the scenario text. Write a line for every scenario, then stop.`;

/** The default scenario check: a fresh agent reads the commit under srt, as the reviewer does. */
export const sandboxScenarios: ScenarioCheck = async (repo, sha, scenarios) => {
  const uid = `${process.pid}-${++calls}`;
  const rdir = makeRunFolder(`accept-scn-${repo.key}-${uid}`);
  const ref = `refs/aleph/accept/${repo.key}/s${uid}`;
  try {
    git(repo.path, "update-ref", ref, sha);
    const b = git(repo.path, "bundle", "create", join(rdir, "out", "accept.bundle"), ref);
    if (!b.ok) return { output: `bundle failed: ${b.out}`, infra: true };
    const argv = [reviewerCmd(), "-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "bypassPermissions",
      "--tools", "Read", "Grep", "Glob", "Bash", "--model", "claude-opus-5-5"];
    const script = [
      "set -e", "exec 3>&1 1>&2", ...gitPrelude("../out/accept.bundle", [`+${ref}:${ref}`]), `git switch -q --detach ${q(ref)}`,
      `{ ${repo.setup.map((c) => `${c} && `).join("")}true; } || true`,
      "exec 1>&3 3>&-", `exec ${argv.map(q).join(" ")}`,
    ].join("\n");
    const log = join(rdir, "agent.log");
    const free = await checkSlot();
    let w;
    try {
      w = await sandboxed(rdir, script, {
        read: ["out/accept.bundle"], write: ["home", "work", "tmp"], cwd: "work", stdin: `${SCENARIO_PROMPT}\n\n## Scenarios\n\n${scenarios.trim()}\n`,
        env: { CLAUDE_CODE_OAUTH_TOKEN: workerToken(), CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1" },
        stdout: log, stderr: join(rdir, "agent.err"), limit: reviewSeconds(), stall: stallSeconds(),
      });
    } finally {
      free();
    }
    if (w.stalled) return { output: stallReason(), infra: true };
    if (w.timedOut) return { output: "time box", infra: true };
    const o = agentOutcome(existsSync(log) ? readFileSync(log, "utf8") : "");
    if (!o.ok) return { output: o.line || `exit ${w.code}`, infra: true };
    return { output: o.result };
  } finally {
    git(repo.path, "update-ref", "-d", ref);
    removeRunFolder(rdir);
  }
};

/** The last `n` lines of `text`, on one line (an issue note is one line), each cut to 200 characters. */
export const lastLines = (text: string, n = 40): string =>
  text.replace(/\s+$/, "").split("\n").slice(-n).map((l) => l.slice(0, 200)).join(" ⏎ ");

/** Item `id` open again, with `text` as a note and `ask` set on it, in one write. Returns why it could not, or null. */
function reopen(repo: Repo, id: number | string, text: string, ask?: Ask): string | null {
  try {
    const w = writeList(repo, `todo: item ${id}: ${text.slice(0, 80)}`, (doc) => {
      const item = issues.find(doc, id);
      if (!item) return null;
      storeReopen(doc, item, git(repo.path, "rev-parse", `origin/${repo.main}`).out || null);
      if (ask) setAsk(item, ask);
      return issues.note(item, text);
    });
    return w ? null : `no issue ${id}`;
  } catch (e: any) {
    return e?.message ?? String(e);
  }
}

/** The commands that passed on each repo's latest accepted commit. The file has no `.json` name, so `unshown` does not read it as a result. */
const passesFile = () => join(acceptanceDir(), "passes");
function readPasses(): Record<string, { commit: string; commands: string[] }> {
  try { return JSON.parse(readFileSync(passesFile(), "utf8")); } catch { return {}; }
}
/** A command that passed on this commit, for any goal: the sandbox gives it the same tree, so it does not run again. A failure is never reused. */
const passedOn = (key: string, commit: string, command: string): boolean => {
  const p = readPasses()[key];
  return p?.commit === commit && p.commands.includes(command);
};
function markPassed(key: string, commit: string, command: string): void {
  const all = readPasses();
  const p = all[key]?.commit === commit ? all[key] : { commit, commands: [] };
  all[key] = { commit, commands: [...new Set([...p.commands, command])] };
  mkdirSync(acceptanceDir(), { recursive: true });
  writeFileSync(passesFile(), JSON.stringify(all));
}

/** The commit whose failures hit the cap, once the news and the log have said so. No `.json` name, so `unshown` does not read it. */
const cappedFile = () => join(acceptanceDir(), "capped");
const cappedAt = (): string | null => { try { return JSON.parse(readFileSync(cappedFile(), "utf8")).commit ?? null; } catch { return null; } };

/** The goals with a `fail` record at the short commit `sha`, counting `name`. */
function failsAt(repo: Repo, sha: string, name: string): number {
  const names = new Set([name]);
  if (existsSync(acceptanceDir())) {
    for (const f of readdirSync(acceptanceDir())) {
      const m = /^(.+)-(\d+)\.json$/.exec(f);
      const r = m && readRecord(m[1], Number(m[2]));
      if (m && m[1] === repo.key && r && r.result === "fail" && r.sha === sha) names.add(`${m[1]}-${m[2]}`);
    }
  }
  return names.size;
}

/**
 * Run the Oracle of the done goal `item` on origin/<main>, and record what came of it.
 * Returns a line for the log. The caller has fetched and holds the goal's lock.
 */
export async function accept(repo: Repo, item: issues.Issue, run: Runner = sandboxRunner, now: Date = issues.clock(), check: ScenarioCheck = sandboxScenarios): Promise<string> {
  const ref = issues.refOf(item);
  const name = `${repo.key}-${ref}`;
  const prev = readRecord(repo.key, ref);
  const waiting = prev?.retest;
  // Held by the cap at this commit: it runs again at a later one.
  if (prev?.result === "fail" && !waiting && prev.fails < 2 && cappedAt() === git(repo.path, "rev-parse", `origin/${repo.main}`).out && prev.sha === git(repo.path, "rev-parse", "--short=7", `origin/${repo.main}`).out) {
    return `${name}: acceptance held at ${prev.sha}: the fail cap was reached at this commit`;
  }
  const began = Date.parse(waiting?.since ?? "");
  const overdue = Number.isFinite(began) && now.getTime() - began >= MAX_WAIT_MS;
  if (waiting && !quiet() && !overdue) return `${name}: acceptance rerun waits for a quiet machine (${waiting.command})`;
  const sha = git(repo.path, "rev-parse", "--short=7", waiting?.commit ?? `origin/${repo.main}`).out;
  if (!sha) return `${name}: acceptance not run: no origin/${repo.main}`;
  const full = waiting?.commit ?? git(repo.path, "rev-parse", `origin/${repo.main}`).out;
  const commands = oracleCommands(item.spec).filter((c) => !namesMissingTestFile(repo, full, c));
  let scenarios = "";
  try { scenarios = readHidden(repo, name)[SCENARIOS] ?? ""; } catch (e: any) { return `${name}: acceptance not run: the sealed scenarios are unreadable: ${e?.message ?? e}`; }
  const numbers = scenarioNumbers(scenarios);
  if (!numbers.length) scenarios = "";
  if (!commands.length && !scenarios) {
    writeRecord(repo.key, ref, { result: "skipped", fails: prev?.fails ?? 0 });
    return `${name}: acceptance skipped: the Oracle has no command that starts with bun test, bun run or bunx tsc, or loops over one, or that names a test file missing on ${repo.main}`;
  }
  const flaked: string[] = [];
  const flake = (t: FailedTest | string, how: string) => {
    const label = typeof t === "string" ? t : testLabel(t);
    flaked.push(label);
    const bad = noteFlake(repo, `acceptance ${name}: ${label}: ${how} at ${sha}`);
    if (typeof bad === "string") flaked.push(`(no flake note: ${bad})`);
  };
  /** The goal failed: past the cap nothing reopens; else the first fail reopens it, the second asks Chris. `out` goes in the note. */
  const failed_ = async (command: string, out: string, why: string): Promise<string> => {
    // Many goals failing at one commit point to a shared fault, not to the goals: none reopens, and each keeps its fail record.
    const cap = acceptanceFailCap();
    const count = failsAt(repo, sha, name);
    if (count >= cap) {
      writeRecord(repo.key, ref, { result: "fail", sha, command, fails: prev?.fails ?? 0, ...(prev?.since ? { since: prev.since } : {}) });
      if (cappedAt() === full) return `${name}: acceptance held at ${sha}: the fail cap was reached at this commit`;
      mkdirSync(acceptanceDir(), { recursive: true });
      writeFileSync(cappedFile(), JSON.stringify({ commit: full }));
      const line = `acceptance: ${count} goals failed at ${sha} (limit ${cap}); none reopens, they run again at a later commit`;
      await tell(line);
      return line;
    }
    const fails = (prev?.fails ?? 0) + 1;
    if (fails < 2) {
      const bad = reopen(repo, ref, `acceptance: fail at ${sha}: ${out}`);
      if (bad) return `${name}: acceptance failed but the issue was not reopened: ${bad}`;
      writeRecord(repo.key, ref, { result: "fail", sha, command, fails, since: full });
      return `${name}: acceptance failed at ${sha} (${command}); reopened for one more run`;
    }
    const bad = reopen(repo, ref, `acceptance: fail again at ${sha}: ${out} | ${why.charAt(0).toLowerCase()}${why.slice(1)}`, plainAsk("acceptance-failed", why, [out]));
    writeRecord(repo.key, ref, { result: "fail", sha, command, fails, since: full });
    return `${name}: acceptance failed again at ${sha} (${command}); asks Chris${bad ? ` (no issue note: ${bad})` : ""}`;
  };
  // A waiting rerun takes up at its command: the commands before it passed.
  for (const command of waiting ? commands.slice(Math.max(0, commands.indexOf(waiting.command))) : commands) {
    let failed = waiting?.command === command ? waiting : undefined;
    if (!failed) {
      if (passedOn(repo.key, full, command)) continue;
      const r = await run(repo, full, command);
      if (r.infra) return `${name}: acceptance not run: ${lastLines(r.output)}`;
      if (!failing(r)) { markPassed(repo.key, full, command); continue; }
      const tests = checkPins(repo, full, failedTests(r.output));
      failed = { commit: full, command, rerun: rerunOf(command, tests), tests, since: now.toISOString() };
      writeRecord(repo.key, ref, { result: "fail", sha, command, fails: prev?.fails ?? 0, ...(prev?.since ? { since: prev.since } : {}), retest: failed });
      if (!quiet()) return `${name}: acceptance failed at ${sha} (${command}); the rerun waits for a quiet machine`;
    }
    let r = await run(repo, full, failed.rerun);
    // The record keeps the retest, so the next step tries the rerun again.
    if (r.infra) return `${name}: acceptance not run: ${lastLines(r.output)}`;
    const touched = goalFiles(repo, name);
    const isTouched = (t: FailedTest) => !t.file || !touched.size || touched.has(t.file);
    // A filter that matches no test names the wrong file: the Oracle's own command is the rerun.
    let pinned = failed.tests.length > 0 && failed.rerun !== command;
    if (pinned && NO_MATCH.test(r.output)) {
      pinned = false;
      r = await run(repo, full, command);
      if (r.infra) return `${name}: acceptance not run: ${lastLines(r.output)}`;
    }
    // A touched test that passes once runs again before it is called a flake: any failure is a repeat.
    if (!failing(r) && pinned && failed.tests.some(isTouched)) {
      for (let i = 0; i < EXTRA_RERUNS && !failing(r); i++) {
        r = await run(repo, full, failed.rerun);
        if (r.infra) return `${name}: acceptance not run: ${lastLines(r.output)}`;
      }
    }
    if (!failing(r)) {
      if (pinned || (failed.tests.length && failed.rerun === command)) for (const t of failed.tests) flake(t, "failed under load, passed on the quiet rerun");
      else flake(`\`${command}\``, "failed under load, passed on the quiet rerun");
      continue;
    }
    const tests = checkPins(repo, full, failedTests(r.output));
    const others = tests.filter((t) => t.file && touched.size && !touched.has(t.file));
    if (tests.length && others.length === tests.length) {
      // Only untouched files fail: a regression of the goal if they fail at its newest commit and passed before it.
      const hits = commitsNaming(repo.path, `origin/${repo.main}`, name);
      const parent = hits.length ? git(repo.path, "rev-parse", "--verify", "-q", `${hits.at(-1)}^`).out : "";
      let why = "failed twice, in a test the goal did not touch,";
      if (!parent) why += " and the goal has no parent commit to compare with,";
      else {
        const at = await run(repo, hits[0], failed.rerun);
        if (at.infra) return `${name}: acceptance not run: ${lastLines(at.output)}`;
        if (!failing(at)) why += " and passed at the goal's newest commit,";
        else {
          const before = await run(repo, parent, failed.rerun);
          if (before.infra) return `${name}: acceptance not run: ${lastLines(before.output)}`;
          if (failing(before)) why += " and also at the goal's parent,";
          else why = "";
        }
      }
      if (why) { for (const t of others) flake(t, why); continue; }
    } else for (const t of others) flake(t, "failed twice, in a test the goal did not touch,");
    const out = `\`${command}\` exited ${r.code}${r.code === 0 ? " with failing tests" : ""}, and the quiet rerun failed too: ${tests.length ? `${tests.slice(0, 40).map((t) => `(fail) ${testLabel(t).slice(0, 200)}`).join(" ⏎ ")} ⏎ ` : ""}${lastLines(r.output)}`;
    return failed_(command, out, `The Oracle command \`${command}\` still fails after the rerun, so the factory stopped; fix it or the goal.`);
  }
  if (scenarios) {
    let got: Awaited<ReturnType<ScenarioCheck>>;
    try { got = await check(repo, full, scenarios); } catch (e: any) { got = { output: String(e?.message ?? e), infra: true }; }
    if (got.infra) return `${name}: acceptance not run: the scenario check: ${lastLines(got.output)}`;
    const marks = scenarioMarks(got.output);
    const missing = numbers.filter((n) => !marks.has(n));
    if (missing.length) return `${name}: acceptance not run: the scenario check gave no CHECK line for scenario ${missing.join(", ")}`;
    const bad = numbers.filter((n) => marks.get(n) === "fail");
    if (bad.length) {
      const which = `scenario${bad.length > 1 ? "s" : ""} ${bad.join(", ")}`;
      return failed_(which, `${which} failed`, `Sealed ${which} still fail${bad.length > 1 ? "" : "s"} after the rerun, so the factory stopped; fix it or the goal.`);
    }
  }
  const seen = flaked.length ? `; on the flake list: ${flaked.join(", ")}` : "";
  const bad = note(repo, ref, `acceptance: pass at ${sha}${seen}`);
  writeRecord(repo.key, ref, { result: "pass", sha, fails: prev?.fails ?? 0 });
  return `${name}: acceptance passed at ${sha}${seen}${bad ? ` (no issue note: ${bad})` : ""}`;
}

/** The results the report has not listed, oldest file first; each is then marked shown. */
export function unshown(): string[] {
  if (!existsSync(acceptanceDir())) return [];
  const lines: string[] = [];
  for (const f of readdirSync(acceptanceDir()).filter((f) => f.endsWith(".json")).sort()) {
    const m = /^(.+)-(\d+)\.json$/.exec(f);
    const r = m && readRecord(m[1], Number(m[2]));
    if (!m || !r || r.shown) continue;
    lines.push(`${m[1]}-${m[2]} ${resultLine(m[1], Number(m[2]))}`);
    writeRecord(m[1], Number(m[2]), { ...r, shown: true });
  }
  return lines;
}

/** The minute a note line was written (`- YYYY-MM-DD HH:MM: text`, local time), in ms, or null. */
const noteTime = (line: string): number | null => {
  const m = /^- (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}): /.exec(line);
  const t = m ? new Date(`${m[1]}T${m[2]}`).getTime() : NaN;
  return Number.isNaN(t) ? null : t;
};
const RE_NOTE = /^- \S+ \S+: re-accept: (fail|not run)/;

/**
 * Whether the open goal `item` was reopened by an acceptance `fail` (the first, not `fail again`) written
 * in [since, before), and has had no worker note since. A `re-accept: fail` ends it; `re-accept: not run`
 * (an infra error) leaves it for the next pass.
 */
export function reopenedByAcceptance(item: issues.Issue, since = -Infinity, before = Infinity): boolean {
  if (issues.status(item) !== "open") return false;
  const notes = item.notes.filter((l) => !/^- \S+ \S+: re-accept: not run/.test(l));
  const last = notes[notes.length - 1];
  if (!last || RE_NOTE.test(last)) return false;
  if (!/^- \S+ \S+: acceptance: fail at /.test(last)) return false;
  const t = noteTime(last);
  return t !== null && t >= since && t < before;
}

/**
 * Run the Oracle again of the reopened goal `item` on origin/<main>. A pass closes it as done with a note
 * naming each command; a failure leaves it open with a note, and so does an infra error, with the output tail.
 * Returns a line for the log. The caller has fetched and holds the goal's lock.
 */
export async function reaccept(repo: Repo, item: issues.Issue, run: Runner = sandboxRunner): Promise<string> {
  const name = `${repo.key}-${issues.refOf(item)}`;
  if (issues.status(item) !== "done" && issues.status(item) !== "open") return `${name}: re-accept skipped: the item is ${issues.status(item)}`;
  const sha = git(repo.path, "rev-parse", "--short=7", `origin/${repo.main}`).out;
  if (!sha) return `${name}: re-accept not run: no origin/${repo.main}`;
  const full = git(repo.path, "rev-parse", `origin/${repo.main}`).out;
  const commands = oracleCommands(item.spec).filter((c) => !namesMissingTestFile(repo, full, c));
  if (!commands.length) return `${name}: re-accept skipped: the Oracle has no runnable command`;
  const passed: string[] = [];
  for (const command of commands) {
    const r = await run(repo, full, command);
    if (r.infra) {
      const bad = note(repo, issues.refOf(item), `re-accept: not run at ${sha}: \`${command}\`: ${lastLines(r.output)}`);
      return `${name}: re-accept not run: ${lastLines(r.output)}${bad ? ` (no issue note: ${bad})` : ""}`;
    }
    const failedTests = r.code === 0 && FAIL_SUMMARY.test(r.output);
    if (r.code === 0 && !failedTests) { passed.push(command); continue; }
    const bad = note(repo, issues.refOf(item), `re-accept: fail at ${sha}: \`${command}\` exited ${r.code}${failedTests ? " with failing tests" : ""}: ${lastLines(r.output)}`);
    return `${name}: re-accept failed at ${sha} (${command}); left open${bad ? ` (no issue note: ${bad})` : ""}`;
  }
  const bad = note(repo, issues.refOf(item), `acceptance: pass at ${sha} (re-run after an infra error): ${passed.map((c) => `\`${c}\` exited 0`).join(", ")}`, { done: true });
  if (!bad) writeRecord(repo.key, issues.refOf(item), { result: "pass", sha, fails: readRecord(repo.key, issues.refOf(item))?.fails ?? 0 });
  return `${name}: re-accept passed at ${sha}; closed as done${bad ? ` (no issue note: ${bad})` : ""}`;
}
