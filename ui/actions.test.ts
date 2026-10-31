import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readList, writeList } from "../todo/lib/store.ts";
import { addLegacy } from "../todo/lib/todo.ts";
import { serve } from "./server.ts";

let base: string, server: Awaited<ReturnType<typeof serve>>, calls: string;
const saved: Record<string, string | undefined> = {};
const at = (p: string, init?: RequestInit) => fetch(`http://127.0.0.1:${server.port}${p}`, init);
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
  for (const [name, extra] of [["x", { branch: "job/x" }], ["nobranch", {}], ["asks", { ask: { kind: "input", reason: "question", question: "which colour?", options: [], why: [] } }], ["stuckjob", { state: "stuck" }], ["wt", { on: "r-7" }], ["wtgone", { on: "r-99" }], ["won", { on: "r-5" }], ["wgoal", { on: "r-6.1" }]] as const) {
    const folder = join(base, "jobs", `20261027-100000-r-${name}-agent`);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "state.json"), JSON.stringify({ kind: "build", state: "awaiting", started: new Date().toISOString(), name, job: name, repo: "r", ...extra }));
  }
  // The work store, with issue 7 of `r` for the Wait button to set `waiting_on` on.
  const itemsRemote = join(base, "items.git"), items = join(base, "items");
  sh(base, "init", "-q", "--bare", "-b", "main", itemsRemote);
  sh(base, "clone", "-q", itemsRemote, items);
  sh(items, "config", "user.email", "t@t"); sh(items, "config", "user.name", "t");
  sh(items, "commit", "-q", "--allow-empty", "-m", "start");
  sh(items, "push", "-q", "origin", "main");
  calls = join(base, "calls");
  const fake = join(base, "fake-aleph");
  writeFileSync(fake, `#!/bin/sh\necho "$*" >> ${calls}\nif [ "$4" = "--spec" ]; then cat >> ${calls}.stdin; fi\nif [ "$1 $2" = "issue edit" ] && [ -e ${base}/fail-edit ]; then echo "edit refused" >&2; exit 1; fi\necho out\nexit 0\n`);
  chmodSync(fake, 0o755);
  Object.assign(process.env, { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" });
  for (const [k, v] of Object.entries({ ALEPH_JOBS_DIR: join(base, "jobs"), ALEPH_REPOS: join(base, "repos.json"), ALEPH_ISSUES: join(base, "items"), ALEPH_FACTORY_DIR: join(base, "factory"), ALEPH_CLI: fake })) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  server = await serve(0, { warm: false });
  writeList({ key: "r" }, "seed", (doc) => { for (let i = 1; i <= 7; i++) addLegacy(doc, `issue ${i}`, { labels: i === 7 ? ["goal"] : [] }); return true; }, true);
});
afterAll(() => {
  server.stop(true);
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
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

test("POST /api/wait 400s without a blocker or an item", async () => {
  expect((await post("/api/wait/x", undefined, {})).status).toBe(400);
});

const waiting = (n: number) => readList({ key: "r" })!.items.find((i) => i.id === n)!.fm.waiting_on;

test("POST /api/wait sets the item's waiting_on in process, then drops the job", async () => {
  const before = recorded().length;
  const res = await post("/api/wait/wt", { "X-Aleph-UI": "1" }, { on: "r-9" });
  expect(res.status).toBe(200);
  expect(waiting(7)).toBe("r-9");
  // The CLI refuses `issue edit --waiting-on`, so only the drop goes through it.
  const calledNow = recorded().slice(before);
  expect(calledNow).toHaveLength(1);
  expect(calledNow[0].startsWith("drop wt Chris chose to wait for r-9")).toBe(true);
});

test("POST /api/wait reads the issue from `on`, and the integer part of a goal's dotted `on`", async () => {
  for (const [job, n] of [["won", 5], ["wgoal", 6]] as const) {
    const before = recorded().length;
    const res = await post(`/api/wait/${job}`, { "X-Aleph-UI": "1" }, { on: "r-9" });
    expect(res.status).toBe(200);
    expect(waiting(n)).toBe("r-9");
    const calledNow = recorded().slice(before);
    expect(calledNow).toHaveLength(1);
    expect(calledNow[0].startsWith(`drop ${job} Chris chose to wait for r-9`)).toBe(true);
  }
});

test("POST /api/wait is 422 when the edit is refused, and drops nothing", async () => {
  const before = recorded().length;
  // Issue 99 is not in the store: the in-process edit refuses it.
  const res = await post("/api/wait/wtgone", { "X-Aleph-UI": "1" }, { on: "r-9" });
  expect(res.status).toBe(422);
  expect(((await res.json()) as any).error).toContain("no issue 99");
  expect(recorded().slice(before)).toEqual([]);
});

test("a POST without the header, or from another origin, is 403 and runs nothing", async () => {
  const before = recorded().length;
  expect((await post("/api/land/x", {})).status).toBe(403);
  expect((await post("/api/land/x", { "X-Aleph-UI": "1", Origin: "https://evil.example" })).status).toBe(403);
  expect((await post("/api/drop/x", { Origin: `http://127.0.0.1:${server.port}` })).status).toBe(403);
  expect(recorded().length).toBe(before);
  expect((await post("/api/checked/x", { "X-Aleph-UI": "1", Origin: `http://127.0.0.1:${server.port}` })).status).toBe(200);
  expect(recorded().at(-1)).toBe("checked x");
});

test("POST /api/drop passes the reason", async () => {
  expect((await post("/api/drop/x", { "X-Aleph-UI": "1" }, { reason: "not needed" })).status).toBe(200);
  expect(recorded().at(-1)).toBe("drop x not needed");
  await post("/api/drop/x");
  expect(recorded().at(-1)).toBe("drop x");
});

test("a name not in the ledger is 404 and runs nothing", async () => {
  const before = recorded().length;
  expect((await post("/api/land/nope")).status).toBe(404);
  expect(recorded().length).toBe(before);
});

test("GET /api/diff is the branch's diff from the merge base", async () => {
  const res = await at("/api/diff/x");
  expect(res.status).toBe(200);
  const d = await res.text();
  expect(d).toContain("-one");
  expect(d).toContain("+two");
  expect(d).not.toContain("b.txt");
  expect((await at("/api/diff/nobranch")).status).toBe(404);
  expect((await at("/api/diff/nope")).status).toBe(404);
});

test("a name reused by a dropped job and its rerun acts on the newer job", async () => {
  for (const [id, extra] of [["20261027-090000-r-dup-agent", { state: "dropped" }], ["20261027-110000-r-dup-agent", { state: "landed", branch: "job/x" }]] as const) {
    const folder = join(base, "jobs", id);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "state.json"), JSON.stringify({ kind: "build", started: new Date().toISOString(), name: "dup", job: `dup-${extra.state}`, repo: "r", ...extra }));
  }
  const res = await at("/api/diff/dup");
  expect(res.status).toBe(200);
  expect(await res.text()).toContain("+two");
  expect((await post("/api/land/dup")).status).toBe(200);
  expect(recorded().at(-1)).toBe("land dup");
});

test("pause, resume and judge run their command", async () => {
  expect((await post("/api/pause")).status).toBe(200);
  expect(recorded().at(-1)).toBe("pause");
  await post("/api/resume");
  expect(recorded().at(-1)).toBe("resume");
  await post("/api/judge", { "X-Aleph-UI": "1" }, { judge: "haiku" });
  expect(recorded().at(-1)).toBe("judge haiku");
});

test("a bad judge is 400 and the controls without the header are 403, running nothing", async () => {
  const before = recorded().length;
  expect((await post("/api/judge", { "X-Aleph-UI": "1" }, { judge: "gpt" })).status).toBe(400);
  expect((await post("/api/judge", { "X-Aleph-UI": "1" })).status).toBe(400);
  for (const p of ["/api/pause", "/api/resume"]) expect((await post(p, {})).status).toBe(403);
  expect((await post("/api/judge", {}, { judge: "jev" })).status).toBe(403);
  expect((await post("/api/pause", { "X-Aleph-UI": "1", Origin: "https://evil.example" })).status).toBe(403);
  expect(recorded().length).toBe(before);
});

test("POST /api/jobs/:name/answer follows up a question, and refuses anything else without running the CLI", async () => {
  const before = recorded().length;
  const url = "/api/jobs/asks/answer";
  expect((await post(url, {}, { answer: "blue" })).status).toBe(403);
  expect((await post("/api/jobs/nope/answer", { "X-Aleph-UI": "1" }, { answer: "blue" })).status).toBe(404);
  expect((await post(url, { "X-Aleph-UI": "1" }, { answer: "  " })).status).toBe(400);
  expect((await post("/api/jobs/x/answer", { "X-Aleph-UI": "1" }, { answer: "blue" })).status).toBe(409);
  expect(recorded().length).toBe(before);
  const res = await post(url, { "X-Aleph-UI": "1" }, { answer: "blue" });
  expect(res.status).toBe(200);
  expect(recorded().at(-1)).toBe("job r asks --spec -");
  expect(readFileSync(`${calls}.stdin`, "utf8")).toBe("Chris: blue");
});

test("POST /api/answer/:name drops the question run with the answer as its reason, and refuses anything else without running the CLI", async () => {
  const before = recorded().length;
  const hdr = { "X-Aleph-UI": "1" };
  expect((await post("/api/answer/asks", {}, { answer: "blue" })).status).toBe(403);
  expect((await post("/api/answer/nope", hdr, { answer: "blue" })).status).toBe(404);
  expect((await post("/api/answer/asks", hdr, { answer: "  " })).status).toBe(400);
  expect((await post("/api/answer/asks", hdr, {})).status).toBe(400);
  expect((await post("/api/answer/stuckjob", hdr, { answer: "blue" })).status).toBe(409);
  expect(recorded().length).toBe(before);
  const res = await post("/api/answer/asks", hdr, { answer: "blue" });
  expect(res.status).toBe(200);
  expect((await res.json()).code).toBe(0);
  const last = recorded().at(-1)!;
  expect(last.startsWith("drop asks ")).toBe(true);
  expect(last).toContain("which colour?");
  expect(last).toContain("blue");
});
