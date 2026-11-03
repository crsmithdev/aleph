import { expect, test } from "bun:test";
import { failedTests, oracleCommands, rerunOf } from "./acceptance.ts";

// The pure parsers of acceptance.ts: no git repo, no store.
const FAILED = "jobs/lib/acceptance.test.ts:\n(fail) outer (x) > one [1.00ms]\n\nb.test.ts:\n(fail) two\n 2 fail\n";

test("a placeholder of more than one word is not runnable; a redirection with a space is", () => {
  const body = "## Oracle\n`bun test <that file>`\n`bun test <test file path>`\n`bun test jobs/lib/a.test.ts 2>&1`\n`bun test jobs/lib/a.test.ts <in >out`\n`bun test jobs/lib/a.test.ts > out.log`";
  expect(oracleCommands(body)).toEqual(["bun test jobs/lib/a.test.ts 2>&1", "bun test jobs/lib/a.test.ts <in >out", "bun test jobs/lib/a.test.ts > out.log"]);
});

test("failedTests takes each failure with the file above it, and rerunOf names only those", () => {
  const tests = failedTests(FAILED);
  expect(tests).toEqual([{ file: "jobs/lib/acceptance.test.ts", name: "outer (x) > one" }, { file: "b.test.ts", name: "two" }]);
  expect(rerunOf("bun run test", tests)).toBe(`bun test --timeout=30000 ./jobs/lib/acceptance.test.ts ./b.test.ts -t '^outer \\(x\\)( > | )one$|^two$'`);
  expect(rerunOf("bun run test", [{ file: "b.test.ts", name: "(unnamed)" }])).toBe("bun test --timeout=30000 ./b.test.ts");
  expect(rerunOf("bunx tsc", [])).toBe("bunx tsc");
  expect(rerunOf("bun run test", [{ name: "no file" }])).toBe("bun run test");
});
