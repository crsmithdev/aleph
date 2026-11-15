import { afterAll, beforeAll, describe, expect, setSystemTime, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeList } from "../issues/lib/store.ts";
import { add, setStatus } from "../issues/lib/todo.ts";
import { addPart } from "../issues/lib/parts.fixture.ts";
import { setAsk, refIn } from "../jobs/lib/asks/ask.ts";
import { logEvent } from "../lib/layout.ts";
import { state } from "./state.ts";
import { withEnv, withServer, type TestServer } from "./test-server.ts";
// @ts-ignore plain JS, shared with the page
import { refHits, renderIssue } from "./views/issues.js";
import { seed } from "../jobs/job.testkit.ts";
import { writeRepos } from "../tests/projects.ts";

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
// `on` is the issue `<repo>-<n>`; the job's work is its own, so `job` is dropped.
const run = (_id: string, { on, job: _job, kind, ...extra }: Record<string, unknown>) => {
  seed({ role: (kind ?? "build") as any, repo: "fac", started: ago(2), ...(on ? { target: `issue.${String(on).split("-")[1].split(".")[0]}` } : {}), ...extra } as any);
};

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), "aleph-wm-"));
  runsDir = join(base, "runs"); factory = join(base, "factory");
  mkdirSync(runsDir); mkdirSync(factory);
  const repo = join(base, "repo"), prod = join(base, "prod.git");
  sh(base, "git", "init", "-q", "--bare", "-b", "main", prod);
  sh(base, "git", "clone", "-q", prod, repo);
  writeFileSync(join(repo, "a"), "1");
  sh(repo, "git", "add", "."); sh(repo, "git", "commit", "-q", "-m", "first goal\n\nIssue: issue.2\nJob: job.4");
  sh(repo, "git", "push", "-q", "origin", "main");
  sh(repo, "git", "fetch", "-q", "origin");
  const remote = join(base, "store.git"), store = join(base, "store");
  sh(base, "git", "init", "-q", "--bare", "-b", "main", remote);
  sh(base, "git", "clone", "-q", remote, store);
  sh(store, "git", "commit", "-q", "--allow-empty", "-m", "start");
  sh(store, "git", "push", "-q", "origin", "main");
  writeRepos({ fac: { path: repo, sandbox: true, checks: [] } }, store);
  restoreEnv = withEnv({ ALEPH_JOBS_DIR: runsDir, ALEPH_DB: join(base, "aleph.db"), ALEPH_ITEMS: store, ALEPH_FACTORY_DIR: factory, ...gitEnv });
  writeList({ key: "fac" }, "seed", (doc) => {
    // issue 1 has three children: 2 is done, 3 builds, 4 runs after 3.
    const one = add(doc, "Three goals", { request: "Do three things.\n" });
    const g1 = addPart(doc, one, { title: "first", spec: "Do it." });
    addPart(doc, one, { title: "second", spec: "Do it.", after: ["issue.2"] });
    addPart(doc, one, { title: "third", spec: "Do it.", after: ["issue.3"] });
    setStatus(g1, "done");
    // 5 has one child, 6, that waits for approval; 7 awaits input; 8 is new.
    const two = add(doc, "Needs a go-ahead", { request: "Ask first.\n" });
    const g = addPart(doc, two, { title: "gated", spec: "Do it." });
    setAsk(refIn(doc.repo!, g), { reason: "question", question: "Update left-pad?", options: [], why: [] });
    const three = add(doc, "A part was dropped", { request: "Plan it.\n" });
    setAsk(refIn(doc.repo!, three), { reason: "part-dropped", question: "A goal was dropped.", options: [{ label: "Close as done", line: "close" }, { label: "Keep open", line: "plan" }], recommended: "Close as done", why: [] });
    add(doc, "Just filed", { request: "New.\n" });
    return true;
  }, true);
  logEvent({ subject: "gate", action: "held", object: "issue.4", detail: "after: issue.3" });
  run("", { kind: "build", job: "fac-3", name: "fac-3", state: "running", on: "fac-3" });
  run("", { kind: "triage", job: "triage-fac-99", name: "triage-fac-99", state: "waiting", on: "fac-99", ask: { kind: "input", reason: "no-commit", question: "Triage gave no verdict.", options: [], why: [] } });
  run("", { kind: "build", job: "fac-6-r", name: "fac-6-r", state: "waiting", on: "fac-6", ask: { kind: "approval", reason: "review-held", question: "Land it?", options: [], why: [] }, review: { call: "waiting", reason: "judgement" } });
  run("", { kind: "build", job: "fac-2", name: "fac-2", state: "landed", on: "fac-2", commit: "abcdef1234567", ended: ago(1) });
  ({ server, stop } = await withServer({ warm: false }));
});
afterAll(() => {
  stop?.();
  restoreEnv?.();
  rmSync(base, { recursive: true, force: true });
});

describe("/api/factory on a work-model store", () => {

  test("children are flat: the parent waits for them, and 4 runs after 3", () => {
    const s: any = state(now);
    // The parent waits for its children and has no card in Running; 4 runs after 3, so it is held.
    expect(s.runningIssues).toEqual([]);
    expect(s.running.find((j: any) => j.name === "fac-3").part).toMatchObject({ n: 2, m: 3, parent: "fac-1" });
    expect(s.queued.map((q: any) => [q.id, q.stage])).toEqual([[4, "held"]]);
    expect(s.queued[0].part).toMatchObject({ n: 3, m: 3, parent: "fac-1" });
  });
});

describe("the Issue page", () => {

  test("a part's page names its issue and has no parts of its own", async () => {
    const d = await getJson("/api/issues/fac-3");
    expect(d).toMatchObject({ ref: "3", goals: [], issue: { id: "fac-1", href: "#/issues/fac/1" } });
    expect(d.jobs.map((j: any) => j.name)).toEqual(["fac-3"]);
    expect((await fetch(`http://127.0.0.1:${server.port}/api/issues/fac-99`)).status).toBe(404);
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

  // Breaks if the edit route drops the picker's refs, clears them when the form sends none, or fails to clear an empty list.
  test("the page's edit sets refs from the picker, keeps them when it sends no refs, and an empty list clears them", async () => {
    const post = (body: unknown) => fetch(`http://127.0.0.1:${server.port}/api/issues/fac-1/edit`, { method: "POST", headers: { "content-type": "application/json", "x-aleph-ui": "1" }, body: JSON.stringify(body) });
    const d = await getJson("/api/issues/fac-1");
    const same = { title: d.title, priority: d.priority ?? "medium", source: d.frontmatter.source ?? "chris", areas: d.labels.join(","), description: d.request ?? "" };
    expect((await post({ ...same, refs: ["issue.2"] })).status).toBe(200);
    expect((await getJson("/api/issues/fac-1")).refs.map((r: any) => r.key)).toEqual(["issue.2"]);
    expect((await post(same)).status).toBe(200);
    expect((await getJson("/api/issues/fac-1")).refs.map((r: any) => r.key)).toEqual(["issue.2"]);
    expect((await post({ ...same, refs: [] })).status).toBe(200);
    expect((await getJson("/api/issues/fac-1")).refs).toEqual([]);
  }, 60_000);

  // Breaks if the picker leaves out the chosen refs or their keys, or the search ranks or skips wrongly.
  test("the edit mode's Refs picker holds the chosen refs, and refHits ranks by id and title and skips the chosen", async () => {
    const pageBase = await getJson("/api/issues/fac-1");
    const html = renderIssue({ ...pageBase, refs: [{ id: "fac-2", key: "issue.2", title: "second", status: "open", href: "#/issues/fac/2" }] });
    expect(html).toContain('class="chip ref-chip" data-key="issue.2"');
    expect(html).toContain('name="refs" form="issue-edit" value="issue.2"');
    const rows = [
      { n: 2, id: "fac-2", title: "Fix the cache key", status: "open", project: "fac", labels: [], stage: "new", priority: "medium" },
      { n: 3, id: "fac-3", title: "Document the cache", status: "open", project: "fac", labels: [], stage: "new", priority: "medium" },
      { n: 4, id: "oth-4", title: "Unrelated", status: "done", project: "oth", labels: [], stage: "done", priority: "medium" },
    ];
    expect(refHits(rows, "cache", new Set()).map((h: any) => h.key)).toEqual(["issue.2", "issue.3"]);
    expect(refHits(rows, "cache", new Set(["issue.2"])).map((h: any) => h.key)).toEqual(["issue.3"]);
    expect(refHits(rows, "oth-4", new Set()).map((h: any) => h.key)).toEqual(["issue.4"]);
    expect(refHits(rows, "cahce", new Set()).map((h: any) => h.key)).toEqual(["issue.2", "issue.3"]);
  });

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

  test("the page shows the parts in the timeline, each linked to its page, then the Request", async () => {
    const html = renderIssue(await getJson("/api/issues/fac-1"));
    const at = (t: string) => html.indexOf(t);
    expect(at('id="h-request">Description<')).toBeGreaterThan(at("<h3>Sub-issues</h3>"));
    expect(at("Do three things.")).toBeGreaterThan(at('id="h-request"'));
    const parts = html.slice(at("<h3>Sub-issues</h3>"), at('id="h-request"'));
    for (const id of ["fac-2", "fac-3", "fac-4"]) expect(parts).toContain(`href="#/issues/fac/${id.slice(4)}"`);
    expect(parts).toContain('href="#/jobs/job.1"');
    // A part with no job yet links its id to its own page.
    expect(parts).toMatch(/<a class="idl" href="#\/issues\/fac\/4">/);
    for (const old of [["needs", "chris"].join("-"), ["needs", "you"].join("-"), ["waiting", "on"].join("_"), "Item"]) expect(html).not.toContain(old);
  });
});
