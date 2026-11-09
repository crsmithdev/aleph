#!/usr/bin/env bun
/**
 * UserPromptSubmit, synchronous: Jev picks the wiki notes that bear on the
 * prompt and they are injected as additionalContext. Silent when the prompt is
 * short, nothing matches, no note reaches 0.7, Jev fails, or `aleph judge haiku`.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { decide, judgeChoice, type Question } from "../lib/jev.ts";
import { langfuseConfig, sessionEnvironment } from "../lib/env.ts";
import { peek } from "./lib/handshake.ts";
import { attrs, nano, postSpans, spanId, truncate, turnSpanIdFor, turnTraceIdFor } from "../lib/otlp.ts";
import { claimLine, openIndex, rankNotes } from "../vault/lib/index.ts";
import { coreNotes, loadWiki, repoScope, vaultDir, type Note } from "../vault/lib/vault.ts";

const MIN_PROMPT = 20;
// Jev took about 1,670 ms for 40 questions and 1,250 ms for 20 (4 Nov), against a 1,500 ms timeout.
const MAX_ASKED = 20;
const MAX_INJECTED = 3;
const CUT = 0.7;
const JEV_TIMEOUT_MS = 1500;
const SEEN_DAYS = 7;

/** The notes this session's hook already injected, in `<vault>/.index/seen/<session>.json`. */
const seenFile = (root: string, session: string) => join(root, ".index", "seen", `${session.replace(/[^\w-]/g, "_")}.json`);

function readSeen(root: string, session: string | undefined): Set<string> {
  if (!session) return new Set();
  try { return new Set(JSON.parse(readFileSync(seenFile(root, session), "utf8"))); } catch { return new Set(); }
}

/** Add `rels` to the session's list, and delete the lists older than SEEN_DAYS. */
function writeSeen(root: string, session: string | undefined, seen: Set<string>, rels: string[]) {
  const dir = join(root, ".index", "seen");
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) if (statSync(join(dir, f)).mtimeMs < Date.now() - SEEN_DAYS * 86400_000) rmSync(join(dir, f), { force: true });
  if (session) writeFileSync(seenFile(root, session), JSON.stringify([...seen, ...rels]));
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
  writeSeen(root, input.session_id, seen, picked.map(({ n }) => n.rel));
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext } }));
}

if (import.meta.main) await main().catch(() => {});
