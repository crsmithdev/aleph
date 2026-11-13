#!/usr/bin/env bun
/**
 * UserPromptSubmit, synchronous: Jev picks the wiki notes that bear on the
 * prompt and they are injected as additionalContext. Silent when the prompt is
 * short, nothing matches, no note reaches 0.85, Jev fails, or `aleph judge haiku`.
 */
import { readJsonOr } from "../lib/json.ts";
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { judgeChoice, nouls, type Noul } from "../lib/jev.ts";
import { truncate } from "../lib/otlp.ts";
import { postTurnSpan } from "./lib/trace.ts";
import { claimLine, openIndex, rankNotes } from "../vault/lib/index.ts";
import { appendRecallLog, coreNotes, loadWiki, recordRun, repoScope, vaultDir, type Note } from "../vault/lib/vault.ts";

const MIN_PROMPT = 20;
// Jev took about 1,670 ms for 40 questions and 1,250 ms for 20 (4 Nov), against a 1,500 ms timeout,
// so the candidates go in parallel requests of at most PER_REQUEST questions.
const PER_REQUEST = 20;
const MAX_ASKED = 100;
const MAX_INJECTED = 3;
const CUT = 0.85;
const JEV_TIMEOUT_MS = 1500;
const SEEN_DAYS = 7;

/** The notes this session's hook already injected, in `<vault>/.index/seen/<session>.json`. */
const seenFile = (root: string, session: string) => join(root, ".index", "seen", `${session.replace(/[^\w-]/g, "_")}.json`);

function readSeen(root: string, session: string | undefined): Set<string> {
  if (!session) return new Set();
  return new Set(readJsonOr<string[]>(seenFile(root, session), []));
}

/** Add `rels` to the session's list, and delete the lists older than SEEN_DAYS. */
function writeSeen(root: string, session: string | undefined, seen: Set<string>, rels: string[]) {
  const dir = join(root, ".index", "seen");
  mkdirSync(dir, { recursive: true });
  try {
    for (const f of readdirSync(dir)) if (statSync(join(dir, f)).mtimeMs < Date.now() - SEEN_DAYS * 86400_000) rmSync(join(dir, f), { force: true });
  } catch (e: any) { recordRun(root, "seen prune", "failed", e?.message ?? String(e)); throw e; }
  recordRun(root, "seen prune", "ok");
  if (session) writeFileSync(seenFile(root, session), JSON.stringify([...seen, ...rels]));
}

/** One `vault-recall` span on the turn's trace. A failed post changes nothing. */
async function postSpan(input: any, start: number, meta: { candidates: number; asked: number; kept: number; capped: boolean; error?: string }, offered: string[], context: string, askedPaths: string[] = []) {
  await postTurnSpan(input, "vault-recall", start, {
    "langfuse.observation.type": "span",
    "langfuse.observation.output": context ? truncate(context) : undefined,
    "langfuse.observation.metadata.candidates": meta.candidates,
    "langfuse.observation.metadata.asked": meta.asked,
    "langfuse.observation.metadata.kept": meta.kept,
    "langfuse.observation.metadata.capped": meta.capped,
    "langfuse.observation.metadata.error": meta.error,
    "langfuse.observation.metadata.askedPaths": askedPaths.length ? askedPaths.join("\n") : undefined,
    "langfuse.observation.metadata.offered": offered.length ? offered.join("\n") : undefined,
  });
}

async function main() {
  if (process.env.ALEPH_AGENT) return;
  const input = JSON.parse((await Bun.stdin.text()) || "{}");
  const prompt: string = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (prompt.length < MIN_PROMPT || judgeChoice() === "haiku") return;
  const start = Date.now();
  const root = vaultDir();
  const notes = await loadWiki(root);
  const seen = readSeen(root, input.session_id);
  const scope = repoScope(input.cwd ?? process.cwd());
  // A core note's line is already in the start context.
  const skip = new Set([...seen, ...coreNotes(notes, scope).map((n) => n.rel)]);
  const all = rankNotes(openIndex(root, notes), notes, prompt, scope).map((r) => r.note).filter((n) => !skip.has(n.rel));
  const candidates = all.slice(0, MAX_ASKED);
  const meta: Parameters<typeof postSpan>[2] = { candidates: all.length, asked: candidates.length, kept: 0, capped: all.length > MAX_ASKED };
  if (!candidates.length) { await postSpan(input, start, meta, [], ""); return; }
  const criteria = { true: "The note's subject is something the prompt asks about or depends on.", false: "The note is about something else." };
  const batches = Array.from({ length: Math.ceil(candidates.length / PER_REQUEST) }, (_, b) => candidates.slice(b * PER_REQUEST, (b + 1) * PER_REQUEST));
  const settled = await Promise.allSettled(batches.map((batch) => {
    const questions: Record<string, Noul> = {};
    batch.forEach((n, i) => {
      questions[`n${i}`] = { type: "noul", instructions: `Does note \`${n.title}\` (its claim line: ${claimLine(n)}) bear on \`prompt\`?`, criteria };
    });
    return nouls({ prompt }, questions, JEV_TIMEOUT_MS);
  }));
  const errors: string[] = [];
  const scored: { n: Note; p: number }[] = [];
  settled.forEach((s, b) => {
    if (s.status === "rejected") { errors.push(s.reason?.message ?? String(s.reason)); return; }
    batches[b].forEach((n, i) => scored.push({ n, p: s.value.p[`n${i}`] }));
  });
  if (errors.length) meta.error = errors.join("; ");
  const picked = scored.filter((x) => x.p >= CUT).sort((a, b) => b.p - a.p).slice(0, MAX_INJECTED);
  meta.kept = picked.length;
  const lines = picked.map(({ n }) => `- ${n.title} (${join(root, n.rel)}): ${claimLine(n)}`);
  const additionalContext = picked.length ? ["Vault notes that may bear on this prompt (Jev):", ...lines].join("\n") : "";
  await postSpan(input, start, meta, picked.map(({ n }) => n.rel), additionalContext, candidates.map((n) => n.rel));
  if (!picked.length) return;
  writeSeen(root, input.session_id, seen, picked.map(({ n }) => n.rel));
  try { appendRecallLog(root, picked.map(({ n }) => n.title), prompt, input.session_id ?? null, "hook"); } catch { /* the log must never block the injection */ }
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext } }));
}

if (import.meta.main) await main().catch(() => {});
