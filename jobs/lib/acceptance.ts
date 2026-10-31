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
import { availableParallelism, loadavg } from "node:os";
import { join } from "node:path";
import * as issues from "../../todo/lib/todo.ts";
import { note, noteFlake, writeList } from "../../todo/lib/store.ts";
import { git } from "./git.ts";
import { expand, type Repo } from "./ledger.ts";
import { section } from "./plan.ts";
import { makeRunFolder, removeRunFolder, sandboxed } from "./sandbox.ts";
import { commitsNaming } from "./status.ts";

const dir = () => join(expand(process.env.ALEPH_FACTORY_DIR ?? "~/.aleph/factory"), "acceptance");
const file = (key: string, id: number | string) => join(dir(), `${key}-${id}.json`);

export interface Accepted {
  /** `pass`, `skipped` (no runnable command), or `fail`. */
  result: "pass" | "skipped" | "fail";
  /** The short sha of origin/<main> the Oracle ran on. */
  sha?: string;
  /** The command that failed. */
  command?: string;
  /** How many runs of the Oracle failed. */
  fails: number;
  /** After a failure: the origin/<main> commit the reopened goal's earlier landings are at or before. */
  since?: string;
  /** The report has listed this result. */
  shown?: boolean;
  /** A failure that waits for its rerun on a quiet machine. */
  retest?: Retest;
}

/** One failed test of a `bun test` run. `file` is unset when the output names no file above it. */
export interface FailedTest { file?: string; name: string }

/** What a failure runs again: `rerun`, on the commit that failed. */
export interface Retest { commit: string; command: string; rerun: string; tests: FailedTest[] }

export function readRecord(key: string, id: number | string): Accepted | null {
  try { return JSON.parse(readFileSync(file(key, id), "utf8")); } catch { return null; }
}

function writeRecord(key: string, id: number | string, r: Accepted): void {
  mkdirSync(dir(), { recursive: true });
  writeFileSync(file(key, id), JSON.stringify(r, null, 2) + "\n");
}

/** The result as one line for the report and the Lands card, or null when the goal has none. */
export function resultLine(key: string, id: number | string): string | null {
  const r = readRecord(key, id);
  if (!r) return null;
  if (r.result === "pass") return `acceptance: pass at ${r.sha}`;
  if (r.result === "skipped") return "acceptance: skipped, no runnable command";
  if (r.retest) return `acceptance: fail, waits for a rerun: ${r.command}`;
  return `acceptance: fail${r.fails >= 2 ? " twice" : ", rerun"}: ${r.command}`;
}

/** A record that ends the goal's acceptance: nothing runs again for it. */
export const final = (r: Accepted | null): boolean => !!r && (r.result !== "fail" || r.fails >= 2);

/** The commits of `hits` the goal's reopening has not already counted: those that are not at or before its `since`. */
export function afterReopen(cwd: string, key: string, id: number | string, hits: string[]): string[] {
  const since = readRecord(key, id)?.since;
  return since ? hits.filter((h) => !git(cwd, "merge-base", "--is-ancestor", h, since).ok) : hits;
}

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
const quiet = () => loadavg()[0] < (Number(process.env.ALEPH_QUIET_LOAD) || availableParallelism() / 2);

/** The files of the commits on origin/<main> that name the goal. */
function goalFiles(repo: Repo, name: string): Set<string> {
  const commits = commitsNaming(repo.path, `origin/${repo.main}`, name);
  if (!commits.length) return new Set();
  return new Set(git(repo.path, "log", "--no-walk", "--name-only", "--format=", ...commits).out.split("\n").filter(Boolean));
}

const testLabel = (t: FailedTest) => `${t.file ?? "(no file)"} > ${t.name}`;
const failing = (r: Ran) => r.code !== 0 || FAIL_SUMMARY.test(r.output);

/** The commands in backticks in the issue's `## Oracle` section that start with a command the repo's checks use. */
export function oracleCommands(body: string): string[] {
  return [...section(body, "Oracle").matchAll(/`([^`\n]+)`/g)].map((m) => m[1].trim()).filter((c) => RUNNABLE.test(c) && !PLACEHOLDER.test(c));
}

/** `infra` marks a fault of the sandbox, not a result of the command: the acceptance is not run. */
export interface Ran { code: number; output: string; infra?: boolean }
/** Run one command on the commit `sha` of the repo's main. */
export type Runner = (repo: Repo, sha: string, command: string) => Promise<Ran>;

const q = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

/** The default runner: the commit goes in as a bundle, and the repo's setup and then the command run under srt, as the checks do. */
let calls = 0;
export const sandboxRunner: Runner = async (repo, sha, command) => {
  // Each call has its own folder and ref, so overlapping runs for one repo cannot remove or overwrite each other's files.
  const uid = `${process.pid}-${++calls}`;
  const run = makeRunFolder(`accept-${repo.key}-${uid}`);
  const ref = `refs/aleph/accept/${repo.key}/${uid}`;
  try {
    git(repo.path, "update-ref", ref, sha);
    const b = git(repo.path, "bundle", "create", join(run, "out", "accept.bundle"), ref);
    if (!b.ok) return { code: 1, output: `bundle failed: ${b.out}`, infra: true };
    const script = [
      "set -e", "git init -q .", `git fetch -q ../out/accept.bundle ${q(`+${ref}:refs/heads/check`)}`, "git switch -q check", "set +e",
      `{ ${repo.setup.map((c) => `${c} && `).join("")}true; } > ../checklog/setup.log 2>&1 || { echo setup failed >> ../checklog/out.log; cat ../checklog/setup.log >> ../checklog/out.log; touch ../checklog/setup-failed; echo 1 > ../checklog/code; exit 0; }`,
      `timeout -k 30 1200 bash -c ${q(command)} > ../checklog/out.log 2>&1; echo $? > ../checklog/code`,
    ].join("\n");
    const logs = join(run, "stdout.log");
    const r = await sandboxed(run, script, { read: ["out"], write: ["check", "checklog", "home", "tmp"], cwd: "check", stdout: logs, stderr: logs });
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

/** The last `n` lines of `text`, on one line (an issue note is one line), each cut to 200 characters. */
export const lastLines = (text: string, n = 40): string =>
  text.replace(/\s+$/, "").split("\n").slice(-n).map((l) => l.slice(0, 200)).join(" ⏎ ");

/** Item `id` open again, with `text` as a note. Returns why it could not, or null. */
function reopen(repo: Repo, id: number | string, text: string): string | null {
  try {
    const w = writeList(repo, `todo: item ${id}: ${text.slice(0, 80)}`, (doc) => {
      const item = issues.find(doc, id);
      if (!item) return null;
      issues.setStatus(item, "open");
      return issues.note(item, text);
    });
    return w ? null : `no issue ${id}`;
  } catch (e: any) {
    return e?.message ?? String(e);
  }
}

/** The commands that passed on each repo's latest accepted commit. The file has no `.json` name, so `unshown` does not read it as a result. */
const passesFile = () => join(dir(), "passes");
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
  mkdirSync(dir(), { recursive: true });
  writeFileSync(passesFile(), JSON.stringify(all));
}

/**
 * Run the Oracle of the done goal `item` on origin/<main>, and record what came of it.
 * Returns a line for the log. The caller has fetched and holds the goal's lock.
 */
export async function accept(repo: Repo, item: issues.Issue, run: Runner = sandboxRunner): Promise<string> {
  const ref = issues.refOf(item);
  const name = `${repo.key}-${ref}`;
  const prev = readRecord(repo.key, ref);
  const waiting = prev?.retest;
  if (waiting && !quiet()) return `${name}: acceptance rerun waits for a quiet machine (${waiting.command})`;
  const sha = git(repo.path, "rev-parse", "--short=7", waiting?.commit ?? `origin/${repo.main}`).out;
  if (!sha) return `${name}: acceptance not run: no origin/${repo.main}`;
  const full = waiting?.commit ?? git(repo.path, "rev-parse", `origin/${repo.main}`).out;
  const commands = oracleCommands(item.body).filter((c) => !namesMissingTestFile(repo, full, c));
  if (!commands.length) {
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
  // A waiting rerun takes up at its command: the commands before it passed.
  for (const command of waiting ? commands.slice(Math.max(0, commands.indexOf(waiting.command))) : commands) {
    let failed = waiting?.command === command ? waiting : undefined;
    if (!failed) {
      if (passedOn(repo.key, full, command)) continue;
      const r = await run(repo, full, command);
      if (r.infra) return `${name}: acceptance not run: ${lastLines(r.output)}`;
      if (!failing(r)) { markPassed(repo.key, full, command); continue; }
      const tests = failedTests(r.output);
      failed = { commit: full, command, rerun: rerunOf(command, tests), tests };
      writeRecord(repo.key, ref, { result: "fail", sha, command, fails: prev?.fails ?? 0, ...(prev?.since ? { since: prev.since } : {}), retest: failed });
      if (!quiet()) return `${name}: acceptance failed at ${sha} (${command}); the rerun waits for a quiet machine`;
    }
    const r = await run(repo, full, failed.rerun);
    // The record keeps the retest, so the next step tries the rerun again.
    if (r.infra) return `${name}: acceptance not run: ${lastLines(r.output)}`;
    if (!failing(r)) {
      if (failed.tests.length) for (const t of failed.tests) flake(t, "failed under load, passed on the quiet rerun");
      else flake(`\`${command}\``, "failed under load, passed on the quiet rerun");
      continue;
    }
    const tests = failedTests(r.output);
    const touched = goalFiles(repo, name);
    const others = tests.filter((t) => t.file && touched.size && !touched.has(t.file));
    for (const t of others) flake(t, "failed twice, in a test the goal did not touch,");
    if (tests.length && others.length === tests.length) continue;
    const fails = (prev?.fails ?? 0) + 1;
    const out = `\`${command}\` exited ${r.code}${r.code === 0 ? " with failing tests" : ""}, and the quiet rerun failed too: ${tests.length ? `${tests.slice(0, 40).map((t) => `(fail) ${testLabel(t).slice(0, 200)}`).join(" ⏎ ")} ⏎ ` : ""}${lastLines(r.output)}`;
    if (fails < 2) {
      const bad = reopen(repo, ref, `acceptance: fail at ${sha}: ${out}`);
      if (bad) return `${name}: acceptance failed but the issue was not reopened: ${bad}`;
      writeRecord(repo.key, ref, { result: "fail", sha, command, fails, since: full });
      return `${name}: acceptance failed at ${sha} (${command}); reopened for one more run`;
    }
    const bad = note(repo, ref, `acceptance: fail again at ${sha}: ${out} | the Oracle command \`${command}\` still fails after the rerun, so the factory stopped; fix it or the goal.`, { ask: { kind: "input", reason: "acceptance-failed", question: `The Oracle command \`${command}\` still fails after the rerun, so the factory stopped; fix it or the goal.`, options: [], why: [out] } });
    writeRecord(repo.key, ref, { result: "fail", sha, command, fails, since: full });
    return `${name}: acceptance failed again at ${sha} (${command}); asks Chris${bad ? ` (no issue note: ${bad})` : ""}`;
  }
  const seen = flaked.length ? `; on the flake list: ${flaked.join(", ")}` : "";
  const bad = note(repo, ref, `acceptance: pass at ${sha}${seen}`);
  writeRecord(repo.key, ref, { result: "pass", sha, fails: prev?.fails ?? 0 });
  return `${name}: acceptance passed at ${sha}${seen}${bad ? ` (no issue note: ${bad})` : ""}`;
}

/** The results the report has not listed, oldest file first; each is then marked shown. */
export function unshown(): string[] {
  if (!existsSync(dir())) return [];
  const lines: string[] = [];
  for (const f of readdirSync(dir()).filter((f) => f.endsWith(".json")).sort()) {
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
  const sha = git(repo.path, "rev-parse", "--short=7", `origin/${repo.main}`).out;
  if (!sha) return `${name}: re-accept not run: no origin/${repo.main}`;
  const full = git(repo.path, "rev-parse", `origin/${repo.main}`).out;
  const commands = oracleCommands(item.body).filter((c) => !namesMissingTestFile(repo, full, c));
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
