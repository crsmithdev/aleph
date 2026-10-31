import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLI, aleph, base, fakeLog, file, fjobFor, job, other, remote, sh, specFile, state, setup, teardown } from "./cli.helpers";

beforeAll(setup);
afterAll(teardown);

describe("milestone 2", () => {
  const remoteGit = (...a: string[]) => sh(base, "git", "--git-dir", remote, ...a);
  const status = async (item: string) => (await aleph(["status", item, "--json"])).json;
  function pushFromOther(message: string, f: string): void {
    sh(other, "git", "pull", "-q", "--rebase", "origin", "main");
    writeFileSync(join(other, f), `${Math.random()}\n`);
    sh(other, "git", "add", f);
    sh(other, "git", "commit", "-qm", message);
    sh(other, "git", "push", "-q", "origin", "main");
  }

  test("three ready branches land one at a time, in the order their lands were made", async () => {
    for (const n of ["qa", "qb", "qc"]) await job(n, `commit pair/${n}.txt`);
    const lands = await Promise.all(["qa", "qb", "qc"].map((n) => aleph(["land", n])));
    const order = lands.map((l) => state(l.json.run)).sort((a, b) => a.made - b.made).map((s) => s.name);
    expect(lands.map((l) => state(l.json.run).state)).toEqual(["landed", "landed", "landed"]);
    expect(remoteGit("log", "-3", "--reverse", "--format=%s", "main").split("\n")).toEqual(order.map((n) => `add pair/${n}.txt`));
    // Each is one squash commit on the one before: no merge commits.
    expect(remoteGit("rev-list", "--merges", "-3", "main")).toBe("");
  }, 60_000);

  test("a land whose push went through before it died finds its commit and does not merge again", async () => {
    const j = await job("crashed", "commit crashed.txt");
    pushFromOther(`add crashed.txt\n\nJob: ${j.json.job}`, "crashed.txt");
    const pushed = remoteGit("rev-parse", "main");
    const l = await aleph(["land", "crashed"]);
    expect(state(l.json.run)).toMatchObject({ state: "landed", commit: pushed });
    expect(remoteGit("rev-parse", "main")).toBe(pushed);
    expect(file(l.json.run, "land.log")).toContain(`## already on main as ${pushed}`);
  });

  test("an item is done while a commit on main names it in its trailers, and not once that commit is reverted", async () => {
    const id = (await aleph(["issue", "add", "fac", "derive me"])).json.added;
    expect(await status(`fac-${id}`)).toMatchObject({ stage: "new" });
    await fjobFor("fderive", "commit derive.txt", id);
    expect(await status(`fac-${id}`)).toMatchObject({ stage: "building", why: "its job is passed" });
    await aleph(["land", "fderive"]);
    const landed = remoteGit("rev-parse", "main");
    expect(await status(`fac-${id}`)).toMatchObject({ stage: "done", why: `commit ${landed.slice(0, 7)} on origin/main` });
    sh(other, "git", "pull", "-q", "--rebase", "origin", "main");
    sh(other, "git", "revert", "--no-edit", landed);
    sh(other, "git", "push", "-q", "origin", "main");
    // The store still says done, but a factory run touched the item, so only a trailer makes it done.
    expect(await status(`fac-${id}`)).toMatchObject({ stage: "new" });
  }, 30_000);

  test("only the trailer block counts; a hand-done item keeps the store's done; dropped wins", async () => {
    const id = (await aleph(["issue", "add", "fac", "named in prose"])).json.added;
    pushFromOther(`prose\n\nItem: fac-${id} is named here\n\nbut not as a trailer.`, "prose.txt");
    expect(await status(`fac-${id}`)).toMatchObject({ stage: "new" });
    pushFromOther(`real\n\nItem: fac-${id}`, "real.txt");
    expect(await status(`fac-${id}`)).toMatchObject({ stage: "done" });
    const hand = (await aleph(["issue", "add", "fac", "done by hand"])).json.added;
    await aleph(["issue", "done", "fac", String(hand)]);
    expect(await status(`fac-${hand}`)).toMatchObject({ stage: "done", why: "the store says done" });
    await aleph(["issue", "drop", "fac", String(id), "no longer wanted"]);
    expect(await status(`fac-${id}`)).toMatchObject({ stage: "dropped" });
    const stuck = (await aleph(["issue", "add", "fac", "a stuck one"])).json.added;
    await fjobFor("fstuckitem", "error", stuck);
    expect(await status(`fac-${stuck}`)).toMatchObject({ stage: "stuck" });
    const held = (await aleph(["issue", "add", "fac", "a held one"])).json.added;
    await fjobFor("fhelditem", "commit held/y.txt", held);
    expect(await status(`fac-${held}`)).toMatchObject({ stage: "awaiting" });
    for (const n of ["fstuckitem", "fhelditem"]) await aleph(["drop", n]);
    expect((await aleph(["status", "fac-999"])).stderr).toContain("fac has no issue 999");
  }, 30_000);

  test("aleph status with no item gives the stage of each open item in the recent repos", async () => {
    const id = (await aleph(["issue", "add", "fac", "listed by status"])).json.added;
    const r = await aleph(["status", "--json"]);
    expect(r.code).toBe(0);
    expect(r.json.find((s: any) => s.id === `fac-${id}`)).toMatchObject({ stage: "new" });
    const text = (await aleph(["status"])).stdout;
    expect(text.split("\n")).toContain("fac");
    expect(text).toContain(`\n  ${id} new: `);
    expect(text).not.toContain(`fac-${id}`);
    await aleph(["issue", "done", "fac", String(id)]);
    expect((await aleph(["status", "--json"])).json.find((s: any) => s.id === `fac-${id}`)).toBeUndefined();
  }, 30_000);

  test("aleph status inside the sandbox, from the bundle, says what it says outside", async () => {
    const done = (await aleph(["issue", "add", "fac", "landed one"])).json.added;
    pushFromOther(`landed\n\nItem: fac-${done}`, "landed-one.txt");
    const open = (await aleph(["issue", "add", "fac", "open one"])).json.added;
    const items = [`fac-${done}`, `fac-${open}`];
    const r = await aleph(["job", "fac", "finside", "--spec", specFile(`Goal: inside\nACTION: status ${CLI} ${items.join(" ")}\n`)]);
    expect(state(r.json.run).state).toBe("passed");
    const inside = readFileSync(join(fakeLog, "status-inside"), "utf8").trim().split(/\n(?=\{)/).map((t) => JSON.parse(t));
    const outside = await Promise.all(items.map(status));
    expect(inside).toEqual(outside);
    expect(outside.map((s: any) => s.stage)).toEqual(["done", "new"]);
    await aleph(["drop", "finside"]);
  }, 30_000);
});

