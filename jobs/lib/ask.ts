/**
 * An Ask: what a run, an issue or a goal needs from Chris, and every rule about it: the reasons, what each one
 * offers, its kind, and the Always rules that let the factory act without asking.
 *
 * A run keeps its Ask whole in `ask` of its state.json. An issue or goal keeps it as flat fields next to its prose note:
 * `ask` (`input` or `approval`), `reason`, `question`, `options` (each `label :: line`, with `:: after <goal id>`
 * when choosing it means waiting for that goal), `recommended` (an option label) and `why` (short context lines).
 * The work store's front matter is flat, so the values are kept free of quotes, backslashes and line breaks.
 *
 * `always.json` in the factory dir maps a reason to `{ action, at }`.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { factoryLog, layout } from "./layout.ts";
import type * as issues from "../../todo/lib/todo.ts";

export interface Ask {
  kind: "input" | "approval";
  reason: string;
  question: string;
  options: { label: string; line: string; after?: string }[];
  recommended?: string;
  why: string[];
  /** Plain sentences on what this item is about and why it waits for Chris. */
  situation?: string;
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
  /** The word a run's news and prompts use for this wait. */
  needs?: "manual" | "question" | "held" | "review";
}
export interface Granted { action: string; at: string }

const proposal: Reason = { kind: "approval", actions: ["approve", "decline"], always: "approve" };

/**
 * Every reason the factory asks Chris. The first group is the spec's Ask reasons. The second group is kept as it was,
 * because the spec names no new home for it: run-cap, acceptance-failed, firefighter and the `proposal-<kind>:<place>` keys.
 */
export const ASK_REASONS: Record<string, Reason> = {
  "held-path": { kind: "approval", actions: ["land", "drop"], always: "firefighter", needs: "held" },
  "review": { kind: "approval", actions: ["land", "drop"], always: "firefighter", needs: "review" },
  "proposal": { kind: "approval", actions: ["start", "deny"], always: "start" },
  // Was `decision` (decide, deny; recommended) and `question` (answer, drop; firefighter): one reason now, so it lists both.
  "question": { kind: "input", actions: ["answer", "drop", "decide", "deny", "firefighter"], always: "recommended", needs: "question" },
  "manual": { kind: "input", actions: ["checked", "deny"], always: "", needs: "manual" },
  "no-commit": { kind: "input", actions: ["rerun", "close"], always: "firefighter" },
  "part-dropped": { kind: "input", actions: ["rerun", "close"], always: "" },
  "triage-failed": { kind: "input", actions: ["retry", "close"], always: "retry" },
  "host-check": { kind: "input", actions: ["checked", "deny"], always: "" },
  "rescue": { kind: "input", actions: ["decide", "drop"], always: "recommended" },
  // Not Ask reasons of the spec; no new home is named for them.
  "run-cap": { kind: "input", actions: ["rerun", "close"], always: "firefighter" },
  "acceptance-failed": { kind: "input", actions: ["rerun", "close"], always: "firefighter" },
  "firefighter": { kind: "approval", actions: ["land", "drop"], always: "land" },
  "proposal-check": proposal,
  "proposal-claude-md": proposal,
  "proposal-skill": proposal,
};

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
export const plainAsk = (reason: string, question: string, why: string[] = []): Ask => ({ kind: kindOf(reason), reason, question, options: [], why });

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
export function readAsk(item: issues.Issue): Ask | null {
  const kind = item.fm.ask;
  if (kind !== "input" && kind !== "approval") return null;
  const why = item.fm.why;
  const situation = text(item.fm.situation);
  const effects = lines(item.fm.effects).map(splitPair);
  const recommend = text(item.fm.recommend) ? splitPair(text(item.fm.recommend)) : null;
  return {
    kind, reason: text(item.fm.reason) || "question", question: text(item.fm.question), options: lines(item.fm.options).map(decodeOption),
    ...(text(item.fm.recommended) ? { recommended: text(item.fm.recommended) } : {}),
    why: typeof why === "string" ? why.split(",").map((s) => s.trim()).filter(Boolean) : lines(why),
    ...(situation ? { situation } : {}),
    ...(effects.length ? { effects: effects.map((e) => ({ action: e.action, text: e.text })) } : {}),
    ...(recommend ? { recommend: { action: recommend.action, why: recommend.text } } : {}),
  };
}

/**
 * Put `ask` on the item: `ask`, `reason`, `question`, `options`, `recommended` and `why`, and the case text when the ask
 * has it: `situation` (one string), `effects` (lines `action :: text`) and `recommend` (`action :: why`), as `readAsk` reads them.
 */
export function writeAsk(item: issues.Issue, ask: Ask): void {
  clearAsk(item);
  item.fm.ask = ask.kind;
  item.fm.reason = ask.reason;
  item.fm.question = ask.question;
  if (ask.options.length) item.fm.options = ask.options.map((o) => encodeOption(o));
  if (ask.recommended) item.fm.recommended = ask.recommended;
  item.fm.why = ask.why;
  const situation = flat(ask.situation);
  if (situation) item.fm.situation = situation;
  const effects = (ask.effects ?? []).filter((e) => flat(e.action)).map((e) => `${flat(e.action)}${SEP}${flat(e.text)}`);
  if (effects.length) item.fm.effects = effects;
  if (ask.recommend && flat(ask.recommend.action)) item.fm.recommend = `${flat(ask.recommend.action)}${SEP}${flat(ask.recommend.why)}`;
}

export function clearAsk(item: issues.Issue): void {
  for (const k of ["ask", "reason", "question", "options", "recommended", "why", "situation", "effects", "recommend"]) delete item.fm[k];
}

/** The prose note of an ask, for the CLI and the history. */
export const askNote = (a: Ask): string =>
  `${a.question}${a.options.length ? ` Options: ${a.options.map((o) => `${o.label}: ${o.line}${o.after ? ` (waits on ${o.after})` : ""}`).join("; ")}.` : ""}` +
  (a.recommended ? ` My recommendation is ${a.recommended}.` : "") +
  (a.why.length ? ` Why: ${a.why.join("; ")}.` : "");

// The Always rules.

const file = () => join(layout().factory, "always.json");

function readJson(f: string): Record<string, Granted> | null {
  try {
    const s = JSON.parse(readFileSync(f, "utf8"));
    if (s && typeof s === "object" && !Array.isArray(s)) return s;
  } catch {}
  return null;
}

/** always.json. A missing or bad file is empty. */
export const readAlways = (): Record<string, Granted> => readJson(file()) ?? {};

function write(s: Record<string, Granted>): void {
  mkdirSync(layout().factory, { recursive: true });
  const tmp = `${file()}.tmp`;
  writeFileSync(tmp, JSON.stringify(s, null, 2) + "\n");
  renameSync(tmp, file());
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
}

/** Whether Chris handed `reason` to the firefighter. */
export const handed = (reason: string): boolean => always(reason)?.action === "firefighter";

export const logAlways = (reason: string, action: string, ref: string): void => factoryLog(`always: ${reason}: ${action} on ${ref}`);
