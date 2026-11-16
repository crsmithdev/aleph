import { expect, test } from "bun:test";
import { broken, longSubject, table } from "./voice.ts";

const words = (n: number) => Array(n).fill("word").join(" ");

test("each check counts a text that breaks it and not a clean one", () => {
  const cases: [string, string, string][] = [
    ["semicolon", "It ran; it passed.", "It ran. It passed."],
    ["perfect", "I have measured it.", "I measured it."],
    ["banned", "Just run it.", "Run it."],
    ["opener", "Done.\nLet me check.", "Done. Check next."],
    ["arrow", "Go from A → B.", "Go from A to B."],
    ["bold", "This is a **key** term.", "- **Label** the term."],
    ["long", `${words(26)}.`, `${words(25)}.`],
    ["notVerified", "Done.\nNot verified: the UI.", "Done."],
    ["leftOut", "Done.\nLeft out: the docs (ask)", "Done."],
  ];
  for (const [check, bad, clean] of cases) {
    expect(broken(bad)).toContain(check);
    expect(broken(clean)).not.toContain(check);
  }
  expect(broken("Run `a; b` and `have measured`.\n```\nlet me; just A → B\n```")).toEqual([]);
});

test("a run falls in the period of its stamp, under its own role", () => {
  const out = table([
    { role: "worker", started: "2026-11-11T10:43:00Z", text: "Just run it." },
    { role: "review", started: "2026-11-11T10:45:00Z", text: "Just run it.\nAnd more." },
    { role: "intake", started: "2026-11-03T23:59:00Z", text: "Just run it." },
  ]);
  const row = (role: string, p: string) => out.split("\n").find((l) => l.startsWith(`| ${role} | ${p} |`))!;
  expect(row("worker", "base")).toContain("| 1 | ");
  expect(row("worker", "base")).toContain("100.0% (1/1)");
  expect(row("worker", "after")).toContain("| 0 | ");
  expect(row("review", "after")).toContain("100.0% (1/1)");
  expect(row("review", "base")).toContain("| 0 | ");
  expect(row("intake", "base")).toContain("| 0 | ");
  expect(out.split("\n")).toHaveLength(12);
});

test("a commit subject over 50 characters counts", () => {
  expect(longSubject("x".repeat(51))).toBe(true);
  expect(longSubject("x".repeat(50))).toBe(false);
  const out = table([{ role: "worker", started: "2026-11-12T00:00:00Z", subjects: ["x".repeat(51), "x".repeat(50)] }]);
  expect(out).toContain("| 2 | 50.0% (1/2) |");
});
