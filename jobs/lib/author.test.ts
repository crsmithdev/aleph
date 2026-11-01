import { describe, expect, test } from "bun:test";
import { authorPrompt, parseFiles, whyRejected } from "./author.ts";

describe("the author's reply", () => {
  test("files, a reason for none, and what is wrong with a bad reply", () => {
    expect(parseFiles('text {"files": {"a.test.ts": "x"}} text')).toEqual({ files: { "a.test.ts": "x" } });
    expect(parseFiles('{"files": {}, "reason": "a layout"}')).toEqual({ none: "a layout" });
    expect(parseFiles('{"files": {}}')).toEqual({ none: "the author gave no reason" });
    expect(parseFiles("no json")).toBe("the reply has no JSON object");
    expect(parseFiles('{"files": {"../x.test.ts": "x"}}')).toBe("a bad file: ../x.test.ts");
    expect(parseFiles('{"files": {"a.ts": "x"}}')).toBe("a bad file: a.ts");
    expect(parseFiles('{"files": {"a.test.ts": "  "}}')).toBe("a bad file: a.test.ts");
    expect(parseFiles('{"files": {"a.test.ts":"x","b.test.ts":"x","c.test.ts":"x","d.test.ts":"x"}}')).toBe("4 files; the limit is 3");
  });
});

describe("the run on main", () => {
  test("only a failure by assertion in files that load counts", () => {
    expect(whyRejected({ code: 1, output: " 0 pass\n 1 fail\n" })).toBeNull();
    expect(whyRejected({ code: 0, output: " 2 pass\n 0 fail\n" })).toContain("prove nothing");
    expect(whyRejected({ code: 1, output: "# Unhandled error between tests\n 0 pass\n 1 fail\n" })).toContain("does not load");
    expect(whyRejected({ code: 1, output: "x", infra: true })).toContain("could not run");
  });
});

test("the prompt gives the goal and not the Oracle or the Edit surface", () => {
  const p = authorPrompt({ key: "r", hiddenRun: "bun test ./.hidden" } as any, { title: "T", spec: "## Goal\nEND\n\n## Edit surface\nSURFACE\n\n## Oracle\nORACLE\n" } as any);
  expect(p).toContain("END");
  expect(p).not.toContain("SURFACE");
  expect(p).not.toContain("ORACLE");
});
