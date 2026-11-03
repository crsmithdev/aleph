// The firefighter's answer to an Ask: a product choice goes to Chris unless he handed its reason; a how-to-build question it decides.
import { expect, test } from "bun:test";
import { firefighterStep } from "./factory.ts";
import { alwaysFile, asked, choice, fresh, key, ports, reply, useFirefighterFixture } from "./firefighter.fixture.ts";

useFirefighterFixture();

test("a triage question on a mark whose reason Chris handed is cleared; without the handed reason it is refused", async () => {
  fresh([{ title: "product", ask: choice("acceptance-failed") }]);
  alwaysFile({ "acceptance-failed": { action: "firefighter", at: "2026-10-28T00:00:00.000Z" } });
  reply([{ do: "answer", repo: key, n: 1, note: "page A" }]);
  const f = await firefighterStep(ports());
  expect(f?.refused).toEqual([]);
  expect(f?.applied).toEqual([`answer ${key}-1: page A`]);
  expect(asked(1)).toBeNull();
});
