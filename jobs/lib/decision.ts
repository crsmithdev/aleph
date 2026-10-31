/**
 * Shim until step 5 (aleph-628): the old-shape `Decision` names for callers that still say `waiting_on`
 * (ui/, triage, factory, firefighter). The Ask lives in ask.ts; new code imports it from there. jobs/ and todo/ no longer import this file: it stays only as the UI's shim.
 */
import type * as todos from "../../todo/lib/todo.ts";
import { decodeOption, encodeOption, normalizeAsk } from "./ask.ts";


export interface Decision {
  question: string;
  options: { label: string; line: string; waiting_on?: string }[];
  recommended: string;
  why: string[];
  kind: "product" | "build";
}

/** A decision from loose input (a verdict's JSON), or null when it has no usable question, 2–4 options or recommended label. */
export function normalizeDecision(raw: any): Decision | null {
  const a = normalizeAsk(raw);
  if (!a || !a.recommended) return null;
  return {
    question: a.question,
    options: a.options.map(({ after, ...o }) => ({ ...o, ...(after ? { waiting_on: after } : {}) })),
    recommended: a.recommended,
    why: a.why,
    kind: raw.kind === "build" ? "build" : "product",
  };
}

/** The decision in an item's fields, or null when it has none. */
export function readDecision(item: todos.Issue): Decision | null {
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
  const options = list(item.fm.options).map(decodeOption).map(({ after, ...o }) => ({ ...o, ...(after ? { waiting_on: after } : {}) }));
  const question = typeof item.fm.question === "string" ? item.fm.question : "";
  const recommended = typeof item.fm.recommended === "string" ? item.fm.recommended : "";
  return question && options.length ? { question, options, recommended, why: list(item.fm.why), kind: item.fm.kind === "build" ? "build" : "product" } : null;
}

export function writeDecision(item: todos.Issue, d: Decision): void {
  item.fm.question = d.question;
  item.fm.options = d.options.map((o) => encodeOption({ label: o.label, line: o.line, after: o.waiting_on }, "waiting_on"));
  item.fm.recommended = d.recommended;
  item.fm.why = d.why;
  item.fm.kind = d.kind;
}

export function clearDecision(item: todos.Issue): void {
  for (const k of ["question", "options", "recommended", "why", "kind", "reason"]) delete item.fm[k];
}

/** The prose note of a decision, for the CLI and the history. */
export const decisionNote = (d: Decision): string =>
  `${d.question} Options: ${d.options.map((o) => `${o.label}: ${o.line}${o.waiting_on ? ` (waits on ${o.waiting_on})` : ""}`).join("; ")}. My recommendation is ${d.recommended}.` +
  (d.why.length ? ` Why: ${d.why.join("; ")}.` : "");
