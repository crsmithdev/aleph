/**
 * What the Needs-you rows say and offer. The server decides from the reason code and the item's data;
 * the page only renders. One item per held, review or question run, per needs-chris issue and per proposal.
 */
import { proposals as openProposals, type Lesson } from "../jobs/lib/corrections.ts";
import type { Decision } from "../jobs/lib/decision.ts";
import { REASONS, type Granted } from "../jobs/lib/standing.ts";
// @ts-ignore plain JS, shared with the page
import { oneSentence } from "./views/now.js";
import type { Job, NewIssue, State } from "./state.ts";

export interface Action { act: string; label: string; hint: string; primary: boolean; args: Record<string, string> }
export interface AttentionItem {
  key: string; reason: string; id: string; href: string; title: string; problem: string;
  actions: Action[]; always: { label: string; action: string }; details: Details;
  /** The project key, for `?project=`. */
  repo?: string;
}
export interface Details {
  note?: string; stat?: string; review2?: { verdict: string; reason?: string };
  decision?: Decision; signals?: { source: string; at: string; quote: string; link: string }[];
}
export type Standing = Record<string, Granted>;

/** The held-reason, from the item's own field or, for an old item, the last note. */
export function issueReason(i: Pick<NewIssue, "reason" | "question" | "decision">): string {
  if (i.reason && REASONS[i.reason]) return i.reason;
  const n = (i.question ?? "").replace(/^needs-chris:\s*/, "");
  if (/^triage: no verdict in/.test(n)) return "triage-no-verdict";
  if (/^acceptance: fail again/.test(n)) return "acceptance-failed";
  if (/ended with no commit, so the factory stopped/.test(n)) return "no-commit";
  if (/^triage: for Chris:/.test(n)) return "decision";
  if (/a held security path/.test(n)) return "firefighter";
  return i.decision ? "rescue" : "decision";
}

/** A plain sentence from a raw note: no tags, no leads, no paths. */
export function clean(text: unknown): string {
  const t = String(text ?? "")
    .replace(/<(task-notification|agent-message)\b[\s\S]*?(<\/\1>|$)/g, " ")
    .replace(/<[^>]*>/g, " ").replace(/[<>]/g, " ")
    .replace(/^\s*-\s*/, "").replace(/^\s*needs-chris:\s*/i, "").replace(/^\s*triage: for Chris:\s*/i, "")
    .replace(/\s+/g, " ").trim();
  return oneSentence(t);
}
const sentence = (s: string) => (/[.?!]$/.test(s) ? s : `${s}.`);
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

type Ctx = { id: string; run?: Job; issue?: NewIssue; lesson?: Lesson };

const failure = (note: string): string => {
  const m = /^triage: no verdict in \d+ runs?:\s*(.*)$/.exec(note.replace(/^needs-chris:\s*/, ""));
  const why = (m?.[1] ?? "").trim();
  if (/^malformed verdict/.test(why)) return "it gave a verdict that could not be read";
  return clean(why.replace(/^failed:\s*/, "")).replace(/\.$/, "") || "it gave no verdict";
};

const PROBLEM: Record<string, (c: Ctx) => string> = {
  held: (c) => `The run for ${c.id} changes a path the repo holds for your review, so the factory did not land it.`,
  review: (c) => {
    const r = c.run?.review2;
    if (r?.verdict === "back") return `The reviewer sent ${c.id} back twice${r.reason ? `: ${clean(r.reason).replace(/\.$/, "")}` : ""}.`;
    if (r?.verdict === "chris") return `The reviewer left ${c.id} to you${r.reason ? `: ${clean(r.reason).replace(/\.$/, "")}` : ""}.`;
    return `The reviewer could not reach a verdict on ${c.id} in two tries.`;
  },
  question: (c) => `The worker on ${c.id} asked: ${clean(c.run?.question) || "it needs an answer"}`,
  "no-commit": (c) => `The last 3 runs of ${c.id} ended with no commit, so the factory stopped starting it.`,
  "triage-no-verdict": (c) => `Triage of ${c.id} failed twice: ${failure(c.issue?.question ?? "")}, so no one has decided what to do with this issue.`,
  "acceptance-failed": (c) => `The Oracle of ${c.id} still fails on main after a rerun.`,
  decision: (c) => sentence(clean(c.issue?.decision?.question ?? c.issue?.question) || "Your decision is needed"),
  rescue: (c) => sentence(clean(c.issue?.decision?.question ?? c.issue?.question) || "Your decision is needed"),
  firefighter: (c) => {
    const note = String(c.issue?.question ?? "").replace(/^needs-chris:\s*/, "");
    const m = /^(\S+) changes (\S+?),? a held security path/.exec(note);
    return m ? `The firefighter would land ${c.id}, but it changes ${m[2]}, a held security path, so it needs your review.`
      : `The firefighter would land ${c.id}, but it changes a held security path, so it needs your review.`;
  },
};
for (const k of ["check", "claude-md", "skill"]) PROBLEM[`proposal-${k}`] = (c) => `The correction memory proposes ${k === "check" ? "a check" : k === "claude-md" ? "a CLAUDE.md line" : "a skill change"}: ${clean(c.lesson?.sentence).replace(/\.$/, "")}.`;

function actionsFor(reason: string, c: Ctx): Action[] {
  const run: Record<string, string> = c.run ? { name: c.run.name } : {};
  const [repo, n] = c.issue ? c.id.split(/-(?=\d+$)/) : ["", ""];
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
      case "deny": return [a("deny", "Deny", "Records your refusal on the issue and closes the question.", issue)];
      case "approve": return [a("approve", "File the goal", "Files the proposal as a goal for the factory.", { id: c.id })];
      case "decline": return [a("decline", "Never propose this", "Drops the proposal and stops the memory proposing it again.", { id: c.id })];
      case "decide": {
        const d = c.issue?.decision;
        if (d) return [...d.options].sort((x, y) => +(y.label === d.recommended) - +(x.label === d.recommended))
          .map((o) => a("decide", `Approve ${o.label}`, o.line || "Records this choice on the issue and lets the factory act on it.", { ...issue, option: o.label }));
        return [a("decide", "Approve recommendation", "Records the recommended choice on the issue.", issue)];
      }
      default: return [];
    }
  };
  const acts = reason === "question"
    ? [a("answer", "Answer and rerun", "Takes your answer and starts the job again with it.", run), ...one("drop")]
    : [...new Set(REASONS[reason].actions)].flatMap(one);
  if (acts[0]) acts[0].primary = true;
  return acts;
}

function detailsFor(c: Ctx): Details {
  const d: Details = {};
  if (c.run) {
    const note = c.run.reason ?? c.run.question;
    if (note) d.note = note;
    if (c.run.stat) d.stat = c.run.stat;
    if (c.run.review2) d.review2 = c.run.review2;
  }
  if (c.issue) {
    if (c.issue.question) d.note = c.issue.question;
    if (c.issue.decision) d.decision = c.issue.decision;
  }
  if (c.lesson) d.signals = c.lesson.signals.map(({ source, at, quote, link }) => ({ source, at, quote, link }));
  return d;
}

function item(reason: string, c: Ctx, key: string, href: string, title: string, repo?: string): AttentionItem {
  const actions = actionsFor(reason, c);
  const r = REASONS[reason];
  return {
    key, reason, id: c.id, href, title, problem: PROBLEM[reason](c), actions,
    always: { label: r.always === "firefighter" ? "Always let the firefighter decide" : `Always ${lower(actions[0]?.label ?? r.always)}`, action: r.always },
    details: detailsFor(c), ...(repo ? { repo } : {}),
  };
}

/**
 * The Needs-you rows: held, review and question runs, then needs-chris issues, then proposals.
 * A reason that Chris handed to the firefighter is left out and counted in the standing list's `handed`.
 */
export function attend(s: Pick<State, "needs" | "needsIssues">, standing: Standing = {}, lessons: Lesson[] = openProposals()): { items: AttentionItem[]; handed: Record<string, number> } {
  const handed: Record<string, number> = {};
  const out: AttentionItem[] = [];
  const add = (it: AttentionItem) => {
    if (standing[it.reason]?.action === "firefighter") handed[it.reason] = (handed[it.reason] ?? 0) + 1;
    else out.push(it);
  };
  const rank = { held: 0, review: 1, question: 2 } as Record<string, number>;
  const runs = s.needs.filter((j) => j.needs && j.needs in rank).sort((a, b) => rank[a.needs!] - rank[b.needs!]);
  for (const j of runs) add(item(j.needs!, { id: j.name, run: j }, `run:${j.name}`, `#/jobs/${encodeURIComponent(j.name)}`, j.item?.title ?? "", j.repo));
  for (const i of s.needsIssues) add(item(issueReason(i), { id: i.id, issue: i }, `issue:${i.id}`, i.href, i.title, i.id.split(/-(?=\d+$)/)[0]));
  for (const l of lessons) {
    const reason = `proposal-${l.kind ?? "skill"}`;
    if (REASONS[reason]) add(item(reason, { id: l.id, lesson: l }, `proposal:${l.id}`, "", l.sentence));
  }
  return { items: out, handed };
}

/** The Needs-you items alone. */
export const attention = (s: Pick<State, "needs" | "needsIssues">, standing: Standing = {}, lessons?: Lesson[]): AttentionItem[] => attend(s, standing, lessons).items;
