/**
 * The one-time rewrite of the stored words into those of docs/naming.md: each job record, in the records folder and
 * the archive, and each line of the event log. After it, readers read the stored fields as they are. The tick runs it;
 * its mark file in the factory folder makes each later run do nothing.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ACTIONS, subjectOf, word } from "../../../lib/naming.ts";
import { eventsDir, layout } from "../infra/layout.ts";
import { lastTagged, runsDir, type Review } from "./ledger.ts";
import { archiveDir, lockRecord, recordsDir, type JobRecord } from "./record.ts";

/** The file whose presence says the migration ran. */
export const markFile = (): string => join(layout().factory, "words-migrated");

const STATE: Record<string, string> = { awaiting: "waiting", stuck: "failed", "needs-you": "waiting" };
const SUB: Record<string, string> = {
  "time-box": "timeout", "lock-busy": "locked", reviewer: "review", "no-answer": "unanswered", "own-list": "other",
  "already-met": "met", "by-hand": "manual",
};
const CALL: Record<string, string> = { land: "passed", back: "returned", ask: "waiting", pending: "running", error: "failed" };
/** `facts` stays: readers still tell a facts run from the job's real runs. */
const KIND: Record<string, string> = { agent: "build", triage: "intake", plan: "intake", explain: "director", firefighter: "director" };

/** The exact sentences of the unit, and the cause each states. A drop's sentence is free prose and states nothing. */
const SENTENCES: [RegExp, string][] = [
  [/^no commit$/, "no-commit"],
  [/^time box$/, "timeout"],
  [/^job lock busy$/, "locked"],
  [/^API Error: 402/, "credit"],
  [/^(fetch failed|systemd-run failed|worktree gone|checkout failed|bundle failed)/, "infra"],
  [/^merge conflict/, "conflict"],
  [/^main moved during the land; land again$/, "moved"],
  [/^the branch changes docs\/todo\.md;/, "other"],
  [/^(malformed (verdict|plan)|failed):/, "unanswered"],
];

function fromSentence(reason: string): { cause: string; checkName?: string } | null {
  const row = SENTENCES.find(([re]) => re.test(reason));
  if (row) return { cause: row[1] };
  const check = reason.match(/^timed out: check (.+)$/) ?? reason.match(/^([\w-]+) failed$/);
  return check ? { cause: "check", checkName: check[1] } : null;
}

/** The second review a run folder's call.md holds: a lone `PENDING` line, a last line `ERROR: <reason>`, or a `VERDICT:` line. */
function readCall(folder: string): Review | undefined {
  let text: string;
  try { text = readFileSync(join(folder, "call.md"), "utf8"); } catch { return undefined; }
  const last = text.trim().split("\n").at(-1)?.trim() ?? "";
  if (last === "PENDING") return { call: "running" };
  if (last.startsWith("ERROR:")) return { call: "failed", reason: last.slice(6).trim() };
  const v = lastTagged(text, "VERDICT");
  if (v === "land") return { call: "passed" };
  const m = v?.match(/^(back|chris)\s+(\S.*)$/);
  return m ? { call: m[1] === "chris" ? "waiting" : "returned", reason: m[2] } : { call: "failed", reason: "no VERDICT line" };
}

/** The event of a hold from its text, as near as the text gives it; the text is the note when no form fits. */
function holdEvent(at: string, subject: string, gate: string, t: string): Record<string, unknown> {
  let m: RegExpExecArray | null;
  const f = (m = /^after (\S+)$/.exec(t)) ? { action: "after", on: m[1].split(",") }
    : (m = /^its job is (\w+)$/.exec(t)) ? { action: STATE[m[1]] ?? m[1] }
    : /already (done|landed)/.test(t) ? { action: "done" }
    : (m = /^the item is (\w+)$/.exec(t)) ? { action: m[1] === "gone" ? "dropped" : m[1] }
    : /starting it$/.test(t) ? { action: "starting" }
    : t === "not a goal" ? { action: "parent" }
    : /holds the GPU$/.test(t) ? { action: "gpu" }
    : (m = /^\d+ (local )?agent runs are live$/.exec(t)) ? { action: "full", ...(m[1] ? { sub: "local" } : {}) }
    : (m = /^waits for (\S+): both (?:change the busy file (\S+)|use the (gpt-oss) server)$/.exec(t)) ? { action: "busy", on: [m[1]], file: m[2] ?? m[3] }
    : (m = /^(\d+) runs in a row with no commit$/.exec(t)) ? { action: "looping", sub: "no-commit", count: `${m[1]} / ${m[1]}` }
    : (m = /^(\d+) runs in the last hour$/.exec(t)) ? { action: "looping", sub: "starts", count: `${m[1]} / 1h` }
    : (m = /^main is red at (\w+): ([\s\S]*)$/.exec(t)) ? { action: "red", on: [m[1]], note: m[2] }
    : t === "paused" ? { action: "paused" }
    : { action: word("gate", gate), note: t };
  return { at, by: "gate", subject, ...f };
}

type Stored = Record<string, any>;

/** The `n` of each run that has none, by run id: the next free number in start order on its subject. */
function numbers(runs: Stored[]): Map<string, number> {
  const subjects = new Map<string, Stored[]>();
  for (const x of [...runs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const s = subjectOf(x as { on?: string; kind: string; name: string });
    subjects.set(s, [...(subjects.get(s) ?? []), x]);
  }
  const out = new Map<string, number>();
  for (const list of subjects.values()) {
    const used = new Set(list.map((x) => x.n).filter((n) => n !== undefined));
    let k = 0;
    for (const x of list) {
      if (x.n !== undefined) { k = Math.max(k, x.n); continue; }
      do k++; while (used.has(k));
      used.add(k);
      out.set(x.id, k);
    }
  }
  return out;
}

function migrateRun(x: Stored, n: number | undefined): void {
  x.condition = x.condition === "stuck" && x.failed ? "returned" : STATE[x.condition] ?? x.condition;
  if (x.cause) x.cause = SUB[x.cause] ?? x.cause;
  if (x.fate) x.fate = SUB[x.fate] ?? x.fate;
  if (x.review) x.review.call = CALL[x.review.call] ?? x.review.call;
  x.kind = KIND[x.kind] ?? x.kind;
  const said = x.cause || x.noCommit ? null : fromSentence(x.reason ?? "");
  if (said) { x.cause = said.cause; if (said.checkName) x.checkName ??= said.checkName; }
  if (!x.review) { const review = readCall(join(runsDir(), x.id)); if (review) x.review = review; }
  if (x.n === undefined && n !== undefined) x.n = n;
}

/** A file's new text through a temporary file and a rename, when it changed. */
function put(file: string, was: string, text: string): void {
  if (text === was) return;
  writeFileSync(`${file}.${process.pid}.tmp`, text);
  renameSync(`${file}.${process.pid}.tmp`, file);
}

/** Rewrite the stored words once. Returns false when the mark file says it already ran. */
export function migrateWords(): boolean {
  if (existsSync(markFile())) return false;
  const files = [recordsDir(), archiveDir()].flatMap((dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => join(dir, f)) : []));
  const records = files.map((file) => ({ file, r: JSON.parse(readFileSync(file, "utf8")) as JobRecord }));
  const ns = numbers(records.flatMap(({ r }) => r.runs));
  for (const { file, r: { issue } } of records) {
    const release = lockRecord(issue);
    try {
      const was = readFileSync(file, "utf8"), r = JSON.parse(was) as Stored;
      for (const x of r.runs) migrateRun(x, ns.get(x.id));
      for (const e of r.events) if (e.kind === "hold" && !e.data.event) e.data.event = holdEvent(e.at, r.issue, e.data.gate, e.what);
      put(file, was, JSON.stringify(r, null, 1) + "\n");
    } finally { release(); }
  }
  const dir = eventsDir();
  for (const f of existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".jsonl")) : []) {
    const file = join(dir, f), was = readFileSync(file, "utf8");
    put(file, was, was.split("\n").map((l) => {
      let e: Stored;
      try { e = JSON.parse(l); } catch { return l; }
      if (ACTIONS.includes(e.action)) return l;
      const note = [e.action, e.note].filter(Boolean).join(": ");
      const action = [word("act", e.action), STATE[e.action]].find((w) => ACTIONS.includes(w!)) ?? "changed";
      return JSON.stringify({ ...e, action, ...(note ? { note } : {}) });
    }).join("\n"));
  }
  mkdirSync(layout().factory, { recursive: true });
  writeFileSync(markFile(), `${new Date().toISOString()}\n`);
  return true;
}
