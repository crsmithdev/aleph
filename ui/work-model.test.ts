import { afterAll, beforeAll, describe, expect, setSystemTime, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeList } from "../issues/lib/store.ts";
import { add, setStatus } from "../issues/lib/todo.ts";
import { addPart } from "../issues/lib/parts.fixture.ts";
import { setAsk, refIn } from "../jobs/lib/asks/ask.ts";
import { state } from "./state.ts";
import { withEnv, withServer, type TestServer } from "./test-server.ts";
// @ts-ignore plain JS, shared with the page
import { renderIssue } from "./views/issues.js";
import { putRun } from "../jobs/lib/records/record.ts";

// /api/factory on a store and a ledger in the new shape (kind, issue, goals, after, ask; runs with `on`, `build`, `awaiting`, `ask`):
// the asks list (acceptance criterion 5) and the stage of every incoming entry (criterion 8).
let base: string, runsDir: string, factory: string, server: TestServer, stop: () => void, restoreEnv: () => void;
const getJson = async (p: string) => (await fetch(`http://127.0.0.1:${server.port}${p}`)).json() as Promise<any>;
const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const sh = (cwd: string, ...args: string[]) => {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
  return p.stdout.toString().trim();
};
// The test's clock: the code under test reads it, and the fixtures sit at known distances from it.
const NOW = Date.parse("2026-11-04T12:00:00Z");
beforeAll(() => setSystemTime(NOW));
afterAll(() => setSystemTime());
const now = new Date(NOW);
const ago = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();
const seq: Record<string, number> = {};
const run = (id: string, extra: Record<string, unknown>) => {
  mkdirSync(join(runsDir, id), { recursive: true });
  const subject = String(extra.on ?? extra.name);
  seq[subject] = (seq[subject] ?? 0) + 1;
  putRun(id, { repo: "fac", told: true, started: ago(2), n: seq[subject], ...extra } as any);
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
    // fac-1: three issues; .1 is done, .2 builds, .3 runs after .2.
    const one = add(doc, "Three goals", { request: "Do three things.\n" });
    const g1 = addPart(doc, one, { title: "first", spec: "Do it." });
    addPart(doc, one, { title: "second", spec: "Do it.", after: [`fac-1.1`] });
    addPart(doc, one, { title: "third", spec: "Do it.", after: [`fac-1.2`] });
    setStatus(g1, "done");
    // fac-2: one part that waits for approval; fac-3: an issue that awaits input; fac-4: a new issue.
    const two = add(doc, "Needs a go-ahead", { request: "Ask first.\n" });
    const g = addPart(doc, two, { title: "gated", spec: "Do it." });
    setAsk(refIn(doc.repo!, g), { kind: "input", reason: "question", question: "Update left-pad?", options: [], why: [] });
    const three = add(doc, "A part was dropped", { request: "Plan it.\n" });
    setAsk(refIn(doc.repo!, three), { kind: "input", reason: "part-dropped", question: "A goal was dropped.", options: [{ label: "Close with what landed", line: "close" }, { label: "Plan the missing part", line: "plan" }], recommended: "Close with what landed", why: [] });
    add(doc, "Just filed", { request: "New.\n" });
    return true;
  }, true);
  run("20261031-000001-fac-fac-1.2-build", { kind: "build", job: "fac-1.2", name: "fac-1.2", condition: "running", on: "fac-1.2" });
  run("20261031-000002-fac-fac-5-triage", { kind: "triage", job: "triage-fac-5", name: "triage-fac-5", condition: "waiting", on: "fac-5", ask: { kind: "input", reason: "no-commit", question: "Triage gave no verdict.", options: [], why: [] } });
  run("20261031-000003-fac-fac-2.1-build", { kind: "build", job: "fac-2.1-r", name: "fac-2.1-r", condition: "waiting", on: "fac-2.1", ask: { kind: "approval", reason: "review", question: "Land it?", options: [], why: [] }, review: { call: "waiting", reason: "judgement" } });
  run("20261031-000004-fac-fac-1.1-build", { kind: "build", job: "fac-1.1", name: "fac-1.1", condition: "landed", on: "fac-1.1", commit: "abcdef1234567", ended: ago(1) });
  ({ server, stop } = await withServer({ warm: false }));
});
afterAll(() => {
  stop?.();
  restoreEnv?.();
  rmSync(base, { recursive: true, force: true });
});

describe("/api/factory on a work-model store", () => {

  test("parts are flat: the parent waits for its parts, and .3 runs after .2", () => {
    const s: any = state(now);
    // Parts are flat: the parent waits for its parts and has no card in Running; .3 runs after .2, so it is held.
    expect(s.runningIssues).toEqual([]);
    expect(s.running.find((j: any) => j.name === "fac-1.2").part).toMatchObject({ n: 2, m: 3, parent: "fac-1" });
    expect(s.queued.map((q: any) => [q.id, q.stage])).toEqual([["1.3", "held"]]);
    expect(s.queued[0].part).toMatchObject({ n: 3, m: 3, parent: "fac-1" });
  });
});

describe("the Issue page", () => {

  test("a part's page names its issue and has no parts of its own", async () => {
    const d = await getJson("/api/issues/fac-1.2");
    expect(d).toMatchObject({ ref: "1.2", goals: [], issue: { id: "fac-1", href: "#/issues/fac/1" } });
    expect(d.jobs.map((j: any) => j.name)).toEqual(["fac-1.2"]);
    expect((await fetch(`http://127.0.0.1:${server.port}/api/issues/fac-9.9`)).status).toBe(404);
  });

  test("the page edits an issue and appends a note through the CLI", async () => {
    const post = (path: string, body: unknown, ui = true) => fetch(`http://127.0.0.1:${server.port}/api/issues/fac-1/${path}`, { method: "POST", headers: { "content-type": "application/json", ...(ui ? { "x-aleph-ui": "1" } : {}) }, body: JSON.stringify(body) });
    expect((await post("note", { text: "x" }, false)).status).toBe(403);
    expect((await post("note", { text: " " })).status).toBe(400);
    const before = await getJson("/api/issues/fac-1");
    const edited = await post("edit", { title: "[Group] A new title", priority: "high", source: "worker", areas: "ui, bug", description: "New words." });
    expect(edited.status, await edited.clone().text()).toBe(200);
    expect((await post("note", { text: "a page note" })).status).toBe(200);
    const d = await getJson("/api/issues/fac-1");
    expect(d).toMatchObject({ title: "[Group] A new title", priority: "high", labels: ["ui", "bug"], frontmatter: { source: "worker" }, request: "New words." });
    expect(d.notes.map((n: any) => n.text).join("\n")).toContain("a page note");
    expect((await post("edit", { title: "t", priority: "high", source: "nobody", areas: "", description: "x" })).status).toBe(422);
    await post("edit", { title: before.title, priority: before.priority ?? "medium", source: before.frontmatter.source ?? "chris", areas: before.labels.join(","), description: before.request ?? before.body });
  }, 60_000);

  test("the Issue page has a breadcrumb, the stage first among the pills, a timeline, and links a spec it has", async () => {
    const base = await getJson("/api/issues/fac-1");
    const html = renderIssue({ ...base, specs: ["2026-01-01-a.md"], request: "See docs/specs/2026-01-01-a.md and docs/specs/gone.md." });
    expect(html).toContain('<nav class="crumb"');
    expect(html).toContain('<span>1</span></nav>');
    expect(html).toContain('<a href="#/specs/fac/2026-01-01-a.md">docs/specs/2026-01-01-a.md</a>');
    expect(html).not.toContain('">docs/specs/gone.md</a>');
    expect(html).toContain('<div class="status-row"><span class="badge');
    expect(html).toContain('<h2 id="h-timeline">Timeline</h2>');
    expect(html).toContain("<h3>Sub-issues</h3>");
    expect(html).not.toContain(base.derived.why);
    expect(html).not.toContain("<h2>Request</h2>");
    // Edit mode: each value and its editor sit in one place, and the controls belong to the one form.
    expect(html).toContain('data-editor="start"');
    for (const name of ["title", "priority", "source", "areas", "request"]) expect(html).toMatch(new RegExp(`name="${name}"[^>]* form="issue-edit"`));
    expect(html).not.toContain("<summary>Edit</summary>");
  });

  test("the page shows the parts in the timeline, each linked to its job and its page, then the Request", async () => {
    const html = renderIssue(await getJson("/api/issues/fac-1"));
    const at = (t: string) => html.indexOf(t);
    expect(at('id="h-request">Description<')).toBeGreaterThan(at("<h3>Sub-issues</h3>"));
    expect(at("Do three things.")).toBeGreaterThan(at('id="h-request"'));
    const parts = html.slice(at("<h3>Sub-issues</h3>"), at('id="h-request"'));
    for (const id of ["fac-1.1", "fac-1.2", "fac-1.3"]) expect(parts).toContain(`href="#/issues/fac/${id.slice(4)}"`);
    expect(parts).toContain('href="#/jobs/fac-1.2%231"');
    // A part with no job yet links its id to its own page.
    expect(parts).toMatch(/<a class="idl" href="#\/issues\/fac\/1.3">/);
    for (const old of [["needs", "chris"].join("-"), ["needs", "you"].join("-"), ["waiting", "on"].join("_"), "Item"]) expect(html).not.toContain(old);
  });
});
