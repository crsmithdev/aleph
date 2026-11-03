// Archived goal tests from jobs/cli.item.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { aleph, base, file, itemsRemote, remote, repo, sh, state, setup, teardown } from "../../jobs/cli.helpers";
import { issueAdd, issueShow, job } from "../../jobs/inproc";

// The wiring of `aleph land` on an item, and the jobs list, whose reading of fate from git is in jobs/cli.ts itself.
// The other cases run in-process in jobs/lib/transitions.item.test.ts.
beforeAll(setup);
afterAll(teardown);

const add = async (key: string, title: string) => (await issueAdd(key, title)).json.added as number;
const show = async (key: string, id: number) => { const i = (await issueShow(key, id)).json; return { status: i.status, notes: i.notes as string[] }; };

describe("a job tied to a to-do item", () => {
  test("land marks the item done, naming the job and the landing commit", async () => {
    const landId = await add("demo", "ship the widget");
    const j = await job("demo", "widget", "Goal: widget\nACTION: commit widget.txt\n", { on: String(landId) });
    expect(state(j.json.run)).toMatchObject({ condition: "passed", on: `demo-${landId}` });
    const r = await aleph(["land", "widget"]);
    const s = state(r.json.run);
    expect(s).toMatchObject({ kind: "land", condition: "landed", on: `demo-${landId}` });
    expect(s.reason).toBeUndefined();
    const item = await show("demo", landId);
    expect(item.status).toBe("done");
    expect(item.notes.at(-1)).toContain("job widget landed");
    expect(file(r.json.run, "land.log")).toContain(`## todo ${landId} done`);
    // The item closes in the work store; the landing commit holds only the work.
    expect(sh(base, "git", "--git-dir", remote, "diff", "--name-only", `${s.commit}~1`, s.commit)).toBe("widget.txt");
    expect(sh(base, "git", "--git-dir", itemsRemote, "log", "-1", "--format=%s", "main")).toBe("demo: todo: job widget landed");
    expect(sh(repo, "git", "status", "--porcelain", "--untracked-files=no")).toBe("");
  });
});

describe("fate from git", () => {
});
