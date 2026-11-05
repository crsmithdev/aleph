import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nextBrief } from "../transitions/continuation.ts";
import type { Run } from "../records/ledger.ts";
import { docClaims } from "./unit.ts";

let n = 0;
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

/** A worker's stream-json output.log: a tool call and its result per step, with the system and result lines around them. */
function run(steps: [name: string, input: Record<string, unknown>, out: string][]): string {
  const folder = mkdtempSync(join(tmpdir(), "aleph-docclaims-"));
  dirs.push(folder);
  const lines: unknown[] = [{ type: "system", subtype: "init" }];
  for (const [name, input, out] of steps) {
    const id = `t${n++}`;
    lines.push({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] } });
    lines.push({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: out }] } });
  }
  lines.push({ type: "result", subtype: "success", result: "" });
  writeFileSync(join(folder, "output.log"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return folder;
}
const edit = (f = "docs/factory.md"): [string, Record<string, unknown>, string] => ["Edit", { file_path: f }, "ok"];
const bash = (command: string, out: string): [string, Record<string, unknown>, string] => ["Bash", { command }, out];

const claim = "The stall default in docs/factory.md matches the code: `600`.";

test("a claim that a run after the last edit shows backs passes", () => {
  const f = run([edit(), bash("grep -n stall docs/factory.md jobs/lib/infra/process.ts", "docs/factory.md:91: (600)\njobs/lib/infra/process.ts:125: ?? 600")]);
  expect(docClaims(f, claim)).toBeNull();
});

test("a claim whose only comparing run comes before the last edit fails and names it", () => {
  const f = run([bash("grep -n stall docs/factory.md jobs/lib/infra/process.ts", "600"), edit()]);
  expect(docClaims(f, claim)).toContain("no run after the last edit reads the doc and compares it with the code");
});

test("a claim whose comparing run prints the claimed value mid-output passes", () => {
  const out = `${"x".repeat(3000)} 600 ${"y".repeat(3000)}`;
  const f = run([edit(), bash("grep -rn stall docs/factory.md jobs/lib/infra/process.ts", out)]);
  expect(docClaims(f, claim)).toBeNull();
});

test("a cited file:line that no run shows fails and names the location", () => {
  const f = run([edit(), bash("grep -n stall docs/factory.md", "docs/factory.md:91: stalled")]);
  expect(docClaims(f, "I confirmed the doc matches the code at `jobs/lib/infra/process.ts:125`.")).toContain("`jobs/lib/infra/process.ts:125`");
});

test("facts given as the code on main has them, with the code file never read, fail and name the file", () => {
  const f = run([edit("docs/spec.md"), bash("grep -n stall docs/spec.md", "stall")]);
  expect(docClaims(f, "The spec gives the stall rule in jobs/lib/infra/process.ts as the code on main has them.")).toContain("`jobs/lib/infra/process.ts`");
});

test("a final message with no doc claim passes, whatever the transcript", () => {
  const f = run([bash("grep -n stall docs/factory.md", "600"), edit()]);
  expect(docClaims(f, "I added the stall row to docs/factory.md. Tests pass.")).toBeNull();
});

test("a run with no output.log passes", () => {
  const folder = mkdtempSync(join(tmpdir(), "aleph-docclaims-"));
  dirs.push(folder);
  expect(docClaims(folder, claim)).toBeNull();
});

test("the next worker's fix note gives each problem", () => {
  const f = run([bash("grep -n stall docs/factory.md", "600"), edit()]);
  expect(docClaims(f, claim)).not.toBeNull();
  expect(readFileSync(join(f, "checks.log"), "utf8")).toStartWith("## doc-claims: exit 1\n");
  const { note } = nextBrief(f, { failed: "doc-claims" } as Run);
  expect(note).toContain("The check `doc-claims` failed");
  expect(note).toContain("no run after the last edit reads the doc and compares it with the code");
});

test("the reason quotes the claim that no run backs", () => {
  const f = run([bash("grep -n stall docs/factory.md jobs/lib/infra/process.ts", "600"), edit()]);
  expect(docClaims(f, claim)).toContain('"The stall default in docs/factory.md matches the code: `600`"');
});

test("a test run or a diff of names after the last edit does not compare the doc", () => {
  for (const cmd of ["bun run test", "git diff --stat", "git diff --name-only main"]) {
    const f = run([edit(), bash(cmd, "docs/factory.md | 2 +-\n1827 pass")]);
    expect(docClaims(f, claim)).toContain("no run after the last edit reads the doc");
  }
});

test("a comparing run cut by head before the claimed value names the value", () => {
  const f = run([edit(), bash("grep -n stall docs/factory.md jobs/lib/infra/process.ts | head -1", "docs/factory.md:91: stalled: no output")]);
  expect(docClaims(f, claim)).toContain("`600`");
});

test("a plain number in the claim counts as a value", () => {
  const f = run([edit(), bash("grep -n stall docs/factory.md", "docs/factory.md:91: stalled [Output truncated]")]);
  expect(docClaims(f, "The stall default in docs/factory.md matches the code: 600 seconds.")).toContain("`600`");
});

test("a code file named by its basename alone, never read, is named", () => {
  const f = run([edit(), bash("grep -n stall docs/factory.md", "docs/factory.md:91: 600")]);
  expect(docClaims(f, "The doc matches the default of 600 in process.ts.")).toContain("`process.ts`");
});

test("a doc the run writes with facts as the code on main has them, the code never read, is named", () => {
  const f = run([["Write", { file_path: "docs/spec.md", content: "The stall default in jobs/lib/infra/process.ts is 600, as the code on main has them.\n" }, "ok"]]);
  const r = docClaims(f, "I wrote docs/spec.md.");
  expect(r).toContain("`jobs/lib/infra/process.ts`");
  expect(r).toContain("as the code on main has them");
});

test("a doc written after the code was read passes", () => {
  const f = run([["Read", { file_path: "jobs/lib/infra/process.ts" }, "125: ?? 600"], ["Write", { file_path: "docs/spec.md", content: "The stall default in jobs/lib/infra/process.ts is 600, as the code on main has them.\n" }, "ok"]]);
  expect(docClaims(f, "I wrote docs/spec.md.")).toBeNull();
});

test("a doc or spec written through a Bash heredoc, the code never read, is named", () => {
  for (const cmd of [
    "cat > docs/spec.md <<'EOF'\nThe stall default in jobs/lib/infra/process.ts is 600, as the code on main has them.\nEOF",
    "aleph issue add aleph \"Fix stalls\" --spec - <<'EOF'\nThe stall default in jobs/lib/infra/process.ts is 600, as the code on main has them.\nEOF",
  ]) {
    const f = run([bash(cmd, "")]);
    expect(docClaims(f, "I filed it.")).toContain("`jobs/lib/infra/process.ts`");
  }
});

test("a script, a test fixture or a sed pattern that quotes the phrase is not doc text", () => {
  for (const cmd of [
    "python3 - <<'EOF'\nopen('a.test.ts','w').write('The stall default in jobs/lib/infra/process.ts is 600, as the code on main has them.')\nEOF",
    "sed -i 's/as the code on main has them in jobs\\/cli.ts/x/' docs/verify-gate.md",
    "sed -i 's/x/a line as the code on main has them, or `aleph issue add`/' docs/verify-gate.md && bun jobs/cli.ts doc-claims",
    "cat > a.test.ts <<'EOF'\nThe stall default in jobs/lib/infra/process.ts is 600, as the code on main has them.\nEOF",
    "python3 - <<'EOF'\nt = 'cat > docs/spec.md <<X and aleph issue add: the default in jobs/lib/infra/process.ts is 600, as the code on main has them.'\nEOF",
  ]) {
    const f = run([bash(cmd, "")]);
    expect(docClaims(f, "I edited it.")).toBeNull();
  }
});

