import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as todos from "./todo.ts";
import * as issues from "./store.ts";
import { readDecision } from "../../jobs/lib/decision.ts";

const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
let base: string;
const saved = { ALEPH_ITEMS: process.env.ALEPH_ITEMS };

function sh(cwd: string, ...args: string[]): string {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
  return p.stdout.toString().trim();
}
const commits = () => Number(sh(base, "git", "--git-dir", join(base, "items.git"), "rev-list", "--count", "main"));

// Each test gets its own repo key: the store is shared by the file.
let n = 0;
function repo(items: { title: string; labels?: string[] }[] = []): issues.Place {
  const r = { key: `st${++n}` };
  issues.writeList(r, "start", (doc) => {
    for (const i of items) todos.add(doc, i.title, { labels: i.labels });
    return true;
  }, true);
  return r;
}
const item = (r: issues.Place, id: number) => todos.find(issues.readList(r)!, id)!;

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-store-"));
  sh(base, "git", "init", "-q", "--bare", "-b", "main", join(base, "items.git"));
  sh(base, "git", "clone", "-q", join(base, "items.git"), join(base, "items"));
  sh(join(base, "items"), "git", "commit", "-q", "--allow-empty", "-m", "start");
  sh(join(base, "items"), "git", "push", "-q", "origin", "main");
  Object.assign(process.env, gitEnv, { ALEPH_ITEMS: join(base, "items") });
});

afterAll(() => {
  if (saved.ALEPH_ITEMS === undefined) delete process.env.ALEPH_ITEMS;
  else process.env.ALEPH_ITEMS = saved.ALEPH_ITEMS;
  rmSync(base, { recursive: true, force: true });
});

describe("labels", () => {
  const it = (fm: Record<string, unknown>): todos.Item => ({ id: 1, title: "t", fm: { status: "open", ...fm }, body: "", notes: [], legacy: false });

  test("a list, a lone label, and none", () => {
    expect(issues.labels(it({ labels: ["a", "b"] }))).toEqual(["a", "b"]);
    expect(issues.labels(it({ labels: "goal" }))).toEqual(["goal"]);
    expect(issues.labels(it({}))).toEqual([]);
  });

  test("the predicates", () => {
    expect(issues.isGoal(it({ labels: ["goal"] }))).toBe(true);
    expect(issues.isGoal(it({ labels: ["goal"], status: "done" }))).toBe(false);
    expect(issues.needsChris(it({ labels: ["needs-chris"] }))).toBe(true);
    for (const l of ["goal", "needs-chris", "triaged", "live-check", "proposal"]) expect(issues.isSorted(it({ labels: [l] }))).toBe(true);
    expect(issues.isSorted(it({ labels: ["followup", "ui"] }))).toBe(false);
  });

  test("label adds what is missing and takes out what is named, once", () => {
    const i = it({ labels: ["a", "needs-chris"] });
    issues.label(i, ["goal", "a", "goal"], ["needs-chris"]);
    expect(issues.labels(i)).toEqual(["a", "goal"]);
  });

  test("label leaves an item alone when nothing changes", () => {
    const i = it({ labels: ["a"], updated: "2000-01-01" });
    issues.label(i, ["a"], ["b"]);
    expect(i.fm.updated).toBe("2000-01-01");
  });
});

describe("the read", () => {
  test("a reader reads each list once, and gives null for a repo the store has none for", () => {
    const r = repo([{ title: "one" }]);
    const lists = issues.reader();
    expect(lists.item(r.key, 1)?.title).toBe("one");
    issues.writeList(r, "rename", (doc) => { todos.find(doc, 1)!.title = "renamed"; return true; });
    expect(lists.item(r.key, 1)?.title).toBe("one");
    expect(issues.reader().item(r.key, 1)?.title).toBe("renamed");
    expect(lists.list("nosuchrepo")).toBeNull();
    expect(lists.item(r.key, 9)).toBeUndefined();
  });

  test("goals and goal give the open goals only", () => {
    const r = repo([{ title: "g", labels: ["goal"] }, { title: "x" }, { title: "done goal", labels: ["goal"] }]);
    issues.writeList(r, "close", (doc) => { todos.setStatus(todos.find(doc, 3)!, "done"); return true; });
    expect(issues.goals([r, { key: "nosuchrepo" }]).map((g) => [g.repo.key, g.item.id])).toEqual([[r.key, 1]]);
    expect(issues.goal(r, 1)?.title).toBe("g");
    expect(issues.goal(r, 2)).toBeNull();
    expect(issues.goal(r, 3)).toBeNull();
  });

  test("itemTimes keys each item by <repo>-<n>", () => {
    const r = repo([{ title: "one" }]);
    const t = issues.itemTimes().get(`${r.key}-1`);
    expect(t).toBeDefined();
    expect(t!.added).toBeLessThanOrEqual(t!.changed);
  });
});

describe("the writes", () => {
  test("note appends a note as one commit", () => {
    const r = repo([{ title: "one" }]);
    const before = commits();
    expect(issues.note(r, 1, "hello")).toBeNull();
    expect(commits()).toBe(before + 1);
    expect(item(r, 1).notes.at(-1)).toEndWith(": hello");
    expect(todos.status(item(r, 1))).toBe("open");
  });

  test("note with a label and a decision", () => {
    const r = repo([{ title: "one", labels: ["goal"] }]);
    const decision = { question: "A or B?", options: [{ label: "A", line: "a" }, { label: "B", line: "b" }], recommended: "A", why: ["w"] };
    expect(issues.note(r, 1, "asked", { label: "needs-chris", decision })).toBeNull();
    expect(issues.note(r, 1, "asked again", { label: "needs-chris" })).toBeNull();
    expect(issues.labels(item(r, 1))).toEqual(["goal", "needs-chris"]);
    expect(readDecision(item(r, 1))?.question).toBe("A or B?");
  });

  test("close is done with a note", () => {
    const r = repo([{ title: "one" }]);
    expect(issues.close(r, 1, "landed")).toBeNull();
    expect(todos.status(item(r, 1))).toBe("done");
    expect(item(r, 1).notes.at(-1)).toEndWith(": landed");
  });

  test("note says why when there is no such item or no list, and writes nothing", () => {
    const r = repo([{ title: "one" }]);
    const before = commits();
    expect(issues.note(r, 9, "x")).toBe("no issue 9");
    expect(issues.close({ key: "nosuchrepo" }, 1, "x")).toBe("the work store has no list for nosuchrepo");
    expect(commits()).toBe(before);
  });

  test("closeAndFile closes the item and files the new ones in one commit", () => {
    const r = repo([{ title: "one" }]);
    const before = commits();
    const w = issues.closeAndFile(r, "landed", 1, "job landed", [{ title: "Check it", labels: ["check"] }]);
    expect(w).toEqual({ todo: "done", ids: [2] });
    expect(commits()).toBe(before + 1);
    expect(todos.status(item(r, 1))).toBe("done");
    expect(issues.labels(item(r, 2))).toEqual(["check"]);
  });

  test("closeAndFile starts a list the store has none for, and names an item it lacks", () => {
    const r = { key: `st${++n}` };
    expect(issues.closeAndFile(r, "landed", 4, "x", [{ title: "Check", labels: ["check"] }])).toEqual({ todo: "no issue 4", ids: [1] });
    expect(issues.readList(r)!.items.map((i) => i.title)).toEqual(["Check"]);
  });

  test("file adds issues with their bodies; nothing to file writes nothing", () => {
    const r = repo();
    expect(issues.file(r, "follow-ups", [{ title: "a", labels: ["followup"], body: "From job j." }, { title: "b", labels: ["followup"] }])).toEqual([1, 2]);
    expect(item(r, 1).body).toBe("From job j.");
    const before = commits();
    expect(issues.file(r, "none", [])).toEqual([]);
    expect(commits()).toBe(before);
  });

  test("sort changes an open, unsorted item only", () => {
    const r = repo([{ title: "new" }, { title: "live", labels: ["live-check"] }, { title: "closed" }]);
    issues.close(r, 3, "x");
    const before = commits();
    expect(issues.sort(r, 2, "triage", (i) => issues.label(i, ["goal"]))).toBe(false);
    expect(issues.sort(r, 3, "triage", (i) => issues.label(i, ["goal"]))).toBe(false);
    expect(issues.sort(r, 9, "triage", (i) => issues.label(i, ["goal"]))).toBe(false);
    expect(commits()).toBe(before);
    expect(issues.sort(r, 1, "triage", (i) => issues.label(i, ["goal"]))).toBe(true);
    expect(issues.isGoal(item(r, 1))).toBe(true);
  });
});
