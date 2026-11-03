// Archived goal tests from hooks/lib/hashes.test.ts: `bun run accept` runs them, `bun run test` does not.
import { describe, expect, test } from "bun:test";
import { unbackedHashes } from "../../../hooks/lib/hashes.ts";

const shown = (...outputs: string[]) => outputs.join("\n");

describe("unbackedHashes", () => {
  test("a cited hash that no command or output this turn shows is unbacked", () => {
    expect(unbackedHashes("Candidate 1 landed as `2607fbb26`.", shown("ok"))).toEqual(["2607fbb26"]);
  });
  test("a hash that a git output shows is backed, also by its prefix", () => {
    const out = "2607fbb26a1c9d0e4f5a6b7c8d9e0f1a2b3c4d5e\n";
    expect(unbackedHashes("landed as 2607fbb26", out)).toEqual([]);
    expect(unbackedHashes("landed as 2607fbb26a1c9d0e4f5a6b7c8d9e0f1a2b3c4d5e", out)).toEqual([]);
  });
  test("a hash only in the final message does not back itself", () => {
    expect(unbackedHashes("landed as abc1234", "no tool calls")).toEqual(["abc1234"]);
  });
  test("ordinary words, numbers and dates are not hashes", () => {
    expect(unbackedHashes("defaced facade 20261102 1040 aleph-1040 deadbeef", "")).toEqual([]);
    expect(unbackedHashes("hex deadbee1 here", "")).toEqual(["deadbee1"]);
    expect(unbackedHashes("the 2026 run of 1234567 passed", "")).toEqual([]);
  });
  test("each unbacked hash is named once", () => {
    expect(unbackedHashes("abc1234 and abc1234 and def5678", "")).toEqual(["abc1234", "def5678"]);
  });
});
