import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memory, use, type Observation } from "../../lib/langfuse.ts";
import { compileDigest } from "./compile.ts";

const DAY = "2026-10-05";
const at = (hhmm: string) => `${DAY}T${hhmm}:00`;
const roots: string[] = [];
const emptyRoot = () => { const r = mkdtempSync(join(tmpdir(), "vault-compile-")); roots.push(r); return r; };
afterEach(() => { use(null); for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });

const turn = (trace: string, id: string, hhmm: string, o: Partial<Observation> = {}): Observation => ({ id, traceId: trace, name: "turn", startTime: at(hhmm), ...o });

test("a trace digests to its cwd, each turn's prompt, commands, verify verdict and final message", async () => {
  use(memory({
    traces: [{ id: "t1", timestamp: at("09:00"), metadata: { cwd: "/work/aleph" } }],
    observations: [
      turn("t1", "late", "10:00", { input: "second prompt", output: "second final" }),
      turn("t1", "early", "09:00", { input: "first prompt", output: "first final" }),
      { id: "b1", traceId: "t1", parentObservationId: "early", name: "Bash", input: JSON.stringify({ command: "bun test" }) },
      { id: "b2", traceId: "t1", parentObservationId: "early", name: "Bash", input: { command: "git status" } },
      { id: "g1", traceId: "t1", parentObservationId: "early", type: "GUARDRAIL", name: "verify-gate", metadata: { verdict: "pass", reason: "ran bun test" } },
    ],
  }));
  const { text, empty } = await compileDigest(emptyRoot(), DAY);
  expect(text).toContain([
    "### trace t1 (/work/aleph)",
    "- prompt: first prompt",
    "  ran: bun test ; git status",
    "  verify: pass ran bun test",
    "  final: first final",
    "- prompt: second prompt",
    "  final: second final",
  ].join("\n"));
  expect(empty).toBe(false);
});

test("a trace with no turns digests as `no turns`", async () => {
  use(memory({ traces: [{ id: "t2", name: "idle", timestamp: at("09:00") }], observations: [] }));
  expect((await compileDigest(emptyRoot(), DAY)).text).toContain("### trace t2 (idle)\n- no turns");
});

test("a day with no traces, handoffs or daily note is empty", async () => {
  use(memory({ traces: [], observations: [] }));
  const { text, empty } = await compileDigest(emptyRoot(), DAY);
  expect(text).toContain("## Traces\n\nno traces on this date");
  expect(empty).toBe(true);
});

test("traces past 12 KiB are cut with a note that says how many the day had", async () => {
  const filler = 40; // about 620 characters a block, so the 12 KiB cap falls near the 20th
  const many = Array.from({ length: filler }, (_, i) => ({ id: `m${i}`, timestamp: at("08:00") }));
  use(memory({ traces: many, observations: many.map((t) => turn(t.id, `o-${t.id}`, "08:00", { input: "p", output: "y".repeat(600) })) }));
  const { text } = await compileDigest(emptyRoot(), DAY);
  expect(text).toContain(`… ${filler} traces on the day; digest capped at 12288 bytes`);
  expect(text).toContain("### trace m0 ");
  expect(text).not.toContain(`### trace m${filler - 1} `);
});

test("a Langfuse that fails is named in the Traces heading and the day is not empty", async () => {
  const lf = memory({ traces: [], observations: [] });
  lf.down = new Error("langfuse is down");
  use(lf);
  const { text, empty } = await compileDigest(emptyRoot(), DAY);
  expect(text).toContain("## Traces (Langfuse failed: langfuse is down)");
  expect(empty).toBe(false);
});
