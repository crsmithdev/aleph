import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../jobs/commands.ts";
import { allRuns } from "../jobs/lib/records/ledger.ts";
import { setModel } from "../jobs/lib/routing/models.ts";
import { writeRepos } from "../tests/projects.ts";

// The fake lens agent: it keeps its prompt, writes $FAKE_RESULT in its working directory unless that is "none", and ends as stream-json does.
const FAKE = `#!/usr/bin/env bash
cat > prompt.txt
[ "$FAKE_RESULT" = none ] || echo "# found" > "$FAKE_RESULT"
echo '{"type":"system","subtype":"init","session_id":"s1"}'
echo '{"type":"result","subtype":"success","is_error":false,"result":"ok","session_id":"s1","total_cost_usd":0.5}'
`;

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
  writeFileSync(join(base, "claude"), FAKE);
  chmodSync(join(base, "claude"), 0o755);
  writeRepos({ aleph: { path: base, code: "a" } }, items);
  const vars: Record<string, string> = {
    ALEPH_DB: join(base, "aleph.db"), ALEPH_JOBS_DIR: join(base, "jobs"), ALEPH_FACTORY_DIR: join(base, "factory"),
    ALEPH_ITEMS: items, ALEPH_LENS_CMD: join(base, "claude"), FAKE_RESULT: "result.md", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
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
  expect(a).toMatchObject({ code: 0, out: "d-00001\n", err: "" });
  expect(idea(1)).toBe("---\ntitle: Issue history\nproject: project.1\nstatus: exploring\nbuilt: []\n---\n\nKeep each issue's history.\n\n## Log\n");
  expect(git(items, "status", "--porcelain", "--untracked-files=no")).toBe("");
  expect(git(base, "--git-dir", remote, "log", "--format=%s", "main")).toBe("add idea.1\nstart");
});

test("add numbers each idea from the counter, takes a title that repeats, and refuses a target outside the registry", async () => {
  expect((await aleph(["idea", "add", "Issue history"])).out).toBe("d-00001\n");
  expect((await aleph(["idea", "add", "Issue  History!"])).out).toBe("d-00002\n");
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
  expect((await aleph(["idea", "built", "1", "issue.1", "a-00002"])).code).toBe(0);
  expect((await aleph(["idea", "drop", "d-00003"])).code).toBe(0);
  const day = "2026-11-10 12:00";
  expect((await aleph(["idea", "list"])).out).toBe(`d-00002  new project  -  ${day}\n`);
  expect((await aleph(["idea", "list", "--status", "built"])).out).toBe(`d-00001  aleph  -  ${day}\n`);
  expect((await aleph(["idea", "list", "--status", "dropped"])).out).toBe(`d-00003  new project  -  ${day}\n`);
  expect(idea(1)).toContain("status: built\nbuilt: [issue.1, issue.2]\n");
  expect(idea(3)).toContain("status: dropped\n");
});

test("show prints idea.md and its lens results", async () => {
  await aleph(["idea", "add", "Issue history", "--sketch", "-"], "Sketch.");
  const s = await aleph(["idea", "show", "1"]);
  expect(s.out).toBe(`${idea(1)}\n## Lens results\n\nnone\n`);
  expect((await aleph(["idea", "show", "nope"])).code).toBe(1);
  expect((await aleph(["idea", "show", "9"])).code).toBe(1);
});

test("save copies a result under its lens and local time, logs it, keeps each date, and refuses another extension", async () => {
  await aleph(["idea", "add", "Issue history"]);
  writeFileSync(join(base, "out.html"), "<p>prior</p>");
  writeFileSync(join(base, "out.md"), "# prior again");
  writeFileSync(join(base, "out.txt"), "no");
  try {
    setSystemTime(new Date(2026, 10, 9, 8, 5));
    expect((await aleph(["idea", "save", "1", "prior-art", join(base, "out.html")])).code).toBe(0);
    setSystemTime(new Date(2026, 10, 10, 14, 30));
    expect((await aleph(["idea", "save", "1", "prior-art", join(base, "out.md")])).code).toBe(0);
  } finally {
    setSystemTime();
  }
  expect(readdirSync(join(store, "1")).sort()).toEqual(["idea.md", "prior-art-2026-11-09-0805.html", "prior-art-2026-11-10-1430.md"]);
  expect(readFileSync(join(store, "1", "prior-art-2026-11-09-0805.html"), "utf8")).toBe("<p>prior</p>");
  expect(idea(1)).toEndWith("- 2026-11-09 08:05 prior-art saved: prior-art-2026-11-09-0805.html\n- 2026-11-10 14:30 prior-art saved: prior-art-2026-11-10-1430.md\n");
  expect(git(items, "status", "--porcelain", "--untracked-files=no")).toBe("");
  expect(git(items, "log", "-1", "--format=%s")).toBe("save idea.1");
  expect((await aleph(["idea", "save", "1", "prior-art", join(base, "out.txt")])).code).toBe(1);
  expect((await aleph(["idea", "list"])).out).toStartWith("d-00001  new project  prior-art  ");
  expect((await aleph(["idea", "show", "1"])).out).toEndWith("## Lens results\n\n- prior-art 2026-11-09 08:05 prior-art-2026-11-09-0805.html\n- prior-art 2026-11-10 14:30 prior-art-2026-11-10-1430.md\n");
});

test("lens runs the lens skill on the idea as a lens run with its cost, and saves its result", async () => {
  await aleph(["idea", "add", "Issue history"]);
  const l = await aleph(["idea", "lens", "1", "prior-art"]);
  expect(l).toMatchObject({ code: 0, err: "" });
  const saved = readdirSync(join(store, "1")).filter((f) => f !== "idea.md");
  expect(saved).toEqual([expect.stringMatching(/^prior-art-\d{4}-\d\d-\d\d-\d{4}\.md$/)]);
  expect(readFileSync(join(store, "1", saved[0]), "utf8")).toBe("# found\n");
  expect(l.out).toBe(`${saved[0]}\n`);
  const [r] = allRuns().filter((e) => e.run.role === "lens");
  expect(r.id).toMatch(/^job\.\d+$/);
  expect(r.run).toMatchObject({ name: "1-prior-art", cost: 0.5, state: "done" });
  expect(r.run.worktree).toBeUndefined();
  const prompt = readFileSync(join(r.folder, "prompt.txt"), "utf8");
  expect(prompt).toContain("# Prior Art");
  expect(prompt).toContain(join(store, "1", "idea.md"));
});

test("a lens run records the model the lens setting names", async () => {
  await aleph(["idea", "add", "Issue history"]);
  expect(setModel("lens", { model: "sonnet" })).toBeNull();
  await aleph(["idea", "lens", "1", "prior-art"]);
  expect(allRuns().filter((e) => e.run.role === "lens").map((e) => e.run.model)).toEqual(["sonnet"]);
});

test("lens saves an html result, refuses an unknown lens, and saves nothing when the run wrote no result", async () => {
  await aleph(["idea", "add", "Issue history"]);
  process.env.FAKE_RESULT = "result.html";
  expect((await aleph(["idea", "lens", "1", "explainer"])).out).toMatch(/^explainer-.*\.html\n$/);
  const bad = await aleph(["idea", "lens", "1", "vibes"]);
  expect(bad.code).toBe(1);
  for (const k of ["prior-art", "red-team", "explainer"]) expect(bad.err).toContain(k);
  process.env.FAKE_RESULT = "none";
  const none = await aleph(["idea", "lens", "1", "red-team"]);
  expect(none.code).toBe(1);
  expect(readdirSync(join(store, "1")).filter((f) => f !== "idea.md")).toHaveLength(1);
  const runs = allRuns().filter((e) => e.run.role === "lens");
  expect(runs).toHaveLength(2);
  expect(runs.find((e) => e.run.name === "1-red-team")!.run.reason).toStartWith("failed");
});

test("no factory transition, routine or timer starts a lens run", () => {
  const p = Bun.spawnSync(["grep", "-rlE", "idea lens|ideas/ideas|\"idea\", \"lens\"", "jobs/lib", "jobs/systemd", "jobs/windows"], { cwd: join(import.meta.dir, ".."), stdout: "pipe" });
  expect(p.stdout.toString()).toBe("");
});
