// Archived goal tests from todo/lib/store.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as issues from "../../../todo/lib/todo.ts";
import * as store from "../../../todo/lib/store.ts";
import { storeRepos } from "../../../tests/git-fixture.ts";

const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
let base: string;
const saved = { ALEPH_ISSUES: process.env.ALEPH_ISSUES };

function sh(cwd: string, ...args: string[]): string {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
  return p.stdout.toString().trim();
}
const commits = () => Number(sh(base, "git", "--git-dir", join(base, "items.git"), "rev-list", "--count", "main"));

// Each test gets its own repo key: the store is shared by the file.
let n = 0;
function repo(items: { title: string; labels?: string[] }[] = []): store.Place {
  const r = { key: `st${++n}` };
  store.writeList(r, "start", (doc) => {
    for (const i of items) { issues.add(doc, i.title, { labels: i.labels, ...(i.labels?.includes("goal") ? { spec: "Do it." } : {}) }); }
    return true;
  }, true);
  return r;
}
const item = (r: store.Place, id: number) => issues.find(store.readList(r)!, id)!;

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-store-"));
  storeRepos(base);
  Object.assign(process.env, gitEnv, { ALEPH_ISSUES: join(base, "items") });
});

afterAll(() => {
  if (saved.ALEPH_ISSUES === undefined) delete process.env.ALEPH_ISSUES;
  else process.env.ALEPH_ISSUES = saved.ALEPH_ISSUES;
  rmSync(base, { recursive: true, force: true });
});

describe("parked", () => {
  test("a parked issue is out of goals() until unparked", () => {
    const r = repo([{ title: "a", labels: ["goal"] }]);
    const has = () => store.goals([r]).some((g) => g.item.id === 1);
    expect(has()).toBe(true);
    store.writeList(r, "park", (doc) => { issues.setStatus(issues.find(doc, 1)!, "parked"); return true; });
    expect(item(r, 1).fm.closed_as).toBeUndefined();
    expect(has()).toBe(false);
    store.writeList(r, "unpark", (doc) => { issues.setStatus(issues.find(doc, 1)!, "open"); return true; });
    expect(item(r, 1).fm.parked).toBeUndefined();
    expect(has()).toBe(true);
  });
});

describe("labels", () => {
  const it = (fm: issues.Issue["fm"]): issues.Issue => ({ id: 1, title: "t", fm, request: "", spec: "", notes: [] });

  test("the predicates", () => {
    const doc: issues.Doc = { items: [] };
    const spec = (fm: issues.Issue["fm"] = {}): issues.Issue => ({ ...it(fm), spec: "Do it." });
    expect(store.isBuildable(doc, spec())).toBe(true);
    expect(store.isBuildable(doc, spec({ ask: "input" }))).toBe(false);
    expect(store.isBuildable(doc, spec({ closed_as: "done" }))).toBe(false);
    expect(store.isBuildable(doc, spec({ plan: "true" }))).toBe(false);
    expect(store.isBuildable(doc, spec({ tracker: "true" }))).toBe(false);
    expect(store.isBuildable(doc, it({}))).toBe(false);
    expect(store.isBuildable({ items: [{ ...it({}), sub: 1, spec: "x" }] }, spec())).toBe(false);
    expect(store.isSorted(doc, spec())).toBe(true);
    expect(store.isSorted({ items: [{ ...it({}), sub: 1 }] }, it({}))).toBe(true);
    expect(store.isSorted(doc, it({ ask: "approval" }))).toBe(true);
    expect(store.isSorted(doc, it({ plan: "true" }))).toBe(true);
    expect(store.isSorted(doc, it({}))).toBe(false);
  });

  test("label adds what is missing and takes out what is named, once", () => {
    const i = it({ labels: ["a", "b"] });
    store.label(i, ["c", "a", "c"], ["b"]);
    expect(store.labels(i)).toEqual(["a", "c"]);
  });

  test("label leaves an item alone when nothing changes", () => {
    const i = it({ labels: ["a"], updated: "2000-01-01" });
    store.label(i, ["a"], ["b"]);
    expect(i.fm.updated).toBe("2000-01-01");
  });
});

describe("the read", () => {
  test("a reader reads each list once, and gives null for a repo the store has none for", () => {
    const r = repo([{ title: "one" }]);
    const lists = store.reader();
    expect(lists.item(r.key, 1)?.title).toBe("one");
    store.writeList(r, "rename", (doc) => { issues.find(doc, 1)!.title = "renamed"; return true; });
    expect(lists.item(r.key, 1)?.title).toBe("one");
    expect(store.reader().item(r.key, 1)?.title).toBe("renamed");
    expect(lists.list("nosuchrepo")).toBeNull();
    expect(lists.item(r.key, 9)).toBeUndefined();
  });

  test("goals and goal give the open goals only", () => {
    const r = repo([{ title: "g", labels: ["goal"] }, { title: "x" }, { title: "done goal", labels: ["goal"] }]);
    store.writeList(r, "close", (doc) => { issues.setStatus(issues.find(doc, 3)!, "done"); return true; });
    expect(store.goals([r, { key: "nosuchrepo" }]).map((g) => [g.repo.key, g.item.id])).toEqual([[r.key, 1]]);
    expect(store.goal(r, 1)?.title).toBe("g");
    expect(store.goal(r, 2)).toBeNull();
    expect(store.goal(r, 3)).toBeNull();
  });

});

describe("the writes", () => {
  test("note appends a note as one commit", () => {
    const r = repo([{ title: "one" }]);
    const before = commits();
    expect(store.note(r, 1, "hello")).toBeNull();
    expect(commits()).toBe(before + 1);
    expect(item(r, 1).notes.at(-1)).toEndWith(": hello");
    expect(issues.status(item(r, 1))).toBe("open");
  });

  test("close is done with a note", () => {
    const r = repo([{ title: "one" }]);
    expect(store.close(r, 1, "landed")).toBeNull();
    expect(issues.status(item(r, 1))).toBe("done");
    expect(item(r, 1).notes.at(-1)).toEndWith(": landed");
  });

  test("closeAndFile closes the item and files the new ones in one commit", () => {
    const r = repo([{ title: "one" }]);
    const before = commits();
    const w = store.closeAndFile(r, "landed", 1, "job landed", [{ title: "Check it", labels: ["check"] }]);
    expect(w).toEqual({ todo: "done", ids: [2] });
    expect(commits()).toBe(before + 1);
    expect(issues.status(item(r, 1))).toBe("done");
    expect(store.areasOf(item(r, 2))).toEqual(["check"]);
    expect(item(r, 2).fm).toMatchObject({ source: "chris" });
    expect(item(r, 2).fm.labels).toBeUndefined();
  });

  test("closeAndFile gives a filing without a priority the closed item's, and keeps one it has", () => {
    const r = repo();
    store.writeList(r, "seed", (doc) => { issues.add(doc, "hot", { priority: "high" }); return true; });
    store.closeAndFile(r, "landed", 1, "x", [{ title: "A" }, { title: "B", priority: "low" }]);
    expect(item(r, 2).fm.priority).toBe("high");
    expect(item(r, 3).fm.priority).toBe("low");
    store.closeAndFile(r, "again", undefined, "", [{ title: "C" }]);
    expect(item(r, 4).fm.priority).toBe("medium");
  });
});

describe("the flake tracker", () => {
  test("the first noteFlake adds the tracker with the note, in one commit", () => {
    const r = repo([{ title: "one" }]);
    const before = commits();
    expect(store.noteFlake(r, "flaky A")).toEqual({ id: 2 });
    expect(commits()).toBe(before + 1);
    const t = item(r, 2);
    expect(t.title).toBe("Flaky tests seen by runs");
    expect(store.areasOf(t)).toEqual([store.FLAKES]);
    expect(t.fm.tracker).toBe("true");
    expect(store.isSorted(store.readList(r)!, t)).toBe(true);
    expect(issues.status(t)).toBe("open");
    expect(t.fm.priority).toBe("low");
    expect(t.request).toContain("Chris picks");
    expect(t.notes.at(-1)).toEndWith(": flaky A");
  });

  test("a second noteFlake adds a note to the same item and no new item", () => {
    const r = repo();
    const first = store.noteFlake(r, "flaky A");
    const second = store.noteFlake(r, "flaky B");
    expect(first).toEqual({ id: 1 });
    expect(second).toEqual({ id: 1 });
    expect(store.readList(r)!.items.length).toBe(1);
    expect(item(r, 1).notes.length).toBe(2);
    expect(item(r, 1).notes.at(-1)).toEndWith(": flaky B");
  });

  test("a closed tracker is not reused, a new one is made", () => {
    const r = repo();
    store.noteFlake(r, "flaky A");
    store.close(r, 1, "done");
    expect(store.noteFlake(r, "flaky B")).toEqual({ id: 2 });
    expect(issues.status(item(r, 2))).toBe("open");
    expect(store.flakeTracker(store.readList(r)!)?.id).toBe(2);
  });

  test("the tracker is sorted, so triage skips it", () => {
    const r = repo();
    store.noteFlake(r, "flaky A");
    const doc = store.readList(r)!;
    expect(store.isSorted(doc, item(r, 1))).toBe(true);
    expect(store.isBuildable(doc, item(r, 1))).toBe(false);
  });

  test("noteFlake on a repo with no list starts one", () => {
    const r = { key: `st${++n}` };
    expect(store.noteFlake(r, "flaky A")).toEqual({ id: 1 });
  });
});

describe("the work store file", () => {
  const file = (created: string, updated = "updated: 2026-10-30") => `---\nid: st1-4\ntitle: Old\n${created}\n${updated}\npriority: medium\nlabels: []\nrepo: st1\n---\n\nBody.\n`;

  test("render, parse, render gives the same text", () => {
    const once = issues.renderItem("st1", issues.parseItem(file("created: 2026-10-30")));
    expect(issues.renderItem("st1", issues.parseItem(once))).toBe(once);
  });

  test("a writeList that changes nothing makes no commit", () => {
    const r = repo([{ title: "one" }]);
    const before = commits();
    expect(store.writeList(r, "nothing", () => true)).not.toBeNull();
    expect(commits()).toBe(before);
  });
});

describe("dotted goal files", () => {
  const dotted = () => {
    const r = { key: `st${++n}` };
    const dir = join(base, "items");
    const tasks = join(dir, r.key, "backlog", "tasks");
    sh(dir, "mkdir", "-p", tasks);
    Bun.write(join(dir, r.key, "backlog", "config.yml"), store.config(r.key));
    for (const ref of ["5", "5.1", "5.2"]) {
      const text = `---\nid: ${r.key}-${ref}\ntitle: t${ref}\nstatus: open\ncreated_date: 2026-10-30\nupdated_date: 2026-10-30\n---\n\nbody ${ref}\n`;
      require("node:fs").writeFileSync(join(tasks, `${r.key}-${ref}.md`), text);
    }
    require("node:fs").writeFileSync(join(dir, r.key, "backlog", "config.yml"), store.config(r.key));
    sh(dir, "git", "add", "-A");
    sh(dir, "git", "commit", "-q", "-m", "hand-written");
    sh(dir, "git", "push", "-q", "origin", "main");
    return r;
  };

  test("readList gives the three items in order, all with id 5", () => {
    const r = dotted();
    const items = store.readList(r)!.items;
    expect(items.map(issues.refOf)).toEqual(["5", "5.1", "5.2"]);
    expect(items.map((i) => i.id)).toEqual([5, 5, 5]);
    expect(items.some((i) => Number.isNaN(i.id))).toBe(false);
  });

  test("a number resolves to the plain item", () => {
    const r = dotted();
    expect(issues.find(store.readList(r)!, 5)!.sub).toBeUndefined();
    expect(store.reader().item(r.key, 5)!.sub).toBeUndefined();
  });

  test("a note on item 5 changes only proj-5.md", () => {
    const r = dotted();
    store.note(r, 5, "hello");
    const dir = join(base, "items");
    sh(dir, "git", "fetch", "-q", "origin");
    const changed = sh(dir, "git", "diff", "--name-only", "origin/main~1", "origin/main").split("\n");
    expect(changed).toEqual([`${r.key}/backlog/tasks/${r.key}-5.md`]);
    expect(sh(dir, "git", "ls-tree", "-r", "--name-only", "origin/main")).not.toContain("NaN");
  });

  test("file gives issue number 6", () => {
    const r = dotted();
    expect(store.file(r, "new", [{ title: "x", labels: [] }])).toEqual([6]);
  });

});

describe("store fetches", () => {
  let log: string, bin: string, path: string | undefined;
  const fetches = (): number => readFileSync(log, "utf8").split("\n").filter((l) => l === "fetch").length;
  beforeAll(() => {
    bin = join(base, "bin");
    log = join(base, "fetch.log");
    writeFileSync(log, "");
    mkdirSync(bin);
    const real = Bun.spawnSync(["which", "git"]).stdout.toString().trim();
    writeFileSync(join(bin, "git"), `#!/bin/sh\n[ "$1" = fetch ] && echo fetch >> ${log}\nexec ${real} "$@"\n`);
    chmodSync(join(bin, "git"), 0o755);
    path = process.env.PATH;
    process.env.PATH = `${bin}:${path}`;
  });
  afterAll(() => { process.env.PATH = path; });

  test("one reader fetches once for the lists of two repos", () => {
    const a = repo([{ title: "a" }]), b = repo([{ title: "b" }]);
    const before = fetches();
    const lists = store.reader();
    expect(lists.list(a.key)?.items.length).toBe(1);
    expect(lists.list(b.key)?.items.length).toBe(1);
    expect(fetches() - before).toBe(1);
  });

  test("goals over three repos fetches once", () => {
    const rs = [repo([{ title: "a", labels: ["goal"] }]), repo([{ title: "b", labels: ["goal"] }]), repo([{ title: "c", labels: ["goal"] }])];
    const before = fetches();
    expect(store.goals(rs).length).toBe(3);
    expect(fetches() - before).toBe(1);
  });
});
