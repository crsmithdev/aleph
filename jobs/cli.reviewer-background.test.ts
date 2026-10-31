import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, file, specFile, state, setup, teardown } from "./cli.helpers";

beforeAll(setup);
afterAll(teardown);

// A reviewer that prints its environment to its output, then passes.
const ENV_REVIEWER = `#!/bin/bash
cat > /dev/null
env
echo '{"type":"result","is_error":false,"result":"Fine.\\nVERDICT: pass"}'
`;

describe("a factory reviewer runs in the foreground", () => {
  test("the reviewer's environment turns background tasks off, and the review prompt says to wait", async () => {
    const reviewer = join(base, "env-reviewer");
    writeFileSync(reviewer, ENV_REVIEWER, { mode: 0o755 });
    const r = await aleph(["job", "fac", "rbg", "--spec", specFile("Goal: rbg REVIEW:pass\nACTION: commit rbg.txt\n")], { ALEPH_REVIEWER_CMD: reviewer, ALEPH_REVIEW_CMD: "/bin/false" });
    expect(state(r.json.run).state).toBe("passed");
    const seen = file(r.json.run, "review.log").split("\n");
    expect(seen).toContain("CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1");
    expect(file(r.json.run, "review-prompt.md")).toContain("Run every command in the foreground and wait for it: nothing wakes you after your turn ends.");
    await aleph(["drop", "rbg"]);
  }, 30_000);
});
