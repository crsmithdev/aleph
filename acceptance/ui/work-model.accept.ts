// Archived goal tests from ui/work-model.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readList, writeList } from "../../todo/lib/store.ts";
import { add, addPart, find, setStatus } from "../../todo/lib/todo.ts";
import { setAsk } from "../../jobs/lib/ask.ts";
import { state } from "../../ui/state.ts";
import { withEnv, withServer, type TestServer } from "../../ui/test-server.ts";
// @ts-ignore plain JS, shared with the page
import { renderLanes, renderNeeds } from "../../ui/views/now.js";
// @ts-ignore plain JS, shared with the page
import { renderIssue } from "../../ui/views/issues.js";

// /api/state on a store and a ledger in the new shape (kind, issue, goals, after, ask; runs with `on`, `build`, `awaiting`, `ask`):
// the asks list (acceptance criterion 5) and the stage of every incoming entry (criterion 8).
let base: string, runsDir: string, factory: string, server: TestServer, stop: () => void, restoreEnv: () => void;
const getJson = async (p: string) => (await fetch(`http://127.0.0.1:${server.port}${p}`)).json() as Promise<any>;
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
  sh(repo, "git", "add", "."); sh(repo, "git", "commit", "-q", "-m", "first goal\n\nIssue: fac-1.1\nJob: fac-1.1");
  sh(repo, "git", "push", "-q", "origin", "main");
  sh(repo, "git", "fetch", "-q", "origin");
  const remote = join(base, "store.git"), store = join(base, "store");
  sh(base, "git", "init", "-q", "--bare", "-b", "main", remote);
  sh(base, "git", "clone", "-q", remote, store);
  sh(store, "git", "commit", "-q", "--allow-empty", "-m", "start");
  sh(store, "git", "push", "-q", "origin", "main");
  writeFileSync(join(base, "repos.json"), JSON.stringify({ fac: { path: repo, sandbox: true, checks: [] } }));
  restoreEnv = withEnv({ ALEPH_JOBS_DIR: runsDir, ALEPH_REPOS: join(base, "repos.json"), ALEPH_ISSUES: store, ALEPH_FACTORY_DIR: factory, ...gitEnv });
  writeList({ key: "fac" }, "seed", (doc) => {
    // fac-1: three goals; .1 is done, .2 builds, .3 runs after .2.
    const one = add(doc, "Three goals", { request: "Do three things.\n" });
    const g1 = addPart(doc, one, { title: "first", spec: "Do it." });
    addPart(doc, one, { title: "second", spec: "Do it.", after: [`fac-1.1`] });
    addPart(doc, one, { title: "third", spec: "Do it.", after: [`fac-1.2`] });
    setStatus(g1, "done");
    // fac-2: one goal that waits for approval; fac-3: an issue that awaits input; fac-4: a new issue.
    const two = add(doc, "Needs a go-ahead", { request: "Ask first.\n" });
    const g = addPart(doc, two, { title: "gated", spec: "Do it." });
    setAsk(g, { kind: "approval", reason: "proposal", question: "Update left-pad?", options: [], why: [] });
    const three = add(doc, "A part was dropped", { request: "Plan it.\n" });
    setAsk(three, { kind: "input", reason: "part-dropped", question: "A goal was dropped.", options: [{ label: "Close with what landed", line: "close" }, { label: "Plan the missing part", line: "plan" }], recommended: "Close with what landed", why: [], situation: "The director sent the dropped goal to you." });
    add(doc, "Just filed", { request: "New.\n" });
    return true;
  }, true);
  run("20261031-000001-fac-fac-1.2-build", { kind: "build", job: "fac-1.2", name: "fac-1.2", condition: "running", on: "fac-1.2" });
  run("20261031-000002-fac-fac-5-triage", { kind: "triage", job: "triage-fac-5", name: "triage-fac-5", condition: "awaiting", on: "fac-5", ask: { kind: "input", reason: "triage-failed", question: "Triage gave no verdict.", options: [], why: [] } });
  run("20261031-000003-fac-fac-2.1-build", { kind: "build", job: "fac-2.1-r", name: "fac-2.1-r", condition: "awaiting", on: "fac-2.1", ask: { kind: "approval", reason: "review", question: "Land it?", options: [], why: [] }, review: { call: "ask", reason: "judgement" } });
  run("20261031-000004-fac-fac-1.1-build", { kind: "build", job: "fac-1.1", name: "fac-1.1", condition: "landed", on: "fac-1.1", commit: "abcdef1234567", ended: ago(1) });
  ({ server, stop } = await withServer({ warm: false }));
});
afterAll(() => {
  stop?.();
  restoreEnv?.();
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
    // The director escalated it with its case text, so it has its buttons; the proposal is still with the director and has none.
    expect(by["issue:fac-3"]).toMatchObject({ kind: "input", reason: "part-dropped", escalated: true });
    expect(by["issue:fac-2.1"]).toMatchObject({ escalated: false, actions: [] });
    expect(by["issue:fac-3"].actions.map((a: any) => a.label)).toEqual(["Close with what landed", "Plan the missing part", "Close the issue"]);
    // One entry each, and no other.
    expect(s.asks).toHaveLength(4);
    for (const a of s.asks) expect(["input", "approval"]).toContain(a.kind);
  });

  test("the Status page shows each ask under Awaiting you with its input or approval mark", () => {
    const s: any = state(now);
    const html = renderNeeds({ ...s, stuck: [], factory: { ...s.factory, health: [] } });
    expect(html).toContain(">Awaiting you<");
    expect(html).not.toContain("Needs you");
    expect(html.match(/<article [^>]*data-kind="approval"/g)).toHaveLength(2);
    expect(html.match(/<article [^>]*data-kind="input"/g)).toHaveLength(2);
    expect(html.match(/data-card="approve"/g)).toHaveLength(2);
    expect(html).toContain('data-card="unstick"');
    expect(html).toContain('data-card="decide"');
  });

  test("incoming lists issues with their stage; goals are not listed there", () => {
    const s: any = state(now);
    const by = Object.fromEntries(s.incoming.map((i: any) => [i.id, i.stage]));
    expect(by).toEqual({ "fac-1": "working", "fac-2": "awaiting", "fac-3": "awaiting", "fac-4": "new" });
  });

  test("Running shows a part as its own card with a 3/4 link to its parent", () => {
    const s: any = state(now);
    const html = renderLanes(s);
    const running = html.match(/<section id="lane-running"[^]*?<\/section>/)![0];
    expect(running).toContain('<a class="part" href="#/issues/fac/1" title="Part 2 of 3 of fac-1">2/3</a>');
    expect(running).toContain('href="#/jobs/fac-1.2"');
    expect(running.match(/<article /g)).toHaveLength(1);
    expect(running).not.toContain("goal-row");
  });
});

describe("the Issue page", () => {
  test("the API gives the ## Request as written, then the goals, each with its Job", async () => {
    const d = await getJson("/api/issues/fac/1");
    expect(d.request).toBe("Do three things.");
    expect(d.derived).toMatchObject({ item: "fac-1", stage: "working" });
    expect(d.goals.map((g: any) => [g.id, g.title, g.stage, g.jobs.map((j: any) => j.name)])).toEqual([
      ["fac-1.1", "first", "done", ["fac-1.1"]], ["fac-1.2", "second", "working", ["fac-1.2"]], ["fac-1.3", "third", "blocked", []],
    ]);
    expect(d.goals[0].jobs[0]).toMatchObject({ condition: "landed", kind: "build" });
  });
});

test("the store read back holds what the test wrote", () => {
  expect(find(readList({ key: "fac" })!, "1.2")?.fm.after).toEqual(["fac-1.1"]);
});
