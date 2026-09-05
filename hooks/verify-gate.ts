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
import { langfuseConfig, sessionEnvironment } from "./lib/env.ts";
import { digest, userGrantedSkip } from "./lib/digest.ts";
import { peek, put, take } from "./lib/handshake.ts";
import { judge } from "./lib/judge.ts";
import { attrs, nano, postSpans, spanId, truncate, turnSpanIdFor, turnTraceIdFor, type Span } from "./lib/otlp.ts";
import { snapshot } from "./lib/snapshot.ts";

const input = JSON.parse(await Bun.stdin.text());
const event: string = input.hook_event_name;
const promptId: string | undefined = input.prompt_id;
const sessionId: string | undefined = input.session_id;
const cwd: string = input.cwd ?? process.cwd();
const MAX_DENIALS = 2;

if (!promptId || !sessionId) process.exit(0);

if (event === "UserPromptSubmit") {
  const snap = snapshot(cwd);
  if (snap) put(`snap:${promptId}`, { start: Date.now(), input: snap });
  process.exit(0);
}
if (event !== "Stop") process.exit(0);

const started = Date.now();
const before = peek(`snap:${promptId}`)?.input as string | undefined;
const after = snapshot(cwd);
const d = digest(input.transcript_path ?? "", promptId, input.last_assistant_message ?? "");
const treeChanged = before !== undefined && after !== undefined && after !== null && before !== after;
const changed = treeChanged || (after === null && d.edits.length > 0);

type Outcome = { verdict: "pass" | "deny"; kind: "unchanged" | "skip" | "forced" | "judged" | "fail-open"; reason: string; score?: number; judgeMs?: number };
let outcome: Outcome;

if (!changed) {
  outcome = { verdict: "pass", kind: "unchanged", reason: "no change to the tree this turn" };
} else if (userGrantedSkip(d.prompt)) {
  outcome = { verdict: "pass", kind: "skip", reason: "user said skip verify", score: 1 };
} else {
  const gate = peek(`gate:${promptId}`);
  const denials = Number((gate?.input as any)?.denials ?? 0);
  if (denials >= MAX_DENIALS) {
    outcome = { verdict: "pass", kind: "forced", reason: `passed after ${denials} denials`, score: 0.5 };
  } else {
    const result = await judge(d.text);
    if (!result.verdict) {
      outcome = { verdict: "pass", kind: "fail-open", reason: `judge unavailable: ${result.error}`, judgeMs: result.ms };
    } else if (result.verdict.verdict === "deny") {
      put(`gate:${promptId}`, { start: gate?.start ?? started, input: { denials: denials + 1 } });
      outcome = { verdict: "deny", kind: "judged", reason: result.verdict.reason, score: 0, judgeMs: result.ms };
    } else {
      outcome = { verdict: "pass", kind: "judged", reason: result.verdict.reason, score: 1, judgeMs: result.ms };
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
    }),
  };
  const auth = Buffer.from(`${cfg.publicKey}:${cfg.secretKey}`).toString("base64");
  const score = outcome.score === undefined ? Promise.resolve() : fetch(`${cfg.baseUrl}/api/public/scores`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Basic ${auth}` },
    body: JSON.stringify({ traceId, name: "verified", value: outcome.score, dataType: "NUMERIC", comment: `${outcome.kind}: ${outcome.reason}`.slice(0, 500) }),
    signal: AbortSignal.timeout(3000),
  }).catch(() => undefined);
  await Promise.all([postSpans(cfg, [span], 3000), score]);
}

if (outcome.verdict === "deny") {
  // Stop honors the legacy shape; hookSpecificOutput.permissionDecision does nothing here (measured on 2.1.259).
  console.log(JSON.stringify({
    decision: "block",
    reason: `Verify gate: ${outcome.reason} Run it, report what you observed, or say plainly what is unverified.`,
  }));
}
