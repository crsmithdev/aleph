/**
 * The investigator: one read-only run, started by Chris from a page, that traces what happened to its subject (an issue
 * or a job), why, and what change would stop it from happening again. The run's `name` is the subject key. Its reply is
 * typed; code drops each cause and issue with no evidence and each issue whose title fails `titleProblem`, and writes
 * what is left to result.json in the run folder. The page shows it, and Chris files, notes or dismisses each issue.
 * Spec: docs/specs/2026-11-19-investigator.md.
 */
import { existsSync } from "node:fs";
import { readJsonOr, writeJson } from "../../../lib/json.ts";
import { eventsOf } from "../../../lib/layout.ts";
import { projectOfIssue, readList } from "../../../lib/store.ts";
import * as issues from "../../../lib/todo.ts";
import { lock } from "../../../lib/locks.ts";
import { errText } from "../../../lib/errtext.ts";
import { issueKey, parseKey } from "../../../lib/naming.ts";
import { loadRegistry, issueKeyOf, type Entry, type Repo } from "../records/ledger.ts";
import { landedCommits } from "../records/status.ts";
import { allRuns, getRun, runsOfRole } from "../records/record.ts";
import { jobFolder, runFile, type RunFile } from "../records/run-files.ts";
import { readModels } from "../routing/models.ts";
import { endLost, openRun } from "./agent-run.ts";

/** The time box of a run, in seconds. */
const SECONDS = 1800;
const FILES: RunFile[] = ["log.txt", "prompt.md", "transcript.jsonl", "result.md", "review.json"];
/** Read-only: Read, Grep, Glob, git's read commands and the aleph commands that only print. `aleph models` is exact: `aleph models set` writes. */
const ALLOWED = ["Read", "Grep", "Glob", ...["log", "show", "diff", "blame"].map((c) => `Bash(git ${c}:*)`),
  "Bash(aleph status:*)", "Bash(aleph issue show:*)", "Bash(aleph issue list:*)", "Bash(aleph models)"];

export const lockOf = (subject: string): string => `investigator-${subject}`;

/** What a run reads: the subject's repo, its runs, its title and the lines that point at the rest. */
interface Case { subject: string; repo: Repo; title: string; runs: Entry[]; pointers: string[] }

/** The issue `n` and its repo, or undefined when there is none. */
function itemOf(n: number): { repo: Repo; item: issues.Issue } | undefined {
  const repo = loadRegistry()[projectOfIssue(n) ?? ""], doc = repo && readList(repo), item = doc ? issues.find(doc, n) : undefined;
  return item && { repo, item };
}

/** The case of `subject` (`issue.<n>` or `job.<n>`), or null when there is no such issue or job. A later run of a job names the job: the first run of its chain. */
export function caseOf(subject: string): Case | null {
  const k = parseKey(subject);
  if (k?.kind === "issue") {
    const at = itemOf(k.n);
    if (!at) return null;
    const { repo, item } = at;
    const runs = allRuns().filter((e) => issueKeyOf(e.run) === subject);
    return { subject, repo, title: item.title, runs, pointers: [
      `Read the issue: \`aleph issue show ${subject}\`, and its stage: \`aleph status ${repo.key}-${k.n}\`.`,
      `The commits on ${repo.main} that land it: ${landedCommits(repo.path, repo.main, repo.key, k.n).join(", ") || "none"}. Read each with \`git show\`.`,
    ] };
  }
  const job = k?.kind === "job" ? getRun(subject) : undefined;
  const repo = job && loadRegistry()[job.repo ?? ""];
  if (!job || !repo) return null;
  const on = issueKeyOf(job);
  return { subject: job.job, repo, title: job.name, runs: allRuns().filter((e) => e.run.job === job.job), pointers: [
    ...(on ? [`The job is on ${on}, for context: \`aleph issue show ${on}\`.`] : []),
    ...(job.branch ? [`Its branch and its diff: \`git log ${repo.main}..${job.branch}\`, \`git diff ${repo.main}...${job.branch}\`.`] : []),
  ] };
}

const eventLine = (e: { time: string; subject: string; action: string; object: string; detail?: string | null }) =>
  `${e.time} ${e.subject} ${e.action} ${e.object}${e.detail ? ` ${e.detail}` : ""}`;

function runLine(e: Entry): string {
  const folder = jobFolder(e.id), r = e.run;
  const files = FILES.filter((f) => existsSync(runFile(folder, f)));
  return `- ${e.id} ${r.role} ${r.state}${r.cause ? ` (${r.cause})` : ""}, ${r.started}${r.reason ? `: ${r.reason}` : ""}\n  ${folder}: ${files.join(", ") || "no files"}`;
}

export function prompt(c: Case): string {
  const times = c.runs.flatMap((e) => [e.run.started, e.run.ended ?? new Date().toISOString()]).sort();
  const settings = times.length ? eventsOf("settings").filter((e) => e.time >= times[0] && e.time <= times.at(-1)!) : [];
  const events = [c.subject, ...c.runs.map((e) => e.id)].flatMap((o) => eventsOf(o)).sort((a, b) => a.time.localeCompare(b.time));
  return [
    `You investigate ${c.subject}: ${c.title}. Your working directory is the checkout of ${c.repo.key}, on ${c.repo.main}.`,
    "Find what happened, why, and what change to aleph or to this repo would stop it from happening again. You only read: you change nothing.",
    "Cite evidence for each claim: a `path:line`, a run id with a file, an event time, or a commit. A claim with no evidence is dropped.",
    "The case below points at the records; read what you need. When you skip a record, say so in the summary.",
    "Recommend an issue only for a change the evidence supports. Its title is one imperative of at most 60 characters that says what changes, with no final period and no \"<words>: \" prefix. When an open issue already covers the change, give its key (issue.<n>) as `existing`.",
    "",
    `## Pointers\n${c.pointers.join("\n")}`,
    `## Runs, oldest first\n${c.runs.map(runLine).join("\n") || "None"}`,
    `## Events\n${events.map(eventLine).join("\n") || "None"}`,
    `## Settings changes while the runs ran\n${settings.map(eventLine).join("\n") || "None"}`,
  ].join("\n");
}

// The reply.

export interface Finding { title: string; kind: "task" | "bug"; spec: string; evidence: string[]; impact: number; risk: number; effort: number; existing: string | null; fate?: string }
export interface Result {
  summary: string;
  timeline: { at: string; what: string; evidence: string }[];
  causes: { claim: string; evidence: string[]; confidence: "measured" | "reported" | "inferred" }[];
  issues: Finding[];
}

const text = { type: "string", minLength: 1 };
const refs = { type: "array", items: text };
const score = { type: "integer", minimum: 1, maximum: 5 };
const obj = (properties: Record<string, object>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const SCHEMA = obj({
  summary: text,
  timeline: { type: "array", items: obj({ at: text, what: text, evidence: text }) },
  causes: { type: "array", items: obj({ claim: text, evidence: refs, confidence: { enum: ["measured", "reported", "inferred"] } }) },
  issues: { type: "array", items: obj({ title: text, kind: { enum: ["task", "bug"] }, spec: text, evidence: refs, impact: score, risk: score, effort: score, existing: { type: ["string", "null"] } }) },
});

/** An `existing` key that names an open or parked issue, else null. */
function openKey(ref: string | null): string | null {
  const k = parseKey(ref), at = k?.kind === "issue" ? itemOf(k.n) : undefined;
  return at && ["open", "parked"].includes(issues.status(at.item)) ? issueKey(k!.n) : null;
}

/** The reply with each cause and issue that has no evidence, and each issue whose title fails `titleProblem`, left out. */
export const clean = (r: Result): Result => ({
  ...r,
  causes: r.causes.filter((c) => c.evidence.length),
  issues: r.issues.filter((i) => i.evidence.length && !issues.titleProblem(i.title)).map((i) => ({ ...i, existing: openKey(i.existing) })),
});

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** `aleph investigate <subject>`: one run on the subject, its reply in result.json. Null when a run on it is live. */
export async function investigate(subject: string): Promise<{ run: string; reason: string } | null> {
  await endLost("investigator", (run) => lockOf(run.name), "its reply");
  const c = caseOf(subject);
  if (!c) throw new Error(`no issue or job ${subject}`);
  subject = c.subject;
  const release = await lock(lockOf(subject), 0);
  if (!release) return null;
  try {
    const run = openRun({
      role: "investigator", who: "the investigator", model: readModels().investigator.model, seconds: SECONDS, cwd: c.repo.path, repo: c.repo.key, schema: SCHEMA,
      flags: ["--tools", "Read,Grep,Glob,Bash", "--allowedTools", ALLOWED.join(",")],
      name: subject, command: `investigate ${subject}`, shown: true, told: false,
    });
    let reply: Result;
    try { reply = clean(await run.askData(prompt(c)) as Result); } catch (e) {
      const reason = `failed: ${errText(e)}`;
      run.end(reason, { cause: "unanswered" });
      return { run: run.id, reason };
    }
    writeJson(runFile(run.folder, "result.json"), reply);
    const reason = `investigated ${subject}: ${count(reply.causes.length, "cause")}, ${count(reply.issues.length, "issue")}`;
    run.end(reason);
    return { run: run.id, reason };
  } finally {
    release();
  }
}

// What the page reads and writes.

export interface Investigation { id: string; state: string; started: string; ended?: string; model?: string; cost?: number; reason?: string; result?: Result }

const resultOf = (id: string): Result | undefined => readJsonOr<Result | undefined>(runFile(jobFolder(id), "result.json"), undefined);

/** The runs on `subject`, newest first. */
export const investigations = (subject: string): Investigation[] =>
  runsOfRole("investigator").filter((e) => e.run.name === subject).sort((a, b) => b.run.made - a.run.made)
    .map(({ id, run: r }) => ({ id, state: r.state, started: r.started, ended: r.ended, model: r.model, cost: r.cost, reason: r.reason, result: resultOf(id) }));

/** The recommended issue `i` of run `id`, with the run's subject and repo; undefined when there is none. */
export function findingOf(id: string, i: number): { subject: string; repo: string; finding: Finding } | undefined {
  const run = getRun(id), finding = run?.role === "investigator" ? resultOf(id)?.issues[i] : undefined;
  return finding && { subject: run!.name, repo: run!.repo!, finding };
}

/** Record what Chris did with issue `i` of run `id`: `filed <key>`, `noted <key>` or `dismissed`. */
export function setFate(id: string, i: number, fate: string): void {
  const r = resultOf(id)!;
  r.issues[i].fate = fate;
  writeJson(runFile(jobFolder(id), "result.json"), r);
}
