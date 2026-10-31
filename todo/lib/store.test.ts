import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as issues from "./todo.ts";
import * as store from "./store.ts";

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
    for (const i of items) { const it = issues.add(doc, i.title, { labels: i.labels }); if (i.labels?.includes("goal")) it.fm.kind = "goal"; }
    return true;
  }, true);
  return r;
}
const item = (r: store.Place, id: number) => issues.find(store.readList(r)!, id)!;

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-store-"));
  sh(base, "git", "init", "-q", "--bare", "-b", "main", join(base, "items.git"));
  sh(base, "git", "clone", "-q", join(base, "items.git"), join(base, "items"));
  sh(join(base, "items"), "git", "commit", "-q", "--allow-empty", "-m", "start");
  sh(join(base, "items"), "git", "push", "-q", "origin", "main");
  Object.assign(process.env, gitEnv, { ALEPH_ISSUES: join(base, "items") });
});

afterAll(() => {
  if (saved.ALEPH_ISSUES === undefined) delete process.env.ALEPH_ISSUES;
  else process.env.ALEPH_ISSUES = saved.ALEPH_ISSUES;
  rmSync(base, { recursive: true, force: true });
});

describe("labels", () => {
  const it = (fm: Record<string, unknown>): issues.Item => ({ id: 1, title: "t", fm: { status: "open", ...fm }, body: "", notes: [], legacy: false });

  test("a list, a lone label, and none", () => {
    expect(store.labels(it({ labels: ["a", "b"] }))).toEqual(["a", "b"]);
    expect(store.labels(it({ labels: "goal" }))).toEqual(["goal"]);
    expect(store.labels(it({}))).toEqual([]);
  });

  test("the predicates", () => {
    expect(store.isGoal(it({ kind: "goal" }))).toBe(true);
    expect(store.isGoal(it({ kind: "goal", ask: "input" }))).toBe(false);
    expect(store.isGoal(it({ kind: "goal", status: "done" }))).toBe(false);
    expect(store.isGoal(it({ kind: "issue" }))).toBe(false);
    expect(store.isSorted(it({ kind: "goal" }))).toBe(true);
    expect(store.isSorted(it({ kind: "issue", goals: ["x-1.1"] }))).toBe(true);
    expect(store.isSorted(it({ kind: "issue", ask: "approval" }))).toBe(true);
    expect(store.isSorted(it({ kind: "issue" }))).toBe(false);
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

  test("itemTimes keys each item by <repo>-<n>", () => {
    const r = repo([{ title: "one" }]);
    const t = store.itemTimes().get(`${r.key}-1`);
    expect(t).toBeDefined();
    expect(t!.added).toBeLessThanOrEqual(t!.changed);
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

  test("note with a label and an ask", () => {
    const r = repo([{ title: "one", labels: ["goal"] }]);
    const ask = { kind: "input" as const, reason: "question", question: "A or B?", options: [{ label: "A", line: "a" }, { label: "B", line: "b" }], recommended: "A", why: ["w"] };
    expect(store.note(r, 1, "asked", { label: "ui", ask })).toBeNull();
    expect(store.note(r, 1, "asked again", { label: "ui" })).toBeNull();
    expect(store.labels(item(r, 1))).toEqual(["ui"]);
    expect(store.askOf(item(r, 1))?.question).toBe("A or B?");
  });

  test("close is done with a note", () => {
    const r = repo([{ title: "one" }]);
    expect(store.close(r, 1, "landed")).toBeNull();
    expect(issues.status(item(r, 1))).toBe("done");
    expect(item(r, 1).notes.at(-1)).toEndWith(": landed");
  });

  test("note says why when there is no such item or no list, and writes nothing", () => {
    const r = repo([{ title: "one" }]);
    const before = commits();
    expect(store.note(r, 9, "x")).toBe("no issue 9");
    expect(store.close({ key: "nosuchrepo" }, 1, "x")).toBe("the work store has no list for nosuchrepo");
    expect(commits()).toBe(before);
  });

  test("closeAndFile closes the item and files the new ones in one commit", () => {
    const r = repo([{ title: "one" }]);
    const before = commits();
    const w = store.closeAndFile(r, "landed", 1, "job landed", [{ title: "Check it", labels: ["check"] }]);
    expect(w).toEqual({ todo: "done", ids: [2] });
    expect(commits()).toBe(before + 1);
    expect(issues.status(item(r, 1))).toBe("done");
    expect(store.areasOf(item(r, 2))).toEqual(["check"]);
    expect(item(r, 2).fm).toMatchObject({ kind: "issue", source: "chris" });
    expect(item(r, 2).fm.labels).toBeUndefined();
  });

  test("closeAndFile starts a list the store has none for, and names an item it lacks", () => {
    const r = { key: `st${++n}` };
    expect(store.closeAndFile(r, "landed", 4, "x", [{ title: "Check", labels: ["check"] }])).toEqual({ todo: "no issue 4", ids: [1] });
    expect(store.readList(r)!.items.map((i) => i.title)).toEqual(["Check"]);
  });

  test("file adds issues with their bodies; nothing to file writes nothing", () => {
    const r = repo();
    expect(store.file(r, "follow-ups", [{ title: "a", labels: ["followup"], body: "From job j." }, { title: "b", labels: ["followup"] }])).toEqual([1, 2]);
    expect(item(r, 1).body).toBe("From job j.");
    const before = commits();
    expect(store.file(r, "none", [])).toEqual([]);
    expect(commits()).toBe(before);
  });

  test("sort changes an open, unsorted item only", () => {
    const r = repo([{ title: "new" }, { title: "live" }, { title: "closed" }]);
    store.writeList(r, "ask", (doc) => { store.setAsk(issues.find(doc, 2)!, { kind: "input", reason: "host-check", question: "Check it.", options: [], why: [] }); return true; });
    store.close(r, 3, "x");
    const before = commits();
    expect(store.sort(r, 2, "triage", (i) => { i.fm.kind = "goal"; })).toBe(false);
    expect(store.sort(r, 3, "triage", (i) => { i.fm.kind = "goal"; })).toBe(false);
    expect(store.sort(r, 9, "triage", (i) => { i.fm.kind = "goal"; })).toBe(false);
    expect(commits()).toBe(before);
    expect(store.sort(r, 1, "triage", (i) => { i.fm.kind = "goal"; })).toBe(true);
    expect(store.isGoal(item(r, 1))).toBe(true);
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
    expect(t.fm.route).toBe("triaged");
    expect(store.isSorted(t)).toBe(true);
    expect(issues.status(t)).toBe("open");
    expect(t.fm.priority).toBe("low");
    expect(t.fm.goal).toBeUndefined();
    expect(t.body).toContain("Chris picks");
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
    expect(store.isSorted(item(r, 1))).toBe(true);
    expect(store.isGoal(item(r, 1))).toBe(false);
  });

  test("flakeTracker picks the lowest open id", () => {
    const r = repo([{ title: "a", labels: ["flakes"] }, { title: "b", labels: ["flakes"] }]);
    expect(store.flakeTracker(store.readList(r)!)?.id).toBe(1);
    store.close(r, 1, "x");
    expect(store.flakeTracker(store.readList(r)!)?.id).toBe(2);
  });

  test("noteFlake on a repo with no list starts one", () => {
    const r = { key: `st${++n}` };
    expect(store.noteFlake(r, "flaky A")).toEqual({ id: 1 });
  });
});

describe("the work store file", () => {
  const file = (created: string, updated = "updated: 2026-10-30") => `---\nid: st1-4\ntitle: Old\nstatus: open\n${created}\n${updated}\npriority: medium\nlabels: []\nrepo: st1\n---\n\nBody.\n`;
  const withItem = (text: string): issues.Item => ({ ...issues.parseItem(text), fm: issues.parseItem(text).fm });

  test("renderItem writes created_date and no created key", () => {
    const i = issues.parseItem(file("created: 2026-10-30"));
    const text = issues.renderItem("st1", i);
    expect(text).toContain("created_date: 2026-10-30\n");
    expect(text).not.toMatch(/^created:/m);
    expect(text).toContain("updated_date: 2026-10-30\n");
    expect(text).not.toMatch(/^updated:/m);
  });

  test("parseItem reads updated_date and still accepts a file with only updated", () => {
    expect(issues.parseItem(file("created: 2026-10-30", "updated_date: 2026-10-30")).fm.updated).toBe("2026-10-30");
    expect(issues.parseItem(file("created: 2026-10-30", "updated: 2026-10-30")).fm.updated).toBe("2026-10-30");
  });

  test("a file with both update keys takes the updated_date value", () => {
    expect(issues.parseItem(file("created: 2026-10-30", "updated: 2026-09-01\nupdated_date: 2026-10-30")).fm.updated).toBe("2026-10-30");
  });

  test("render, parse, render of a file with the old updated key gives the same text", () => {
    const once = issues.renderItem("st1", issues.parseItem(file("created: 2026-10-30", "updated: 2026-09-01")));
    expect(issues.renderItem("st1", issues.parseItem(once))).toBe(once);
  });

  test("parseItem reads created_date and still accepts a file with only created", () => {
    expect(issues.parseItem(file("created_date: 2026-10-30")).fm.created).toBe("2026-10-30");
    expect(issues.parseItem(file("created: 2026-10-30")).fm.created).toBe("2026-10-30");
  });

  test("a file with both keys takes the created_date value", () => {
    expect(issues.parseItem(file("created: 2026-09-01\ncreated_date: 2026-10-30")).fm.created).toBe("2026-10-30");
  });

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

  test("itemTimes has a key for the goal", () => {
    const r = dotted();
    store.readList(r);
    sh(join(base, "items"), "git", "fetch", "-q", "origin");
    expect(store.itemTimes().has(`${r.key}-5.1`)).toBe(true);
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

describe("the writers of the new shape", () => {
  test("add writes kind, source and areas, and never labels, waiting_on or a retired label", () => {
    const r = repo();
    store.writeList(r, "x", (doc) => {
      issues.add(doc, "plain", { labels: ["audio", "goal", "needs-chris", "triaged", "planned", "proposal", "live-check"] });
      issues.add(doc, "from a worker", { labels: ["followup", "ui"] });
      issues.add(doc, "from deps", { source: "deps" });
      return true;
    });
    const [a, b, c] = [item(r, 1), item(r, 2), item(r, 3)];
    expect(a.fm).toMatchObject({ kind: "issue", source: "chris", areas: ["audio"], status: "open", priority: "medium" });
    for (const i of [a, b, c]) for (const k of ["labels", "waiting_on"]) expect(k in i.fm).toBe(false);
    expect(b.fm).toMatchObject({ source: "worker", areas: ["ui"] });
    expect(c.fm.source).toBe("deps");
    expect(store.isSorted(a)).toBe(false);
  });

  test("addGoal allocates <n>.<k> under the issue, with the issue's priority, after and goals, in one commit", () => {
    const r = repo();
    const before = commits();
    store.writeList(r, "x", (doc) => {
      const issue = issues.add(doc, "big", { priority: "high" });
      const g1 = issues.addGoal(doc, issue, { title: "part one", body: "Do one." });
      const g2 = issues.addGoal(doc, issue, { title: "part two", body: "Do two.", after: [`${r.key}-1.1`] });
      issues.add(doc, "another issue");
      return [g1.sub, g2.sub];
    });
    expect(commits()).toBe(before + 1);
    const doc = store.readList(r)!;
    expect(issues.find(doc, 1)!.fm.goals).toEqual([`${r.key}-1.1`, `${r.key}-1.2`]);
    expect(item(r, "1.1" as any).fm).toMatchObject({ kind: "goal", issue: `${r.key}-1`, after: [], priority: "high", status: "open" });
    expect(item(r, "1.2" as any).fm.after).toEqual([`${r.key}-1.1`]);
    expect(item(r, "1.2" as any).body).toBe("Do two.");
    // The next issue number ignores goals.
    expect(doc.items.find((i) => i.title === "another issue")!.id).toBe(2);
    expect(store.isGoal(item(r, "1.1" as any))).toBe(true);
    expect(store.isSorted(item(r, 1))).toBe(true);
    expect(store.goalsOf(item(r, 1))).toEqual([`${r.key}-1.1`, `${r.key}-1.2`]);
    expect(store.afterOf(item(r, "1.2" as any))).toEqual([`${r.key}-1.1`]);
  });
});
