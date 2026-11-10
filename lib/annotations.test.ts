import { afterAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as a from "./annotations.ts";

const dir = mkdtempSync(join(tmpdir(), "annotations-"));
beforeEach(() => { process.env.ALEPH_ANNOTATIONS = join(dir, `${Math.random()}.json`); });
afterAll(() => { delete process.env.ALEPH_ANNOTATIONS; rmSync(dir, { recursive: true }); });

test("add, reply, resolve and drop leave the expected notes", () => {
  const one = a.add("user", { url: "http://x/", note: "wrong colour", selector: "h1" });
  const two = a.add("agent", { url: "http://x/", note: "second" });
  expect(a.load().map((n) => [n.note, n.status, n.by, n.replies])).toEqual([["wrong colour", "open", "user", []], ["second", "open", "agent", []]]);
  expect(Object.keys(a.load()[1]).sort()).toEqual(["at", "by", "html", "id", "note", "replies", "selector", "status", "text", "url"]);
  expect(two.at).toBe(new Date(two.at).toISOString());

  a.reply(one.id, "agent", "fixed");
  a.resolve(one.id);
  const [first] = a.load();
  expect(first.status).toBe("resolved");
  expect(first.selector).toBe("h1");
  expect(first.replies.map((r) => [r.by, r.note])).toEqual([["agent", "fixed"]]);
  expect(first.replies[0].at).toBe(new Date(first.replies[0].at).toISOString());

  a.drop(one.id);
  expect(a.load().map((n) => n.id)).toEqual([two.id]);
  expect(() => a.resolve("nope")).toThrow("no note nope");
});

test("a v1 note loads as open with no replies", () => {
  writeFileSync(process.env.ALEPH_ANNOTATIONS!, JSON.stringify([{ v: 1, id: "k1", url: "http://x/", selector: "p", text: "t", html: "<p>", note: "n", at: "2026-11-10T00:00:00.000Z" }]));
  const [n] = a.load();
  expect(n.status).toBe("open");
  expect(n.replies).toEqual([]);
  expect(n.note).toBe("n");
});
