import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentCause, callAgent, resultOf } from "./agent-call.ts";
import { backendHold } from "../gates/factory-status.ts";

let base: string;
const saved = { ...process.env };
/** A stand-in for `claude` that runs `body`. */
const fake = (body: string): string => {
  const path = join(base, `fake-${Math.random().toString(36).slice(2)}`);
  writeFileSync(path, `#!/bin/bash\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
};
const ask = (cmd: string, model = "m-1") => ({ model, cmd, flags: ["--tools", "Read"], stdout: join(base, "out"), stderr: join(base, "err"), limit: 60 });

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-agent-call-"));
  process.env.ALEPH_JOBS_DIR = join(base, "jobs");
  process.env.XDG_RUNTIME_DIR = join(base, "run");
  // The backend hold is a file in the factory folder: another test's hold must not be this one's.
  process.env.ALEPH_FACTORY_DIR = join(base, "factory");
});
afterAll(() => { rmSync(base, { recursive: true, force: true }); process.env = saved; });

test("a call with a schema gives the structured output, the session and the cost of its own result event", async () => {
  const ev = { type: "result", is_error: false, result: "done", total_cost_usd: 0.5, session_id: "s-1", structured_output: { verdict: "pass" } };
  writeFileSync(join(base, "out"), `${JSON.stringify({ ...ev, structured_output: { verdict: "old" } })}\n`);
  const cmd = fake(`echo "$@" > ${join(base, "args")}; cat > ${join(base, "stdin")}; echo '${JSON.stringify(ev)}'`);
  const r = await callAgent("intake", "hello", { ...ask(cmd), schema: { type: "object" } });
  expect(r).toMatchObject({ text: "done", data: { verdict: "pass" }, session: "s-1", cost: 0.5, cause: null });
  expect(readFileSync(join(base, "stdin"), "utf8")).toBe("hello");
  expect(readFileSync(join(base, "args"), "utf8")).toContain('--model m-1 --output-format stream-json --verbose --tools Read --json-schema {"type":"object"}');
});

test("a call on a model Claude does not serve is priced from its tokens, not from Claude Code's cost", async () => {
  const ev = { type: "result", is_error: false, result: "ok", total_cost_usd: 9, usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 } };
  const r = await callAgent("monitor", "x", ask(fake(`echo '${JSON.stringify(ev)}'`), "deepseek-v4.1-flash"));
  expect(r.cost).toBeCloseTo(0.545);
});

test("a call on OpenRouter is priced at what OpenRouter bills per list dollar, and a local call at 0", async () => {
  const dir = mkdtempSync(join(tmpdir(), "or-")), keep = process.env.ALEPH_OPENROUTER_FILE;
  process.env.ALEPH_OPENROUTER_FILE = join(dir, "openrouter.jsonl");
  writeFileSync(process.env.ALEPH_OPENROUTER_FILE, [{ at: "2026-11-11T00:00:00Z", usage: 1 }, { at: "2026-11-11T00:10:00Z", usage: 2, factor: 1.3 }, "torn"].map((r) => JSON.stringify(r)).join("\n") + "\n");
  try {
    const ev = { type: "result", is_error: false, result: "ok", total_cost_usd: 9, usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 } };
    expect((await callAgent("monitor", "x", ask(fake(`echo '${JSON.stringify(ev)}'`), "deepseek-v4.1-flash"))).cost).toBeCloseTo(0.545 * 1.3);
    expect((await callAgent("monitor", "x", ask(fake(`echo '${JSON.stringify(ev)}'`), "gpt-oss-20b"))).cost).toBe(0);
  } finally {
    if (keep === undefined) delete process.env.ALEPH_OPENROUTER_FILE; else process.env.ALEPH_OPENROUTER_FILE = keep;
    rmSync(dir, { recursive: true });
  }
});

test("a call the API refused for credit states the credit cause and holds its model's backend", async () => {
  const line = "API Error: 402 This request would exceed your available credits";
  const r = await callAgent("reviewer", "x", ask(fake(`echo '${JSON.stringify({ type: "result", is_error: true, result: line })}'; exit 1`)));
  expect(r.cause).toEqual({ kind: "credit", reason: line });
  expect(r.text).toBe(line);
  expect(backendHold()).toMatchObject({ via: "claude", why: line });
  expect(agentCause({ code: 1, timedOut: false, stalled: false }, { found: true, ok: false, line, result: "" })).toEqual({ kind: "credit", reason: line });
});

test("resultOf reads the last result event; only is_error false is ok", () => {
  const ok = '{"type":"result","is_error":false,"total_cost_usd":0.5,"result":"done"}';
  expect(resultOf(`{"type":"assistant"}\n${ok}\n`)).toMatchObject({ found: true, ok: true, cost: 0.5, result: "done", line: "" });
  expect(resultOf(`${ok}\nafter\n{"type":"command_lifecycle"}\n`)).toMatchObject({ ok: true, result: "done" });
  expect(resultOf('{"type":"result","is_error":true,"result":"API Error"}')).toMatchObject({ ok: false, line: "API Error" });
  expect(resultOf('{"type":"result","result":"no flag"}').ok).toBe(false);
  expect(resultOf('{"type":"assistant"}\nlast words\n{"type":"command_lifecycle"}\n')).toMatchObject({ found: false, ok: false, line: "last words" });
  expect(resultOf("")).toMatchObject({ found: false, ok: false, line: "no output" });
});
