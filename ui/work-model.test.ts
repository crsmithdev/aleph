import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readList, writeList } from "../todo/lib/store.ts";
import { add, addGoal, find, setStatus } from "../todo/lib/todo.ts";
import { writeAsk } from "../jobs/lib/ask.ts";
import { state } from "./state.ts";
import { serve } from "./server.ts";
// @ts-ignore plain JS, shared with the page
import { renderLanes, renderNeeds } from "./views/now.js";
// @ts-ignore plain JS, shared with the page
import { renderIssue } from "./views/contents.js";

// /api/state on a store and a ledger in the new shape (kind, issue, goals, after, ask; runs with `on`, `build`, `awaiting`, `ask`):
// the asks list (acceptance criterion 5) and the stage of every incoming entry (criterion 8).
let base: string, runsDir: string, factory: string, server: Awaited<ReturnType<typeof serve>>;
const getJson = async (p: string) => (await fetch(`http://127.0.0.1:${server.port}${p}`)).json() as Promise<any>;
const saved: Record<string, string | undefined> = {};
const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const sh = (cwd: string, ...args: string[]) => {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
  return p.stdout.toString().trim();
};
const now = new Date();
const ago = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();
const run = (id: string, extra: Record<string, unknown>) => {
  mkdirSync(join(runsDir, id), { recursive: true });
  writeFileSync(join(runsDir, id, "state.json"), JSON.stringify({ repo: "fac", told: true, started: ago(2), ...extra }));
};

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), "aleph-wm-"));
  runsDir = join(base, "runs"); factory = join(base, "factory");
  mkdirSync(runsDir); mkdirSync(factory);
  const repo = join(base, "repo"), prod = join(base, "prod.git");
  sh(base, "git", "init", "-q", "--bare", "-b", "main", prod);
  sh(base, "git", "clone", "-q", prod, repo);
  writeFileSync(join(repo, "a"), "1");
  sh(repo, "git", "add", "."); sh(repo, "git", "commit", "-q", "-m", "first goal\n\nIssue: fac-1\nGoal: fac-1.1\nJob: fac-1.1");
  sh(repo, "git", "push", "-q", "origin", "main");
  sh(repo, "git", "fetch", "-q", "origin");
  const remote = join(base, "store.git"), store = join(base, "store");
  sh(base, "git", "init", "-q", "--bare", "-b", "main", remote);
  sh(base, "git", "clone", "-q", remote, store);
  sh(store, "git", "commit", "-q", "--allow-empty", "-m", "start");
  sh(store, "git", "push", "-q", "origin", "main");
  writeFileSync(join(base, "repos.json"), JSON.stringify({ fac: { path: repo, sandbox: true, checks: [] } }));
  for (const [k, v] of Object.entries({ ALEPH_JOBS_DIR: runsDir, ALEPH_REPOS: join(base, "repos.json"), ALEPH_ISSUES: store, ALEPH_FACTORY_DIR: factory })) {
    saved[k] = process.env[k]; process.env[k] = v;
  }
  Object.assign(process.env, gitEnv);
  writeList({ key: "fac" }, "seed", (doc) => {
    // fac-1: three goals; .1 is done, .2 builds, .3 runs after .2.
    const one = add(doc, "Three goals", { body: "## Request\n\nDo three things.\n" });
    const g1 = addGoal(doc, one, { title: "first", body: "" });
    addGoal(doc, one, { title: "second", body: "", after: [`fac-1.1`] });
    addGoal(doc, one, { title: "third", body: "", after: [`fac-1.2`] });
    setStatus(g1, "done");
    // fac-2: one goal that waits for approval; fac-3: an issue that awaits input; fac-4: a new issue.
    const two = add(doc, "Needs a go-ahead", { body: "## Request\n\nAsk first.\n" });
    const g = addGoal(doc, two, { title: "gated", body: "" });
    writeAsk(g, { kind: "approval", reason: "proposal", question: "Update left-pad?", options: [], why: [] });
    const three = add(doc, "A part was dropped", { body: "## Request\n\nPlan it.\n" });
    writeAsk(three, { kind: "input", reason: "part-dropped", question: "A goal was dropped.", options: [{ label: "Close with what landed", line: "close" }, { label: "Plan the missing part", line: "plan" }], recommended: "Close with what landed", why: [] });
    add(doc, "Just filed", { body: "## Request\n\nNew.\n" });
    return true;
  }, true);
  run("20261031-000001-fac-fac-1.2-build", { kind: "build", job: "fac-1.2", name: "fac-1.2", state: "running", on: "fac-1.2" });
  run("20261031-000002-fac-fac-5-triage", { kind: "triage", job: "triage-fac-5", name: "triage-fac-5", state: "awaiting", on: "fac-5", ask: { kind: "input", reason: "triage-failed", question: "Triage gave no verdict.", options: [], why: [] } });
  run("20261031-000003-fac-fac-2.1-build", { kind: "build", job: "fac-2.1-r", name: "fac-2.1-r", state: "awaiting", on: "fac-2.1", ask: { kind: "approval", reason: "review", question: "Land it?", options: [], why: [] }, review: { call: "ask", reason: "judgement" } });
  run("20261031-000004-fac-fac-1.1-build", { kind: "build", job: "fac-1.1", name: "fac-1.1", state: "landed", on: "fac-1.1", commit: "abcdef1234567", ended: ago(1) });
  server = await serve(0, { warm: false });
});
afterAll(() => {
  server?.stop(true);
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  rmSync(base, { recursive: true, force: true });
});

describe("/api/state on a work-model store", () => {
  test("asks holds one entry for each run, issue and goal that waits for Chris, with kind and reason; the old lists are gone", () => {
    const s: any = state(now);
    for (const k of ["att" + "ention", "needs", "needsIssues", "waiting", "standing"]) expect(Object.keys(s), k).not.toContain(k);
    expect(Object.keys(s)).toEqual(expect.arrayContaining(["asks", "always", "queued", "runningIssues"]));
    const by = Object.fromEntries(s.asks.map((a: any) => [a.key, a]));
    // A run that awaits: its Ask's kind and reason, and the goal it is on.
    expect(by["run:fac-2.1-r"]).toMatchObject({ kind: "approval", reason: "review", on: "fac-2.1" });
    // A triage run that awaits counts too.
    expect(by["run:triage-fac-5"]).toMatchObject({ kind: "input", reason: "triage-failed" });
    // A goal with an Ask, and an issue with an Ask.
    expect(by["issue:fac-2.1"]).toMatchObject({ kind: "approval", reason: "proposal", href: "#/issues/fac/2.1" });
    expect(by["issue:fac-3"]).toMatchObject({ kind: "input", reason: "part-dropped" });
    expect(by["issue:fac-3"].actions.map((a: any) => a.label)).toEqual(["Approve Close with what landed", "Approve Plan the missing part", "Close the issue"]);
    // One entry each, and no other.
    expect(s.asks).toHaveLength(4);
    for (const a of s.asks) expect(["input", "approval"]).toContain(a.kind);
  });

  test("the Status page shows each ask under Awaiting you with its input or approval mark", () => {
    const s: any = state(now);
    const html = renderNeeds({ ...s, stuck: [], factory: { ...s.factory, health: [] } });
    expect(html).toContain(">Awaiting you<");
    expect(html).not.toContain("Needs you");
    expect(html.match(/<span class="kind-tag">Approval<\/span>/g)).toHaveLength(2);
    expect(html.match(/<span class="kind-tag">Input<\/span>/g)).toHaveLength(2);
  });

  test("incoming lists issues with their stage; goals are not listed there", () => {
    const s: any = state(now);
    const by = Object.fromEntries(s.incoming.map((i: any) => [i.id, i.stage]));
    expect(by).toEqual({ "fac-1": "building", "fac-2": "awaiting", "fac-3": "awaiting", "fac-4": "new" });
  });

  test("a stage in /api/state is the stage `aleph status` prints, for an issue and for its goals", () => {
    const s: any = state(now);
    const want: Record<string, string> = { "fac-1": s.incoming.find((i: any) => i.id === "fac-1").stage, "fac-4": "new" };
    for (const [id, stage] of Object.entries(want)) {
      const p = Bun.spawnSync([process.execPath, join(import.meta.dir, "..", "jobs", "cli.ts"), "status", id, "--json"], { env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
      expect(p.exitCode, `${id}: ${p.stderr}`).toBe(0);
      expect(JSON.parse(p.stdout.toString()).stage, id).toBe(stage);
    }
    // The issue in Running nests its goals with their stages; .3 runs after .2, so it is blocked.
    const issue = s.runningIssues.find((i: any) => i.id === "fac-1");
    expect(issue.of).toEqual({ n: 1, m: 3 });
    expect(issue.goals.map((g: any) => [g.id, g.stage])).toEqual([["fac-1.1", "done"], ["fac-1.2", "building"], ["fac-1.3", "blocked"]]);
    expect(issue.goals[1].job).toMatchObject({ name: "fac-1.2", kind: "build" });
    expect(s.queued.map((q: any) => [q.id, q.stage])).toEqual([["1.3", "blocked"]]);
  });

  test("Running shows the issue with 'n of m goals' and its goals nested, not the goal's job as a second card", () => {
    const s: any = state(now);
    const html = renderLanes(s);
    const running = html.match(/<section id="lane-running"[^]*?<\/section>/)![0];
    expect(running).toContain("1 of 3 goals");
    expect(running.match(/class="goal-row"/g)).toHaveLength(3);
    expect(running).toContain('href="#/jobs/fac-1.2"');
    expect(running.match(/<article /g)).toHaveLength(1);
    expect(s.running.find((j: any) => j.name === "fac-1.2").issue).toBe("fac-1");
  });

  test("the Always list is always.json under the new reasons", () => {
    writeFileSync(join(factory, "always.json"), JSON.stringify({ "triage-failed": { action: "retry", at: "2026-10-30T00:00:00.000Z" } }));
    try {
      expect((state(now) as any).always).toEqual([{ reason: "triage-failed", action: "retry", at: "2026-10-30T00:00:00.000Z", handed: 0 }]);
    } finally { rmSync(join(factory, "always.json")); }
  });
});

describe("the Issue page", () => {
  test("the API gives the ## Request as written, then the goals, each with its Job", async () => {
    const d = await getJson("/api/issues/fac/1");
    expect(d.kind).toBe("issue");
    expect(d.request).toBe("Do three things.");
    expect(d.derived).toMatchObject({ item: "fac-1", stage: "building" });
    expect(d.goals.map((g: any) => [g.id, g.title, g.stage, g.jobs.map((j: any) => j.name)])).toEqual([
      ["fac-1.1", "first", "done", ["fac-1.1"]], ["fac-1.2", "second", "building", ["fac-1.2"]], ["fac-1.3", "third", "blocked", []],
    ]);
    expect(d.goals[0].jobs[0]).toMatchObject({ state: "landed", kind: "build" });
  });

  test("a goal's page names its issue and has no goals of its own", async () => {
    const d = await getJson("/api/issues/fac/1.2");
    expect(d).toMatchObject({ kind: "goal", ref: "1.2", request: null, goals: [], issue: { id: "fac-1", href: "#/issues/fac/1" } });
    expect(d.jobs.map((j: any) => j.name)).toEqual(["fac-1.2"]);
    expect((await fetch(`http://127.0.0.1:${server.port}/api/issues/fac/9.9`)).status).toBe(404);
  });

  test("the page shows the Request, then Goals with each goal's Job, in the spec's names", async () => {
    const html = renderIssue(await getJson("/api/issues/fac/1"));
    const at = (t: string) => html.indexOf(t);
    expect(at('id="h-request">Request<')).toBeGreaterThan(-1);
    expect(at("Do three things.")).toBeGreaterThan(at('id="h-request"'));
    expect(at('id="h-goals">Goals<')).toBeGreaterThan(at("Do three things."));
    const goals = html.match(/<table class="tbl" id="goals">[^]*?<\/table>/)![0];
    expect(goals).toContain("<th>Job</th>");
    for (const id of ["fac-1.1", "fac-1.2", "fac-1.3"]) expect(goals).toContain(`href="#/issues/fac/${id.slice(4)}"`);
    expect(goals).toContain('href="#/jobs/fac-1.2"');
    expect(goals).toContain("No job yet");
    for (const old of [["needs", "chris"].join("-"), ["needs", "you"].join("-"), ["waiting", "on"].join("_"), "Item"]) expect(html).not.toContain(old);
  });
});

test("the store read back holds what the test wrote", () => {
  expect(find(readList({ key: "fac" })!, "1.2")?.fm.after).toEqual(["fac-1.1"]);
});
