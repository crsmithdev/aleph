import { afterEach, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { add, anchor, drop, mark, markdown, put, read, reply } from "./annotations.ts";
import { Refusal } from "./refusal.ts";

const file = () => process.env.ALEPH_ANNOTATIONS!;
afterEach(() => rmSync(file(), { force: true }));
const page = { id: "p1", url: "http://aleph.home/#/", selector: "h1", text: "Status", html: "<h1>Status</h1>", note: "rename this" };

test("a page's note saves in place and reads back as v 2, open, by you", () => {
  put(page);
  put({ ...page, note: "rename this now" });
  expect(read().map((n) => [n.id, n.note, n.v, n.status, n.by, n.replies.length])).toEqual([["p1", "rename this now", 2, "open", "you", 0]]);
});

test("a v 1 note in the file reads as open, by you, with no replies", () => {
  writeFileSync(file(), JSON.stringify([{ v: 1, id: "o1", url: "u", selector: "p", text: "", html: "", note: "old", at: "2026-11-10T00:00:00Z" }]));
  expect(read()[0]).toMatchObject({ v: 2, status: "open", by: "you", replies: [] });
});

test("an agent adds a note on an anchor for every page, replies to a note, resolves it and drops it", () => {
  const n = add(anchor("a1714"), "check this row");
  expect(n).toMatchObject({ selector: '[data-annotate="a1714"]', url: "", by: "agent", status: "open" });
  put(page);
  expect(reply("p1", "done").replies.map((r) => [r.by, r.text])).toEqual([["agent", "done"]]);
  expect(mark("p1", "resolved").status).toBe("resolved");
  expect(drop(n.id)).toEqual({ dropped: n.id });
  expect(read().map((x) => x.id)).toEqual(["p1"]);
});

test("a note without a selector or text, or an unknown id, is refused", () => {
  expect(() => put({ ...page, selector: "" })).toThrow(Refusal);
  expect(() => put({ ...page, note: "  " })).toThrow(Refusal);
  expect(() => reply("nope", "x")).toThrow("no annotation nope");
  expect(() => drop("nope")).toThrow(Refusal);
});

test("the Markdown groups notes by page and shows who wrote them, the replies and the state", () => {
  put(page);
  reply("p1", "on it");
  mark("p1", "resolved");
  add(".mark", "a note for every page");
  expect(markdown(read())).toBe([
    "Annotations on http://aleph.home/#/:", "",
    "1. rename this (resolved)", "   - id: p1", "   - element: `h1`", '   - text: "Status"', "   - html: `<h1>Status</h1>`", "   - reply from agent: on it",
    "", "Annotations on any page with the element:", "",
    `1. a note for every page (by the agent)`, `   - id: ${read()[1].id}`, "   - element: `.mark`",
  ].join("\n"));
});

test("aleph annotation lists open notes as Markdown and refuses a bad put", () => {
  const cli = (args: string[], stdin?: string) => Bun.spawnSync([process.execPath, join(import.meta.dir, "..", "jobs", "cli.ts"), "annotation", ...args], { env: process.env, stdin: stdin === undefined ? "ignore" : new Blob([stdin]), stdout: "pipe", stderr: "pipe" });
  expect(cli(["put"], JSON.stringify(page)).exitCode).toBe(0);
  expect(cli(["add", "--on", "a1", "--", "look"]).exitCode).toBe(0);
  expect(cli(["resolve", "p1"]).exitCode).toBe(0);
  const listed = cli(["list"]).stdout.toString();
  expect(listed).toContain("1. look (by the agent)");
  expect(listed).not.toContain("rename this");
  const bad = cli(["put"], "not json");
  expect([bad.exitCode, bad.stderr.toString().trim()]).toEqual([1, "put reads one annotation as JSON on stdin"]);
});
