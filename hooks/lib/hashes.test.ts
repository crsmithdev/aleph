import { describe, expect, test } from "bun:test";
import { backing, unbackedHashes } from "./hashes.ts";

describe("backing", () => {
  test("keeps the prompt, tool results and tool inputs, and leaves out assistant prose", () => {
    const entries = [
      { type: "user", message: { role: "user", content: "check abc1234" } },
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "landed as def5678" }, { type: "tool_use", id: "t", name: "Bash", input: { command: "git show --stat fed9876" } }] } },
      { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "commit 0a1b2c3" }] } },
    ];
    const text = backing(entries);
    expect(unbackedHashes("abc1234 def5678 fed9876 0a1b2c3", text)).toEqual(["def5678"]);
  });
});
