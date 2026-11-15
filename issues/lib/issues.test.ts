import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as issues from "./todo.ts";
import * as store from "./store.ts";
import * as issueOps from "./issues.ts";
import { Refusal } from "../../lib/refusal.ts";
import { askOf, setAsk, refIn } from "../../jobs/lib/asks/ask.ts";
import { readEvents } from "../../lib/layout.ts";
import { storeRepos } from "../../tests/git-fixture.ts";

const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
let base: string;

let n = 0;
/** A project and the numbers of the issues it starts with, `ids`: one counter runs across projects, so a test reads its numbers here. */
type Repo = store.Place & { ids: number[] };
function repo(items: { title: string; labels?: string[] }[] = []): Repo {
  const r: Repo = { key: `is${++n}`, ids: [] };
  store.writeList(r, "start", (doc) => {
    r.ids = items.map((i) => issues.add(doc, i.title, { labels: i.labels, ...(i.labels?.includes("goal") ? { spec: "Do it." } : {}) }).id);
    return true;
  }, true);
  return r;
}
const item = (r: store.Place, id: number) => issues.find(store.readList(r)!, id)!;
/** Effects that start nothing. */
const quiet: store.Effects = { after: () => {} };
const refusal = (f: () => unknown) => {
  try { f(); } catch (e) { expect(e).toBeInstanceOf(Refusal); return (e as Error).message; }
  throw new Error("did not refuse");
};

const saved = process.env.ALEPH_ITEMS;
beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-issues-"));
  storeRepos(base);
  Object.assign(process.env, gitEnv, { ALEPH_ITEMS: join(base, "items") });
});
afterAll(() => {
  if (saved === undefined) delete process.env.ALEPH_ITEMS; else process.env.ALEPH_ITEMS = saved;
  rmSync(base, { recursive: true, force: true });
});

describe("issue verbs without argv", () => {
  test("add, note and done", async () => {
    const r = repo();
    const a = await issueOps.add(r, "first thing", { labels: ["x"] }, quiet);
    const id = a.result.added;
    expect(a.result.title).toBe("first thing");
    const n = issueOps.note(r, id, "a remark");
    expect(n.result.note).toContain("a remark");
    expect(item(r, id).notes.length).toBe(1);
    const d = issueOps.close(r, id, "done", "shipped");
    expect(d.result.status).toBe("done");
    expect(issues.status(item(r, id))).toBe("done");
  });

  test("an unknown issue number is refused", () => {
    const r = repo([{ title: "a" }]);
    expect(refusal(() => issueOps.note(r, 9, "hi"))).toContain("has no issue 9");
    expect(refusal(() => issueOps.show(r, 9))).toContain("has no issue 9");
    expect(refusal(() => issueOps.close(r, NaN, "done"))).toContain("by its number");
  });

  test("drop needs a reason", () => {
    const r = repo([{ title: "a" }]);
    expect(refusal(() => issueOps.close(r, r.ids[0], "drop", " "))).toContain("why it is dropped");
    expect(issues.status(item(r, r.ids[0]))).toBe("open");
  });

  test("done and drop set a status and keep the number; list hides them and --status picks each", () => {
    const r = repo([{ title: "a" }, { title: "ships" }, { title: "abandoned" }]);
    const [a, ships, gone] = r.ids;
    issueOps.close(r, ships, "done", "landed in abc123");
    expect(issueOps.close(r, gone, "drop", "superseded by 2").result.status).toBe("dropped");
    expect(store.readList(r)!.items.map((i) => [i.id, i.title])).toEqual([[a, "a"], [ships, "ships"], [gone, "abandoned"]]);
    expect(item(r, ships).notes.at(-1)).toContain("landed in abc123");
    expect(item(r, ships).fm).toMatchObject({ closed_as: "done", closed_why: "landed in abc123" });
    const ids = (status?: string) => issueOps.list(r, { status }).map((i) => i.id);
    expect(ids()).toEqual([a]);
    expect(ids("done")).toEqual([ships]);
    expect(ids("dropped")).toEqual([gone]);
  });

  test("edit parks with the reason as a note and no closed_as, unparks, and add can file parked", async () => {
    const r = repo([{ title: "a" }]);
    const [id] = r.ids;
    expect(issueOps.edit(r, id, { status: "parked" }, "needs more investigation").result.status).toBe("parked");
    expect(item(r, id).fm.closed_as).toBeUndefined();
    expect(item(r, id).notes.at(-1)).toContain("needs more investigation");
    expect(issueOps.edit(r, id, { status: "open" }).result.status).toBe("open");
    const a = await issueOps.add(r, "filed parked", { status: "parked" }, quiet);
    expect(issues.status(item(r, a.result.added))).toBe("parked");
  });

  test("the filed event names who filed: Chris, a Claude Code session or a factory agent", async () => {
    const saved = { agent: process.env.ALEPH_AGENT, code: process.env.CLAUDECODE };
    const by = async (env: Record<string, string | undefined>) => {
      const r = repo();
      delete process.env.ALEPH_AGENT;
      delete process.env.CLAUDECODE;
      Object.assign(process.env, env);
      const a = await issueOps.add(r, "who filed", {}, quiet);
      return readEvents(0).find((e) => e.action === "filed" && e.object === `issue.${a.result.added}`)?.subject;
    };
    try {
      expect(await by({})).toBe("human");
      expect(await by({ CLAUDECODE: "1" })).toBe("claude");
      expect(await by({ CLAUDECODE: "1", ALEPH_AGENT: "1" })).toBe("worker");
    } finally {
      for (const [k, v] of [["ALEPH_AGENT", saved.agent], ["CLAUDECODE", saved.code]] as const) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  test("edit with nothing to change is refused", () => {
    const r = repo([{ title: "a" }]);
    expect(refusal(() => issueOps.edit(r, r.ids[0], {}))).toContain("give --title, --request, --spec, --priority, --labels, --after");
  });

  // Breaks if --refs is not stored, is not replaced, or "none" does not clear it.
  test("add --refs stores plain references, edit --refs replaces them, and none clears them", async () => {
    const r = repo([{ title: "one" }, { title: "two" }, { title: "three" }]);
    const [a, b, c] = r.ids;
    const added = await issueOps.add(r, "with refs", { refs: [`issue.${a}`, `issue.${b}`] }, quiet);
    const n = added.result.added;
    expect(store.refsOf(item(r, n))).toEqual([`issue.${a}`, `issue.${b}`]);
    issueOps.edit(r, n, { refs: [`issue.${c}`] });
    expect(store.refsOf(item(r, n))).toEqual([`issue.${c}`]);
    issueOps.edit(r, n, { refs: ["none"] });
    expect(store.refsOf(item(r, n))).toEqual([]);
  });

  // Breaks if a bad ref is written: the form, a missing issue, or the issue itself.
  test("--refs refuses a malformed key, an issue that does not exist and the issue itself", async () => {
    const r = repo([{ title: "one" }]);
    const [a] = r.ids;
    expect(await issueOps.add(r, "bad", { refs: ["nope"] }, quiet).then(() => "", (e) => e.message)).toContain("--refs takes issue keys");
    expect(refusal(() => issueOps.edit(r, a, { refs: ["issue.999999"] }))).toContain("--refs issue.999999 names no issue");
    expect(refusal(() => issueOps.edit(r, a, { refs: [`issue.${a}`] }))).toContain("cannot reference itself");
  });

  // Breaks if refs is read as a wait: an issue with a spec and a ref to an open issue must stay buildable.
  test("a ref to an open issue holds nothing, and the referenced issue lists the referrer across projects", () => {
    const r = repo([{ title: "target" }]), o = repo();
    const [target] = r.ids;
    const n = store.writeList(o, "ref", (doc) => { const i = issues.add(doc, "refers", { spec: "Do it." }); i.fm.refs = [`issue.${target}`]; return i.id; }, true)!.value;
    const doc = store.readList(o)!;
    expect(store.isBuildable(doc, issues.find(doc, n)!)).toBe(true);
    expect(store.afterOf(issues.find(doc, n)!)).toEqual([]);
    expect(store.referrersOf([...store.readList(r)!.items, ...doc.items], item(r, target)).map((i) => i.id)).toEqual([n]);
  });

  test("edit reads the issue for the group prefix: a child with a from link takes it, a top-level issue refuses it", () => {
    const r = repo([{ title: "parent" }]);
    const [parent] = r.ids;
    const child = store.writeList(r, "split", (doc) => issues.add(doc, "[Group] Old name", { spec: "x", from: `issue.${parent}` }).id)!.value;
    const title = "[Group] Do the thing: now";
    issueOps.edit(r, child, { title });
    expect(item(r, child).title).toBe(title);
    expect(refusal(() => issueOps.edit(r, parent, { title }))).toContain("': ' prefix");
    expect(item(r, parent).title).toBe("parent");
  });

  test("decide needs an issue with an Ask, clears it and makes no issue", () => {
    const r = repo([{ title: "a" }, { title: "b" }]);
    const [one, two] = r.ids;
    for (const n of [one, two]) store.writeList(r, "ask", (doc) => { setAsk(refIn(doc.repo!, issues.find(doc, n)!), { kind: "input", reason: "question", question: "Q?", options: [], why: [] }); return true; });
    const three = store.writeList(r, "ask", (doc) => { const i = issues.add(doc, "c"); setAsk(refIn(doc.repo!, i), { kind: "input", reason: "question", question: "Q?", options: [], why: [] }); return i.id; })!.value;
    expect(refusal(() => issueOps.decide(r, 99999, "yes"))).toContain("has no issue");
    issueOps.decide(r, two, "yes");
    expect(askOf(`${r.key}-${two}`)).toBeNull();
    issueOps.decide(r, one, "yes");
    expect(askOf(`${r.key}-${one}`)).toBeNull();
    expect(item(r, one).fm.ask).toBeUndefined();
    expect(item(r, one).notes.at(-1)).toContain("yes");
    const plain = store.writeList(r, "x", (doc) => issues.add(doc, "plain").id)!.value;
    expect(refusal(() => issueOps.decide(r, plain, "yes"))).toContain("not waiting for a decision");
    issueOps.decide(r, three, "wait");
    expect(askOf(`${r.key}-${three}`)).toBeNull();
  });

});
