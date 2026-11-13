import { afterAll, beforeAll, expect, setSystemTime, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendRecallLog, lintVault, loadVault, loadWiki, readRun, screenCandidates, wikiNotes, type Note } from "./vault.ts";

let root: string;
const N = 300;
const file = (i: number) => join(root, "wiki", "concepts", `Note ${i}.md`);
const text = (i: number, extra = "") => `---\nkind: concept\nscope: global\naliases: [a${i}, b${i}]\nupdated: 2026-10-01\n---\n# Note ${i}\n\n**Claim.** as of 2026-10-01 [[Note ${(i + 1) % N}]] ${extra}\n`;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "vault-fixture-"));
  mkdirSync(join(root, "wiki", "concepts"), { recursive: true });
  mkdirSync(join(root, ".obsidian"));
  writeFileSync(join(root, ".obsidian", "x.md"), "hidden");
  for (let i = 0; i < N; i++) writeFileSync(file(i), text(i));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

test("loadWiki returns the wiki notes loadVault gives", async () => {
  writeFileSync(join(root, "Outside.md"), "not wiki");
  const byPath = (a: { path: string }, b: { path: string }) => a.path.localeCompare(b.path);
  expect((await loadWiki(root)).sort(byPath)).toEqual(wikiNotes(await loadVault(root)).sort(byPath));
  rmSync(join(root, "Outside.md"));
});

test("consistent_with leaves a note out of screenCandidates and out of the overlap warning", async () => {
  const r = mkdtempSync(join(tmpdir(), "vault-cw-"));
  mkdirSync(join(r, "wiki", "concepts"), { recursive: true });
  const w = (t: string, extra: string) => writeFileSync(join(r, "wiki", "concepts", `${t}.md`), `---\nkind: concept\nscope: global\n${extra}updated: 2026-10-01\n---\n# ${t}\n\n**Claim.** as of 2026-10-01 x\n`);
  w("Pipeline Gate Rules", "");
  w("Pipeline Gate Draft", "");
  const get = () => loadVault(r);
  const draft = async () => (await get()).find((n) => n.title === "Pipeline Gate Draft")!;
  const other = async () => (await get()).find((n) => n.title === "Pipeline Gate Rules")!;
  expect(screenCandidates(await draft(), await get()).map((n) => n.title)).toContain("Pipeline Gate Rules");
  expect(lintVault(await get(), { overlap: true }).warn.some((f) => f.rule === "overlap")).toBe(true);
  w("Pipeline Gate Draft", "consistent_with: [Pipeline Gate Rules]\n");
  expect(screenCandidates(await draft(), await get()).map((n) => n.title)).not.toContain("Pipeline Gate Rules");
  expect((await other()).title).toBe("Pipeline Gate Rules");
  expect(lintVault(await get(), { overlap: true }).warn.some((f) => f.rule === "overlap")).toBe(false);
  rmSync(r, { recursive: true, force: true });
});

test("appendRecallLog records a recall trim run and drops a line older than 30 days", () => {
  setSystemTime(Date.parse("2026-11-04T12:00:00Z"));
  const r = mkdtempSync(join(tmpdir(), "vault-trim-"));
  const line = (date: string, title: string) => JSON.stringify({ date, title, query: "q", session: null, source: "cli" });
  writeFileSync(join(r, ".recall-log.jsonl"), [line("2026-09-25", "Old"), line("2026-11-02", "Kept")].join("\n") + "\n");
  expect(readRun(r, "recall trim")).toBeNull();
  appendRecallLog(r, ["New"], "q", null, "cli");
  const titles = readFileSync(join(r, ".recall-log.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l).title);
  expect(titles).toEqual(["Kept", "New"]);
  expect(readRun(r, "recall trim")).toEqual({ at: "2026-11-04T12:00:00.000Z", result: "ok" });
  rmSync(r, { recursive: true, force: true });
  setSystemTime();
});

test("lint skips a pair when a note lists the other in distinct, and orders the rest by Jaccard", async () => {
  const r = mkdtempSync(join(tmpdir(), "vault-dist-"));
  mkdirSync(join(r, "wiki", "concepts"), { recursive: true });
  const w = (t: string, extra = "") => writeFileSync(join(r, "wiki", "concepts", `${t}.md`), `---\nkind: concept\nscope: global\n${extra}updated: 2026-10-01\n---\n# ${t}\n\n**Claim.** as of 2026-10-01 x\n`);
  w("Pipeline Gate Rules"); w("Pipeline Gate Draft"); w("Pipeline Gate Extra Words Here");
  const pairs = async () => lintVault(await loadVault(r), { overlap: true }).warn.filter((f) => f.rule === "overlap").map((f) => [f.note, f.other].sort());
  // Jaccard: Rules/Draft 2 of 4 words, Rules/Extra 2 of 5, Draft/Extra 2 of 5, so the closer pair is first.
  expect(await pairs()).toEqual([["Pipeline Gate Draft", "Pipeline Gate Rules"], ["Pipeline Gate Draft", "Pipeline Gate Extra Words Here"].sort(), ["Pipeline Gate Rules", "Pipeline Gate Extra Words Here"].sort()]);
  w("Pipeline Gate Rules", "distinct: [Pipeline Gate Draft]\n");
  expect(await pairs()).toEqual([["Pipeline Gate Draft", "Pipeline Gate Extra Words Here"].sort(), ["Pipeline Gate Rules", "Pipeline Gate Extra Words Here"].sort()]);
  rmSync(r, { recursive: true, force: true });
});

test("overlap pairs tie on Jaccard and break the tie by title, whatever order the notes come in", async () => {
  const r = mkdtempSync(join(tmpdir(), "vault-tie-"));
  mkdirSync(join(r, "wiki", "concepts"), { recursive: true });
  const w = (t: string) => writeFileSync(join(r, "wiki", "concepts", `${t}.md`), `---\nkind: concept\nscope: global\nupdated: 2026-10-01\n---\n# ${t}\n\n**Claim.** as of 2026-10-01 x\n`);
  for (const t of ["Queue Order Draft", "Queue Order Extra", "Queue Order Gate", "Queue Order Shape"]) w(t);
  const pairs = (ns: Note[]) => lintVault(ns, { overlap: true }).warn.filter((f) => f.rule === "overlap").map((f) => [f.note, f.other]);
  // Every pair shares Queue and Order of four words, so all six tie and only the titles order them.
  const notes = await loadVault(r);
  expect(pairs(notes)).toEqual([
    ["Queue Order Draft", "Queue Order Extra"], ["Queue Order Draft", "Queue Order Gate"], ["Queue Order Draft", "Queue Order Shape"],
    ["Queue Order Extra", "Queue Order Gate"], ["Queue Order Extra", "Queue Order Shape"], ["Queue Order Gate", "Queue Order Shape"],
  ]);
  expect(pairs([...notes].reverse())).toEqual(pairs(notes));
  rmSync(r, { recursive: true, force: true });
});
