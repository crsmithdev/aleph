/**
 * The firefighter, as code: no agent runs. Each tick it reads the reds of the factory repos (a failed baseline in
 * baseline.json, a red GitHub CI on main in ci.json) and files one critical
 * issue per failing commit, with the tail of the failure's log in its request. The request names the commit
 * (`Failing commit: <sha>`), so a second tick, or a second source for the same commit, files nothing more. While the
 * repo has an open red-main issue whose failure failed the same tests, a new failing commit is one note on that issue,
 * not a second issue; a failure with other failing tests, or with none where the issue has some, files its own issue. It
 * also sets a rescue Ask on each land live past 30 minutes (`askSlowLands`, rescue.ts). Stuck, failed and lost runs are the
 * rescue's (rescue.ts), and an issue that loops is the loop guard's (issue-decision.ts); their Asks are the director's.
 * A CI issue's request quotes the failure (`ciFailure`), and its job record keeps it (`ci`), so a claim that the issue is
 * already met reruns while CI on main is red (rescue.ts). Its land leaves it open; `settleCi` closes it when a CI run at
 * or after the land is green, and sends it back when one is red. An issue whose job never landed closes the same way on
 * a green run past its failing commit, so a green main brought by another commit settles it.
 * Older ledgers hold runs of kind `firefighter`, from when this was an agent.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import * as issues from "../../../issues/lib/todo.ts";
import * as store from "../../../issues/lib/store.ts";
import { loadRegistry, type Repo } from "../records/ledger.ts";
import { ciOf, gh, redCi, ciLine, type Gh } from "./ci.ts";
import { baselines, factoryDir, factoryRepos, gates, redLine } from "./factory-status.ts";
import { git } from "../infra/git.ts";
import { factoryLog, logEvent } from "../infra/layout.ts";
import * as record from "../records/record.ts";
import { askSlowLands } from "../land/rescue.ts";
import { runFile } from "../records/run-files.ts";

/** The most of a log that goes into an issue's request: its last LOG_LINES lines, cut to LOG_CHARS. */
export const LOG_LINES = 200;
export const LOG_CHARS = 8000;
/** The most of a log that goes into a note: one line. */
const NOTE_CHARS = 300;

export type Source = "baseline" | "ci";
const SOURCE_NAME: Record<Source, string> = { baseline: "the baseline checks", ci: "GitHub CI on main" };

/** One failure the firefighter files: the repo, the failing commit, what failed, and its log, read only when it is filed. */
export interface Red { repo: string; commit: string; source: Source; line: string; log: () => string; url?: string }

/** How the firefighter reads what is outside the factory directory. Tests replace it. */
export interface Ports { gh: Gh }
export const defaultPorts: Ports = { gh };

/** The failed jobs' log of the GitHub CI run at `url`. */
const ciLog = (ports: Ports, repo: Repo, url: string): string => {
  const id = /\/runs\/(\d+)/.exec(url)?.[1];
  if (!id) return `(no run id in ${url})`;
  const r = ports.gh(repo, ["run", "view", id, "--log-failed"]);
  return r.ok ? r.out : `(gh run view ${id} --log-failed failed: ${r.out})`;
};

const read = (path: string): string => { try { return readFileSync(path, "utf8"); } catch { return ""; } };

/** The last LOG_LINES lines of a log, cut to LOG_CHARS from the front. */
export function tail(text: string): string {
  const t = text.trimEnd().split("\n").slice(-LOG_LINES).join("\n");
  return t.length > LOG_CHARS ? `…${t.slice(t.length - LOG_CHARS + 1)}` : t;
}

const STAMP = /^\uFEFF?\d{4}-\d\d-\d\dT[\d:.]+Z ?/;

/**
 * The failure in a `gh run view --log-failed` log, short: the failing tests (`(fail)` lines), the error annotations
 * (`##[error]` and the lines that continue one), and the runner's core count (the `runner cores: <n>` line the CI
 * workflow prints) beside this host's. A log with neither tests nor annotations gives its tail.
 */
export function ciFailure(log: string, hostCores = availableParallelism()): string {
  const fails = new Set<string>(), errors: string[] = [];
  let cores: number | undefined, inError = false;
  for (const raw of log.split("\n")) {
    const l = raw.replace(/^[^\t]*\t[^\t]*\t/, "");
    const stamped = STAMP.test(l), text = l.replace(STAMP, "").trimEnd();
    if (stamped) inError = false;
    const c = /^runner cores: (\d+)$/.exec(text);
    if (c) cores = Number(c[1]);
    if (text.startsWith("(fail) ")) fails.add(text);
    else if (text.startsWith("##[error]") && !text.startsWith("##[error]Process completed")) { errors.push(text.slice(9)); inError = true; }
    else if (inError && !stamped) errors.push(text);
  }
  const parts = [
    fails.size ? `Failing tests:\n${[...fails].join("\n")}` : "",
    errors.length ? `Failure lines:\n${errors.join("\n").trim()}` : "",
    cores === undefined ? "" : `Runner: ${cores} cores; this host: ${hostCores}.${cores < hostCores ? ` To run as the runner does, pin the run to its cores: \`taskset -c 0-${cores - 1} <the test command>\`.` : ""}`,
  ].filter(Boolean);
  return fails.size || errors.length ? tail(parts.join("\n\n")) : tail(log);
}

/** The last non-empty lines of a log as one line of at most NOTE_CHARS. */
const oneLine = (text: string): string => {
  const t = text.split("\n").map((l) => l.trim()).filter(Boolean).join(" | ");
  return t.length > NOTE_CHARS ? `…${t.slice(t.length - NOTE_CHARS + 1)}` : t;
};

/** Every red of the factory repos now: the failed baselines and the red CIs. */
export function reds(ports: Ports = defaultPorts): Red[] {
  const reg = loadRegistry();
  const keys = new Set(factoryRepos().map((r) => r.key));
  const out: Red[] = [];
  for (const b of Object.values(baselines())) {
    if (b.ok || !keys.has(b.repo)) continue;
    out.push({ repo: b.repo, commit: b.commit, source: "baseline", line: `${b.repo} ${redLine(b)}`, log: () => read(runFile(join(factoryDir(), "baseline", b.repo), "checks.log")) });
  }
  for (const c of redCi()) {
    if (!keys.has(c.repo) || !c.sha) continue;
    let log: string | undefined;
    out.push({ repo: c.repo, commit: c.sha, source: "ci", line: ciLine(c), log: () => (log ??= ciLog(ports, reg[c.repo], c.url)), url: c.url });
  }
  return out;
}

const mark = (commit: string) => `Failing commit: ${commit}`;
const isRedMain = (i: issues.Issue) => store.areasOf(i).includes("red-main") || store.labels(i).includes("red-main");

/** The failing tests of a failure: the names on its `(fail)` lines, each without the trailing duration such as `[12.34ms]`. */
const failsOf = (text: string): string[] => [...new Set([...text.matchAll(/^\(fail\) (.+?)(?: \[[\d.]+m?s\])?$/gm)].map((m) => m[1]))].sort();
/** Whether two failures failed the same tests. A failure with no `(fail)` lines matches only another with none. */
const sameFails = (a: string, b: string): boolean => { const x = failsOf(a), y = failsOf(b); return x.length === y.length && x.every((t, i) => t === y[i]); };
/** The issue that holds this commit already: in its request, as filed, or in a note, as a later commit during an open fix. */
const holds = (i: issues.Issue, commit: string) => isRedMain(i) && (i.request.includes(mark(commit)) || i.notes.some((n) => n.includes(mark(commit))));

const TITLES: Record<Source, string> = { baseline: "Fix the red main at", ci: "Fix the red CI on main at" };
const titleOf = (r: Red) => (/^[0-9a-f]{7,}$/.test(r.commit) ? `${TITLES[r.source]} ${r.commit.slice(0, 7)}` : TITLES[r.source].replace(/ at$/, ""));

export type Filed = { repo: string; commit: string; source: Source } & ({ filed: number } | { noted: number });

/**
 * File one red: nothing when an issue of the repo already holds its commit; a note on the newest open red-main issue
 * whose failure failed the same tests, when there is one; else a new critical issue with the log's tail. The check runs
 * again inside the write, on the store as it is then, so two ticks at once file it once.
 */
export function fileRed(r: Red): Filed | null {
  if ((store.reader().list(r.repo)?.items ?? []).some((i) => holds(i, r.commit))) return null;
  const repo = loadRegistry()[r.repo];
  if (!repo) return null;
  const log = r.source === "ci" ? ciFailure(r.log()) : tail(r.log());
  const what = r.source === "ci" ? `The failure, from \`gh run view --log-failed\` of ${r.url}` : `The last ${LOG_LINES} lines of the log, at most ${LOG_CHARS} characters`;
  const request = `${mark(r.commit)}\nFailed: ${SOURCE_NAME[r.source]}\n${r.line}\n\n${what}:\n\n\`\`\`\n${log || "(no log)"}\n\`\`\`\n`;
  const w = store.writeList(repo, `firefighter: ${SOURCE_NAME[r.source]} red at ${r.commit.slice(0, 7)}`, (doc): Filed | null => {
    if (doc.items.some((i) => holds(i, r.commit))) return null;
    const open = doc.items.filter((i) => issues.status(i) === "open" && isRedMain(i) && sameFails(i.request, log)).at(-1);
    const at = { repo: r.repo, commit: r.commit, source: r.source };
    if (open) {
      issues.note(open, `firefighter: ${mark(r.commit)}; ${SOURCE_NAME[r.source]} failed again while this fix is open: ${r.line}${log ? `; log: ${oneLine(log)}` : ""}`);
      return { ...at, noted: open.id };
    }
    return { ...at, filed: issues.add(doc, titleOf(r), { kind: "bug", priority: "critical", labels: ["red-main"], source: "agent", request }).id };
  }, true);
  const f = w?.value ?? null;
  if (f && "filed" in f && r.source === "ci") record.update(`${r.repo}-${f.filed}`, (x) => { x.ci = { url: r.url!, commit: r.commit, failure: log }; });
  return f;
}

/**
 * The CI watch of a CI issue, from the CI state the tick saved: a green run at or after the land closes a landed issue
 * (`ci.landed` in its job record), and a red one sends it back, open with `since` at the land so the land's trailer no
 * longer counts it done, with the failure in a note and the record. An issue that never landed closes when a green run
 * sits past its failing commit (`ci.commit`), and a red one leaves it alone. A run that holds neither commit, or a
 * commit this clone does not have yet, waits. Returns the lines of what it did.
 */
export function settleCi(ports: Ports = defaultPorts): string[] {
  const reg = loadRegistry();
  const out: string[] = [];
  for (const { key } of factoryRepos()) {
    const c = ciOf(key), repo = reg[key];
    if (!c || !repo) continue;
    for (const i of store.reader().list(key)?.items ?? []) {
      const ref = `${key}-${issues.refOf(i)}`;
      const ci = issues.status(i) === "open" && isRedMain(i) ? record.read(ref)?.ci : undefined;
      if (!ci) continue;
      // A landed issue waits for a run at or after the land; one that never landed, for a run past its failing commit.
      const at = ci.landed ?? ci.commit;
      if (!git(repo.path, "merge-base", "--is-ancestor", at, c.sha).ok) continue;
      if (c.ok) {
        const why = store.close(repo, issues.refOf(i), `firefighter: GitHub CI on main is green at ${c.sha.slice(0, 7)} (${c.url}), ${ci.landed ? `at or after the land ${ci.landed.slice(0, 7)}` : `past the failing commit ${ci.commit.slice(0, 7)}`}: done`);
        out.push(why ? `${ref} not closed: ${why}` : `${ref} done: CI green at ${c.sha.slice(0, 7)}`);
        continue;
      }
      // A red run sends back only an issue that landed: an unlanded one has no land to be sent back from.
      if (!ci.landed) continue;
      const failure = ciFailure(ciLog(ports, repo, c.url));
      store.writeList(repo, `firefighter: ${ref} red on CI after its land`, (doc) => {
        const item = issues.find(doc, issues.refOf(i));
        if (!item) return null;
        store.reopen(doc, item, ci.landed!);
        return issues.note(item, `firefighter: GitHub CI on main is still red at ${c.sha.slice(0, 7)} (${c.url}), after the land ${ci.landed!.slice(0, 7)}: the goal runs again. The failure:\n\n\`\`\`\n${failure}\n\`\`\``);
      });
      record.update(ref, (x) => { x.ci = { url: c.url, commit: c.sha, failure }; });
      out.push(`${ref} sent back: CI red at ${c.sha.slice(0, 7)} after its land`);
    }
  }
  return out;
}

/**
 * Whether a `gh run view --log-failed` log shows a failure before any test ran: its lines name steps (`job<TAB>step<TAB>text`),
 * and none is the typecheck or the test step of ci.yml.
 */
const early = (log: string): boolean => {
  const steps = log.split("\n").filter((l) => l.split("\t").length >= 3).map((l) => l.split("\t")[1]);
  return steps.length > 0 && !steps.some((s) => /typecheck|test:all/.test(s));
};

const reran = () => join(factoryDir(), "reran.json");
const rerunIds = (): string[] => { try { return JSON.parse(readFileSync(reran(), "utf8")); } catch { return []; } };

/** Rerun the failed jobs of a red CI run that failed before any test, once per run. True when it did. */
function rerun(r: Red, ports: Ports): boolean {
  const id = /\/runs\/(\d+)/.exec(r.url ?? "")?.[1], repo = loadRegistry()[r.repo];
  if (r.source !== "ci" || !id || !repo || rerunIds().includes(id) || (store.reader().list(r.repo)?.items ?? []).some((i) => holds(i, r.commit)) || !early(r.log())) return false;
  if (!ports.gh(repo, ["run", "rerun", id, "--failed"]).ok) return false;
  mkdirSync(factoryDir(), { recursive: true });
  writeFileSync(reran(), JSON.stringify([...rerunIds(), id]));
  factoryLog(`firefighter: ${r.repo} CI run ${id} failed before any test: rerun`);
  logEvent({ by: "firefighter", subject: r.repo, action: "reran", on: [r.commit.slice(0, 7)], note: `reran CI run ${id} of ${r.repo}: it failed before any test` });
  return true;
}

export interface Fired { filed: Filed[]; asked: string[] }

/**
 * The tick's firefighter: file each red, then ask about each slow land. Under the pause alone. An error is a factory log
 * line, never thrown.
 */
export async function firefight(ports: Ports = defaultPorts, now = Date.now()): Promise<Fired | null> {
  if (gates({ only: ["pause"] })) return null;
  const filed: Filed[] = [];
  for (const r of (() => { try { return reds(ports); } catch (e: any) { factoryLog(`firefighter: failed: ${e?.message ?? e}`); return []; } })()) {
    try {
      if (rerun(r, ports)) continue;
      const f = fileRed(r);
      if (!f) continue;
      filed.push(f);
      logEvent("filed" in f
        ? { by: "firefighter", subject: `${f.repo}-${f.filed}`, action: "filed", note: `filed ${f.repo}-${f.filed} (critical) for ${r.line}` }
        : { by: "firefighter", subject: `${f.repo}-${f.noted}`, action: "red", on: [r.commit.slice(0, 7)], note: `noted ${f.repo}-${f.noted}: also red at ${r.commit.slice(0, 7)}: ${r.line}` });
    } catch (e: any) {
      factoryLog(`firefighter: ${r.repo} red at ${r.commit.slice(0, 7)} not filed: ${e?.message ?? e}`);
    }
  }
  try { for (const l of settleCi(ports)) factoryLog(`firefighter: ${l}`); } catch (e: any) { factoryLog(`firefighter: CI watch: failed: ${e?.message ?? e}`); }
  let asked: string[] = [];
  try { asked = await askSlowLands(now); } catch (e: any) { factoryLog(`firefighter: slow lands: failed: ${e?.message ?? e}`); }
  return { filed, asked };
}
