import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "..", "jobs", "cli.ts");
let base: string, remote: string, repo: string, file: string;

const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
function sh(cwd: string, ...args: string[]): string {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
  return p.stdout.toString().trim();
}

function env(extra: Record<string, string> = {}): Record<string, string> {
  return { ...(process.env as Record<string, string>), ...gitEnv, ALEPH_REPOS: join(base, "repos.json"), ...extra };
}

function aleph(...args: string[]): { code: number; out: string; err: string } {
  return alephWith({}, ...args);
}
function alephWith(extra: Record<string, string>, ...args: string[]): { code: number; out: string; err: string } {
  return alephIn(extra, undefined, ...args);
}
function alephIn(extra: Record<string, string>, stdin: string | undefined, ...args: string[]): { code: number; out: string; err: string } {
  const p = Bun.spawnSync(["bun", CLI, ...args], { env: env(extra), stdin: stdin === undefined ? "ignore" : new Blob([stdin]), stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
}

/** The list as the main checkout has it, which follows origin/main. */
const doc = () => readFileSync(file, "utf8");
const remoteList = () => sh(base, "git", "--git-dir", remote, "show", "main:docs/todo.md");

/** Put `text` on origin/main as the list, the way a hand commit would. */
function seed(text: string | null): void {
  if (text === null) sh(repo, "git", "rm", "-q", "docs/todo.md");
  else { writeFileSync(file, text); sh(repo, "git", "add", "docs/todo.md"); }
  sh(repo, "git", "commit", "-qm", "seed");
  sh(repo, "git", "push", "-q", "origin", "main");
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-todo-"));
  remote = join(base, "remote.git");
  repo = join(base, "proj");
  sh(base, "git", "init", "-q", "--bare", "-b", "main", remote);
  sh(base, "git", "clone", "-q", remote, repo);
  mkdirSync(join(repo, "docs"), { recursive: true });
  file = join(repo, "docs", "todo.md");
  writeFileSync(join(base, "repos.json"), JSON.stringify({ proj: { path: repo } }));
  seed("# To do\n\nChris's list.\n\n## 3. An old prose item\n\nWritten before the command existed.\n\nDone when it is done.\n");
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

test("a write is one commit on origin/main, and the main checkout follows with no changes of its own", () => {
  const before = sh(repo, "git", "rev-parse", "HEAD");
  const a = aleph("todo", "add", "proj", "Teach the gate to count");
  expect(a.code).toBe(0);
  const head = sh(base, "git", "--git-dir", remote, "rev-parse", "main");
  expect(JSON.parse(a.out).commit).toBe(head);
  expect(sh(base, "git", "--git-dir", remote, "rev-parse", "main~1")).toBe(before);
  expect(sh(base, "git", "--git-dir", remote, "diff", "--name-only", "main~1", "main")).toBe("docs/todo.md");
  expect(remoteList()).toContain("## 4. Teach the gate to count");
  expect(sh(repo, "git", "rev-parse", "HEAD")).toBe(head);
  expect(sh(repo, "git", "status", "--porcelain")).toBe("");
});

test("a write from a clone that is behind lands on top of main and keeps main's change", () => {
  const other = join(base, "other");
  sh(base, "git", "clone", "-q", remote, other);
  writeFileSync(join(other, "code.txt"), "x\n");
  sh(other, "git", "add", "code.txt");
  sh(other, "git", "commit", "-qm", "code");
  sh(other, "git", "push", "-q", "origin", "main");
  expect(aleph("todo", "add", "proj", "After the code").code).toBe(0);
  expect(sh(base, "git", "--git-dir", remote, "log", "--format=%s", "-2", "main")).toBe("todo: add an item\ncode");
  expect(existsInCheckout("code.txt")).toBe(true);
});
const existsInCheckout = (f: string) => Bun.spawnSync(["test", "-f", join(repo, f)]).exitCode === 0;

test("a write with a dirty main checkout still reaches main, and says the checkout did not follow", () => {
  writeFileSync(join(repo, "docs", "todo.md"), "local edit\n");
  const a = aleph("todo", "add", "proj", "Despite the edit");
  expect(a.code).toBe(0);
  expect(remoteList()).toContain("Despite the edit");
  expect(a.err).toContain("main checkout not updated: it has changes in docs/todo.md");
  expect(doc()).toBe("local edit\n");
});

test("a worker's push block does not stop a to-do write", () => {
  const w = alephWith({ GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: `url.${join(base, "nowhere")}.pushInsteadOf`, GIT_CONFIG_VALUE_0: remote }, "todo", "note", "proj", "3", "from a worker");
  expect(w.code).toBe(0);
  expect(remoteList()).toContain("from a worker");
});

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

test("labels filter, and a flag value never lands in the title", () => {
  aleph("todo", "add", "proj", "Audio thing", "--labels", "audio,phone", "--priority", "high");
  aleph("todo", "add", "proj", "Other thing", "--labels", "build");
  const rows = JSON.parse(aleph("todo", "list", "proj", "--json").out);
  expect(rows.map((r: any) => r.title)).toEqual(["An old prose item", "Audio thing", "Other thing"]);
  expect(rows[1]).toMatchObject({ priority: "high", labels: ["audio", "phone"] });
  expect(JSON.parse(aleph("todo", "list", "proj", "--label", "audio", "--json").out).map((r: any) => r.id)).toEqual([4]);
});

test("lint blocks on bad frontmatter and --fix repairs what it can", () => {
  seed(`# To do\n\n## 7. Broken\n---\nid: 9\nstatus: open\ncreated: 2026-09-01\n---\n\nBody.\n`);
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
  seed(`# To do\n\n## 8. One\n---\nid: 8\nstatus: maybe\ncreated: 2026-09-01\nupdated: 2026-09-01\n---\n\nA.\n\n## 8. Two\n---\nid: 8\nstatus: open\ncreated: 2026-09-01\nupdated: 2026-09-01\n---\n\nB.\n`);
  const r = aleph("todo", "lint", "proj");
  expect(r.code).toBe(1);
  expect(r.err).toContain('status "maybe" is not one of');
  expect(r.err).toContain("2 items share id 8");
  expect(aleph("todo", "lint", "proj", "--fix").code).toBe(1);
});

test("add starts a list for a repo that has none; every other verb refuses", () => {
  seed(null);
  expect(aleph("todo", "list", "proj").code).toBe(1);
  expect(aleph("todo", "list", "proj").err).toContain("no ");
  const a = aleph("todo", "add", "proj", "The first thing");
  expect(a.code).toBe(0);
  expect(JSON.parse(a.out).added).toBe(1);
  expect(remoteList()).toContain("# To do");
  expect(JSON.parse(aleph("todo", "list", "proj", "--json").out)).toHaveLength(1);
  expect(aleph("todo", "lint", "proj").code).toBe(0);
});

test("an unknown repo and an unknown item both refuse", () => {
  expect(aleph("todo", "list", "nope").err).toContain("no repo named nope");
  expect(aleph("todo", "show", "proj", "99").err).toContain("has no item 99");
});

test("dates are local, not UTC", () => {
  // `bun test` pins TZ=UTC, so the stamp has to be read from a process that has
  // a real zone. At 18:06 in Los Angeles it is already tomorrow in UTC, and an
  // item filed that evening used to land on tomorrow's date.
  const lib = join(import.meta.dir, "lib", "todo.ts");
  const p = Bun.spawnSync(
    ["bun", "-e", `import {today,minute} from ${JSON.stringify(lib)};
       const e = new Date(2026, 8, 28, 18, 6);
       console.log(today(e), minute(e), today(), new Date().getDate());`],
    { env: { ...(process.env as Record<string, string>), TZ: "America/Los_Angeles" }, stdout: "pipe" },
  );
  const [day, date, time, now, dayOfMonth] = p.stdout.toString().trim().split(/[\s]+/);
  expect(`${day}`).toBe("2026-09-28");
  expect(`${date} ${time}`).toBe("2026-09-28 18:06");
  expect(now.endsWith(`-${dayOfMonth.padStart(2, "0")}`)).toBe(true);
});

test("a write keeps one blank line between the header and the body", () => {
  seed(`# To do\n\n## 5. Five\n---\nid: 5\nstatus: open\ncreated: 2026-09-01\nupdated: 2026-09-01\n---\n\nBody.\n\n## 6. Six\n---\nid: 6\nstatus: open\ncreated: 2026-09-01\nupdated: 2026-09-01\n---\n\nOther.\n`);
  for (let i = 0; i < 3; i++) aleph("todo", "note", "proj", "6", `note ${i}`);
  expect(doc()).toContain("---\n\nBody.\n\n## 6.");
  expect(doc()).toContain("---\n\nOther.\n\n### Notes");
});

test("add takes a body of several lines from stdin", () => {
  const a = alephIn({}, "Why it matters.\n\nDone when the gate counts.\n", "todo", "add", "proj", "Count at the gate", "--body", "-");
  expect(a.code).toBe(0);
  const shown = JSON.parse(aleph("todo", "show", "proj", "4", "--json").out);
  expect(shown.body).toBe("Why it matters.\n\nDone when the gate counts.");
  expect(remoteList()).toContain("---\n\nWhy it matters.\n\nDone when the gate counts.");
});

test("edit replaces the title, body, priority and labels it is given, and keeps the notes", () => {
  aleph("todo", "add", "proj", "Old title", "--labels", "a");
  aleph("todo", "note", "proj", "4", "a finding");
  const e = alephIn({}, "The new body.\n", "todo", "edit", "proj", "4", "--title", "New title", "--body", "-", "--priority", "high");
  expect(e.code).toBe(0);
  expect(JSON.parse(e.out)).toMatchObject({ id: 4, title: "New title", priority: "high", labels: ["a"] });
  const shown = JSON.parse(aleph("todo", "show", "proj", "4", "--json").out);
  expect(shown).toMatchObject({ title: "New title", body: "The new body.", priority: "high", labels: ["a"] });
  expect(shown.notes[0]).toContain("a finding");
  expect(JSON.parse(aleph("todo", "edit", "proj", "4", "--labels", "b,c").out).labels).toEqual(["b", "c"]);
  expect(sh(base, "git", "--git-dir", remote, "log", "-1", "--format=%s", "main")).toBe("todo: edit item 4");
});

test("edit of a legacy item gives it a header and keeps its prose unless the body is given", () => {
  expect(aleph("todo", "edit", "proj", "3", "--priority", "low").code).toBe(0);
  const shown = JSON.parse(aleph("todo", "show", "proj", "3", "--json").out);
  expect(shown).toMatchObject({ priority: "low", status: "open" });
  expect(shown.legacy).toBeUndefined();
  expect(shown.body).toContain("Written before the command existed.");
});

test("edit with nothing to change refuses", () => {
  const r = aleph("todo", "edit", "proj", "3");
  expect(r.code).toBe(1);
  expect(r.err).toContain("give --title, --body, --priority or --labels");
});
