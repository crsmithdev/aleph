/**
 * The monitor: once a day it measures the factory (monitor-table.ts), has one read-only agent name what looks off,
 * ranked, with the numbers, and keeps the report in <factory>/monitor/<day>.json and as a vault note. It surfaces and
 * never fixes: the reader has no tools, and nothing here files, answers or changes an item. It runs while the
 * factory is paused, since it only reads.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OPUS_MODEL } from "./agent-call.ts";
import { endLost, openRun } from "./agent-run.ts";
import { lock } from "./ledger.ts";
import { factoryLog } from "./layout.ts";
import { acceptanceLine, addDays, measure, monitorDir, readSources, renderTable, reportFile, type Report, type Table } from "./monitor-table.ts";
import { monitorOn } from "./settings.ts";
import { vaultDir } from "../../vault/lib/vault.ts";
import * as issues from "../../todo/lib/todo.ts";

const VAULT_CLI = join(import.meta.dir, "..", "..", "vault", "cli.ts");

/** The reader's time box, in seconds. */
const SECONDS = 600;

/** The day a report is due for: yesterday, when it has no report yet; else null. */
export function monitorDue(now = new Date()): string | null {
  const day = addDays(issues.today(now), -1);
  return existsSync(reportFile(day)) ? null : day;
}

/** The reader's prompt: the table and what to reply. */
export function readerPrompt(table: string): string {
  return [
    "You read the factory monitor's table of one day below. Name what looks off, ranked, most serious first.",
    "Each finding gives its numbers from the table: the day's value and the trailing value it differs from.",
    "Look first at the share of acceptance failures that led to a real fix: it decides whether acceptance earns its failure path.",
    "Then look for a stage whose runs per item, runs with no usable result or cost per item rose against the trailing 7 days,",
    "an Ask reason or a hold kind that grew, and a rise in reopens or set-asides. A small count is noise: say so rather than rank it high.",
    "You only read. Do not suggest that you file, answer or change anything.",
    "",
    "Reply with at most 7 lines, each `<rank>. <finding>` in one sentence. When nothing looks off, reply one line `NOTHING: <why>`.",
    "",
    table,
  ].join("\n");
}

/** The numbered lines of a reply, in order, without their numbers. */
export const findingsOf = (text: string): string[] =>
  text.split("\n").flatMap((l) => { const m = /^\s*\d+[.)]\s+(.+)$/.exec(l); return m ? [m[1].trim()] : []; });

/** The vault note's title for a day. */
export const noteTitle = (day: string) => `Factory Monitor ${day}`;

/**
 * The vault note of a report: a gotcha, the vault's kind for how the factory actually behaves, not indexed on Home.
 * It links the note of the day before when that note exists, so the days form a chain.
 */
export function notePage(r: Report, today: string, before: boolean): string {
  const n = r.findings.length;
  const claim = r.error ? `the reader gave no reading (${r.error}), so only the table is here`
    : n ? `the reader named ${n} ${n > 1 ? "things that look" : "thing that looks"} off; the first: ${r.findings[0]}`
    : "the reader named nothing that looks off";
  return [
    "---", "kind: gotcha", "scope: aleph", "confidence: measured", `updated: ${today}`, "supersedes: []",
    `sources: [${[r.run ? `run:${r.run.split("/").at(-1)}` : "", `~/.aleph/factory/monitor/${r.day}.json`].filter(Boolean).join(", ")}]`,
    "written_by: factory", "tags: [monitor]", "---", "",
    `**Claim.** On ${r.day} ${claim.replace(/\.$/, "")}, as of ${r.day}.`, "",
    "## Details", "", ...(n ? r.findings.map((f, i) => `${i + 1}. ${f}`) : [r.text ?? "No reading."]), "",
    renderTable(r.table).replace(/^# .*\n\n/, "").replace(/^## /gm, "### "),
    "## Evidence", "", `- The table is computed in code by jobs/lib/monitor-table.ts from the ledger, the holds and spec-check files, the flake list, the work store and usage.jsonl.`,
    ...(r.run ? [`- The reader's run: ${r.run}`] : []), "",
    "## Related", "", before ? `- [[${noteTitle(addDays(r.day, -1))}]]` : "- The first monitor note.", "",
  ].join("\n");
}

/** Write the report's note through the vault CLI. Returns the title, or why it was not written. */
function writeNote(r: Report): { title: string } | { error: string } {
  const dir = mkdtempSync(join(tmpdir(), "aleph-monitor-"));
  try {
    const title = noteTitle(r.day);
    const before = existsSync(join(vaultDir(), "wiki", "gotchas", `${noteTitle(addDays(r.day, -1))}.md`));
    const draft = join(dir, `${title}.md`);
    writeFileSync(draft, notePage(r, issues.today(), before));
    const env: Record<string, string | undefined> = { ...process.env };
    delete env.CLAUDE_CODE_SESSION_ID;
    const p = Bun.spawnSync(["bun", VAULT_CLI, "write", draft, "--why", `monitor report of ${r.day}`], { env, stdout: "pipe", stderr: "pipe" });
    if (p.exitCode !== 0) return { error: (p.stderr.toString().trim() || `vault write exited ${p.exitCode}`).split("\n")[0] };
    return { title };
  } catch (e: any) {
    return { error: String(e?.message ?? e) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The table of `day`, read from disk now. */
export function tableOf(day: string, now = Date.now()): Table {
  return measure(readSources(), day, now);
}

/** Read the table with the agent, and keep the report and its note. The caller holds the monitor lock. */
async function read(day: string, table: Table): Promise<Report> {
  const r: Report = { day, table, findings: [] };
  const run = openRun({ role: "monitor", who: "the monitor reader", model: OPUS_MODEL, seconds: SECONDS, flags: ["--tools", ""], name: `monitor-${day}`, command: `monitor ${day}`, shown: false });
  r.run = run.folder;
  try {
    r.text = (await run.ask(readerPrompt(renderTable(table)))).trim();
    r.findings = findingsOf(r.text);
    run.end(r.findings.length ? `${r.findings.length} findings` : "nothing looks off");
  } catch (e: any) {
    r.error = String(e?.message ?? e);
    run.end(`failed: ${r.error}`, { cause: "no-answer" });
  }
  mkdirSync(monitorDir(), { recursive: true });
  writeFileSync(reportFile(day), JSON.stringify(r, null, 2) + "\n");
  const w = writeNote(r);
  if ("title" in w) r.note = w.title; else r.noteError = w.error;
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
    if (r) factoryLog(`monitor ${day}: ${r.error ? `no reading: ${r.error}` : `${r.findings.length} findings`}; ${acceptanceLine(r.table)}${r.noteError ? `; no vault note: ${r.noteError}` : ""}`);
    return r;
  } catch (e: any) {
    factoryLog(`monitor ${day}: failed: ${e?.message ?? e}`);
    return null;
  }
}
