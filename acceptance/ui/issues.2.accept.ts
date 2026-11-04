// Archived goal tests from ui/issues.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readList, writeList } from "../../todo/lib/store.ts";
import { add, addPart, setStatus, type Doc } from "../../todo/lib/todo.ts";
import * as todos from "../../todo/lib/todo.ts";
import { setAsk } from "../../jobs/lib/ask.ts";
import { withEnv, withServer, type TestServer } from "../../ui/test-server.ts";
// @ts-ignore plain JS, shared with the page
import * as v from "../../ui/views/issues.js";
// @ts-ignore
import { view as issueView } from "../../ui/views/issue.js";

/** An item stored as a goal: `kind: goal` on a plain number. */
const seedGoal = (doc: Doc, title: string, body = "") => { return add(doc, title, { spec: body || "Do it." }); };

let base: string, server: TestServer, stop: () => void, restoreEnv: () => void, jobsDir: string, argvFile: string, stdinFile: string;
const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
function sh(cwd: string, ...args: string[]): string {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
  return p.stdout.toString().trim();
}
const at = (p: string, init?: RequestInit) => fetch(`http://127.0.0.1:${server.port}${p}`, init);
const getJson = async (p: string) => (await at(p)).json() as Promise<any>;
const post = (body: object, headers: Record<string, string> = { "x-aleph-ui": "1" }, q = "") =>
  at(`/api/issues${q}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

function run(id: string, extra: Record<string, unknown>) {
  const dir = join(jobsDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "state.json"), JSON.stringify({ kind: "build", told: true, started: new Date().toISOString(), ...extra }));
}

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), "aleph-ui-issues-"));
  jobsDir = join(base, "jobs");
  mkdirSync(jobsDir);
  // a product repo whose origin/main has one commit with an Item trailer and one that names it in prose
  const remote = join(base, "demo.git"), repo = join(base, "demo");
  sh(base, "git", "init", "-q", "--bare", "-b", "main", remote);
  sh(base, "git", "clone", "-q", remote, repo);
  writeFileSync(join(repo, "a"), "1");
  sh(repo, "git", "add", "."); sh(repo, "git", "commit", "-q", "-m", "real work\n\nIssue: fac-1\nJob: fac-1");
  writeFileSync(join(repo, "b"), "2");
  sh(repo, "git", "add", "."); sh(repo, "git", "commit", "-q", "-m", "prose only\n\nthis finishes Item: fac-1 in words.\n\nbut no trailer");
  sh(repo, "git", "push", "-q", "origin", "main");
  sh(repo, "git", "fetch", "-q", "origin");
  const itemsRemote = join(base, "items.git"), items = join(base, "items");
  sh(base, "git", "init", "-q", "--bare", "-b", "main", itemsRemote);
  sh(base, "git", "clone", "-q", itemsRemote, items);
  sh(items, "git", "commit", "-q", "--allow-empty", "-m", "start");
  sh(items, "git", "push", "-q", "origin", "main");
  mkdirSync(join(base, "none"));
  writeFileSync(join(base, "repos.json"), JSON.stringify({ fac: { path: repo }, oth: { path: join(base, "none") } }));
  argvFile = join(base, "argv"); stdinFile = join(base, "stdin");
  const fake = join(base, "fake-aleph");
  writeFileSync(fake, `#!/bin/sh\nprintf '%s\\n' "$@" > ${argvFile}\ncat > ${stdinFile}\necho '{"repo":"fac","added":7}'\n`);
  chmodSync(fake, 0o755);
  restoreEnv = withEnv({ ALEPH_JOBS_DIR: jobsDir, ALEPH_REPOS: join(base, "repos.json"), ALEPH_ISSUES: items, ALEPH_FACTORY_DIR: join(base, "factory"), ALEPH_CLI: fake, ...gitEnv });
  writeList({ key: "fac" }, "seed", (doc) => {
    seedGoal(doc, "first goal", "# Heading\n\n- one\n\n<script>alert(1)</script>");
    add(doc, "plain task", { labels: ["bug"] });
    seedGoal(doc, "second goal").fm.after = ["fac-4"];
    seedGoal(doc, "third goal");
    setStatus(doc.items[1], "done");
    return true;
  }, true);
  writeList({ key: "oth" }, "seed", (doc) => { add(doc, "other thing"); return true; }, true);
  run("20261027-000001-a", { job: "fac-1", name: "fac-1", repo: "fac", condition: "landed", on: "fac-1" });
  run("20261027-000002-a", { job: "oth-1", name: "oth-1", repo: "oth", condition: "running", on: "oth-1" });
  ({ server, stop } = await withServer({ warm: false }));
});
afterAll(() => {
  stop();
  restoreEnv();
  rmSync(base, { recursive: true, force: true });
});

describe("GET /api/issues", () => {

  test("no repo gives the recent repos", async () => {
    const rows = await getJson("/api/issues");
    expect(new Set(rows.map((r: any) => r.repo))).toEqual(new Set(["fac", "oth"]));
  });

  test("?project narrows it", async () => {
    expect(new Set((await getJson("/api/issues?project=oth")).map((r: any) => r.repo))).toEqual(new Set(["oth"]));
    expect((await getJson("/api/issues?project=fac&repo=oth"))).toEqual([]);
  });
});

describe("GET /api/issues/:repo/:n", () => {
  // The runs that the land suite's "lists runs by on" case writes before these cases.
  beforeAll(() => {
    run("20261027-000010-a", { job: "on-4", name: "on-4", repo: "fac", condition: "running", on: "fac-4" });
    run("20261027-000011-a", { job: "goal-4-1", name: "goal-4-1", repo: "fac", condition: "running", on: "fac-4.1" });
    run("20261027-000012-a", { job: "on-2", name: "on-2", repo: "fac", condition: "running", on: "fac-2" });
    run("20261027-000013-a", { job: "todo-4", name: "todo-4", repo: "fac", condition: "running", on: "fac-4" });
    run("20261027-000014-a", { job: "other-4", name: "other-4", repo: "oth", condition: "running", on: "oth-4" });
  });

  test("carries the hold records of the job names it shows", async () => {
    const mk = (name: string) => ({ at: new Date().toISOString(), name, kind: "queue", text: `${name} waits` });
    const shown = [mk("on-4"), mk("goal-4-1")], other = mk("on-2");
    const dir = join(base, "factory");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "holds.jsonl"), [...shown, other].map((r) => JSON.stringify(r)).join("\n") + "\n");
    try {
      const d = await getJson("/api/issues/fac/4");
      expect(d.holds).toEqual(shown);
    } finally { rmSync(join(dir, "holds.jsonl"), { force: true }); }
    expect((await getJson("/api/issues/fac/4")).holds).toEqual([]);
  });

  test("lists the job and the trailer commit, not the prose one", async () => {
    const d = await getJson("/api/issues/fac/1");
    expect(d.title).toBe("first goal");
    expect(d.spec).toContain("# Heading");
    expect(d.status).toBe("open");
    expect(d.derived.stage).toBe("done");
    expect(d.jobs.map((j: any) => j.name)).toEqual(["fac-1"]);
    expect(d.commits.map((c: any) => c.subject)).toEqual(["real work"]);
    expect(d.commits[0].hash).toMatch(/^[0-9a-f]{40}$/);
    expect(d.commits[0].date).toBeTruthy();
    expect(Object.keys(d.commits[0])).not.toContain("commitUrl");
  });
});

describe("views", () => {
  test("the Markdown body escapes <script>", async () => {
    const h = issueView.render(await getJson("/api/issues/fac/1"));
    expect(h).not.toContain("<script>");
    expect(h).toContain("&lt;script&gt;");
    expect(h).toContain("<h1>Heading</h1>");
    expect(h).toContain("<li>one</li>");
    expect(h).toContain("real work");
    expect(h).toContain('href="#/jobs/fac-1"');
  });

  test("critical ranks above high in the priority sort, and the priority filter offers and keeps critical", async () => {
    const rows = v.issueRows({ issues: [
      { id: 1, repo: "f", title: "low one", status: "open", priority: "low", labels: [], created: "2026-10-01" },
      { id: 2, repo: "f", title: "crit one", status: "open", priority: "critical", labels: [], created: "2026-10-02" },
      { id: 3, repo: "f", title: "high one", status: "open", priority: "high", labels: [], created: "2026-10-03" },
    ] });
    expect(v.sortRows(rows, { key: "priority", dir: -1 }).map((r: any) => r.title)).toEqual(["crit one", "high one", "low one"]);
    expect(v.filterRows(rows, { priority: "critical" }).map((r: any) => r.title)).toEqual(["crit one"]);
    const d = await getJson("/api/contents");
    expect(v.view.render(d, {}, new URLSearchParams("status=any"))).toContain('data-value="critical" aria-pressed="false">critical</button>');
  });

  test("the Issues table shows 50 rows and a pager that asks for 50 more", () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({ id: 100 + i, repo: "fac", title: `t${i}`, status: "open", labels: [], updated: "2026-10-01T00:00:00Z" }));
    const d = { issues: rows, projects: [], specs: [] };
    const h = v.view.render(d, {}, new URLSearchParams());
    expect(h.match(/<tr class="rowlink"/g)).toHaveLength(50);
    expect(h).toContain('<span class="of">50 of 120</span>');
    expect(h).toContain('data-more="50"');
    expect(v.hashOptions(new URLSearchParams("limit=100")).limit).toBe(100);
    const more = v.view.render(d, {}, new URLSearchParams("limit=100"));
    expect(more.match(/<tr class="rowlink"/g)).toHaveLength(100);
    expect(more).toContain('data-more="20"');
  });
});

describe("POST /api/issues", () => {

  test("without the spec label the text is the body", async () => {
    const res = await post({ repo: "fac", title: "plain one", body: "just words", labels: ["x"] });
    expect(res.status).toBe(200);
    expect(readFileSync(argvFile, "utf8").trim().split("\n")).toEqual(["issue", "add", "fac", "plain one", "--request", "-", "--labels", "x"]);
  });
});

describe("issue form project select", () => {
  test("projectOptions escapes and selects", () => {
    const h = v.projectOptions(["a", "<b>"], "a");
    expect(h.match(/<option /g)?.length).toBe(2);
    expect(h).toContain('<option value="a" selected>');
    expect(h).toContain("&lt;b&gt;");
    expect(h).not.toContain("<b>");
  });
});

describe("POST /api/issues/:repo/:id/decide and deny", () => {
  const h = { "x-aleph-ui": "1", "content-type": "application/json" };
  const item = (n: number) => readList({ key: "fac" })!.items.find((i) => i.id === n)!;
  async function withRealCli(fn: () => Promise<void>) {
    const real = process.env.ALEPH_CLI, wrap = join(base, "real-aleph");
    writeFileSync(wrap, `#!/bin/sh\nexec ${process.execPath} ${join(join(import.meta.dir, "../../ui"), "..", "jobs", "cli.ts")} "$@"\n`);
    chmodSync(wrap, 0o755);
    process.env.ALEPH_CLI = wrap;
    try { await fn(); } finally { if (real === undefined) delete process.env.ALEPH_CLI; else process.env.ALEPH_CLI = real; }
  }
  const ask = (decision: boolean, wait?: string) => writeList({ key: "fac" }, "seed", (doc) => {
    const i = add(doc, "which way", { request: "x" });
    if (wait && !doc.items.some((x) => x.id === 1 && x.sub === 1)) addPart(doc, doc.items.find((x) => x.id === 1 && x.sub === undefined)!, { title: "g", spec: "x" });
    if (decision) setAsk(i, { kind: "input", reason: "question", question: "A or B?", options: [{ label: "A", line: "do a", ...(wait ? { after: wait } : {}) }, { label: "B", line: "do b" }], recommended: "B", why: ["w"] });
    else { setAsk(i, { kind: "input", reason: "question", question: "Should it be A or B?", options: [], why: [] }); todos.note(i, "triage: for Chris: Should it be A or B? My recommendation is B, it is smaller."); }
    return i.id;
  })!.value;

  test("denying drops the issue with the reason", async () => {
    const n = ask(true);
    await withRealCli(async () => {
      const r = await at(`/api/issues/fac/${n}/drop`, { method: "POST", headers: h, body: JSON.stringify({ reason: "Chris denied: not now" }) });
      expect(r.status).toBe(200);
      expect(todos.status(item(n))).toBe("dropped");
      expect(item(n).notes.at(-1)).toContain("not now");
    });
  });
});

describe("the Issue page shows the ask row", () => {
  const seed = (stored: boolean) => writeList({ key: "fac" }, "seed", (doc) => {
    const i = add(doc, stored ? "ask with text" : "plain", { request: "x" });
    setAsk(i, { kind: "input", reason: "question", question: "A or B?", options: [{ label: "A", line: "do a" }, { label: "B", line: "do b" }], recommended: "B", why: ["w"],
      ...(stored ? { situation: "Two ways to go.", effects: [{ action: "decide:A", text: "Goes with A." }, { action: "decide:B", text: "Goes with B." }], recommend: { action: "decide:B", why: "smaller" } } : {}) });
    return i.id;
  }, true)!.value;

  test("an awaiting issue returns ask; a non-asking one returns none", async () => {
    const n = seed(true);
    const d = await getJson(`/api/issues/fac/${n}`);
    expect(d.ask.situation).toBe("Two ways to go.");
    expect(d.ask.escalated).toBe(true);
    expect(d.ask.actions.length).toBeGreaterThan(0);
    expect((await getJson("/api/issues/fac/1")).ask).toBeUndefined();
  });

  test("a closed issue returns none", async () => {
    const n = seed(true);
    writeList({ key: "fac" }, "close", (doc) => { setStatus(doc.items.find((x) => x.id === n && x.sub === undefined)!, "dropped"); }, true);
    expect((await getJson(`/api/issues/fac/${n}`)).ask).toBeUndefined();
  });
});

describe("the Issue timeline names why a wait waited", () => {
  const run = (kind: string, started: string, ended: string) => ({ kind, name: "fac-1", on: "fac-1", condition: "passed", started, ended });
  const d = (holds?: object[]) => ({ repo: "fac", id: 1, ref: "1", status: "done", frontmatter: { created: "2026-11-01" }, notes: [], commits: [], jobs: [], goals: [], holds,
    timeline: { filed: Date.parse("2026-11-01T10:00:00Z"), runs: [run("triage", "2026-11-01T10:00:30Z", "2026-11-01T10:02:00Z"), run("build", "2026-11-01T10:30:00Z", "2026-11-01T10:40:00Z")] } });
  const html = (x: any) => v.issueSegments(x).flatMap((s: any) => s.rows).flatMap((r: any) => r.events).map((e: any) => e.html).join("\n");
  test("an answer without holds keeps the plain text", () => {
    expect(html(d())).toContain("Waited 28 min.");
  });
});

describe("the drop note", () => {
  test("a reason becomes `Chris dropped: <reason>`; a Chris reason stays as it is", async () => {
    const real = process.env.ALEPH_CLI, wrap = join(base, "real-aleph");
    writeFileSync(wrap, `#!/bin/sh\nexec ${process.execPath} ${join(join(import.meta.dir, "../../ui"), "..", "jobs", "cli.ts")} "$@"\n`);
    chmodSync(wrap, 0o755);
    process.env.ALEPH_CLI = wrap;
    try {
      writeList({ key: "fac" }, "seed", (doc) => { add(doc, "drop x"); add(doc, "drop y"); return true; }, true);
      const ids = readList({ key: "fac" })!.items.map((i) => i.id).slice(-2);
      const h = { "x-aleph-ui": "1", "content-type": "application/json" };
      const last = (id: number) => { const n = readList({ key: "fac" })!.items.find((i) => i.id === id)!.notes; return n[n.length - 1]; };
      expect((await at(`/api/issues/fac/${ids[0]}/drop`, { method: "POST", headers: h, body: JSON.stringify({ reason: "x" }) })).status).toBe(200);
      expect(last(ids[0])).toMatch(/: Chris dropped: x$/);
      expect((await at(`/api/issues/fac/${ids[1]}/drop`, { method: "POST", headers: h, body: JSON.stringify({ reason: "Chris denied: y" }) })).status).toBe(200);
      expect(last(ids[1])).toMatch(/: Chris denied: y$/);
    } finally { if (real === undefined) delete process.env.ALEPH_CLI; else process.env.ALEPH_CLI = real; }
  });
});
