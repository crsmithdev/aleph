import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as issues from "./todo.ts";
import * as store from "./store.ts";
import * as issueOps from "./issues.ts";
import { Refusal } from "../../lib/refusal.ts";
import { askOf, setAsk, refIn } from "../../jobs/lib/asks/ask.ts";
import { storeRepos } from "../../tests/git-fixture.ts";

const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
let base: string;

let n = 0;
function repo(items: { title: string; labels?: string[] }[] = []): store.Place {
  const r = { key: `is${++n}` };
  store.writeList(r, "start", (doc) => {
    for (const i of items) { issues.add(doc, i.title, { labels: i.labels, ...(i.labels?.includes("goal") ? { spec: "Do it." } : {}) }); }
    return true;
  }, true);
  return r;
}
const item = (r: store.Place, id: number) => issues.find(store.readList(r)!, id)!;
const refusal = (f: () => unknown) => {
  try { f(); } catch (e) { expect(e).toBeInstanceOf(Refusal); return (e as Error).message; }
  throw new Error("did not refuse");
};

const saved = process.env.ALEPH_ISSUES;
beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-issues-"));
  storeRepos(base);
  Object.assign(process.env, gitEnv, { ALEPH_ISSUES: join(base, "items") });
});
afterAll(() => {
  if (saved === undefined) delete process.env.ALEPH_ISSUES; else process.env.ALEPH_ISSUES = saved;
  rmSync(base, { recursive: true, force: true });
});

describe("issue verbs without argv", () => {
  test("add, note and done", async () => {
    const r = repo();
    const a = await issueOps.add(r, "first thing", { labels: ["x"] });
    expect(a.result.added).toBe(1);
    expect(a.result.title).toBe("first thing");
    const n = issueOps.note(r, 1, "a remark");
    expect(n.result.note).toContain("a remark");
    expect(item(r, 1).notes.length).toBe(1);
    const d = issueOps.close(r, 1, "done", "shipped");
    expect(d.result.status).toBe("done");
    expect(issues.status(item(r, 1))).toBe("done");
  });

  test("an unknown issue number is refused", () => {
    const r = repo([{ title: "a" }]);
    expect(refusal(() => issueOps.note(r, 9, "hi"))).toContain("has no issue 9");
    expect(refusal(() => issueOps.show(r, 9))).toContain("has no issue 9");
    expect(refusal(() => issueOps.close(r, NaN, "done"))).toContain("by its number");
  });

  test("drop needs a reason", () => {
    const r = repo([{ title: "a" }]);
    expect(refusal(() => issueOps.close(r, 1, "drop", " "))).toContain("why it is dropped");
    expect(issues.status(item(r, 1))).toBe("open");
  });

  test("done and drop set a status and keep the number; list hides them and --status picks each", () => {
    const r = repo([{ title: "a" }, { title: "ships" }, { title: "abandoned" }]);
    issueOps.close(r, 2, "done", "landed in abc123");
    expect(issueOps.close(r, 3, "drop", "superseded by 2").result.status).toBe("dropped");
    expect(store.readList(r)!.items.map((i) => [i.id, i.title])).toEqual([[1, "a"], [2, "ships"], [3, "abandoned"]]);
    expect(item(r, 2).notes.at(-1)).toContain("landed in abc123");
    const ids = (status?: string) => issueOps.list(r, { status }).map((i) => i.id);
    expect(ids()).toEqual([1]);
    expect(ids("done")).toEqual([2]);
    expect(ids("dropped")).toEqual([3]);
  });

  test("edit parks with the reason as a note and no closed_as, unparks, and add can file parked", async () => {
    const r = repo([{ title: "a" }]);
    expect(issueOps.edit(r, 1, { status: "parked" }, "needs more investigation").result.status).toBe("parked");
    expect(item(r, 1).fm.closed_as).toBeUndefined();
    expect(item(r, 1).notes.at(-1)).toContain("needs more investigation");
    expect(issueOps.edit(r, 1, { status: "open" }).result.status).toBe("open");
    const a = await issueOps.add(r, "filed parked", { status: "parked" });
    expect(issues.status(item(r, a.result.added))).toBe("parked");
  });

  test("edit with nothing to change is refused", () => {
    const r = repo([{ title: "a" }]);
    expect(refusal(() => issueOps.edit(r, 1, {}))).toContain("give --title, --request, --spec, --priority, --labels, --after");
  });

  test("edit reads the issue for the group prefix: a child with a from link takes it, a top-level issue refuses it", () => {
    const r = repo([{ title: "parent" }]);
    const child = store.writeList(r, "split", (doc) => issues.add(doc, "[Group] Old name", { spec: "x", from: `${r.key}-1` }).id)!.value;
    const title = "[Group] Do the thing: now";
    issueOps.edit(r, child, { title });
    expect(item(r, child).title).toBe(title);
    expect(refusal(() => issueOps.edit(r, 1, { title }))).toContain("': ' prefix");
    expect(item(r, 1).title).toBe("parent");
  });

  test("decide needs an issue with an Ask, clears it and makes no issue", () => {
    const r = repo([{ title: "a" }, { title: "b" }]);
    for (const n of [1, 2]) store.writeList(r, "ask", (doc) => { setAsk(refIn(doc.repo!, issues.find(doc, n)!), { kind: "input", reason: "question", question: "Q?", options: [], why: [] }); return true; });
    store.writeList(r, "ask", (doc) => { const i = issues.add(doc, "c"); setAsk(refIn(doc.repo!, i), { kind: "input", reason: "question", question: "Q?", options: [], why: [] }); return true; });
    expect(refusal(() => issueOps.decide(r, 99, "yes"))).toContain("has no issue");
    issueOps.decide(r, 2, "yes");
    expect(askOf(`${r.key}-2`)).toBeNull();
    issueOps.decide(r, 1, "yes");
    expect(askOf(`${r.key}-1`)).toBeNull();
    expect(item(r, 1).fm.ask).toBeUndefined();
    expect(item(r, 1).notes.at(-1)).toContain("yes");
    store.writeList(r, "x", (doc) => { issues.add(doc, "plain"); return true; });
    expect(refusal(() => issueOps.decide(r, 4, "yes"))).toContain("not waiting for a decision");
    issueOps.decide(r, 3, "wait");
    expect(askOf(`${r.key}-3`)).toBeNull();
  });

});
