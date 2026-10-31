/**
 * The acceptance run: a done goal's own Oracle, run again on origin/<main> under srt.
 * See "Acceptance run" in docs/specs/2026-10-26-seed-factory.md.
 *
 * The result of each goal is kept in <factory>/acceptance/<repo>-<n>.json. A first failure
 * reopens the goal for one more worker run; a second sets an Ask (input, acceptance-failed) on it.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as todos from "../../todo/lib/todo.ts";
import { note, writeList } from "../../todo/lib/store.ts";
import { git } from "./git.ts";
import { expand, type Repo } from "./ledger.ts";
import { section } from "./plan.ts";
import { makeRunFolder, removeRunFolder, sandboxed } from "./sandbox.ts";

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
}

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
      const item = todos.find(doc, id);
      if (!item) return null;
      todos.setStatus(item, "open");
      return todos.note(item, text);
    });
    return w ? null : `no issue ${id}`;
  } catch (e: any) {
    return e?.message ?? String(e);
  }
}

/**
 * Run the Oracle of the done goal `item` on origin/<main>, and record what came of it.
 * Returns a line for the log. The caller has fetched and holds the goal's lock.
 */
export async function accept(repo: Repo, item: todos.Item, run: Runner = sandboxRunner): Promise<string> {
  const name = `${repo.key}-${todos.refOf(item)}`;
  const prev = readRecord(repo.key, todos.refOf(item));
  const sha = git(repo.path, "rev-parse", "--short=7", `origin/${repo.main}`).out;
  if (!sha) return `${name}: acceptance not run: no origin/${repo.main}`;
  const full = git(repo.path, "rev-parse", `origin/${repo.main}`).out;
  const commands = oracleCommands(item.body).filter((c) => !namesMissingTestFile(repo, full, c));
  if (!commands.length) {
    writeRecord(repo.key, todos.refOf(item), { result: "skipped", fails: prev?.fails ?? 0 });
    return `${name}: acceptance skipped: the Oracle has no command that starts with bun test, bun run or bunx tsc, or loops over one, or that names a test file missing on ${repo.main}`;
  }
  for (const command of commands) {
    const r = await run(repo, full, command);
    if (r.infra) return `${name}: acceptance not run: ${lastLines(r.output)}`;
    const failedTests = r.code === 0 && FAIL_SUMMARY.test(r.output);
    if (r.code === 0 && !failedTests) continue;
    const fails = (prev?.fails ?? 0) + 1;
    const out = `\`${command}\` exited ${r.code}${failedTests ? " with failing tests" : ""}: ${lastLines(r.output)}`;
    if (fails < 2) {
      const bad = reopen(repo, todos.refOf(item), `acceptance: fail at ${sha}: ${out}`);
      if (bad) return `${name}: acceptance failed but the issue was not reopened: ${bad}`;
      writeRecord(repo.key, todos.refOf(item), { result: "fail", sha, command, fails, since: full });
      return `${name}: acceptance failed at ${sha} (${command}); reopened for one more run`;
    }
    const bad = note(repo, todos.refOf(item), `acceptance: fail again at ${sha}: ${out} | the Oracle command \`${command}\` still fails after the rerun, so the factory stopped; fix it or the goal.`, { ask: { kind: "input", reason: "acceptance-failed", question: `The Oracle command \`${command}\` still fails after the rerun, so the factory stopped; fix it or the goal.`, options: [], why: [out] } });
    writeRecord(repo.key, todos.refOf(item), { result: "fail", sha, command, fails, since: full });
    return `${name}: acceptance failed again at ${sha} (${command}); asks Chris${bad ? ` (no issue note: ${bad})` : ""}`;
  }
  const bad = note(repo, todos.refOf(item), `acceptance: pass at ${sha}`);
  writeRecord(repo.key, todos.refOf(item), { result: "pass", sha, fails: prev?.fails ?? 0 });
  return `${name}: acceptance passed at ${sha}${bad ? ` (no issue note: ${bad})` : ""}`;
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
export function reopenedByAcceptance(item: todos.Item, since = -Infinity, before = Infinity): boolean {
  if (todos.status(item) !== "open") return false;
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
export async function reaccept(repo: Repo, item: todos.Item, run: Runner = sandboxRunner): Promise<string> {
  const name = `${repo.key}-${todos.refOf(item)}`;
  const sha = git(repo.path, "rev-parse", "--short=7", `origin/${repo.main}`).out;
  if (!sha) return `${name}: re-accept not run: no origin/${repo.main}`;
  const full = git(repo.path, "rev-parse", `origin/${repo.main}`).out;
  const commands = oracleCommands(item.body).filter((c) => !namesMissingTestFile(repo, full, c));
  if (!commands.length) return `${name}: re-accept skipped: the Oracle has no runnable command`;
  const passed: string[] = [];
  for (const command of commands) {
    const r = await run(repo, full, command);
    if (r.infra) {
      const bad = note(repo, todos.refOf(item), `re-accept: not run at ${sha}: \`${command}\`: ${lastLines(r.output)}`);
      return `${name}: re-accept not run: ${lastLines(r.output)}${bad ? ` (no issue note: ${bad})` : ""}`;
    }
    const failedTests = r.code === 0 && FAIL_SUMMARY.test(r.output);
    if (r.code === 0 && !failedTests) { passed.push(command); continue; }
    const bad = note(repo, todos.refOf(item), `re-accept: fail at ${sha}: \`${command}\` exited ${r.code}${failedTests ? " with failing tests" : ""}: ${lastLines(r.output)}`);
    return `${name}: re-accept failed at ${sha} (${command}); left open${bad ? ` (no issue note: ${bad})` : ""}`;
  }
  const bad = note(repo, todos.refOf(item), `acceptance: pass at ${sha} (re-run after an infra error): ${passed.map((c) => `\`${c}\` exited 0`).join(", ")}`, { done: true });
  if (!bad) writeRecord(repo.key, todos.refOf(item), { result: "pass", sha, fails: readRecord(repo.key, todos.refOf(item))?.fails ?? 0 });
  return `${name}: re-accept passed at ${sha}; closed as done${bad ? ` (no issue note: ${bad})` : ""}`;
}
