import { expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { env, fx, remoteItem, seed, sh, tasks, useFixture } from "./fixture.ts";
import { clock, renderItem, titleProblem } from "./lib/todo.ts";
import { putRun } from "../jobs/lib/records/record.ts";

// Matches `--timeout=30000` in the package.json test script, so running this file by name gets the same limit.
setDefaultTimeout(30000);

// The CLI tests of `aleph issue`: one for each verb's wiring, and the ones whose output jobs/cli.ts builds. The
// verbs' other behaviour is tested in-process in issues/lib/issues.verbs.test.ts.
const CLI = join(import.meta.dir, "..", "jobs", "cli.ts");

function aleph(...args: string[]): { code: number; out: string; err: string } {
  return alephWith({}, ...args);
}
function alephWith(extra: Record<string, string>, ...args: string[]): { code: number; out: string; err: string } {
  return alephIn(extra, undefined, ...args);
}
function alephIn(extra: Record<string, string>, stdin: string | undefined, ...args: string[]): { code: number; out: string; err: string } {
  const p = Bun.spawnSync(["bun", CLI, ...args], { env: env(extra), stdin: stdin === undefined ? "ignore" : new Blob([stdin]), stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
}

useFixture();

test("a write is one commit on the store's origin/main, the store's checkout follows, and no product repo moves", () => {
  const before = sh(fx.items, "git", "rev-parse", "HEAD");
  const product = sh(fx.base, "git", "--git-dir", fx.repoRemote, "rev-parse", "main");
  const a = aleph("issue", "add", "proj", "Teach the gate to count");
  expect(a.code).toBe(0);
  const head = sh(fx.base, "git", "--git-dir", fx.remote, "rev-parse", "main");
  expect(JSON.parse(a.out).commit).toBe(head);
  expect(sh(fx.base, "git", "--git-dir", fx.remote, "rev-parse", "main~1")).toBe(before);
  expect(sh(fx.base, "git", "--git-dir", fx.remote, "diff", "--name-only", "main~1", "main")).toBe(`${tasks}/proj-4.md`);
  expect(sh(fx.base, "git", "--git-dir", fx.remote, "log", "-1", "--format=%s", "main")).toBe("proj: todo: add an item");
  expect(remoteItem(4)).toContain("id: proj-4\ntitle: Teach the gate to count\n");
  expect(sh(fx.items, "git", "rev-parse", "HEAD")).toBe(head);
  expect(sh(fx.items, "git", "status", "--porcelain")).toBe("");
  expect(sh(fx.base, "git", "--git-dir", fx.repoRemote, "rev-parse", "main")).toBe(product);
});

test("a worker's push block does not stop a to-do write", () => {
  const w = alephWith({ GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: `url.${join(fx.base, "nowhere")}.pushInsteadOf`, GIT_CONFIG_VALUE_0: fx.remote }, "issue", "note", "proj", "3", "from a worker");
  expect(w.code).toBe(0);
  expect(remoteItem(3)).toContain("from a worker");
});

test("--kind reaches add, edit and list, and an unknown kind is refused", () => {
  const bad = aleph("issue", "add", "proj", "Fix the lane", "--kind", "epic");
  expect(bad.code).toBe(1);
  for (const k of ["task", "bug", "check", "flake"]) expect(bad.err).toContain(k);
  expect(bad.err).not.toContain("proposal");
  expect(aleph("issue", "add", "proj", "Fix the lane", "--kind", "proposal").code).toBe(1);
  for (const usage of [aleph("issue"), aleph("issue", "nope", "proj")]) {
    expect(usage.code).toBe(1);
    expect(usage.err).toContain("--kind task|bug|check|flake|acceptance");
  }
  expect(aleph("issue", "add", "proj", "Fix the lane height", "--kind", "bug").code).toBe(0);
  expect(remoteItem(4)).toContain("kind: bug\n");
  expect(aleph("issue", "edit", "proj", "3", "--kind", "check").code).toBe(0);
  expect(remoteItem(3)).toContain("kind: check\n");
  expect(JSON.parse(aleph("issue", "list", "proj", "--kind", "bug", "--json").out).map((r: any) => r.id)).toEqual([4]);
});

test("lint blocks on bad frontmatter and --fix repairs what it can", () => {
  seed(`# To do\n\n## 7. Broken\n---\nid: 9\nstatus: open\ncreated: 2026-09-01\n---\n\nBody.\n`);
  const bad = aleph("issue", "lint", "proj");
  expect(bad.code).toBe(1);
  expect(bad.err).toContain("updated_time is missing");
  const fixed = aleph("issue", "lint", "proj", "--fix");
  expect(fixed.code).toBe(0);
  expect(JSON.parse(fixed.out).fixed.length).toBeGreaterThan(0);
  expect(aleph("issue", "lint", "proj").code).toBe(0);
});

test("add starts a list for a repo that has none; every other verb refuses", () => {
  seed(null);
  expect(aleph("issue", "list", "nope").err).toContain("no repo named nope");
  expect(aleph("issue", "list", "proj").code).toBe(1);
  expect(aleph("issue", "list", "proj").err).toContain("the work store has no list for proj");
  const a = aleph("issue", "add", "proj", "The first thing");
  expect(a.code).toBe(0);
  expect(JSON.parse(a.out).added).toBe(1);
  expect(sh(fx.base, "git", "--git-dir", fx.remote, "show", "main:proj/backlog/config.yml")).toContain('task_prefix: "proj"');
  expect(JSON.parse(aleph("issue", "list", "proj", "--json").out)).toHaveLength(1);
  expect(aleph("issue", "lint", "proj").code).toBe(0);
});

test("the duplicate warning names the item with the repo's key", async () => {
  // The stub answers item 3 at 0.9, above the 0.7 cut, so the add warns about it.
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body: any = await req.json();
      const answers = Object.fromEntries(Object.keys(body.questions).map((id) => [id, { type: "noul", noul: id === "item:3" ? 0.9 : 0.1 }]));
      return Response.json({ model: "typesafe/jev-1.13", answers });
    },
  });
  try {
    // Await the spawn: a synchronous one blocks the event loop, so this stub could not answer it.
    const p = Bun.spawn(["bun", CLI, "issue", "add", "proj", "An old item again"], {
      // ALEPH_JUDGE empty is how a child says "not haiku": judgeChoice reads "" as jev.
      env: env({ ALEPH_JUDGE: "", ALEPH_JEV_URL: `http://127.0.0.1:${server.port}/`, OPENROUTER_API_KEY: "k-test" }),
      stdin: "ignore", stdout: "pipe", stderr: "pipe",
    });
    const [code, , err] = await Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()]);
    expect(code).toBe(0);
    expect(err).toContain("proj-3 may be the same task: An old item");
    expect(err).not.toContain("aleph-3");
  } finally { server.stop(true); }
});

test("dates are local, not UTC", () => {
  // `bun test` pins TZ=UTC, so the stamp has to be read from a process that has
  // a real zone. At 18:06 in Los Angeles it is already tomorrow in UTC, and an
  // item filed that evening used to land on tomorrow's date.
  const lib = join(import.meta.dir, "lib", "todo.ts");
  const p = Bun.spawnSync(
    ["bun", "-e", `import {today,minute} from ${JSON.stringify(lib)};
       import {setSystemTime} from "bun:test";
       const e = new Date(2026, 8, 28, 18, 6);
       setSystemTime(e);
       console.log(today(e), minute(e), today());`],
    { env: { ...(process.env as Record<string, string>), TZ: "America/Los_Angeles" }, stdout: "pipe" },
  );
  const [day, time, now] = p.stdout.toString().trim().split(/[\s]+/);
  expect(`${day}`).toBe("2026-09-28");
  expect(time).toBe("2026-09-29T01:06:00.000Z");
  expect(now).toBe("2026-09-28");
});

test("edit replaces the title, body, priority and labels it is given, and keeps the notes", () => {
  aleph("issue", "add", "proj", "Old title", "--labels", "a");
  aleph("issue", "note", "proj", "4", "a finding");
  const e = alephIn({}, "The new body.\n", "issue", "edit", "proj", "4", "--title", "New title", "--request", "-", "--priority", "high");
  expect(e.code).toBe(0);
  expect(JSON.parse(e.out)).toMatchObject({ id: 4, title: "New title", priority: "high", areas: ["a"] });
  const shown = JSON.parse(aleph("issue", "show", "proj", "4", "--json").out);
  expect(shown).toMatchObject({ title: "New title", request: "The new body.", priority: "high", areas: ["a"] });
  expect(shown.notes[0]).toContain("a finding");
  expect(JSON.parse(aleph("issue", "edit", "proj", "4", "--labels", "b,c").out).areas).toEqual(["b", "c"]);
  expect(sh(fx.base, "git", "--git-dir", fx.remote, "log", "-1", "--format=%s", "main")).toBe("proj: todo: edit item 4");
});

test("list and show print a part's ref, and the list column is right-aligned on the longest ref", () => {
  seed(`# To do\n\n## 5. Parent\n---\nid: 5\nstatus: open\ncreated: 2026-09-01\nupdated: 2026-09-01\npriority: medium\n---\n\nBody.\n`);
  writeFileSync(join(fx.items, tasks, "proj-5.1.md"), renderItem("proj", { id: 5, sub: 1, title: "A part", fm: { kind: "task", priority: "medium" }, request: "Body.", spec: "", notes: [] }));
  sh(fx.items, "git", "add", "-A");
  sh(fx.items, "git", "commit", "-qm", "seed part");
  sh(fx.items, "git", "push", "-q", "origin", "main");
  expect(aleph("issue", "list", "proj").out).toBe("  5  open    medium   Parent\n5.1  open    medium   A part\n");
  expect(aleph("issue", "show", "proj", "5.1").out.split("\n")[0]).toBe("## 5.1. A part");
});

test("list and lint with no repo cover the repos with a run or an item update in the last 7 days, the latest first", () => {
  writeFileSync(join(fx.base, "repos.json"), JSON.stringify({ proj: { path: fx.repo }, fresh: { path: fx.repo } }));
  const jobs = join(fx.base, "jobs");
  mkdirSync(jobs);
  const e = { ALEPH_JOBS_DIR: jobs };
  expect(alephWith(e, "issue", "add", "fresh", "A new item").code).toBe(0);
  expect(alephWith(e, "issue", "list").out).toBe("fresh\n  1  open    medium   A new item\n");
  // proj's only item is from September; a run today makes proj recent, and the latest.
  mkdirSync(join(jobs, "r1"));
  const saved = process.env.ALEPH_JOBS_DIR;
  process.env.ALEPH_JOBS_DIR = jobs;
  putRun("r1", { n: 1, kind: "agent", name: "x", repo: "proj", job: "r1", condition: "landed", started: clock().toISOString() } as any);
  // Assigning undefined would set the string "undefined", and a later test's records would land in ./undefined/.
  if (saved === undefined) delete process.env.ALEPH_JOBS_DIR; else process.env.ALEPH_JOBS_DIR = saved;
  expect(alephWith(e, "issue", "list").out).toBe("proj\n  3  open    medium   An old item\nfresh\n  1  open    medium   A new item\n");
  expect(JSON.parse(alephWith(e, "issue", "list", "--status", "done", "--json").out)).toEqual([]);
  const lint = alephWith(e, "issue", "lint");
  expect(lint.code).toBe(1);
  expect(JSON.parse(lint.out)).toEqual([{ repo: "proj", items: 1, findings: [{ id: "3", problem: "kind is missing", fixable: true }] }, { repo: "fresh", items: 1, findings: [] }]);
  expect(alephWith(e, "issue", "show").code).toBe(1);
});

test("aleph issue is the only command: aleph todo is gone", () => {
  const before = sh(fx.base, "git", "--git-dir", fx.remote, "rev-parse", "main");
  expect(aleph("todo", "add", "proj", "Under the old name").code).toBe(1);
  expect(sh(fx.base, "git", "--git-dir", fx.remote, "rev-parse", "main")).toBe(before);
  const usage = aleph("nonsense").err;
  expect(usage).toContain("|issue|");
  expect(aleph("issue").err).toContain("retitle");
  expect(usage).not.toContain("todo");
});


test("a short ID names the issue in the repo slot of show and note", () => {
  const short = aleph("issue", "show", "p3", "--json");
  const long = aleph("issue", "show", "proj", "3", "--json");
  expect([short.code, long.code]).toEqual([0, 0]);
  const [a, b] = [JSON.parse(short.out), JSON.parse(long.out)];
  expect(a.id).toBe(b.id);
  expect(a.title).toBe(b.title);
  expect(aleph("issue", "note", "p3", "short-form-note").code).toBe(0);
  expect(remoteItem(3)).toContain("short-form-note");
});

test("retitle prints the ids it retitled", () => {
  seed("# To do\n\n## 9. Check foo: bar\n---\nid: 9\nstatus: open\ncreated: 2026-09-01\nupdated: 2026-09-01\npriority: medium\n---\n\nBody.\n");
  const r = aleph("issue", "retitle", "proj");
  expect(r.code).toBe(0);
  const item = remoteItem(9);
  const title = /^title: (.*)$/m.exec(item)![1];
  expect(titleProblem(title)).toBeNull();
  expect(r.out).toBe(`proj-9: ${title}\n`);
  expect(item).toContain("retitled from: Check foo: bar");
});
