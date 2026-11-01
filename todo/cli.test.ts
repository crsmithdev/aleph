import { afterEach, beforeEach, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseFrontmatter, splitFrontmatter } from "../vault/lib/frontmatter.ts";
import { renderItem, type Issue } from "./lib/todo.ts";
import { config } from "./lib/store.ts";

// Matches `--timeout=30000` in the package.json test script, so running this file by name gets the same limit.
setDefaultTimeout(30000);

const CLI = join(import.meta.dir, "..", "jobs", "cli.ts");
// `repo` is a product repo; `items` is the work store's checkout and `remote` its origin.
let base: string, remote: string, repo: string, repoRemote: string, items: string;

const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
function sh(cwd: string, ...args: string[]): string {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
  return p.stdout.toString().trim();
}

function env(extra: Record<string, string> = {}): Record<string, string> {
  return { ...(process.env as Record<string, string>), CLAUDECODE: "", ...gitEnv, ALEPH_REPOS: join(base, "repos.json"), ALEPH_ISSUES: items, ...extra };
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

/** The items of a list in the old docs/todo.md form, in the stored shape. */
function parse(text: string): { items: Issue[] } {
  const parts = text.split(/^## (\d+)\. (.*)$/m);
  const items: Issue[] = [];
  for (let i = 1; i < parts.length; i += 3) {
    const { frontmatter, body } = splitFrontmatter(parts[i + 2].replace(/^\n/, ""));
    const { status, kind, labels, ...fm } = parseFrontmatter(frontmatter ?? "") as Record<string, any>;
    const text = body.trim();
    items.push({ id: Number(parts[i]), title: parts[i + 1].trim(), fm: { ...fm, ...(status && status !== "open" ? { closed_as: status } : {}) }, request: kind === "goal" ? "" : text, spec: kind === "goal" ? text : "", notes: [] });
  }
  return { items };
}

const tasks = "proj/backlog/tasks";
/** Item `id` as the store's checkout has it, which follows origin/main. */
const doc = (id: number) => readFileSync(join(items, tasks, `proj-${id}.md`), "utf8");
const remoteItem = (id: number) => sh(base, "git", "--git-dir", remote, "show", `main:${tasks}/proj-${id}.md`);

/** Put the items of `text`, a list in the old docs/todo.md form, on the store's origin/main by hand. */
function seed(text: string | null): void {
  rmSync(join(items, "proj"), { recursive: true, force: true });
  if (text !== null) {
    mkdirSync(join(items, tasks), { recursive: true });
    writeFileSync(join(items, "proj", "backlog", "config.yml"), config("proj"));
    parse(text).items.forEach((item, n) => writeFileSync(join(items, tasks, `proj-${item.id}${n ? `-${n}` : ""}.md`), renderItem("proj", item)));
  }
  sh(items, "git", "add", "-A");
  sh(items, "git", "commit", "-qm", "seed", "--allow-empty");
  sh(items, "git", "push", "-q", "origin", "main");
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-todo-"));
  remote = join(base, "items.git");
  items = join(base, "items");
  repoRemote = join(base, "proj.git");
  repo = join(base, "proj");
  for (const [bare, clone] of [[remote, items], [repoRemote, repo]]) {
    sh(base, "git", "init", "-q", "--bare", "-b", "main", bare);
    sh(base, "git", "clone", "-q", bare, clone);
    sh(clone, "git", "commit", "-q", "--allow-empty", "-m", "start");
    sh(clone, "git", "push", "-q", "origin", "main");
  }
  writeFileSync(join(base, "repos.json"), JSON.stringify({ proj: { path: repo } }));
  seed("# To do\n\n## 3. An old item\n---\nid: 3\nstatus: open\ncreated: 2026-09-01\nupdated: 2026-09-01\npriority: medium\nlabels: []\n---\n\nWritten long ago.\n\nDone when it is done.\n");
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

test("a write is one commit on the store's origin/main, the store's checkout follows, and no product repo moves", () => {
  const before = sh(items, "git", "rev-parse", "HEAD");
  const product = sh(base, "git", "--git-dir", repoRemote, "rev-parse", "main");
  const a = aleph("issue", "add", "proj", "Teach the gate to count");
  expect(a.code).toBe(0);
  const head = sh(base, "git", "--git-dir", remote, "rev-parse", "main");
  expect(JSON.parse(a.out).commit).toBe(head);
  expect(sh(base, "git", "--git-dir", remote, "rev-parse", "main~1")).toBe(before);
  expect(sh(base, "git", "--git-dir", remote, "diff", "--name-only", "main~1", "main")).toBe(`${tasks}/proj-4.md`);
  expect(sh(base, "git", "--git-dir", remote, "log", "-1", "--format=%s", "main")).toBe("proj: todo: add an item");
  expect(remoteItem(4)).toContain("id: proj-4\ntitle: Teach the gate to count\n");
  expect(sh(items, "git", "rev-parse", "HEAD")).toBe(head);
  expect(sh(items, "git", "status", "--porcelain")).toBe("");
  expect(sh(base, "git", "--git-dir", repoRemote, "rev-parse", "main")).toBe(product);
});

test("a write from a store clone that is behind lands on top of main and keeps main's change", () => {
  const other = join(base, "other");
  sh(base, "git", "clone", "-q", remote, other);
  writeFileSync(join(other, "readme.txt"), "x\n");
  sh(other, "git", "add", "readme.txt");
  sh(other, "git", "commit", "-qm", "readme");
  sh(other, "git", "push", "-q", "origin", "main");
  expect(aleph("issue", "add", "proj", "After the readme").code).toBe(0);
  expect(sh(base, "git", "--git-dir", remote, "log", "--format=%s", "-2", "main")).toBe("proj: todo: add an item\nreadme");
  expect(Bun.spawnSync(["test", "-f", join(items, "readme.txt")]).exitCode).toBe(0);
});

test("a write with a changed file in the store's checkout still reaches main, and says the checkout did not follow", () => {
  writeFileSync(join(items, tasks, "proj-3.md"), "local edit\n");
  const a = aleph("issue", "add", "proj", "Despite the edit");
  expect(a.code).toBe(0);
  expect(remoteItem(4)).toContain("Despite the edit");
  expect(a.err).toContain(`main checkout not updated: it has changes in ${tasks}/proj-3.md`);
  expect(doc(3)).toBe("local edit\n");
});

test("a worker's push block does not stop a to-do write", () => {
  const w = alephWith({ GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: `url.${join(base, "nowhere")}.pushInsteadOf`, GIT_CONFIG_VALUE_0: remote }, "issue", "note", "proj", "3", "from a worker");
  expect(w.code).toBe(0);
  expect(remoteItem(3)).toContain("from a worker");
});

test("add allocates the next id and list shows it", () => {
  const a = aleph("issue", "add", "proj", "Teach the gate to count");
  expect(a.code).toBe(0);
  expect(JSON.parse(a.out).added).toBe(4);
  const l = aleph("issue", "list", "proj", "--json");
  const rows = JSON.parse(l.out);
  expect(rows.map((r: any) => r.id)).toEqual([3, 4]);
  expect(rows[1]).toMatchObject({ status: "open", priority: "medium", source: "chris", areas: [] })
  expect(rows[1]).not.toHaveProperty("labels");
});

test("add gives source agent under CLAUDECODE, chris without it, and worker for a followup label", () => {
  const src = (title: string) => JSON.parse(aleph("issue", "list", "proj", "--json").out).find((r: any) => r.title === title).source;
  expect(alephWith({ CLAUDECODE: "1" }, "issue", "add", "proj", "From agent").code).toBe(0);
  expect(aleph("issue", "add", "proj", "From human").code).toBe(0);
  expect(alephWith({ CLAUDECODE: "1" }, "issue", "add", "proj", "From worker", "--labels", "followup").code).toBe(0);
  expect(src("From agent")).toBe("agent");
  expect(src("From human")).toBe("chris");
  expect(src("From worker")).toBe("worker");
  const id = JSON.parse(aleph("issue", "list", "proj", "--json").out).find((r: any) => r.title === "From human").id;
  expect(aleph("issue", "edit", "proj", String(id), "--source", "agent").code).toBe(0);
  expect(src("From human")).toBe("agent");
  const lint = aleph("issue", "lint", "proj");
  expect(lint.code, lint.out + lint.err).toBe(0);
});

test("a write leaves the files of other items byte for byte", () => {
  const old = remoteItem(3);
  aleph("issue", "add", "proj", "New one");
  expect(remoteItem(3)).toBe(old);
  expect(old).toContain("Written long ago.\n\nDone when it is done.");
});

test("notes append and never rewrite an existing line", () => {
  aleph("issue", "add", "proj", "Item four");
  aleph("issue", "note", "proj", "4", "first finding");
  const after = aleph("issue", "note", "proj", "4", "second finding");
  expect(after.code).toBe(0);
  const shown = JSON.parse(aleph("issue", "show", "proj", "4", "--json").out);
  expect(shown.notes).toHaveLength(2);
  expect(shown.notes[0]).toContain("first finding");
  expect(shown.notes[1]).toContain("second finding");
  expect(doc(4).match(/<!-- notes -->/g)).toHaveLength(1);
});

test("done and drop set a field, never move or renumber the item", () => {
  aleph("issue", "add", "proj", "Ships");
  aleph("issue", "add", "proj", "Abandoned");
  expect(aleph("issue", "done", "proj", "4", "landed in abc123").code).toBe(0);
  expect(aleph("issue", "drop", "proj", "5", "superseded by 4").code).toBe(0);
  const rows = JSON.parse(aleph("issue", "list", "proj", "--json").out);
  expect(rows.map((r: any) => [r.id, r.status])).toEqual([[3, "open"], [4, "done"], [5, "dropped"]]);
  expect(JSON.parse(aleph("issue", "list", "proj", "--status", "done", "--json").out).map((r: any) => r.id)).toEqual([4]);
  expect(JSON.parse(aleph("issue", "show", "proj", "4", "--json").out).notes[0]).toContain("landed in abc123");
});

test("a title that YAML would misread is quoted in the file and comes back exactly", () => {
  const title = '`/play` says "done" \\ then: drops it';
  expect(aleph("issue", "add", "proj", title).code).toBe(0);
  expect(remoteItem(4)).toContain(`title: ${JSON.stringify(title)}\n`);
  expect(JSON.parse(aleph("issue", "show", "proj", "4", "--json").out).title).toBe(title);
});

test("drop refuses without a reason", () => {
  aleph("issue", "add", "proj", "Item four");
  const r = aleph("issue", "drop", "proj", "4");
  expect(r.code).toBe(1);
  expect(r.err).toContain("say why");
});

test("labels filter, and a flag value never lands in the title", () => {
  aleph("issue", "add", "proj", "Audio thing", "--labels", "audio,phone", "--priority", "high");
  aleph("issue", "add", "proj", "Other thing", "--labels", "build");
  const rows = JSON.parse(aleph("issue", "list", "proj", "--json").out);
  expect(rows.map((r: any) => r.title)).toEqual(["An old item", "Audio thing", "Other thing"]);
  expect(rows[1]).toMatchObject({ priority: "high", areas: ["audio", "phone"] });
  expect(JSON.parse(aleph("issue", "list", "proj", "--label", "audio", "--json").out).map((r: any) => r.id)).toEqual([4]);
});

test("lint blocks on bad frontmatter and --fix repairs what it can", () => {
  seed(`# To do\n\n## 7. Broken\n---\nid: 9\nstatus: open\ncreated: 2026-09-01\n---\n\nBody.\n`);
  const bad = aleph("issue", "lint", "proj");
  expect(bad.code).toBe(1);
  expect(bad.err).toContain("updated is missing");
  const fixed = aleph("issue", "lint", "proj", "--fix");
  expect(fixed.code).toBe(0);
  expect(JSON.parse(fixed.out).fixed.length).toBeGreaterThan(0);
  expect(aleph("issue", "lint", "proj").code).toBe(0);
});

test("lint refuses an unknown status and a duplicate id, and --fix cannot save it", () => {
  seed(`# To do\n\n## 8. One\n---\nid: 8\nstatus: maybe\ncreated: 2026-09-01\nupdated: 2026-09-01\n---\n\nA.\n\n## 8. Two\n---\nid: 8\nstatus: open\ncreated: 2026-09-01\nupdated: 2026-09-01\n---\n\nB.\n`);
  const r = aleph("issue", "lint", "proj");
  expect(r.code).toBe(1);
  expect(r.err).toContain('closed_as "maybe" is not done or dropped');
  expect(r.err).toContain("2 items share id 8");
  expect(aleph("issue", "lint", "proj", "--fix").code).toBe(1);
});

test("add starts a list for a repo that has none; every other verb refuses", () => {
  seed(null);
  expect(aleph("issue", "list", "proj").code).toBe(1);
  expect(aleph("issue", "list", "proj").err).toContain("the work store has no list for proj");
  const a = aleph("issue", "add", "proj", "The first thing");
  expect(a.code).toBe(0);
  expect(JSON.parse(a.out).added).toBe(1);
  expect(sh(base, "git", "--git-dir", remote, "show", "main:proj/backlog/config.yml")).toContain('task_prefix: "proj"');
  expect(JSON.parse(aleph("issue", "list", "proj", "--json").out)).toHaveLength(1);
  expect(aleph("issue", "lint", "proj").code).toBe(0);
});

test("an unknown repo and an unknown item both refuse", () => {
  expect(aleph("issue", "list", "nope").err).toContain("no repo named nope");
  expect(aleph("issue", "show", "proj", "99").err).toContain("has no issue 99");
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

test("a write keeps one blank line between the header, the body and the notes", () => {
  for (let i = 0; i < 3; i++) aleph("issue", "note", "proj", "3", `note ${i}`);
  expect(doc(3)).toContain("---\n<!-- request -->\nWritten long ago.\n\nDone when it is done.\n<!-- notes -->\n- ");
});

test("add takes a body of several lines from stdin", () => {
  const a = alephIn({}, "Why it matters.\n\nDone when the gate counts.\n", "issue", "add", "proj", "Count at the gate", "--request", "-");
  expect(a.code).toBe(0);
  const shown = JSON.parse(aleph("issue", "show", "proj", "4", "--json").out);
  expect(shown.request).toBe("Why it matters.\n\nDone when the gate counts.");
  expect(remoteItem(4)).toContain("---\n<!-- request -->\nWhy it matters.\n\nDone when the gate counts.");
});

test("edit replaces the title, body, priority and labels it is given, and keeps the notes", () => {
  aleph("issue", "add", "proj", "Old title", "--labels", "a");
  aleph("issue", "note", "proj", "4", "a finding");
  const e = alephIn({}, "The new body.\n", "issue", "edit", "proj", "4", "--title", "New title", "--request", "-", "--priority", "high");
  expect(e.code).toBe(0);
  expect(JSON.parse(e.out)).toMatchObject({ id: 4, title: "New title", priority: "high", areas: ["a"] });
  const shown = JSON.parse(aleph("issue", "show", "proj", "4", "--json").out);
  expect(shown).toMatchObject({ title: "New title", request: "The new body.", priority: "high", areas: ["a"] });
  expect(shown.notes[0]).toContain("a finding");
  expect(JSON.parse(aleph("issue", "edit", "proj", "4", "--labels", "b,c").out).areas).toEqual(["b", "c"]);
  expect(sh(base, "git", "--git-dir", remote, "log", "-1", "--format=%s", "main")).toBe("proj: todo: edit item 4");
});

test("list and lint with no repo cover the repos with a run or an item update in the last 7 days, the latest first", () => {
  writeFileSync(join(base, "repos.json"), JSON.stringify({ proj: { path: repo }, fresh: { path: repo } }));
  const jobs = join(base, "jobs");
  mkdirSync(jobs);
  const e = { ALEPH_JOBS_DIR: jobs };
  expect(alephWith(e, "issue", "add", "fresh", "A new item").code).toBe(0);
  expect(alephWith(e, "issue", "list").out).toBe("fresh\n  1  open    A new item\n");
  // proj's only item is from September; a run today makes proj recent, and the latest.
  mkdirSync(join(jobs, "r1"));
  writeFileSync(join(jobs, "r1", "state.json"), JSON.stringify({ kind: "agent", name: "x", repo: "proj", job: "r1", condition: "landed", started: new Date().toISOString() }));
  expect(alephWith(e, "issue", "list").out).toBe("proj\n  3  open    An old item\nfresh\n  1  open    A new item\n");
  expect(JSON.parse(alephWith(e, "issue", "list", "--status", "done", "--json").out)).toEqual([]);
  const lint = alephWith(e, "issue", "lint");
  expect(lint.code).toBe(0);
  expect(JSON.parse(lint.out)).toEqual([{ repo: "proj", items: 1, findings: [] }, { repo: "fresh", items: 1, findings: [] }]);
  expect(alephWith(e, "issue", "show").code).toBe(1);
});

test("edit with nothing to change refuses", () => {
  const r = aleph("issue", "edit", "proj", "3");
  expect(r.code).toBe(1);
  expect(r.err).toContain("give --title, --request, --spec, --priority, --labels, --after");
});

/** Add item 4 with `fields` in its front matter, as an old writer would have left it. */
function seedFields(fields: string): void {
  aleph("issue", "add", "proj", "Broken");
  writeFileSync(join(items, tasks, "proj-4.md"), remoteItem(4).replace("source: chris", `source: chris\n${fields}`));
  sh(items, "git", "add", "-A");
  sh(items, "git", "commit", "-qm", "break");
  sh(items, "git", "push", "-q", "origin", "main");
}

test("lint refuses a labels field and names the item", () => {
  seedFields("labels: [ui]");
  const l = aleph("issue", "lint", "proj");
  expect(l.code).toBe(1);
  expect(l.err).toContain("item 4: labels is retired");
});

test("lint refuses a waiting_on field and names the item", () => {
  seedFields("waiting_on: proj-1");
  const l = aleph("issue", "lint", "proj");
  expect(l.code).toBe(1);
  expect(l.err).toContain("item 4: waiting_on is retired");
});

test("aleph issue lint reads a dotted goal file and names it by its dotted id", () => {
  const parent = parse("# To do\n\n## 5. Parent\n---\nid: 5\nstatus: open\ncreated: 2026-09-01\nupdated: 2026-09-01\n---\n\nBody.\n").items[0];
  const goal = { ...parent, sub: 1, title: "Goal", fm: { ...parent.fm, id: "5.1" } };
  const put = (due?: string) => {
    seed(null);
    mkdirSync(join(items, tasks), { recursive: true });
    writeFileSync(join(items, "proj", "backlog", "config.yml"), config("proj"));
    writeFileSync(join(items, tasks, "proj-5.md"), renderItem("proj", parent));
    const g = due ? { ...goal, fm: { ...goal.fm, created: due } } : goal;
    writeFileSync(join(items, tasks, "proj-5.1.md"), renderItem("proj", g));
    sh(items, "git", "add", "-A");
    sh(items, "git", "commit", "-qm", "dotted");
    sh(items, "git", "push", "-q", "origin", "main");
  };
  put("soon");
  const bad = aleph("issue", "lint", "proj");
  expect(bad.code).toBe(1);
  expect(bad.err).toContain('item 5.1: created "soon"');
  expect(bad.err).not.toContain("share id 5");
  expect(bad.err).not.toContain("id says 5.1");
  put();
  const ok = aleph("issue", "lint", "proj");
  expect(ok.err).toBe("");
  expect(ok.code).toBe(0);
});

test("aleph issue is the only command: aleph todo is gone", () => {
  expect(aleph("issue", "add", "proj", "Under the name").code).toBe(0);
  const l = JSON.parse(aleph("issue", "list", "proj", "--json").out).slice(-1);
  const id = String(l[0].id);
  expect(aleph("todo", "add", "proj", "Under the old name").code).toBe(1);
  expect(aleph("todo", "list", "proj").code).toBe(1);
  expect(JSON.parse(aleph("issue", "show", "proj", id, "--json").out).title).toContain("Under the");
  expect(aleph("issue", "note", "proj", id, "a note").code).toBe(0);
  expect(aleph("issue", "edit", "proj", id, "--priority", "high").code).toBe(0);
  expect(aleph("issue", "lint", "proj").code).toBe(0);
  expect(aleph("issue", "done", "proj", id).code).toBe(0);
  expect(aleph("issue", "show", "proj", "99").err).toContain("has no issue 99");
  const usage = aleph("nonsense").err;
  expect(usage).toContain("|issue|");
  expect(usage).not.toContain("todo");
});

test("hidden copies files into the store as one commit, lists them, and show counts them", () => {
  seed("# To do\n\n" + sec(3, "kind: goal"));
  const f = join(base, "a.test.ts");
  writeFileSync(f, 'import { test } from "bun:test";\ntest("a", () => {});\n');
  expect(aleph("issue", "show", "proj", "3").out).toContain("hidden checks: 0");
  expect(aleph("issue", "hidden", "proj", "3").out).toContain("no hidden checks");
  const before = sh(base, "git", "--git-dir", remote, "rev-list", "--count", "main");
  const h = aleph("issue", "hidden", "proj", "3", f);
  expect(h.code).toBe(0);
  expect(Number(sh(base, "git", "--git-dir", remote, "rev-list", "--count", "main"))).toBe(Number(before) + 1);
  expect(sh(base, "git", "--git-dir", remote, "show", "main:proj/hidden/proj-3/a.test.ts")).toContain('test("a"');
  expect(aleph("issue", "hidden", "proj", "3").out.trim()).toBe("a.test.ts");
  expect(aleph("issue", "show", "proj", "3").out).toContain("hidden checks: 1");
  expect(aleph("issue", "hidden", "proj", "99", f).err).toContain("has no issue 99");
  expect(aleph("issue", "hidden", "proj", "3", join(base, "nope.ts")).code).toBe(1);
});

test("hidden reads the goal id directory, then the old number", async () => {
  seed("# To do\n\n" + [3, 4].map((n) => sec(n, "kind: goal")).join("\n"));
  for (const [p, text] of [["3/a.test.ts", "a"], ["proj-4/b.test.ts", "b"], ["proj-5.1/c.test.ts", "c"]]) {
    mkdirSync(join(items, "proj", "hidden", p.split("/")[0]), { recursive: true });
    writeFileSync(join(items, "proj", "hidden", p), text);
  }
  sh(items, "git", "add", "-A");
  sh(items, "git", "commit", "-qm", "hidden");
  sh(items, "git", "push", "-q", "origin", "main");
  expect(aleph("issue", "hidden", "proj", "3").out.trim()).toBe("a.test.ts");
  expect(aleph("issue", "hidden", "proj", "4").out.trim()).toBe("b.test.ts");
  expect(aleph("issue", "show", "proj", "4").out).toContain("hidden checks: 1");
  const was = process.env.ALEPH_ISSUES;
  process.env.ALEPH_ISSUES = items;
  try {
    const { readHidden } = await import("./lib/store.ts");
    expect(Object.keys(readHidden({ key: "proj" }, "proj-5.1"))).toEqual(["c.test.ts"]);
    expect(Object.keys(readHidden({ key: "proj" }, "proj-3"))).toEqual(["a.test.ts"]);
    expect(Object.keys(readHidden({ key: "proj" }, 3))).toEqual(["a.test.ts"]);
    expect(Object.keys(readHidden({ key: "proj" }, 4))).toEqual(["b.test.ts"]);
  } finally {
    if (was === undefined) delete process.env.ALEPH_ISSUES; else process.env.ALEPH_ISSUES = was;
  }
});

const sec = (id: number, fm: string, body = "Body.") => `## ${id}. Item ${id}\n---\nid: ${id}\nstatus: open\ncreated: 2026-09-01\nupdated: 2026-09-01\npriority: medium\n${fm}\n---\n\n${body}\n`;

test("lint refuses an after ref that is not <repo>-<n>[.<k>]", () => {
  seed(`# To do\n\n${sec(20, "kind: goal\nafter: [proj-1.2]\nlabels: []")}\n${sec(21, "kind: goal\nafter: [proj-x]\nlabels: []")}`);
  const r = aleph("issue", "lint", "proj");
  expect(r.code).toBe(1);
  expect(r.out + r.err).toContain("after: proj-x");
  expect(r.out + r.err).not.toContain("proj-1.2");
});
