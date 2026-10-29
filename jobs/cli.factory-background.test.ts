import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { aleph, file, specFile, setup, state, teardown, fakeLog } from "./cli.helpers";
import { readFileSync } from "node:fs";
import { join } from "node:path";

beforeAll(setup);
afterAll(teardown);

describe("a factory worker runs in the foreground", () => {
  test("the worker's environment turns background tasks off, and the prompt says to wait", async () => {
    const r = await aleph(["job", "fac", "fbg", "--spec", specFile("Goal: fbg\nACTION: commit bg.txt\n")]);
    expect(state(r.json.run).state).not.toBe("stuck");
    const seen = readFileSync(join(fakeLog, "env"), "utf8").split("\n");
    expect(seen).toContain("CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1");
    expect(file(r.json.run, "prompt.md")).toContain("Run every command in the foreground and wait for it: nothing wakes you after your turn ends.");
    await aleph(["drop", "fbg"]);
  }, 30_000);
});
