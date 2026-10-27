import { expect, test } from "bun:test";
import { traceIdFor } from "../../hooks/lib/otlp.ts";
import { spansFor } from "./trace.ts";
import type { Run } from "./ledger.ts";

const T0 = Date.parse("2026-10-27T10:00:00Z");
const ev = (o: unknown) => JSON.stringify(o);
const STREAM = [
  ev({ type: "system", subtype: "init", model: "claude-opus-5-5" }),
  ev({ type: "assistant", timestamp: "2026-10-27T10:00:10Z", message: { content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "a.ts" } }] } }),
  ev({ type: "user", timestamp: "2026-10-27T10:00:11Z", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "contents of a" }] } }),
  ev({ type: "assistant", message: { content: [{ type: "tool_use", id: "t2", name: "Bash", input: { command: "bun test" } }] } }),
  ev({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t2", content: [{ type: "text", text: "boom" }], is_error: true }] } }),
  ev({ type: "result", is_error: false, total_cost_usd: 0.5, result: "Done." }),
].join("\n");

const run: Run = { kind: "agent", job: "job-1", name: "alpha", repo: "fac", state: "passed", todo: 7, cost: 0.5, model: "claude-opus-5-5", told: false, started: "2026-10-27T10:00:00Z" };
const attr = (s: any, k: string) => { const a = s.attributes.find((x: any) => x.key === k)?.value; return a && (a.stringValue ?? a.doubleValue ?? a.intValue ?? a.arrayValue?.values.map((v: any) => v.stringValue)); };

test("a transcript becomes a root span and one span per tool call", () => {
  const spans = spansFor({ runId: "run-1", run, repoKey: "fac", prompt: "the prompt", stream: STREAM, startMs: T0, endMs: T0 + 60_000 });
  expect(spans.length).toBe(3);
  const [root, read, bash] = spans;
  expect(spans.every((s) => s.traceId === traceIdFor("run-1"))).toBe(true);
  expect(root.parentSpanId).toBeUndefined();
  expect(attr(root, "langfuse.observation.input")).toBe("the prompt");
  expect(attr(root, "langfuse.observation.output")).toBe("Done.");
  expect(attr(root, "langfuse.session.id")).toBe("job-1");
  expect(attr(root, "langfuse.trace.name")).toBe("factory alpha");
  expect(attr(root, "langfuse.trace.tags")).toEqual(["factory", "fac"]);
  expect(attr(root, "langfuse.trace.metadata.state")).toBe("passed");
  expect(attr(root, "langfuse.trace.metadata.model")).toBe("claude-opus-5-5");
  expect(attr(root, "langfuse.trace.metadata.cost")).toBe(0.5);
  expect(attr(root, "langfuse.trace.metadata.item")).toBe("fac-7");
  expect(read.name).toBe("Read");
  expect(read.parentSpanId).toBe(root.spanId);
  expect(attr(read, "langfuse.observation.input")).toBe('{"file_path":"a.ts"}');
  expect(attr(read, "langfuse.observation.output")).toBe("contents of a");
  expect(read.startTimeUnixNano).toBe(`${T0 + 10_000}000000`);
  expect(read.endTimeUnixNano).toBe(`${T0 + 11_000}000000`);
  expect(bash.name).toBe("Bash");
  expect(attr(bash, "langfuse.observation.output")).toBe("boom");
  expect(attr(bash, "langfuse.observation.level")).toBe("ERROR");
  expect(BigInt(bash.startTimeUnixNano)).toBeGreaterThanOrEqual(BigInt(read.endTimeUnixNano));
});

test("a reviewer's run is a second tree under the same trace", () => {
  const spans = spansFor({ runId: "run-1", run, repoKey: "fac", prompt: "p", stream: STREAM, reviewPrompt: "rp", reviewStream: STREAM, startMs: T0, endMs: T0 + 60_000 });
  expect(spans.length).toBe(6);
  const reviewer = spans[3];
  expect(reviewer.name).toBe("reviewer");
  expect(reviewer.parentSpanId).toBe(spans[0].spanId);
  expect(spans[4].parentSpanId).toBe(reviewer.spanId);
});
