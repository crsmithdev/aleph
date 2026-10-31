/**
 * An Ask: what an issue or goal needs from Chris, stored as flat fields on the item next to its prose note:
 * `ask` (`input` or `approval`), `reason`, `question`, `options` (each `label :: line`, with `:: after <goal id>`
 * when choosing it means waiting for that goal), `recommended` (an option label) and `why` (short context lines).
 * The work store's front matter is flat, so the values are kept free of quotes, backslashes and line breaks.
 */
import type * as issues from "../../todo/lib/todo.ts";

export interface Ask {
  kind: "input" | "approval";
  reason: string;
  question: string;
  options: { label: string; line: string; after?: string }[];
  recommended?: string;
  why: string[];
}

const SEP = " :: ";
const MAX_WHY = 4;
const REF = /^[\w.-]+-\d+(\.\d+)?$/;
/** The words that introduce an option's goal on disk. */
const WAITS = " :: after ";
const clean = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").replace(/"/g, "'").replace(/\\/g, "/").trim() : "");

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

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

/** The ask in an item's fields, or null when it has no question with options. `kind` and `reason` come from `ask` and `reason`. */
export function readAsk(item: issues.Issue): Ask | null {
  const question = typeof item.fm.question === "string" ? item.fm.question : "";
  const options = list(item.fm.options).map(decodeOption);
  if (!question || !options.length) return null;
  const recommended = typeof item.fm.recommended === "string" && item.fm.recommended ? item.fm.recommended : undefined;
  return {
    kind: item.fm.ask === "approval" ? "approval" : "input",
    reason: typeof item.fm.reason === "string" && item.fm.reason ? item.fm.reason : "question",
    question, options, ...(recommended ? { recommended } : {}), why: list(item.fm.why),
  };
}

/** Put `ask` on the item: `ask`, `reason`, `question`, `options`, `recommended` and `why`, as `readAsk` and `store.askOf` read them. */
export function writeAsk(item: issues.Issue, ask: Ask): void {
  clearAsk(item);
  item.fm.ask = ask.kind;
  item.fm.reason = ask.reason;
  item.fm.question = ask.question;
  if (ask.options.length) item.fm.options = ask.options.map((o) => encodeOption(o));
  if (ask.recommended) item.fm.recommended = ask.recommended;
  item.fm.why = ask.why;
}

export function clearAsk(item: issues.Issue): void {
  for (const k of ["ask", "reason", "question", "options", "recommended", "why"]) delete item.fm[k];
}

/** The prose note of an ask, for the CLI and the history. */
export const askNote = (a: Ask): string =>
  `${a.question}${a.options.length ? ` Options: ${a.options.map((o) => `${o.label}: ${o.line}${o.after ? ` (waits on ${o.after})` : ""}`).join("; ")}.` : ""}` +
  (a.recommended ? ` My recommendation is ${a.recommended}.` : "") +
  (a.why.length ? ` Why: ${a.why.join("; ")}.` : "");
