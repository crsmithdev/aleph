import { expect, test } from "bun:test";
import { failedTests, oracleCommands, rerunOf } from "./acceptance.ts";

// The pure parsers of acceptance.ts: no git repo, no store.
const FAILED = "jobs/lib/acceptance.test.ts:\n(fail) outer (x) > one [1.00ms]\n\nb.test.ts:\n(fail) two\n 2 fail\n";

test("only backtick commands that start like the repo's checks are runnable", () => {
  const body = "## Goal\n`bun test x`\n## Oracle\n`bun test jobs/lib/a.test.ts` and `bun run lint`, then `bunx tsc --noEmit`; also `ls -la` and `bunx prettier`.\n## Time box\n1h";
  expect(oracleCommands(body)).toEqual(["bun test jobs/lib/a.test.ts", "bun run lint", "bunx tsc --noEmit"]);
  expect(oracleCommands("## Oracle\nIt works.")).toEqual([]);
});

test("shell loops that run a check are runnable; loops that run no check are not", () => {
  const a = "for i in 1 2 3 4; do bun test jobs/cli.basic.test.ts & done; wait";
  const b = "for j in 1 2 3 4; do (for i in $(seq 5); do bun test x || exit 1; done) & done; wait";
  const c = "for i in $(seq 10); do bun test x.test.ts || exit 1; done";
  const body = `## Oracle\n\`${a}\`\n\`${b}\`\n\`${c}\`\n\`bun test y\`\n\`ls -la\` \`bunx prettier\` \`for i in 1 2; do echo hi; done\``;
  expect(oracleCommands(body)).toEqual([a, b, c, "bun test y"]);
});

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
