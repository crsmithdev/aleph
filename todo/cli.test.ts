import { expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { env, fx, remoteItem, sec, seed, sh, tasks, useFixture } from "./fixture.ts";

// Matches `--timeout=30000` in the package.json test script, so running this file by name gets the same limit.
setDefaultTimeout(30000);

// The CLI tests of `aleph issue`: one for each verb's wiring, and the ones whose output jobs/cli.ts builds. The
// verbs' other behaviour is tested in-process in todo/lib/issues.verbs.test.ts.
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

test("lint blocks on bad frontmatter and --fix repairs what it can", () => {
  seed(`# To do\n\n## 7. Broken\n---\nid: 9\nstatus: open\ncreated: 2026-09-01\n---\n\nBody.\n`);
  const bad = aleph("issue", "lint", "proj");
  expect(bad.code).toBe(1);
  expect(bad.err).toContain("updated is missing");
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

test("dates are local, not UTC", () => {
  // `bun test` pins TZ=UTC, so the stamp has to be read from a process that has
  // a real zone. At 18:06 in Los Angeles it is already tomorrow in UTC, and an
  // item filed that evening used to land on tomorrow's date.
  const lib = join(import.meta.dir, "lib", "todo.ts");
  const p = Bun.spawnSync(
    ["bun", "-e", `import {today,minute} from ${JSON.stringify(lib)};
       const e = new Date(2026, 8, 28, 18, 6);
       console.log(today(e), minute(e), today(), new Date().getDate());`],
    { env: { ...(process.env as Record<string, string>), TZ: "America/Los_Angeles" }, stdout: "pipe" },
  );
  const [day, date, time, now, dayOfMonth] = p.stdout.toString().trim().split(/[\s]+/);
  expect(`${day}`).toBe("2026-09-28");
  expect(`${date} ${time}`).toBe("2026-09-28 18:06");
  expect(now.endsWith(`-${dayOfMonth.padStart(2, "0")}`)).toBe(true);
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

test("list and lint with no repo cover the repos with a run or an item update in the last 7 days, the latest first", () => {
  writeFileSync(join(fx.base, "repos.json"), JSON.stringify({ proj: { path: fx.repo }, fresh: { path: fx.repo } }));
  const jobs = join(fx.base, "jobs");
  mkdirSync(jobs);
  const e = { ALEPH_JOBS_DIR: jobs };
  expect(alephWith(e, "issue", "add", "fresh", "A new item").code).toBe(0);
  expect(alephWith(e, "issue", "list").out).toBe("fresh\n  1  open    medium   A new item\n");
  // proj's only item is from September; a run today makes proj recent, and the latest.
  mkdirSync(join(jobs, "r1"));
  writeFileSync(join(jobs, "r1", "state.json"), JSON.stringify({ kind: "agent", name: "x", repo: "proj", job: "r1", condition: "landed", started: new Date().toISOString() }));
  expect(alephWith(e, "issue", "list").out).toBe("proj\n  3  open    medium   An old item\nfresh\n  1  open    medium   A new item\n");
  expect(JSON.parse(alephWith(e, "issue", "list", "--status", "done", "--json").out)).toEqual([]);
  const lint = alephWith(e, "issue", "lint");
  expect(lint.code).toBe(0);
  expect(JSON.parse(lint.out)).toEqual([{ repo: "proj", items: 1, findings: [] }, { repo: "fresh", items: 1, findings: [] }]);
  expect(alephWith(e, "issue", "show").code).toBe(1);
});

test("aleph issue is the only command: aleph todo is gone", () => {
  const before = sh(fx.base, "git", "--git-dir", fx.remote, "rev-parse", "main");
  expect(aleph("todo", "add", "proj", "Under the old name").code).toBe(1);
  expect(sh(fx.base, "git", "--git-dir", fx.remote, "rev-parse", "main")).toBe(before);
  const usage = aleph("nonsense").err;
  expect(usage).toContain("|issue|");
  expect(usage).not.toContain("todo");
});

test("hidden copies files into the store as one commit, lists them, and show counts them", () => {
  seed("# To do\n\n" + sec(3, "kind: goal"));
  const f = join(fx.base, "a.test.ts");
  writeFileSync(f, 'import { test } from "bun:test";\ntest("a", () => {});\n');
  expect(aleph("issue", "show", "proj", "3").out).toContain("hidden checks: 0");
  expect(aleph("issue", "hidden", "proj", "3").out).toContain("no hidden checks");
  const before = sh(fx.base, "git", "--git-dir", fx.remote, "rev-list", "--count", "main");
  const h = aleph("issue", "hidden", "proj", "3", f);
  expect(h.code).toBe(0);
  expect(Number(sh(fx.base, "git", "--git-dir", fx.remote, "rev-list", "--count", "main"))).toBe(Number(before) + 1);
  expect(sh(fx.base, "git", "--git-dir", fx.remote, "show", "main:proj/hidden/proj-3/a.test.ts")).toContain('test("a"');
  expect(aleph("issue", "hidden", "proj", "3").out.trim()).toBe("a.test.ts");
  expect(aleph("issue", "show", "proj", "3").out).toContain("hidden checks: 1");
  expect(aleph("issue", "hidden", "proj", "99", f).err).toContain("has no issue 99");
  expect(aleph("issue", "hidden", "proj", "3", join(fx.base, "nope.ts")).code).toBe(1);
});
