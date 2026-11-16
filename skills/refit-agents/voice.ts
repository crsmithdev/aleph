#!/usr/bin/env bun
/**
 * How often factory agent output breaks identity/VOICE.md: the checks of the interactive VOICE.md scan, run over the
 * final text of each headless run and over the subjects of the commits that workers make. A rate is the share of
 * texts (or subjects) that break a check, per role and period.
 *
 *   bun voice.ts   a markdown table, one row for each role and period
 *
 * The final text is the `result` event of the run's transcript: its string values when the reply is structured.
 */
import { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { dbFile } from "../../lib/db.ts";
import { git } from "../../lib/git.ts";
import { loadRegistry } from "../../jobs/lib/records/ledger.ts";
import { layout } from "../../lib/layout.ts";

export type Run = { role: string; started: string; text?: string; subjects?: string[] };

const ROLES = ["intake", "worker", "review", "director", "housekeeper"];
const BASE = "2026-11-04";
const SPLIT = "2026-11-11T10:44Z";
export const period = (started: string): "base" | "after" | undefined =>
  started < BASE ? undefined : Date.parse(started) < Date.parse(SPLIT) ? "base" : "after";

/** Prose lines: fenced blocks dropped, code spans cut to one word, so a path or a command is not a sentence. */
const prose = (text: string): string[] => text.replace(/^\s*(```|~~~)[\s\S]*?^\s*\1/gm, "").replace(/`[^`]*`/g, "code").split("\n");
const LABEL = /^\s*([-*]|\d+\.)\s+\*\*[^*]+\*\*/;

const TEXT: Record<string, (t: string) => boolean> = {
  semicolon: (t) => prose(t).some((l) => l.includes(";")),
  perfect: (t) => /\b(have|has|had)\s+(not\s+|also\s+|already\s+)?(been|\w+ed|done|made|run|found|built|seen|gone|got|left|kept|set|put|read|shown|written|known|taken|given|become|come|begun|thought|brought|caught|held|lost|met|paid|said|sent|told)\b/i.test(prose(t).join("\n")),
  banned: (t) => /\b(simply|just|easy|please)\b/i.test(prose(t).join("\n")),
  opener: (t) => /(^|[.!?]\s+|\n)[\s>*-]*(let me|i['’]ll)\b/i.test(prose(t).join("\n")),
  arrow: (t) => prose(t).some((l) => /(→|->)/.test(l)),
  bold: (t) => prose(t).some((l) => /\*\*[^*]+\*\*/.test(l.replace(LABEL, ""))),
  long: (t) => prose(t).filter((l) => !l.startsWith("|")).some((l) => l.split(/[.!?]\s+/).some((s) => s.trim().split(/\s+/).length > 25)),
  notVerified: (t) => /^[\s>*-]*Not verified\b/im.test(t),
  leftOut: (t) => /^[\s>*-]*Left out:/im.test(t),
};

/** The names of the checks that `text` breaks. */
export const broken = (text: string): string[] => Object.keys(TEXT).filter((k) => TEXT[k](text));

/** Whether a commit subject is over 50 characters. */
export const longSubject = (s: string): boolean => s.length > 50;

const pct = (n: number, of: number) => (of ? `${((100 * n) / of).toFixed(1)}% (${n}/${of})` : "-");

/** The table: a row for each role and period, with the count of texts and commits and the rate of each check. */
export function table(runs: Run[]): string {
  const names = Object.keys(TEXT);
  const head = ["role", "period", "replies", ...names, "commits", "subject > 50"];
  const rows = [head, head.map(() => "---")];
  for (const role of ROLES) for (const p of ["base", "after"]) {
    const mine = runs.filter((r) => r.role === role && period(r.started) === p);
    const texts = mine.flatMap((r) => (r.text === undefined ? [] : [broken(r.text)]));
    const subjects = mine.flatMap((r) => r.subjects ?? []);
    rows.push([role, p, String(texts.length), ...names.map((k) => pct(texts.filter((b) => b.includes(k)).length, texts.length)), String(subjects.length), pct(subjects.filter(longSubject).length, subjects.length)]);
  }
  return rows.map((r) => `| ${r.join(" | ")} |`).join("\n");
}

/** The final text of a transcript: the string values of a structured reply, else the plain result. Undefined when the run has no result. */
function finalText(file: string): string | undefined {
  if (!existsSync(file)) return undefined;
  const last = readFileSync(file, "utf8").trimEnd().split("\n").at(-1) ?? "";
  let ev: { type?: string; result?: unknown; structured_output?: unknown };
  try { ev = JSON.parse(last); } catch { return undefined; }
  if (ev.type !== "result") return undefined;
  const strings = (v: unknown): string[] => (typeof v === "string" ? [v] : v && typeof v === "object" ? Object.values(v).flatMap(strings) : []);
  return ev.structured_output ? strings(ev.structured_output).join("\n\n") : typeof ev.result === "string" ? ev.result : undefined;
}

/** The subjects of the commits a build made: the range the checks ran on when the job recorded it, else the landed tip alone. */
function subjects(cwd: string, extra: string | null, tip: string | null, seen: Set<string>): string[] {
  const { checkedBase, checkedTip } = JSON.parse(extra ?? "{}");
  const range = checkedBase && checkedTip ? [`${checkedBase}..${checkedTip}`] : tip ? ["-1", tip] : undefined;
  if (!range) return [];
  const out = git(cwd, "log", "--format=%H %s", ...range);
  if (!out.ok) return [];
  return out.out.split("\n").filter(Boolean).flatMap((l) => {
    const sha = l.slice(0, l.indexOf(" "));
    if (seen.has(sha)) return [];
    seen.add(sha);
    return [l.slice(sha.length + 1)];
  });
}

/** The runs of the live store from the base period on, each with its final text and, for a build, its commit subjects. */
function live(): Run[] {
  const db = new Database(dbFile(), { readonly: true });
  const jobs = db.query(`SELECT id, role, project, started, extra, commit_sha FROM jobs WHERE started >= ? AND role IN ('intake', 'build', 'review', 'director', 'housekeeper') ORDER BY made`).all(BASE) as
    { id: string; role: string; project: string | null; started: string; extra: string | null; commit_sha: string | null }[];
  const seen = new Set<string>();
  const registry = loadRegistry();
  return jobs.map((j) => ({
    role: j.role === "build" ? "worker" : j.role,
    started: j.started,
    text: finalText(join(layout().jobs, j.id.slice(4), "transcript.jsonl")),
    subjects: j.role === "build" ? subjects(registry[j.project ?? ""]?.path ?? import.meta.dir, j.extra, j.commit_sha, seen) : undefined,
  }));
}

if (import.meta.main) console.log(table(live()));
