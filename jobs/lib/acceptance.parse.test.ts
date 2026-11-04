import { expect, test } from "bun:test";
import * as issues from "../../todo/lib/todo.ts";
import { failedTests, oracleCommands, rerunOf, scenarioMarks, scenarioTexts, setAside } from "./acceptance.ts";

// The pure parsers of acceptance.ts: no git repo, no store.
const FAILED = "jobs/lib/acceptance.test.ts:\n(fail) outer (x) > one [1.00ms]\n\nb.test.ts:\n(fail) two\n 2 fail\n";

test("a placeholder of more than one word is not runnable; a redirection with a space is", () => {
  const body = "## Oracle\n`bun test <that file>`\n`bun test <test file path>`\n`bun test jobs/lib/a.test.ts 2>&1`\n`bun test jobs/lib/a.test.ts <in >out`\n`bun test jobs/lib/a.test.ts > out.log`";
  expect(oracleCommands(body)).toEqual(["bun test jobs/lib/a.test.ts 2>&1", "bun test jobs/lib/a.test.ts <in >out", "bun test jobs/lib/a.test.ts > out.log"]);
});

test("a bun test file without .test or .spec in its name gets a ./ path; other arguments stay", () => {
  const body = "## Oracle\n`bun test acceptance/ui/lib.accept.ts`\n`bun test ./acceptance/a.accept.ts jobs/lib/a.test.ts -t x`\n`bunx tsc`";
  expect(oracleCommands(body)).toEqual(["bun test ./acceptance/ui/lib.accept.ts", "bun test ./acceptance/a.accept.ts jobs/lib/a.test.ts -t x", "bunx tsc"]);
});

test("failedTests takes each failure with the file above it, and rerunOf names only those", () => {
  const tests = failedTests(FAILED);
  expect(tests).toEqual([{ file: "jobs/lib/acceptance.test.ts", name: "outer (x) > one" }, { file: "b.test.ts", name: "two" }]);
  expect(rerunOf("bun run test", tests)).toBe(`bun test --timeout=30000 ./jobs/lib/acceptance.test.ts ./b.test.ts -t '^outer \\(x\\)( > | )one$|^two$'`);
  expect(rerunOf("bun run test", [{ file: "b.test.ts", name: "(unnamed)" }])).toBe("bun test --timeout=30000 ./b.test.ts");
  expect(rerunOf("bunx tsc", [])).toBe("bunx tsc");
  expect(rerunOf("bun run test", [{ name: "no file" }])).toBe("bun run test");
});

test("scenarioMarks reads the capital CHECK lines, wrapped ones too, with the observation; a fail wins over a pass", () => {
  const marks = scenarioMarks("  CHECK: pass scenario 1: ok\ncheck: fail scenario 1: lowercase\n**CHECK: pass scenario 2: ok**\nCHECK: fail scenario 2: the panel shows 0.0%\n");
  expect([...marks]).toEqual([[1, { mark: "pass", seen: "ok" }], [2, { mark: "fail", seen: "the panel shows 0.0%" }]]);
});

test("scenarioTexts keeps each scenario's lines up to the next number", () => {
  expect([...scenarioTexts("Intro\n1. the widget\n   turns purple\n\n2) the gizmo hums\n")]).toEqual([[1, "1. the widget\nturns purple"], [2, "2) the gizmo hums"]]);
});

test("setAside reads the scenario numbers that a set-aside note opens with, and not a part of a scenario", () => {
  const item = { notes: [
    "- 2026-11-01 10:00: sealed checks: the reviewer set aside: scenario 2 – about the general CLI",
    "- 2026-11-01 10:00: sealed checks: the reviewer set aside: scenarios 3, 4 and 6: same reason",
    "- 2026-11-01 10:00: sealed checks: the reviewer set aside: scenario 7's \"another record\": outside the goal",
    "- 2026-11-01 10:00: sealed checks: the reviewer set aside: the part of scenario 5 about other fields",
    "- 2026-11-01 10:00: acceptance: fail at abc: scenario 9 failed",
  ] } as unknown as issues.Issue;
  expect([...setAside(item)].sort()).toEqual([2, 3, 4, 6, 7]);
});

test("setAside counts only the notes after the last seal: a new spec version's scenarios reuse the numbers", () => {
  const item = { notes: [
    "- 2026-11-01 10:00: sealed checks: 0123456789ab 3 scenarios from a fresh author",
    "- 2026-11-01 11:00: sealed checks: the reviewer set aside: scenario 2: old",
    "- 2026-11-02 10:00: sealed checks: ba9876543210 4 scenarios from a fresh author",
    "- 2026-11-02 10:01: sealed checks: ba9876543210 the spec check set aside: scenario 1: not in the goal",
    "- 2026-11-02 11:00: sealed checks: the reviewer set aside: scenario 3: new",
  ] } as unknown as issues.Issue;
  expect([...setAside(item)]).toEqual([3]);
});
