#!/usr/bin/env bun
/**
 * UserPromptSubmit, synchronous: Jev picks the wiki notes that bear on the
 * prompt and they are injected as additionalContext. Silent when the prompt is
 * short, nothing matches, no note reaches 0.7, Jev fails, or `aleph judge haiku`.
 */
import { join } from "node:path";
import { decide, judgeChoice, type Question } from "./lib/jev.ts";
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
  const want = new Set(words(prompt));
  return notes
    .map((n) => {
      const aliases = n.fm.aliases;
      const have = new Set(words([n.title, ...(Array.isArray(aliases) ? aliases : aliases ? [aliases] : [])].join(" ")));
      return { n, hits: [...want].filter((w) => have.has(w)).length };
    })
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, MAX_ASKED)
    .map((x) => x.n);
}

async function main() {
  const input = JSON.parse((await Bun.stdin.text()) || "{}");
  const prompt: string = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (prompt.length < MIN_PROMPT || judgeChoice() === "haiku") return;
  const root = vaultDir();
  const candidates = rank(wikiNotes(loadVault(root)), prompt);
  if (!candidates.length) return;
  const questions: Record<string, Question> = {};
  const criteria = { true: "The note's subject is something the prompt asks about or depends on.", false: "The note is about something else." };
  candidates.forEach((n, i) => {
    questions[`n${i}`] = { type: "noul", instructions: `Does note \`${n.title}\` (its claim line: ${claimLine(n)}) bear on \`prompt\`?`, ...{ criteria } };
  });
  const d = await decide({ prompt }, questions, JEV_TIMEOUT_MS);
  const picked = candidates
    .map((n, i) => ({ n, p: d.answers[`n${i}`].type === "noul" ? (d.answers[`n${i}`] as { noul: number }).noul : 0 }))
    .filter((x) => x.p >= CUT)
    .sort((a, b) => b.p - a.p)
    .slice(0, MAX_INJECTED);
  if (!picked.length) return;
  const lines = picked.map(({ n }) => `- ${n.title} (${join(root, n.rel)}): ${claimLine(n)}`);
  const additionalContext = ["Vault notes that may bear on this prompt (Jev):", ...lines].join("\n");
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext } }));
}

if (import.meta.main) await main().catch(() => {});
