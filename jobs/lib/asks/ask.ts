/**
 * The Ask module: what a run, an issue or a part needs from Chris, and its whole lifecycle. It holds the reasons and
 * what each one offers, sets an Ask on an issue, says which actor (Chris or the director) may take which action on it,
 * and says what clears it. Every new Ask goes to the director first (director.ts); it reaches Chris when the director escalates it, or at once when an Always rule grants the reason `user`. Callers do not read the Ask fields or test reason names for these rules.
 *
 * The Ask of an issue and of its runs is one: `ask` of the issue's row in `issue_state` (record.ts). While a run awaits Chris
 * the row names that run in `ask_job`, and the run reads it as its own `ask`; else the Ask is on the issue.
 * The issue store keeps no Ask. A run that set an Ask on its issue has `asked` set, with the
 * spec's version when it asked about the spec.
 *
 * The `always` setting maps a key to `{ action, at }`. A key is a reason (all projects) or a reason, a colon and a project key (one project).
 */
import { logEvent, logSetting } from "../../../lib/layout.ts";
import { BECAUSE, because, detailOf, key, parseKey, word, type AskAction, type Event } from "../../../lib/naming.ts";
import { alwaysRow, INTAKE_TRIES, RUN_CAP, setAlwaysRow } from "../infra/settings.ts";
import { NO_COMMIT_LIMIT } from "../gates/issue-decision.ts";
import { specVersion } from "../roles/issue-spec.ts";
import * as issues from "../../../lib/todo.ts";
import { isDropped, reopen, writeList, type Place } from "../../../lib/store.ts";
import { afterOf, parentOf, partsOf, setAfter, setPlan } from "../../../lib/todo.ts";
import type { Entry } from "../records/ledger.ts";
import * as record from "../records/record.ts";
import { errText } from "../../../lib/errtext.ts";

export interface Ask {
  reason: string;
  question: string;
  options: { label: string; line: string; after?: string }[];
  recommended?: string;
  why: string[];
  /** What the factory counted when it set the Ask, as `3 / 3 jobs with no commit`: the `question` event's detail takes it after the reason. */
  facts?: string;
  /** A short noun phrase for the card's title, after the kind: "the TypeScript 5.9 to 7.0 upgrade". */
  headline?: string;
  /** Plain sentences on what this item is about and why it waits for Chris. */
  situation?: string;
  /** What the case text left out, or what the director put apart: shown under Details. */
  details?: string;
  /** One per action of the reason. For a decision with options, `action` may be `decide:<option label>`. */
  effects?: { action: string; text: string }[];
  /** The action the factory recommends, and why. */
  recommend?: { action: string; why: string };
}

/** The three kinds of card. Approve: finished work that waits for an OK. Decide: a choice only Chris can make. Unstick: work that stopped and needs a direction. */
export type Card = "approve" | "decide" | "unstick";

export interface Reason {
  actions: AskAction[];
  /** The action the Always button takes: the first verb of the pair. */
  always: AskAction;
  /** The word a run's news and prompts use for this wait: a word of the sub set (lib/naming.ts). */
  needs?: "question" | "protected" | "review";
  /** The card's kind, and the name and one line the Automation page names the reason by. */
  card: Card; name: string; line: string;
  /** The card's fixed problem text; `{id}` is the issue or run it is about. */
  problem: string;
  /** What the `continue` action is called and does for this reason. */
  continue?: { label: string; hint: string };
  /** Only Chris decides this reason: it goes on the director's escalation list, with this as the why. */
  chrisOnly?: string;
}
interface Granted { action: string; at: string }

/**
 * Every reason the factory asks Chris, in the order the page lists the runs that wait. The first group is the spec's Ask
 * reasons. The second group is kept as it was, because the spec names no new home for it: run-cap.
 */
const REASONS = {
  "held-path": { actions: ["approve", "disapprove"], always: "approve", needs: "protected", card: "approve", name: "Lands on held paths",
    line: "A job that changes a held path, after its checks and review pass.", problem: "The run for {id} changes a path the repo holds for review, so the factory did not land it." },
  "review-held": { actions: ["approve", "disapprove"], always: "approve", needs: "review", card: "approve", name: "Reviewer holds",
    line: "The reviewer held the job and no fix rounds are left.", problem: "The reviewer could not reach a verdict on {id} in two tries." },
  "question": { actions: ["resolve", "dismiss"], always: "resolve", needs: "question", card: "decide", name: "Questions",
    line: "A job or an intake stopped on a choice that the spec leaves open.", problem: "An answer is needed." },
  "no-commit": { actions: ["continue", "discontinue"], always: "continue", card: "unstick", name: "Jobs with no commit",
    get line() { return `The last ${NO_COMMIT_LIMIT} jobs of an issue ended with nothing committed.`; },
    get problem() { return `The last ${NO_COMMIT_LIMIT} runs of {id} ended with no commit, so the factory stopped starting it.`; },
    continue: { label: "Start a new run", hint: "Clears the Ask and lets the factory start a new run of the issue." } },
  // Its options are Close as done and Keep open (decideAsk); `dismiss` drops the issue.
  "part-dropped": { actions: ["resolve", "dismiss"], always: "resolve", card: "decide", name: "Dropped sub-issues",
    line: "A sub-issue of an issue was dropped and no other sub-issue is open.", problem: "A sub-issue of {id} was dropped and no other sub-issue of it is open." },
  "intake-failed": { actions: ["continue", "discontinue"], always: "continue", card: "unstick", name: "Failed intake",
    get line() { return `Intake of an issue failed ${INTAKE_TRIES() === 2 ? "twice" : `${INTAKE_TRIES()} times`}.`; },
    problem: "Intake of {id} failed: it gave no verdict, so no one has decided what to do with this issue.",
    continue: { label: "Run intake again", hint: "Removes the Ask; intake runs again at once." } },
  "rescue": { actions: ["resolve", "dismiss"], always: "resolve", card: "decide", name: "Rescue of a failed job",
    line: "A failed job with more than one way out.", problem: "An answer is needed." },
  // Not Ask reasons of the spec; no new home is named for them.
  "run-cap": { actions: ["continue", "discontinue"], always: "continue", card: "unstick", name: "Job cap",
    get line() { return `An issue started ${RUN_CAP()} times in one hour.`; },
    get problem() { return `The factory started {id} ${RUN_CAP()} times in one hour, so it stopped starting it until it is run again.`; },
    continue: { label: "Start it again", hint: "Clears the Ask and lets the factory start the issue again." } },
  // Held by the memory re-check on a core note; the director never decides it. Its issue is parked, so no work starts on it.
  "core-change": { actions: ["approve", "disapprove"], always: "approve", card: "approve", name: "Core note changes",
    line: "The memory re-check holds a correct or archive verdict on a core note.", problem: "The memory re-check holds a change to a core note, {id}.", chrisOnly: "a change to a core note is Chris's" },
  // The issue is parked; its option `Remove the link` opens it, `Drop the waiter` drops it (decideAsk).
  "blocker-dropped": { actions: ["resolve", "dismiss"], always: "resolve", card: "decide", name: "Dropped blockers",
    line: "An issue waits after an issue that was dropped.", problem: "{id} waits after an issue that was dropped, so it is parked.", chrisOnly: "an after link to a dropped issue is Chris's" },
} satisfies Record<string, Reason>;

/** The limits on the text a card shows, in words: the title phrase, the case text, and each choice's text. */
export const LIMITS = { headline: 12, situation: { words: 100 }, choice: { words: 50 } } as const;

/** The sentences of a text, in order. A full stop inside a word or a path is not an end. */
const sentencesOf = (text: string): string[] => text.trim().split(/(?<=[.!?]["')\]]?)\s+/).filter(Boolean);

/** The count of words in a text. */
export const wordsOf = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

/**
 * The text within a limit and the rest. Whole sentences only: the first sentence stays whole even when it is over the
 * word limit, and later sentences stay while the words fit.
 */
export function limitText(text: string, limit: { words: number }): { kept: string; rest: string } {
  const all = sentencesOf(text);
  let n = 0, len = 0;
  for (const s of all) {
    const next = len + wordsOf(s);
    if (n > 0 && next > limit.words) break;
    n++; len = next;
  }
  return { kept: all.slice(0, n).join(" "), rest: all.slice(n).join(" ") };
}

/** A reason the table names. A stored Ask keeps its reason as a string. */
export type AskReason = keyof typeof REASONS;
export const ASK_REASONS: Record<string, Reason> = REASONS;

/** A stored reason as a known one: a reason the table does not name reads as a plain question. */
export const reasonOf = (given: string | undefined): string => (given && ASK_REASONS[given] ? given : "question");

/** The detail of an Ask's `question` event: its reason, then its facts; throws on a reason the table does not name. */
export const askDetail = (ask: Pick<Ask, "reason" | "facts">): string => detailOf("question", ask.reason, ask.facts, Object.keys(ASK_REASONS));

/** An issue whose Ask waits for Chris: open, or parked with a core-change or blocker-dropped Ask. */
export const asking = (item: issues.Issue, ask: Ask | null): ask is Ask =>
  !!ask && (issues.status(item) === "open" || (issues.status(item) === "parked" && (ask.reason === "core-change" || ask.reason === "blocker-dropped")));

/** The kind of wait an ask is, from its reason: question, protected or review; else none. */
export const needsOf = (ask: Ask | undefined): Reason["needs"] => (ask ? ASK_REASONS[ask.reason]?.needs : undefined);

/** What an awaiting run waits on. A run with no ask of its own asks a question. */
export const waitOf = (ask: Ask | undefined): Pick<Ask, "reason"> => ({ reason: ask ? ask.reason : "question" });

/** The actions a card offers: its reason's pair of verbs, the same on a run and on an issue. */
export const actionsOn = (reason: string): string[] => ASK_REASONS[reason].actions;

/** An Ask with no options: the factory's own stop, with the sentence Chris reads. */
export const plainAsk = (reason: AskReason, question: string, why: string[] = []): Ask => ({ reason, question, options: [], why });

const SEP = " :: ";
const MAX_WHY = 4;
const clean = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").replace(/"/g, "'").replace(/\\/g, "/").trim() : "");

/**
 * An Ask from loose input (a verdict's JSON), or null when it has no usable question, 2–4 options, or a
 * `recommended` that is not an option's label. `reason` defaults to a plain question.
 */
export function normalizeAsk(raw: any, defaults: { reason?: string } = {}): Ask | null {
  if (!raw || typeof raw !== "object") return null;
  const question = clean(raw.question);
  if (!question || !Array.isArray(raw.options) || raw.options.length < 2 || raw.options.length > 4) return null;
  const options = raw.options.map((o: any) => {
    const ref = parseKey(clean(o?.after));
    return { label: clean(o?.label).replaceAll(SEP.trim(), ":"), line: clean(o?.line), ...(ref?.kind === "issue" ? { after: key("issue", ref.n) } : {}) };
  });
  if (options.some((o: { label: string }) => !o.label) || new Set(options.map((o: { label: string }) => o.label)).size !== options.length) return null;
  const recommended = clean(raw.recommended);
  if (recommended && !options.some((o: { label: string }) => o.label === recommended)) return null;
  const why = (Array.isArray(raw.why) ? raw.why : []).map(clean).filter(Boolean).slice(0, MAX_WHY);
  return { reason: clean(raw.reason) || defaults.reason || "question", question, options, ...(recommended ? { recommended } : {}), why };
}



/** The key of an item: `issue.<n>`, the key of its row in `issue_state`. */
export const refIn = (item: issues.Issue): string => key("issue", item.id);

/** The Ask on the issue `ref`, or null. A run's Ask is the run's, not the issue's. */
export const askOf = (ref: string): Ask | null => record.issueAsk(record.read(ref));

/** The Ask on `item`, or null. */
export const askOfItem = (item: issues.Issue): Ask | null => askOf(refIn(item));

/** The issue `ref` waits for Chris: it has an Ask. */
export const awaitsChris = (ref: string): boolean => askOf(ref) !== null;

/** Put `ask` on the issue `ref`. */
export const setAsk = (ref: string, ask: Ask): void => record.setIssueAsk(ref, ask);

/** Take the issue's Ask off. */
export const clearAsk = (ref: string): void => record.setIssueAsk(ref, null);

const reasonFor = (reason: string): Reason | undefined => ASK_REASONS[reason.replace(/:[^:]*$/, "")];
/** `user` sends the Ask to Chris with no director run; every reason takes it. */
const USER = "user";
/** The grants some code acts on: the reason's first verb, `user`, `discontinue` for intake-failed. */
const allows = (reason: string, r: Reason, action: string): boolean =>
  action === r.always || action === USER || (action === "discontinue" && reason.startsWith("intake-failed"));

/** The old words of a stored grant and the verbs they read as. */
const RENAMED: Record<string, string> = { recommended: "resolve", retry: "continue" };

/** The `always` setting. A missing row is empty; a grant of an old word reads as its verb; an entry that grant() would refuse is ignored. */
export const readAlways = (): Record<string, Granted> =>
  Object.fromEntries(Object.entries(alwaysRow<Granted>())
    .map(([reason, g]) => [reason, { ...g, action: RENAMED[g?.action] ?? g?.action }] as [string, Granted])
    .filter(([reason, g]) => { const r = reasonFor(reason); return r && allows(reason, r, g.action); }));

const write = (s: Record<string, Granted>): void => setAlwaysRow(s);

/** The Always rule for `reason`, or null: with a `project`, that project's rule, else the rule for all projects. */
export const always = (reason: string, project?: string): Granted | null => { const s = readAlways(); return (project && s[`${reason}:${project}`]) || s[reason] || null; };

/** Let the factory take `action` for `reason` without asking. Returns why it could not, or null. */
export function grant(reason: string, action: string): string | null {
  const r = reasonFor(reason);
  if (!r) return `unknown reason ${reason}; known: ${Object.keys(ASK_REASONS).join(", ")}`;
  if (!allows(reason, r, action)) return `${reason} has no action ${action}; actions: ${r.actions.join(", ")}`;
  write({ ...readAlways(), [reason]: { action, at: new Date().toISOString() } });
  logSetting(detailOf("changed", "Always", `${reason} is ${action}`));
  return null;
}

export function revoke(reason: string): void {
  const s = readAlways();
  if (!(reason in s)) return;
  delete s[reason];
  write(s);
  logSetting(detailOf("changed", "Always", `${reason} is Ask me`));
}

/** The sub of an event about an Ask reason: the reason, its new word or its first word, when one of them has a phrase in BECAUSE. `run-cap` is `capped`, `intake-failed` is `intake`. */
export const askSub = (reason: string): string | undefined => [reason, word("ask", reason), reason.split("-")[0]].find((w) => w in BECAUSE);

/** The log event of an Always rule that acted on `ref`: `action` is what it did, from ACTIONS. */
export const logAlways = (reason: string, ref: string, action: string, more: Partial<Event> = {}): void => {
  logEvent({ subject: "rule", action, object: ref, detail: because(askSub(reason) ?? ""), ...more });
};

/**
 * Put `ask` on item `id` with the note `asks Chris: <said>`, as one store write. With `said` null the Ask is set and
 * no note is added (the caller has written the text once already). Returns why it could not, or null.
 */
export function askChris(place: Place, id: number | string, ask: Ask, said: string | null): string | null {
  const text = said === null ? "" : `asks Chris: ${said}`;
  try {
    let found = false;
    writeList(place, `todo: item ${id}: ${text}`, (doc) => {
      const item = issues.find(doc, id);
      if (!item) return null;
      found = true;
      return said === null ? null : issues.note(item, text);
    });
    if (!found) return `no issue ${id}`;
    setAsk(key("issue", Number(id)), ask);
    return null;
  } catch (e) {
    return errText(e);
  }
}

/**
 * A run asks Chris: the run is marked `asked`, so it no longer holds the factory, and its issue gets `ask`.
 * With `spec`, the run asked about that issue's spec: it waits for a spec edit (`waitsForSpecEdit`).
 * Returns why the issue got no Ask, or null.
 */
export function askFromRun(e: Entry, place: Place, issue: number | string | undefined, ask: Ask, said: string, spec?: issues.Issue): string | null {
  markAsked(e, said, spec ? specVersion(spec) : undefined);
  return issue === undefined ? "no issue" : askChris(place, issue, ask, said);
}

/** The factory set an Ask on the run's issue: the run no longer holds the factory. */
export const asked = (e: Entry): boolean => record.getRun(e.id)?.asked !== undefined;
/** Record that the run asked `question`; `spec` is the spec version when it asked about the spec. */
export const markAsked = (e: Entry, question: string, spec?: string): void =>
  void record.patchRun(e.id, { asked: { at: new Date().toISOString(), question, ...(spec ? { spec } : {}) } });

/** A run that asked about its issue's spec and waits for a spec edit: the spec version it asked about and its question; else null. */
export function waitsForSpecEdit(e: Entry): { version: string; question: string } | null {
  const a = e.run.asked;
  return a?.spec !== undefined ? { version: a.spec, question: a.question } : null;
}

export const PLAN_REST = "Keep open";
export const CLOSE_DONE = "Close as done";
/**
 * The part-dropped Ask's options. An Ask stored before they had these labels names them "Close with what landed" and
 * "Plan the missing part", with the same lines, so its answers are read by the lines.
 */
export const PART_DROPPED: Ask["options"] = [
  { label: CLOSE_DONE, line: "Close the issue: the sub-issues that landed are enough." },
  { label: PLAN_REST, line: "Plan a new sub-issue for what the dropped sub-issue was to do." },
];
/** An answer to the part-dropped Ask keeps the issue open: it names Keep open or its line. */
export const keepsOpen = (said: string): boolean => said.includes(PLAN_REST) || said.includes(PART_DROPPED[1].line);

/**
 * Called in the write that sets part `part` to dropped: when its parent is open, has no Ask and no other open part,
 * the parent gets the part-dropped Ask, so the same commit that drops the part asks Chris what now.
 */
export function askIfPartDropped(doc: issues.Doc, part: issues.Issue, reason: string): void {
  if (issues.status(part) !== "dropped") return;
  const issue = parentOf(doc, part);
  if (!issue || !doc.repo || issues.status(issue) !== "open" || awaitsChris(refIn(issue))) return;
  if (partsOf(doc, issue).some((g) => g !== part && issues.status(g) === "open")) return;
  askPartDropped(issue, `Sub-issue ${doc.repo}-${part.id} was dropped: ${reason}. What now?`);
}

/** Put the part-dropped Ask on a parent. */
export function askPartDropped(issue: issues.Issue, question: string): void {
  setAsk(refIn(issue), {
    reason: "part-dropped",
    question,
    options: PART_DROPPED,
    why: [],
  });
}

/** Who decides an Ask: the director first, and Chris when it escalates. */
export type Actor = "chris" | "director";

/**
 * Why `actor` may not take `action` on `ask`, or null when it may. Chris may take the actions the card offers. The director may not answer an Ask whose run waits for a spec edit (`on.waiting`, that run's name):
 * clearing it would leave the job open with no Ask and no run. What the director may not decide at all is the
 * escalation list in director.ts.
 */
export function may(actor: Actor, action: string, ask: Ask | null | undefined, on: { waiting?: string } = {}): string | null {
  if (!ask) return "it has no Ask";
  if (actor === "chris") {
    const offered = ASK_REASONS[ask.reason] ? actionsOn(ask.reason) : [];
    return offered.includes(action) ? null : `its ${ask.reason} Ask offers no ${action}`;
  }
  if (action !== "answer") return null;
  if (on.waiting) return `the run ${on.waiting} asked about the spec and waits for a spec edit; use edit, or drop it`;
  return null;
}


/** The label of the blocker-dropped Ask's option that drops the waiter. */
export const DROP_WAITER = "Drop the waiter";

/**
 * What a decision on `ask` does to the item, in the write that notes the decision `said`: on the part-dropped Ask, the
 * Keep open option sets `plan`, and any other answer closes the issue. On the blocker-dropped Ask, the drop option drops the
 * issue, and any other answer reopens it (`since` as `reopen` sets it) without its links to dropped issues. The caller clears the Ask after that write.
 */
export function decideAsk(ask: Ask | null, doc: issues.Doc, item: issues.Issue, said: string, since: string | null): void {
  if (ask?.reason === "blocker-dropped") {
    const drop = ask.options.find((o) => o.label === DROP_WAITER);
    if (drop && (said.includes(drop.label) || said.includes(drop.line))) issues.setStatus(item, "dropped", undefined, said);
    else { setAfter(item, afterOf(item).filter((r) => !isDropped(r))); reopen(doc, item, since); }
    return;
  }
  if (ask?.reason !== "part-dropped") return;
  if (keepsOpen(said)) setPlan(item, true);
  else issues.setStatus(item, "done");
}
