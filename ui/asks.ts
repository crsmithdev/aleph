/**
 * What the Awaiting-you rows say and offer (the `asks` of /api/state). The server decides from the Ask's reason and the item's data;
 * the page only renders. One entry per run, issue or goal that waits for Chris, and per proposal.
 */
import { place, proposals as openProposals, standingKey, type Lesson } from "../jobs/lib/corrections.ts";
import type { Decision } from "../jobs/lib/decision.ts";
import { ASK_REASONS, type Granted } from "../jobs/lib/always.ts";
// @ts-ignore plain JS, shared with the page
import { oneSentence } from "./views/now.js";
// @ts-ignore plain JS, shared with the page
import { proseDecision } from "./decision.js";
import type { Job, NewIssue } from "./state.ts";

export interface Action { act: string; label: string; hint: string; primary: boolean; args: Record<string, string> }
export interface AskItem {
  key: string; reason: string; /** What the answer is: your input or your approval. */ kind: "input" | "approval"; id: string; href: string; title: string; problem: string;
  actions: Action[]; always?: { label: string; action: string; hint: string; reason?: string }; details: Details;
  /** The project key, for `?project=`. */
  repo?: string;
  /** An awaiting run: a live run exists for it, the trailers the land will write, its defaults and follow-ups. */
  /** An awaiting run: the goal or issue it is on. */ on?: string;
  agent?: boolean; trailers?: { key: string; value: string }[]; defaults?: string[]; followups?: string[];
}
export interface Details {
  note?: string; stat?: string; review?: { call: string; reason?: string };
  ask?: Decision; signals?: { source: string; at: string; quote: string; link: string }[];
}
export type Always = Record<string, Granted>;

/** Reasons whose answer is an approval; every other reason takes input. */
const APPROVAL = ["held-path", "review", "proposal", "firefighter"];

/** The kind of an Ask: the ask's own, else from its reason. */
export function kindOf(reason: string, given?: string): "input" | "approval" {
  if (given === "input" || given === "approval") return given;
  return APPROVAL.includes(reason) || reason.startsWith("proposal-") ? "approval" : "input";
}

const STAMP = /^\s*\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?:\s*/;
/** A note without its optional leading timestamp and its `needs-chris:` lead. */
const unlead = (s: string): string => s.replace(/^\s*-\s*/, "").replace(STAMP, "").replace(/^\s*needs-chris:\s*/i, "");

/** The Ask reason of an issue or goal: its own `reason`, else read from the last note of an old item. */
export function issueReason(i: Pick<NewIssue, "reason" | "question" | "decision">): string {
  if (i.reason && ASK_REASONS[i.reason]) return i.reason;
  if (i.reason === "triage-no-verdict") return "triage-failed";
  if (i.reason === "held") return "held-path";
  const n = unlead(i.question ?? "");
  if (/^triage: no verdict in/.test(n)) return "triage-failed";
  if (/^acceptance: fail again/.test(n)) return "acceptance-failed";
  if (/ended with no commit, so the factory stopped/.test(n)) return "no-commit";
  if (/times in the last hour; it stops starting it/.test(n)) return "run-cap";
  if (/^triage: a live check/.test(n)) return "host-check";
  if (/a held security path/.test(n)) return "firefighter";
  return i.decision && i.reason === "rescue" ? "rescue" : "question";
}

/** A plain sentence from a raw note: no tags, no leads, no paths. */
export function clean(text: unknown): string {
  const t = String(text ?? "")
    .replace(/<(task-notification|agent-message)\b[\s\S]*?(<\/\1>|$)/g, " ")
    .replace(/<[^>]*>/g, " ").replace(/[<>]/g, " ")
    .replace(/^\s*-\s*/, "").replace(STAMP, "").replace(/^\s*needs-chris:\s*/i, "").replace(/^\s*triage: (for Chris|a live check):\s*/i, "")
    .replace(/\s+/g, " ").trim();
  return oneSentence(t);
}
const sentence = (s: string) => (/[.?!]$/.test(s) ? s : `${s}.`);

type Ctx = { id: string; run?: Job; issue?: NewIssue; lesson?: Lesson };

const failure = (note: string): string => {
  const m = /^triage: no verdict in \d+ runs?:\s*(.*)$/.exec(unlead(note));
  const why = (m?.[1] ?? "").trim();
  if (/^malformed verdict/.test(why)) return "it gave a verdict that could not be read";
  return clean(why.replace(/^failed:\s*/, "")).replace(/\.$/, "") || "it gave no verdict";
};

const PROBLEM: Record<string, (c: Ctx) => string> = {
  "held-path": (c) => `The run for ${c.id} changes a path the repo holds for your review, so the factory did not land it.`,
  review: (c) => {
    const r = c.run?.reviewCall;
    if (r?.call === "back") return `The reviewer sent ${c.id} back twice${r.reason ? `: ${clean(r.reason).replace(/\.$/, "")}` : ""}.`;
    if (r?.call === "ask") return `The reviewer left ${c.id} to you${r.reason ? `: ${clean(r.reason).replace(/\.$/, "")}` : ""}.`;
    const back = /^the reviewer sent it back twice:\s*(.*)$/s.exec(c.run?.reason ?? "");
    if (back) return `The reviewer sent ${c.id} back twice: ${clean(back[1]).replace(/\.$/, "")}.`;
    return `The reviewer could not reach a verdict on ${c.id} in two tries.`;
  },
  question: (c) => c.run ? `The worker on ${c.id} asked: ${clean(c.run.question) || "it needs an answer"}` : sentence(clean(c.issue?.decision?.question ?? c.issue?.question) || "Your answer is needed"),
  manual: (c) => `The manual check of ${c.id} must be run by you, on the host.`,
  "part-dropped": (c) => `A goal of ${c.id} was dropped and no other goal of it is open.`,
  "no-commit": (c) => `The last 3 runs of ${c.id} ended with no commit, so the factory stopped starting it.`,
  "run-cap": (c) => `The factory started ${c.id} 3 times in one hour, so it stopped starting it until you run it again.`,
  "triage-failed": (c) => `Triage of ${c.id} failed twice: ${failure(c.issue?.question ?? "")}, so no one has decided what to do with this issue.`,
  "acceptance-failed": (c) => `The Oracle of ${c.id} still fails on main after a rerun.`,
  rescue: (c) => sentence(clean(c.issue?.decision?.question ?? c.issue?.question) || "Your answer is needed"),
  proposal: () => "This work is a proposal, and it does not start until you approve it.",
  "host-check": () => "A factory sandbox cannot run this check, so it must run on the host.",
  firefighter: (c) => {
    const note = unlead(String(c.issue?.question ?? ""));
    const m = /^(\S+) changes (\S+?),? a held security path/.exec(note);
    return m ? `The firefighter would land ${c.id}, but it changes ${m[2]}, a held security path, so it needs your review.`
      : `The firefighter would land ${c.id}, but it changes a held security path, so it needs your review.`;
  },
};
/** What a proposal changes and where, in the words of its buttons and hints. */
function words(l: Lesson | undefined) {
  const kind = l?.kind ?? "skill";
  const p = place(kind, l?.target);
  if (kind === "claude-md") {
    const f = p ? `${p} CLAUDE.md` : "CLAUDE.md";
    return { problem: `a line in ${f}`, approve: `Add a line to ${f}`, decline: "Leave CLAUDE.md unchanged", hint: `adds the line to ${f}`, every: `proposed addition to ${f}` };
  }
  if (kind === "skill") {
    const s = p ? `the ${p} skill` : "the skill";
    return { problem: p ? `a change to ${s}` : "a skill change", approve: `Change ${s}`, decline: `Leave ${s} unchanged`, hint: `changes ${s}`, every: `proposed change to ${s}` };
  }
  const r = p ? p : "the repo";
  return { problem: `a check for ${r}`, approve: `Add a check to ${r}`, decline: "Add no check", hint: `adds the check to ${r}`, every: `proposed check for ${r}` };
}
for (const k of ["check", "claude-md", "skill"]) PROBLEM[`proposal-${k}`] = (c) => `The correction memory proposes ${words(c.lesson).problem}: ${clean(c.lesson?.sentence).replace(/\.$/, "")}.`;

function actionsFor(reason: string, c: Ctx): Action[] {
  const run: Record<string, string> = c.run ? { name: c.run.name } : {};
  const [repo, n] = c.issue ? c.id.split(/-(?=\d+(?:\.\d+)?$)/) : ["", ""];
  const issue = { repo, id: n };
  const a = (act: string, label: string, hint: string, args: Record<string, string>): Action => ({ act, label, hint, primary: false, args });
  const one = (act: string): Action[] => {
    switch (act) {
      case "land": return [a("land", "Land it", c.run ? "Merges the run's branch into main." : "Lands the held run's branch on main.", run)];
      case "drop":
        return c.run ? [a("drop", "Drop the job", "Discards the run's branch; the issue stays open.", run)]
          : [a("drop", "Drop the issue", "Marks the issue dropped; nothing more runs for it.", issue)];
      case "rerun": return [a("rerun", "Run it again", "Clears the label and lets the factory start the goal again.", issue)];
      case "retry": return [a("retriage", "Run triage again", "Removes the label; the next tick triages the issue again.", issue)];
      case "close": return [a("close", "Close the issue", "Marks the issue dropped; nothing more runs for it.", issue)];
      case "deny":
        if (reason === "proposal") return [a("deny", "Drop the proposal", "Marks the issue dropped; the work does not start.", issue)];
        if (reason === "host-check") return [a("deny", "Drop the check", "Marks the issue dropped; no one runs the check.", issue)];
        return [a("deny", "Deny", "Records your refusal on the issue and closes the question.", issue)];
      case "start": return [a("decide", "Start the work", "Makes the issue a goal, and the factory starts it.", { ...issue, approve: "true" })];
      case "checked": return [a("checked", "Mark it checked", "Closes the issue as done; use this after the check has run.", issue)];
      case "approve":
        if (c.lesson) { const w = words(c.lesson); return [a("approve", w.approve, `Files the goal that ${w.hint}.`, { id: c.id })]; }
        return [a("approve", "File the goal", "Files the proposal as a goal for the factory.", { id: c.id })];
      case "decline":
        if (c.lesson) return [a("decline", words(c.lesson).decline, "Drops the proposal; the memory does not propose this lesson again.", { id: c.id })];
        return [a("decline", "Never propose this", "Drops the proposal and stops the memory proposing it again.", { id: c.id })];
      case "decide": {
        const d = c.issue?.decision;
        if (d) return [...d.options].sort((x, y) => +(y.label === d.recommended) - +(x.label === d.recommended))
          .map((o) => a("decide", `Approve ${o.label}`, o.line || "Records this choice on the issue and lets the factory act on it.", { ...issue, option: o.label }));
        if (proseDecision(c.issue?.question).recommendation) return [a("decide", "Approve recommendation", "Records the recommended choice on the issue, and the factory acts on it.", { ...issue, recommendation: "true" })];
        return [a("decide", "Approve it", "Records your approval on the issue, and the factory starts it.", { ...issue, approve: "true" })];
      }
      default: return [];
    }
  };
  // One reason serves a worker's question (a run) and an issue's (a decision): the context picks the actions.
  const names = reason === "question" ? (c.run ? ["answer", "drop"] : ["decide", "deny"])
    : reason === "part-dropped" ? (c.issue?.decision ? ["decide", "close"] : ["rerun", "close"])
    : ASK_REASONS[reason].actions;
  const acts = [...new Set(names)].flatMap((n) => n === "answer" ? [a("answer", "Answer and rerun", "Takes your answer and starts the job again with it.", run)] : one(n));
  if (acts[0]) acts[0].primary = true;
  return acts;
}

function detailsFor(c: Ctx): Details {
  const d: Details = {};
  if (c.run) {
    const note = c.run.reason ?? c.run.question;
    if (note) d.note = note;
    if (c.run.stat) d.stat = c.run.stat;
    if (c.run.reviewCall) d.review = c.run.reviewCall;
  }
  if (c.issue) {
    if (c.issue.question) d.note = c.issue.question;
    if (c.issue.decision) d.ask = c.issue.decision;
  }
  if (c.lesson) d.signals = c.lesson.signals.map(({ source, at, quote, link }) => ({ source, at, quote, link }));
  return d;
}

/** The auto-yes choice: the first choice's label with the mark, and a hint that names the rule it grants. No rule, no choice. */
function alwaysFor(reason: string, action: string, first: string | undefined): AskItem["always"] {
  if (!action) return undefined;
  const label = `${first ?? action} [auto-yes]`;
  const revoke = `Revoke with \`aleph always revoke ${reason}\`.`;
  if (action === "firefighter") return { label, action, hint: `Does this one now. From now on, the firefighter decides these cards without asking you. ${revoke}` };
  if (action === "recommended") return { label, action, hint: `Does this one now. From now on, the factory takes the recommended option of every decision without asking you. ${revoke}` };
  if (reason === "proposal" && action === "start") return { label, action, hint: `Does this one now. From now on, a dependency update within the same major version starts without asking you; a major version jump still asks. ${revoke}` };
  return { label, action, hint: `Does this one now. From now on, the factory does this without asking you. ${revoke}` };
}

function proposalAlways(l: Lesson): NonNullable<AskItem["always"]> {
  const key = standingKey(l);
  return {
    label: `${words(l).approve} [auto-yes]`, action: "approve", reason: key,
    hint: `From now on, the factory files every ${words(l).every} without asking you. Revoke with \`aleph always revoke ${key}\`.`,
  };
}

function item(reason: string, c: Ctx, key: string, href: string, title: string, repo?: string, kind?: string): AskItem {
  const actions = actionsFor(reason, c);
  const r = ASK_REASONS[reason];
  return {
    key, reason, kind: kindOf(reason, kind), id: c.id, href, title, problem: PROBLEM[reason](c), actions,
    ...(c.lesson ? { always: proposalAlways(c.lesson) } : r.always ? { always: alwaysFor(reason, r.always, actions[0]?.label) } : {}),
    details: detailsFor(c), ...(repo ? { repo } : {}),
  };
}

/**
 * The asks: runs that await, then issues and goals that await, then proposals. `runs` are the awaiting runs, each with its `ask`;
 * `issues` the issues and goals that hold an Ask.
 * Every entry stays, with its actions; one whose reason Chris handed to the firefighter is also counted in the Always list's `handed`.
 */
export function attend(s: { runs: Job[]; issues: NewIssue[] }, always: Always = {}, lessons: Lesson[] = openProposals()): { items: AskItem[]; handed: Record<string, number> } {
  const handed: Record<string, number> = {};
  const out: AskItem[] = [];
  const add = (it: AskItem) => {
    if (always[it.reason]?.action === "firefighter") handed[it.reason] = (handed[it.reason] ?? 0) + 1;
    out.push(it);
  };
  const rank: Record<string, number> = { "held-path": 0, review: 1 };
  const runs = s.runs.filter((j) => j.ask && ASK_REASONS[j.ask.reason]).sort((a, b) => (rank[a.ask!.reason] ?? 2) - (rank[b.ask!.reason] ?? 2));
  for (const j of runs) add(item(j.ask!.reason, { id: j.name, run: j }, `run:${j.name}`, `#/jobs/${encodeURIComponent(j.name)}`, j.item?.title ?? "", j.repo, j.ask!.kind));
  for (const i of s.issues) add(item(issueReason(i), { id: i.id, issue: i }, `issue:${i.id}`, i.href, i.title, i.id.split(/-(?=\d+(?:\.\d+)?$)/)[0], i.askKind));
  for (const l of lessons) {
    const reason = `proposal-${l.kind ?? "skill"}`;
    if (ASK_REASONS[reason]) add(item(reason, { id: l.id, lesson: l }, `proposal:${l.id}`, "", l.title || l.sentence));
  }
  return { items: out, handed };
}

/** The asks alone. */
export const asks = (s: { runs: Job[]; issues: NewIssue[] }, always: Always = {}, lessons?: Lesson[]): AskItem[] => attend(s, always, lessons).items;

/** The open issue a stuck job cannot succeed before: the item's own waiting_on, else one its last run's reason names. */
export interface Blocker { id: string; title: string; href: string }
export function stuckBlocker(j: Pick<Job, "repo" | "item" | "reason">, waitingOn: string | null | undefined, open: ReadonlyMap<string, { title: string; href: string }>): Blocker | null {
  const own = j.item ? `${j.repo}-${j.item.id}` : "";
  const hit = (id: string): Blocker | null => (id !== own && open.has(id) ? { id, ...open.get(id)! } : null);
  const w = waitingOn?.trim();
  if (w && hit(w)) return hit(w);
  for (const m of (j.reason ?? "").matchAll(/\b([A-Za-z][\w.]*-\d+)\b/g)) if (hit(m[1])) return hit(m[1]);
  return null;
}

/** The buttons of a stuck row: with a blocker, Wait for it and Drop; without, Re-check and Drop. */
export function stuckActions(j: Pick<Job, "name">, blocker: Blocker | null | undefined): Action[] {
  const drop: Action = { act: "drop", label: "Drop", hint: "Discards the run's branch; the issue stays open.", primary: false, args: { name: j.name } };
  if (!blocker) return [{ act: "recheck", label: "Re-check", hint: "Runs the job again.", primary: false, args: { name: j.name } }, drop];
  return [{ act: "wait", label: `Wait for ${blocker.id}`, hint: `Makes the goal run after ${blocker.id} and drops the stuck job; the factory starts nothing until ${blocker.id} lands.`, primary: true, args: { name: j.name, on: blocker.id } }, drop];
}
