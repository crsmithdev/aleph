import { describe, expect, test } from "bun:test";
import { claimsDocMatch, docClaimProblems } from "./docclaims.ts";

let n = 0;
const use = (name: string, input: Record<string, unknown>, out = "") => {
  const id = `t${n++}`;
  return [
    { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] } },
    { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: out }] } },
  ];
};
const edit = (f = "docs/a.md") => use("Edit", { file_path: f });
const bash = (command: string, out = "") => use("Bash", { command }, out);

describe("claimsDocMatch", () => {
  test("a file name with a period between the doc and the claim stays in one sentence", () => {
    expect(claimsDocMatch("The stall default in docs/factory.md matches the code.")).toBe(true);
    expect(claimsDocMatch("docs/ui.md matches the code.")).toBe(true);
    expect(claimsDocMatch("I edited the doc. Tests are correct.")).toBe(false);
  });
  test("a sentence that does not name the code side is not a claim", () => {
    expect(claimsDocMatch("The label says that an edited spec is checked first.")).toBe(false);
    expect(claimsDocMatch("The doc says the limit in jobs/lib/ask.ts is correct.")).toBe(true);
  });
  test("a state verb is a claim alone, and a spec is a doc but a spec check is not", () => {
    expect(claimsDocMatch("I checked the docs; they are accurate.")).toBe(true);
    expect(claimsDocMatch("The spec matches the code.")).toBe(true);
    expect(claimsDocMatch("`checkSpec` strips it before matching `spec check: <hash>`, because a plain `startsWith` never matched.")).toBe(false);
  });
  test("a names-only diff sentence is not a claim, even when a docs/ path is in it", () => {
    expect(claimsDocMatch("The branch now changes only docs/design.md, ui/app.css, ui/gates.test.ts and ui/views/gates.js (checked with `git diff --name-only main...HEAD`).")).toBe(false);
    expect(claimsDocMatch("I checked docs/design.md against ui/lib.js after the edit.")).toBe(true);
    expect(claimsDocMatch("docs/factory.md matches the code in jobs/lib/unit.ts.")).toBe(true);
  });
});

describe("docClaimProblems", () => {
  const claim = "The docs match the code.";
  test("a commit after the comparing run is not an edit, with or without a heredoc message", () => {
    for (const commit of [`git add -A && git commit -qm "Docs"`, `git commit -F - <<'EOF'\nDocs\nEOF`]) {
      const e = [...edit(), ...bash("aleph doc-claims", "every checked doc claim matches"), ...bash(commit)];
      expect(docClaimProblems(e, claim)).toEqual([]);
    }
  });
  test("a file written before the commit in one command is still an edit", () => {
    const e = [...bash("aleph doc-claims", "ok"), ...bash(`cat > docs/a.md <<'EOF'\nx\nEOF\ngit commit -qam x`)];
    expect(docClaimProblems(e, claim).join()).toContain("no run after the last edit");
  });
  test("a cited file:line no output shows is named, one shown is not", () => {
    const e = [...edit(), ...bash("grep -n isBuildable jobs/lib/store.ts docs/factory.md", "242:export function isBuildable")];
    expect(docClaimProblems(e, "Docs match the code (jobs/lib/store.ts:242).")).toEqual([]);
    expect(docClaimProblems(e, "Docs match the code (jobs/lib/store.ts:300).").join()).toContain("store.ts:300");
  });
  test("a code file named with no tool call on it is named", () => {
    const e = [...edit(), ...bash("grep -n X jobs/lib/a.ts", "1:X")];
    const p = docClaimProblems(e, "Docs match; `dispatchIssues` in `jobs/lib/factory.ts` is as the code on main has them.");
    expect(p.join()).toContain("jobs/lib/factory.ts");
    expect(p.join()).not.toContain("a.ts");
  });
});
