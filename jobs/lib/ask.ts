/**
 * The Ask module: what a run, an issue or a goal needs from Chris, and its whole lifecycle. It holds the reasons and
 * what each one offers, sets an Ask on an issue, routes it to Chris or the firefighter, says which actor may take which
 * action on it, and says what clears it. Callers do not read the Ask fields or test reason names for these rules.
 *
 * A run keeps its Ask whole in `ask` of its state.json. An issue or goal keeps it as flat fields next to its prose note:
 * `ask` (`input` or `approval`), `reason`, `question`, `options` (each `label :: line`, with `:: after <goal id>`
 * when choosing it means waiting for that goal), `recommended` (an option label) and `why` (short context lines).
 * The work store's front matter is flat, so the values are kept free of quotes, backslashes and line breaks.
 *
 * A run that set an Ask on its issue has the file `asked` (the question) in its folder, and `asked-spec` (the spec's
 * version) when it asked about the spec.
 *
 * `always.json` in the factory dir maps a reason to `{ action, at }`.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { factoryLog, layout } from "./layout.ts";
import { missingSections, specVersion } from "./goal-spec.ts";
import * as issues from "../../todo/lib/todo.ts";
import { awaitsChris, parentOf, partsOf, writeList, type Place } from "../../todo/lib/store.ts";
import type { Entry } from "./ledger.ts";
import { runFile, type RunFile } from "./run-files.ts";

export interface Ask {
  kind: "input" | "approval";
  reason: string;
  question: string;
  options: { label: string; line: string; after?: string }[];
  recommended?: string;
  why: string[];
  /** Plain sentences on what this item is about and why it waits for Chris. */
  situation?: string;
  /** What the case text left out, or what the explainer put apart: shown under Details. */
  details?: string;
  /** One per action of the reason. For a decision with options, `action` may be `decide:<option label>`. */
  effects?: { action: string; text: string }[];
  /** The action the factory recommends, and why. */
  recommend?: { action: string; why: string };
}

export interface Reason {
  kind: Ask["kind"];
  /** The short display name of the reason: the first word of a card's title line. */
  name: string;
  actions: string[];
  /** The action the Always button takes. Empty: the factory has no rule that acts on this reason, so the card offers no auto-yes. */
  always: string;
  /** The word a run's news and prompts use for this wait. */
  needs?: "manual" | "question" | "held" | "review";
}
export interface Granted { action: string; at: string }

const proposal: Reason = { kind: "approval", name: "Lesson", actions: ["approve", "decline"], always: "approve" };

/**
 * Every reason the factory asks Chris. The first group is the spec's Ask reasons. The second group is kept as it was,
 * because the spec names no new home for it: run-cap, acceptance-failed, firefighter and the `proposal-<kind>:<place>` keys.
 */
const REASONS = {
  "held-path": { kind: "approval", name: "Approval", actions: ["land", "drop"], always: "firefighter", needs: "held" },
  "review": { kind: "approval", name: "Approval", actions: ["land", "drop"], always: "firefighter", needs: "review" },
  "proposal": { kind: "approval", name: "Proposal", actions: ["start", "deny"], always: "start" },
  // Was `decision` (decide, deny; recommended) and `question` (answer, drop; firefighter): one reason now, so it lists both.
  "question": { kind: "input", name: "Question", actions: ["answer", "drop", "decide", "deny", "firefighter"], always: "recommended", needs: "question" },
  "manual": { kind: "input", name: "Manual check", actions: ["checked", "deny"], always: "", needs: "manual" },
  "no-commit": { kind: "input", name: "No commit", actions: ["rerun", "close"], always: "firefighter" },
  "part-dropped": { kind: "input", name: "Part dropped", actions: ["rerun", "close"], always: "" },
  "triage-failed": { kind: "input", name: "Triage failed", actions: ["retry", "close"], always: "retry" },
  "host-check": { kind: "input", name: "Manual check", actions: ["checked", "deny"], always: "" },
  "spec-check": { kind: "input", name: "Spec check", actions: ["rerun", "close"], always: "firefighter" },
  "rescue": { kind: "input", name: "Question", actions: ["decide", "drop"], always: "recommended" },
  // Not Ask reasons of the spec; no new home is named for them.
  "run-cap": { kind: "input", name: "Run cap", actions: ["rerun", "close"], always: "firefighter" },
  "acceptance-failed": { kind: "input", name: "Acceptance failed", actions: ["rerun", "close"], always: "firefighter" },
  "firefighter": { kind: "approval", name: "Approval", actions: ["land", "drop"], always: "land" },
  "proposal-check": proposal,
  "proposal-claude-md": proposal,
  "proposal-skill": proposal,
} satisfies Record<string, Reason>;

/** The limits on the text a card shows: the case text, and each choice's text. */
export const LIMITS = { situation: { sentences: 3, chars: 600 }, choice: { sentences: 2, chars: 220 } } as const;

/** The sentences of a text, in order. A full stop inside a word or a path is not an end. */
export const sentencesOf = (text: string): string[] => text.trim().split(/(?<=[.!?]["')\]]?)\s+/).filter(Boolean);

/**
 * The text within a limit and the rest. Whole sentences only: the first sentence stays whole even when it is over the
 * character limit, and later sentences stay while the count and the characters fit.
 */
export function limitText(text: string, limit: { sentences: number; chars: number }): { kept: string; rest: string } {
  const all = sentencesOf(text);
  let n = 0, len = 0;
  for (const s of all) {
    const next = len + (n ? 1 : 0) + s.length;
    if (n >= limit.sentences || (n > 0 && next > limit.chars)) break;
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

/** The kind of wait an ask is, from its reason: manual, question, held or review; else none. */
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
/** The words that introduce an option's goal on disk. */
const WAITS = " :: after ";
const clean = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").replace(/"/g, "'").replace(/\\/g, "/").trim() : "");
/** A flat value: cleaned, and with no `::` left, since `::` separates the parts of an effect and a recommendation. */
const flat = (v: unknown): string => clean(v).replace(/:{2,}/g, ":");

/** One option as the line stored in `options`. */
export const encodeOption = (o: { label: string; line: string; after?: string }): string =>
  o.label + SEP + o.line + (o.after ? `${WAITS}${o.after}` : "");

/** An option from its stored line. */
export function decodeOption(s: string): { label: string; line: string; after?: string } {
  const w = s.lastIndexOf(WAITS);
  const after = w >= 0 && REF.test(s.slice(w + WAITS.length)) ? s.slice(w + WAITS.length) : undefined;
  const rest = after ? s.slice(0, w) : s;
  const at = rest.indexOf(SEP);
  const o = at < 0 ? { label: rest, line: "" } : { label: rest.slice(0, at), line: rest.slice(at + SEP.length) };
  return after ? { ...o, after } : o;
}

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

const text = (v: unknown): string => (typeof v === "string" ? v : "");
const lines = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

/** A stored `action :: text` line, split at its first `::`. */
function splitPair(s: string): { action: string; text: string } {
  const at = s.indexOf("::");
  return at < 0 ? { action: s.trim(), text: "" } : { action: s.slice(0, at).trim(), text: s.slice(at + 2).trim() };
}

/** The ask in an item's fields, or null when the item has no `ask`. A reason it does not state reads as `question`. */
export function askOf(item: issues.Issue): Ask | null {
  const kind = item.fm.ask;
  if (kind !== "input" && kind !== "approval") return null;
  const why = item.fm.why;
  const situation = text(item.fm.situation);
  const details = text(item.fm.details);
  const effects = lines(item.fm.effects).map(splitPair);
  const recommend = text(item.fm.recommend) ? splitPair(text(item.fm.recommend)) : null;
  return {
    kind, reason: text(item.fm.reason) || "question", question: text(item.fm.question), options: lines(item.fm.options).map(decodeOption),
    ...(text(item.fm.recommended) ? { recommended: text(item.fm.recommended) } : {}),
    why: typeof why === "string" ? why.split(",").map((s) => s.trim()).filter(Boolean) : lines(why),
    ...(situation ? { situation } : {}),
    ...(details ? { details } : {}),
    ...(effects.length ? { effects: effects.map((e) => ({ action: e.action, text: e.text })) } : {}),
    ...(recommend ? { recommend: { action: recommend.action, why: recommend.text } } : {}),
  };
}

/**
 * Put `ask` on the item: `ask`, `reason`, `question`, `options`, `recommended` and `why`, and the case text when the ask
 * has it: `situation` (one string), `effects` (lines `action :: text`) and `recommend` (`action :: why`), as `askOf` reads them.
 */
export function setAsk(item: issues.Issue, ask: Ask): void {
  clearAsk(item);
  item.fm.ask = ask.kind;
  item.fm.reason = ask.reason;
  item.fm.question = ask.question;
  if (ask.options.length) item.fm.options = ask.options.map((o) => encodeOption(o));
  if (ask.recommended) item.fm.recommended = ask.recommended;
  item.fm.why = ask.why;
  const situation = flat(ask.situation);
  if (situation) item.fm.situation = situation;
  const details = flat(ask.details);
  if (details) item.fm.details = details;
  const effects = (ask.effects ?? []).filter((e) => flat(e.action)).map((e) => `${flat(e.action)}${SEP}${flat(e.text)}`);
  if (effects.length) item.fm.effects = effects;
  if (ask.recommend && flat(ask.recommend.action)) item.fm.recommend = `${flat(ask.recommend.action)}${SEP}${flat(ask.recommend.why)}`;
}

/** Take the item's Ask off. */
export function clearAsk(item: issues.Issue): void {
  for (const k of ["ask", "reason", "question", "options", "recommended", "why", "situation", "details", "effects", "recommend"]) delete item.fm[k];
}

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

/** always.json. A missing or bad file is empty. */
export const readAlways = (): Record<string, Granted> => readJson(alwaysFile()) ?? {};

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
  const r = ASK_REASONS[reason.startsWith("proposal-") ? reason.replace(/:[^:]*$/, "") : reason];
  if (!r) return `unknown reason ${reason}; known: ${Object.keys(ASK_REASONS).join(", ")}`;
  if (!r.actions.includes(action) && action !== r.always) return `${reason} has no action ${action}; actions: ${[...new Set([...r.actions, r.always])].join(", ")}`;
  write({ ...readAlways(), [reason]: { action, at: new Date().toISOString() } });
  return null;
}

export function revoke(reason: string): void {
  const s = readAlways();
  if (!(reason in s)) return;
  delete s[reason];
  write(s);
  factoryLog(`always: revoked ${reason}`);
}

export const logAlways = (reason: string, action: string, ref: string): void => factoryLog(`always: ${reason}: ${action} on ${ref}`);

// Setting an Ask on an issue.

/**
 * Put `ask` on item `id` with the note `asks Chris: <said>`, as one store write. With `said` null the Ask is set and
 * no note is added (the caller has written the text once already). Returns why it could not, or null.
 */
export function askChris(place: Place, id: number | string, ask: Ask, said: string | null): string | null {
  const text = said === null ? "" : `asks Chris: ${said}`;
  try {
    const w = writeList(place, `todo: item ${id}: ${text}`, (doc) => {
      const item = issues.find(doc, id);
      if (!item) return null;
      setAsk(item, ask);
      return said === null ? item : issues.note(item, text);
    });
    return w ? null : `no issue ${id}`;
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
  if (spec) writeFileSync(runFile(e.folder, "asked-spec"), specVersion(spec) + "\n");
  markAsked(e, said);
  return issue === undefined ? "no issue" : askChris(place, issue, ask, said);
}

/** The factory set an Ask on the run's issue: the run no longer holds the factory. */
export const asked = (e: Entry): boolean => existsSync(runFile(e.folder, "asked"));
export const markAsked = (e: Entry, question: string): void => writeFileSync(runFile(e.folder, "asked"), question + "\n");

const readRunFile = (e: Entry, name: RunFile): string | undefined => {
  try { return readFileSync(runFile(e.folder, name), "utf8"); } catch { return undefined; }
};

/** A run that asked about its issue's spec and waits for a spec edit: the spec version it asked about and its question; else null. */
export function waitsForSpecEdit(e: Entry): { version: string; question: string } | null {
  const version = readRunFile(e, "asked-spec");
  if (version === undefined || !asked(e)) return null;
  return { version, question: (readRunFile(e, "asked") ?? "").trim() };
}

export const PLAN_REST = "Plan the missing part";

/**
 * Called in the write that sets part `part` to dropped: when its parent is open, has no Ask and no other open part,
 * the parent gets the part-dropped Ask, so the same commit that drops the part asks Chris what now.
 */
export function askIfPartDropped(doc: issues.Doc, part: issues.Issue, reason: string): void {
  if (issues.status(part) !== "dropped") return;
  const issue = parentOf(doc, part);
  if (!issue || issues.status(issue) !== "open" || awaitsChris(issue)) return;
  if (partsOf(doc, issue).some((g) => g !== part && issues.status(g) === "open")) return;
  askPartDropped(issue, `Part ${doc.repo}-${issues.refOf(part)} was dropped: ${reason}. What now?`);
}

/** Put the part-dropped Ask on a parent. */
export function askPartDropped(issue: issues.Issue, question: string): void {
  setAsk(issue, {
    kind: "input",
    reason: "part-dropped",
    question,
    options: [
      { label: "Close with what landed", line: "Close the issue: the parts that landed are enough." },
      { label: PLAN_REST, line: "Plan a new part for what the dropped part was to do." },
    ],
    why: [],
  });
  issue.fm.updated = issues.today();
}

// Routing and actions.

/** Who decides an Ask. */
export type Actor = "chris" | "firefighter";

/** Who an Ask of this reason goes to: the firefighter when Chris handed the reason to it (Always: firefighter), else Chris. */
export const routeOf = (reason: string): Actor => (always(reason)?.action === "firefighter" ? "firefighter" : "chris");

/**
 * Why `actor` may not take `action` on `ask`, or null when it may. Chris may take the actions the card offers (`on.run`
 * for a run's Ask). The firefighter may not answer a product choice (a question with options) unless Chris handed its
 * reason to it, nor an Ask whose run waits for a spec edit (`on.waiting`, that run's name): clearing it would leave
 * the job open with no Ask and no run.
 */
export function may(actor: Actor, action: string, ask: Ask | null | undefined, on: { run?: boolean; waiting?: string } = {}): string | null {
  if (!ask) return "it has no Ask";
  if (actor === "chris") {
    const offered = ASK_REASONS[ask.reason] ? actionsOn(ask.reason, { run: !!on.run, decision: ask.options.length > 0 }) : [];
    return offered.includes(action) ? null : `its ${ask.reason} Ask offers no ${action}`;
  }
  if (action !== "answer") return null;
  if (ask.options.length && routeOf(ask.reason) !== "firefighter") return "its question is a product choice, which is Chris's";
  if (on.waiting) return `the run ${on.waiting} asked about the spec and waits for a spec edit; use edit, or drop it`;
  return null;
}

// What clears an Ask.

/**
 * Whether the firefighter's edit of a goal's spec answers its Ask. Only a spec-check Ask is about the spec, only when
 * Chris handed spec-check to the firefighter, and only a body with Goal, Edit surface and Oracle. The goal's next first
 * worker run checks the spec again, and holds again if it still lacks something.
 */
export const editAnswers = (ask: Ask | null, body: string | undefined): boolean =>
  body !== undefined && ask?.reason === "spec-check" && routeOf(ask.reason) === "firefighter" && missingSections(body).length === 0;

/**
 * A decision clears the item's Ask; called in the write that notes the decision `said`. On the part-dropped Ask, the
 * plan option sets `plan`, and any other answer closes the issue.
 */
export function decideAsk(item: issues.Issue, said: string): void {
  const ask = askOf(item);
  clearAsk(item);
  if (ask?.reason !== "part-dropped") return;
  const planRest = ask.options.find((o) => o.label === PLAN_REST);
  if (planRest && (said.includes(planRest.label) || said.includes(planRest.line))) item.fm.plan = "true";
  else issues.setStatus(item, "done");
}
