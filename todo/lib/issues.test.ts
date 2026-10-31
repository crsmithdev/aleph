import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as issues from "./todo.ts";
import * as store from "./store.ts";
import * as issueOps from "./issues.ts";
import { Refusal } from "../../jobs/lib/transitions.ts";

const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
let base: string;

function sh(cwd: string, ...args: string[]): void {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
}

let n = 0;
function repo(items: { title: string; labels?: string[] }[] = []): store.Place {
  const r = { key: `is${++n}` };
  store.writeList(r, "start", (doc) => {
    for (const i of items) issues.addLegacy(doc, i.title, { labels: i.labels });
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
  sh(base, "git", "init", "-q", "--bare", "-b", "main", join(base, "items.git"));
  sh(base, "git", "clone", "-q", join(base, "items.git"), join(base, "items"));
  sh(join(base, "items"), "git", "commit", "-q", "--allow-empty", "-m", "start");
  sh(join(base, "items"), "git", "push", "-q", "origin", "main");
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

  test("decide needs an issue with an Ask or a needs-chris label, clears it and makes no goal", () => {
    const r = repo([{ title: "a" }, { title: "b", labels: ["needs-chris"] }]);
    store.writeList(r, "ask", (doc) => { store.setAsk(issues.find(doc, 1)!, { kind: "input", reason: "question", question: "Q?", options: [], why: [] }); return true; });
    store.writeList(r, "ask", (doc) => { const i = issues.addLegacy(doc, "c"); store.setAsk(i, { kind: "input", reason: "question", question: "Q?", options: [], why: [] }); return true; });
    expect(refusal(() => issueOps.decide(r, 99, "yes"))).toContain("has no issue");
    const d = issueOps.decide(r, 2, "yes");
    expect(store.hasLabel(d.item, store.GOAL)).toBe(false);
    expect(store.needsChris(item(r, 2))).toBe(false);
    issueOps.decide(r, 1, "yes");
    expect(store.askOf(item(r, 1))).toBeNull();
    expect(item(r, 1).fm.ask).toBeUndefined();
    expect(item(r, 1).notes.at(-1)).toContain("yes");
    store.writeList(r, "x", (doc) => { issues.addLegacy(doc, "plain"); return true; });
    expect(refusal(() => issueOps.decide(r, 4, "yes"))).toContain("not waiting for a decision");
    issueOps.decide(r, 3, "wait", { waitingOn: "x-1" });
    expect(item(r, 3).fm.waiting_on).toBe("x-1");
  });

  test("edit needs a field, a good --due and a good --waiting-on", () => {
    const r = repo([{ title: "a" }]);
    expect(refusal(() => issueOps.edit(r, 1, {}))).toContain("give --title");
    expect(refusal(() => issueOps.edit(r, 1, { due: "tomorrow" }))).toContain("--due takes");
    expect(refusal(() => issueOps.edit(r, 1, { waitingOn: "soon" }))).toContain("--waiting-on takes");
    expect(item(r, 1).fm.due).toBeUndefined();
  });
});
