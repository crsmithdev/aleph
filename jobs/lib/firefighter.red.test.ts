// The firefighter and a red main: the red event, and the add that files its fix.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as issues from "../../todo/lib/todo.ts";
import * as store from "../../todo/lib/store.ts";
import { readList, writeList } from "../../todo/lib/store.ts";
import { layout } from "./layout.ts";
import { applyActions, firefight } from "./firefighter.ts";
import { calls, fresh, key, ports, reply, useFirefighterFixture } from "./firefighter.fixture.ts";

useFirefighterFixture();

const SPEC = "## Goal\nThe test passes.\n\n## Edit surface\n- ui/browser.test.ts: the row.\n\n## Oracle\n- bun test passes.";

const redCi = () => {
  mkdirSync(layout().factory, { recursive: true });
  writeFileSync(join(layout().factory, "ci.json"), JSON.stringify({ [key]: { repo: key, ok: false, sha: "77803ea", url: "u", since: "2026-11-02T17:15:00Z", sinceSha: "77803ea4c", runs: 1 } }));
};

test("an add for a red repo files the body as the spec", async () => {
  fresh([{ title: "other" }]);
  redCi();
  const f = await applyActions([{ do: "add", repo: key, title: "Fix red", body: SPEC }], ports());
  expect(f.applied.length).toBe(1);
  const it = readList({ key })!.items.find((i) => i.title === "Fix red")!;
  expect(it.fm.priority).toBe("high");
  expect(it.spec).toBe(SPEC);
});

test("a saved red CI gives one red event; while a red-main issue is open it gives none; a new head after it is done gives one, and the same head then none", async () => {
  fresh([{ title: "other" }]);
  redCi();
  reply([]);
  const calls0 = calls();
  expect((await firefight(ports())).events.length).toBe(1);
  expect(calls()).toBe(calls0 + 1);
  expect((await firefight(ports())).events).toEqual([]);
  writeList({ key }, "todo: red main", (doc) => {
    issues.add(doc, "Fix red", { priority: "high", labels: ["red-main"], spec: SPEC });
    return true;
  }, true);
  expect((await firefight(ports())).events).toEqual([]);
  expect(calls()).toBe(calls0 + 1);
  const fix = readList({ key })!.items.find((i) => i.title === "Fix red")!;
  expect(store.note({ key }, fix.id, "fixed", { done: true })).toBeNull();
  // The same head, with the fix done: the red head is seen again once the fix closes.
  expect((await firefight(ports())).events.length).toBe(1);
  expect((await firefight(ports())).events).toEqual([]);
  // A newer head is a new event; with no further change to it, none.
  mkdirSync(layout().factory, { recursive: true });
  writeFileSync(join(layout().factory, "ci.json"), JSON.stringify({ [key]: { repo: key, ok: false, sha: "9f8e7d6c", url: "u", since: "2026-11-02T17:15:00Z", sinceSha: "77803ea4c", runs: 2 } }));
  expect((await firefight(ports())).events.length).toBe(1);
  expect((await firefight(ports())).events).toEqual([]);
});
