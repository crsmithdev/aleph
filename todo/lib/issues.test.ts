import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as todos from "./todo.ts";
import * as store from "./store.ts";
import * as issues from "./issues.ts";
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
    for (const i of items) todos.add(doc, i.title, { labels: i.labels });
    return true;
  }, true);
  return r;
}
const item = (r: store.Place, id: number) => todos.find(store.readList(r)!, id)!;
const refusal = (f: () => unknown) => {
  try { f(); } catch (e) { expect(e).toBeInstanceOf(Refusal); return (e as Error).message; }
  throw new Error("did not refuse");
};

const saved = process.env.ALEPH_ITEMS;
beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-issues-"));
  sh(base, "git", "init", "-q", "--bare", "-b", "main", join(base, "items.git"));
  sh(base, "git", "clone", "-q", join(base, "items.git"), join(base, "items"));
  sh(join(base, "items"), "git", "commit", "-q", "--allow-empty", "-m", "start");
  sh(join(base, "items"), "git", "push", "-q", "origin", "main");
  Object.assign(process.env, gitEnv, { ALEPH_ITEMS: join(base, "items") });
});
afterAll(() => {
  if (saved === undefined) delete process.env.ALEPH_ITEMS; else process.env.ALEPH_ITEMS = saved;
  rmSync(base, { recursive: true, force: true });
});

describe("issue verbs without argv", () => {
  test("add, note and done", async () => {
    const r = repo();
    const a = await issues.add(r, "first thing", { labels: ["x"] });
    expect(a.result.added).toBe(1);
    expect(a.result.title).toBe("first thing");
    const n = issues.note(r, 1, "a remark");
    expect(n.result.note).toContain("a remark");
    expect(item(r, 1).notes.length).toBe(1);
    const d = issues.close(r, 1, "done", "shipped");
    expect(d.result.status).toBe("done");
    expect(todos.status(item(r, 1))).toBe("done");
  });

  test("an unknown issue number is refused", () => {
    const r = repo([{ title: "a" }]);
    expect(refusal(() => issues.note(r, 9, "hi"))).toContain("has no issue 9");
    expect(refusal(() => issues.show(r, 9))).toContain("has no issue 9");
    expect(refusal(() => issues.close(r, NaN, "done"))).toContain("by its number");
  });

  test("drop needs a reason", () => {
    const r = repo([{ title: "a" }]);
    expect(refusal(() => issues.close(r, 1, "drop", " "))).toContain("why it is dropped");
    expect(todos.status(item(r, 1))).toBe("open");
  });

  test("decide needs a needs-chris issue", () => {
    const r = repo([{ title: "a" }, { title: "b", labels: [store.NEEDS_CHRIS] }]);
    expect(refusal(() => issues.decide(r, 1, "yes"))).toContain("not waiting for a decision");
    const d = issues.decide(r, 2, "yes");
    expect(store.hasLabel(d.item, store.GOAL)).toBe(true);
    expect(store.needsChris(item(r, 2))).toBe(false);
  });

  test("edit needs a field, a good --due and a good --waiting-on", () => {
    const r = repo([{ title: "a" }]);
    expect(refusal(() => issues.edit(r, 1, {}))).toContain("give --title");
    expect(refusal(() => issues.edit(r, 1, { due: "tomorrow" }))).toContain("--due takes");
    expect(refusal(() => issues.edit(r, 1, { waitingOn: "soon" }))).toContain("--waiting-on takes");
    expect(item(r, 1).fm.due).toBeUndefined();
  });
});
