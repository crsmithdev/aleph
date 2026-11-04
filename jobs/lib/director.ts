/**
 * The director: every new Ask goes to it first. An Ask is new while it has no case text (`situation`): on an open store
 * item that awaits Chris, on an awaiting run's `ask` in the ledger, or on a proposed lesson. Each one gets one read-only
 * `claude -p` run, kind `director`, in the repo's checkout. The run either decides, with typed actions that code checks
 * and applies for that Ask only, or escalates, with the case text (situation, effects, recommendation) that Chris reads
 * on the Ask's card. The card shows no buttons until the case text is there (ui/asks.ts).
 *
 * Code, not the model, holds the escalation list: those Asks get the director's case text and recommendation, and no
 * action. An Ask the director did not decide goes to Chris when its run ends: a failed run, a bad reply, or actions that
 * leave the Ask open all write case text. Each outcome is a `director:` line in tick.log (the Gates page log) and a
 * line in director.jsonl in the factory dir, the record that later runs read.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import * as issues from "../../todo/lib/todo.ts";
import * as store from "../../todo/lib/store.ts";
import * as verbs from "../../todo/lib/issues.ts";
import { ASK_REASONS, LIMITS, PLAN_REST, actionsOn, askOf, editAnswers, limitText, may, reasonOf, setAsk, waitsForSpecEdit, wordsOf, type Ask } from "./ask.ts";
import { allRuns, isAgentRun, loadRegistry, lock, readRun, updateRun, type Entry, type Repo, type Run } from "./ledger.ts";
import { missingVerdict } from "./worker-verdict.ts";
import { endLost, openRun } from "./agent-run.ts";
import { NO_OUTPUT } from "./structured.ts";
import { allJobs, isOpen, issue as issueOf, lastReal, openJob, readFile } from "./job.ts";
import { isLive, isStarting } from "./process.ts";
import { git } from "./git.ts";
import { securityChange } from "./gate.ts";
import { missingSections } from "./goal-spec.ts";
import { onMain, itemOnMain } from "./status.ts";
import { MAX_RUNS_PER_HOUR } from "./goal-decision.ts";
import { writeRerun } from "./continuation.ts";
import { explainLesson, proposals, type Lesson } from "./corrections.ts";
import { factoryDir } from "./factory-status.ts";
import { factoryLog } from "./layout.ts";
import { DIRECTOR_CAP, needsYouLog, vaultDir } from "./settings.ts";
import { FABLE_MODEL } from "./agent-call.ts";
import type { Fate } from "./outcome.ts";
import { drop as dropJob, land as landJob, refusal } from "./transitions.ts";
import { writeTitle } from "./title.ts";

export const DIRECTOR_MODEL = FABLE_MODEL;
/** One run per Ask: its time box in seconds. */
export const SECONDS = 900;
/** The most actions one run may take; the rest are refused. */
export const MAX_ACTIONS = 10;
/**
 * How many times the director may edit one goal's spec on a spec-check Ask; then it closes the goal or escalates.
 * Each spec check starts a build run, so N edits mean N+1 starts; N+1 must not pass MAX_RUNS_PER_HOUR, or run-cap ends the loop first.
 */
export const MAX_SPEC_EDITS = MAX_RUNS_PER_HOUR - 1;
/** The reasons whose Ask the director decides once per goal: a second one on the same goal goes to Chris. */
export const ONCE_PER_GOAL = ["run-cap", "rescue"];
/** Changed files that put a run's land on the escalation list besides the security paths. */
export const HELD_FILES = ["bun.lock"];
const SPEC_EDIT = /^(director|firefighter): edited the spec/;
const TAIL = 40;
const MAX_FILE = 4000;
const RECORD_LINES = 20;

/** Read-only: Read, Grep, Glob, git's read commands, `ls`, and the factory's read commands. */
const ALLOWED = ["Read", "Grep", "Glob", ...["status", "log", "show", "diff", "ls-files"].map((c) => `Bash(git ${c}:*)`), "Bash(ls:*)",
  "Bash(aleph jobs:*)", "Bash(aleph issue show:*)", "Bash(aleph issue list:*)"];

// The cases.

/** One Ask with no case text: on a store item, on an awaiting run, or a proposed lesson. `on` is the item's ref, the run's folder name or the lesson's id. */
export type Case =
  | { at: "item"; on: string; repo: Repo; item: issues.Issue; ask: Ask }
  | { at: "run"; on: string; repo?: Repo; entry: Entry; ask: Ask; item?: issues.Issue }
  | { at: "lesson"; on: string; repo?: Repo; lesson: Lesson };

export type Text = Pick<Ask, "headline" | "situation" | "details" | "effects" | "recommend">;

/** An item's number as the store and the ledger give it: a whole `n` as a number, a part as `"<n>.<k>"`. */
const idOf = (i: issues.Issue): number | string => (i.sub === undefined ? i.id : issues.refOf(i));
const factoryRepos = (): Repo[] => Object.values(loadRegistry()).filter((r) => r.sandbox);
const empty = (ask: Ask | null | undefined): ask is Ask => !!ask && !ask.situation?.trim();

/** Every Ask that has no case text: open items that await Chris, then awaiting runs, oldest run first, then proposed lessons. */
export function pendingCases(repos: Repo[] = factoryRepos(), runs: Entry[] = allRuns(), lists: store.Reader = store.reader()): Case[] {
  const out: Case[] = [];
  for (const repo of repos) {
    for (const item of lists.list(repo.key)?.items ?? []) {
      if (issues.status(item) !== "open" || !store.awaitsChris(item)) continue;
      const ask = askOf(item);
      if (empty(ask)) out.push({ at: "item", on: `${repo.key}-${issues.refOf(item)}`, repo, item, ask });
    }
  }
  const byKey = new Map(repos.map((r) => [r.key, r]));
  const jobs = allJobs();
  for (const entry of runs) {
    const r = entry.run;
    if (r.condition !== "awaiting" || !empty(r.ask)) continue;
    // A run whose job has a live run (a land the director started) is not a new case: the land settles its Ask.
    if (openJob(r.name, r.repo, jobs)?.some((e) => e.folder !== entry.folder && (isLive(e.folder) || isStarting(e)))) continue;
    const repo = r.repo ? byKey.get(r.repo) : undefined;
    if (r.repo && !repo) continue;
    const m = repo && r.on?.match(/^(.+)-(\d+(?:\.\d+)?)$/);
    const item = m && m[1] === repo!.key ? lists.item(repo!.key, m[2].includes(".") ? m[2] : Number(m[2])) ?? undefined : undefined;
    out.push({ at: "run", on: entry.id, repo, entry, ask: r.ask!, ...(item ? { item } : {}) });
  }
  for (const lesson of proposals()) {
    if (lesson.state !== "proposed" || !lesson.kind || lesson.situation?.trim()) continue;
    out.push({ at: "lesson", on: lesson.id, repo: repos[0], lesson });
  }
  return out;
}

/** What the case asks: an Ask's question, a lesson's sentence. */
const questionOf = (c: Case): string => (c.at === "lesson" ? c.lesson.sentence : c.ask.question);
const reasonName = (c: Case): string => (c.at === "lesson" ? `proposal-${c.lesson.kind}` : c.ask.reason);
/** The goal or thing the case is about, as the log names it: the item's ref, a run's item or job, a lesson's id. */
export const refOf = (c: Case): string => (c.at === "run" ? c.entry.run.on ?? c.entry.run.name : c.on);

/** The actions Chris's card offers, each owed an effect: the reason's actions, with `decide` as one `decide:<label>` per option. */
export function actionsOf(c: Case): string[] {
  if (c.at === "lesson") return ["approve", "decline"];
  const reason = reasonOf(c.ask.reason);
  const acts = actionsOn(reason, { run: c.at === "run", decision: c.ask.options.length > 0 });
  return acts.flatMap((a) => (a === "decide" && c.ask.options.length ? c.ask.options.map((o) => `decide:${o.label}`) : [a]));
}

// The record.

/** One director decision, kept with its outcome. */
export interface Decision {
  at: string; ref: string; on: string; reason: string; question: string;
  outcome: "decided" | "escalated";
  /** Why it went to Chris: the escalation-list rule, or what left it undecided. */
  why?: string;
  applied: string[]; refused: string[]; run?: string;
}
const recordFile = () => join(factoryDir(), "director.jsonl");

/** The director's decisions, oldest first. A bad line is skipped. */
export function readRecord(): Decision[] {
  let text = "";
  try { text = readFileSync(recordFile(), "utf8"); } catch { return []; }
  return text.split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l) as Decision]; } catch { return []; } });
}

function record(d: Decision): void {
  mkdirSync(factoryDir(), { recursive: true });
  appendFileSync(recordFile(), JSON.stringify(d) + "\n");
  const what = d.outcome === "decided"
    ? `decided: ${d.applied.join("; ") || "no action"}${d.refused.length ? `; refused ${d.refused.join("; ")}` : ""}`
    : `escalated: ${d.why ?? "undecided"}${d.refused.length ? `; refused ${d.refused.join("; ")}` : ""}`;
  factoryLog(`director: ${d.ref}: ${d.reason}: ${what}`);
}

/**
 * Whether the director escalated this Ask before and its case text did not get written: the same place, reason and
 * question. The same Ask raised again after a decision is a new Ask.
 */
const escalatedBefore = (c: Case, rec: Decision[]): boolean => {
  const last = rec.findLast((d) => d.on === c.on && d.reason === reasonName(c));
  return last?.outcome === "escalated" && last.question === questionOf(c);
};

// The escalation list.

/** A held path the branch changes (a security path or bun.lock), or null; "unknown" when there is no branch to read. */
export function heldChange(repo: Repo, branch: string | undefined): string | null | "unknown" {
  if (!branch || !git(repo.path, "rev-parse", "--verify", "-q", `refs/heads/${branch}`).ok) return "unknown";
  const main = git(repo.path, "rev-parse", "--verify", "-q", `origin/${repo.main}`).ok ? `origin/${repo.main}` : repo.main;
  const fork = git(repo.path, "merge-base", main, `refs/heads/${branch}`);
  if (!fork.ok) return "unknown";
  const sec = securityChange(repo.path, fork.out.trim(), `refs/heads/${branch}`);
  if (sec) return sec;
  const names = git(repo.path, "diff", "--name-only", fork.out.trim(), `refs/heads/${branch}`).out.split("\n");
  return HELD_FILES.find((f) => names.includes(f)) ?? null;
}

/** The branch of the run a case is about: the case's own run, or the open job of its item. */
function branchOf(c: Case): { repo: Repo; branch?: string } | null {
  if (c.at === "lesson" || !c.repo) return null;
  if (c.at === "run") {
    const runs = openJob(c.entry.run.name);
    const agent = runs?.findLast((e) => isAgentRun(e.run.kind));
    return { repo: c.repo, branch: agent?.run.branch ?? c.entry.run.branch };
  }
  return null;
}

/**
 * Why this Ask is on the escalation list, or null when the director may decide it. Fixed rules, not the model's
 * judgement: a memory proposal, a land of a run that changes a security path or bun.lock (or a held run whose branch
 * cannot be read), a host check (host access is off), and a second run-cap or rescue Ask on a goal the director already
 * decided once. Closing or dropping an issue Chris filed is refused per action (`chrisOwns`).
 */
export function escalation(c: Case, rec: Decision[] = readRecord()): string | null {
  if (c.at === "lesson" || c.ask.reason.startsWith("proposal-")) return "a memory proposal is Chris's";
  if (c.ask.reason === "host-check") return "a host check is Chris's while host access is off";
  if (ONCE_PER_GOAL.includes(c.ask.reason) && rec.some((d) => d.ref === refOf(c) && d.reason === c.ask.reason && d.outcome === "decided"))
    return `the director already decided a ${c.ask.reason} Ask on ${refOf(c)}; the second goes to Chris`;
  const b = actionsOf(c).includes("land") ? branchOf(c) : null;
  if (b) {
    const held = heldChange(b.repo, b.branch);
    if (held === "unknown" && c.ask.reason === "held-path") return "the held run's branch cannot be read for security paths, so its land is Chris's";
    if (held && held !== "unknown") return `the run changes ${held}, a security path or bun.lock, so its land is Chris's`;
  }
  return null;
}

/** Whether closing or dropping this issue is Chris's: he filed it. */
const chrisOwns = (item: issues.Issue): boolean => store.sourceOf(item) === "chris";

// The prompt.

const tail = (folder: string, file: string): string | null => {
  try {
    const s = readFileSync(join(folder, file), "utf8").trimEnd();
    return s ? s.split("\n").slice(-TAIL).join("\n") : null;
  } catch { return null; }
};
const clip = (s: string) => (s.length > MAX_FILE ? `…${s.slice(-MAX_FILE)}` : s);

/** `git diff --stat` of the run's branch against its repo's main, or why there is none. */
function diffStat(repo: Repo | undefined, run: Run): string {
  if (!repo || !run.branch) return "(no branch)";
  if (!existsSync(repo.path)) return "(the repo is not readable)";
  const main = [`origin/${repo.main}`, repo.main].find((ref) => git(repo.path, "rev-parse", "--verify", "-q", `${ref}^{commit}`).ok);
  const r = main && git(repo.path, "diff", "--stat", `${main}...${run.branch}`);
  return r && r.ok ? r.out.trim() || "(no change)" : "(the branch is not readable)";
}

const section = (title: string, body: string | null | undefined): string => (body && body.trim() ? `\n## ${title}\n\n${body.trim()}\n` : "");

/** The case as prompt text: the Ask, its item and its run. */
function caseText(c: Case): string {
  if (c.at === "lesson") {
    const l = c.lesson;
    return `# The proposal ${c.on}

Reason: proposal-${l.kind}
Actions on Chris's card: ${actionsOf(c).join(", ")}
Kind: ${l.kind}
Target: ${l.target || "(none)"}
Title: ${l.title || "(none)"}
Sentence: ${l.sentence}
Approve only files a goal for the factory; it writes no CLAUDE.md line, skill or check itself. Decline marks the lesson declined for good.
Signals:
${l.signals.map((s) => `- source: ${s.source}; at: ${s.at}; quote: ${s.quote}; link: ${s.link}`).join("\n") || "(none)"}
`;
  }
  const reason = reasonOf(c.ask.reason);
  const r = ASK_REASONS[reason];
  const item = c.item;
  const run = c.at === "run" ? c.entry : undefined;
  const where = c.at === "item" ? `the item ${c.on}` : `the run ${c.on}${run!.run.on ? ` on ${run!.run.on}` : ""}`;
  return `# The Ask on ${where}

Reason: ${reason} (${r.kind}${r.needs ? `, a ${r.needs} wait` : ""})
On: ${c.at === "run" ? `a run of the job ${run!.run.name}` : "an issue"}${c.ask.options.length ? ", a decision with options" : ""}
Actions on Chris's card: ${actionsOf(c).join(", ")}
Question: ${c.ask.question || "(none)"}
${c.ask.options.length ? `Options:\n${c.ask.options.map((o) => `- ${o.label}: ${o.line}${o.after ? ` (waits for ${o.after})` : ""}`).join("\n")}\n` : ""}${c.ask.recommended ? `Recommended option: ${c.ask.recommended}\n` : ""}${c.ask.why.length ? `Why:\n${c.ask.why.map((w) => `- ${w}`).join("\n")}\n` : ""}${item ? `
# Item ${c.at === "item" ? c.on : run!.run.on}: ${item.title} (filed by ${store.sourceOf(item)})
${section("Request", item.request)}${section("Spec", item.spec)}${section("Notes", item.notes.join("\n"))}` : ""}${run ? `
# The run ${c.on}
${run.run.branch ? `\nBranch: ${run.run.branch}\n` : ""}${run.run.reason ? `Reason it stopped: ${run.run.reason}\n` : ""}${section("Tail of prompt.md", tail(run.folder, "prompt.md"))}${section("Tail of result.md", tail(run.folder, "result.md"))}${section("review.md", existsSync(join(run.folder, "review.md")) ? clip(readFileSync(join(run.folder, "review.md"), "utf8")) : null)}${section("Tail of checks.log", tail(run.folder, "checks.log"))}${section("git diff --stat of its branch", diffStat(c.repo, run.run))}` : ""}`;
}

const CASE_TEXT = (acts: string[]): string => `The case text is "escalate": its "headline" is a noun phrase of at most ${LIMITS.headline} words, lowercase first, that names what the card is about, as in: the TypeScript 5.9 to 7.0 upgrade. Its "situation" is plain sentences: what this work is, what stopped it, why only Chris can answer, and the risk. Its "effects" has one entry for each action (${acts.join(", ")}): the "action" and a "text" of 1 or 2 short sentences that says what happens in this case if Chris takes it. Its "recommend" is an action and a one-sentence "why", or null. Its "details", optional, holds risks, gaps and technical facts.`;

/** The past decisions the prompt shows: the last RECORD_LINES, each with its outcome. */
const pastLines = (rec: Decision[]): string =>
  rec.slice(-RECORD_LINES).map((d) => `- ${d.at.slice(0, 16)} ${d.ref} (${d.reason}): ${d.outcome}${d.why ? ` (${d.why})` : ""}${d.applied.length ? `; did ${d.applied.join("; ")}` : ""}${d.refused.length ? `; refused ${d.refused.join("; ")}` : ""}`).join("\n") || "(none yet)";

export function prompt(c: Case, escalated: string | null, rec: Decision[] = readRecord()): string {
  const acts = actionsOf(c);
  const decisions = join(vaultDir(), "wiki", "decisions");
  const head = `You are the factory's director. Every Ask, a stop where the factory would wait for Chris, comes to you first. You decide it as Chris would, on your own judgement, or you escalate it to Chris with your recommendation. You have read-only tools: Read, Grep, Glob, and Bash for \`git status|log|show|diff|ls-files\`, \`ls\`, \`aleph jobs\` and \`aleph issue show|list\`. Change nothing yourself: you propose actions, and the code checks and applies them. Your working directory is the repo${c.repo ? ` ${c.repo.key}` : ""}.

What informs your judgement: Chris's decisions in the vault (${decisions}: read the ones that bear on this case), the tail of his needs-you log below, and your past decisions with their outcomes below. A case with no precedent is still yours to decide. Read the files the case names before you write about them.
${section(`The tail of Chris's needs-you log (${needsYouLog()})`, tail(dirname(needsYouLog()), basename(needsYouLog())) ?? "(none)")}`;
  const reply = `# Your reply

Text over a limit moves to "details" by sentence: "headline" is at most ${LIMITS.headline} words, "situation" at most ${LIMITS.situation.words} words, and each effect "text" at most ${LIMITS.choice.words} words. Write for Chris in short plain sentences, with no file paths in "headline", "situation" or the effects: paths go in "details". "details" holds only risks, gaps and the technical facts (paths, commits, rules), not a second summary. Give one effect for each of these actions, with exactly this "action": ${acts.join(", ")}. State only what you read; where you did not read something, say "I did not check X". "recommend" is null when you cannot tell.`;
  if (escalated) {
    return `${head}
This Ask is on the escalation list: ${escalated}. Chris decides it. Take no action. Write the case text he reads on its card, with your recommendation.

${caseText(c)}

# Your past decisions

${pastLines(rec)}

${reply}

Reply with the case text only. ${CASE_TEXT(acts)}
`;
  }
  const onRun = c.at === "run";
  return `${head}
# The rules

- Decide when you can: answer the question, rerun the goal, drop the run, edit the spec or the goal, or file a fix job. Escalate only when you cannot tell what Chris would want, or when the choice costs Chris something he has not decided before.
- Code refuses, whatever you reply: closing or dropping an issue Chris filed; landing a run that changes a security path or bun.lock, or a held run before the reviewer gave a verdict; more than ${MAX_ACTIONS} actions; a spec edit past ${MAX_SPEC_EDITS} on one goal's spec check, after which you close the goal or escalate.
- A spec-check Ask is answered by an edit-goal whose body has ## Goal, ## Edit surface and ## Oracle: the spec check reads it before the next worker run. Make the smallest edit: change only the clauses the hold names, and keep every other clause word for word. Add no design the hold did not ask for: no markup, CSS properties, thresholds or new requirements. The next spec check cannot hold the goal again: it passes, and the worker settles what is left.
- When a run cannot pass until another open goal lands, drop it or edit the goal with \`after\` set to that goal. A note alone does not stop a rerun.
- The \`## Goal\` of a spec you write is the behaviour in at most 3 sentences, with no implementation design and no claim about code on main that you did not read.
- A fix job is an \`add\` whose body has ## Goal, ## Edit surface and ## Oracle; set \`after\` on this goal with edit-goal when it must wait for the fix.
- Either decide (actions) or escalate (case text), not both. An Ask that your actions leave open goes to Chris.

${caseText(c)}

# Your past decisions

${pastLines(rec)}

${reply}

Reply with "actions" to decide, or with "escalate" to send it to Chris. ${CASE_TEXT(acts)}

Each action applies to this Ask's ${onRun ? "run and its item" : "item"}. Its "do" is one of these; an "after" lists issues as \`<repo>-<n>\` or \`<repo>-<n>.<k>\`:
${onRun ? `- land: land the run's branch
- drop: a "reason" the next run reads, an optional "after", and an optional "fate"
- answer: a "note" that answers the worker's question; the job reruns with it
` : `- answer: a "note" with the decision, an optional "option" (an option's label) and an optional "after"
- rerun: an optional "note" that says why
- drop: drop the item's open job, with a "reason", an optional "after" and an optional "fate"
`}- close: mark the item done, with a "note" that says why the goal is already met on main
- drop-issue: a "reason" that says why nothing more runs for it
- edit-goal: an optional "body" with the new spec, and an optional "after" of the open goals it waits for
- add: the fix job's "title" and its spec as "body"
- note: a "text" to note on the item
`;
}

// The reply.

export type Action =
  | { do: "land" }
  | { do: "drop"; reason: string; after?: string[]; fate?: Fate }
  | { do: "answer"; note: string; option?: string; after?: string[] }
  | { do: "rerun"; note?: string }
  | { do: "close"; note: string }
  | { do: "drop-issue"; reason: string }
  | { do: "edit-goal"; body?: string; after?: string[] }
  | { do: "add"; title: string; body: string }
  | { do: "note"; text: string };

const nonEmpty = { type: "string", minLength: 1 };
const refList = { type: "array", items: { type: "string", pattern: "^[a-z0-9-]+-\\d+(\\.\\d+)?$" } };
const shape = (name: string, fields: Record<string, object> = {}, required: string[] = []) => ({
  type: "object", additionalProperties: false, required: ["do", ...required], properties: { do: { const: name }, ...fields },
});

/** The JSON schema of the director's reply: `actions` to decide, or `escalate` with the case text. */
export const DIRECTOR_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    actions: {
      type: "array",
      items: {
        oneOf: [
          shape("land"),
          shape("drop", { reason: nonEmpty, after: refList, fate: { enum: ["already-met", "duplicate", "by-hand"] } }, ["reason"]),
          shape("answer", { note: nonEmpty, option: nonEmpty, after: refList }, ["note"]),
          shape("rerun", { note: nonEmpty }),
          shape("close", { note: nonEmpty }, ["note"]),
          shape("drop-issue", { reason: nonEmpty }, ["reason"]),
          shape("edit-goal", { body: nonEmpty, after: refList }),
          shape("add", { title: nonEmpty, body: nonEmpty }, ["title", "body"]),
          shape("note", { text: nonEmpty }, ["text"]),
        ],
      },
    },
    escalate: {
      type: "object", additionalProperties: false, required: ["situation", "effects", "recommend"],
      properties: {
        headline: { type: "string" },
        situation: nonEmpty,
        effects: { type: "array", items: { type: "object", additionalProperties: false, required: ["action", "text"], properties: { action: nonEmpty, text: nonEmpty } } },
        recommend: { anyOf: [{ type: "object", additionalProperties: false, required: ["action", "why"], properties: { action: nonEmpty, why: nonEmpty } }, { type: "null" }] },
        details: { type: "string" },
      },
    },
  },
};

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
/** The issue ids (`<repo>-<n>` or `<repo>-<n>.<k>`) in a string, a comma list or an array; any other value is ignored. */
const refs = (v: unknown): string[] | undefined => {
  const ok = (Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : []).map(str).filter((x) => /^[a-z0-9-]+-\d+(\.\d+)?$/.test(x));
  return ok.length ? ok : undefined;
};

function parseAction(raw: any): Action | string {
  if (!raw || typeof raw !== "object") return "not an object";
  const f = (k: string) => str(raw[k]) || null;
  const after = refs(raw.after);
  const fate = (["duplicate", "already-met", "by-hand"] as const).find((x) => x === raw.fate);
  const w = { ...(after ? { after } : {}) };
  switch (raw.do) {
    case "land": return { do: "land" };
    case "drop": return f("reason") ? { do: "drop", reason: f("reason")!, ...w, ...(fate ? { fate } : {}) } : "drop without a reason";
    case "answer": return f("note") ? { do: "answer", note: f("note")!, ...(f("option") ? { option: f("option")! } : {}), ...w } : "answer without a note";
    case "rerun": return { do: "rerun", ...(f("note") ? { note: f("note")! } : {}) };
    case "close": return f("note") ? { do: "close", note: f("note")! } : "close without a note";
    case "drop-issue": return f("reason") ? { do: "drop-issue", reason: f("reason")! } : "drop-issue without a reason";
    case "edit-goal": return f("body") || after ? { do: "edit-goal", ...(f("body") ? { body: f("body")! } : {}), ...w } : "edit-goal without a body or after";
    case "add": return f("title") && f("body") ? { do: "add", title: f("title")!, body: f("body")! } : "add without a title and a body";
    case "note": return f("text") ? { do: "note", text: f("text")! } : "note without text";
    default: return `unknown action ${JSON.stringify(raw.do)}`;
  }
}

export const describe = (a: Action): string =>
  a.do === "land" ? "land" : a.do === "drop" ? `drop: ${a.reason}${a.after ? ` (after ${a.after.join(", ")})` : ""}`
  : a.do === "answer" ? `answer: ${a.option ? `${a.option}: ` : ""}${a.note}${a.after ? ` (after ${a.after.join(", ")})` : ""}`
  : a.do === "rerun" ? `rerun${a.note ? `: ${a.note}` : ""}` : a.do === "close" ? `close: ${a.note}` : a.do === "drop-issue" ? `drop-issue: ${a.reason}`
  : a.do === "edit-goal" ? `edit-goal${a.body !== undefined ? " (spec)" : ""}${a.after ? ` (after ${a.after.join(", ")})` : ""}` : a.do === "add" ? `add: ${a.title}` : `note: ${a.text}`;

/** The case text in a raw object, or why it does not do. Text over a limit moves to `details` by whole sentences. */
export function parseCaseText(raw: any, actions: string[]): Text | string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "not an object";
  const moved: string[] = [];
  const keep = (t: string, limit: { words: number }): string => {
    const { kept, rest } = limitText(t, limit);
    if (rest) moved.push(rest);
    return kept;
  };
  const situation = keep(str(raw.situation), LIMITS.situation);
  if (!situation) return "no situation";
  if (!Array.isArray(raw.effects)) return "no effects list";
  const effects: { action: string; text: string }[] = [];
  for (const e of raw.effects) {
    const action = str(e?.action), text = str(e?.text);
    if (actions.includes(action) && text && !effects.some((x) => x.action === action)) effects.push({ action, text: keep(text, LIMITS.choice) });
  }
  const missing = actions.filter((a) => !effects.some((e) => e.action === a));
  if (missing.length) return `no effect for ${missing.join(", ")}`;
  const rec = raw.recommend && typeof raw.recommend === "object" ? { action: str(raw.recommend.action), why: str(raw.recommend.why) } : null;
  const recommend = rec && rec.action && actions.includes(rec.action) ? rec : undefined;
  const details = [...moved, str(raw.details)].filter(Boolean).join(" ");
  const h = str(raw.headline).replace(/[.!?]+$/, "");
  const headline = h && wordsOf(h) <= LIMITS.headline ? h : "";
  return { ...(headline ? { headline } : {}), situation, ...(details ? { details } : {}), effects: actions.map((a) => effects.find((e) => e.action === a)!), ...(recommend ? { recommend } : {}) };
}

export type Reply = { actions: (Action | string)[] } | { escalate: Text | string };

/** The reply in the run's structured output: the actions, each parsed or why not, or the case text; a string when it is neither. */
export function parseReply(raw: any, actions: string[]): Reply | string {
  if (raw === undefined) return NO_OUTPUT;
  if (!raw || typeof raw !== "object") return "not an object";
  if (raw.escalate !== undefined && raw.escalate !== null) return { escalate: parseCaseText(raw.escalate, actions) };
  if (!Array.isArray(raw.actions)) return "no actions list and no escalate";
  return { actions: raw.actions.map(parseAction) };
}

// Writing the case text.

const sameAsk = (a: Ask | null | undefined, b: Ask): boolean => !!a && reasonOf(a.reason) === reasonOf(b.reason) && a.question === b.question && !a.situation?.trim();

/** Whether the case's Ask is still the same one, with no case text. */
export function stillOpen(c: Case): boolean {
  if (c.at === "lesson") return proposals().some((l) => l.id === c.lesson.id && l.state === "proposed" && !l.situation?.trim());
  if (c.at === "item") {
    const item = store.reader().item(c.repo.key, idOf(c.item));
    return !!item && issues.status(item) === "open" && store.awaitsChris(item) && sameAsk(askOf(item), c.ask);
  }
  const now = readRun(c.entry.folder);
  return !!now && now.condition === "awaiting" && sameAsk(now.ask, c.ask);
}

/** Write the text on the Ask, when the Ask is still the same one. Whether it was written. */
export function writeCaseText(c: Case, t: Text): boolean {
  if (c.at === "item") {
    const ref = issues.refOf(c.item);
    const w = store.writeList(c.repo, `director ${c.on}`, (doc) => {
      const item = issues.find(doc, ref);
      if (!item || issues.status(item) !== "open" || !store.awaitsChris(item) || !sameAsk(askOf(item), c.ask)) return null;
      setAsk(item, { ...askOf(item)!, ...t });
      return true;
    });
    return w?.value === true;
  }
  if (c.at === "lesson") return explainLesson(c.lesson.id, c.lesson.sentence, t);
  const now = readRun(c.entry.folder);
  if (!now || now.condition !== "awaiting" || !sameAsk(now.ask, c.ask)) return false;
  updateRun(c.entry.folder, { ask: { ...now.ask!, ...t } });
  return true;
}

/** The case text when the director gave none that does: one sentence on why it reached Chris. */
const fallback = (why: string): Text => ({ situation: `The director did not decide this Ask: ${why.replace(/\.$/, "")}.` });

// Applying the actions.

/** How actions reach the factory; each returns the refusal, or null. Tests replace them. */
export interface Ports {
  land: (name: string) => Promise<string | null>;
  drop: (name: string, reason: string, fate?: Fate) => Promise<string | null>;
}
export const defaultPorts: Ports = {
  land: (name) => refusal(async () => { await (await landJob(name, { lander: "director" }, { output: "ignore" })).child?.exited; }),
  drop: (name, reason, fate) => refusal(() => dropJob(name, { reason, quiet: true, fate })),
};

/** The result of one action: applied (and whether it decides the Ask), or refused. */
type Outcome = { applied: string; decides: boolean } | { refused: string };

const specEditsOf = (item: issues.Issue): number => item.notes.filter((n) => SPEC_EDIT.test(n.replace(/^- \d{4}-\d\d-\d\d \d\d:\d\d: /, ""))).length;
const done = (a: Action, decides = true): Outcome => ({ applied: describe(a), decides });
const no = (a: Action, why: string): Outcome => ({ refused: `${describe(a)}: ${why}` });

/** The open job of the case: its own run's job, else the open job of its item. */
function jobOf(c: Exclude<Case, { at: "lesson" }>, n: number | string | undefined): string | undefined {
  if (c.at === "run") return c.entry.run.name;
  return allJobs().find((j) => isOpen(j) && j[0].run.repo === c.repo.key && issueOf(j) === n)?.[0].run.name;
}

/** Check one action against the rules and apply it, for the case's Ask only. */
async function applyOne(c: Exclude<Case, { at: "lesson" }>, a: Action, ports: Ports): Promise<Outcome> {
  const repo = c.repo;
  if (!repo) return no(a, "the Ask is not in a factory repo");
  const item0 = c.item;
  const n = item0 ? idOf(item0) : undefined;
  const item = n !== undefined ? store.reader().item(repo.key, n) ?? undefined : undefined;
  if (a.do === "land") {
    if (c.at !== "run") return no(a, "the Ask is not on a run");
    const b = branchOf(c);
    const held = b ? heldChange(b.repo, b.branch) : "unknown";
    if (held) return no(a, held === "unknown" ? "its branch cannot be read for security paths, so the land is Chris's" : `it changes ${held}, a security path or bun.lock, so the land is Chris's`);
    // A run held for a path the repo holds lands once the reviewer gave a verdict; a review Ask is the director's call over the reviewer's hold.
    if (c.ask.reason === "held-path") {
      const runs = openJob(c.entry.run.name);
      const agent = runs?.findLast((e) => isAgentRun(e.run.kind)) ?? c.entry;
      const missing = missingVerdict(readFile(agent, "review.md"));
      if (missing) return no(a, missing);
    }
    const why = await ports.land(c.entry.run.name);
    return why ? no(a, why) : done(a);
  }
  if (a.do === "drop" || (a.do === "answer" && c.at === "run")) {
    const name = jobOf(c, n);
    if (!name || !openJob(name)) return no(a, "no open job to drop");
    const runs = openJob(name)!;
    const last = lastReal(runs);
    const issue = issueOf(runs);
    let reason: string, fate: Fate | undefined;
    if (a.do === "answer") {
      reason = `The director answered the worker's question "${c.ask.question}": ${a.note}`;
    } else {
      reason = a.reason;
      // The reply may leave the fate off: a goal whose own commit is on origin/main is met; a reason naming another goal already on main is work that goal did.
      const other = a.reason.match(new RegExp(`\\b${repo.key}-(\\d+)\\b`, "g"))?.map((r) => r.slice(repo.key.length + 1)).find((x) => Number(x) !== issue && itemOnMain(repo, Number(x)));
      fate = a.fate ?? (onMain(repo, { job: last.run.job, item: issue, fetch: false }) ? "already-met" : other ? "duplicate" : undefined);
    }
    const why = await ports.drop(name, reason, fate);
    if (why) return no(a, why);
    writeRerun(name, a.do === "answer" ? reason : `The last run was dropped by the director: ${reason}`);
    const waits = a.do === "drop" && a.after && issue !== undefined ? await refusal(async () => verbs.edit(repo, issue, { after: a.after })) : null;
    if (issue !== undefined) store.note(repo, issue, `director: dropped ${name}: ${reason}${a.do === "drop" && a.after ? `; after ${a.after.join(", ")}` : ""}`);
    // A run's Ask goes with its run; an item's Ask stays when its job is dropped.
    return waits ? no(a, `dropped, but after not set: ${waits}`) : done(a, c.at === "run");
  }
  if (!item || issues.status(item) !== "open") return no(a, `no open issue ${c.at === "run" ? c.entry.run.on ?? "for the run" : c.on}`);
  const id = `${repo.key}-${n}`;
  if (a.do === "note") {
    const why = store.note(repo, n!, `director: ${a.text}`);
    return why ? no(a, why) : done(a, false);
  }
  if (a.do === "add") {
    const missing = missingSections(a.body);
    if (missing.length) return no(a, `the body lacks ${missing.map((h) => `## ${h}`).join(", ")}`);
    const title = issues.titleProblem(a.title) ? await writeTitle(a.title) : a.title;
    const w = store.writeList(repo, `todo: a fix job for ${id}`, (doc) => issues.add(doc, title, { spec: a.body, source: "agent" }).id, true);
    if (!w) return no(a, "no issue written");
    store.note(repo, n!, `director: filed ${repo.key}-${w.value} as a fix job: ${title}`);
    return { applied: `${describe(a)} (${repo.key}-${w.value})`, decides: false };
  }
  if (a.do === "close" || a.do === "drop-issue") {
    if (chrisOwns(item)) return no(a, `${id} was filed by Chris, so closing or dropping it is his`);
    if (a.do === "drop-issue") {
      const open = jobOf(c, n);
      if (open) { const why = await ports.drop(open, `dropped by the director: ${a.reason}`); if (why) return no(a, why); }
      const why = await refusal(async () => verbs.close(repo, n!, "drop", `director: dropped: ${a.reason}`));
      return why ? no(a, why) : done(a);
    }
    const open = jobOf(c, n);
    if (open) { const why = await ports.drop(open, `closed by the director: ${a.note}`, "already-met"); if (why) return no(a, why); }
    const why = store.note(repo, n!, `director: closed: ${a.note}`, { done: true });
    return why ? no(a, why) : done(a);
  }
  if (a.do === "answer" || a.do === "rerun") {
    const ask = askOf(item);
    const waiting = allJobs().find((j) => isOpen(j) && j[0].run.repo === repo.key && issueOf(j) === n && waitsForSpecEdit(lastReal(j)));
    const refused = may("director", "answer", ask, waiting ? { waiting: waiting[0].run.name } : {});
    if (refused) return no(a, refused);
    const option = a.do === "answer" && a.option ? ask?.options.find((o) => o.label === a.option) : undefined;
    if (a.do === "answer" && a.option && !option) return no(a, `the Ask has no option ${a.option}`);
    const said = a.do === "rerun" ? `director: run it again${a.note ? `: ${a.note}` : ""}` : `director decided: ${option ? `${option.label}: ${option.line}. ` : ""}${a.note}`;
    // On the part-dropped Ask, any answer but the plan option closes the issue.
    if (ask?.reason === "part-dropped" && !said.includes(PLAN_REST) && chrisOwns(item)) return no(a, `${id} was filed by Chris, and this answer closes it`);
    const after = a.do === "answer" ? a.after ?? (option?.after ? [option.after] : undefined) : undefined;
    const why = await refusal(async () => verbs.decide(repo, n!, said, after ? { after } : {}));
    return why ? no(a, why) : done(a);
  }
  // edit-goal
  const list = store.reader().list(repo.key);
  if (list && store.partsOf(list, item).length) return no(a, "it has parts");
  const spec = c.ask.reason === "spec-check" && a.body !== undefined;
  if (spec && specEditsOf(item) >= MAX_SPEC_EDITS) return no(a, `the spec of ${id} was edited ${MAX_SPEC_EDITS} times; close it or escalate`);
  const why = await refusal(async () => verbs.edit(repo, n!, { ...(a.body !== undefined ? { spec: a.body } : {}), ...(a.after ? { after: a.after } : {}) }));
  if (why) return no(a, why);
  if (spec) store.note(repo, n!, `director: edited the spec (${specEditsOf(item) + 1} of ${MAX_SPEC_EDITS})`);
  if (spec && editAnswers(askOf(item), a.body)) {
    const w = await refusal(async () => verbs.decide(repo, n!, "director edited the spec; the spec check runs again before the next worker run"));
    if (w) return no(a, `the spec is edited, but the spec-check Ask stays: ${w}`);
    return done(a);
  }
  return done(a, false);
}

/** Apply the reply's actions for the case in order, at most MAX_ACTIONS. Whether one of them decided the Ask. */
export async function applyActions(c: Exclude<Case, { at: "lesson" }>, actions: (Action | string)[], ports: Ports = defaultPorts): Promise<{ applied: string[]; refused: string[]; decided: boolean }> {
  const out = { applied: [] as string[], refused: [] as string[], decided: false };
  for (const [i, a] of actions.entries()) {
    let o: Outcome;
    if (i >= MAX_ACTIONS) o = { refused: `${typeof a === "string" ? a : describe(a)}: more than ${MAX_ACTIONS} actions in one run` };
    else if (typeof a === "string") o = { refused: `a malformed action: ${a}` };
    else {
      try { o = await applyOne(c, a, ports); } catch (e: any) { o = { refused: `${describe(a)}: ${e?.message ?? e}` }; }
    }
    if ("applied" in o) { out.applied.push(o.applied); out.decided ||= o.decides; } else out.refused.push(o.refused);
  }
  return out;
}

// One run per Ask.

const lockName = (on: string) => `director-${on}`;
const lockOf = (run: Run): string | null => (run.on ? lockName(run.on) : null);

/** Send the Ask to Chris: the case text (the director's, else the fallback) on it, and the record. */
function escalate(c: Case, base: Omit<Decision, "outcome">, text: Text | string | undefined, why: string): Decision {
  const t = text && typeof text !== "string" ? text : fallback(typeof text === "string" ? `${why}; its case text had ${text}` : why);
  if (!writeCaseText(c, t) && stillOpen(c)) factoryLog(`director: ${base.ref}: the case text was not written`);
  const d: Decision = { ...base, outcome: "escalated", why };
  record(d);
  return d;
}

/** One director run on one Ask: it decides or escalates. The decision, or null when another run holds the Ask. */
export async function direct(c: Case, ports: Ports = defaultPorts): Promise<Decision | null> {
  const release = await lock(lockName(c.on), 0);
  if (!release) return null;
  try {
    const rec = readRecord();
    const base = { at: new Date().toISOString(), ref: refOf(c), on: c.on, reason: reasonName(c), question: questionOf(c), applied: [] as string[], refused: [] as string[] };
    // One run per Ask: an Ask the director escalated before, whose case text was not written, goes to Chris with no second run.
    if (escalatedBefore(c, rec)) return escalate(c, base, undefined, "the director escalated this Ask before");
    const listed = escalation(c, rec);
    const cwd = c.repo && existsSync(c.repo.path) ? c.repo.path : undefined;
    const dirs = ["--add-dir", join(vaultDir(), "wiki", "decisions")];
    const run = openRun({
      role: "director", who: "the director", model: DIRECTOR_MODEL, seconds: SECONDS,
      flags: ["--tools", "Read,Grep,Glob,Bash", "--allowedTools", ALLOWED.join(","), ...dirs], schema: DIRECTOR_SCHEMA,
      cwd, name: `director-${c.on}`, command: `director ${c.on}: ${reasonName(c)}: ${questionOf(c)}`, shown: true, on: c.on,
    });
    updateRun(run.folder, { question: questionOf(c) });
    const at = { ...base, run: run.folder.split("/").at(-1)! };
    let reply: Reply | string;
    try { reply = parseReply(await run.askData(prompt(c, listed, rec)), actionsOf(c)); } catch (e: any) {
      run.end(`failed: ${e?.message ?? e}`);
      return escalate(c, at, undefined, `its run failed: ${e?.message ?? e}`);
    }
    if (typeof reply === "string") { run.end(`malformed reply: ${reply}`); return escalate(c, at, undefined, `its reply was malformed: ${reply}`); }
    if ("escalate" in reply) {
      run.end("escalated");
      return escalate(c, at, reply.escalate, listed ?? "the director did not decide");
    }
    if (listed || c.at === "lesson") {
      run.end("escalated: the Ask is on the escalation list");
      return escalate(c, { ...at, refused: reply.actions.map((a) => `${typeof a === "string" ? a : describe(a)}: the Ask is on the escalation list`) }, undefined, listed ?? "a memory proposal is Chris's");
    }
    const r = await applyActions(c, reply.actions, ports);
    const decided = r.decided || !stillOpen(c);
    run.end(`${r.applied.length} applied, ${r.refused.length} refused, ${decided ? "decided" : "escalated"}`);
    if (!decided) return escalate(c, { ...at, applied: r.applied, refused: r.refused }, undefined, r.refused.length ? `its actions left the Ask open (refused: ${r.refused.join("; ")})` : "its actions left the Ask open");
    const d: Decision = { ...at, outcome: "decided", applied: r.applied, refused: r.refused };
    // A decision whose effect has not cleared the Ask yet (a land still running, say) still ends this Ask's one run: Chris sees it with the text.
    // A land runs in its own unit and settles the Ask when it ends, so a started land leaves no text: a failed land raises its own Ask.
    if (!r.applied.includes("land") && stillOpen(c)) writeCaseText(c, { situation: `The director decided: ${r.applied.join("; ")}. The Ask is still open, so it is with you.` });
    record(d);
    return d;
  } finally {
    release();
  }
}

/**
 * The director's sweep: one run for each Ask with no case text, at most `ALEPH_DIRECTOR_CAP` a tick, all at once.
 * An error is logged, never thrown.
 */
export async function directAll(repos: Repo[] = factoryRepos(), ports: Ports = defaultPorts): Promise<Decision[]> {
  try {
    await endLost("director", lockOf, "its decision");
    const todo = pendingCases(repos).slice(0, Math.max(0, DIRECTOR_CAP()));
    const out = await Promise.all(todo.map((c) => direct(c, ports).catch((e: any) => { factoryLog(`director: ${refOf(c)}: failed: ${e?.message ?? e}`); return null; })));
    return out.filter((d): d is Decision => !!d);
  } catch (e: any) {
    factoryLog(`director: failed: ${e?.message ?? e}`);
    return [];
  }
}
