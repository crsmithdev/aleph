import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLI, base, fakeLog, other, remote, section, sh, state, setup, teardown } from "./cli.helpers";
import { actionJob as job, cli, drop, issueAdd, issueClose, job as startJob, land, status as statusOf } from "./flow.testkit.ts";
import { readRepos, writeRepos } from "../tests/projects.ts";

beforeAll(setup);
afterAll(teardown);

// Every case calls `aleph` in-process (flow.testkit.ts).
describe("milestone 2", () => {
  const remoteGit = (...a: string[]) => sh(base, "git", "--git-dir", remote, ...a);
  const status = async (item: string) => (await statusOf(item)).json;
  function pushFromOther(message: string, f: string): void {
    sh(other, "git", "pull", "-q", "--rebase", "origin", "main");
    writeFileSync(join(other, f), `${Math.random()}\n`);
    sh(other, "git", "add", f);
    sh(other, "git", "commit", "-qm", message);
    sh(other, "git", "push", "-q", "origin", "main");
  }

  test("three ready branches land one at a time, in the order their lands were made", async () => {
    for (const n of ["qa", "qb", "qc"]) await job(n, `commit pair/${n}.txt`);
    const lands = await Promise.all(["qa", "qb", "qc"].map((n) => land(n)));
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
    const l = await land("crashed");
    expect(state(l.json.run)).toMatchObject({ state: "landed", commit: pushed });
    expect(remoteGit("rev-parse", "main")).toBe(pushed);
    expect(section(l.json.run, "land")).toContain(`## already on main as ${pushed}`);
  });

  test("aleph status with no item gives the stage of each open item in the recent repos", async () => {
    const id = (await issueAdd("fac", "listed by status")).json.added;
    const r = await cli(["status", "--json"]);
    expect(r.code).toBe(0);
    expect(r.json.find((s: any) => s.id === `fac-${id}`)).toMatchObject({ stage: "new" });
    const text = (await cli(["status"])).stdout;
    expect(text.split("\n")).toContain("fac");
    expect(text).toContain(`\n  i-${String(id).padStart(5, "0")} new: intake`);
    await issueClose("fac", id, "done");
    expect((await cli(["status", "--json"])).json.find((s: any) => s.id === `fac-${id}`)).toBeUndefined();
  }, 30_000);

  test("aleph status shows each issue ID as its project's code and five digits", async () => {
    const id = (await issueAdd("fac", "shown with its code")).json.added;
    const held = (await issueAdd("fac", "held by the one shown", { after: [`issue.${id}`] })).json.added;
    const repos = readRepos(join(base, "items"));
    writeRepos({ ...repos, fac: { ...repos.fac, code: "f" } }, join(base, "items"));
    try {
      const shown = (n: number) => `f-${String(n).padStart(5, "0")}`;
      const recent = (await cli(["status"])).stdout, one = (await cli(["status", `fac-${id}`])).stdout;
      expect(recent).toContain(`\n  ${shown(id)} new: intake`);
      expect(recent).toContain(`\n  ${shown(held)} held: ${shown(held)} waits for ${shown(id)}`);
      expect(one.startsWith(`${shown(id)} new`)).toBe(true);
      for (const t of [recent, one]) for (const n of [id, held]) { expect(t).not.toContain(`fac-${n}`); expect(t).not.toMatch(new RegExp(`\\bf${n}\\b`)); }
      expect((await cli(["status", `fac-${id}`, "--json"])).json.id).toBe(`fac-${id}`);
    } finally { writeRepos(repos, join(base, "items")); await issueClose("fac", held, "done"); await issueClose("fac", id, "done"); }
  }, 30_000);

  test("aleph status reads a short ID like the full one", async () => {
    const id = (await issueAdd("fac", "read by its short ID")).json.added;
    const repos = readRepos(join(base, "items"));
    writeRepos({ ...repos, fac: { ...repos.fac, code: "f" } }, join(base, "items"));
    try {
      const full = await cli(["status", `fac-${id}`, "--json"]), short = await cli(["status", `f${id}`, "--json"]);
      expect(short.code).toBe(0);
      expect(short.json.stage).toBe(full.json.stage);
      expect(short.json.id).toBe(`fac-${id}`);
    } finally { writeRepos(repos, join(base, "items")); await issueClose("fac", id, "done"); }
  }, 30_000);

  test("aleph status inside a factory worker says what it says outside", async () => {
    const done = (await issueAdd("fac", "landed one")).json.added;
    pushFromOther(`landed\n\nIssue: issue.${done}`, "landed-one.txt");
    await issueClose("fac", done, "done");
    const open = (await issueAdd("fac", "open one")).json.added;
    const items = [`fac-${done}`, `fac-${open}`];
    const r = await startJob("fac", "finside", `Goal: inside\nACTION: status ${CLI} ${items.join(" ")}\n`);
    expect(state(r.json.run).state).toBe("passed");
    const inside = readFileSync(join(fakeLog, "status-inside"), "utf8").trim().split(/\n(?=\{)/).map((t) => JSON.parse(t));
    const outside = await Promise.all(items.map(status));
    expect(inside).toEqual(outside);
    expect(outside.map((s: any) => s.stage)).toEqual(["done", "new"]);
    await drop("finside");
  }, 30_000);
});

