import { afterAll, beforeAll, expect, test } from "bun:test";
import { conn } from "../../../lib/db.ts";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentCause, callAgent, resultOf } from "./agent-call.ts";
import { backendHold } from "../gates/holds.ts";

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

test("a call's tokens are its result event's input, output, cache read and cache creation, and none without usage", async () => {
  const ev = { type: "result", is_error: false, result: "ok", usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 300, cache_creation_input_tokens: 50 } };
  expect((await callAgent("intake", "x", ask(fake(`echo '${JSON.stringify(ev)}'`)))).tokens).toBe(1550);
  const bare = { type: "result", is_error: false, result: "ok" };
  expect((await callAgent("intake", "x", ask(fake(`echo '${JSON.stringify(bare)}'`)))).tokens).toBeUndefined();
});

test("a call on a model Claude does not serve is priced from its tokens, not from Claude Code's cost", async () => {
  const ev = { type: "result", is_error: false, result: "ok", total_cost_usd: 9, usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 } };
  const r = await callAgent("monitor", "x", ask(fake(`echo '${JSON.stringify(ev)}'`), "deepseek-v4.1-flash"));
  expect(r.cost).toBeCloseTo(0.545);
});

test("a call on OpenRouter is priced at what OpenRouter bills per list dollar, and a local call at 0", async () => {
  conn().query("INSERT INTO openrouter (time, usage, factor) VALUES (?, ?, ?), (?, ?, ?)").run("2026-11-11T00:00:00Z", 1, null, "2026-11-11T00:10:00Z", 2, 1.3);
  try {
    const ev = { type: "result", is_error: false, result: "ok", total_cost_usd: 9, usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 } };
    expect((await callAgent("monitor", "x", ask(fake(`echo '${JSON.stringify(ev)}'`), "deepseek-v4.1-flash"))).cost).toBeCloseTo(0.545 * 1.3);
    expect((await callAgent("monitor", "x", ask(fake(`echo '${JSON.stringify(ev)}'`), "gpt-oss-20b"))).cost).toBe(0);
  } finally {
    conn().run("DELETE FROM openrouter");
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

test("resultOf takes the model the CLI ran on from its init event", () => {
  const res = '{"type":"result","is_error":false,"result":"done"}';
  expect(resultOf(`{"type":"system","subtype":"init","model":"claude-opus-5-5"}\n{"type":"assistant"}\n${res}\n`).model).toBe("claude-opus-5-5");
  expect(resultOf(`${res}\n`).model).toBeUndefined();
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

/** A shell prefix that opens fd 3 on a pipe with no writer: `read -t N -u 3` then waits N seconds. */
const WAIT = `f=$(mktemp -u); mkfifo $f; exec 3<>$f; rm $f`;

test("output on stderr keeps a call from stalling, and a silent call stalls", async () => {
  process.env.ALEPH_STALL_SECONDS = "1";
  try {
    const busy = await callAgent("monitor", "x", ask(fake(`${WAIT}; for i in 1 2 3 4 5 6; do echo tick >&2; read -t 0.4 -u 3; done`)));
    expect(busy.step.stalled).toBe(false);
    const silent = await callAgent("monitor", "x", ask(fake(`${WAIT}; read -t 30 -u 3`)));
    expect(silent.step.stalled).toBe(true);
  } finally { delete process.env.ALEPH_STALL_SECONDS; }
});
