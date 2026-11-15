import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dirs, turns, typed } from "./turns.ts";

const at = (m: number) => `2026-11-14T10:${String(m).padStart(2, "0")}:00Z`;
const rec = (m: number, type: string, content: unknown, extra = {}) =>
  JSON.stringify({ type, timestamp: at(m), entrypoint: "cli", message: { content }, ...extra });

test("a slash command reads as the command and its args, and harness text reads as nothing", () => {
  expect(typed("<command-message>x</command-message>\n<command-name>/aleph:sweep</command-name>\n<command-args>--since 1d</command-args>")).toBe("/aleph:sweep --since 1d");
  expect(typed("<system-reminder>hook</system-reminder>fix the tab")).toBe("fix the tab");
  expect(typed("<local-command-stdout></local-command-stdout>")).toBe("");
});

test("a turn keeps what Chris typed, the question put to him, his answer and the last reply", () => {
  const log = [
    rec(0, "user", "old prompt"),
    rec(1, "user", "rename the tab"),
    rec(2, "assistant", [{ type: "text", text: "Looking." }, { type: "tool_use", id: "b", name: "Bash", input: {} }]),
    rec(3, "assistant", [{ type: "text", text: "Done. Left out: the docs (ask)" }]),
    rec(4, "assistant", [{ type: "tool_use", id: "q", name: "AskUserQuestion", input: { questions: [{ question: "Which name?" }] } }]),
    rec(5, "user", [{ type: "tool_result", tool_use_id: "q", content: "Tabs" }]),
    rec(6, "user", [{ type: "tool_result", tool_use_id: "b", content: "ok" }]),
    rec(7, "assistant", [{ type: "text", text: "side" }], { isSidechain: true }),
  ].join("\n");
  expect(turns(log, at(0))!.map((t) => `${t.who}: ${t.text}`)).toEqual([
    "chris: rename the tab",
    "reply: Done. Left out: the docs (ask)",
    "asks: Which name?",
    "chris: Tabs",
  ]);
});

test("a headless session is not Chris's", () => {
  expect(turns(JSON.stringify({ type: "user", timestamp: at(1), entrypoint: "sdk-cli", message: { content: "brief" } }), at(0))).toBeNull();
});

test("the project directories are the repo's and its worktrees', not a sibling's", () => {
  const root = mkdtempSync(join(tmpdir(), "turns-"));
  for (const d of ["-r-aleph", "-r-aleph--worktrees-x", "-r-aleph-old"]) mkdirSync(join(root, d));
  expect(dirs(root, "/r/aleph").map((d) => d.split("/").at(-1)).toSorted()).toEqual(["-r-aleph", "-r-aleph--worktrees-x"]);
});
