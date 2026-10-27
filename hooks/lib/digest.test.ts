import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digest } from "./digest.ts";

const dir = mkdtempSync(join(tmpdir(), "aleph-digest-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(name: string, output: string): string {
  const path = join(dir, name);
  const lines = [
    { type: "user", promptId: "p1", message: { role: "user", content: "go" } },
    { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "grep -n model hooks/lib/judge.ts; ls" } }] } },
    { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: output }] } },
  ];
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return digest(path, "p1").text;
}

describe("digest Bash results", () => {
  test("a long result keeps its head and tail with a cut marker", () => {
    const out = ["hooks/lib/judge.ts:37: model", ...Array.from({ length: 150 }, (_, i) => `filler line ${i} xxxx`), "END"].join("\n");
    expect(out.length).toBeGreaterThan(2500);
    const text = run("long.jsonl", out);
    expect(text).toContain("judge.ts:37");
    expect(text).toContain("END");
    expect(text).toContain(`…(${out.length - 1000} chars cut)…`);
  });
  test("a 900-char result stays whole", () => {
    const out = `hooks/lib/judge.ts:37: model\n${"y".repeat(860)}\nEND`;
    const text = run("short.jsonl", out);
    expect(text).toContain(out);
    expect(text).not.toContain("chars cut)");
  });
});

test("the Stop input's final message wins over a preamble the transcript ends on", () => {
  const path = join(dir, "preamble.jsonl");
  const lines = [
    { type: "user", promptId: "p1", message: { role: "user", content: "is main behind?" } },
    { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "I'll check whether main is behind origin." }, { type: "tool_use", id: "t1", name: "Bash", input: { command: "git status -sb" } }] } },
    { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "## main...origin/main [behind 3]" }] } },
  ];
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  expect(digest(path, "p1", "Main is 3 commits behind origin.").finalMessage).toBe("Main is 3 commits behind origin.");
  expect(digest(path, "p1").finalMessage).toBe("I'll check whether main is behind origin.");
});
