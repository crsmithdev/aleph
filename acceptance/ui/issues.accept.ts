// Archived goal tests from ui/issues.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeList } from "../../todo/lib/store.ts";
import { add, setStatus, type Doc } from "../../todo/lib/todo.ts";
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

describe("views", () => {

  const section = (h: string, id: string) => h.split(`<div id="${id}">`)[1]?.split("</table>")[0] ?? "";

  test("the filter bar is one filterBar; the row is the link, the title plain text", async () => {
    const d = await getJson("/api/contents");
    const h = v.view.render(d, {}, new URLSearchParams("project=oth&status=any"));
    expect(h.match(/class="fbar"/g)).toHaveLength(3);
    for (const n of ["status", "priority"]) expect(h).toContain(`data-name="${n}"`);
    expect(h).toContain('<select name="project" aria-label="Project">');
    expect(h).toContain('name="q"');
    expect(section(h, "issues-table")).not.toContain("<td>fac</td>");
    expect(h).toContain("<td>oth</td>");
    expect(h).toContain('<tr class="rowlink"');
    expect(h).toContain('<td class="wide"><a href="#/issues/oth/1">other thing</a></td>');
  });

  test("the X drops through the issue's drop route", async () => {
    const d = await getJson("/api/contents");
    const open = v.issueRows(d).find((r: any) => r.status === "open");
    expect(v.dropTarget(open)).toMatchObject({ url: `/api/issues/${open.repo}/${open.n}/drop` });
    expect(v.dropTarget({ ...open, status: "done" })).toBeNull();
  });
});

describe("issue form project select", () => {
  test("renderForm gives a select of the keys", () => {
    const h = v.renderForm([], { keys: ["aleph", "sidetone"], project: "sidetone" });
    expect(h).toContain('<select name="repo"');
    expect(h.match(/<option /g)?.length).toBe(2);
    expect(h).toContain('<option value="sidetone" selected>');
  });
});
