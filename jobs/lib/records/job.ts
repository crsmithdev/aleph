/**
 * A job over the ledger: its runs, oldest first, as `allJobs` groups them.
 * Lookups by name, its issue, its state, the files in
 * its run folders, and `view`, the one projection that `/api/factory`,
 * `/api/jobs` and `aleph jobs` show. See docs/data-model.md.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { needsOf } from "../asks/ask.ts";
import { allJobs, isOpen, onOf, type CheckResult, type Entry, type Run, type State } from "./ledger.ts";
import { isLost } from "../infra/process.ts";
import { runFile, type RunFile } from "./run-files.ts";
import * as record from "./record.ts";

export { allJobs, isOpen };

/** A job: its runs, oldest first. */
export type Job = Entry[];


const nameIs = (name: string, repo?: string | null) => (j: Job) => j.at(-1)!.run.name === name && (!repo || j.at(-1)!.run.repo === repo);

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

/** The job's state: that of the run that counts. */
export const stateOf = (j: Job): State => record.counting(j).run.condition;

/** A file in a run's folder, or undefined when it is not there. */
export function readFile(e: Entry, file: RunFile): string | undefined {
  try { return readFileSync(runFile(e.folder, file), "utf8"); } catch { return undefined; }
}

export const hasFile = (e: Entry, file: RunFile): boolean => existsSync(runFile(e.folder, file));

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
export const issueTitle = (j: Job): string => (readFile(j[0], "spec.md") ?? readFile(j[0], "command.txt") ?? "").trim().split("\n")[0];

/** A job as the UI and `aleph jobs` show it. Run fields are the last run's; the rest is the latest run that has them. */
export interface JobView {
  job: string; name: string; repo?: string;
  /** The last run: its folder, kind and start. `started` is the job's first. */
  run: { id: string; kind: Run["kind"]; started: string };
  condition: State; needs?: ReturnType<typeof needsOf>; phase?: string; reason?: string; question?: string; say?: string; session?: string;
  started: string; ended?: string;
  item?: number | string; cost?: number; model?: string; tier?: string; commit?: string; stat?: string;
  defaults: string[]; followups: string[];
  checks?: CheckResult[];
  /** The review of the last run: its call and reason. */
  review?: { call: string; reason?: string };
  /** A landed job's manual check. */
  check?: "open" | "done";
  /** The last run died without an end. */
  lost?: true;
}

/** What checked a job, in the order it ran: its checks, then the reviewers that left a file. Deterministic checks and model judges are named apart. */
export function checkedBy(j: Job): string[] {
  const checks = j.findLast((e) => e.run.checks?.length)?.run.checks ?? [];
  const names = checks.filter((c) => c.ok).map((c) => c.name);
  const has = (f: string) => j.some((e) => existsSync(join(e.folder, f)));
  return [...names, ...(has("review.md") ? ["reviewer"] : [])];
}

/** Minutes a spot check of a delivery should take, an estimate: two, and one per 200 changed lines. */
export function lookMinutes(changedLines: number): number {
  return 2 + Math.ceil(changedLines / 200);
}

export function view(j: Job): JobView {
  const last = record.counting(j);
  const r = last.run;
  const latest = <K extends keyof Run>(k: K): Run[K] | undefined => r[k] ?? j.findLast((e) => e.run[k])?.run[k];
  const v: JobView = {
    job: r.job, name: r.name, run: { id: last.id, kind: r.kind, started: r.started }, condition: r.condition, started: j[0].run.started,
    defaults: j.findLast((e) => e.run.defaults !== undefined)?.run.defaults ?? [],
    followups: j.findLast((e) => e.run.followups !== undefined)?.run.followups ?? [],
  };
  if (r.repo) v.repo = r.repo;
  for (const k of ["phase", "reason", "question", "say", "session", "ended"] as const) if (r[k]) (v as any)[k] = r[k];
  const needs = needsOf(r.ask);
  if (needs) v.needs = needs;
  if (r.ask?.reason === "question" && !v.question) v.question = r.ask.question;
  const item = issue(j);
  if (item !== undefined) v.item = item;
  if (j.some((e) => e.run.cost !== undefined)) v.cost = j.reduce((a, e) => a + (e.run.cost ?? 0), 0);
  for (const k of ["model", "tier", "commit", "stat"] as const) {
    const val = latest(k);
    if (val) v[k] = val;
  }
  // The latest checks that ran; a returned or failed job shows its last run's, even none.
  const checks = r.condition === "returned" || r.condition === "failed" ? j.findLast((e) => e.run.checks)?.run.checks : j.findLast((e) => e.run.checks?.length)?.run.checks;
  if (Array.isArray(checks)) v.checks = checks;
  const review = last.run.review;
  if (review) v.review = { call: review.call, ...(review.reason !== undefined && { reason: review.reason }) };
  if (r.condition === "landed" && r.check) v.check = r.check;
  if (isLost(last.folder)) v.lost = true;
  return v;
}
