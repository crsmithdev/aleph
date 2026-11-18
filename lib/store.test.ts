import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as issues from "./todo.ts";
import { addPart } from "../issues/lib/parts.testkit.ts";
import * as store from "./store.ts";
import * as verbs from "../issues/lib/issues.ts";
import { askChris, askOf, setAsk, refIn, clearAsk } from "../jobs/lib/asks/ask.ts";
import * as record from "../jobs/lib/records/record.ts";
import { seed as seedJob } from "../jobs/job.testkit.ts";
import { storeRepos } from "../tests/git.testkit.ts";
import { readEvents } from "./layout.ts";
import { lockRetry } from "./git.ts";

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
/** A project and the numbers of the issues it starts with, `ids`: a number is taken from one counter across projects, so a test reads its numbers here. */
type Repo = store.Place & { ids: number[] };
function repo(items: { title: string; spec?: boolean }[] = []): Repo {
  const r: Repo = { key: `st${++n}`, ids: [] };
  store.writeList(r, "start", (doc) => {
    r.ids = items.map((i) => issues.add(doc, i.title, i.spec ? { spec: "Do it." } : {}).id);
    return true;
  }, true);
  return r;
}
const item = (r: store.Place, id: number) => issues.find(store.readList(r)!, id)!;
/** Effects that start nothing. */
const quiet: store.Effects = { after: () => {} };
/** Effects that record the key of each issue passed to `after`. */
const recorder = () => { const seen: string[] = []; return { seen, effects: { after: (_: store.Place, i: issues.Issue) => { seen.push(`issue.${i.id}`); } } }; };
/** The `[by, subject]` of each `filed` event logged since `before`. */
const filedSince = (before: number) => readEvents().slice(before).filter((e) => e.action === "filed").map((e) => [e.subject, e.object]);

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-store-"));
  storeRepos(base);
  Object.assign(process.env, gitEnv, { ALEPH_ITEMS: join(base, "items") });
});

afterAll(() => {
  if (saved.ALEPH_ITEMS === undefined) delete process.env.ALEPH_ITEMS;
  else process.env.ALEPH_ITEMS = saved.ALEPH_ITEMS;
  rmSync(base, { recursive: true, force: true });
});

test("a read in a fetchingOnce scope fetches the store once; outside it, at each read", async () => {
  const r = repo([{ title: "A" }]);
  const lose = () => sh(join(base, "items"), "git", "remote", "set-url", "origin", join(base, "no-such-origin"));
  const origin = sh(join(base, "items"), "git", "remote", "get-url", "origin");
  try {
    await store.fetchingOnce(async () => {
      store.readList(r);
      lose();
      store.readList(r);
    });
    expect(() => store.readList(r)).toThrow("fetch failed");
  } finally { sh(join(base, "items"), "git", "remote", "set-url", "origin", origin); }
});

describe("parked", () => {

  test("a child of a parked parent is not buildable; reopen keeps the parent parked", () => {
    const r = repo([{ title: "p" }]);
    const [parent] = r.ids;
    const child = store.writeList(r, "part", (doc) => addPart(doc, issues.find(doc, parent)!, { title: "part", spec: "Do it." }).id)!.value;
    const buildable = () => store.isBuildable(store.readList(r)!, item(r, child));
    expect(buildable()).toBe(true);
    store.writeList(r, "park", (doc) => { issues.setStatus(issues.find(doc, parent)!, "parked"); return true; });
    expect(buildable()).toBe(false);
    expect(issues.status(item(r, child))).toBe("open");
    store.writeList(r, "reopen", (doc) => { issues.setStatus(issues.find(doc, child)!, "done"); store.reopen(doc, issues.find(doc, child)!, null); return true; });
    expect(issues.status(item(r, parent))).toBe("parked");
    store.writeList(r, "unpark", (doc) => { issues.setStatus(issues.find(doc, parent)!, "open"); return true; });
    expect(buildable()).toBe(true);
    expect(issues.status(item(r, child))).toBe("open");
  });
});

describe("labels", () => {
  const it = (fm: issues.Issue["fm"]): issues.Issue => ({ id: 1, title: "t", fm, request: "", spec: "", notes: [] });

  test("a list, a lone label, and none", () => {
    expect(issues.labels(it({ labels: ["a", "b"] }))).toEqual(["a", "b"]);
    expect(issues.labels(it({ labels: "ui" }))).toEqual(["ui"]);
    expect(issues.labels(it({}))).toEqual([]);
  });

  test("priorityOf reads the priority, and medium for none or an unknown one", () => {
    expect([it({ priority: "critical" }), it({}), it({ priority: "weird" })].map(issues.priorityOf)).toEqual(["critical", "medium", "medium"]);
  });
});

describe("the read", () => {

  test("issues come critical first, then by repo and number; an unknown priority ranks as medium", () => {
    const a = repo([{ title: "a1", spec: true }, { title: "a2", spec: true }, { title: "a3", spec: true }]);
    const b = repo([{ title: "b1", spec: true }, { title: "b2", spec: true }]);
    store.writeList(a, "prio", (doc) => { issues.find(doc, a.ids[0])!.fm.priority = "low"; issues.find(doc, a.ids[1])!.fm.priority = "critical"; issues.find(doc, a.ids[2])!.fm.priority = "weird"; return true; });
    store.writeList(b, "prio", (doc) => { issues.find(doc, b.ids[0])!.fm.priority = "medium"; issues.find(doc, b.ids[1])!.fm.priority = "critical"; return true; });
    expect(store.buildableIssues([a, b]).map((g) => `${g.repo.key}:${g.item.id}`)).toEqual([`${a.key}:${a.ids[1]}`, `${b.key}:${b.ids[1]}`, `${a.key}:${a.ids[2]}`, `${b.key}:${b.ids[0]}`, `${a.key}:${a.ids[0]}`]);
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
    store.writeList(r, "retitle", (doc) => { issues.find(doc, r.ids[0])!.title = "newer"; return true; });
    expect(store.readFetched(r)!.items[0].title).toBe("newer");
  });

});

describe("the writes", () => {

  test("notes append in order under one notes heading, and the request keeps its blank line", () => {
    const r = repo();
    const id = store.writeList(r, "seed", (doc) => issues.add(doc, "one", { request: "Written long ago.\n\nDone when it is done." }).id)!.value;
    for (const t of ["first finding", "second finding", "third finding"]) expect(store.note(r, id, t)).toBeNull();
    expect(item(r, id).notes.map((l) => l.split(": ").at(-1))).toEqual(["first finding", "second finding", "third finding"]);
    const text = readFileSync(join(base, "items", "issues", String(id), "issue.md"), "utf8");
    expect(text).toContain("---\n\n# Request\n\nWritten long ago.\n\nDone when it is done.\n\n# Notes\n\n- ");
    expect(text.match(/^# Notes$/gm)).toHaveLength(1);
  });

  test("note leaves labels unset, after askChris set an ask", () => {
    const r = repo([{ title: "one", spec: true }]);
    const ask = { kind: "input" as const, reason: "question", question: "A or B?", options: [{ label: "A", line: "a" }, { label: "B", line: "b" }], recommended: "A", why: ["w"] };
    const [id] = r.ids;
    expect(askChris(r, id, ask, "asked")).toBeNull();
    expect(store.note(r, id, "asked")).toBeNull();
    expect(store.note(r, id, "asked again")).toBeNull();
    expect(item(r, id).fm.labels).toBeUndefined();
    expect((store as any).label).toBeUndefined();
    expect(askOf(`issue.${id}`)?.question).toBe("A or B?");
    clearAsk(`issue.${id}`);
  });

  test("note says why when there is no such item or no list, and writes nothing", () => {
    const r = repo([{ title: "one" }]);
    const before = commits();
    expect(store.note(r, 9, "x")).toBe("no issue 9");
    expect(store.close({ key: "nosuchrepo" }, 1, "x")).toBe("the items repo has no project nosuchrepo");
    expect(commits()).toBe(before);
  });

  test("a Filing's kind is stored, and a Filing with no kind is a task", () => {
    const r = repo();
    const ids = store.file(r, "file", [{ title: "Check it", kind: "check" }, { title: "Do it" }], "rule", quiet);
    expect(ids.map((id) => item(r, id).fm.kind)).toEqual(["check", "task"]);
  });

  test("fileIssue files one issue in one commit, logs one filed event and calls after once", () => {
    const r = repo(), rec = recorder(), before = readEvents().length, at = commits();
    const i = store.fileIssue(r, { title: "Ship the thing", spec: "Do it.", parked: true }, "director", rec.effects);
    expect(commits()).toBe(at + 1);
    expect([item(r, i.id).spec, issues.status(item(r, i.id))]).toEqual(["Do it.", "parked"]);
    expect(filedSince(before)).toEqual([["director", `issue.${i.id}`]]);
    expect(rec.seen).toEqual([`issue.${i.id}`]);
  });

  test("fileIssue refuses a title that breaks the rule: no commit, no event, no after", () => {
    const r = repo(), rec = recorder(), before = readEvents().length, at = commits();
    expect(() => store.fileIssue(r, { title: "Fix: the title has a prefix" }, "rule", rec.effects)).toThrow("prefix");
    expect(() => store.fileIssue(r, { title: "Ship the thing." }, "rule", rec.effects)).toThrow("period");
    expect([commits(), filedSince(before), rec.seen]).toEqual([at, [], []]);
  });

  test("writeFiling starts nothing when its change writes nothing", () => {
    const r = repo(), rec = recorder(), before = readEvents().length;
    expect(store.writeFiling(r, "none", "rule", rec.effects, () => null)).toBeNull();
    expect([filedSince(before), rec.seen]).toEqual([[], []]);
  });

  test("closeAndFile files through writeFiling: each new issue logs filed and starts its effects", () => {
    const r = repo([{ title: "landed" }]), rec = recorder(), before = readEvents().length;
    const got = store.closeAndFile(r, "landed", r.ids[0], "x", [{ title: "Check it", kind: "check" }], "rule", rec.effects);
    expect(got).toEqual({ todo: "done", ids: [r.ids[0] + 1] });
    expect(filedSince(before)).toEqual([["rule", `issue.${got.ids[0]}`]]);
    expect(rec.seen).toEqual([`issue.${got.ids[0]}`]);
  });

  test("the flake tracker is made with no filed event", () => {
    const r = repo(), before = readEvents().length;
    expect(store.noteFlake(r, "a flake")).toEqual({ id: expect.any(Number) });
    expect(filedSince(before)).toEqual([]);
  });

  test("closeAndFile starts a list the store has none for, and names an item it lacks", () => {
    const r = { key: `st${++n}` };
    expect(store.closeAndFile(r, "landed", 4, "x", [{ title: "Check", labels: ["check"] }], "rule", quiet)).toMatchObject({ todo: "no issue 4" });
    expect(store.readList(r)!.items.map((i) => i.title)).toEqual(["Check"]);
  });

  test("file adds issues with their bodies; nothing to file writes nothing", () => {
    const r = repo();
    const [a, b] = store.file(r, "follow-ups", [{ title: "a", labels: ["followup"], request: "From job j." }, { title: "b", labels: ["followup"] }], "worker", quiet);
    expect(b).toBe(a + 1);
    expect(item(r, a).request).toBe("From job j.");
    const before = commits();
    expect(store.file(r, "none", [], "worker", quiet)).toEqual([]);
    expect(commits()).toBe(before);
  });

  test("sort changes an open, unsorted item only", () => {
    const r = repo([{ title: "new" }, { title: "live" }, { title: "closed" }]);
    const [fresh, live, shut] = r.ids;
    store.writeList(r, "ask", (doc) => { setAsk(refIn(issues.find(doc, live)!), { reason: "question", question: "Check it.", options: [], why: [] }); return true; });
    store.close(r, shut, "x");
    const before = commits();
    expect(store.sort(r, live, "intake", () => { })).toBeNull();
    expect(store.sort(r, shut, "intake", () => { })).toBeNull();
    expect(store.sort(r, 999999, "intake", () => { })).toBeNull();
    expect(commits()).toBe(before);
    expect(store.sort(r, fresh, "intake", (i) => { i.spec = "Do it."; })).not.toBeNull();
    expect(item(r, fresh).spec).toBe("Do it.");
    clearAsk(`issue.${live}`);
  });
});

describe("an issue's ask", () => {
  const ask = { kind: "input" as const, reason: "question", question: "A or B?", options: [], why: [] };

  test("closing an issue deletes its whole state row: its Ask or its run's Ask, and its ci", () => {
    const r = repo([{ title: "on issue" }, { title: "on run" }]);
    const [a, b] = r.ids;
    setAsk(`issue.${a}`, ask);
    record.editIssueState(`issue.${a}`, (s) => { s.ci = { url: "u", commit: "c", failure: "f" }; });
    seedJob({ role: "build", name: `issue.${b}`, repo: r.key, target: `issue.${b}`, state: "waiting", ask });
    record.editIssueState(`issue.${b}`, (s) => { s.ci = { url: "u", commit: "c", failure: "f" }; });
    expect(record.read(`issue.${b}`)?.askJob).toBeDefined();
    expect(store.close(r, a, "x")).toBeNull();
    expect(store.close(r, b, "x", "dropped")).toBeNull();
    expect(record.read(`issue.${a}`)).toBeNull();
    expect(record.read(`issue.${b}`)).toBeNull();
  });

  test("a write lists the issues it dropped and asks nothing itself: the verb layer asks", () => {
    const r = repo([{ title: "parent" }]);
    let part = 0;
    store.writeList(r, "part", (doc) => { part = issues.add(doc, "part", { from: `issue.${r.ids[0]}` }).id; return true; });
    const w = store.writeList(r, "drop", (doc) => { issues.setStatus(issues.find(doc, part)!, "dropped", undefined, "too big"); return true; })!;
    expect(w.dropped.map((i) => i.id)).toEqual([part]);
    expect(askOf(`issue.${r.ids[0]}`)).toBeNull();
  });

  test("a parked issue keeps its Ask; one write that parks one and drops another clears only the dropped one's", () => {
    const r = repo([{ title: "parked" }, { title: "dropped" }]);
    const [a, b] = r.ids;
    setAsk(`issue.${a}`, ask);
    setAsk(`issue.${b}`, ask);
    store.writeList(r, "park and drop", (doc) => { issues.setStatus(issues.find(doc, a)!, "parked"); issues.setStatus(issues.find(doc, b)!, "dropped"); return true; });
    expect(record.read(`issue.${a}`)?.ask?.question).toBe("A or B?");
    expect(record.read(`issue.${b}`)).toBeNull();
    clearAsk(`issue.${a}`);
  });
});

describe("the flake tracker", () => {

  test("flakeTracker picks the lowest open id", () => {
    const r = repo([{ title: "a" }, { title: "b" }]);
    store.writeList(r, "trackers", (doc) => { for (const i of doc.items) i.fm.tracker = "true"; return true; });
    expect(store.flakeTracker(store.readList(r)!)?.id).toBe(r.ids[0]);
    store.close(r, r.ids[0], "x");
    expect(store.flakeTracker(store.readList(r)!)?.id).toBe(r.ids[1]);
  });
});

describe("the writers of the new shape", () => {
  test("add writes source and areas, and never labels, waiting_on or a retired label", () => {
    const r = repo();
    const ids = store.writeList(r, "x", (doc) => [
      issues.add(doc, "plain", { labels: ["audio", "goal", "needs-chris", "triaged", "planned", "proposal", "live-check"] }).id,
      issues.add(doc, "from a worker", { labels: ["followup", "ui"] }).id,
      issues.add(doc, "from deps", { source: "deps" }).id,
    ])!.value;
    const [a, b, c] = ids.map((id) => item(r, id));
    expect(a.fm).toMatchObject({ source: "chris", areas: ["audio"], priority: "medium" });
    expect(issues.status(a)).toBe("open");
    for (const i of [a, b, c]) for (const k of ["labels", "waiting_on", "id", "was"]) expect(k in i.fm).toBe(false);
    expect(b.fm).toMatchObject({ source: "worker", areas: ["ui"] });
    expect(c.fm.source).toBe("deps");
    expect(store.isSorted(store.readList(r)!, a)).toBe(false);
  });

  test("editing a parent's priority sets it on its open children, not its done ones, in one commit", () => {
    const r = repo();
    const [big, p1, p2, p3] = store.writeList(r, "x", (doc) => {
      const issue = issues.add(doc, "big", { priority: "high" });
      const kids = [addPart(doc, issue, { title: "p1", spec: "a" }), addPart(doc, issue, { title: "p2", spec: "b" }), addPart(doc, issue, { title: "p3", spec: "c" })];
      issues.setStatus(kids[2], "done");
      return [issue.id, ...kids.map((k) => k.id)];
    })!.value;
    const before = commits();
    verbs.edit(r, big, { priority: "critical" });
    expect(commits()).toBe(before + 1);
    expect([big, p1, p2, p3].map((id) => item(r, id).fm.priority)).toEqual(["critical", "critical", "critical", "high"]);
    expect(() => verbs.edit(r, big, { priority: "urgent" })).toThrow("low, medium, high, critical");
  });

  test("a child takes a number of its own, the issue's priority and its after, in one commit", () => {
    const r = repo();
    const before = commits();
    const [big, one, two, other] = store.writeList(r, "x", (doc) => {
      const issue = issues.add(doc, "big", { priority: "high" });
      const g1 = addPart(doc, issue, { title: "part one", spec: "Do one." });
      const g2 = addPart(doc, issue, { title: "part two", spec: "Do two.", after: [`issue.${g1.id}`] });
      return [issue.id, g1.id, g2.id, issues.add(doc, "another issue").id];
    })!.value;
    expect(commits()).toBe(before + 1);
    expect([one, two, other]).toEqual([big + 1, big + 2, big + 3]);
    const doc = store.readList(r)!;
    expect(issues.partsOf(doc, issues.find(doc, big)!).map((p) => String(p.id))).toEqual([String(one), String(two)]);
    expect(item(r, one).fm).toMatchObject({ priority: "high", from: `issue.${big}` });
    expect(item(r, two).fm.after).toEqual([`issue.${one}`]);
    expect(item(r, two).spec).toBe("Do two.");
    expect(store.isBuildable(doc, item(r, one))).toBe(true);
    expect(store.isSorted(doc, item(r, big))).toBe(true);
    expect(issues.afterOf(item(r, two))).toEqual([`issue.${one}`]);
  });
});

describe("an issue's children", () => {
  test("are the issues whose from names it; each finds the issue as its parent; a child round-trips and lints clean", () => {
    const doc = issues.blank("r", "project.1");
    const top = issues.add(doc, "big");
    const child = issues.add(doc, "[Big] new child", { spec: "x", from: `issue.${top.id}`, after: [`issue.${top.id}`] });
    issues.add(doc, "other");
    expect(issues.partsOf(doc, top)).toEqual([child]);
    expect([issues.parentOf(doc, child), issues.parentOf(doc, top)]).toEqual([top, undefined]);
    expect(issues.partsOf(doc, child)).toEqual([]);
    expect(issues.parseItem(child.id, issues.renderItem(child)).fm).toMatchObject({ from: `issue.${top.id}`, after: [`issue.${top.id}`] });
    expect(issues.lint(doc)).toEqual([]);
    child.fm.from = "r-1.1";
    expect(issues.lint(doc).map((f) => f.problem)).toEqual(["from: r-1.1 is not issue.<n>"]);
  });
});

describe("a child's source", () => {
  test("a child stores agent, or the parent's source when it is not chris; a child with none stored reads agent", () => {
    const doc = issues.blank("r", "project.1");
    const a = issues.add(doc, "from chris");
    const b = issues.add(doc, "from worker", { source: "worker" });
    expect(addPart(doc, a, { title: "p", spec: "x" }).fm.source).toBe("agent");
    expect(addPart(doc, b, { title: "p", spec: "x" }).fm.source).toBe("worker");
    const old = addPart(doc, a, { title: "old", spec: "x" });
    delete old.fm.source;
    expect(issues.sourceOf(old)).toBe("agent");
    expect(issues.sourceOf(a)).toBe("chris");
  });
});

describe("the number of an issue", () => {
  const filed = (r: store.Place) => store.writeList(r, "x", (doc) => issues.add(doc, "one").id)!.value;

  test("one counter runs across projects, above the highest issue in the items repo", () => {
    const [a, b] = [repo(), repo()];
    const first = filed(a), second = filed(b);
    expect(second).toBe(first + 1);
    expect(store.readList(a)!.items.map((i) => i.id)).toContain(first);
    expect(store.readList(a)!.items.map((i) => i.id)).not.toContain(second);
    expect(store.readList(b)!.floor).toBe(second);
  });

  test("a push refused five times leaves a gap, and the next number is above it", () => {
    const r = repo();
    const first = filed(r);
    const origin = join(base, "items.git");
    const hook = join(origin, "hooks", "pre-receive");
    writeFileSync(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    try { expect(() => store.writeList(r, "x", (doc) => issues.add(doc, "lost").id)).toThrow("push refused"); } finally { rmSync(hook); }
    const next = filed(r);
    expect(next).toBe(first + 6);
    expect(store.readList(r)!.items.map((i) => i.id)).toEqual([first, next]);
  });

  test("the counter never falls below the highest issue on origin/main", () => {
    const r = repo();
    const high = filed(r) + 1000;
    sh(base, "git", "--git-dir", join(base, "items.git"), "update-ref", "-d", "refs/none");
    const w = mkdtempSync(join(tmpdir(), "aleph-other-"));
    sh(w, "git", "clone", "-q", join(base, "items.git"), "w");
    mkdirSync(join(w, "w", "issues", String(high)), { recursive: true });
    writeFileSync(join(w, "w", "issues", String(high), "issue.md"), "---\nproject: project.99\ntitle: far\n---\n");
    sh(join(w, "w"), "git", "add", ".");
    sh(join(w, "w"), "git", "commit", "-qm", "far");
    sh(join(w, "w"), "git", "push", "-q", "origin", "HEAD:main");
    rmSync(w, { recursive: true, force: true });
    expect(filed(r)).toBe(high + 1);
  });
});

describe("every close is logged", () => {
  const closedSince = (before: number) => readEvents().slice(before).filter((e) => e.action === "done" || e.action === "dropped").map((e) => [e.subject, e.action, e.object, e.detail]);

  test("store.close logs done or dropped with the reason, by a rule unless the caller says", () => {
    const r = repo([{ title: "a" }, { title: "b" }]), before = readEvents().length;
    expect(store.close(r, r.ids[0], "shipped")).toBeNull();
    expect(store.close(r, r.ids[1], "a dupe", "dropped", "director")).toBeNull();
    expect(closedSince(before)).toEqual([["rule", "done", `issue.${r.ids[0]}`, "shipped"], ["director", "dropped", `issue.${r.ids[1]}`, "a dupe"]]);
    expect(item(r, r.ids[0]).fm).toMatchObject({ closed_as: "done", closed_why: "shipped" });
    expect(item(r, r.ids[0]).notes).toEqual([]);
  });

  test("closeAndFile logs the close, and a note-only write logs none", () => {
    const r = repo([{ title: "a" }]), before = readEvents().length;
    store.note(r, r.ids[0], "a remark");
    expect(closedSince(before)).toEqual([]);
    store.closeAndFile(r, "landed", r.ids[0], "job landed", [], "rule", quiet);
    expect(closedSince(before)).toEqual([["rule", "done", `issue.${r.ids[0]}`, "job landed"]]);
  });

  test("a close through sort, edit --status and the close verb logs, and a reopen does not", () => {
    const r = repo([{ title: "a" }, { title: "b" }, { title: "c" }]), before = readEvents().length;
    const [x, y, z] = r.ids;
    store.sort(r, x, "intake", (i) => issues.setStatus(i, "done", undefined, "on main"));
    verbs.edit(r, y, { status: "dropped" });
    verbs.close(r, z, "done", "fine");
    expect(closedSince(before).map((e) => e.slice(1, 3))).toEqual([["done", `issue.${x}`], ["dropped", `issue.${y}`], ["done", `issue.${z}`]]);
    const after = readEvents().length;
    verbs.edit(r, x, { status: "open" });
    expect(closedSince(after)).toEqual([]);
  });
});

describe("the fetch of origin/main", () => {
  const origin = () => join(base, "items.git");
  const clone = () => join(base, "items");
  const tip = (dir: string, rev: string) => sh(dir, "git", "rev-parse", rev);
  /** A new commit on the remote's main, made apart from the store clone. */
  function push(msg: string): void {
    const w = mkdtempSync(join(tmpdir(), "aleph-other-"));
    sh(w, "git", "clone", "-q", origin(), "w");
    sh(join(w, "w"), "git", "commit", "-q", "--allow-empty", "-m", msg);
    sh(join(w, "w"), "git", "push", "-q", "origin", "HEAD:main");
    rmSync(w, { recursive: true, force: true });
  }
  const narrow = () => sh(clone(), "git", "config", "remote.origin.fetch", "+refs/heads/none:refs/remotes/origin/none");
  const widen = () => sh(clone(), "git", "config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*");
  const saved = lockRetry.pause;
  afterEach(() => { lockRetry.pause = saved; widen(); });

  test("a clone whose fetch refspec misses main still gets origin/main on a read, a write and fetchStore", async () => {
    narrow();
    push("one");
    store.readList({ key: "fa" });
    expect(tip(clone(), "origin/main")).toBe(tip(origin(), "main"));
    push("two");
    const two = tip(origin(), "main");
    store.writeList({ key: "fa" }, "w", () => true, true);
    expect(tip(clone(), "origin/main")).toBe(two);
    push("three");
    expect(await store.fetchStore()).toBeNull();
    expect(tip(clone(), "origin/main")).toBe(tip(origin(), "main"));
  });

  for (const via of ["fetchStore", "readList"]) {
    test(`${via} waits out a ref lock that goes away`, async () => {
      narrow();
      push(via);
      const lock = join(clone(), ".git/refs/remotes/origin/main.lock");
      writeFileSync(lock, "");
      let pauses = 0;
      lockRetry.pause = () => { pauses++; rmSync(lock); };
      if (via === "fetchStore") expect(await store.fetchStore()).toBeNull();
      else store.readList({ key: "fa" });
      expect(pauses).toBe(1);
      expect(tip(clone(), "origin/main")).toBe(tip(origin(), "main"));
    });
  }
});
