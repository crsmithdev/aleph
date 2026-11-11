/**
 * Jev's triage of a new issue: which of the repo's labels it carries and
 * which open items it may duplicate. One request; any failure, or
 * `aleph judge haiku`, gives an empty triage.
 */
import { judgeChoice, nouls, type Noul } from "../../lib/jev.ts";
import { areasOf } from "./store.ts";
import { status, type Doc } from "./todo.ts";

const CUT = 0.7;
const MAX_QUESTIONS = 50;

export interface Triage { labels: string[]; maybeSame: { id: number; title: string; p: number }[] }

export async function triage(doc: Doc | null, title: string, body = ""): Promise<Triage> {
  const none: Triage = { labels: [], maybeSame: [] };
  if (!doc || judgeChoice() !== "jev") return none;
  const known = [...new Set(doc.items.flatMap(areasOf))].slice(0, MAX_QUESTIONS);
  const open = doc.items.filter((i) => status(i) === "open").sort((a, b) => b.id - a.id).slice(0, MAX_QUESTIONS - known.length);
  if (!known.length && !open.length) return none;

  const questions: Record<string, Noul> = {};
  for (const l of known) {
    questions[`label:${l}`] = { type: "noul", instructions: `Should \`new_item\` carry the label \`${l}\`?`, criteria: { true: `new_item belongs under the label ${l}`, false: `new_item does not belong under the label ${l}` } };
  }
  for (const i of open) {
    questions[`item:${i.id}`] = { type: "noul", instructions: `Is \`new_item\` the same task as open item ${i.id}: ${i.title}?` };
  }
  try {
    const { p } = await nouls({ new_item: { title, body } }, questions);
    return {
      labels: known.filter((l) => p[`label:${l}`] >= CUT),
      maybeSame: open.filter((i) => p[`item:${i.id}`] >= CUT).map((i) => ({ id: i.id, title: i.title, p: p[`item:${i.id}`] })),
    };
  } catch {
    return none;
  }
}
