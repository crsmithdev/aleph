import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assess, read, threshold } from "./lib/context.ts";

const HOOKS = import.meta.dir;
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "aleph-ctx-"));
  process.env.ALEPH_SPOOL = join(root, "spool");
  delete process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
  delete process.env.ALEPH_CONTEXT_WARN;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function transcript(lines: object[]): string {
  const path = join(root, "t.jsonl");
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n"));
  return path;
}

const turn = (fill: number) => ({ type: "assistant", message: { usage: { input_tokens: 10, cache_read_input_tokens: fill - 10 } } });

test("fill is the last request, not the sum", () => {
  const r = read(transcript([turn(50_000), turn(90_000)]));
  expect(r.fill).toBe(90_000);
  expect(r.requests).toBe(2);
  expect(r.compacted).toBe(false);
});

test("subagent requests are ignored", () => {
  const r = read(transcript([turn(90_000), { ...turn(700_000), isSidechain: true }]));
  expect(r.fill).toBe(90_000);
});

test("a compact boundary is seen", () => {
  expect(read(transcript([turn(10_000), { type: "system", subtype: "compact_boundary" }])).compacted).toBe(true);
  expect(read(transcript([{ type: "user", isCompactSummary: true, message: { content: "summary" } }])).compacted).toBe(true);
});

test("a microcompact boundary is not compaction", () => {
  const r = read(transcript([turn(10_000), { type: "system", subtype: "microcompact_boundary" }, turn(12_000)]));
  expect(r.compacted).toBe(false);
  expect(assess(r, 167_000, false, false).kind).toBe("quiet");
});

test("a missing transcript reads as empty", () => {
  expect(read(join(root, "gone.jsonl"))).toEqual({ fill: 0, compacted: false, requests: 0 });
});

test("the threshold follows the window, env over settings over default", () => {
  const settings = join(root, "settings.json");
  expect(threshold(settings)).toBe(967_000);                   // no settings file, model default
  writeFileSync(settings, JSON.stringify({ autoCompactWindow: 300_000 }));
  expect(threshold(settings)).toBe(267_000);
  process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = "200000";
  expect(threshold(settings)).toBe(167_000);           // env wins over the settings file
  process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = "40000";
  expect(threshold(settings)).toBe(7_000);
});

test("quiet, then warn, then gate", () => {
  const limit = 167_000;
  expect(assess({ fill: 100_000, compacted: false, requests: 3 }, limit, false, false).kind).toBe("quiet");
  const warn = assess({ fill: 130_000, compacted: false, requests: 3 }, limit, false, false);
  expect(warn.kind).toBe("warn");
  if (warn.kind === "warn") expect(warn.message).toContain("130k of the 167k budget");
  const gate = assess({ fill: 40_000, compacted: true, requests: 9 }, limit, false, false);
  expect(gate.kind).toBe("gate");
  if (gate.kind === "gate") expect(gate.reason).toContain("aleph:handoff");
});

test("the gate fires once a session and never on a retry", () => {
  const reading = { fill: 40_000, compacted: true, requests: 9 };
  expect(assess(reading, 167_000, true, false).kind).toBe("quiet");
  expect(assess(reading, 167_000, false, true).kind).toBe("quiet");
});

test("the warn fraction is tunable", () => {
  process.env.ALEPH_CONTEXT_WARN = "0.5";
  expect(assess({ fill: 90_000, compacted: false, requests: 3 }, 167_000, false, false).kind).toBe("warn");
});

function hook(payload: object, env: Record<string, string> = {}): string {
  const p = Bun.spawnSync(["bun", join(HOOKS, "context-gate.ts")], {
    stdin: Buffer.from(JSON.stringify(payload)),
    env: { ...process.env, ...env },
  });
  return p.stdout.toString().trim();
}

test("the hook blocks on the wire and only once", () => {
  const path = transcript([turn(40_000), { type: "system", subtype: "compact_boundary" }]);
  const payload = { hook_event_name: "Stop", session_id: "s1", transcript_path: path };
  const first = JSON.parse(hook(payload));
  expect(first.decision).toBe("block");
  expect(first.reason).toContain("Context gate");
  expect(hook(payload)).toBe("");
});

test("the hook warns on the wire and stays quiet below the fraction", () => {
  const path = transcript([turn(140_000)]);
  const payload = { hook_event_name: "Stop", session_id: "s2", transcript_path: path };
  const out = JSON.parse(hook(payload, { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "200000" }));
  expect(out.systemMessage).toContain("of the 167k budget");
  expect(hook(payload, { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "1000000" })).toBe("");
});

test("other events pass through", () => {
  expect(hook({ hook_event_name: "SubagentStop", session_id: "s3", transcript_path: transcript([turn(900_000)]) })).toBe("");
});
