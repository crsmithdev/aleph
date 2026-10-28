/**
 * A decision for Chris, stored as fields on the issue next to its prose note:
 * `question`, `options` (each `label :: line`), `recommended` (an option label)
 * and `why` (short context lines). The work store's front matter is flat, so
 * the values are kept free of quotes, backslashes and line breaks.
 */
import type * as todos from "../../todo/lib/todo.ts";

export interface Decision {
  question: string;
  options: { label: string; line: string; waiting_on?: string }[];
  recommended: string;
  why: string[];
}

const SEP = " :: ";
const MAX_WHY = 4;
const WAIT = " :: waiting_on ";
const REF = /^[\w.-]+-\d+$/;
const clean = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").replace(/"/g, "'").replace(/\\/g, "/").trim() : "");

/** A decision from loose input (a verdict's JSON), or null when it has no usable question, 2–4 options or recommended label. */
export function normalizeDecision(raw: any): Decision | null {
  if (!raw || typeof raw !== "object") return null;
  const question = clean(raw.question);
  if (!question || !Array.isArray(raw.options) || raw.options.length < 2 || raw.options.length > 4) return null;
  const options = raw.options.map((o: any) => ({ label: clean(o?.label).replaceAll(SEP.trim(), ":"), line: clean(o?.line), ...(REF.test(clean(o?.waiting_on)) ? { waiting_on: clean(o?.waiting_on) } : {}) }));
  if (options.some((o: { label: string }) => !o.label) || new Set(options.map((o: { label: string }) => o.label)).size !== options.length) return null;
  const recommended = clean(raw.recommended);
  if (!options.some((o: { label: string }) => o.label === recommended)) return null;
  const why = (Array.isArray(raw.why) ? raw.why : []).map(clean).filter(Boolean).slice(0, MAX_WHY);
  return { question, options, recommended, why };
}

/** The decision in an item's fields, or null when it has none. */
export function readDecision(item: todos.Item): Decision | null {
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
  const options = list(item.fm.options).map((s) => {
    const w = s.lastIndexOf(WAIT);
    const wait = w >= 0 && REF.test(s.slice(w + WAIT.length)) ? s.slice(w + WAIT.length) : undefined;
    const rest = wait ? s.slice(0, w) : s;
    const at = rest.indexOf(SEP);
    const o = at < 0 ? { label: rest, line: "" } : { label: rest.slice(0, at), line: rest.slice(at + SEP.length) };
    return wait ? { ...o, waiting_on: wait } : o;
  });
  const question = typeof item.fm.question === "string" ? item.fm.question : "";
  const recommended = typeof item.fm.recommended === "string" ? item.fm.recommended : "";
  return question && options.length ? { question, options, recommended, why: list(item.fm.why) } : null;
}

export function writeDecision(item: todos.Item, d: Decision): void {
  item.fm.question = d.question;
  item.fm.options = d.options.map((o) => o.label + SEP + o.line + (o.waiting_on ? WAIT + o.waiting_on : ""));
  item.fm.recommended = d.recommended;
  item.fm.why = d.why;
}

export function clearDecision(item: todos.Item): void {
  for (const k of ["question", "options", "recommended", "why"]) delete item.fm[k];
}

/** The prose note of a decision, for the CLI and the history. */
export const decisionNote = (d: Decision): string =>
  `${d.question} Options: ${d.options.map((o) => `${o.label}: ${o.line}${o.waiting_on ? ` (waits on ${o.waiting_on})` : ""}`).join("; ")}. My recommendation is ${d.recommended}.` +
  (d.why.length ? ` Why: ${d.why.join("; ")}.` : "");
