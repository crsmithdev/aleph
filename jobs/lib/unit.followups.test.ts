import { expect, test } from "bun:test";
import { sameTopic } from "./unit.ts";

test("the same follow-up in other words is the same topic", () => {
  const pairs = [
    ["ui/api/issues.ts derives goals and the label filter from labels; move to kindOf so the UI tests can seed kind: goal", "ui/api/issues.ts derived() and the label filter read the goal label; switch them to kindOf"],
    ["ui/fixtures/review/build.ts still imports addLegacy; convert it before addLegacy is deleted", "ui/fixtures/review/build.ts:10 still imports addLegacy; convert it before addLegacy is deleted"],
    ["ui/fixtures/review/build.ts still imports addLegacy; convert it before addLegacy is deleted", "ui/fixtures/review/build.ts still imports addLegacy"],
    ["Decide whether `aleph issue --waiting-on` should return (spec aleph-840 assumes it exists) or drop aleph-840 in favour of `--after`", "Decide whether `aleph issue --waiting-on` should return, or drop aleph-840 in favour of `--after`"],
  ];
  for (const [a, b] of pairs) expect(sameTopic(a, b)).toBe(true);
});

test("different work in one busy file is not the same topic", () => {
  expect(sameTopic("jobs/lib/factory.ts `record(text, { unlabel: \"goal\" })` is a no-op on a kind goal", "jobs/lib/factory.ts retries a fetch that loses the ref lock")).toBe(false);
  expect(sameTopic("paint the fence", "mend the gate")).toBe(false);
  expect(sameTopic("...", "...")).toBe(false);
});
