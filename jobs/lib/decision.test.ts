import { expect, test } from "bun:test";
import type * as todos from "../../todo/lib/todo.ts";
import { clearDecision, normalizeDecision, readDecision, writeDecision, type Decision } from "./decision.ts";

const item = (fm: Record<string, unknown> = {}): todos.Issue => ({ id: 1, title: "t", fm: fm as any, body: "", notes: [], legacy: false });
const base = { question: "A or B?", options: [{ label: "A", line: "do a" }, { label: "B", line: "do b" }], recommended: "B", why: ["w"] };

test("writeDecision then readDecision keeps the kind", () => {
  for (const kind of ["build", "product"] as const) {
    const i = item();
    const d: Decision = { ...base, kind };
    writeDecision(i, d);
    expect(readDecision(i)).toEqual(d);
  }
});

test("a stored decision without a kind reads as product", () => {
  expect(readDecision(item({ question: "Q?", options: ["A :: a", "B :: b"], recommended: "A" }))?.kind).toBe("product");
  expect(readDecision(item({ question: "Q?", options: ["A :: a"], recommended: "A", kind: "other" }))?.kind).toBe("product");
});

test("clearDecision removes kind", () => {
  const i = item();
  writeDecision(i, { ...base, kind: "build" });
  clearDecision(i);
  expect("kind" in i.fm).toBe(false);
});

test("normalizeDecision keeps build only when exact", () => {
  expect(normalizeDecision({ ...base, kind: "build" })?.kind).toBe("build");
  for (const kind of [undefined, "product", "Build", "other", 1]) expect(normalizeDecision({ ...base, kind })?.kind).toBe("product");
});
