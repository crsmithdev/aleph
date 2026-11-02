import { expect, test } from "bun:test";
import { authorPrompt, scenarioCount } from "./author.ts";

test("the numbered lines of a reply are its scenarios", () => {
  expect(scenarioCount("1. Someone opens it.\n2) Someone clicks it.\n")).toBe(2);
  expect(scenarioCount("No scenarios: 3 of them are unclear.")).toBe(0);
});

test("the prompt gives the goal and not the Oracle or the Edit surface", () => {
  const p = authorPrompt({ title: "T", spec: "## Goal\nEND\n\n## Edit surface\nSURFACE\n\n## Oracle\nORACLE\n" } as any);
  expect(p).toContain("END");
  expect(p).not.toContain("SURFACE");
  expect(p).not.toContain("ORACLE");
});
