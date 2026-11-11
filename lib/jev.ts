/**
 * Jev, TypeSafe's decision model, through OpenRouter's decisions endpoint.
 * It answers typed questions (choice, noul, score) with probabilities and no
 * text, at $0.042 per million input tokens (OpenRouter, 27 Oct 2026). It
 * cannot be called through chat/completions.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { openRouterKey } from "./env.ts";
import { alephPath } from "./paths.ts";

const JEV_MODEL = "typesafe/jev-1.13";

export type JudgeChoice = "jev" | "haiku";
const choiceFile = () => alephPath("ALEPH_JUDGE_FILE", "judge");

/**
 * Whether Jev screens before Haiku, everywhere aleph uses it: ALEPH_JUDGE,
 * else `aleph judge`'s file, else jev.
 */
export function judgeChoice(): JudgeChoice {
  const v = process.env.ALEPH_JUDGE ?? (existsSync(choiceFile()) ? readFileSync(choiceFile(), "utf8").trim() : "");
  return v === "haiku" ? "haiku" : "jev";
}

export function setJudgeChoice(choice: JudgeChoice) {
  mkdirSync(dirname(choiceFile()), { recursive: true });
  writeFileSync(choiceFile(), `${choice}\n`);
}
const URL = () => process.env.ALEPH_JEV_URL ?? "https://openrouter.ai/api/alpha/decisions";

export type Noul = { type: "noul"; instructions: string; criteria?: { true: string; false: string } };
export type Question = { type: "choice"; instructions: string; criteria: Record<string, string> } | Noul;
type Answer =
  | { type: "choice"; choice: string; probabilities?: Record<string, number>; confidence?: number }
  | { type: "noul"; noul: number };
export interface Decision { answers: Record<string, Answer>; cost: number; model: string; ms: number }

/** One request: the state and the questions in, typed answers out. Throws on any failure. */
export async function decide(state: unknown, questions: Record<string, Question>, timeoutMs = 15_000): Promise<Decision> {
  const key = openRouterKey();
  if (!key) throw new Error("no OPENROUTER_API_KEY");
  const started = performance.now();
  const res = await fetch(URL(), {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model: JEV_MODEL, state, questions }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body: any = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`jev ${res.status}: ${JSON.stringify(body?.error ?? body).slice(0, 200)}`);
  for (const id of Object.keys(questions)) {
    const a = body?.answers?.[id];
    if (a?.type !== questions[id].type) throw new Error(`jev: no ${questions[id].type} answer for ${id}`);
  }
  return { answers: body.answers, cost: body.usage?.cost ?? 0, model: body.model ?? JEV_MODEL, ms: performance.now() - started };
}

/** decide() for yes-or-no questions: each question's probability of yes, by id. */
export async function nouls(state: unknown, questions: Record<string, Noul>, timeoutMs?: number): Promise<{ p: Record<string, number>; cost: number }> {
  const d = await decide(state, questions, timeoutMs);
  const p = Object.fromEntries(Object.keys(questions).map((id) => [id, (d.answers[id] as { noul: number }).noul]));
  return { p, cost: d.cost };
}
