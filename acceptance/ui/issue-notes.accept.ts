// Archived goal tests from ui/issue-notes.test.ts: `bun run accept` runs them, `bun run test` does not.
import { describe, expect, test } from "bun:test";
// @ts-ignore plain JS, shared with the page
import { isMachineNote, renderIssue } from "../../ui/views/issues.js";

const page = (notes: string[], fm: Record<string, string> = {}) =>
  renderIssue({ repo: "r", id: 1, title: "t", labels: [], notes, goals: [], jobs: [], commits: [], runs: [], frontmatter: fm } as any) as string;
const st = (t: string) => `- 2026-10-31 10:00: ${t}`;
const fold = (h: string) => /<details class="notes-fold"[^>]*>[\s\S]*?<\/details>/.exec(h)?.[0] ?? "";

describe("issue notes fold", () => {
  test("machine notes fold, with the count", () => {
    const h = page([st("triage: filed goal aleph-1.1"), st("acceptance: pass at abc1234"), "- 2026-10-31 10:00:05: planner: x", "- hello"]);
    const f = fold(h);
    expect(f).not.toContain("<details open");
    expect(f).toContain("filed goal aleph-1.1");
    expect(f).toContain("pass at abc1234");
    expect(f).toContain("3 machine notes");
    expect(h.replace(f, "")).toContain("hello");
  });
  test("read-me notes and mid-text prefixes stay visible", () => {
    const notes = [st("triage: for Chris: pick one"), st("triage: a live check: x"), st("acceptance rerun by hand: y"), st("Chris said triage: later")];
    const h = page(notes);
    expect(h).not.toContain("notes-fold");
    for (const n of notes) expect(isMachineNote(n)).toBe(false);
  });
  test("flake tracker folds nothing", () => {
    const h = page([st("triage: filed goal aleph-1.1")], { tracker: "true" });
    expect(h).not.toContain("notes-fold");
    expect(h).toContain("filed goal");
  });
  test("human only and empty", () => {
    expect(page(["- hi"])).not.toContain("notes-fold");
    expect(page([])).toContain("No notes.");
  });
  test("all folded shows only the fold", () => {
    const h = page([st("triage: a")]);
    expect(h).toContain("notes-fold");
    expect(h.replace(fold(h), "")).not.toContain('class="notes"');
  });
  test("escapes inside and outside the fold", () => {
    const h = page([st("triage: <b>x</b>"), "- <i>y</i>"]);
    expect(h).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(h).toContain("&lt;i&gt;y&lt;/i&gt;");
    expect(h).not.toContain("<b>x");
    expect(h).not.toContain("<i>y");
  });
});
