import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digest } from "./digest.ts";

const dir = mkdtempSync(join(tmpdir(), "aleph-digest-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

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
