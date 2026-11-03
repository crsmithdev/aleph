// Acceptance reruns a failure pinned to a file: the pin stays only when the file holds the test name.
import { expect, test } from "bun:test";
import { acceptanceStep } from "./factory.ts";
import { answers, doneGoal, flakeNotes, landFile, ran, useAcceptanceFixture } from "./acceptance.fixture.ts";

useAcceptanceFixture();

const pinTest = async (output: string, setup?: () => void) => {
  const id = doneGoal("`bun run test`");
  setup?.();
  landFile(id, "c.ts");
  await acceptanceStep(answers({ code: 1, output }, { code: 0, output: " 1 pass\n" }));
  return id;
};

test("a failure pinned to a file that lacks the test name reruns the Oracle's command and loses the pin", async () => {
  await pinTest("jobs/lib/acceptance.test.ts:\n(fail) two\n 1 fail\n");
  expect(ran[1]).toBe("bun run test");
  expect(flakeNotes()).toContain("(no file) > two");
  expect(flakeNotes()).not.toContain("jobs/lib/acceptance.test.ts");
});
