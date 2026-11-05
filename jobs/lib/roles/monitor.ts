/**
 * The monitor: once a day it measures the factory (monitor-table.ts), has one read-only agent name what looks off,
 * ranked, with the numbers, and keeps the report in <factory>/monitor/<day>.json. It surfaces and
 * never fixes: the reader has no tools, and nothing here files, answers or changes an item. It runs while the
 * factory is paused, since it only reads.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { endLost, openRun } from "./agent-run.ts";
import { lock } from "../records/ledger.ts";
import { factoryLog } from "../infra/layout.ts";
import { addDays, measure, monitorDir, readSources, renderTable, reportFile, type Report, type Table } from "../learning/monitor-table.ts";
import { monitorOn } from "../infra/settings.ts";
import * as issues from "../../../issues/lib/todo.ts";

/** The reader's time box, in seconds. */
const SECONDS = 600;
/** The model of the monitor reader: a run on OpenRouter, priced from its tokens. */
const MONITOR_MODEL = "deepseek-v4.1-flash";

/** The day a report is due for: yesterday, when it has no report yet; else null. */
export function monitorDue(now = new Date()): string | null {
  const day = addDays(issues.today(now), -1);
  return existsSync(reportFile(day)) ? null : day;
}

/** The reader's prompt: the day, the table and what to reply. */
export function readerPrompt(day: string, table: string): string {
  return [
    `You read the factory monitor's table of ${day} below. Name what looks off, ranked, most serious first.`,
    "Each finding gives its numbers from the table: the day's value and the trailing value it differs from.",
    "Look for a stage whose runs per item, runs with no usable result or cost per item rose against the trailing 7 days,",
    "an Ask reason or a hold kind that grew, and a rise in reopens. A small count is noise: say so rather than rank it high.",
    "Each finding names at most 3 metrics, the most useful ones.",
    "Mark each significant find in a finding as **text**, the few words that say what is off.",
    "You only read. Do not suggest that you file, answer or change anything.",
    `Name the day by its date, ${day}. Do not write "today" or "yesterday": the findings are read a day or more later.`,
    "",
    "Reply with at most 7 lines, each `<rank>. <finding>` in one sentence. When nothing looks off, reply one line `NOTHING: <why>`.",
    "",
    table,
  ].join("\n");
}

/** The numbered lines of a reply, in order, without their numbers. */
export const findingsOf = (text: string): string[] =>
  text.split("\n").flatMap((l) => { const m = /^\s*\d+[.)]\s+(.+)$/.exec(l); return m ? [m[1].trim()] : []; });

/** The table of `day`, read from disk now. */
export function tableOf(day: string, now = Date.now()): Table {
  return measure(readSources(), day, now);
}

/** Read the table with the agent, and keep the report and its note. The caller holds the monitor lock. */
async function read(day: string, table: Table): Promise<Report> {
  const r: Report = { day, table, findings: [] };
  const run = openRun({ role: "monitor", who: "the monitor reader", model: MONITOR_MODEL, seconds: SECONDS, flags: ["--tools", ""], name: `monitor-${day}`, command: `monitor ${day}`, shown: false });
  r.run = run.folder;
  try {
    r.text = (await run.ask(readerPrompt(day, renderTable(table)))).trim();
    r.findings = findingsOf(r.text);
    run.end(r.findings.length ? `${r.findings.length} findings` : "nothing looks off");
  } catch (e: any) {
    r.error = String(e?.message ?? e);
    run.end(`failed: ${r.error}`, { cause: "unanswered" });
  }
  mkdirSync(monitorDir(), { recursive: true });
  writeFileSync(reportFile(day), JSON.stringify(r, null, 2) + "\n");
  return r;
}

/** `aleph monitor`: the report of `day`, read now. Null when another monitor holds the lock. */
export async function runMonitor(day: string): Promise<Report | null> {
  await endLost("monitor", () => "monitor", "a reading");
  const release = await lock("monitor", 0);
  if (!release) return null;
  try {
    return await read(day, tableOf(day));
  } finally {
    release();
  }
}

/** The tick's daily step: yesterday's report, once. It ignores the pause. An error is logged, never thrown. */
export async function monitorStep(now = new Date()): Promise<Report | null> {
  if (!monitorOn()) return null;
  const day = monitorDue(now);
  if (!day) return null;
  try {
    const r = await runMonitor(day);
    if (r) factoryLog(`monitor ${day}: ${r.error ? `no reading: ${r.error}` : `${r.findings.length} findings`}`);
    return r;
  } catch (e: any) {
    factoryLog(`monitor ${day}: failed: ${e?.message ?? e}`);
    return null;
  }
}
