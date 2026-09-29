import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "..", "jobs", "cli.ts");
let base: string, repo: string, file: string;

function env(): Record<string, string> {
  return { ...(process.env as Record<string, string>), ALEPH_REPOS: join(base, "repos.json") };
}

function aleph(...args: string[]): { code: number; out: string; err: string } {
  const p = Bun.spawnSync(["bun", CLI, ...args], { env: env(), stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
}

const doc = () => readFileSync(file, "utf8");

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-todo-"));
  repo = join(base, "proj");
  mkdirSync(join(repo, "docs"), { recursive: true });
  file = join(repo, "docs", "todo.md");
  writeFileSync(join(base, "repos.json"), JSON.stringify({ proj: { path: repo } }));
  writeFileSync(file, "# To do\n\nChris's list.\n\n## 3. An old prose item\n\nWritten before the command existed.\n\nDone when it is done.\n");
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

test("add allocates the next id and list shows it", () => {
  const a = aleph("todo", "add", "proj", "Teach the gate to count");
  expect(a.code).toBe(0);
  expect(JSON.parse(a.out).added).toBe(4);
  const l = aleph("todo", "list", "proj", "--json");
  const rows = JSON.parse(l.out);
  expect(rows.map((r: any) => r.id)).toEqual([3, 4]);
  expect(rows[1]).toMatchObject({ status: "open", priority: "medium", labels: [] });
});

test("a legacy item keeps every word and reads as open", () => {
  aleph("todo", "add", "proj", "New one");
  expect(doc()).toContain("Written before the command existed.");
  expect(doc()).toContain("Done when it is done.");
  const rows = JSON.parse(aleph("todo", "list", "proj", "--json").out);
  expect(rows[0]).toMatchObject({ id: 3, status: "open", legacy: true });
});

test("notes append and never rewrite an existing line", () => {
  aleph("todo", "add", "proj", "Item four");
  aleph("todo", "note", "proj", "4", "first finding");
  const after = aleph("todo", "note", "proj", "4", "second finding");
  expect(after.code).toBe(0);
  const shown = JSON.parse(aleph("todo", "show", "proj", "4", "--json").out);
  expect(shown.notes).toHaveLength(2);
  expect(shown.notes[0]).toContain("first finding");
  expect(shown.notes[1]).toContain("second finding");
  expect(doc().match(/### Notes/g)).toHaveLength(1);
});

test("done and drop set a field, never move or renumber the item", () => {
  aleph("todo", "add", "proj", "Ships");
  aleph("todo", "add", "proj", "Abandoned");
  expect(aleph("todo", "done", "proj", "4", "landed in abc123").code).toBe(0);
  expect(aleph("todo", "drop", "proj", "5", "superseded by 4").code).toBe(0);
  const rows = JSON.parse(aleph("todo", "list", "proj", "--json").out);
  expect(rows.map((r: any) => [r.id, r.status])).toEqual([[3, "open"], [4, "done"], [5, "dropped"]]);
  expect(JSON.parse(aleph("todo", "list", "proj", "--status", "done", "--json").out).map((r: any) => r.id)).toEqual([4]);
  expect(doc().indexOf("## 4.")).toBeLessThan(doc().indexOf("## 5."));
  expect(JSON.parse(aleph("todo", "show", "proj", "4", "--json").out).notes[0]).toContain("landed in abc123");
});

test("drop refuses without a reason", () => {
  aleph("todo", "add", "proj", "Item four");
  const r = aleph("todo", "drop", "proj", "4");
  expect(r.code).toBe(1);
  expect(r.err).toContain("say why");
});

test("labels filter", () => {
  aleph("todo", "add", "proj", "Audio thing", "--labels", "audio,phone");
  aleph("todo", "add", "proj", "Other thing", "--labels", "build");
  expect(JSON.parse(aleph("todo", "list", "proj", "--label", "audio", "--json").out).map((r: any) => r.id)).toEqual([4]);
});

test("lint blocks on bad frontmatter and --fix repairs what it can", () => {
  writeFileSync(file, `# To do\n\n## 7. Broken\n---\nid: 9\nstatus: open\ncreated: 2026-09-01\n---\n\nBody.\n`);
  const bad = aleph("todo", "lint", "proj");
  expect(bad.code).toBe(1);
  expect(bad.err).toContain("updated is missing");
  expect(bad.err).toContain("id says 9 but the heading says 7");
  const fixed = aleph("todo", "lint", "proj", "--fix");
  expect(fixed.code).toBe(0);
  expect(JSON.parse(fixed.out).fixed.length).toBeGreaterThan(0);
  expect(aleph("todo", "lint", "proj").code).toBe(0);
});

test("lint refuses an unknown status and a duplicate id, and --fix cannot save it", () => {
  writeFileSync(file, `# To do\n\n## 8. One\n---\nid: 8\nstatus: maybe\ncreated: 2026-09-01\nupdated: 2026-09-01\n---\n\nA.\n\n## 8. Two\n---\nid: 8\nstatus: open\ncreated: 2026-09-01\nupdated: 2026-09-01\n---\n\nB.\n`);
  const r = aleph("todo", "lint", "proj");
  expect(r.code).toBe(1);
  expect(r.err).toContain('status "maybe" is not one of');
  expect(r.err).toContain("2 items share id 8");
  expect(aleph("todo", "lint", "proj", "--fix").code).toBe(1);
});

test("an unknown repo and an unknown item both refuse", () => {
  expect(aleph("todo", "list", "nope").err).toContain("no repo named nope");
  expect(aleph("todo", "show", "proj", "99").err).toContain("has no item 99");
});
