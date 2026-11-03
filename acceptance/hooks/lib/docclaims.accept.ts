// Archived goal tests from hooks/lib/docclaims.test.ts: `bun run accept` runs them, `bun run test` does not.
import { describe, expect, test } from "bun:test";
import { claimsDocMatch, docClaimProblems } from "../../../hooks/lib/docclaims.ts";

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
  test("says a doc matches the code", () => {
    expect(claimsDocMatch("The settings defaults and the docs match.")).toBe(true);
    expect(claimsDocMatch("README is consistent with the code.")).toBe(true);
    expect(claimsDocMatch("facts as the code on main has them")).toBe(true);
  });
  test("a message with no such claim is not one", () => {
    expect(claimsDocMatch("I added a section to docs/factory.md.")).toBe(false);
    expect(claimsDocMatch("Tests pass.")).toBe(false);
  });
});

describe("docClaimProblems", () => {
  const claim = "The docs match the code.";
  test("no claim, no check, whatever the docs hold", () => {
    expect(docClaimProblems([...edit()], "I edited docs/a.md.")).toEqual([]);
  });
  test("a claim with no run after the last edit is named", () => {
    const e = [...bash("grep -n X jobs/lib/a.ts", "x"), ...edit()];
    expect(docClaimProblems(e, claim).join()).toContain("no run after the last edit");
  });
  test("a comparing run after the last edit backs the claim", () => {
    const e = [...edit(), ...bash("aleph doc-claims", "every checked doc claim matches")];
    expect(docClaimProblems(e, claim)).toEqual([]);
  });
  test("a bash edit counts as the last edit", () => {
    const e = [...bash("grep X a.ts", "x"), ...bash("sed -i s/a/b/ docs/a.md")];
    expect(docClaimProblems(e, claim).join()).toContain("no run after the last edit");
  });
  test("cut output that hides the claimed value is named", () => {
    const long = `${"a".repeat(600)}\ntimeout 1800 s\n${"b".repeat(600)}`;
    const e = [...edit(), ...bash("grep -rn timeout jobs docs/factory.md", long)];
    expect(docClaimProblems(e, "The docs match: job timeout `1800 s`.").join()).toContain("`1800 s`");
  });
  test("a value that shows in the head or tail is not hidden", () => {
    const long = `${"a".repeat(300)} 1800 s ${"b".repeat(900)}`;
    const e = [...edit(), ...bash("grep -rn timeout jobs docs/factory.md", long)];
    expect(docClaimProblems(e, "The docs match: job timeout `1800 s`.")).toEqual([]);
  });
});
