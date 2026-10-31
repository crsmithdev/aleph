import { expect, test } from "bun:test";
import * as todos from "../../todo/lib/todo.ts";
import * as store from "../../todo/lib/store.ts";
import { askNote, clearAsk, normalizeAsk, readAsk, writeAsk, type Ask } from "./ask.ts";

const item = (fm: Record<string, unknown> = {}): todos.Item => ({ id: 1, title: "t", fm: fm as any, body: "", notes: [], legacy: false });
const ask: Ask = { kind: "approval", reason: "held-path", question: "A or B?", options: [{ label: "A", line: "do a", after: "fac-2.1" }, { label: "B", line: "do b" }], recommended: "B", why: ["w"] };

test("writeAsk writes the flat fields and store.askOf reads them back", () => {
  const i = item();
  writeAsk(i, ask);
  expect(i.fm).toMatchObject({ ask: "approval", reason: "held-path", question: "A or B?", options: ["A :: do a :: after fac-2.1", "B :: do b"], recommended: "B", why: ["w"] });
  expect(readAsk(i)).toEqual(ask);
  expect(store.askOf(i)).toEqual(ask);
});

test("an option's waiting_on suffix, from an old or migrated item, reads as after", () => {
  const i = item({ ask: "input", reason: "question", question: "Q?", options: ["A :: a :: waiting_on fac-3", "B :: b"], why: [] });
  expect(readAsk(i)?.options[0]).toEqual({ label: "A", line: "a", after: "fac-3" });
  expect(store.askOf(i)?.options[0].after).toBe("fac-3");
});

test("setAsk and clearAsk write and remove every ask field and keep the rest", () => {
  const i = item({ kind: "issue", priority: "low" });
  store.setAsk(i, ask);
  expect(store.askOf(i)).toEqual(ask);
  store.clearAsk(i);
  for (const k of ["ask", "reason", "question", "options", "recommended", "why"]) expect(k in i.fm).toBe(false);
  expect(i.fm).toEqual({ kind: "issue", priority: "low" });
  expect(store.askOf(i)).toBeNull();
  clearAsk(i);
});

test("store.clearAsk also takes the old needs-chris label off", () => {
  const i = item({ labels: ["needs-chris", "ui"] });
  expect(store.askOf(i)).not.toBeNull();
  store.clearAsk(i);
  expect(store.askOf(i)).toBeNull();
  expect(i.fm.labels).toEqual(["ui"]);
});

test("normalizeAsk takes after or waiting_on, 2 to 4 options and a recommended label that is one of them", () => {
  const raw = { question: "Q?", options: [{ label: "A", line: "a", waiting_on: "fac-4" }, { label: "B", line: "b", after: "fac-5.1" }], recommended: "A", why: ["w"] };
  expect(normalizeAsk(raw)).toEqual({ kind: "input", reason: "question", question: "Q?", options: [{ label: "A", line: "a", after: "fac-4" }, { label: "B", line: "b", after: "fac-5.1" }], recommended: "A", why: ["w"] });
  expect(normalizeAsk({ ...raw, recommended: "C" })).toBeNull();
  expect(normalizeAsk({ ...raw, options: raw.options.slice(0, 1) })).toBeNull();
  expect(normalizeAsk({ ...raw, question: " " })).toBeNull();
  expect(normalizeAsk(raw, { kind: "approval", reason: "review" })).toMatchObject({ kind: "approval", reason: "review" });
});

test("askNote reads as a sentence", () => {
  expect(askNote(ask)).toBe("A or B? Options: A: do a (waits on fac-2.1); B: do b. My recommendation is B. Why: w.");
});
