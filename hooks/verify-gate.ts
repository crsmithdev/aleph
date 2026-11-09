#!/usr/bin/env bun
/**
 * The verify gate. docs/verify-gate.md is the contract.
 *
 *   UserPromptSubmit  snapshot the repo (and its worktrees) into the spool
 *   Stop              unchanged tree and no edits → pass silently
 *                     "skip verify" from the user → pass
 *                     two denials already → forced pass
 *                     otherwise ask the judge; deny with its reason
 *                     always record a guardrail span and a score
 */
import { langfuseConfig, sessionEnvironment } from "../lib/env.ts";
import { digest, readEntries, userGrantedSkip } from "./lib/digest.ts";
import { docClaimProblems } from "./lib/docclaims.ts";
import { backing, unbackedHashes } from "./lib/hashes.ts";
import { peek, put, take } from "./lib/handshake.ts";
import { judge } from "./lib/judge.ts";
import { attrs, nano, postScore, postSpans, spanId, truncate, turnSpanIdFor, turnTraceIdFor, type Span } from "../lib/otlp.ts";
import { changedFiles, isCode, snapshot, type Snapshot } from "./lib/snapshot.ts";

const input = JSON.parse(await Bun.stdin.text());
const event: string = input.hook_event_name;
const promptId: string | undefined = input.prompt_id;
const sessionId: string | undefined = input.session_id;
const cwd: string = input.cwd ?? process.cwd();
const MAX_DENIALS = 2;

// A factory agent's work is judged by the factory's own gates.
if (!promptId || !sessionId || process.env.ALEPH_AGENT) process.exit(0);

if (event === "UserPromptSubmit") {
  const snap = snapshot(cwd);
  if (snap) put(`snap:${promptId}`, { start: Date.now(), input: snap });
  process.exit(0);
}
if (event !== "Stop") process.exit(0);

const started = Date.now();
const before = peek(`snap:${promptId}`)?.input as Snapshot | undefined;
const after = snapshot(cwd);
const d = digest(input.transcript_path ?? "", promptId, input.last_assistant_message ?? "");
// Only a change to code wakes the gate: docs, artifacts outside the repo and chat answers do not.
const codeChanged = typeof before === "object" && after !== null && changedFiles(before, after).some(isCode);
const changed = codeChanged || (after === null && d.edits.some(isCode));
const unbacked = (message: string, transcript: string | undefined, id: string) => unbackedHashes(message, backing(readEntries(transcript ?? "", id)));

type Outcome = { verdict: "pass" | "deny"; kind: "unchanged" | "skip" | "forced" | "hash" | "doc-claim" | "judged" | "fail-open"; reason: string; score?: number; judgeMs?: number; by?: string; jevClaim?: number | null };
let outcome: Outcome;

if (!changed) {
  outcome = { verdict: "pass", kind: "unchanged", reason: "no change to code this turn" };
} else if (userGrantedSkip(d.prompt)) {
  outcome = { verdict: "pass", kind: "skip", reason: "user said skip verify", score: 1 };
} else {
  const gate = peek(`gate:${promptId}`);
  const denials = Number((gate?.input as any)?.denials ?? 0);
  // A deterministic check before the judge: a cited commit hash that nothing in the turn shows.
  const hashes = unbacked(d.finalMessage, input.transcript_path, promptId);
  const docProblems = hashes.length ? [] : docClaimProblems(readEntries(input.transcript_path ?? "", promptId), d.finalMessage);
  if (denials >= MAX_DENIALS) {
    outcome = { verdict: "pass", kind: "forced", reason: `passed after ${denials} denials`, score: 0.5 };
  } else if (hashes.length) {
    const cited = hashes.map((h) => `${h} (run git show --stat ${h})`).join(", ");
    put(`gate:${promptId}`, { start: gate?.start ?? started, input: { denials: denials + 1 } });
    outcome = { verdict: "deny", kind: "hash", reason: `The final message cites commit ${cited}, and no command or output this turn shows ${hashes.length > 1 ? "them" : "it"}.`, score: 0 };
  } else if (docProblems.length) {
    put(`gate:${promptId}`, { start: gate?.start ?? started, input: { denials: denials + 1 } });
    outcome = { verdict: "deny", kind: "doc-claim", reason: `The final message says a doc matches the code, and ${docProblems.join("; and ")}.`, score: 0 };
  } else {
    const result = await judge(d.text, d.finalMessage);
    if (!result.verdict) {
      outcome = { verdict: "pass", kind: "fail-open", reason: `judge unavailable: ${result.error}`, judgeMs: result.ms };
    } else if (result.verdict.verdict === "deny") {
      put(`gate:${promptId}`, { start: gate?.start ?? started, input: { denials: denials + 1 } });
      outcome = { verdict: "deny", kind: "judged", reason: result.verdict.reason, score: 0, judgeMs: result.ms, by: result.by, jevClaim: result.jev?.pClaim };
    } else {
      outcome = { verdict: "pass", kind: "judged", reason: result.verdict.reason, score: 1, judgeMs: result.ms, by: result.by, jevClaim: result.jev?.pClaim };
    }
  }
}

if (outcome.verdict === "pass" && outcome.kind !== "unchanged") take(`gate:${promptId}`);
if (outcome.verdict === "pass") take(`snap:${promptId}`);

// Record, unless nothing happened.
const cfg = langfuseConfig();
if (cfg && outcome.kind !== "unchanged") {
  const traceId = turnTraceIdFor(promptId);
  const span: Span = {
    traceId,
    spanId: spanId(),
    parentSpanId: turnSpanIdFor(promptId),
    name: "verify-gate",
    kind: 1,
    startTimeUnixNano: nano(started),
    endTimeUnixNano: nano(Date.now()),
    attributes: attrs({
      "langfuse.session.id": sessionId,
      "langfuse.user.id": "chris",
      "langfuse.environment": sessionEnvironment(),
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
    }),
  };
  const score = outcome.score === undefined ? Promise.resolve() : postScore(cfg, { traceId, name: "verified", value: outcome.score, comment: `${outcome.kind}: ${outcome.reason}`, environment: sessionEnvironment() });
  await Promise.all([postSpans(cfg, [span], 3000), score]);
}

if (outcome.verdict === "deny") {
  // Stop honors the legacy shape; hookSpecificOutput.permissionDecision does nothing here (measured on 2.1.259).
  console.log(JSON.stringify({
    decision: "block",
    reason: `Verify gate: ${outcome.reason} Run it, report what you observed, or say plainly what is unverified.`,
  }));
}
