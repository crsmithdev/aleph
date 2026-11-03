// Archived goal tests from ui/actions.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readList, writeList } from "../../todo/lib/store.ts";
import { add, addPart } from "../../todo/lib/todo.ts";
import { withEnv, withServer } from "../../ui/test-server.ts";

let base: string, stop: () => void, restoreEnv: () => void, at: (path: string, init?: RequestInit) => Promise<Response>, calls: string;
const post = (p: string, headers: Record<string, string> = { "X-Aleph-UI": "1" }, body?: object) =>
  at(p, { method: "POST", headers, body: body ? JSON.stringify(body) : undefined });
const sh = (cwd: string, ...a: string[]) => { const p = Bun.spawnSync(["git", "-C", cwd, ...a]); if (p.exitCode) throw new Error(p.stderr.toString()); };
const recorded = () => (existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").filter(Boolean) : []);

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), "aleph-ui-actions-"));
  const repo = join(base, "repo");
  mkdirSync(repo);
  sh(repo, "init", "-q", "-b", "main");
  sh(repo, "config", "user.email", "t@t"); sh(repo, "config", "user.name", "t");
  writeFileSync(join(repo, "a.txt"), "one\n");
  sh(repo, "add", "."); sh(repo, "commit", "-qm", "base");
  sh(repo, "update-ref", "refs/remotes/origin/main", "HEAD");
  sh(repo, "checkout", "-qb", "job/x");
  writeFileSync(join(repo, "a.txt"), "two\n");
  sh(repo, "commit", "-qam", "change");
  sh(repo, "checkout", "-q", "main");
  writeFileSync(join(repo, "b.txt"), "main moved\n");
  sh(repo, "add", "."); sh(repo, "commit", "-qm", "main moves on");
  writeFileSync(join(base, "repos.json"), JSON.stringify({ r: { path: repo } }));
  for (const [name, extra] of [["x", { branch: "job/x" }], ["nobranch", {}], ["asks", { ask: { kind: "input", reason: "question", question: "which colour?", options: [], why: [] } }], ["stuckjob", { condition: "stuck" }], ["wt", { on: "r-7" }], ["wtgone", { on: "r-99" }], ["won", { on: "r-5" }], ["wgoal", { on: "r-6.1" }]] as const) {
    const folder = join(base, "jobs", `20261027-100000-r-${name}-agent`);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "state.json"), JSON.stringify({ kind: "build", condition: "awaiting", started: new Date().toISOString(), name, job: name, repo: "r", ...extra }));
  }
  // The work store, with issue 7 of `r` for the Wait button to set `after` on.
  const itemsRemote = join(base, "items.git"), items = join(base, "items");
  sh(base, "init", "-q", "--bare", "-b", "main", itemsRemote);
  sh(base, "clone", "-q", itemsRemote, items);
  sh(items, "config", "user.email", "t@t"); sh(items, "config", "user.name", "t");
  sh(items, "commit", "-q", "--allow-empty", "-m", "start");
  sh(items, "push", "-q", "origin", "main");
  calls = join(base, "calls");
  const fake = join(base, "fake-aleph");
  writeFileSync(fake, `#!/bin/sh\necho "$*" >> ${calls}\nif [ "$4" = "--spec" ]; then cat >> ${calls}.stdin; fi\nif [ "$1 $2" = "issue edit" ] && [ -e ${base}/fail-edit ]; then echo "edit refused" >&2; exit 1; fi\nif [ "$3" = "no-such-reason" ]; then echo "no such reason" >&2; exit 1; fi\necho out\nexit 0\n`);
  chmodSync(fake, 0o755);
  restoreEnv = withEnv({ GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", ALEPH_JOBS_DIR: join(base, "jobs"), ALEPH_REPOS: join(base, "repos.json"), ALEPH_ISSUES: join(base, "items"), ALEPH_FACTORY_DIR: join(base, "factory"), ALEPH_CLI: fake });
  ({ stop, at } = await withServer({ warm: false }));
  writeList({ key: "r" }, "seed", (doc) => { for (let i = 1; i <= 9; i++) { add(doc, `issue ${i}`, i === 7 ? { spec: "Do it." } : {}); } for (const n of [6, 9]) addPart(doc, doc.items.find((x) => x.id === n && x.sub === undefined)!, { title: `goal ${n}`, spec: "x" }); return true; }, true);
});
afterAll(() => {
  stop();
  restoreEnv();
  rmSync(base, { recursive: true, force: true });
});

test("POST /api/land runs `aleph land x` and returns its code", async () => {
  const res = await post("/api/land/x");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ code: 0, stdout: "out\n", stderr: "" });
  expect(recorded()).toEqual(["land x"]);
});

test("POST /api/recheck runs `aleph recheck x`", async () => {
  const res = await post("/api/recheck/x");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ code: 0, stdout: "out\n", stderr: "" });
  expect(recorded().at(-1)).toBe("recheck x");
});

const waiting = (n: number) => readList({ key: "r" })!.items.find((i) => i.id === n && (n === 6 ? i.sub === 1 : i.sub === undefined))!.fm.after;

test("POST /api/wait sets the item's after in process, then drops the job", async () => {
  const before = recorded().length;
  const res = await post("/api/wait/wt", { "X-Aleph-UI": "1" }, { on: "r-9.1" });
  expect(res.status).toBe(200);
  expect(waiting(7)).toEqual(["r-9.1"]);
  // The CLI does not edit issues, so only the drop goes through it.
  const calledNow = recorded().slice(before);
  expect(calledNow).toHaveLength(1);
  expect(calledNow[0].startsWith("drop wt Chris chose to wait for r-9.1")).toBe(true);
});

test("a name reused by a dropped job and its rerun acts on the newer job", async () => {
  for (const [id, extra] of [["20261027-090000-r-dup-agent", { condition: "dropped" }], ["20261027-110000-r-dup-agent", { condition: "landed", branch: "job/x" }]] as const) {
    const folder = join(base, "jobs", id);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "state.json"), JSON.stringify({ kind: "build", started: new Date().toISOString(), name: "dup", job: `dup-${extra.condition}`, repo: "r", ...extra }));
  }
  const res = await at("/api/diff/dup");
  expect(res.status).toBe(200);
  expect(await res.text()).toContain("+two");
  expect((await post("/api/land/dup")).status).toBe(200);
  expect(recorded().at(-1)).toBe("land dup");
});
