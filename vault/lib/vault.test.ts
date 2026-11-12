import { afterAll, beforeAll, expect, setSystemTime, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendRecallLog, lintVault, loadVault, loadWiki, readRun, screenCandidates, wikiNotes } from "./vault.ts";

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
