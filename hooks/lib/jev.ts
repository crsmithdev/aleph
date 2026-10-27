/**
 * Jev, TypeSafe's decision model, through OpenRouter's decisions endpoint.
 * It answers typed questions (choice, noul, score) with probabilities and no
 * text, at $0.042 per million input tokens (OpenRouter, 27 Oct 2026). It
 * cannot be called through chat/completions.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const JEV_MODEL = "typesafe/jev-1.13";
const URL = () => process.env.ALEPH_JEV_URL ?? "https://openrouter.ai/api/alpha/decisions";

/** OPENROUTER_API_KEY from the environment, else that one key from ~/.aleph/.env. */
function apiKey(): string | null {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  const file = join(homedir(), ".aleph", ".env");
  if (!existsSync(file)) return null;
  const m = readFileSync(file, "utf8").match(/^\s*(?:export\s+)?OPENROUTER_API_KEY=(.*)$/m);
  return m ? m[1].trim().replace(/^(["'])(.*)\1$/, "$2") : null;
}

export type Question =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "noul"; instructions: string };
export type Answer =
  | { type: "choice"; choice: string; probabilities?: Record<string, number>; confidence?: number }
  | { type: "noul"; noul: number };
export interface Decision { answers: Record<string, Answer>; cost: number; model: string; ms: number }

/** One request: the state and the questions in, typed answers out. Throws on any failure. */
export async function decide(state: unknown, questions: Record<string, Question>, timeoutMs = 15_000): Promise<Decision> {
  const key = apiKey();
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
