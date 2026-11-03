// Archived goal tests from jobs/lib/firefighter.ask.test.ts: `bun run accept` runs them, `bun run test` does not.
// The firefighter's answer to an Ask: a product choice goes to Chris unless he handed its reason; a how-to-build question it decides.
import { expect, test } from "bun:test";
import { firefighterStep } from "../../../jobs/lib/factory.ts";
import { applyActions, prompt, snapshot } from "../../../jobs/lib/firefighter.ts";
import { alwaysFile, asked, choice, FIREFIGHTER, fresh, item, key, plain, ports, reply, useFirefighterFixture } from "../../../jobs/lib/firefighter.fixture.ts";

useFirefighterFixture();

test("answer is refused on a product choice and applied on a how-to-build one", async () => {
  fresh([
    { title: "product", ask: choice() },
    { title: "build", ask: plain() },
  ]);
  reply([{ do: "answer", repo: key, n: 1, note: "page A" }, { do: "answer", repo: key, n: 2, note: "put it in x.ts" }]);
  const f = await firefighterStep(ports());
  expect(f?.refused).toEqual([expect.stringContaining("product choice")]);
  expect(asked(1)).not.toBeNull();
  expect(asked(2)).toBeNull();
});

test("a question handed to the firefighter: its product choice is cleared, its event is marked handed and named in the prompt", async () => {
  fresh([{ title: "product", ask: choice() }]);
  alwaysFile({ question: FIREFIGHTER });
  const e = snapshot().find((x) => x.kind === "ask");
  expect(e).toMatchObject({ handed: true, reason: "question" });
  expect(e?.line.endsWith("(handed to you by Chris)")).toBe(true);
  expect(prompt([e!])).toContain("Chris has handed these reasons to you: question.");
  expect(prompt([e!])).toContain("Decide every event marked handed yourself");
  reply([{ do: "answer", repo: key, n: 1, note: "page A" }]);
  const f = await firefighterStep(ports());
  expect(f?.refused).toEqual([]);
  expect(f?.applied).toEqual([`answer ${key}-1: page A`]);
  expect(asked(1)).toBeNull();
});

test("the same triage question with no standing for its reason is refused", async () => {
  fresh([{ title: "product", ask: choice("acceptance-failed") }]);
  reply([{ do: "answer", repo: key, n: 1, note: "page A" }]);
  const f = await firefighterStep(ports());
  expect(f?.refused).toEqual([expect.stringContaining("product choice")]);
  expect(asked(1)).not.toBeNull();
});

test("a question Ask with options is refused as a product choice when only another reason is handed", async () => {
  fresh([{ title: "product", ask: choice("question") }]);
  alwaysFile({ "acceptance-failed": { action: "firefighter", at: "2026-10-28T00:00:00.000Z" } });
  reply([{ do: "answer", repo: key, n: 1, note: "page A" }]);
  const f = await firefighterStep(ports());
  expect(f?.refused).toEqual([expect.stringContaining("product choice")]);
  expect(asked(1)).not.toBeNull();
});

test("without a handed reason a product choice is still refused, and the prompt has no handed rule", () => {
  fresh([{ title: "product", ask: choice() }]);
  const e = snapshot().find((x) => x.kind === "ask");
  expect(e?.handed).toBeUndefined();
  expect(e?.line.endsWith("(handed to you by Chris)")).toBe(false);
  expect(prompt([e!])).not.toContain("Chris has handed these reasons");
});

test("an Ask of reason question is an event, and answer clears it", async () => {
  fresh([{ title: "q", ask: plain("which helper?") }]);
  const e = snapshot().find((x) => x.kind === "ask");
  expect(e).toMatchObject({ repo: key, item: 1, reason: "question" });
  expect(e?.handed).toBeUndefined();
  reply([{ do: "answer", repo: key, n: 1, note: "use helper A" }]);
  const f = await firefighterStep(ports());
  expect(f?.refused).toEqual([]);
  expect(f?.applied).toEqual([`answer ${key}-1: use helper A`]);
  expect(asked(1)).toBeNull();
  expect(item(1).notes.at(-1)).toContain("firefighter decided: use helper A");
});

test("answer is refused on an issue with no Ask", async () => {
  fresh([{ title: "q" }]);
  const r = await applyActions([{ do: "answer", repo: key, n: 1, note: "x" }], ports());
  expect(r.refused).toEqual([expect.stringContaining("no Ask")]);
});

test("answer is applied on a plain question even when its reason is not handed", async () => {
  fresh([{ title: "build", ask: { ...plain(), reason: "no-commit" } }, { title: "none", ask: plain() }]);
  reply([{ do: "answer", repo: key, n: 1, note: "x.ts" }, { do: "answer", repo: key, n: 2, note: "y.ts" }]);
  const f = await firefighterStep(ports());
  expect(f?.refused).toEqual([]);
  for (const id of [1, 2]) expect(asked(id)).toBeNull();
});
