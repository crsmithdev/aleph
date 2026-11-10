/**
 * The verify gate's ladder. docs/verify-gate.md is the contract.
 *
 *   UserPromptSubmit  snapshot the repo (and its worktrees) into the spool
 *   Stop              unchanged tree and no edits → pass silently
 *                     "skip verify" from the user → pass
 *                     two denials already → forced pass
 *                     a cited hash or a doc claim no run backs → deny
 *                     otherwise ask the judge; deny with its reason
 *                     record a guardrail span and a score, unless unchanged
 */
import { homedir } from "node:os";
import { resolve } from "node:path";
import { langfuseConfig, sessionEnvironment } from "../../lib/env.ts";
import { postScore, truncate, turnTraceIdFor } from "../../lib/otlp.ts";
import { digest, readEntries, userGrantedSkip } from "./digest.ts";
import { docClaimProblems } from "./docclaims.ts";
import { denials, snap } from "./handshake.ts";
import { backing, unbackedHashes } from "./hashes.ts";
import { judge as realJudge } from "./judge.ts";
import { changedFiles, isCode, snapshot } from "./snapshot.ts";
import { postTurnSpan } from "./trace.ts";

const MAX_DENIALS = 2;

export type Outcome = { verdict: "pass" | "deny"; kind: "unchanged" | "skip" | "forced" | "hash" | "doc-claim" | "judged" | "fail-open"; reason: string; score?: number; judgeMs?: number; by?: string; jevClaim?: number | null };

/** The hook's event in; the Stop outcome out, or null for any other event and for a factory agent. */
export async function gate(input: Record<string, any>, deps = { judge: realJudge }): Promise<Outcome | null> {
  const event: string = input.hook_event_name;
  const promptId: string | undefined = input.prompt_id;
  const cwd: string = input.cwd ?? process.cwd();

  // A factory agent's work is judged by the factory's own gates.
  if (!promptId || !input.session_id || process.env.ALEPH_AGENT) return null;

  if (event === "UserPromptSubmit") {
    const s = snapshot(cwd);
    if (s) snap(promptId).set(s);
    return null;
  }
  if (event !== "Stop") return null;

  const started = Date.now();
  const before = snap(promptId).get();
  const after = snapshot(cwd);
  const d = digest(input.transcript_path ?? "", promptId, input.last_assistant_message ?? "");
  // Only a change to code wakes the gate: docs, artifacts outside the repo and chat answers do not.
  // A file in another worktree (the main checkout too) counts only when the cwd is in that worktree or an edit or command
  // of the turn names a path in it. A path's worktree is the deepest one that holds it; a relative path resolves from the cwd of its tool call, else the Stop cwd.
  const trees = [...new Set(Object.keys({ ...before, ...after }).map((k) => k.split("\0")[0]))];
  const treeOf = (p: string) => trees.filter((t) => p === t || p.startsWith(`${t}/`)).sort((a, b) => b.length - a.length)[0];
  const named = new Set([[cwd], ...d.dirs.map(([t, dir]) => t.replace(/\$\{?HOME\}?/g, homedir()).split(/[\s'"`<>|;&()=,]+/).map((p) => resolve(dir ?? cwd, p.replace(/^~(?=\/|$)/, homedir()))))]
    .flat().map(treeOf));
  const codeChanged = before !== null && after !== null && changedFiles(before, after).some((f) => isCode(f) && named.has(treeOf(f)));
  const changed = codeChanged || (after === null && d.edits.some(isCode));
  const unbacked = (message: string, transcript: string | undefined, id: string) => unbackedHashes(message, backing(readEntries(transcript ?? "", id)));

  let outcome: Outcome;
  if (!changed) {
    outcome = { verdict: "pass", kind: "unchanged", reason: "no change to code this turn" };
  } else if (userGrantedSkip(d.prompt)) {
    outcome = { verdict: "pass", kind: "skip", reason: "user said skip verify", score: 1 };
  } else {
    const n = denials(promptId).count();
    // A deterministic check before the judge: a cited commit hash that nothing in the turn shows.
    const hashes = unbacked(d.finalMessage, input.transcript_path, promptId);
    const docProblems = hashes.length ? [] : docClaimProblems(readEntries(input.transcript_path ?? "", promptId), d.finalMessage);
    if (n >= MAX_DENIALS) {
      outcome = { verdict: "pass", kind: "forced", reason: `passed after ${n} denials`, score: 0.5 };
    } else if (hashes.length) {
      const cited = hashes.map((h) => `${h} (run git show --stat ${h})`).join(", ");
      outcome = { verdict: "deny", kind: "hash", reason: `The final message cites commit ${cited}, and no command or output this turn shows ${hashes.length > 1 ? "them" : "it"}.`, score: 0 };
    } else if (docProblems.length) {
      outcome = { verdict: "deny", kind: "doc-claim", reason: `The final message says a doc matches the code, and ${docProblems.join("; and ")}.`, score: 0 };
    } else {
      const result = await deps.judge(d.text, d.finalMessage);
      if (!result.verdict) {
        outcome = { verdict: "pass", kind: "fail-open", reason: `judge unavailable: ${result.error}`, judgeMs: result.ms };
      } else {
        const v = result.verdict.verdict;
        outcome = { verdict: v, kind: "judged", reason: result.verdict.reason, score: v === "deny" ? 0 : 1, judgeMs: result.ms, by: result.by, jevClaim: result.jev?.pClaim };
      }
    }
  }

  if (outcome.verdict === "deny") denials(promptId).add();
  if (outcome.verdict === "pass" && outcome.kind !== "unchanged") denials(promptId).clear();
  if (outcome.verdict === "pass") snap(promptId).take();

  // Record, unless nothing happened.
  const cfg = langfuseConfig();
  if (cfg && outcome.kind !== "unchanged") {
    const span = postTurnSpan(input, "verify-gate", started, {
      "langfuse.observation.type": "guardrail",
      "langfuse.observation.level": outcome.kind === "fail-open" || outcome.kind === "forced" ? "WARNING" : "DEFAULT",
      "langfuse.observation.input": truncate(d.text),
      "langfuse.observation.output": `${outcome.verdict}: ${outcome.reason}`,
      "langfuse.observation.metadata.kind": outcome.kind,
      "langfuse.observation.metadata.verdict": outcome.verdict,
      "langfuse.observation.metadata.digest_chars": d.text.length,
      "langfuse.observation.metadata.edits": d.edits.length,
      "langfuse.observation.metadata.judge_ms": outcome.judgeMs ?? 0,
      ...(outcome.by ? { "langfuse.observation.metadata.judge_by": outcome.by } : {}),
      ...(typeof outcome.jevClaim === "number" ? { "langfuse.observation.metadata.jev_p_claim": outcome.jevClaim } : {}),
    });
    const score = outcome.score === undefined ? Promise.resolve() : postScore(cfg, { traceId: turnTraceIdFor(promptId), name: "verified", value: outcome.score, comment: `${outcome.kind}: ${outcome.reason}`, environment: sessionEnvironment() });
    await Promise.all([span, score]);
  }
  return outcome;
}
