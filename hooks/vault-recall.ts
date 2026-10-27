#!/usr/bin/env bun
/**
 * UserPromptSubmit, synchronous: Jev picks the wiki notes that bear on the
 * prompt and they are injected as additionalContext. Silent when the prompt is
 * short, nothing matches, no note reaches 0.7, Jev fails, or `aleph judge haiku`.
 */
import { basename, join } from "node:path";
import { decide, judgeChoice, type Question } from "./lib/jev.ts";
import { langfuseConfig, sessionEnvironment } from "./lib/env.ts";
import { peek } from "./lib/handshake.ts";
import { attrs, nano, postSpans, spanId, truncate, turnSpanIdFor, turnTraceIdFor } from "./lib/otlp.ts";
import { loadVault, vaultDir, wikiNotes, type Note } from "../vault/lib/vault.ts";

const MIN_PROMPT = 20;
const MAX_ASKED = 40;
const MAX_INJECTED = 3;
const CUT = 0.7;
const JEV_TIMEOUT_MS = 1500;
const STOP = new Set("about after also been before being could does doing from have here into just like make more most much must only other over really should some such than that their them then there these they this those very want were what when where which while will with would your".split(" "));

const words = (s: string) => (s.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !STOP.has(w));

export function claimLine(n: Note): string {
  return (n.body.trim().split(/\n\s*\n/)[0] ?? "").replace(/\s+/g, " ").trim();
}

export function rank(notes: Note[], prompt: string): Note[] {
  return rankAll(notes, prompt).slice(0, MAX_ASKED);
}

/** Every note with a word hit, best first, before the cap. */
export function rankAll(notes: Note[], prompt: string): Note[] {
  const want = new Set(words(prompt));
  return notes
    .map((n) => {
      const aliases = n.fm.aliases;
      const have = new Set(words([n.title, ...(Array.isArray(aliases) ? aliases : aliases ? [aliases] : [])].join(" ")));
      return { n, hits: [...want].filter((w) => have.has(w)).length };
    })
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .map((x) => x.n);
}

/** One `vault-recall` span on the turn's trace. A failed post changes nothing. */
async function postSpan(input: any, start: number, meta: { candidates: number; asked: number; kept: number; capped: boolean }, offered: string[], context: string) {
  const cfg = langfuseConfig();
  if (!cfg || !input.prompt_id) return;
  const session = input.session_id ? peek(`session:${input.session_id}`) : null;
  try {
    await postSpans(cfg, [{
      traceId: turnTraceIdFor(input.prompt_id),
      spanId: spanId(),
      parentSpanId: turnSpanIdFor(input.prompt_id),
      name: "vault-recall",
      kind: 1,
      startTimeUnixNano: nano(start),
      endTimeUnixNano: nano(Math.max(Date.now(), start)),
      attributes: attrs({
        "langfuse.session.id": input.session_id,
        "langfuse.user.id": "chris",
        "langfuse.environment": sessionEnvironment(),
        "langfuse.trace.name": session?.name ?? (input.cwd ? basename(input.cwd) : undefined),
        "langfuse.trace.tags": session?.tags,
        "langfuse.trace.metadata.cwd": session?.cwd ?? input.cwd,
        "aleph.event": "UserPromptSubmit",
        "langfuse.observation.type": "span",
        "langfuse.observation.output": context ? truncate(context) : undefined,
        "langfuse.observation.metadata.candidates": meta.candidates,
        "langfuse.observation.metadata.asked": meta.asked,
        "langfuse.observation.metadata.kept": meta.kept,
        "langfuse.observation.metadata.capped": meta.capped,
        "langfuse.observation.metadata.offered": offered.length ? offered.join("\n") : undefined,
      }),
    }], 3000);
  } catch {}
}

async function main() {
  const input = JSON.parse((await Bun.stdin.text()) || "{}");
  const prompt: string = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (prompt.length < MIN_PROMPT || judgeChoice() === "haiku") return;
  const start = Date.now();
  const root = vaultDir();
  const all = rankAll(wikiNotes(loadVault(root)), prompt);
  const candidates = all.slice(0, MAX_ASKED);
  const meta = { candidates: all.length, asked: candidates.length, kept: 0, capped: all.length > MAX_ASKED };
  if (!candidates.length) { await postSpan(input, start, meta, [], ""); return; }
  const questions: Record<string, Question> = {};
  const criteria = { true: "The note's subject is something the prompt asks about or depends on.", false: "The note is about something else." };
  candidates.forEach((n, i) => {
    questions[`n${i}`] = { type: "noul", instructions: `Does note \`${n.title}\` (its claim line: ${claimLine(n)}) bear on \`prompt\`?`, ...{ criteria } };
  });
  let picked: { n: Note; p: number }[] = [];
  try {
    const d = await decide({ prompt }, questions, JEV_TIMEOUT_MS);
    picked = candidates
      .map((n, i) => ({ n, p: d.answers[`n${i}`].type === "noul" ? (d.answers[`n${i}`] as { noul: number }).noul : 0 }))
      .filter((x) => x.p >= CUT)
      .sort((a, b) => b.p - a.p)
      .slice(0, MAX_INJECTED);
  } catch {}
  meta.kept = picked.length;
  const lines = picked.map(({ n }) => `- ${n.title} (${join(root, n.rel)}): ${claimLine(n)}`);
  const additionalContext = picked.length ? ["Vault notes that may bear on this prompt (Jev):", ...lines].join("\n") : "";
  await postSpan(input, start, meta, picked.map(({ n }) => n.rel), additionalContext);
  if (!picked.length) return;
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext } }));
}

if (import.meta.main) await main().catch(() => {});
