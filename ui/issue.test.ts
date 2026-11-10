import { expect, test } from "bun:test";
import { card, row, stageOf } from "./issue.ts";
import type { Ask } from "../jobs/lib/asks/ask.ts";
import type { Issue } from "../issues/lib/todo.ts";

const item = (fm: Record<string, unknown> = {}, sub?: number): Issue => ({ id: 7, sub, title: "Fix it", fm: { priority: "high", created_time: "2026-11-01T10:00:00Z", ...fm }, request: "", spec: "", notes: ["- what now?"] } as any);

test("the stage is the one the jobs give, else the status, and parked wins", () => {
  expect(stageOf(item(), { stage: "working" })).toBe("working");
  expect(stageOf(item())).toBe("open");
  expect(stageOf(item({ closed_as: "done" }))).toBe("done");
  expect(stageOf(item({ parked: "true" }), { stage: "queued" })).toBe("parked");
});

test("a row carries its link, its stage and why; a parked row has no why", () => {
  const r = row("alpha-ui", item({}, 2), { stage: "held", why: "after alpha-ui-3" });
  expect(r).toMatchObject({ ref: "7.2", href: "#/issues/alpha-ui/7.2", stage: "held", why: "after alpha-ui-3", status: "open" });
  expect(row("alpha", item({ parked: "true" }), { stage: "queued", why: "x" })).toMatchObject({ stage: "parked", why: "" });
});

test("a card that waits on an Ask carries the Ask, its reason and the question", () => {
  const ask = { kind: "input", reason: "question", question: "", options: [] } as unknown as Ask;
  expect(card("alpha", item(), "waiting")).toMatchObject({ id: "alpha-7", href: "#/issues/alpha/7", priority: "high", stage: "waiting" });
  expect(card("alpha", item(), "waiting", ask)).toMatchObject({ ask, reason: "question", askKind: "input", question: "what now?" });
});

test("a card's question from the last note leaves out the note's stamp", () => {
  const ask = { kind: "input", reason: "intake-failed", question: "", options: [] } as unknown as Ask;
  const it = { ...item(), notes: ["- 2026-10-27T12:34:00.000Z: Intake failed: no verdict in 2 runs"] } as Issue;
  expect(card("alpha", it, "waiting", ask).question).toBe("Intake failed: no verdict in 2 runs");
});
