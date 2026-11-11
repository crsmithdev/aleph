/**
 * What the Awaiting-you rows say and offer (the `asks` of /api/factory). The server decides from the Ask's reason and the item's data;
 * the page only renders. One entry per run, issue that waits for Chris, and per proposal.
 */
import { place, proposals as openProposals, standingKey, type Lesson } from "../jobs/lib/learning/corrections.ts";
import { actionsOn, ASK_REASONS, kindOf, LIMITS, limitText, reasonOf, type Ask, type Card } from "../jobs/lib/asks/ask.ts";
import { jobHref, parseId, refs, word } from "../lib/naming.ts";
// @ts-ignore plain JS, shared with the page
import { oneSentence, proseDecision } from "./decision.js";
import type { Job, NewIssue } from "./state.ts";

/**
 * A choice on an Ask card and the POST its button sends: `body` is the JSON, `confirm` asks for a second click, and `input`
 * is a text box whose text goes in the body under its name, after `lead`; with no text the body keeps its own value.
 */
interface Action {
  act: string; label: string; hint: string; primary: boolean; /** The Ask's recommend names this action. */ recommended: boolean;
  path: string; body: Record<string, unknown>; confirm?: true; input?: { name: string; lead?: string };
}
export interface AskItem {
  key: string; reason: string; /** What the answer is: your input or your approval. */ kind: "input" | "approval"; id: string; href: string; title: string; problem: string;
  /** The card's kind (it sets the color), its label that opens the title, the title after the label, and the tag that names the stop. */
  card: Card; label: string; headline: string; tag: string;
  /** The stored situation when the Ask holds one, else the fixed problem text. */ situation: string;
  /** True once the director escalated the Ask: `situation` and the hints are its case text. Until then the row offers no action. */ escalated: boolean;
  actions: Action[]; /** What the limits moved out of the card's text, and the director's `details`: shown under Details. */ more?: string[]; always?: { label: string; action: string; hint: string; reason?: string }; details: Details;
  /** The project key, for `?project=`. */
  repo?: string;
  /** The priority of the issue or run's item it is about; none for a proposal. */
  priority?: string;
  /** A waiting run: a live run exists for it, the trailers the land will write, its defaults and follow-ups. */
  /** A waiting run: the issue it is on. */ on?: string;
  /** The date shown on the card, and when the work was first picked up (ISO, "" for never); a part of an issue as "n/m" of its parent. */
  at?: string; since?: string; part?: { n: number; m: number; parent: string; href: string };
  /** A waiting run: when the Ask timeout lands it with no answer (ISO). */ due?: string;
  agent?: boolean; trailers?: { key: string; value: string }[]; defaults?: string[]; followups?: string[];
}
interface Details {
  note?: string; stat?: string; review?: { call: string; reason?: string };
  ask?: Ask; signals?: { source: string; at: string; quote: string; link: string }[];
}

/** A plain sentence from a raw note: no tags, no leads, no paths. */
function clean(text: unknown): string {
  const t = String(text ?? "")
    .replace(/<(task-notification|agent-message)\b[\s\S]*?(<\/\1>|$)/g, " ")
    .replace(/<[^>]*>/g, " ").replace(/[<>]/g, " ")
    .replace(/^\s*-\s*/, "").replace(/^\s*(?:intake: for Chris|triage: (?:for Chris|a live check)):\s*/i, "")
    .replace(/\s+/g, " ").trim();
  return oneSentence(t);
}
const sentence = (s: string) => (/[.?!]$/.test(s) ? s : `${s}.`);

type Ctx = { id: string; run?: Job; issue?: NewIssue; lesson?: Lesson };

/** The name and the one line of a reason. A reason not in the table is named by its key, with no line. */
export const reasonText = (reason: string): { name: string; line: string } => {
  const r = ASK_REASONS[reason];
  return r ? { name: r.name, line: r.line } : { name: reason, line: "" };
};
/** The text a row shows: the Ask of its run or issue, else the stored text of its lesson. */
const askIn = (c: Ctx): Pick<Ask, "headline" | "situation" | "details" | "effects" | "recommend"> | undefined => {
  const ask = c.run?.ask ?? c.issue?.ask;
  if (ask) return ask;
  const l = c.lesson;
  return l?.situation ? { headline: l.headline, situation: l.situation, details: l.details, effects: l.effects, recommend: l.recommend } : undefined;
};

/** An issue's question as one sentence, or "" when it has none. */
const asked = (c: Ctx): string => { const q = clean(c.issue?.decision?.question ?? c.issue?.question); return q && sentence(q); };
/** The problem text of a reason whose case the context says more about than the fixed text of ASK_REASONS. */
const PROBLEM: Record<string, (c: Ctx) => string | undefined> = {
  review: (c) => {
    const r = c.run?.reviewCall;
    if (r?.call === "returned") return `The reviewer sent ${c.id} back twice${r.reason ? `: ${clean(r.reason).replace(/\.$/, "")}` : ""}.`;
    if (r?.call === "waiting") return `The reviewer left ${c.id} to the user${r.reason ? `: ${clean(r.reason).replace(/\.$/, "")}` : ""}.`;
    const back = /^the reviewer sent it back twice:\s*(.*)$/s.exec(c.run?.reason ?? "");
    if (back) return `The reviewer sent ${c.id} back twice: ${clean(back[1]).replace(/\.$/, "")}.`;
  },
  question: (c) => c.run ? `The worker on ${c.id} asked: ${clean(c.run.question) || "it needs an answer"}` : asked(c),
  "intake-failed": (c) => {
    const why = clean((c.issue?.question ?? "").replace(/^Intake failed:\s*/, "")).replace(/\.$/, "");
    return why ? `Intake of ${c.id} failed: ${why}, so no one has decided what to do with this issue.` : undefined;
  },
  rescue: asked,
};
/** A row's problem text: what the context says, else the reason's fixed text. */
const problemOf = (reason: string, c: Ctx): string => PROBLEM[reason]?.(c) || ASK_REASONS[reason].problem.replaceAll("{id}", c.id);
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

function actionsFor(reason: string, c: Ctx, more: string[] = []): Action[] {
  const job = (verb: string) => `/api/jobs/${encodeURIComponent(c.run?.id ?? "")}/${verb}`;
  const issue = (verb: string) => `/api/issues/${encodeURIComponent(c.id)}/${verb}`;
  const proposal = (verb: string) => `/api/proposals/${encodeURIComponent(c.id)}/${verb}`;
  const a = (act: string, label: string, hint: string, path: string, body: Record<string, unknown> = {}, more: Partial<Action> = {}): Action =>
    ({ act, label, hint, primary: false, recommended: false, path, body, ...more });
  const one = (act: string): Action[] => {
    switch (act) {
      case "land": return [a("land", "Land it", c.run ? "Merges the run's branch into main." : "Lands the held run's branch on main.", job("land"))];
      case "drop":
        return c.run ? [a("drop", "Drop the job", "Discards the run's branch; the issue stays open.", job("drop"), {}, { confirm: true })]
          : [a("drop", "Drop the issue", "Marks the issue dropped; nothing more runs for it.", issue("drop"), {}, { confirm: true })];
      case "rerun": { const r = ASK_REASONS[reason].rerun!; return [a("rerun", r.label, r.hint, issue("rerun"))]; }
      case "retry": return [a("retriage", "Run intake again", "Removes the Ask; intake runs again at once.", issue("retriage"))];
      case "close": return [a("close", "Close the issue", "Marks the issue dropped; nothing more runs for it.", issue("drop"), { reason: "Chris closed it" })];
      case "deny":
        return [a("deny", "Deny", "Records the user's refusal on the issue and closes the question.", issue("drop"), { reason: "Chris denied it" }, { input: { name: "reason", lead: "Chris denied: " } })];
      case "approve":
        if (c.lesson) { const w = words(c.lesson); return [a("approve", `Reopen the issue: ${w.approve}`, `Reopens the issue that ${w.hint}.`, proposal("approve"))]; }
        return [a("approve", "Reopen the issue", "Reopens the proposal's issue with a spec for the factory.", proposal("approve"))];
      case "decline":
        if (c.lesson) return [a("decline", words(c.lesson).decline, "Drops the proposal; the memory does not propose this lesson again.", proposal("decline"))];
        return [a("decline", "Never propose this", "Drops the proposal and stops the memory proposing it again.", proposal("decline"))];
      case "decide": {
        const d = c.issue?.decision;
        if (d) return [...d.options].sort((x, y) => +(y.label === d.recommended) - +(x.label === d.recommended))
          .map((o) => a("decide", o.label, o.line || "Records this choice on the issue and lets the factory act on it.", issue("decide"), { label: o.label }));
        if (proseDecision(c.issue?.question).recommendation) return [a("decide", "Approve recommendation", "Records the recommended choice on the issue, and the factory acts on it.", issue("decide"), { recommendation: true })];
        return [a("decide", "Approve it", "Records the user's approval on the issue, and the factory starts it.", issue("decide"), { approve: true })];
      }
      default: return [];
    }
  };
  const names = new Map<Action, string>();
  const acts = actionsOn(reason, { run: !!c.run, decision: !!c.issue?.decision }).flatMap((n) => {
    const got = n === "answer" ? [a("answer", "Answer and rerun", "Takes the user's answer and starts the job again with it.", job("answer"), {}, { input: { name: "answer" } })] : one(n);
    for (const x of got) names.set(x, x.act === "decide" && x.body.label ? `decide:${x.body.label}` : n);
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
  if (action === "recommended") return { label, action, hint: `Does this one now. From now on, the factory takes the recommended option of every decision without asking. ${revoke}` };
  return { label, action, hint: `Does this one now. From now on, the factory does this without asking. ${revoke}` };
}

function proposalAlways(l: Lesson): NonNullable<AskItem["always"]> {
  const key = standingKey(l);
  return {
    label: `${words(l).approve} [auto-yes]`, action: "approve", reason: key,
    hint: `From now on, the factory reopens the issue for every ${words(l).every} without asking. Revoke with \`aleph always revoke ${key}\`.`,
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
  const problem = problemOf(reason, c);
  const stored = said?.kept;
  const headline = (escalated && askIn(c)?.headline?.trim()) || title;
  return {
    key, reason, kind: kindOf(reason, kind), card: r.card, label: r.card[0].toUpperCase() + r.card.slice(1), headline, tag: escalated ? word("ask", reason) : word("actor", "Director"), id: c.id, href, title, problem, situation: stored || problem, escalated, actions, ...(more.length ? { more } : {}),
    ...(!escalated ? {} : c.lesson ? { always: proposalAlways(c.lesson) } : r.always ? { always: alwaysFor(reason, r.always, actions[0]?.label) } : {}),
    details: detailsFor(c), ...(repo ? { repo } : {}), ...(priority ? { priority } : {}),
  };
}

/**
 * The asks: runs that await, then issues that await, then proposals. `runs` are the awaiting runs, each with its `ask`;
 * `issues` the issues that hold an Ask.
 */
export function attend(s: { runs: Job[]; issues: NewIssue[] }, lessons: Lesson[] = openProposals()): { items: AskItem[] } {
  const out: AskItem[] = [];
  const add = (it: AskItem) => out.push(it);
  const rank = Object.keys(ASK_REASONS);
  const runs = s.runs.filter((j) => j.ask && ASK_REASONS[j.ask.reason]).sort((a, b) => rank.indexOf(a.ask!.reason) - rank.indexOf(b.ask!.reason));
  for (const j of runs) add(item(j.ask!.reason, { id: j.name, run: j }, `run:${j.name}`, jobHref(j.id), j.item?.title ?? "", j.repo, j.ask!.kind, j.item?.priority));
  for (const i of s.issues) add(item(reasonOf(i.reason), { id: i.id, issue: i }, `issue:${i.id}`, i.href, i.title, parseId(i.id)?.repo ?? "", i.askKind, i.priority));
  for (const l of lessons) {
    const reason = `proposal-${l.kind ?? "skill"}`;
    if (ASK_REASONS[reason]) add(item(reason, { id: l.id, lesson: l }, `proposal:${l.id}`, "", l.title || l.sentence));
  }
  return { items: out };
}

/** The asks alone. */
export const asks = (s: { runs: Job[]; issues: NewIssue[] }, lessons?: Lesson[]): AskItem[] => attend(s, lessons).items;

/** The open issue a stuck job cannot succeed before: the part's own first `after`, else one its last run's reason names. */
export interface Blocker { id: string; title: string; href: string }
export function stuckBlocker(j: Pick<Job, "repo" | "item" | "reason">, after: string | null | undefined, open: ReadonlyMap<string, { title: string; href: string }>): Blocker | null {
  const own = j.item ? `${j.repo}-${j.item.id}` : "";
  const hit = (id: string): Blocker | null => (id !== own && open.has(id) ? { id, ...open.get(id)! } : null);
  const w = after?.trim();
  if (w && hit(w)) return hit(w);
  for (const id of refs(j.reason ?? "")) if (hit(id)) return hit(id);
  return null;
}

