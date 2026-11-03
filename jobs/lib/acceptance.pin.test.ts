// Acceptance reruns a failure pinned to a file: the pin stays only when the file holds the test name.
import { expect, test } from "bun:test";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { acceptanceStep } from "./factory.ts";
import { answers, doneGoal, flakeNotes, landFile, ran, repoDir, sh, useAcceptanceFixture } from "./acceptance.fixture.ts";

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

test("a failure pinned to the file that holds the test name reruns only that test", async () => {
  await pinTest("jobs/lib/acceptance.test.ts:\n(fail) one\n 1 fail\n");
  expect(ran[1]).toStartWith("bun test --timeout=30000 ./jobs/lib/acceptance.test.ts");
  expect(ran[1]).toContain(" -t ");
});

test("an (unnamed) failure keeps its file and reruns the whole file", async () => {
  await pinTest("jobs/lib/acceptance.test.ts:\n(fail) (unnamed)\n 1 fail\n");
  expect(ran[1]).toStartWith("bun test --timeout=30000 ./jobs/lib/acceptance.test.ts");
  expect(ran[1]).not.toContain(" -t ");
});

test("a generated test name that is not literal in the file is cleared like a wrong pin", async () => {
  await pinTest("jobs/lib/acceptance.test.ts:\n(fail) case 3\n 1 fail\n", () => {
    appendFileSync(join(repoDir(), "jobs/lib/acceptance.test.ts"), "for (const i of [1]) test(`case ${i}`, () => {});\n");
    sh(repoDir(), "git", "commit", "-qam", "gen");
    sh(repoDir(), "git", "push", "-q", "origin", "main");
  });
  expect(ran[1]).toBe("bun run test");
  expect(flakeNotes()).toContain("(no file) > case 3");
});
