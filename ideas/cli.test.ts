import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../cli/commands.ts";
import { writeRepos } from "../tests/projects.testkit.ts";

let base = "", items = "", store = "", remote = "", restore = () => {};

const git = (cwd: string, ...args: string[]) => Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" }).stdout.toString().trim();

/** `aleph <argv>` in this process, with `stdin` and what it wrote to stderr. */
async function aleph(argv: string[], stdin = ""): Promise<{ out: string; err: string; code: number }> {
  let err = "";
  const r = await run(argv, { stderr: (s) => { err += s; }, stdin: async () => stdin });
  return { ...r, err };
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-ideas-"));
  items = join(base, "items");
  store = join(items, "ideas");
  remote = join(base, "items.git");
  writeRepos({ aleph: { path: base, code: "a" } }, items);
  const vars: Record<string, string> = {
    ALEPH_DB: join(base, "aleph.db"), ALEPH_JOBS_DIR: join(base, "jobs"), ALEPH_FACTORY_DIR: join(base, "factory"),
    ALEPH_ITEMS: items, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
    GIT_COMMITTER_DATE: "2026-11-10T12:00:00",
  };
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  withOrigin();
  restore = () => { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; };
});
afterEach(() => { restore(); rmSync(base, { recursive: true, force: true }); });

/** The items repo as a clone of a bare `origin`, with one empty commit as the store needs. */
function withOrigin(): void {
  git(base, "init", "-q", "--bare", "-b", "main", remote);
  rmSync(items, { recursive: true, force: true });
  git(base, "clone", "-q", remote, items);
  git(items, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "start");
  git(items, "push", "-q", "origin", "main");
  writeRepos({ aleph: { path: base, code: "a" } }, items);
}

const idea = (n: number | string) => readFileSync(join(store, String(n), "idea.md"), "utf8");

test("add writes ideas/<n>/idea.md, prints its shown key, and makes one commit on origin/main", async () => {
  const a = await aleph(["idea", "add", "Issue history", "--target", "aleph", "--sketch", "-"], "Keep each issue's history.\n");
  expect(a).toMatchObject({ code: 0, out: "d1\n", err: "" });
  expect(idea(1)).toBe("---\ntitle: Issue history\nproject: project.1\nstatus: exploring\nbuilt: []\n---\n\nKeep each issue's history.\n\n## Log\n");
  expect(git(items, "status", "--porcelain", "--untracked-files=no")).toBe("");
  expect(git(base, "--git-dir", remote, "log", "--format=%s", "main")).toBe("add idea.1\nstart");
});

test("add numbers each idea from the counter, takes a title that repeats, and refuses a target outside the registry", async () => {
  expect((await aleph(["idea", "add", "Issue history"])).out).toBe("d1\n");
  expect((await aleph(["idea", "add", "Issue  History!"])).out).toBe("d2\n");
  expect((await aleph(["idea", "add", "Other", "--target", "nope"])).code).toBe(1);
  expect(existsSync(join(store, "3"))).toBe(false);
});

test("add with no target writes no project", async () => {
  const a = await aleph(["idea", "add", "A new tool"]);
  expect(a).toMatchObject({ code: 0, err: "" });
  expect(idea(1)).not.toContain("project");
  expect(git(items, "log", "--format=%s")).toBe("add idea.1\nstart");
});

test("a write with no reachable origin throws and commits nothing", async () => {
  git(items, "remote", "set-url", "origin", join(base, "nowhere.git"));
  await expect(aleph(["idea", "add", "Issue history"])).rejects.toThrow("fetch failed");
  expect(git(items, "log", "--format=%s")).toBe("start");
});

test("note appends a dated line under the log in local time, and edit replaces the write-up and keeps the rest", async () => {
  await aleph(["idea", "add", "Issue history", "--target", "aleph", "--sketch", "-"], "First sketch.");
  setSystemTime(new Date(2026, 10, 10, 9, 7));
  try {
    expect((await aleph(["idea", "note", "1", "?", "who", "reads", "it"])).code).toBe(0);
  } finally {
    setSystemTime();
  }
  expect(idea(1)).toEndWith("\n## Log\n\n- 2026-11-10 09:07 ? who reads it\n");
  expect((await aleph(["idea", "edit", "idea.1", "--writeup", "-"], "Second.\n\nWith two paragraphs.\n")).code).toBe(0);
  const text = idea(1);
  expect(text).toStartWith("---\ntitle: Issue history\nproject: project.1\nstatus: exploring\nbuilt: []\n---\n\nSecond.\n\nWith two paragraphs.\n\n## Log\n\n- ");
  expect(text).toContain("? who reads it");
  expect(git(items, "log", "--format=%s")).toBe("edit idea.1\nnote idea.1\nadd idea.1\nstart");
});

test("list prints the exploring ideas with their project, and --status the built or dropped ones", async () => {
  await aleph(["idea", "add", "Issue history", "--target", "aleph"]);
  await aleph(["idea", "add", "A new tool"]);
  await aleph(["idea", "add", "Old idea"]);
  expect((await aleph(["idea", "built", "1", "issue.1", "a2"])).code).toBe(0);
  expect((await aleph(["idea", "drop", "d3"])).code).toBe(0);
  const day = "2026-11-10 12:00";
  expect((await aleph(["idea", "list"])).out).toBe(`d2  new project  ${day}\n`);
  expect((await aleph(["idea", "list", "--status", "built"])).out).toBe(`d1  aleph  ${day}\n`);
  expect((await aleph(["idea", "list", "--status", "dropped"])).out).toBe(`d3  new project  ${day}\n`);
  expect(idea(1)).toContain("status: built\nbuilt: [issue.1, issue.2]\n");
  expect(idea(3)).toContain("status: dropped\n");
});

test("show prints idea.md", async () => {
  await aleph(["idea", "add", "Issue history", "--sketch", "-"], "Sketch.");
  const s = await aleph(["idea", "show", "1"]);
  expect(s.out).toBe(idea(1));
  expect((await aleph(["idea", "show", "nope"])).code).toBe(1);
  expect((await aleph(["idea", "show", "9"])).code).toBe(1);
});
