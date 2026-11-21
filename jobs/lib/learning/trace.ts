/**
 * A factory run as one Langfuse trace, under the run's id: the unit posts it after the run, from the worker's
 * and the reviewer's stream-json.
 */
import { existsSync, readFileSync } from "node:fs";
import { pairs, resultContent } from "../../../lib/transcripts.ts";
import { langfuseConfig } from "../../../lib/env.ts";
import { attrs, nano, postSpans, spanId, traceIdFor, truncate, type Span } from "../../../lib/otlp.ts";
import { onOf, type Run } from "../records/ledger.ts";
import { allRuns } from "../records/record.ts";
import { logTo, runFile } from "../records/run-files.ts";
import { resultOf } from "../roles/agent-call.ts";
import { errText } from "../../../lib/errtext.ts";

interface TraceInput {
  runId: string; run: Run; repoKey: string;
  /** The prompt the worker got, and its stream-json output. */
  prompt: string; stream: string;
  /** The reviewer's prompt and stream-json output, when there was a review. */
  reviewPrompt?: string; reviewStream?: string;
  startMs: number; endMs: number;
}

interface Call { name: string; input: unknown; output: unknown; startMs?: number; endMs?: number; error: boolean }
interface Parsed { calls: Call[]; result: string; model?: string; cost?: number; error: boolean }

const when = (ev: any): number | undefined => {
  const t = Date.parse(ev?.timestamp ?? "");
  return Number.isNaN(t) ? undefined : t;
};

/** The tool calls, the result text and the model of one stream-json transcript. It is an error when resultOf is not ok. */
function parseStream(stream: string): Parsed {
  const events: any[] = [];
  let text = "", model: string | undefined;
  for (const line of stream.split("\n")) {
    let ev: any;
    try { ev = JSON.parse(line); } catch { continue; }
    events.push(ev);
    if (ev?.type === "system" && typeof ev.model === "string") model = ev.model;
    if (ev?.type === "assistant") {
      if (!model && typeof ev.message?.model === "string") model = ev.message.model;
      for (const b of ev.message?.content ?? []) if (b?.type === "text" && b.text) text = b.text;
    }
  }
  const calls = [...pairs(events).values()].filter((p) => p.use).map(({ use, result, useEntry, resultEntry }): Call => ({
    name: use!.name, input: use!.input, output: result ? resultContent(result.content) : "", startMs: when(useEntry), endMs: result ? when(resultEntry) : undefined, error: result?.is_error === true,
  }));
  const r = resultOf(stream);
  return { calls, result: r.result || text, model, cost: r.cost, error: !r.ok };
}

/** The root span and one child per tool call of a transcript, under `parent` when given. */
function tree(traceId: string, root: string, parent: string | undefined, p: Parsed, input: string, startMs: number, endMs: number, base: Parameters<typeof attrs>[0]): Span[] {
  const id = spanId();
  const spans: Span[] = [{
    traceId, spanId: id, parentSpanId: parent, name: root, kind: 1,
    startTimeUnixNano: nano(startMs), endTimeUnixNano: nano(endMs),
    attributes: attrs({ ...base, "langfuse.observation.input": truncate(input), "langfuse.observation.output": truncate(p.result), "langfuse.observation.level": p.error ? "ERROR" : undefined }),
  }];
  let at = startMs;
  for (const c of p.calls) {
    const s = Math.max(startMs, Math.min(c.startMs ?? at, endMs));
    const e = Math.max(s, Math.min(c.endMs ?? s, endMs));
    at = e;
    spans.push({
      traceId, spanId: spanId(), parentSpanId: id, name: c.name, kind: 1,
      startTimeUnixNano: nano(s), endTimeUnixNano: nano(e),
      attributes: attrs({
        "langfuse.observation.type": "tool",
        "langfuse.observation.input": truncate(c.input), "langfuse.observation.output": truncate(c.output),
        "langfuse.observation.level": c.error ? "ERROR" : undefined,
      }),
    });
  }
  return spans;
}

/** Every span of the run's trace: the worker's tree, then the reviewer's. */
export function spansFor(t: TraceInput): Span[] {
  const traceId = traceIdFor(t.runId);
  const w = parseStream(t.stream);
  const model = t.run.model ?? w.model;
  const cost = t.run.cost ?? w.cost;
  const meta = {
    "langfuse.trace.metadata.state": t.run.state,
    "langfuse.trace.metadata.reason": t.run.reason,
    "langfuse.trace.metadata.model": model,
    "langfuse.trace.metadata.cost": cost,
    "langfuse.trace.metadata.item": onOf(t.run) !== undefined ? `${t.repoKey}-${onOf(t.run)}` : undefined,
  };
  const top = {
    "langfuse.session.id": t.run.job,
    "langfuse.trace.name": `factory ${t.run.name}`,
    "langfuse.trace.tags": ["factory", t.repoKey],
    "langfuse.trace.input": truncate(t.prompt),
    "langfuse.trace.output": truncate(w.result),
    ...meta,
  };
  const spans = tree(traceId, "worker", undefined, w, t.prompt, t.startMs, t.endMs, { ...top, "langfuse.observation.metadata.model": model });
  if (t.reviewStream !== undefined) {
    const r = parseStream(t.reviewStream);
    spans.push(...tree(traceId, "reviewer", spans[0].spanId, r, t.reviewPrompt ?? "", t.startMs, t.endMs, { "langfuse.observation.metadata.model": r.model, "langfuse.observation.metadata.cost": r.cost }));
  }
  return spans;
}

const read = (f: string) => (existsSync(f) ? readFileSync(f, "utf8") : undefined);

/** Post the run's trace. Never throws; a failed post is one line in the run folder. */
export async function postTrace(folder: string, runId: string, run: Run, repoKey: string): Promise<void> {
  try {
    const cfg = langfuseConfig();
    if (!cfg) return;
    // The reviewer is a job of its own, the next of this one.
    const rv = allRuns().findLast((e) => e.run.role === "review" && e.run.prev === runId)?.folder;
    const spans = spansFor({
      runId, run, repoKey,
      prompt: read(runFile(folder, "prompt.md")) ?? "", stream: read(runFile(folder, "transcript.jsonl")) ?? "",
      reviewPrompt: rv && read(runFile(rv, "prompt.md")), reviewStream: rv && read(runFile(rv, "transcript.jsonl")),
      startMs: Date.parse(run.started) || Date.now(), endMs: Date.parse(run.ended ?? "") || Date.now(),
    });
    const r = await postSpans(cfg, spans);
    if (!r.ok) logTo(folder, "dispatch", `${new Date().toISOString()} langfuse post failed: ${r.status ?? ""} ${r.error ?? ""}\n`.replace(/\s+\n/, "\n"));
  } catch (e) {
    try { logTo(folder, "dispatch", `${new Date().toISOString()} trace failed: ${errText(e)}\n`); } catch {}
  }
}
