import { expect, test } from "bun:test";
import { spansFor } from "./trace.ts";
import type { Run } from "../records/ledger.ts";

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

const run: Run = { kind: "build", job: "job-1", name: "alpha", repo: "fac", condition: "passed", on: "fac-7", cost: 0.5, model: "claude-opus-5-5", told: false, started: "2026-10-27T10:00:00Z" };

test("a reviewer's run is a second tree under the same trace", () => {
  const spans = spansFor({ runId: "run-1", run, repoKey: "fac", prompt: "p", stream: STREAM, reviewPrompt: "rp", reviewStream: STREAM, startMs: T0, endMs: T0 + 60_000 });
  expect(spans.length).toBe(6);
  const reviewer = spans[3];
  expect(reviewer.name).toBe("reviewer");
  expect(reviewer.parentSpanId).toBe(spans[0].spanId);
  expect(spans[4].parentSpanId).toBe(reviewer.spanId);
});
