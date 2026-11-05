/**
 * What the Awaiting-you rows say and offer (the `asks` of /api/state). The server decides from the Ask's reason and the item's data;
 * the page only renders. One entry per run, issue or goal that waits for Chris, and per proposal.
 */
import { place, proposals as openProposals, standingKey, type Lesson } from "../jobs/lib/learning/corrections.ts";
import { actionsOn, ASK_REASONS, kindOf, LIMITS, limitText, reasonOf, type Ask, type Granted } from "../jobs/lib/asks/ask.ts";
import { word } from "../lib/naming.ts";
// @ts-ignore plain JS, shared with the page
import { oneSentence, proseDecision } from "./decision.js";
import type { Job, NewIssue } from "./state.ts";

export interface Action { act: string; label: string; hint: string; primary: boolean; args: Record<string, string>; /** The Ask's recommend names this action. */ recommended: boolean }
export interface AskItem {
  key: string; reason: string; /** What the answer is: your input or your approval. */ kind: "input" | "approval"; id: string; href: string; title: string; problem: string;
  /** The card's kind (it sets the color and opens the title), the title after the kind, and the tag that names the stop. The page reads an item without them by its `kind` and `title`. */
  card?: Card; headline?: string; tag?: string;
  /** The stored situation when the Ask holds one, else the fixed problem text. */ situation: string;
  /** True once the director escalated the Ask: `situation` and the hints are its case text. Until then the row offers no action. */ escalated: boolean;
  actions: Action[]; /** What the limits moved out of the card's text, and the director's `details`: shown under Details. */ more?: string[]; always?: { label: string; action: string; hint: string; reason?: string }; details: Details;
  /** The project key, for `?project=`. */
  repo?: string;
  /** The priority of the issue, goal or run's item it is about; none for a proposal. */
  priority?: string;
  /** A waiting run: a live run exists for it, the trailers the land will write, its defaults and follow-ups. */
  /** A waiting run: the goal or issue it is on. */ on?: string;
  /** The date shown on the card, and when the work was first picked up (ISO, "" for never); a part of a goal as "n/m" of its parent. */
  at?: string; since?: string; part?: { n: number; m: number; parent: string; href: string };
  agent?: boolean; trailers?: { key: string; value: string }[]; defaults?: string[]; followups?: string[];
}
export interface Details {
  note?: string; stat?: string; review?: { call: string; reason?: string };
  ask?: Ask; signals?: { source: string; at: string; quote: string; link: string }[];
}
export type Always = Record<string, Granted>;

const STAMP = /^\s*\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?:\s*/;
/** A note without its optional leading timestamp. */
const unlead = (s: string): string => s.replace(/^\s*-\s*/, "").replace(STAMP, "");

/** A plain sentence from a raw note: no tags, no leads, no paths. */
export function clean(text: unknown): string {
  const t = String(text ?? "")
    .replace(/<(task-notification|agent-message)\b[\s\S]*?(<\/\1>|$)/g, " ")
    .replace(/<[^>]*>/g, " ").replace(/[<>]/g, " ")
    .replace(/^\s*-\s*/, "").replace(STAMP, "").replace(/^\s*(?:intake: for Chris|triage: (?:for Chris|a live check)):\s*/i, "")
    .replace(/\s+/g, " ").trim();
  return oneSentence(t);
}
const sentence = (s: string) => (/[.?!]$/.test(s) ? s : `${s}.`);

type Ctx = { id: string; run?: Job; issue?: NewIssue; lesson?: Lesson };

/** The three kinds of card. Approve: finished work that waits for an OK. Decide: a choice only Chris can make. Unstick: work that stopped and needs a direction. */
export type Card = "approve" | "decide" | "unstick";
/** Each reason's kind of card. */
const CARDS: Record<string, { card: Card }> = {
  "held-path": { card: "approve" },
  review: { card: "approve" },
  "proposal-check": { card: "approve" },
  "proposal-claude-md": { card: "approve" },
  "proposal-skill": { card: "approve" },
  question: { card: "decide" },
  "part-dropped": { card: "decide" },
  "no-commit": { card: "unstick" },
  "run-cap": { card: "unstick" },
  "intake-failed": { card: "unstick" },
  rescue: { card: "unstick" },
};
/** The text a row shows: the Ask of its run or issue, else the stored text of its lesson. */
const askIn = (c: Ctx): Pick<Ask, "headline" | "situation" | "details" | "effects" | "recommend"> | undefined => {
  const ask = c.run?.ask ?? c.issue?.ask;
  if (ask) return ask;
  const l = c.lesson;
  return l?.situation ? { headline: l.headline, situation: l.situation, details: l.details, effects: l.effects, recommend: l.recommend } : undefined;
};

const PROBLEM: Record<string, (c: Ctx) => string> = {
  "held-path": (c) => `The run for ${c.id} changes a path the repo holds for your review, so the factory did not land it.`,
  review: (c) => {
    const r = c.run?.reviewCall;
    if (r?.call === "returned") return `The reviewer sent ${c.id} back twice${r.reason ? `: ${clean(r.reason).replace(/\.$/, "")}` : ""}.`;
    if (r?.call === "waiting") return `The reviewer left ${c.id} to you${r.reason ? `: ${clean(r.reason).replace(/\.$/, "")}` : ""}.`;
    const back = /^the reviewer sent it back twice:\s*(.*)$/s.exec(c.run?.reason ?? "");
    if (back) return `The reviewer sent ${c.id} back twice: ${clean(back[1]).replace(/\.$/, "")}.`;
    return `The reviewer could not reach a verdict on ${c.id} in two tries.`;
  },
  question: (c) => c.run ? `The worker on ${c.id} asked: ${clean(c.run.question) || "it needs an answer"}` : sentence(clean(c.issue?.decision?.question ?? c.issue?.question) || "Your answer is needed"),
  "part-dropped": (c) => `A goal of ${c.id} was dropped and no other goal of it is open.`,
  "no-commit": (c) => `The last 3 runs of ${c.id} ended with no commit, so the factory stopped starting it.`,
  "run-cap": (c) => `The factory started ${c.id} 3 times in one hour, so it stopped starting it until you run it again.`,
  "intake-failed": (c) => `Intake of ${c.id} failed: ${clean(unlead(c.issue?.question ?? "").replace(/^Intake failed:\s*/, "")).replace(/\.$/, "") || "it gave no verdict"}, so no one has decided what to do with this issue.`,
  rescue: (c) => sentence(clean(c.issue?.decision?.question ?? c.issue?.question) || "Your answer is needed"),
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

/** `rerun` by what it does for each reason. */
const RERUN: Record<string, { label: string; hint: string }> = {
  "no-commit": { label: "Start a new run", hint: "Clears the Ask and lets the factory start a new run of the issue." },
  "part-dropped": { label: "Close as done", hint: "Sets the issue to done; nothing more runs for it." },
  "run-cap": { label: "Start it again", hint: "Clears the Ask and lets the factory start the issue again." },
};
const rerun = (reason: string, args: Record<string, string>): Action => {
  const r = RERUN[reason] ?? { label: "Start it again", hint: "Clears the label and lets the factory start the issue again." };
  return { act: "rerun", label: r.label, hint: r.hint, primary: false, args, recommended: false };
};

function actionsFor(reason: string, c: Ctx, more: string[] = []): Action[] {
  const run: Record<string, string> = c.run ? { name: c.run.name } : {};
  const [repo, n] = c.issue ? c.id.split(/-(?=\d+(?:\.\d+)?$)/) : ["", ""];
  const issue = { repo, id: n };
  const a = (act: string, label: string, hint: string, args: Record<string, string>): Action => ({ act, label, hint, primary: false, args, recommended: false });
  const one = (act: string): Action[] => {
    switch (act) {
      case "land": return [a("land", "Land it", c.run ? "Merges the run's branch into main." : "Lands the held run's branch on main.", run)];
      case "drop":
        return c.run ? [a("drop", "Drop the job", "Discards the run's branch; the issue stays open.", run)]
          : [a("drop", "Drop the issue", "Marks the issue dropped; nothing more runs for it.", issue)];
      case "rerun": return [rerun(reason, issue)];
      case "retry": return [a("retriage", "Run intake again", "Removes the Ask; intake runs again at once.", issue)];
      case "close": return [a("close", "Close the issue", "Marks the issue dropped; nothing more runs for it.", issue)];
      case "deny":
        return [a("deny", "Deny", "Records your refusal on the issue and closes the question.", issue)];
      case "approve":
        if (c.lesson) { const w = words(c.lesson); return [a("approve", `Reopen the issue: ${w.approve}`, `Reopens the issue that ${w.hint}.`, { id: c.id })]; }
        return [a("approve", "Reopen the issue", "Reopens the proposal's issue with a spec for the factory.", { id: c.id })];
      case "decline":
        if (c.lesson) return [a("decline", words(c.lesson).decline, "Drops the proposal; the memory does not propose this lesson again.", { id: c.id })];
        return [a("decline", "Never propose this", "Drops the proposal and stops the memory proposing it again.", { id: c.id })];
      case "decide": {
        const d = c.issue?.decision;
        if (d) return [...d.options].sort((x, y) => +(y.label === d.recommended) - +(x.label === d.recommended))
          .map((o) => a("decide", o.label, o.line || "Records this choice on the issue and lets the factory act on it.", { ...issue, option: o.label }));
        if (proseDecision(c.issue?.question).recommendation) return [a("decide", "Approve recommendation", "Records the recommended choice on the issue, and the factory acts on it.", { ...issue, recommendation: "true" })];
        return [a("decide", "Approve it", "Records your approval on the issue, and the factory starts it.", { ...issue, approve: "true" })];
      }
      default: return [];
    }
  };
  const names = new Map<Action, string>();
  const acts = actionsOn(reason, { run: !!c.run, decision: !!c.issue?.decision }).flatMap((n) => {
    const got = n === "answer" ? [a("answer", "Answer and rerun", "Takes your answer and starts the job again with it.", run)] : one(n);
    for (const x of got) names.set(x, x.act === "decide" && x.args.option ? `decide:${x.args.option}` : n);
    return got;
  });
  if (acts[0]) acts[0].primary = true;
  const ask = askIn(c);
  if (ask?.situation) {
    const is = (x: Action, name: string) => names.get(x) === name || x.act === name;
    for (const x of acts) {
      const e = ask.effects?.find((f) => is(x, f.action));
      if (e?.text) x.hint = e.text;
    }
  }
  // The limit covers the effect or hint text only, not what is added below.
  for (const x of acts) {
    const { kept, rest } = limitText(x.hint, LIMITS.choice);
    x.hint = kept;
    if (rest) more.push(`${x.label}: ${rest}`);
  }
  if (ask?.situation) {
    const is = (x: Action, name: string) => names.get(x) === name || x.act === name;
    const rec = ask.recommend && acts.find((x) => is(x, ask.recommend!.action));
    if (rec && ask.recommend) {
      rec.recommended = true;
      // The why goes under Technical details, so the choice's text keeps to its limit.
      const why = ask.recommend.why.trim().replace(/^./, (ch) => ch.toUpperCase());
      if (why) more.push(`Recommended, ${rec.label}: ${sentence(why)}`);
    }
  }
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
  if (action === "recommended") return { label, action, hint: `Does this one now. From now on, the factory takes the recommended option of every decision without asking you. ${revoke}` };
  return { label, action, hint: `Does this one now. From now on, the factory does this without asking you. ${revoke}` };
}

function proposalAlways(l: Lesson): NonNullable<AskItem["always"]> {
  const key = standingKey(l);
  return {
    label: `${words(l).approve} [auto-yes]`, action: "approve", reason: key,
    hint: `From now on, the factory files every ${words(l).every} without asking you. Revoke with \`aleph always revoke ${key}\`.`,
  };
}

/**
 * One row. An Ask with no case text is still with the director (jobs/lib/roles/director.ts): the row shows the fixed problem
 * text and offers no action and no auto-yes until the director escalates it with its case text.
 */
function item(reason: string, c: Ctx, key: string, href: string, title: string, repo?: string, kind?: string, priority?: string): AskItem {
  const more: string[] = [];
  const stored0 = askIn(c)?.situation;
  const said = stored0 ? limitText(stored0, LIMITS.situation) : null;
  if (said?.rest) more.push(said.rest);
  const escalated = !!said?.kept;
  const actions = escalated ? actionsFor(reason, c, more) : [];
  const extra = askIn(c)?.details?.trim();
  if (extra) more.push(extra);
  const r = ASK_REASONS[reason];
  const problem = PROBLEM[reason](c);
  const stored = said?.kept;
  const card = CARDS[reason];
  const headline = (escalated && askIn(c)?.headline?.trim()) || title;
  return {
    key, reason, kind: kindOf(reason, kind), card: card.card, headline, tag: escalated ? word("ask", reason) : word("actor", "Director"), id: c.id, href, title, problem, situation: stored || problem, escalated, actions, ...(more.length ? { more } : {}),
    ...(!escalated ? {} : c.lesson ? { always: proposalAlways(c.lesson) } : r.always ? { always: alwaysFor(reason, r.always, actions[0]?.label) } : {}),
    details: detailsFor(c), ...(repo ? { repo } : {}), ...(priority ? { priority } : {}),
  };
}

/**
 * The asks: runs that await, then issues and goals that await, then proposals. `runs` are the awaiting runs, each with its `ask`;
 * `issues` the issues and goals that hold an Ask.
 */
export function attend(s: { runs: Job[]; issues: NewIssue[] }, lessons: Lesson[] = openProposals()): { items: AskItem[] } {
  const out: AskItem[] = [];
  const add = (it: AskItem) => out.push(it);
  const rank: Record<string, number> = { "held-path": 0, review: 1 };
  const runs = s.runs.filter((j) => j.ask && ASK_REASONS[j.ask.reason]).sort((a, b) => (rank[a.ask!.reason] ?? 2) - (rank[b.ask!.reason] ?? 2));
  for (const j of runs) add(item(j.ask!.reason, { id: j.name, run: j }, `run:${j.name}`, `#/jobs/${encodeURIComponent(j.name)}`, j.item?.title ?? "", j.repo, j.ask!.kind, j.item?.priority));
  for (const i of s.issues) add(item(reasonOf(i.reason), { id: i.id, issue: i }, `issue:${i.id}`, i.href, i.title, i.id.split(/-(?=\d+(?:\.\d+)?$)/)[0], i.askKind, i.priority));
  for (const l of lessons) {
    const reason = `proposal-${l.kind ?? "skill"}`;
    if (ASK_REASONS[reason]) add(item(reason, { id: l.id, lesson: l }, `proposal:${l.id}`, "", l.title || l.sentence));
  }
  return { items: out };
}

/** The asks alone. */
export const asks = (s: { runs: Job[]; issues: NewIssue[] }, lessons?: Lesson[]): AskItem[] => attend(s, lessons).items;

/** The open issue a stuck job cannot succeed before: the goal's own first `after`, else one its last run's reason names. */
export interface Blocker { id: string; title: string; href: string }
export function stuckBlocker(j: Pick<Job, "repo" | "item" | "reason">, after: string | null | undefined, open: ReadonlyMap<string, { title: string; href: string }>): Blocker | null {
  const own = j.item ? `${j.repo}-${j.item.id}` : "";
  const hit = (id: string): Blocker | null => (id !== own && open.has(id) ? { id, ...open.get(id)! } : null);
  const w = after?.trim();
  if (w && hit(w)) return hit(w);
  for (const m of (j.reason ?? "").matchAll(/\b([A-Za-z][\w.]*-\d+)\b/g)) if (hit(m[1])) return hit(m[1]);
  return null;
}

