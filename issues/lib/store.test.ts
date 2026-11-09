import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as issues from "./todo.ts";
import { addPart } from "./parts.fixture.ts";
import * as store from "./store.ts";
import * as verbs from "./issues.ts";
import { askChris, askOf, setAsk, refIn } from "../../jobs/lib/asks/ask.ts";
import { storeRepos } from "../../tests/git-fixture.ts";

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

  test("a part of a parked parent is not buildable; reopen keeps the parent parked", () => {
    const r = repo([{ title: "p" }]);
    store.writeList(r, "part", (doc) => { addPart(doc, issues.find(doc, 1)!, { title: "part", spec: "Do it." }); return true; });
    const buildable = () => store.isBuildable(store.readList(r)!, item(r, "1.1" as any));
    expect(buildable()).toBe(true);
    store.writeList(r, "park", (doc) => { issues.setStatus(issues.find(doc, 1)!, "parked"); return true; });
    expect(buildable()).toBe(false);
    expect(issues.status(item(r, "1.1" as any))).toBe("open");
    store.writeList(r, "reopen", (doc) => { issues.setStatus(issues.find(doc, "1.1")!, "done"); store.reopen(doc, issues.find(doc, "1.1")!, null); return true; });
    expect(issues.status(item(r, 1))).toBe("parked");
    store.writeList(r, "unpark", (doc) => { issues.setStatus(issues.find(doc, 1)!, "open"); return true; });
    expect(buildable()).toBe(true);
    expect(issues.status(item(r, "1.1" as any))).toBe("open");
  });
});

describe("labels", () => {
  const it = (fm: issues.Issue["fm"]): issues.Issue => ({ id: 1, title: "t", fm, request: "", spec: "", notes: [] });

  test("a list, a lone label, and none", () => {
    expect(store.labels(it({ labels: ["a", "b"] }))).toEqual(["a", "b"]);
    expect(store.labels(it({ labels: "goal" }))).toEqual(["goal"]);
    expect(store.labels(it({}))).toEqual([]);
  });
});

describe("the read", () => {

  test("issues come critical first, then by repo and number; an unknown priority ranks as medium", () => {
    const a = repo([{ title: "a1", labels: ["goal"] }, { title: "a2", labels: ["goal"] }, { title: "a3", labels: ["goal"] }]);
    const b = repo([{ title: "b1", labels: ["goal"] }, { title: "b2", labels: ["goal"] }]);
    store.writeList(a, "prio", (doc) => { issues.find(doc, 1)!.fm.priority = "low"; issues.find(doc, 2)!.fm.priority = "critical"; issues.find(doc, 3)!.fm.priority = "weird"; return true; });
    store.writeList(b, "prio", (doc) => { issues.find(doc, 1)!.fm.priority = "medium"; issues.find(doc, 2)!.fm.priority = "critical"; return true; });
    expect(store.buildableIssues([a, b]).map((g) => `${g.repo.key}:${g.item.id}`)).toEqual([`${a.key}:2`, `${b.key}:2`, `${a.key}:3`, `${b.key}:1`, `${a.key}:1`]);
  });

});

describe("the parse cache", () => {

  test("a load at the same commit parses each item file once, a caller's change stays out of it, and a new commit shows", () => {
    const r = repo([{ title: "one" }, { title: "two" }]);
    store.readFetched(r);
    const parse = spyOn(issues, "parseItem");
    try {
      const first = store.readFetched(r)!;
      first.items[0].title = "changed";
      first.items[0].notes.push("- stray");
      const second = store.readFetched(r)!;
      expect(second.items.map((i) => i.title)).toEqual(["one", "two"]);
      expect(second.items[0].notes).toEqual([]);
      expect(parse).not.toHaveBeenCalled();
    } finally { parse.mockRestore(); }
    store.writeList(r, "retitle", (doc) => { issues.find(doc, 1)!.title = "newer"; return true; });
    expect(store.readFetched(r)!.items[0].title).toBe("newer");
  });

});

describe("the writes", () => {

  test("notes append in order under one notes marker, and the request keeps its blank line", () => {
    const r = repo();
    store.writeList(r, "seed", (doc) => { issues.add(doc, "one", { request: "Written long ago.\n\nDone when it is done." }); return true; });
    for (const t of ["first finding", "second finding", "third finding"]) expect(store.note(r, 1, t)).toBeNull();
    expect(item(r, 1).notes.map((l) => l.split(": ").at(-1))).toEqual(["first finding", "second finding", "third finding"]);
    const text = readFileSync(join(base, "items", r.key, "backlog", "tasks", `${r.key}-1.md`), "utf8");
    expect(text).toContain("---\n<!-- request -->\nWritten long ago.\n\nDone when it is done.\n<!-- notes -->\n- ");
    expect(text.match(/<!-- notes -->/g)).toHaveLength(1);
  });

  test("note leaves labels unset, after askChris set an ask", () => {
    const r = repo([{ title: "one", labels: ["goal"] }]);
    const ask = { kind: "input" as const, reason: "question", question: "A or B?", options: [{ label: "A", line: "a" }, { label: "B", line: "b" }], recommended: "A", why: ["w"] };
    expect(askChris(r, 1, ask, "asked")).toBeNull();
    expect(store.note(r, 1, "asked")).toBeNull();
    expect(store.note(r, 1, "asked again")).toBeNull();
    expect(item(r, 1).fm.labels).toBeUndefined();
    expect((store as any).label).toBeUndefined();
    expect(askOf(`${r.key}-1`)?.question).toBe("A or B?");
  });

  test("note says why when there is no such item or no list, and writes nothing", () => {
    const r = repo([{ title: "one" }]);
    const before = commits();
    expect(store.note(r, 9, "x")).toBe("no issue 9");
    expect(store.close({ key: "nosuchrepo" }, 1, "x")).toBe("the work store has no list for nosuchrepo");
    expect(commits()).toBe(before);
  });

  test("a Filing's kind is stored, and a Filing with no kind is a task", () => {
    const r = repo();
    const ids = store.file(r, "file", [{ title: "Check it", kind: "check" }, { title: "Do it" }]);
    expect(ids.map((id) => item(r, id).fm.kind)).toEqual(["check", "task"]);
  });

  test("closeAndFile starts a list the store has none for, and names an item it lacks", () => {
    const r = { key: `st${++n}` };
    expect(store.closeAndFile(r, "landed", 4, "x", [{ title: "Check", labels: ["check"] }])).toEqual({ todo: "no issue 4", ids: [1] });
    expect(store.readList(r)!.items.map((i) => i.title)).toEqual(["Check"]);
  });

  test("file adds issues with their bodies; nothing to file writes nothing", () => {
    const r = repo();
    expect(store.file(r, "follow-ups", [{ title: "a", labels: ["followup"], request: "From job j." }, { title: "b", labels: ["followup"] }])).toEqual([1, 2]);
    expect(item(r, 1).request).toBe("From job j.");
    const before = commits();
    expect(store.file(r, "none", [])).toEqual([]);
    expect(commits()).toBe(before);
  });

  test("sort changes an open, unsorted item only", () => {
    const r = repo([{ title: "new" }, { title: "live" }, { title: "closed" }]);
    store.writeList(r, "ask", (doc) => { setAsk(refIn(doc.repo!, issues.find(doc, 2)!), { kind: "input", reason: "question", question: "Check it.", options: [], why: [] }); return true; });
    store.close(r, 3, "x");
    const before = commits();
    expect(store.sort(r, 2, "intake", () => { })).toBe(false);
    expect(store.sort(r, 3, "intake", () => { })).toBe(false);
    expect(store.sort(r, 9, "intake", () => { })).toBe(false);
    expect(commits()).toBe(before);
    expect(store.sort(r, 1, "intake", (i) => { i.spec = "Do it."; })).toBe(true);
    expect(item(r, 1).spec).toBe("Do it.");
  });
});

describe("the flake tracker", () => {

  test("flakeTracker picks the lowest open id", () => {
    const r = repo([{ title: "a" }, { title: "b" }]);
    store.writeList(r, "trackers", (doc) => { for (const i of doc.items) i.fm.tracker = "true"; return true; });
    expect(store.flakeTracker(store.readList(r)!)?.id).toBe(1);
    store.close(r, 1, "x");
    expect(store.flakeTracker(store.readList(r)!)?.id).toBe(2);
  });
});

describe("the writers of the new shape", () => {
  test("add writes source and areas, and never labels, waiting_on or a retired label", () => {
    const r = repo();
    store.writeList(r, "x", (doc) => {
      issues.add(doc, "plain", { labels: ["audio", "goal", "needs-chris", "triaged", "planned", "proposal", "live-check"] });
      issues.add(doc, "from a worker", { labels: ["followup", "ui"] });
      issues.add(doc, "from deps", { source: "deps" });
      return true;
    });
    const [a, b, c] = [item(r, 1), item(r, 2), item(r, 3)];
    expect(a.fm).toMatchObject({ source: "chris", areas: ["audio"], priority: "medium" });
    expect(issues.status(a)).toBe("open");
    for (const i of [a, b, c]) for (const k of ["labels", "waiting_on"]) expect(k in i.fm).toBe(false);
    expect(b.fm).toMatchObject({ source: "worker", areas: ["ui"] });
    expect(c.fm.source).toBe("deps");
    expect(store.isSorted(store.readList(r)!, a)).toBe(false);
  });

  test("editing a parent's priority sets it on its open parts, not its done ones, in one commit", () => {
    const r = repo();
    store.writeList(r, "x", (doc) => {
      const issue = issues.add(doc, "big", { priority: "high" });
      addPart(doc, issue, { title: "p1", spec: "a" });
      addPart(doc, issue, { title: "p2", spec: "b" });
      const p3 = addPart(doc, issue, { title: "p3", spec: "c" });
      issues.setStatus(p3, "done");
      return true;
    });
    const before = commits();
    verbs.edit(r, 1, { priority: "critical" });
    expect(commits()).toBe(before + 1);
    expect(item(r, 1 as any).fm.priority).toBe("critical");
    expect(item(r, "1.1" as any).fm.priority).toBe("critical");
    expect(item(r, "1.2" as any).fm.priority).toBe("critical");
    expect(item(r, "1.3" as any).fm.priority).toBe("high");
    expect(() => verbs.edit(r, 1, { priority: "urgent" })).toThrow("low, medium, high, critical");
  });

  test("addPart allocates <n>.<k> under the issue, with the issue's priority and its after, in one commit", () => {
    const r = repo();
    const before = commits();
    store.writeList(r, "x", (doc) => {
      const issue = issues.add(doc, "big", { priority: "high" });
      const g1 = addPart(doc, issue, { title: "part one", spec: "Do one." });
      const g2 = addPart(doc, issue, { title: "part two", spec: "Do two.", after: [`${r.key}-1.1`] });
      issues.add(doc, "another issue");
      return [g1.sub, g2.sub];
    });
    expect(commits()).toBe(before + 1);
    const doc = store.readList(r)!;
    expect(store.partsOf(doc, issues.find(doc, 1)!).map(issues.refOf)).toEqual(["1.1", "1.2"]);
    expect(item(r, "1.1" as any).fm).toMatchObject({ after: [], priority: "high" });
    expect(item(r, "1.2" as any).fm.after).toEqual([`${r.key}-1.1`]);
    expect(item(r, "1.2" as any).spec).toBe("Do two.");
    // The next issue number ignores parts.
    expect(doc.items.find((i) => i.title === "another issue")!.id).toBe(2);
    expect(store.isBuildable(doc, item(r, "1.1" as any))).toBe(true);
    expect(store.isSorted(doc, item(r, 1))).toBe(true);
    expect(store.afterOf(item(r, "1.2" as any))).toEqual([`${r.key}-1.1`]);
  });
});

describe("an issue's children", () => {
  test("are the issues whose from names it and its old parts; each finds the issue as its parent; a child round-trips and lints clean", () => {
    const doc = { items: [] } as unknown as issues.Doc;
    const top = issues.add(doc, "big");
    const old = addPart(doc, top, { title: "old part", spec: "x" });
    const child = issues.add(doc, "[Big] new child", { spec: "x", from: "r-1", after: ["r-1.1"] });
    issues.add(doc, "other");
    expect(child.id).toBe(2);
    expect(store.partsOf(doc, top)).toEqual([old, child]);
    expect([store.parentOf(doc, old), store.parentOf(doc, child), store.parentOf(doc, top)]).toEqual([top, top, undefined]);
    expect(store.partsOf(doc, child)).toEqual([]);
    expect(issues.parseItem(issues.renderItem("r", child)).fm).toMatchObject({ from: "r-1", after: ["r-1.1"] });
    expect(issues.lint(doc)).toEqual([]);
    child.fm.from = "r-1.1";
    expect(issues.lint(doc).map((f) => f.problem)).toEqual(["from: r-1.1 is not <repo>-<n>"]);
  });
});

describe("a part's source", () => {
  test("addPart stores agent, or the parent's source when it is not chris; a part with none stored reads agent", () => {
    const doc = { items: [] } as unknown as issues.Doc;
    const a = issues.add(doc, "from chris");
    const b = issues.add(doc, "from worker", { source: "worker" });
    expect(addPart(doc, a, { title: "p", spec: "x" }).fm.source).toBe("agent");
    expect(addPart(doc, b, { title: "p", spec: "x" }).fm.source).toBe("worker");
    const old = addPart(doc, a, { title: "old", spec: "x" });
    delete old.fm.source;
    expect(store.sourceOf(old)).toBe("agent");
    expect(store.sourceOf(a)).toBe("chris");
  });
});
