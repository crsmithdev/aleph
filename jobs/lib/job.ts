/**
 * A job over the ledger: its runs, oldest first, as `allJobs` groups them.
 * Lookups by name, its issue, the run that counts, its state, the files in
 * its run folders, and `view`, the one projection that `/api/state`,
 * `/api/jobs` and `aleph jobs` show. See docs/specs/2026-09-24-agent-jobs.md.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { tagged } from "./gate.ts";
import { allJobs, askOf, isBuild, isLost, isOpen, LOCK_BUSY, needsOf, onOf, reviewOf, type CheckResult, type Entry, type Run, type State } from "./ledger.ts";

export { allJobs, isOpen };

/** A job: its runs, oldest first. */
export type Job = Entry[];

/** The files a run folder may hold that a reader of the job asks for. */
export type RunFile = "spec.md" | "command.txt" | "result.md" | "review.md" | "call.md" | "checks.log" | "land.log" | "stderr.log" | "asked" | "rescued" | "batch.json";

/** A facts run belongs to the landed job but is not its state: names and states look past it. */
const notFacts = (j: Job): Entry => j.findLast((e) => e.run.kind !== "facts") ?? j.at(-1)!;

const nameIs = (name: string, repo?: string | null) => (j: Job) => notFacts(j).run.name === name && (!repo || notFacts(j).run.repo === repo);

/** The open job called `name` (in `repo`, when given). A name has one open job at most. */
export const openJob = (name: string, repo?: string | null, jobs = allJobs()): Job | undefined => jobs.findLast((j) => isOpen(j) && nameIs(name, repo)(j));

/** The newest job called `name` (in `repo`, when given), open or not. */
export const latestJob = (name: string, repo?: string | null, jobs = allJobs()): Job | undefined => jobs.findLast(nameIs(name, repo));

/** Every job called `name` (in `repo`, when given), oldest first. */
export const jobsNamed = (name: string, repo?: string | null, jobs = allJobs()): Job[] => jobs.filter(nameIs(name, repo));

/** The open job called `name`, else the newest. */
export const findJob = (name: string, repo?: string | null, jobs = allJobs()): Job | undefined => openJob(name, repo, jobs) ?? latestJob(name, repo, jobs);

/** The job whose id (its first run's folder) is `id`. */
export const jobById = (id: string, jobs = allJobs()): Job | undefined => jobs.find((j) => j[0].id === id);

/** The repo issue the job works on: the latest run that names one. */
export const issue = (j: Job): number | string | undefined => j.map((e) => onOf(e.run)).findLast((n) => n !== undefined);

/** The job's last run that did something to it: a land that found the job lock busy did nothing, so the run before it counts; a facts run is not the job's state. */
export const lastReal = (j: Job): Entry => j.findLast((e) => e.run.kind !== "facts" && !(e.run.kind === "land" && e.run.state === "failed" && e.run.reason === LOCK_BUSY)) ?? j.at(-1)!;

/** The job's state: that of the run that counts. */
export const stateOf = (j: Job): State => lastReal(j).run.state;

/** A file in a run's folder, or undefined when it is not there. */
export function readFile(e: Entry, file: RunFile): string | undefined {
  try { return readFileSync(join(e.folder, file), "utf8"); } catch { return undefined; }
}

export const hasFile = (e: Entry, file: RunFile): boolean => existsSync(join(e.folder, file));

/** The job's latest run with `file` in its folder, of those `only` keeps, and the file's text. */
export function latestFile(j: Job, file: RunFile, only: (e: Entry) => boolean = () => true): { entry: Entry; text: string } | undefined {
  for (let i = j.length - 1; i >= 0; i--) {
    if (!only(j[i])) continue;
    const text = readFile(j[i], file);
    if (text !== undefined) return { entry: j[i], text };
  }
  return undefined;
}

/** The last `n` lines of a file in a run's folder; empty when it is not there. */
export const tailOf = (e: Entry, file: RunFile, n: number): string => (readFile(e, file) ?? "").trimEnd().split("\n").slice(-n).join("\n");

/** The factory set an Ask on the run's issue, with this question: the run no longer holds the factory. */
export const asked = (e: Entry): boolean => hasFile(e, "asked");
export const markAsked = (e: Entry, question: string): void => writeFileSync(join(e.folder, "asked"), question + "\n");

/** The case of the safe default action taken on the run, or "" when none was. */
export const rescued = (e: Entry): string => tailOf(e, "rescued", 1);
export const markRescued = (e: Entry, key: string): void => writeFileSync(join(e.folder, "rescued"), key + "\n");

/** The verdict an earlier land wrote for a land run it took into its batch. */
export interface Batch { verdict: string; code: number; checks?: CheckResult[] }
export function batch(e: Entry): Batch | undefined {
  const text = readFile(e, "batch.json");
  return text === undefined ? undefined : JSON.parse(text);
}

/** The notes of a job, in order: each follow-up's spec, kept in its first run's `notes/`. */
export function notes(j: Job): { name: string; text: string }[] {
  const dir = join(j[0].folder, "notes");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).sort().map((n) => ({ name: basename(n, ".md"), text: readFileSync(join(dir, n), "utf8") }));
}

export function addNote(j: Job, text: string): void {
  const dir = join(j[0].folder, "notes");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${String(readdirSync(dir).length + 1).padStart(3, "0")}.md`), text);
}

/** The first line of the job's spec, or of a plain run's command. */
export const goal = (j: Job): string => (readFile(j[0], "spec.md") ?? readFile(j[0], "command.txt") ?? "").trim().split("\n")[0];

/** A job as the UI and `aleph jobs` show it. Run fields are the last run's; the rest is the latest run that has them. */
export interface JobView {
  job: string; name: string; repo?: string;
  /** The last run: its folder, kind and start. `started` is the job's first. */
  run: { id: string; kind: Run["kind"]; started: string };
  state: State; needs?: ReturnType<typeof needsOf>; phase?: string; reason?: string; question?: string; say?: string; session?: string;
  started: string; ended?: string;
  item?: number | string; cost?: number; model?: string; commit?: string; stat?: string;
  defaults: string[]; followups: string[];
  checks?: CheckResult[];
  /** The hidden check's test counts, when the job's item has hidden checks. */
  hidden?: { passed: number; total: number };
  /** The review of the last run: its call and reason. */
  review?: { call: string; reason?: string };
  /** A landed job's manual check. */
  check?: "open" | "done";
  /** The last run died without an end. */
  lost?: true;
}

export function view(j: Job): JobView {
  const last = lastReal(j);
  const r = last.run;
  const latest = <K extends keyof Run>(k: K): Run[K] | undefined => r[k] ?? j.findLast((e) => e.run[k])?.run[k];
  const v: JobView = {
    job: r.job, name: r.name, run: { id: last.id, kind: r.kind, started: r.started }, state: r.state, started: j[0].run.started,
    defaults: j.findLast((e) => e.run.defaults !== undefined)?.run.defaults ?? [],
    followups: tagged(latestFile(j, "result.md", (e) => isBuild(e.run.kind))?.text ?? "", "FOLLOWUP"),
  };
  if (r.repo) v.repo = r.repo;
  for (const k of ["phase", "reason", "question", "say", "session", "ended"] as const) if (r[k]) (v as any)[k] = r[k];
  const needs = needsOf(askOf(r));
  if (needs) v.needs = needs;
  if (r.ask?.reason === "question" && !v.question) v.question = r.ask.question;
  const item = issue(j);
  if (item !== undefined) v.item = item;
  if (j.some((e) => e.run.cost !== undefined)) v.cost = j.reduce((a, e) => a + (e.run.cost ?? 0), 0);
  for (const k of ["model", "commit", "stat"] as const) {
    const val = latest(k);
    if (val) v[k] = val;
  }
  // The latest checks that ran; a stuck or failed job shows its last run's, even none.
  const checks = r.state === "stuck" || r.state === "failed" ? j.findLast((e) => e.run.checks)?.run.checks : j.findLast((e) => e.run.checks?.length)?.run.checks;
  if (Array.isArray(checks)) v.checks = checks;
  const hid = j.findLast((e) => e.run.checks?.some((c) => c.name === "hidden" && c.total))?.run.checks?.find((c) => c.name === "hidden");
  if (hid?.total) v.hidden = { passed: hid.passed ?? 0, total: hid.total };
  const review = reviewOf(last);
  if (review) v.review = { call: review.call, ...(review.reason !== undefined && { reason: review.reason }) };
  if (r.state === "landed" && r.check) v.check = r.check;
  if (isLost(last.folder)) v.lost = true;
  return v;
}
