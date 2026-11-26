/**
 * The director: every new Ask goes to it first. An Ask is new while it has no case text (`situation`): on an open store
 * item that awaits the user, or on a waiting run's `ask` in the ledger. Each one gets one read-only
 * `claude -p` run, kind `director`, in the repo's checkout. Every reply carries the case text (situation, effects,
 * recommendation) that the user reads on the Ask's card. With typed actions the run decides: code checks and applies them
 * for that Ask only. With no actions it escalates. The card shows no buttons until the case text is there (ui/asks.ts).
 *
 * Code, not the model, holds the escalation list: those Asks get the director's case text and recommendation, and no
 * action. An Ask the director did not decide goes to the user when its run ends: a failed run, a bad reply, or actions that
 * leave the Ask open all write case text. Actions that leave the Ask open write the director's case text and one line on
 * what it did and could not do; a failed run or a malformed reply writes the fallback. Each outcome is a `director` event in the job record of its item,
 * the record that later runs read, and log events (the Gates page log): one `escalated`, or one per applied action.
 */
import { existsSync } from "node:fs";
import * as jobRecord from "../records/record.ts";
import { dispatchDetached } from "../transitions/launch.ts";
import { afterFiling } from "../transitions/filing.ts";
import * as issues from "../../../lib/issue-file.ts";
import * as store from "../../../lib/store.ts";
import * as verbs from "../../../issues/lib/issues.ts";
import { always, ASK_REASONS, askSub, logAlways, asking, LIMITS, keepsOpen, actionsOn, askOf, limitText, may, reasonOf, setAsk, waitsForSpecEdit, wordsOf, type Ask, refIn, askOfItem } from "../asks/ask.ts";
import { isAgentRun, onOf, type Entry, type Repo, type Run, allJobs, isOpen } from "../records/ledger.ts";
import { allRuns, answering, jobOfRun, type Answer } from "../records/record.ts";
import { lock } from "../../../lib/locks.ts";
import { missingVerdict } from "../gates/worker-verdict.ts";
import { sandboxRepos } from "../gates/gpu.ts";
import { endLost, openRun } from "./agent-run.ts";
import { issue as issueOf, openJob, openJobOfIssue, readFile, tailOf } from "../records/job.ts";
import { isRunning } from "../infra/process.ts";
import { git, mainRef } from "../../../lib/git.ts";
import { ofBranch } from "../records/jobdiff.ts";
import { heldPaths, heldRule, NO_OUTPUT, securityChange } from "../gates/gate.ts";
import { missingSections } from "../../../lib/issue-spec.ts";
import { onMain, itemOnMain } from "../records/status.ts";
import { writeRerun } from "../transitions/continuation.ts";
import { answerHeld } from "./recheck.ts";
import { logEvent } from "../../../lib/layout.ts";
import { because, detailOf as wordDetail, ISSUE_KEY, issueId, key, parseKey, refs as idsIn } from "../../../lib/naming.ts";
import { DIRECTOR_CAP } from "../infra/settings.ts";
import { readModels } from "../routing/models.ts";
import type { Fate } from "../records/outcome.ts";
import { drop as dropJob, land as landJob, refusal } from "../transitions/transitions.ts";
import { cutTitle } from "./title.ts";
import { errText } from "../../../lib/errtext.ts";

const DIRECTOR_MODEL = () => readModels().director.model;
/** One run per Ask: its time box in seconds. */
const SECONDS = 900;
/** The most actions one run may take; the rest are refused. */
export const MAX_ACTIONS = 10;
/** The reasons whose Ask the director decides once per issue: a second one on the same issue goes to the user. */
const ONCE_PER_ISSUE = ["run-cap", "rescue"];
/** The reasons whose first verb a grant takes in `direct`: the other reasons have a rule site of their own. */
const FIRST_VERB = ["held-path", "review-held", "core-change", "no-commit", "run-cap", "part-dropped"];
/** Changed files that put a run's land on the escalation list besides the security paths and the repo's held globs. */
const HELD_FILES = ["bun.lock"];
const TAIL = 40;
const MAX_FILE = 4000;
const RECORD_LINES = 20;

/** Read-only: Read, Grep, Glob, git's read commands, `ls`, and the factory's read commands. */
const ALLOWED = ["Read", "Grep", "Glob", ...["status", "log", "show", "diff", "ls-files"].map((c) => `Bash(git ${c}:*)`), "Bash(ls:*)",
  "Bash(aleph jobs:*)", "Bash(aleph issue show:*)", "Bash(aleph issue list:*)"];

/** One Ask with no case text: on a store item or on a waiting run. `on` is the item's ref or the run's folder name. */
export type Case =
  | { at: "item"; on: string; repo: Repo; item: issues.Issue; ask: Ask }
  | { at: "run"; on: string; repo?: Repo; entry: Entry; ask: Ask; item?: issues.Issue };

type Text = Pick<Ask, "headline" | "situation" | "details" | "effects" | "recommend">;

/** An item's number as the store and the ledger give it: a whole `n` as a number, a part as `"<n>.<k>"`. */
const idOf = (i: issues.Issue): number => i.id;
const empty = (ask: Ask | null | undefined): ask is Ask => !!ask && !ask.situation?.trim();

/** Every Ask that has no case text: open items that await the user, then waiting runs, oldest run first. */
export function pendingCases(repos: Repo[] = sandboxRepos(), runs: Entry[] = allRuns(), lists: store.Reader = store.reader()): Case[] {
  const out: Case[] = [];
  for (const repo of repos) {
    for (const item of lists.list(repo.key)?.items ?? []) {
      const ask = askOfItem(item);
      if (!asking(item, ask)) continue;
      if (empty(ask)) out.push({ at: "item", on: refIn(item), repo, item, ask });
    }
  }
  const byKey = new Map(repos.map((r) => [r.key, r]));
  const jobs = allJobs();
  for (const entry of runs) {
    const r = entry.run;
    if (r.state !== "waiting" || !empty(r.ask)) continue;
    // A run whose job has a live run (a land the director started) is not a new case: the land settles its Ask.
    if (openJob(r.name, r.repo, jobs)?.some((e) => e.folder !== entry.folder && isRunning(e))) continue;
    const repo = r.repo ? byKey.get(r.repo) : undefined;
    if (r.repo && !repo) continue;
    const n = onOf(r);
    const item = repo && n !== undefined ? lists.item(repo.key, n) ?? undefined : undefined;
    out.push({ at: "run", on: entry.id, repo, entry, ask: r.ask!, ...(item ? { item } : {}) });
  }
  return out;
}

const questionOf = (c: Case): string => c.ask.question;
const reasonName = (c: Case): string => c.ask.reason;
/** The issue or thing the case is about, as the log names it: the item's ref, a run's item or job. */
const refOf = (c: Case): string => (c.at === "run" ? c.entry.run.target ?? c.entry.run.name : c.on);

/** The actions the user's card offers, each owed an effect: the reason's actions, with `resolve` on an issue as one `resolve:<label>` per option. */
function actionsOf(c: Case): string[] {
  return actionsOn(reasonOf(c.ask.reason)).flatMap((a) => (a === "resolve" && c.at !== "run" && c.ask.options.length ? c.ask.options.map((o) => `resolve:${o.label}`) : [a]));
}

/** One director decision, kept with its outcome. */
export interface Decision {
  at: string; ref: string; on: string; reason: string; question: string;
  outcome: "decided" | "escalated";
  /** Why it went to the user: the escalation-list rule, or what left it undecided. */
  why?: string;
  applied: string[]; refused: string[]; run?: string;
}
/** The director's decisions, oldest first: the `decision` of each director job. */
export function readRecord(): Decision[] {
  return jobRecord.decisions<Decision>()
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

/** One applied action as the director draws it: `record` joins `sub`, `file`, `on` and `note` into the log event's detail. */
type Ev = { action?: string; sub?: string; file?: string; on?: string[]; note?: string };
const detailOf = (e: Ev): string => [because(e.sub ?? ""), e.file, e.on?.join(" "), e.note].filter(Boolean).join(": ");

/**
 * Keeps the decision on the director's job (a decision made with no run is kept nowhere) and writes its log events, all at one time. `evs` are the applied actions' events:
 * one with no action adds its note to the first. A refusal goes to the note too.
 */
function record(d: Decision, evs: Ev[]): void {
  if (d.run) jobRecord.patchRun(d.run, { decision: d });
  const notes = [...evs.filter((e) => !e.action).map((e) => e.note), ...d.refused.map((x) => `refused ${x}`)].filter(Boolean).join("; ");
  const acts = evs.filter((e) => e.action);
  const out = acts.length ? acts : [{ action: "answered", sub: askSub(d.reason) }];
  const at = new Date().toISOString();
  out.forEach((e, i) => logEvent({ time: at, subject: "director", action: e.action!, object: d.ref, detail: detailOf({ ...e, note: [e.note, i === 0 ? notes : ""].filter(Boolean).join("; ") }) }));
}

/**
 * Whether the director escalated this Ask before and its case text did not get written: the same place, reason and
 * question. The same Ask raised again after a decision is a new Ask.
 */
const escalatedBefore = (c: Case, rec: Decision[]): boolean => {
  const last = rec.findLast((d) => d.on === c.on && d.reason === reasonName(c));
  return last?.outcome === "escalated" && last.question === questionOf(c);
};

/** Where the branch forks from main, or null when there is no branch to read. */
function forkOf(repo: Repo, branch: string | undefined): string | null {
  if (!branch || !git(repo.path, "rev-parse", "--verify", "-q", `refs/heads/${branch}`).ok) return null;
  const fork = git(repo.path, "merge-base", mainRef(repo.path, repo.main), `refs/heads/${branch}`);
  return fork.ok ? fork.out.trim() : null;
}

/** The held rule the branch breaks (a security path, one of the `held` globs or bun.lock), or null; "unknown" when there is no branch to read. */
function heldChange(repo: Repo, branch: string | undefined, held: string[] = repo.held): string | null | "unknown" {
  const fork = forkOf(repo, branch);
  if (!fork) return "unknown";
  const sec = securityChange(repo.path, fork, `refs/heads/${branch}`);
  if (sec) return `held path ${sec}`;
  return heldRule(repo.path, [...held, ...HELD_FILES], fork, `refs/heads/${branch}`);
}

/** The detail of a held-path land: `held: path <first held file> +<rest> · approved by <by>`. */
function heldLand(c: Case, by: string): string {
  const b = branchOf(c), fork = b && forkOf(b.repo, b.branch);
  const [first, ...rest] = fork ? heldPaths(b.repo.path, b.repo.held, fork, `refs/heads/${b.branch}`) : [];
  const file = first && `path ${first}${rest.length ? ` +${rest.length}` : ""}`;
  return wordDetail("landed", "held", [file, `approved by ${by}`].filter(Boolean).join(" · "));
}

/** The branch of the run a case is about: the case's own run, or the open job of its item. */
function branchOf(c: Case): { repo: Repo; branch?: string } | null {
  if (!c.repo) return null;
  if (c.at === "run") {
    const runs = openJob(c.entry.run.name);
    const agent = runs?.findLast((e) => isAgentRun(e.run.role));
    return { repo: c.repo, branch: agent?.run.branch ?? c.entry.run.branch };
  }
  return null;
}

/** Why the case's run cannot land: the security path, held path or bun.lock its branch changes, or a branch that cannot be read; null when it may land. `held` are the repo's held globs to count besides bun.lock. */
function landRefusal(c: Case, held: string[]): string | null {
  const b = branchOf(c);
  const rule = b ? heldChange(b.repo, b.branch, held) : "unknown";
  return rule ? (rule === "unknown" ? "its branch cannot be read for security paths, so the land is the user's" : `it changes ${rule}, so the land is the user's`) : null;
}

/**
 * Why this Ask is on the escalation list, or null when the director may decide it. Fixed rules, not the model's
 * judgement: a change to a core note, an after link to a dropped issue, a land of a run that changes a security path, a path the repo holds or bun.lock (or a held run whose branch
 * cannot be read), and a second run-cap or rescue Ask on an issue the director already
 * decided once. Closing or dropping an issue the user filed is refused per action (`userOwns`).
 */
function escalation(c: Case, rec: Decision[] = readRecord()): { why: string; file?: string } | null {
  const why = ASK_REASONS[reasonName(c)]?.userOnly;
  if (why) return { why };
  if (ONCE_PER_ISSUE.includes(c.ask.reason) && rec.some((d) => d.ref === refOf(c) && d.reason === c.ask.reason && d.outcome === "decided"))
    return { why: `the director already decided a ${c.ask.reason} Ask on ${refOf(c)}; the second goes to the user` };
  const b = actionsOf(c).includes("approve") ? branchOf(c) : null;
  if (b) {
    const held = heldChange(b.repo, b.branch);
    if (held === "unknown" && c.ask.reason === "held-path") return { why: "the held run's branch cannot be read for security paths, so its land is the user's" };
    if (held && held !== "unknown") return { why: `the run changes ${held}, so its land is the user's`, file: held };
  }
  return null;
}

/** Whether closing or dropping this issue is the user's: they filed it. */
const userOwns = (item: issues.Issue): boolean => issues.sourceOf(item) === "user";

const clip = (s: string) => (s.length > MAX_FILE ? `…${s.slice(-MAX_FILE)}` : s);

/** The review of a run: the result.md of the newest review job whose `prev` is the run, as the Jobs route shows it. */
function reviewOf(e: Entry): string | null {
  const r = allRuns().findLast((x) => x.run.role === "review" && x.run.prev === e.id);
  const text = r && readFile(r, "result.md");
  return text ? clip(text) : null;
}

/** `git diff --stat` of the run's branch against its repo's main, or why there is none. */
function diffStat(repo: Repo | undefined, run: Run): string {
  if (!repo || !run.branch) return "(no branch)";
  if (!existsSync(repo.path)) return "(the repo is not readable)";
  const d = ofBranch(repo, run.branch);
  return d ? d.stat.trim() || "(no change)" : "(the branch is not readable)";
}

const section = (title: string, body: string | null | undefined): string => (body && body.trim() ? `\n## ${title}\n\n${body.trim()}\n` : "");

/** The case as prompt text: the Ask, its item and its run. */
function caseText(c: Case): string {
  const reason = reasonOf(c.ask.reason);
  const r = ASK_REASONS[reason];
  const item = c.item;
  const run = c.at === "run" ? c.entry : undefined;
  const where = c.at === "item" ? `the item ${c.on}` : `the run ${c.on}${run!.run.target ? ` on ${run!.run.target}` : ""}`;
  return `# The Ask on ${where}

Reason: ${reason}${r.needs ? ` (a ${r.needs} wait)` : ""}
On: ${c.at === "run" ? `a run of the job ${run!.run.name}` : "an issue"}${c.ask.options.length ? ", a decision with options" : ""}
Actions on the user's card: ${actionsOf(c).join(", ")}
Question: ${c.ask.question || "(none)"}
${c.ask.options.length ? `Options:\n${c.ask.options.map((o) => `- ${o.label}: ${o.line}${o.after ? ` (waits for ${o.after})` : ""}`).join("\n")}\n` : ""}${c.ask.recommended ? `Recommended option: ${c.ask.recommended}\n` : ""}${c.ask.why.length ? `Why:\n${c.ask.why.map((w) => `- ${w}`).join("\n")}\n` : ""}${item ? `
# Item ${c.at === "item" ? c.on : run!.run.target}: ${item.title} (filed by ${issues.sourceOf(item)})
${section("Request", item.request)}${section("Spec", item.spec)}${section("Notes", item.notes.join("\n"))}` : ""}${run ? `
# The run ${c.on}
${run.run.branch ? `\nBranch: ${run.run.branch}\n` : ""}${run.run.reason ? `Reason it stopped: ${run.run.reason}\n` : ""}${section("Tail of prompt.md", tailOf(run, "prompt.md", TAIL))}${section("Tail of result.md", tailOf(run, "result.md", TAIL))}${section("The review of the run", reviewOf(run))}${section("Tail of the checks log", tailOf(run, "checks", TAIL))}${section("git diff --stat of its branch", diffStat(c.repo, run.run))}` : ""}`;
}

const CASE_TEXT = (acts: string[]): string => `The case text is "case": its "headline" is a noun phrase of at most ${LIMITS.headline} words, lowercase first, that names what the card is about, as in: the TypeScript 5.9 to 7.0 upgrade. Its "situation" is plain sentences: what this work is, what stopped it, why only the user can answer, and the risk. Its "effects" has one entry for each action (${acts.join(", ")}): the "action" and a "text" of 1 or 2 short sentences that says what happens in this case if the user takes it. Its "recommend" is an action and a one-sentence "why", or null. Its "details", optional, holds risks, gaps and technical facts.`;

/** The past decisions the prompt shows: the last RECORD_LINES, each with its outcome. */
const pastLines = (rec: Decision[]): string =>
  rec.slice(-RECORD_LINES).map((d) => `- ${d.at.slice(0, 16)} ${d.ref} (${d.reason}): ${d.outcome}${d.why ? ` (${d.why})` : ""}${d.applied.length ? `; did ${d.applied.join("; ")}` : ""}${d.refused.length ? `; refused ${d.refused.join("; ")}` : ""}`).join("\n") || "(none yet)";

function prompt(c: Case, escalated: string | null, rec: Decision[] = readRecord()): string {
  const acts = actionsOf(c);
  const head = `You are the factory's director. Every Ask, a stop where the factory would wait for the user, comes to you first. You decide it as the user would, on your own judgement, or you escalate it to the user with your recommendation. You have read-only tools: Read, Grep, Glob, and Bash for \`git status|log|show|diff|ls-files\`, \`ls\`, \`aleph jobs\` and \`aleph issue show|list\`. Change nothing yourself: you propose actions, and the code checks and applies them. Your working directory is the repo${c.repo ? ` ${c.repo.key}` : ""}.

What informs your judgement: your past decisions with their outcomes below. A case with no precedent is still yours to decide. Read the files the case names before you write about them.`;
  const reply = `# Your reply

Text over a limit moves to "details" by sentence: "headline" is at most ${LIMITS.headline} words, "situation" at most ${LIMITS.situation.words} words, and each effect "text" at most ${LIMITS.choice.words} words. Write for the user in short plain sentences, with no file paths in "headline", "situation" or the effects: paths go in "details". "details" holds only risks, gaps and the technical facts (paths, commits, rules), not a second summary. Give one effect for each of these actions, with exactly this "action": ${acts.join(", ")}. State only what you read; where you did not read something, say "I did not check X". "recommend" is null when you cannot tell.`;
  if (escalated) {
    return `${head}
This Ask is on the escalation list: ${escalated}. The user decides it. Take no action. Write the case text they read on its card, with your recommendation.

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

- Decide when you can: answer the question, rerun the issue, drop the run, edit the spec or the issue, or file a fix job. Escalate only when you cannot tell what the user would want, or when the choice costs the user something they have not decided before.
- Code refuses, whatever you reply: closing or dropping an issue the user filed; landing a run that changes a security path, a path the repo holds or bun.lock, or a held run before the reviewer gave a verdict; more than ${MAX_ACTIONS} actions.
- When a run cannot pass until another open issue lands, drop it or edit the issue with \`after\` set to that issue. A note alone does not stop a rerun. An \`after\` must name open issues: an \`after\` on a parked issue is refused.
- The \`## Goal\` of a spec you write is the behaviour in at most 3 sentences, with no implementation design and no claim about code on main that you did not read.
- A fix job is an \`add\` whose body has ## Goal, ## Edit surface and ## Oracle; set \`after\` on this issue with edit-issue when it must wait for the fix.
- Every reply has the case text. Add actions to decide; with no actions the Ask goes to the user. An Ask that your actions leave open goes to the user with your case text.

${caseText(c)}

# Your past decisions

${pastLines(rec)}

${reply}

Reply with "case" and "actions" to decide, or with "case" alone to send it to the user. ${CASE_TEXT(acts)}

Each action applies to this Ask's ${onRun ? "run and its item" : "item"}. Its "do" is one of these; an "after" lists issues as \`issue.<n>\`:
${onRun ? `- land: land the run's branch
- drop: a "reason" the next run reads, an optional "after", and an optional "fate"
- answer: a "note" that answers the worker's question; the job reruns with it
` : `- answer: a "note" with the decision, an optional "option" (an option's label) and an optional "after"
- rerun: an optional "note" that says why
- drop: drop the item's open job, with a "reason", an optional "after" and an optional "fate"
`}- close: mark the item done, with a "note" that says why the issue is already met on main
- drop-issue: a "reason" that says why nothing more runs for it
- edit-issue: an optional "body" with the new spec, and an optional "after" of the open issues it waits for
- add: the fix job's "title" and its spec as "body"
- note: a "text" to note on the item
`;
}

export type Action =
  | { do: "land" }
  | { do: "drop"; reason: string; after?: string[]; fate?: Fate }
  | { do: "answer"; note: string; option?: string; after?: string[] }
  | { do: "rerun"; note?: string }
  | { do: "close"; note: string }
  | { do: "drop-issue"; reason: string }
  | { do: "edit-issue"; body?: string; after?: string[] }
  | { do: "add"; title: string; body: string }
  | { do: "note"; text: string };

const nonEmpty = { type: "string", minLength: 1 };
const refList = { type: "array", items: { type: "string", pattern: ISSUE_KEY.source } };
const shape = (name: string, fields: Record<string, object> = {}, required: string[] = []) => ({
  type: "object", additionalProperties: false, required: ["do", ...required], properties: { do: { const: name }, ...fields },
});

/** The JSON schema of the director's reply: the case text, always, and `actions` to decide. */
export const DIRECTOR_SCHEMA = {
  type: "object", additionalProperties: false, required: ["case"],
  properties: {
    actions: {
      type: "array",
      items: {
        oneOf: [
          shape("land"),
          shape("drop", { reason: nonEmpty, after: refList, fate: { enum: ["met", "duplicate", "manual"] } }, ["reason"]),
          shape("answer", { note: nonEmpty, option: nonEmpty, after: refList }, ["note"]),
          shape("rerun", { note: nonEmpty }),
          shape("close", { note: nonEmpty }, ["note"]),
          shape("drop-issue", { reason: nonEmpty }, ["reason"]),
          shape("edit-issue", { body: nonEmpty, after: refList }),
          shape("add", { title: nonEmpty, body: nonEmpty }, ["title", "body"]),
          shape("note", { text: nonEmpty }, ["text"]),
        ],
      },
    },
    case: {
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
/** The issue keys (`issue.<n>`) in a string, a comma list or an array; any other value is ignored. */
const refs = (v: unknown): string[] | undefined => {
  const ok = (Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : []).map((x) => parseKey(str(x))).filter((k) => k?.kind === "issue").map((k) => key("issue", k!.n));
  return ok.length ? ok : undefined;
};

function parseAction(raw: any): Action | string {
  if (!raw || typeof raw !== "object") return "not an object";
  const f = (k: string) => str(raw[k]) || null;
  const after = refs(raw.after);
  const fate = (["duplicate", "met", "manual"] as const).find((x) => x === raw.fate);
  const w = { ...(after ? { after } : {}) };
  switch (raw.do) {
    case "land": return { do: "land" };
    case "drop": return f("reason") ? { do: "drop", reason: f("reason")!, ...w, ...(fate ? { fate } : {}) } : "drop without a reason";
    case "answer": return f("note") ? { do: "answer", note: f("note")!, ...(f("option") ? { option: f("option")! } : {}), ...w } : "answer without a note";
    case "rerun": return { do: "rerun", ...(f("note") ? { note: f("note")! } : {}) };
    case "close": return f("note") ? { do: "close", note: f("note")! } : "close without a note";
    case "drop-issue": return f("reason") ? { do: "drop-issue", reason: f("reason")! } : "drop-issue without a reason";
    case "edit-issue": return f("body") || after ? { do: "edit-issue", ...(f("body") ? { body: f("body")! } : {}), ...w } : "edit-issue without a body or after";
    case "add": return f("title") && f("body") ? { do: "add", title: f("title")!, body: f("body")! } : "add without a title and a body";
    case "note": return f("text") ? { do: "note", text: f("text")! } : "note without text";
    default: return `unknown action ${JSON.stringify(raw.do)}`;
  }
}

const describe = (a: Action): string =>
  a.do === "land" ? "land" : a.do === "drop" ? `drop: ${a.reason}${a.after ? ` (after ${a.after.join(", ")})` : ""}`
  : a.do === "answer" ? `answer: ${a.option ? `${a.option}: ` : ""}${a.note}${a.after ? ` (after ${a.after.join(", ")})` : ""}`
  : a.do === "rerun" ? `rerun${a.note ? `: ${a.note}` : ""}` : a.do === "close" ? `close: ${a.note}` : a.do === "drop-issue" ? `drop-issue: ${a.reason}`
  : a.do === "edit-issue" ? `edit-issue${a.body !== undefined ? " (spec)" : ""}${a.after ? ` (after ${a.after.join(", ")})` : ""}` : a.do === "add" ? `add: ${a.title}` : `note: ${a.text}`;

/** The case text in a raw object, or why it does not do. Text over a limit moves to `details` by whole sentences. */
function parseCaseText(raw: any, actions: string[]): Text | string {
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

export type Reply = { actions: (Action | string)[]; text: Text | string } | { escalate: Text | string };

/**
 * The reply in the run's structured output: the actions, each parsed or why not, with the case text; or the case text
 * alone, to escalate; a string when it is neither. The case text is the parsed text or why it does not do.
 */
export function parseReply(raw: any, actions: string[]): Reply | string {
  if (raw === undefined) return NO_OUTPUT;
  if (!raw || typeof raw !== "object") return "not an object";
  const text = parseCaseText(raw.case, actions);
  if (Array.isArray(raw.actions) && raw.actions.length) return { actions: raw.actions.map(parseAction), text };
  if (raw.case === undefined || raw.case === null) return "no case text and no actions";
  return { escalate: text };
}

const sameAsk = (a: Ask | null | undefined, b: Ask): boolean => !!a && reasonOf(a.reason) === reasonOf(b.reason) && a.question === b.question && !a.situation?.trim();

/** Whether the case's Ask is still the same one, with no case text. */
function stillOpen(c: Case): boolean {
  if (c.at === "item") {
    const item = store.reader().item(c.repo.key, idOf(c.item));
    return !!item && asking(item, askOf(c.on)) && sameAsk(askOf(c.on), c.ask);
  }
  const now = jobRecord.getRun(c.entry.id);
  return !!now && now.state === "waiting" && sameAsk(now.ask, c.ask);
}

/** Write the text on the Ask, when the Ask is still the same one. Whether it was written. */
function writeCaseText(c: Case, t: Text): boolean {
  if (c.at === "item") {
    const item = store.reader().item(c.repo.key, c.item.id);
    const now = askOf(c.on);
    if (!item || !asking(item, now) || !sameAsk(now, c.ask)) return false;
    setAsk(c.on, { ...now, ...t });
    return true;
  }
  const now = jobRecord.getRun(c.entry.id);
  if (!now || now.state !== "waiting" || !sameAsk(now.ask, c.ask)) return false;
  jobRecord.patchRun(c.entry.id, { ask: { ...now.ask!, ...t } });
  return true;
}

/** The case text when the director gave none that does: one sentence on why it reached the user. */
const fallback = (why: string): Text => ({ situation: `The director did not decide this Ask: ${why.replace(/\.$/, "")}.` });

/** How actions reach the factory; each returns the refusal, or null. Tests replace them. */
export interface Ports extends store.Effects {
  land: (name: string, lander: "director" | "rule") => Promise<string | null>;
  /** `answer` answers the run's Ask: who answered and the option taken. */
  drop: (name: string, reason: string, fate?: Fate, answer?: Answer) => Promise<string | null>;
  /** Starts a dispatch; a new spec starts its issue at once. */
  dispatch?: () => void;
}
const defaultPorts: Ports = {
  land: (name, lander) => refusal(async () => { await (await landJob(name, { lander }, { output: "ignore" })).child?.exited; }),
  drop: (name, reason, fate, answer) => refusal(() => dropJob(name, { reason, quiet: true, fate, answer })),
  dispatch: dispatchDetached,
  after: afterFiling,
};

/** The result of one action: applied (whether it decides the Ask, and its log event), or refused. */
type Outcome = { applied: string; decides: boolean; ev: Ev } | { refused: string };

const done = (a: Action, ev: Ev, decides = true): Outcome => ({ applied: describe(a), decides, ev });
const no = (a: Action, why: string): Outcome => ({ refused: `${describe(a)}: ${why}` });

/** The first ref of an `after` list that names a parked issue, or null: an issue that waits for one never starts. */
function parkedIn(after: string[]): string | null {
  const parked = new Set(store.everyFetched().filter((x) => issues.status(x.item) === "parked").map((x) => key("issue", x.item.id)));
  return after.find((r) => parked.has(r)) ?? null;
}

/** The open job of the case: its own run's job, else the open job of its item. */
function jobOf(c: Case, n: number | string | undefined): string | undefined {
  if (c.at === "run") return c.entry.run.name;
  return openJobOfIssue(c.repo.key, n)?.[0].run.name;
}

/** Check one action against the rules and apply it, for the case's Ask only. `by` answers the Ask: the director, or `rule` for an Always rule. */
async function applyOne(c: Case, a: Action, ports: Ports, by: "director" | "rule" = "director"): Promise<Outcome> {
  const repo = c.repo;
  const sub = askSub(c.ask.reason);
  if (!repo) return no(a, "the Ask is not in a factory repo");
  const after = a.do === "drop" || a.do === "answer" || a.do === "edit-issue" ? a.after : undefined;
  const parked = after ? parkedIn(after) : null;
  if (parked) return no(a, `${parked} is parked, so an after on it is refused`);
  const item0 = c.item;
  const n = item0 ? idOf(item0) : undefined;
  const item = n !== undefined ? store.reader().item(repo.key, n) ?? undefined : undefined;
  if (a.do === "land") {
    if (c.at !== "run") return no(a, "the Ask is not on a run");
    const held = landRefusal(c, repo.held);
    if (held) return no(a, held);
    // A run held for a path the repo holds lands once the reviewer gave a verdict; a review Ask is the director's call over the reviewer's hold.
    if (c.ask.reason === "held-path") {
      const runs = openJob(c.entry.run.name);
      const agent = runs?.findLast((e) => isAgentRun(e.run.role)) ?? c.entry;
      const missing = missingVerdict(readFile(agent, "review.json"));
      if (missing) return no(a, missing);
    }
    // The held files are read before the land: once the branch is on main, its diff is empty.
    const ev = c.ask.reason === "held-path" ? { action: "landed", note: heldLand(c, "the director") } : { action: "landed", sub: c.ask.reason === "review-held" ? "override" : sub };
    const why = await ports.land(c.entry.run.name, by);
    return why ? no(a, why) : done(a, ev);
  }
  if (a.do === "drop" || (a.do === "answer" && c.at === "run")) {
    const name = jobOf(c, n);
    if (!name || !openJob(name)) return no(a, "no open job to drop");
    const runs = openJob(name)!;
    const last = jobRecord.counting(runs);
    const issue = issueOf(runs);
    let reason: string, fate: Fate | undefined, answer: Answer | undefined;
    if (a.do === "answer") {
      reason = `The director answered the worker's question "${c.ask.question}": ${a.note}`;
      answer = { subject: by, answer: a.option ?? actionsOn(reasonOf(c.ask.reason))[0] };
    } else {
      reason = a.reason;
      // The reply may leave the fate off: an issue whose own commit is on origin/main is met; a reason naming another issue already on main is work that issue did.
      const other = idsIn(a.reason).filter((r) => r.startsWith(`${repo.key}-`)).map((r) => r.slice(repo.key.length + 1)).find((x) => x !== String(issue) && itemOnMain(repo, x));
      fate = a.fate ?? (onMain(repo, { jobs: jobOfRun(last.id).map((e) => e.id), item: issue, fetch: false }) ? "met" : other ? "duplicate" : undefined);
    }
    const why = await ports.drop(name, reason, fate, answer);
    if (why) return no(a, why);
    writeRerun(name, a.do === "answer" ? reason : `The last run was dropped by the director: ${reason}`);
    const waits = a.do === "drop" && a.after && issue !== undefined ? await refusal(async () => verbs.edit(repo, issue, { after: a.after })) : null;
    if (issue !== undefined) store.note(repo, issue, `director: dropped ${name}: ${reason}${a.do === "drop" && a.after ? `; after ${a.after.join(", ")}` : ""}`);
    // A run's Ask goes with its run; an item's Ask stays when its job is dropped.
    const ev: Ev = a.do === "answer" ? { action: "answered", sub, note: a.note }
      : { action: "dropped", sub: fate ?? sub, on: fate === "duplicate" ? idsIn(a.reason).filter((x) => x !== issueId(repo.key, issue!)) : undefined, note: a.reason };
    return waits ? no(a, `dropped, but after not set: ${waits}`) : done(a, ev, c.at === "run");
  }
  if (!item || issues.status(item) !== "open") return no(a, `no open issue ${c.at === "run" ? c.entry.run.target ?? "for the run" : c.on}`);
  const id = issueId(repo.key, n!);
  if (a.do === "note") {
    const why = store.note(repo, n!, `director: ${a.text}`);
    return why ? no(a, why) : done(a, { note: a.text }, false);
  }
  if (a.do === "add") {
    const missing = missingSections(a.body);
    if (missing.length) return no(a, `the body lacks ${missing.map((h) => `## ${h}`).join(", ")}`);
    const title = issues.titleProblem(a.title) ? cutTitle(a.title) : a.title;
    const w = store.writeFiling(repo, `todo: a fix job for ${id}`, "director", ports, (_, file) => file({ title, spec: a.body, source: "agent" }).id);
    if (!w) return no(a, "no issue written");
    store.note(repo, n!, `director: filed ${issueId(repo.key, w.value)} as a fix job: ${title}`);
    // The filing logged `filed` on the new issue; this event is a note on the Ask's.
    return { applied: `${describe(a)} (${issueId(repo.key, w.value)})`, decides: false, ev: { note: `filed ${issueId(repo.key, w.value)}: ${title}` } };
  }
  if (a.do === "close" || a.do === "drop-issue") {
    if (userOwns(item)) return no(a, `${id} was filed by the user, so closing or dropping it is theirs`);
    // The close answers the Ask: a drop with the reason's second verb, a close with its first.
    const answer = { subject: by, answer: actionsOn(reasonOf(c.ask.reason))[a.do === "drop-issue" ? 1 : 0] };
    if (a.do === "drop-issue") {
      const open = jobOf(c, n);
      if (open) { const why = await ports.drop(open, `dropped by the director: ${a.reason}`, undefined, answer); if (why) return no(a, why); }
      const why = await refusal(async () => answering(refIn(item), answer, () => verbs.close(repo, n!, "drop", `director: dropped: ${a.reason}`)));
      return why ? no(a, why) : done(a, { action: "dropped", sub, note: a.reason });
    }
    const open = jobOf(c, n);
    if (open) { const why = await ports.drop(open, `closed by the director: ${a.note}`, "met", answer); if (why) return no(a, why); }
    const why = answering(refIn(item), answer, () => store.close(repo, n!, `director: closed: ${a.note}`, "done", "director"));
    return why ? no(a, why) : done(a, { action: "done", sub, note: a.note });
  }
  if (a.do === "answer" || a.do === "rerun") {
    const ask = askOfItem(item);
    const waiting = allJobs().find((j) => isOpen(j) && j[0].run.repo === repo.key && issueOf(j) === n && waitsForSpecEdit(jobRecord.counting(j)));
    const refused = may("director", "answer", ask, waiting ? { waiting: waiting[0].run.name } : {});
    if (refused) return no(a, refused);
    const option = a.do === "answer" && a.option ? ask?.options.find((o) => o.label === a.option) : undefined;
    if (a.do === "answer" && a.option && !option) return no(a, `the Ask has no option ${a.option}`);
    const said = a.do === "rerun" ? `director: run it again${a.note ? `: ${a.note}` : ""}` : `director decided: ${option ? `${option.label}: ${option.line}. ` : ""}${a.note}`;
    // On the part-dropped Ask, any answer but the plan option closes the issue.
    if (ask?.reason === "part-dropped" && !keepsOpen(said) && userOwns(item)) return no(a, `${id} was filed by the user, and this answer closes it`);
    const after = a.do === "answer" ? a.after ?? (option?.after ? [option.after] : undefined) : undefined;
    const why = await refusal(async () => verbs.decide(repo, n!, said, after ? { after } : {}, by, option?.label));
    return why ? no(a, why) : done(a, { action: a.do === "rerun" ? "reran" : "answered", sub, note: a.do === "rerun" ? a.note : option ? `${option.label}: ${a.note}` : a.note });
  }
  // edit-issue
  const list = store.reader().list(repo.key);
  if (list && issues.partsOf(list, item).length) return no(a, "it has parts");
  const why = await refusal(async () => verbs.edit(repo, n!, { ...(a.body !== undefined ? { spec: a.body } : {}), ...(a.after ? { after: a.after } : {}) }));
  if (!why && a.body !== undefined) ports.dispatch?.();
  return why ? no(a, why) : done(a, { action: "changed", sub, on: a.after, note: a.body !== undefined ? "the spec" : undefined }, false);
}

/** Apply the reply's actions for the case in order, at most MAX_ACTIONS. Whether one of them decided the Ask. */
export async function applyActions(c: Case, actions: (Action | string)[], ports: Ports = defaultPorts): Promise<{ applied: string[]; refused: string[]; decided: boolean; events: Ev[] }> {
  const out = { applied: [] as string[], refused: [] as string[], decided: false, events: [] as Ev[] };
  for (const [i, a] of actions.entries()) {
    let o: Outcome;
    if (i >= MAX_ACTIONS) o = { refused: `${typeof a === "string" ? a : describe(a)}: more than ${MAX_ACTIONS} actions in one run` };
    else if (typeof a === "string") o = { refused: `a malformed action: ${a}` };
    else {
      try { o = await applyOne(c, a, ports); } catch (e) { o = { refused: `${describe(a)}: ${errText(e)}` }; }
    }
    if ("applied" in o) { out.applied.push(o.applied); out.decided ||= o.decides; out.events.push(o.ev); } else out.refused.push(o.refused);
  }
  return out;
}

// One run per Ask.

const lockName = (on: string) => `director-${on}`;
/** What the case's director run works on, and the record that keeps it: a run's issue, else the case's `on`. */
export const subjectOfCase = (c: Case): string => (c.at === "run" ? c.entry.run.target ?? c.on : c.on);
const lockOf = (run: Run): string | null => (run.target ? lockName(run.target) : null);

/** Send the Ask to the user: the case text (the director's, else the fallback) on it, and the record. `ev` sets the event's sub and file. */
function escalate(c: Case, base: Omit<Decision, "outcome">, text: Text | string | undefined, why: string, ev: Pick<Ev, "sub" | "file"> = {}): Decision {
  const t = text && typeof text !== "string" ? text : fallback(typeof text === "string" ? `${why}; its case text had ${text}` : why);
  if (!writeCaseText(c, t) && stillOpen(c)) logEvent({ subject: "director", action: "failed", object: base.ref, detail: "the case text was not written" });
  const d: Decision = { ...base, outcome: "escalated", why };
  record(d, [{ action: "escalated", sub: askSub(base.reason), ...ev, note: why }]);
  return d;
}

/** One director run on one Ask: it decides or escalates. The decision, or null when another run holds the Ask. */
async function direct(c: Case, ports: Ports = defaultPorts): Promise<Decision | null> {
  const release = await lock(lockName(subjectOfCase(c)), 0);
  if (!release) return null;
  try {
    const rec = readRecord();
    const base = { at: new Date().toISOString(), ref: refOf(c), on: c.on, reason: reasonName(c), question: questionOf(c), applied: [] as string[], refused: [] as string[] };
    // An Always rule granted `user` for the reason sends the Ask to the user with no run.
    const granted = always(base.reason, c.repo?.key)?.action;
    if (granted === "user") return escalate(c, base, undefined, "a rule sends this Ask to the user");
    // An Always rule granted the reason's first verb takes it with no run, and logs it as a rule event. `resolve` needs the Ask's recommended option; an Ask with none goes on to the director.
    if (FIRST_VERB.includes(base.reason) && granted === ASK_REASONS[base.reason].always && (granted !== "resolve" || c.ask.recommended)) {
      const ref = c.at === "item" ? issueId(c.repo.key, idOf(c.item)) : c.entry.run.name;
      let why: string | null;
      // A held-path Always lands a run that changes only the repo's held paths; a security path, bun.lock or a branch it cannot read stays the user's. A review-held run lands through the land action, which refuses the repo's held paths too.
      const held = granted === "approve" && base.reason === "held-path" ? landRefusal(c, []) : null;
      const detail = granted === "approve" && base.reason === "held-path" ? heldLand(c, "Always") : undefined;
      if (held) why = held;
      else if (granted === "approve" && base.reason !== "review-held") why = base.reason === "core-change" ? await answerHeld(ref, true, "rule") : await ports.land(ref, "rule");
      else { const o = await applyOne(c, granted === "approve" ? { do: "land" } : granted === "continue" ? { do: "rerun" } : { do: "answer", option: c.ask.recommended, note: "the recommended answer" }, ports, "rule"); why = "refused" in o ? o.refused : null; }
      if (why) return escalate(c, base, undefined, `a rule's ${granted} was refused: ${why}`);
      // The answer logs its own `answered`, by `rule`, as it clears the Ask.
      if (granted === "continue") logAlways(base.reason, base.ref, "reran");
      else if (granted === "approve" && c.at === "run") logAlways(base.reason, base.ref, "landed", detail ? { detail } : {});
      return { ...base, outcome: "decided", applied: [granted] };
    }
    // One run per Ask: an Ask the director escalated before, whose case text was not written, goes to the user with no second run.
    if (escalatedBefore(c, rec)) return escalate(c, base, undefined, "the director escalated this Ask before");
    const listed = escalation(c, rec);
    const cwd = c.repo && existsSync(c.repo.path) ? c.repo.path : undefined;
    const run = openRun({
      role: "director", who: "the director", model: DIRECTOR_MODEL(), seconds: SECONDS,
      flags: ["--tools", "Read,Grep,Glob,Bash", "--allowedTools", ALLOWED.join(",")], schema: DIRECTOR_SCHEMA,
      cwd, name: `director-${c.on}`, command: `director ${c.on}: ${reasonName(c)}: ${questionOf(c)}`, shown: true, target: subjectOfCase(c),
    });
    jobRecord.patchRun(run.id, { question: questionOf(c) });
    const at = { ...base, run: run.id };
    let reply: Reply | string;
    // An Ask listed for a held path is the sub `protected`, with the path.
    const held = listed?.file ? { sub: "protected", file: listed.file } : {};
    try { reply = parseReply(await run.askData(prompt(c, listed?.why ?? null, rec)), actionsOf(c)); } catch (e) {
      run.end(`failed: ${errText(e)}`);
      return escalate(c, at, undefined, `its run failed: ${errText(e)}`, { sub: "error" });
    }
    if (typeof reply === "string") { run.end(`malformed reply: ${reply}`); return escalate(c, at, undefined, `its reply was malformed: ${reply}`, { sub: "error" }); }
    if ("escalate" in reply) {
      run.end("escalated");
      return escalate(c, at, reply.escalate, listed?.why ?? "the director did not decide", held);
    }
    if (listed) {
      run.end("escalated: the Ask is on the escalation list");
      return escalate(c, { ...at, refused: reply.actions.map((a) => `${typeof a === "string" ? a : describe(a)}: the Ask is on the escalation list`) }, reply.text, listed?.why ?? "the director did not decide", held);
    }
    const r = await applyActions(c, reply.actions, ports);
    const decided = r.decided || !stillOpen(c);
    run.end(`${r.applied.length} applied, ${r.refused.length} refused, ${decided ? "decided" : "escalated"}`);
    if (!decided) {
      const did = `It did: ${r.applied.join("; ") || "nothing"}. It could not: ${r.refused.join("; ") || "nothing"}.`;
      const text = typeof reply.text === "string" ? reply.text : { ...reply.text, details: [did, reply.text.details].filter(Boolean).join(" ") };
      return escalate(c, { ...at, applied: r.applied, refused: r.refused }, text, r.refused.length ? `its actions left the Ask open (refused: ${r.refused.join("; ")})` : "its actions left the Ask open");
    }
    const d: Decision = { ...at, outcome: "decided", applied: r.applied, refused: r.refused };
    // A decision whose effect has not cleared the Ask yet (a land still running, say) still ends this Ask's one run: the user sees it with the text.
    // A land runs in its own unit and settles the Ask when it ends, so a started land leaves no text: a failed land raises its own Ask.
    if (!r.applied.includes("land") && stillOpen(c)) writeCaseText(c, { situation: `The director decided: ${r.applied.join("; ")}. The Ask is still open, so it is with you.` });
    record(d, r.events);
    return d;
  } finally {
    release();
  }
}

/**
 * The director's sweep: one run for each Ask with no case text, at most `ALEPH_DIRECTOR_CAP` a tick, all at once.
 * An error is logged, never thrown. With the director off it runs none, and each Ask waits with the user.
 */
export async function directAll(repos: Repo[] = sandboxRepos(), ports: Ports = defaultPorts): Promise<Decision[]> {
  if (!readModels().director.enabled) return [];
  try {
    await endLost("director", lockOf, "its decision");
    const todo = pendingCases(repos).slice(0, Math.max(0, DIRECTOR_CAP()));
    const out = await Promise.all(todo.map((c) => direct(c, ports).catch((e) => { logEvent({ subject: "director", action: "failed", object: refOf(c), detail: errText(e) }); return null; })));
    return out.filter((d): d is Decision => !!d);
  } catch (e) {
    logEvent({ subject: "director", action: "failed", object: "director", detail: errText(e) });
    return [];
  }
}
