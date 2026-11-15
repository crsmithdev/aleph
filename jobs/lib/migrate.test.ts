import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { conn } from "../../lib/db.ts";
import { git } from "../../lib/git.ts";
import { migrateAsks, migrateCleanup, migrateStorage, plan, roots } from "./migrate.ts";

// A small old store in the shapes of the live one (names and texts made up): two projects, a part, media, an idea, one
// work with a build that a reviewer sent back, a second build, a land with no commit and a plain run, a chat run and a
// fixture record that decision 14 drops, an event log with the events it drops, and the factory state files.
const VARS = ["ALEPH_DB", "ALEPH_ITEMS", "ALEPH_JOBS_DIR", "ALEPH_FACTORY_DIR"] as const;
const was = Object.fromEntries(VARS.map((v) => [v, process.env[v]]));
let root = "", landed = "";

const put = (path: string, text: string | object): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof text === "string" ? text : `${JSON.stringify(text)}\n`);
};
const jl = (rows: object[]): string => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
const g = (cwd: string, ...args: string[]): string => { const r = git(cwd, "-c", "commit.gpgsign=false", ...args); if (!r.ok) throw new Error(`git ${args.join(" ")}: ${r.out}`); return r.out; };
/** A repo with one commit of `files` and a bare origin beside it that holds it. */
function repo(dir: string, files: Record<string, string>, message = "start"): void {
  mkdirSync(dir, { recursive: true });
  g(dir, "init", "-q", "-b", "main");
  for (const [f, t] of Object.entries(files)) put(join(dir, f), t);
  g(dir, "add", "-A");
  g(dir, "commit", "-q", "-m", message);
  g(dirname(dir), "init", "-q", "--bare", `${dir}-origin.git`);
  g(dir, "remote", "add", "origin", `${dir}-origin.git`);
  g(dir, "push", "-q", "origin", "main");
}

const task = (id: string, extra: string, body: string): string => `---\nid: ${id}\ntitle: "Title of ${id}"\ncreated: 2026-11-01\nkind: task\npriority: medium\nsource: chris\nareas: []\n${extra}---\n${body}`;
const run = (id: string, o: object): object => ({ kind: "build", job: id, name: "aleph-3", repo: "aleph", on: "aleph-3", condition: "done", told: true, shown: true, started: "2026-11-02T10:00:00.000Z", n: 1, id, ...o });

beforeAll(() => {
  process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = "t";
  process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = "t@t";
  root = mkdtempSync(join(tmpdir(), "aleph-migrate-"));
  process.env.ALEPH_DB = join(root, "aleph.db");
  process.env.ALEPH_ITEMS = join(root, "items");
  process.env.ALEPH_JOBS_DIR = join(root, "jobs");
  process.env.ALEPH_FACTORY_DIR = join(root, "factory");
  // The project repo: its landing commit holds the trailer of the work, as an old land wrote it.
  repo(join(root, "aleph-repo"), { "a.txt": "a" });
  put(join(root, "aleph-repo", "b.txt"), "b");
  g(join(root, "aleph-repo"), "add", "-A");
  g(join(root, "aleph-repo"), "commit", "-q", "-m", "land the work\n\nIssue: aleph-3\nJob: a3#2");
  g(join(root, "aleph-repo"), "push", "-q", "origin", "main");
  landed = g(join(root, "aleph-repo"), "rev-parse", "HEAD");
  put(join(root, "repos.json"), { aleph: { path: join(root, "aleph-repo"), code: "a", checks: [{ name: "tests", run: "bun test" }], sandbox: true }, side: { path: join(root, "side-repo"), code: "s" } });
  repo(join(root, "issues"), {
    "aleph/backlog/config.yml": "task_prefix: aleph\n",
    "aleph/backlog/tasks/aleph-3.md": task("aleph-3", "after: [aleph-3.1]\n", "<!-- request -->\nDo the thing.\n<!-- spec -->\n## Goal\n\nIt works.\n<!-- notes -->\n- 2026-11-01 14:03: triage: a note\n"),
    "aleph/backlog/tasks/aleph-3.1.md": task("aleph-3.1", "", "<!-- request -->\nA part.\n"),
    "side/backlog/tasks/side-1.md": task("side-1", "from: aleph-3\nmedia: [pic.png]\nclosed_as: done\nclosed_time: \"2026-11-03T01:00:00.000Z\"\n", "<!-- request -->\nSide request.\n"),
    "side/backlog/media/side-1/pic.png": "png",
    "aleph/hidden/aleph-3/x.test.ts": "hidden",
  });
  repo(join(root, "ideas"), { "idea.md": "---\ntitle: \"\"\nstatus: exploring\nbuilt: []\n---\n", "first-idea/idea.md": "---\ntitle: First idea\ntarget: aleph\nstatus: exploring\nbuilt: []\n---\n\n# First\n\n## Log\n", "first-idea/explainer-2026-11-02-0300.html": "<p>lens</p>" });
  const ids = ["20261102-030000-aleph-aleph-3-intake", "20261102-030100-aleph-aleph-3-agent", "20261102-030400-aleph-aleph-3-agent", "20261102-030900-aleph-aleph-3-land"];
  put(join(root, "jobs", "aleph-3.json"), {
    issue: "aleph-3", ask: { kind: "input", reason: "question", question: "Which?", options: [], why: [] }, askRun: ids[2], wait: { kind: "red", reason: "main is red", since: "2026-11-02T03:00:00.000Z" }, rounds: 1, cost: 1, asks: [{ set: "2026-11-02T03:04:30.000Z", reason: "question" }],
    runs: [
      run(ids[0], { kind: "intake", job: ids[0], name: "intake-aleph-3", started: "2026-11-02T03:00:00.000Z", n: 1, route: "build" }),
      run(ids[1], { job: ids[1], condition: "returned", started: "2026-11-02T03:01:00.000Z", ended: "2026-11-02T03:03:00.000Z", n: 2, cost: 0.5, model: "opus", failed: "review", next: "worker", review: { call: "returned", reason: "no test", model: "opus", cost: 0.2, seconds: 30 } }),
      run(ids[2], { job: ids[1], condition: "passed", started: "2026-11-02T03:04:00.000Z", ended: "2026-11-02T03:08:00.000Z", n: 3, cost: 0.4, model: "qwen3-coder", tier: "sonnet", touched: ["aleph-3.1"], review: { call: "passed", model: "opus" } }),
      run(ids[3], { kind: "land", job: ids[1], condition: "landed", started: "2026-11-02T03:09:00.000Z", ended: "2026-11-02T03:10:00.000Z", n: 4 }),
    ],
    events: [
      { at: "2026-11-02T03:00:30.000Z", kind: "started", what: "started" }, { at: "2026-11-02T03:01:00.000Z", kind: "rerun", what: "try again" },
      { at: "2026-11-02T03:02:00.000Z", kind: "rescued", run: ids[1], what: "claimed" }, { at: "2026-11-02T03:02:10.000Z", kind: "cap", what: "the run cap set an Ask" },
      { at: "2026-11-02T03:02:20.000Z", kind: "hold", what: "after aleph-3.1", data: { gate: "not-ready", event: { at: "2026-11-02T03:02:20.000Z", by: "gate", subject: "aleph-3", action: "after", on: ["aleph-3.1"] } } },
    ],
  });
  put(join(root, "jobs-archive", "md-audit.json"), { issue: "md-audit", ask: null, wait: null, rounds: 0, cost: 0, events: [], runs: [{ kind: "plain", name: "md-audit", condition: "done", told: true, started: "2026-11-01T00:00:00.000Z", job: "20261101-000000-md-audit-plain", ended: "2026-11-01T00:01:00.000Z", id: "20261101-000000-md-audit-plain", n: 1 }] });
  put(join(root, "jobs-archive", "chat-1.json"), { issue: "chat-1", ask: null, wait: null, rounds: 0, cost: 0, events: [], runs: [{ kind: "chat", name: "chat", condition: "done", told: true, started: "2026-11-01T02:00:00.000Z", job: "c1", id: "c1", n: 1 }] });
  put(join(root, "jobs-archive", "fac-1.json"), { issue: "fac-1", ask: null, wait: null, rounds: 0, cost: 0, events: [], runs: [] });
  // The run folders: a build with a reviewer's files, a land with a log, and a sandbox leftover.
  const runs = join(root, "runs");
  for (const id of ids) put(join(runs, id, "command.txt"), `aleph job ${id}\n`);
  put(join(runs, ids[1], "prompt.md"), "the prompt"); put(join(runs, ids[1], "output.log"), "{}\n"); put(join(runs, ids[1], "stderr.log"), "warn\n"); put(join(runs, ids[1], "pid"), "4242\n"); put(join(runs, ids[1], "exit"), "0\n");
  put(join(runs, ids[1], "review-prompt.md"), "review this"); put(join(runs, ids[1], "review.md"), "no test"); put(join(runs, ids[1], "review.json"), { verdict: "hold" }); put(join(runs, ids[1], "tmp", "x"), "x");
  put(join(runs, ids[3], "land.log"), "landed\n"); put(join(runs, ids[3], "next.log"), "next\n");
  // The event log, with the events decision 14 drops.
  put(join(root, "factory", "events", "2026-11-02.jsonl"), jl([
    { at: "2026-11-02T03:00:00.000Z", by: "gate", subject: "aleph-3", action: "running", on: ["a3#1"] },
    { at: "2026-11-02T03:04:30.000Z", by: "gate", subject: "aleph-3", action: "question" },
    { at: "2026-11-02T03:04:40.000Z", by: "gate", subject: "aleph-3", action: "question" },
    { at: "2026-11-02T03:09:00.000Z", by: "gate", subject: "aleph-3", action: "landed", on: ["a3#4"], commit: landed, cost: 0.1 },
    { at: "2026-11-02T03:09:30.000Z", by: "rule", subject: "aleph-3", action: "done", note: "its sub-issues are done" },
    { at: "2026-11-02T03:09:40.000Z", by: "rule", subject: "aleph-3.1", action: "busy", on: ["aleph-3"], file: "x.ts", sub: "protected" },
    { at: "2026-11-02T03:09:50.000Z", by: "human", subject: "question", action: "changed", sub: "question", to: "human", note: "set to Ask me" },
    { at: "2026-11-02T03:09:55.000Z", by: "rule", subject: "route", action: "routed", note: "cost 0.1 model m tier t p 0.8" },
    { at: "2026-11-02T03:09:56.000Z", by: "gate", subject: "fac-1", action: "question" },
    { at: "2026-11-02T03:09:57.000Z", by: "gate", subject: "chat", action: "done", on: ["chat#1"] },
    { at: "2026-11-02T03:09:58.000Z", by: "gate", subject: "Some Note", action: "refused", sub: "contradiction" },
  ]));
  put(join(root, "factory", "tick.json"), { last: { ci: "2026-11-02T03:00:00.000Z" }, missed: [], suite: { aleph: "abc" }, ran: { ci: { at: "2026-11-02T03:00:00.000Z", result: "0 red" }, monitor: { at: "2026-11-02T04:00:00.000Z", result: "ok" } } });
  put(join(root, "factory", "caps.json"), { live: 5 }); put(join(root, "factory", "paused"), "2026-11-02T05:00:00.000Z\n");
  put(join(root, "factory", "baseline.json"), { aleph: { repo: "aleph", commit: "abc", ok: true } }); put(join(root, "factory", "baseline.json.bak"), "{}");
  put(join(root, "factory", "flaky.json"), [{ repo: "aleph", check: "tests", run: "aleph", at: "2026-11-02T03:00:00.000Z" }]);
  put(join(root, "factory", "suite-history.jsonl"), jl([{ repo: "aleph", commit: "abc", at: "2026-11-02T03:00:00.000Z", ran: 5, passed: 5, failed: 0, skipped: 0, rerunPassed: 0 }]));
  put(join(root, "factory", "tick.converted"), ""); put(join(root, "factory", "words-migrated"), "x"); put(join(root, "factory", "ui-sessions.json"), "[]");
  put(join(root, "usage.jsonl"), jl([{ at: "2026-11-02T03:00:00.000Z", five_hour: 1, seven_day: 2, seven_day_resets_at: "2026-11-05T00:00:00+00:00" }]));
  put(join(root, "openrouter.jsonl"), jl([{ at: "2026-11-02T03:00:00.000Z", usage: 0.1 }])); put(join(root, "jev.jsonl"), jl([{ at: "2026-11-02T03:00:00.000Z", cost: 0.001 }]));
  put(join(root, "vault", "note.md"), "kept out of the backup");
});

afterAll(() => { for (const v of VARS) process.env[v] = was[v]; conn(); });

const counts = (text: string): string => text.slice(text.indexOf("counts:"), text.indexOf("unmapped keys:"));

test("the plan numbers the jobs by start order and maps the old keys", () => {
  const p = plan(roots());
  expect(p.unmapped.size).toBe(0);
  expect(p.problems).toEqual([]);
  const rows = p.jobs.map((j) => j.row);
  expect(rows.map((r) => [r.id, r.role, r.state])).toEqual([
    ["job.1", "plain", "done"], ["job.2", "intake", "done"], ["job.3", "build", "returned"], ["job.4", "review", "done"], ["job.5", "build", "passed"], ["job.6", "review", "done"], ["job.7", "land", "landed"],
  ]);
  const [, , returned, review, build2, , land] = rows;
  expect(review).toMatchObject({ prev: "job.3", target: "issue.3", model: "opus", cost: 0.2, size: null });
  // A build's size is from its old tier, else its model.
  expect([returned.size, build2.size]).toEqual(["large", "medium"]);
  expect(build2).toMatchObject({ prev: "job.3", target: "issue.3", was: expect.stringContaining("a3#3") });
  expect(land).toMatchObject({ prev: "job.5", commit_sha: landed, project: "aleph" });
  // The commit that the old trailer names goes to the work's first job too.
  expect(returned).toMatchObject({ commit_sha: landed, was: expect.stringMatching(/^a3#2 /), pid: 4242, exit_code: 0 });
  expect(JSON.parse(build2.extra!)).toMatchObject({ touched: ["issue.4"], review: { call: "passed" } });
  expect(JSON.parse(returned.extra!)).toMatchObject({ rescued: "claimed", failed: "review" });
  expect(p.issueState).toEqual([expect.objectContaining({ issue: "issue.3", ask_job: "job.5", wait_kind: "red" })]);
});

test("--dry-run prints the counts and the unmapped keys, and writes nothing", () => {
  const out = migrateStorage(true);
  expect(out).toContain("jobs: 7");
  expect(out).toContain("issues: 3");
  expect(out).toContain("unmapped keys: 0");
  expect(out).toContain("chat runs: 1");
  expect(out).toContain("events: route and routed events: 1");
  expect(existsSync(join(root, "aleph.db"))).toBe(false);
  expect(existsSync(join(root, "issues"))).toBe(true);
  put(join(root, "issues", "aleph", "backlog", "tasks", "aleph-3.1.md"), task("aleph-3.1", "weird: 1\n", "<!-- request -->\nA part.\n"));
  g(join(root, "issues"), "add", "-A"); g(join(root, "issues"), "commit", "-q", "-m", "weird"); g(join(root, "issues"), "push", "-q", "origin", "main");
  expect(migrateStorage(true)).toContain("issue field: weird");
  expect(() => migrateStorage(false)).toThrow(/issue field: weird/);
  expect(existsSync(join(root, "aleph.db"))).toBe(false);
  put(join(root, "issues", "aleph", "backlog", "tasks", "aleph-3.1.md"), task("aleph-3.1", "", "<!-- request -->\nA part.\n"));
  g(join(root, "issues"), "add", "-A"); g(join(root, "issues"), "commit", "-q", "-m", "unweird"); g(join(root, "issues"), "push", "-q", "origin", "main");
});

test("cleanup refuses before a migration has passed its check", () => {
  expect(() => migrateCleanup()).toThrow(/no migration has passed/);
});

test("the asks backfill refuses before a migration has passed its check", () => {
  expect(() => migrateAsks()).toThrow(/no migration has passed/);
});

test("the real run backs up, converts, checks and pushes, with the counts of the dry run", () => {
  const dry = migrateStorage(true);
  const out = migrateStorage(false);
  expect(counts(out)).toBe(counts(dry));
  expect(out).toMatch(/check: ok, \d+ runs compared/);
  expect(out).toContain("items pushed and verified");
  const names = Bun.spawnSync(["tar", "-tzf", join(root, "backups", readdirSync(join(root, "backups"))[0])], { stdout: "pipe" }).stdout.toString();
  expect(names).toContain("./repos.json");
  expect(names).not.toContain("vault");
  // Rows.
  const q = (sql: string) => conn().query(sql).all() as Record<string, any>[];
  expect(q("SELECT count(*) AS n FROM jobs")[0].n).toBe(7);
  expect(q("SELECT * FROM counters").map((c) => [c.kind, c.last]).sort()).toEqual([["idea", 1], ["issue", 5], ["job", 7], ["project", 2]]);
  expect(q("SELECT time, subject, action, object, detail FROM events ORDER BY seq")).toEqual([
    { time: "2026-11-02T03:00:00.000Z", subject: "gate", action: "running", object: "job.2", detail: null },
    { time: "2026-11-02T03:00:30.000Z", subject: "rule", action: "started", object: "issue.3", detail: null },
    { time: "2026-11-02T03:01:00.000Z", subject: "rule", action: "reran", object: "issue.3", detail: "try again" },
    { time: "2026-11-02T03:02:20.000Z", subject: "gate", action: "after", object: "issue.3", detail: "issue.4" },
    { time: "2026-11-02T03:04:30.000Z", subject: "gate", action: "question", object: "issue.3", detail: null },
    { time: "2026-11-02T03:04:40.000Z", subject: "gate", action: "question", object: "issue.3", detail: null },
    { time: "2026-11-02T03:09:00.000Z", subject: "gate", action: "landed", object: "job.7", detail: null },
    { time: "2026-11-02T03:09:30.000Z", subject: "rule", action: "done", object: "issue.3", detail: "its sub-issues are done" },
    { time: "2026-11-02T03:09:40.000Z", subject: "rule", action: "busy", object: "issue.4", detail: "a protected file: x.ts: issue.3" },
    { time: "2026-11-02T03:09:50.000Z", subject: "human", action: "changed", object: "settings", detail: "a question: set to Ask me" },
  ]);
  expect(q("SELECT * FROM tick ORDER BY step")).toEqual([{ step: "ci", last: "2026-11-02T03:00:00.000Z", result: "0 red" }, { step: "monitor", last: "2026-11-02T04:00:00.000Z", result: "ok" }]);
  expect(q("SELECT key, value FROM settings ORDER BY key").map((s) => s.key)).toEqual(["caps", "paused"]);
  expect(q("SELECT * FROM suite_history")[0]).toMatchObject({ repo: "aleph", commit_sha: "abc", ran: 5 });
  // Folders: sections in log.txt, the reviewer's files in its job, and the sandbox leftovers gone.
  const jobs = join(root, "jobs");
  expect(readFileSync(join(jobs, "3", "log.txt"), "utf8")).toBe("=== command ===\naleph job 20261102-030100-aleph-aleph-3-agent\n=== stderr ===\nwarn\n");
  expect(readdirSync(join(jobs, "3")).sort()).toEqual(["exit", "log.txt", "pid", "prompt.md", "transcript.jsonl"]);
  expect(readdirSync(join(jobs, "4")).sort()).toEqual(["prompt.md", "result.md", "review.json"]);
  expect(readFileSync(join(jobs, "4", "prompt.md"), "utf8")).toBe("review this");
  expect(readFileSync(join(jobs, "7", "log.txt"), "utf8")).toContain("=== dispatch ===\nnext\n=== land ===\nlanded\n");
  // Items: the issue files in the new format, the media, the project and idea files, one history.
  const items = join(root, "items");
  expect(readFileSync(join(items, "issues", "3", "issue.md"), "utf8")).toBe(
    "---\nproject: project.1\ntitle: Title of aleph-3\nkind: task\npriority: medium\nsource: chris\ncreated: \"2026-11-01T00:00:00.000Z\"\nafter: [issue.4]\nareas: []\n---\n\n# Request\n\nDo the thing.\n\n# Spec\n\n## Goal\n\nIt works.\n\n# Notes\n\n- 2026-11-01T14:03:00.000Z: triage: a note\n");
  expect(readFileSync(join(items, "issues", "4", "issue.md"), "utf8")).toContain("from: issue.3");
  expect(readFileSync(join(items, "issues", "5", "issue.md"), "utf8")).toContain("closed_at: \"2026-11-03T01:00:00.000Z\"");
  expect(readFileSync(join(items, "issues", "5", "pic.png"), "utf8")).toBe("png");
  expect(existsSync(join(items, "issues", "3", "x.test.ts")) || existsSync(join(items, "aleph"))).toBe(false);
  expect(readFileSync(join(items, "projects", "2", "project.md"), "utf8")).toContain("name: side");
  expect(readFileSync(join(items, "ideas", "1", "idea.md"), "utf8")).toContain("project: project.1");
  expect(existsSync(join(items, "ideas", "1", "explainer-2026-11-02-0300.html"))).toBe(true);
  expect(g(items, "log", "--format=%s", "-3")).toBe("number the ideas\nmerge the ideas repo\nrestructure into projects and issues");
  expect(g(items, "rev-parse", "HEAD")).toBe(g(items, "ls-remote", "origin", "refs/heads/main").split(/\s/)[0]);
  // The old files are in place until cleanup, and a second run refuses.
  expect(existsSync(join(root, "runs"))).toBe(true);
  expect(() => migrateStorage(false)).toThrow(/already migrated|already holds jobs/);
});

test("the asks backfill sets the reason of a question event from the backup's records, once", () => {
  const events = () => conn().query("SELECT seq, time, subject, action, object, detail FROM events ORDER BY seq").all() as Record<string, any>[];
  const at = "2026-11-02T03:04:30.000Z";
  conn().query("UPDATE events SET detail = NULL WHERE action = 'question' AND time = ?").run(at);
  const before = events();
  expect(migrateAsks()).toBe("filled 1 events, no reason found for 1");
  expect(events()).toEqual(before.map((e) => (e.time === at ? { ...e, detail: "question" } : e)));
  expect(migrateAsks()).toBe("filled 0 events, no reason found for 1");
});

test("cleanup deletes the old files and keeps the live ones", () => {
  migrateCleanup();
  for (const gone of ["runs", "jobs-archive", "repos.json", "usage.jsonl", "ideas", "jobs/aleph-3.json", "factory/events", "factory/tick.json", "factory/tick.converted", "factory/words-migrated", "factory/baseline.json.bak"]) expect(existsSync(join(root, gone))).toBe(false);
  for (const kept of ["aleph.db", "items", "jobs/3", "factory/ui-sessions.json", "vault"]) expect(existsSync(join(root, kept))).toBe(true);
  expect(statSync(join(root, "jobs", "7")).isDirectory()).toBe(true);
});
