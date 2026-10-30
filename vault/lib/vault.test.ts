import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lintVault, links, loadStats, loadVault, loadWiki, readNote, screenCandidates, walk, wikiNotes } from "./vault.ts";

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

test("loadVault returns the notes a plain read of each file gives", async () => {
  const notes = await loadVault(root);
  expect(notes.length).toBe(N);
  for (const n of notes) {
    const fresh = readNote(n.path, root);
    expect(n.title).toBe(fresh.title);
    expect(n.fm).toEqual(fresh.fm);
    expect(links(n.body)).toEqual(links(fresh.body));
    expect(n).toEqual(fresh);
  }
  expect(notes.find((n) => n.title === "Note 5")!.fm.aliases).toEqual(["a5", "b5"]);
});

test("loadWiki returns the wiki notes loadVault gives", async () => {
  writeFileSync(join(root, "Outside.md"), "not wiki");
  const byPath = (a: { path: string }, b: { path: string }) => a.path.localeCompare(b.path);
  expect((await loadWiki(root)).sort(byPath)).toEqual(wikiNotes(await loadVault(root)).sort(byPath));
  rmSync(join(root, "Outside.md"));
});

test("a second call with no file changed reads no file", async () => {
  await loadVault(root);
  const before = loadStats.reads;
  expect((await loadVault(root)).length).toBe(N);
  expect(loadStats.reads).toBe(before);
});

test("a changed, added or removed file is seen", async () => {
  await loadVault(root);
  const before = loadStats.reads;
  writeFileSync(file(3), text(3, "edited"));
  utimesSync(file(3), new Date(), new Date(Date.now() + 5000));
  writeFileSync(file(N), text(N));
  let notes = await loadVault(root);
  expect(loadStats.reads).toBe(before + 2);
  expect(notes.length).toBe(N + 1);
  expect(notes.find((n) => n.title === "Note 3")!.body).toContain("edited");
  rmSync(file(N));
  notes = await loadVault(root);
  expect(notes.length).toBe(N);
  expect(loadStats.reads).toBe(before + 2);
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

test("loadVault returns a Promise of the notes in walk order", async () => {
  const p = loadVault(root);
  expect(p).toBeInstanceOf(Promise);
  expect((await p).map((n) => n.path)).toEqual(walk(root));
});
