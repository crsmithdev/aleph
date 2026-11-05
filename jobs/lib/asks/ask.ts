/**
 * The Ask module: what a run, an issue or a part needs from Chris, and its whole lifecycle. It holds the reasons and
 * what each one offers, sets an Ask on an issue, says which actor (Chris or the director) may take which action on it,
 * and says what clears it. Every new Ask goes to the director first (director.ts); it reaches Chris when the director escalates it. Callers do not read the Ask fields or test reason names for these rules.
 *
 * The Ask of an issue and of its runs is one: `ask` of the issue's job record (record.ts). While a run awaits Chris
 * the record names that run in `askRun`, and the run reads it as its own `ask`; else the Ask is on the issue.
 * The issue store keeps no Ask. A run that set an Ask on its issue has an `asked` event in the record, with the
 * spec's version when it asked about the spec.
 *
 * `always.json` in the factory dir maps a reason to `{ action, at }`.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { layout, logEvent } from "../infra/layout.ts";
import { SUBS, word, type Event } from "../../../lib/naming.ts";
import { specVersion } from "../roles/issue-spec.ts";
import * as issues from "../../../issues/lib/todo.ts";
import { parentOf, partsOf, writeList, type Place } from "../../../issues/lib/store.ts";
import type { Entry } from "../records/ledger.ts";
import * as record from "../records/record.ts";

export interface Ask {
  kind: "input" | "approval";
  reason: string;
  question: string;
  options: { label: string; line: string; after?: string }[];
  recommended?: string;
  why: string[];
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

export interface Reason {
  kind: Ask["kind"];
  actions: string[];
  /** The action the Always button takes. Empty: the factory has no rule that acts on this reason, so the card offers no auto-yes. */
  always: string;
  /** The word a run's news and prompts use for this wait: a word of the sub set (lib/naming.ts). */
  needs?: "question" | "protected" | "review";
}
export interface Granted { action: string; at: string }

const proposal: Reason = { kind: "approval", actions: ["approve", "decline"], always: "approve" };

/**
 * Every reason the factory asks Chris. The first group is the spec's Ask reasons. The second group is kept as it was,
 * because the spec names no new home for it: run-cap and the `proposal-<kind>:<place>` keys.
 */
const REASONS = {
  "held-path": { kind: "approval", actions: ["land", "drop"], always: "", needs: "protected" },
  "review": { kind: "approval", actions: ["land", "drop"], always: "", needs: "review" },
  // Was `decision` (decide, deny; recommended) and `question` (answer, drop): one reason now, so it lists both.
  "question": { kind: "input", actions: ["answer", "drop", "decide", "deny"], always: "recommended", needs: "question" },
  "no-commit": { kind: "input", actions: ["rerun", "close"], always: "" },
  "part-dropped": { kind: "input", actions: ["rerun", "close"], always: "" },
  "intake-failed": { kind: "input", actions: ["retry", "close"], always: "retry" },
  "rescue": { kind: "input", actions: ["decide", "drop"], always: "recommended" },
  // Not Ask reasons of the spec; no new home is named for them.
  "run-cap": { kind: "input", actions: ["rerun", "close"], always: "" },
  "proposal-check": proposal,
  "proposal-claude-md": proposal,
  "proposal-skill": proposal,
} satisfies Record<string, Reason>;

/** The limits on the text a card shows, in words: the title phrase, the case text, and each choice's text. */
export const LIMITS = { headline: 12, situation: { words: 100 }, choice: { words: 50 } } as const;

/** The sentences of a text, in order. A full stop inside a word or a path is not an end. */
export const sentencesOf = (text: string): string[] => text.trim().split(/(?<=[.!?]["')\]]?)\s+/).filter(Boolean);

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

/** The kind of an Ask: the ask's own, else from its reason. */
export const kindOf = (reason: string, given?: string): Ask["kind"] =>
  given === "input" || given === "approval" ? given : ASK_REASONS[reason]?.kind ?? "input";

/** The kind of wait an ask is, from its reason: question, protected or review; else none. */
export const needsOf = (ask: Ask | undefined): Reason["needs"] => (ask ? ASK_REASONS[ask.reason]?.needs : undefined);

/** What an awaiting run waits on. A run with no ask of its own asks a question. */
export const waitOf = (ask: Ask | undefined): Pick<Ask, "kind" | "reason"> => (ask ? { kind: ask.kind, reason: ask.reason } : { kind: "input", reason: "question" });

/** The actions a card offers. One reason serves a worker's question (a run) and an issue's (a decision): the context picks them. */
export function actionsOn(reason: string, on: { run: boolean; decision: boolean }): string[] {
  if (reason === "question") return on.run ? ["answer", "drop"] : ["decide", "deny"];
  if (reason === "part-dropped") return on.decision ? ["decide", "close"] : ["rerun", "close"];
  return ASK_REASONS[reason].actions;
}

/** An Ask with no options: the factory's own stop, with the sentence Chris reads. */
export const plainAsk = (reason: AskReason, question: string, why: string[] = []): Ask => ({ kind: kindOf(reason), reason, question, options: [], why });

const SEP = " :: ";
const MAX_WHY = 4;
const REF = /^[\w.-]+-\d+(\.\d+)?$/;
const clean = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").replace(/"/g, "'").replace(/\\/g, "/").trim() : "");

/**
 * An Ask from loose input (a verdict's JSON), or null when it has no usable question, 2–4 options, or a
 * `recommended` that is not an option's label. `kind` and `reason` default to a plain question.
 */
export function normalizeAsk(raw: any, defaults: { kind?: Ask["kind"]; reason?: string } = {}): Ask | null {
  if (!raw || typeof raw !== "object") return null;
  const question = clean(raw.question);
  if (!question || !Array.isArray(raw.options) || raw.options.length < 2 || raw.options.length > 4) return null;
  const options = raw.options.map((o: any) => {
    const after = clean(o?.after);
    return { label: clean(o?.label).replaceAll(SEP.trim(), ":"), line: clean(o?.line), ...(REF.test(after) ? { after } : {}) };
  });
  if (options.some((o: { label: string }) => !o.label) || new Set(options.map((o: { label: string }) => o.label)).size !== options.length) return null;
  const recommended = clean(raw.recommended);
  if (recommended && !options.some((o: { label: string }) => o.label === recommended)) return null;
  const why = (Array.isArray(raw.why) ? raw.why : []).map(clean).filter(Boolean).slice(0, MAX_WHY);
  const kind = raw.kind === "approval" || raw.kind === "input" ? raw.kind : defaults.kind ?? "input";
  return { kind, reason: clean(raw.reason) || defaults.reason || "question", question, options, ...(recommended ? { recommended } : {}), why };
}



/** The ref of an item in repo `key`: `<key>-<n>`, the key of its job record. */
export const refIn = (key: string, item: issues.Issue): string => `${key}-${issues.refOf(item)}`;

/** The Ask on the issue `ref`, or null. A run's Ask is the run's, not the issue's. */
export const askOf = (ref: string): Ask | null => record.issueAsk(record.read(ref));

/** The issue `ref` waits for Chris: it has an Ask. */
export const awaitsChris = (ref: string): boolean => askOf(ref) !== null;

/** Put `ask` on the issue `ref`. */
export const setAsk = (ref: string, ask: Ask): void => record.setIssueAsk(ref, ask);

/** Take the issue's Ask off. */
export const clearAsk = (ref: string): void => record.setIssueAsk(ref, null);

/** The prose note of an ask, for the CLI and the history. */
export const askNote = (a: Ask): string =>
  `${a.question}${a.options.length ? ` Options: ${a.options.map((o) => `${o.label}: ${o.line}${o.after ? ` (waits on ${o.after})` : ""}`).join("; ")}.` : ""}` +
  (a.recommended ? ` My recommendation is ${a.recommended}.` : "") +
  (a.why.length ? ` Why: ${a.why.join("; ")}.` : "");

// The Always rules.

const alwaysFile = () => join(layout().factory, "always.json");

function readJson(f: string): Record<string, Granted> | null {
  try {
    const s = JSON.parse(readFileSync(f, "utf8"));
    if (s && typeof s === "object" && !Array.isArray(s)) return s;
  } catch {}
  return null;
}

const reasonFor = (reason: string): Reason | undefined => ASK_REASONS[reason.startsWith("proposal-") ? reason.replace(/:[^:]*$/, "") : reason];
const allows = (r: Reason, action: string): boolean => r.actions.includes(action) || action === r.always;

/** always.json. A missing or bad file is empty. An entry that grant() would refuse is ignored. */
export const readAlways = (): Record<string, Granted> =>
  Object.fromEntries(Object.entries(readJson(alwaysFile()) ?? {}).filter(([reason, g]) => { const r = reasonFor(reason); return r && allows(r, g?.action); }));

function write(s: Record<string, Granted>): void {
  mkdirSync(layout().factory, { recursive: true });
  const tmp = `${alwaysFile()}.tmp`;
  writeFileSync(tmp, JSON.stringify(s, null, 2) + "\n");
  renameSync(tmp, alwaysFile());
}

/** The Always rule for `reason`, or null. */
export const always = (reason: string): Granted | null => readAlways()[reason] ?? null;

/** Let the factory take `action` for `reason` without asking. Returns why it could not, or null. */
export function grant(reason: string, action: string): string | null {
  const r = reasonFor(reason);
  if (!r) return `unknown reason ${reason}; known: ${Object.keys(ASK_REASONS).join(", ")}`;
  if (!allows(r, action)) return `${reason} has no action ${action}; actions: ${[...new Set([...r.actions, r.always])].join(", ")}`;
  write({ ...readAlways(), [reason]: { action, at: new Date().toISOString() } });
  return null;
}

export function revoke(reason: string): void {
  const s = readAlways();
  if (!(reason in s)) return;
  delete s[reason];
  write(s);
  logEvent({ by: "human", subject: reason, action: "changed", sub: askSub(reason), to: "human", note: "set to Ask me" });
}

/** The sub of an event about an Ask reason: the reason, its new word or its first word, when one of them is in SUBS. `run-cap` is `capped`, `intake-failed` is `intake`. */
export const askSub = (reason: string): string | undefined => [reason, word("ask", reason), reason.split("-")[0]].find((w) => SUBS.includes(w));

/** The log event of an Always rule that acted on `ref`: `action` is what it did, from ACTIONS. */
export const logAlways = (reason: string, ref: string, action: string, more: Partial<Event> = {}): void => {
  logEvent({ by: "rule", subject: ref, action, sub: askSub(reason), ...more });
};

// Setting an Ask on an issue.

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
    setAsk(`${place.key}-${id}`, ask);
    return null;
  } catch (e: any) {
    return e?.message ?? String(e);
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

/** The `asked` event of the run in its job record: the factory set an Ask on the run's issue. */
const askedEvent = (e: Entry) => record.read(record.keyOf(e.run))?.events.findLast((x) => x.kind === "asked" && x.run === e.id);

/** The factory set an Ask on the run's issue: the run no longer holds the factory. */
export const asked = (e: Entry): boolean => askedEvent(e) !== undefined;
/** Record that the run asked `question`; `spec` is the spec version when it asked about the spec. */
export const markAsked = (e: Entry, question: string, spec?: string): void =>
  void record.addEvent(record.keyOf(e.run), { kind: "asked", run: e.id, what: question, ...(spec ? { data: { spec } } : {}) });

/** A run that asked about its issue's spec and waits for a spec edit: the spec version it asked about and its question; else null. */
export function waitsForSpecEdit(e: Entry): { version: string; question: string } | null {
  const a = askedEvent(e);
  const version = (a?.data as { spec?: string } | undefined)?.spec;
  return a && version !== undefined ? { version, question: a.what } : null;
}

export const PLAN_REST = "Plan the missing part";

/**
 * Called in the write that sets part `part` to dropped: when its parent is open, has no Ask and no other open part,
 * the parent gets the part-dropped Ask, so the same commit that drops the part asks Chris what now.
 */
export function askIfPartDropped(doc: issues.Doc, part: issues.Issue, reason: string): void {
  if (issues.status(part) !== "dropped") return;
  const issue = parentOf(doc, part);
  if (!issue || !doc.repo || issues.status(issue) !== "open" || awaitsChris(refIn(doc.repo, issue))) return;
  if (partsOf(doc, issue).some((g) => g !== part && issues.status(g) === "open")) return;
  askPartDropped(doc.repo, issue, `Sub-issue ${doc.repo}-${issues.refOf(part)} was dropped: ${reason}. What now?`);
}

/** Put the part-dropped Ask on a parent. */
export function askPartDropped(key: string, issue: issues.Issue, question: string): void {
  setAsk(refIn(key, issue), {
    kind: "input",
    reason: "part-dropped",
    question,
    options: [
      { label: "Close with what landed", line: "Close the issue: the sub-issues that landed are enough." },
      { label: PLAN_REST, line: "Plan a new sub-issue for what the dropped sub-issue was to do." },
    ],
    why: [],
  });
  issues.touch(issue);
}

// Actions.

/** Who decides an Ask: the director first, and Chris when it escalates. */
export type Actor = "chris" | "director";

/**
 * Why `actor` may not take `action` on `ask`, or null when it may. Chris may take the actions the card offers (`on.run`
 * for a run's Ask). The director may not answer an Ask whose run waits for a spec edit (`on.waiting`, that run's name):
 * clearing it would leave the job open with no Ask and no run. What the director may not decide at all is the
 * escalation list in director.ts.
 */
export function may(actor: Actor, action: string, ask: Ask | null | undefined, on: { run?: boolean; waiting?: string } = {}): string | null {
  if (!ask) return "it has no Ask";
  if (actor === "chris") {
    const offered = ASK_REASONS[ask.reason] ? actionsOn(ask.reason, { run: !!on.run, decision: ask.options.length > 0 }) : [];
    return offered.includes(action) ? null : `its ${ask.reason} Ask offers no ${action}`;
  }
  if (action !== "answer") return null;
  if (on.waiting) return `the run ${on.waiting} asked about the spec and waits for a spec edit; use edit, or drop it`;
  return null;
}

// What clears an Ask.


/**
 * What a decision on `ask` does to the item, in the write that notes the decision `said`: on the part-dropped Ask, the
 * plan option sets `plan`, and any other answer closes the issue. The caller clears the Ask after that write.
 */
export function decideAsk(ask: Ask | null, item: issues.Issue, said: string): void {
  if (ask?.reason !== "part-dropped") return;
  const planRest = ask.options.find((o) => o.label === PLAN_REST);
  if (planRest && (said.includes(planRest.label) || said.includes(planRest.line))) item.fm.plan = "true";
  else issues.setStatus(item, "done");
}
