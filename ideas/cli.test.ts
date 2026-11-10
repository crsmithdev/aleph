import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../jobs/commands.ts";
import { allRuns } from "../jobs/lib/records/ledger.ts";

// The fake lens agent: it keeps its prompt, writes $FAKE_RESULT in its working directory unless that is "none", and ends as stream-json does.
const FAKE = `#!/usr/bin/env bash
cat > prompt.txt
[ "$FAKE_RESULT" = none ] || echo "# found" > "$FAKE_RESULT"
echo '{"type":"system","subtype":"init","session_id":"s1"}'
echo '{"type":"result","subtype":"success","is_error":false,"result":"ok","session_id":"s1","total_cost_usd":0.5}'
`;

let base = "", store = "", remote = "", restore = () => {};

const git = (cwd: string, ...args: string[]) => Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" }).stdout.toString().trim();

/** `aleph <argv>` in this process, with `stdin` and what it wrote to stderr. */
async function aleph(argv: string[], stdin = ""): Promise<{ out: string; err: string; code: number }> {
  let err = "";
  const r = await run(argv, { stderr: (s) => { err += s; }, stdin: async () => stdin });
  return { ...r, err };
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-ideas-"));
  store = join(base, "ideas");
  remote = join(base, "ideas.git");
  writeFileSync(join(base, "claude"), FAKE);
  chmodSync(join(base, "claude"), 0o755);
  writeFileSync(join(base, "repos.json"), JSON.stringify({ aleph: { path: base, code: "a" } }));
  const vars: Record<string, string> = {
    ALEPH_IDEAS: store, ALEPH_REPOS: join(base, "repos.json"), ALEPH_JOBS_DIR: join(base, "runs"), ALEPH_FACTORY_DIR: join(base, "factory"),
    ALEPH_ISSUES: join(base, "issues"), ALEPH_LENS_CMD: join(base, "claude"), FAKE_RESULT: "result.md", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
    GIT_COMMITTER_DATE: "2026-11-10T12:00:00",
  };
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  restore = () => { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; };
});
afterEach(() => { restore(); rmSync(base, { recursive: true, force: true }); });

/** The store as a clone of a bare `origin`. */
function withOrigin(): void {
  git(base, "init", "-q", "--bare", "-b", "main", remote);
  git(base, "clone", "-q", remote, store);
}

const idea = (slug: string) => readFileSync(join(store, slug, "idea.md"), "utf8");

test("add writes idea.md, prints the slug, and makes one commit that it pushes", async () => {
  withOrigin();
  const a = await aleph(["idea", "add", "Issue history", "--target", "aleph", "--sketch", "-"], "Keep each issue's history.\n");
  expect(a).toMatchObject({ code: 0, out: "issue-history\n", err: "" });
  expect(idea("issue-history")).toBe("---\ntitle: Issue history\ntarget: aleph\nstatus: exploring\nbuilt: []\n---\n\nKeep each issue's history.\n\n## Log\n");
  expect(git(store, "status", "--porcelain")).toBe("");
  expect(git(base, "--git-dir", remote, "log", "--format=%s", "main")).toBe("add issue-history");
});

test("add refuses a slug that exists and a target outside the registry", async () => {
  await aleph(["idea", "add", "Issue history"]);
  const again = await aleph(["idea", "add", "Issue  History!"]);
  expect(again.code).toBe(1);
  expect(again.err).toContain("issue-history");
  expect((await aleph(["idea", "add", "Other", "--target", "nope"])).code).toBe(1);
  expect(existsSync(join(store, "other"))).toBe(false);
});

test("add with no target writes no target, and the first write makes the store a git repo with no origin", async () => {
  const a = await aleph(["idea", "add", "A new tool"]);
  expect(a).toMatchObject({ code: 0, err: "" });
  expect(idea("a-new-tool")).not.toContain("target");
  expect(git(store, "log", "--format=%s")).toBe("add a-new-tool");
});

test("a failed push keeps the commit, warns and exits 0", async () => {
  withOrigin();
  git(store, "remote", "set-url", "origin", join(base, "nowhere.git"));
  const a = await aleph(["idea", "add", "Issue history"]);
  expect(a.code).toBe(0);
  expect(a.err).toContain("warn");
  expect(git(store, "log", "--format=%s")).toBe("add issue-history");
});

test("note appends a dated line under the log in local time, and edit replaces the write-up and keeps the rest", async () => {
  await aleph(["idea", "add", "Issue history", "--target", "aleph", "--sketch", "-"], "First sketch.");
  setSystemTime(new Date(2026, 10, 10, 9, 7));
  try {
    expect((await aleph(["idea", "note", "issue-history", "?", "who", "reads", "it"])).code).toBe(0);
  } finally {
    setSystemTime();
  }
  expect(idea("issue-history")).toEndWith("\n## Log\n\n- 2026-11-10 09:07 ? who reads it\n");
  expect((await aleph(["idea", "edit", "issue-history", "--writeup", "-"], "Second.\n\nWith two paragraphs.\n")).code).toBe(0);
  const text = idea("issue-history");
  expect(text).toStartWith("---\ntitle: Issue history\ntarget: aleph\nstatus: exploring\nbuilt: []\n---\n\nSecond.\n\nWith two paragraphs.\n\n## Log\n\n- ");
  expect(text).toContain("? who reads it");
  expect(git(store, "log", "--format=%s")).toBe("edit issue-history\nnote issue-history\nadd issue-history");
});

test("list prints the exploring ideas with their target, and --status the built or dropped ones", async () => {
  await aleph(["idea", "add", "Issue history", "--target", "aleph"]);
  await aleph(["idea", "add", "A new tool"]);
  await aleph(["idea", "add", "Old idea"]);
  expect((await aleph(["idea", "built", "issue-history", "aleph-1", "aleph-2"])).code).toBe(0);
  expect((await aleph(["idea", "drop", "old-idea"])).code).toBe(0);
  const day = "2026-11-10";
  expect((await aleph(["idea", "list"])).out).toBe(`a-new-tool  new project  -  ${day}\n`);
  expect((await aleph(["idea", "list", "--status", "built"])).out).toBe(`issue-history  aleph  -  ${day}\n`);
  expect((await aleph(["idea", "list", "--status", "dropped"])).out).toBe(`old-idea  new project  -  ${day}\n`);
  expect(idea("issue-history")).toContain("status: built\nbuilt: [aleph-1, aleph-2]\n");
  expect(idea("old-idea")).toContain("status: dropped\n");
});

test("show prints idea.md and its lens results", async () => {
  await aleph(["idea", "add", "Issue history", "--sketch", "-"], "Sketch.");
  const s = await aleph(["idea", "show", "issue-history"]);
  expect(s.out).toBe(`${idea("issue-history")}\n## Lens results\n\nnone\n`);
  expect((await aleph(["idea", "show", "nope"])).code).toBe(1);
});

test("save copies a result under its lens and local time, logs it, keeps each date, and refuses another extension", async () => {
  await aleph(["idea", "add", "Issue history"]);
  writeFileSync(join(base, "out.html"), "<p>prior</p>");
  writeFileSync(join(base, "out.md"), "# prior again");
  writeFileSync(join(base, "out.txt"), "no");
  try {
    setSystemTime(new Date(2026, 10, 9, 8, 5));
    expect((await aleph(["idea", "save", "issue-history", "prior-art", join(base, "out.html")])).code).toBe(0);
    setSystemTime(new Date(2026, 10, 10, 14, 30));
    expect((await aleph(["idea", "save", "issue-history", "prior-art", join(base, "out.md")])).code).toBe(0);
  } finally {
    setSystemTime();
  }
  expect(readdirSync(join(store, "issue-history", "lenses")).sort()).toEqual(["prior-art-2026-11-09-0805.html", "prior-art-2026-11-10-1430.md"]);
  expect(readFileSync(join(store, "issue-history", "lenses", "prior-art-2026-11-09-0805.html"), "utf8")).toBe("<p>prior</p>");
  expect(idea("issue-history")).toEndWith("- 2026-11-09 08:05 prior-art saved: lenses/prior-art-2026-11-09-0805.html\n- 2026-11-10 14:30 prior-art saved: lenses/prior-art-2026-11-10-1430.md\n");
  expect(git(store, "status", "--porcelain")).toBe("");
  expect(git(store, "log", "-1", "--format=%s")).toBe("save issue-history");
  expect((await aleph(["idea", "save", "issue-history", "prior-art", join(base, "out.txt")])).code).toBe(1);
  expect((await aleph(["idea", "list"])).out).toStartWith("issue-history  new project  prior-art  ");
  expect((await aleph(["idea", "show", "issue-history"])).out).toEndWith("## Lens results\n\n- prior-art 2026-11-09 08:05 lenses/prior-art-2026-11-09-0805.html\n- prior-art 2026-11-10 14:30 lenses/prior-art-2026-11-10-1430.md\n");
});

test("lens runs the lens skill on the idea as a lens run with its cost, and saves its result", async () => {
  await aleph(["idea", "add", "Issue history"]);
  const l = await aleph(["idea", "lens", "issue-history", "prior-art"]);
  expect(l).toMatchObject({ code: 0, err: "" });
  const saved = readdirSync(join(store, "issue-history", "lenses"));
  expect(saved).toEqual([expect.stringMatching(/^prior-art-\d{4}-\d\d-\d\d-\d{4}\.md$/)]);
  expect(readFileSync(join(store, "issue-history", "lenses", saved[0]), "utf8")).toBe("# found\n");
  expect(l.out).toBe(`lenses/${saved[0]}\n`);
  const [r] = allRuns().filter((e) => e.run.kind === "lens");
  expect(r.id).toEndWith("-lens-1");
  expect(r.run).toMatchObject({ name: "issue-history-prior-art", cost: 0.5, condition: "done" });
  expect(r.run.worktree).toBeUndefined();
  const prompt = readFileSync(join(r.folder, "prompt.txt"), "utf8");
  expect(prompt).toContain("# Prior Art");
  expect(prompt).toContain(join(store, "issue-history", "idea.md"));
});

test("lens saves an html result, refuses an unknown lens, and saves nothing when the run wrote no result", async () => {
  await aleph(["idea", "add", "Issue history"]);
  process.env.FAKE_RESULT = "result.html";
  expect((await aleph(["idea", "lens", "issue-history", "explainer"])).out).toMatch(/^lenses\/explainer-.*\.html\n$/);
  const bad = await aleph(["idea", "lens", "issue-history", "vibes"]);
  expect(bad.code).toBe(1);
  for (const k of ["prior-art", "red-team", "explainer"]) expect(bad.err).toContain(k);
  process.env.FAKE_RESULT = "none";
  const none = await aleph(["idea", "lens", "issue-history", "red-team"]);
  expect(none.code).toBe(1);
  expect(readdirSync(join(store, "issue-history", "lenses"))).toHaveLength(1);
  const runs = allRuns().filter((e) => e.run.kind === "lens");
  expect(runs).toHaveLength(2);
  expect(runs.find((e) => e.run.name === "issue-history-red-team")!.run.reason).toStartWith("failed");
});

test("no factory transition, routine or timer starts a lens run", () => {
  const p = Bun.spawnSync(["grep", "-rlE", "idea lens|ideas/ideas|\"idea\", \"lens\"", "jobs/lib", "jobs/systemd", "jobs/windows"], { cwd: join(import.meta.dir, ".."), stdout: "pipe" });
  expect(p.stdout.toString()).toBe("");
});
