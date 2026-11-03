// Archived goal tests from jobs/lib/acceptance.parse.test.ts: `bun run accept` runs them, `bun run test` does not.
import { expect, test } from "bun:test";
import { oracleCommands } from "../../../jobs/lib/acceptance.ts";


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
