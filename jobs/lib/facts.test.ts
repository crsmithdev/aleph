import { expect, test } from "bun:test";
import { parseFacts } from "./facts.ts";

test("sourced FACT lines give facts with their sources", () => {
  const r = parseFacts("done\nFACT: bun test runs everything [source: package.json:7]\nFACT: the gate lives in gate.ts [source: abc1234]\nFACT: docs [source: https://example.com/a]");
  expect(r.facts).toEqual([
    { fact: "bun test runs everything", source: "package.json:7" },
    { fact: "the gate lives in gate.ts", source: "abc1234" },
    { fact: "docs", source: "https://example.com/a" },
  ]);
  expect(r.unsourced).toEqual([]);
});

test("a FACT line without a source, or with a bad one, is unsourced", () => {
  const r = parseFacts("FACT: no source here\nFACT: empty [source: ]\nFACT: vague [source: I remember it]");
  expect(r.facts).toEqual([]);
  expect(r.unsourced).toHaveLength(3);
});

test("no FACT lines gives empty lists; DEFAULT and FOLLOWUP are not facts", () => {
  expect(parseFacts("summary")).toEqual({ facts: [], unsourced: [] });
  expect(parseFacts("DEFAULT: q -> a [source: x.ts]\nFOLLOWUP: t [source: x.ts]")).toEqual({ facts: [], unsourced: [] });
});
