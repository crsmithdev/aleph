import { afterAll, beforeAll, describe, expect, setSystemTime, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { writeList } from "../issues/lib/store.ts";
import { add } from "../issues/lib/todo.ts";
import { addPart } from "../issues/lib/parts.fixture.ts";
import { withEnv, withServer, type TestServer } from "./test-server.ts";
import { putRun } from "../jobs/lib/records/record.ts";

// The test's clock: the server reads it, and the runs start at it.
const NOW = Date.parse("2026-11-04T12:00:00Z");
beforeAll(() => setSystemTime(NOW));
afterAll(() => setSystemTime());

let base: string, server: TestServer, stop: () => void, restoreEnv: () => void, at: (path: string, init?: RequestInit) => Promise<Response>, calls: string;
const post = (p: string, headers: Record<string, string> = { "X-Aleph-UI": "1" }, body?: object) =>
  at(p, { method: "POST", headers, body: body ? JSON.stringify(body) : undefined });
/** The job ID of each fixture run: its issue, else its name, then `#1`. */
const J: Record<string, string> = {"x": "x#1", "nobranch": "nobranch#1", "asks": "asks#1", "stuckjob": "stuckjob#1", "wt": "r-7#1", "wtgone": "r-99#1", "won": "r-5#1", "wgoal": "r-6.1#1", "nope": "nope#1"};
/** The path of an action on the fixture run `name`. */
const jp = (name: string, verb: string) => `/api/jobs/${encodeURIComponent(J[name])}/${verb}`;
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
  // The work store, with issue 7 of `r` for the Wait button to set `after` on.
  const itemsRemote = join(base, "items.git"), items = join(base, "items");
  sh(base, "init", "-q", "--bare", "-b", "main", itemsRemote);
  sh(base, "clone", "-q", itemsRemote, items);
  sh(items, "config", "user.email", "t@t"); sh(items, "config", "user.name", "t");
  sh(items, "commit", "-q", "--allow-empty", "-m", "start");
  sh(items, "push", "-q", "origin", "main");
  calls = join(base, "calls");
  const fake = join(base, "fake-aleph");
  writeFileSync(fake, `#!/bin/sh\necho "$*" >> ${calls}\nif [ "$4" = "--spec" ]; then cat >> ${calls}.stdin; fi\nif [ "$1 $2" = "issue edit" ] && [ -e ${base}/fail-edit ]; then echo "edit refused" >&2; exit 1; fi\nif [ "$1" = "drop" ] && [ -e ${base}/fail-drop ]; then echo "drop failed" >&2; exit 1; fi\nif [ "$4" = "no-such-reason" ]; then echo "no such reason" >&2; exit 1; fi\necho out\nexit 0\n`);
  chmodSync(fake, 0o755);
  restoreEnv = withEnv({ GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", ALEPH_JOBS_DIR: join(base, "jobs"), ALEPH_REPOS: join(base, "repos.json"), ALEPH_ISSUES: join(base, "items"), ALEPH_FACTORY_DIR: join(base, "factory"), ALEPH_CLI: fake });
  for (const [name, extra] of [["x", { branch: "job/x" }], ["nobranch", {}], ["asks", { ask: { kind: "input", reason: "question", question: "which colour?", options: [], why: [] } }], ["stuckjob", { condition: "failed" }], ["wt", { on: "r-7" }], ["wtgone", { on: "r-99" }], ["won", { on: "r-5" }], ["wgoal", { on: "r-6.1" }]] as const) {
    const folder = join(base, "jobs", `20261027-100000-r-${name}-agent`);
    mkdirSync(folder, { recursive: true });
    putRun(basename(join(folder)), { kind: "build", condition: "waiting", started: new Date(NOW).toISOString(), name, job: name, repo: "r", n: 1, ...extra } as any);
  }
  ({ server, stop, at } = await withServer({ warm: false }));
  writeList({ key: "r" }, "seed", (doc) => { for (let i = 1; i <= 9; i++) { add(doc, `issue ${i}`, i === 7 ? { spec: "Do it." } : {}); } for (const n of [6, 9]) addPart(doc, doc.items.find((x) => x.id === n && x.sub === undefined)!, { title: `goal ${n}`, spec: "x" }); return true; }, true);
});
afterAll(() => {
  stop();
  restoreEnv();
  rmSync(base, { recursive: true, force: true });
});

test("POST /api/jobs/:id/wait 400s without a blocker or an item", async () => {
  expect((await post(jp("x", "wait"), undefined)).status).toBe(400);
});

test("POST /api/jobs/:id/wait reads the issue from `on`, and the integer part of a part's dotted `on`", async () => {
  for (const [job, n] of [["won", "5"], ["wgoal", "6.1"]] as const) {
    const before = recorded().length;
    const res = await post(jp(job, "wait"), { "X-Aleph-UI": "1" }, { on: "r-9.1" });
    expect(res.status).toBe(200);
    const calledNow = recorded().slice(before);
    expect(calledNow).toHaveLength(2);
    expect(calledNow[0]).toBe(`issue edit --after r-9.1 -- r ${n}`);
    expect(calledNow[1].startsWith(`drop -- ${job} Chris chose to wait for r-9.1`)).toBe(true);
  }
});

test("POST /api/jobs/:id/wait is 422 when the edit is refused, and drops nothing", async () => {
  const before = recorded().length;
  // Issue 99 is not in the store: reading its wait refuses it.
  const res = await post(jp("wtgone", "wait"), { "X-Aleph-UI": "1" }, { on: "r-9.1" });
  expect(res.status).toBe(422);
  expect(((await res.json()) as any).error).toContain("no issue 99");
  expect(recorded().slice(before)).toEqual([]);
});

test("a POST without the header, or from another origin, is 403 and runs nothing", async () => {
  const before = recorded().length;
  expect((await post(jp("x", "land"), {})).status).toBe(403);
  expect((await post(jp("x", "land"), { "X-Aleph-UI": "1", Origin: "https://evil.example" })).status).toBe(403);
  expect((await post(jp("x", "drop"), { Origin: `http://127.0.0.1:${server.port}` })).status).toBe(403);
  expect(recorded().length).toBe(before);
});

test("POST /api/jobs/:id/drop passes the reason", async () => {
  expect((await post(jp("x", "drop"), { "X-Aleph-UI": "1" }, { reason: "not needed" })).status).toBe(200);
  expect(recorded().at(-1)).toBe("drop -- x not needed");
  await post(jp("x", "drop"), undefined);
  expect(recorded().at(-1)).toBe("drop -- x");
});

test("a name not in the ledger is 404 and runs nothing", async () => {
  const before = recorded().length;
  expect((await post(jp("nope", "land"))).status).toBe(404);
  expect(recorded().length).toBe(before);
});

test("GET /api/jobs/:id/diff is the branch's diff from the merge base", async () => {
  const res = await at(`/api/jobs/${encodeURIComponent(J["x"])}/diff`);
  expect(res.status).toBe(200);
  const d = await res.text();
  expect(d).toContain("-one");
  expect(d).toContain("+two");
  expect(d).not.toContain("b.txt");
  expect((await at(`/api/jobs/${encodeURIComponent(J["nobranch"])}/diff`)).status).toBe(404);
  expect((await at(`/api/jobs/${encodeURIComponent(J["nope"])}/diff`)).status).toBe(404);
});

test("pause and resume run their command", async () => {
  expect((await post("/api/factory/pause")).status).toBe(200);
  expect(recorded().at(-1)).toBe("pause");
  await post("/api/factory/resume");
  expect(recorded().at(-1)).toBe("resume");
});

test("the controls without the header are 403, running nothing", async () => {
  const before = recorded().length;
  for (const p of ["/api/factory/pause", "/api/factory/resume"]) expect((await post(p, {})).status).toBe(403);
  expect((await post("/api/factory/pause", { "X-Aleph-UI": "1", Origin: "https://evil.example" })).status).toBe(403);
  expect(recorded().length).toBe(before);
});

test("POST /api/jobs/:id/answer drops the question run with the answer as its reason, and refuses anything else without running the CLI", async () => {
  const before = recorded().length;
  const hdr = { "X-Aleph-UI": "1" };
  expect((await post(jp("asks", "answer"), {}, { answer: "blue" })).status).toBe(403);
  expect((await post(jp("nope", "answer"), hdr, { answer: "blue" })).status).toBe(404);
  expect((await post(jp("asks", "answer"), hdr, { answer: "  " })).status).toBe(400);
  expect((await post(jp("asks", "answer"), hdr)).status).toBe(400);
  expect((await post(jp("stuckjob", "answer"), hdr, { answer: "blue" })).status).toBe(409);
  expect(recorded().length).toBe(before);
  const res = await post(jp("asks", "answer"), hdr, { answer: "blue" });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ output: "out" });
  const last = recorded().at(-1)!;
  expect(last.startsWith("drop -- asks ")).toBe(true);
  expect(last).toContain("which colour?");
  expect(last).toContain("blue");
});

test("an action on a job that a newer job of its name replaced is 409, names the newer one, and runs nothing", async () => {
  // Two jobs named `again`: `again#1`, then `again#2`, a rerun.
  for (const [n, at] of [[1, NOW - 60_000], [2, NOW]] as const) {
    const folder = join(base, "jobs", `20261027-10000${n}-r-again-agent`);
    mkdirSync(folder, { recursive: true });
    putRun(basename(folder), { kind: "build", condition: "waiting", started: new Date(at).toISOString(), name: "again", job: `again-${n}`, repo: "r", n } as any);
  }
  const before = recorded().length;
  const hdr = { "X-Aleph-UI": "1" };
  for (const verb of ["land", "recheck", "drop"]) {
    const res = await post(`/api/jobs/again%231/${verb}`, hdr, {});
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("again#2");
  }
  expect(recorded().length).toBe(before);
  for (const verb of ["land", "recheck"]) {
    expect((await post(`/api/jobs/again%232/${verb}`, hdr, {})).status).toBe(200);
    expect(recorded().at(-1)).toBe(`${verb} -- again`);
  }
});

test("POST /api/jobs/:id/wait puts the old `after` back when the drop fails, and says which step failed", async () => {
  const fail = join(base, "fail-drop");
  writeFileSync(fail, "");
  try {
    const res = await post(jp("won", "wait"), { "X-Aleph-UI": "1" }, { on: "r-8" });
    expect(res.status).toBe(422);
    expect(((await res.json()) as any).error).toBe("drop the job: drop failed; r-5 its wait was put back");
    expect(recorded().slice(-3)).toEqual(["issue edit --after r-8 -- r 5", expect.stringMatching(/^drop -- won /), "issue edit --after none -- r 5"]);
  } finally { rmSync(fail); }
});

test("POST /api/jobs/:id/wait says which step failed when the edit is refused, and drops nothing", async () => {
  const fail = join(base, "fail-edit");
  writeFileSync(fail, "");
  try {
    const before = recorded().length;
    const res = await post(jp("won", "wait"), { "X-Aleph-UI": "1" }, { on: "r-8" });
    expect(res.status).toBe(422);
    expect(((await res.json()) as any).error).toBe("set the wait: edit refused");
    expect(recorded().slice(before)).toEqual(["issue edit --after r-8 -- r 5"]);
  } finally { rmSync(fail); }
});

test("a failed command is never a 200: it is a 4xx with the command's reason", async () => {
  const fail = join(base, "fail-drop");
  writeFileSync(fail, "");
  try {
    const res = await post(jp("x", "drop"), { "X-Aleph-UI": "1" });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "drop failed" });
  } finally { rmSync(fail); }
});

describe("POST /api/automation/rules/:reason/grant", () => {
  const body = { action: "land" };
  test("refuses a request from another page or with no header, and runs nothing", async () => {
    const before = recorded().length;
    expect((await post("/api/automation/rules/held-path/grant", {}, body)).status).toBe(403);
    expect((await post("/api/automation/rules/held-path/grant", { "X-Aleph-UI": "1", Origin: "https://evil.example" }, body)).status).toBe(403);
    expect((await post("/api/automation/rules/held-path/grant", { "X-Aleph-UI": "1" }, {})).status).toBe(400);
    expect(recorded().length).toBe(before);
  });
  test("grants through the CLI", async () => {
    const r = await post("/api/automation/rules/held-path/grant", { "X-Aleph-UI": "1" }, body);
    expect(r.status).toBe(200);
    expect(recorded().at(-1)).toBe("always grant -- held-path land");
  });
  test("a CLI refusal is a 422 with its reason", async () => {
    const r = await post("/api/automation/rules/no-such-reason/grant", { "X-Aleph-UI": "1" }, body);
    expect(r.status).toBe(422);
    expect((await r.json()).error).toBe("no such reason");
  });
});

test("every POST route answers a refused request with a 4xx and `{ error }`", async () => {
  const dir = join(import.meta.dir, "api");
  const files = (await Array.fromAsync(new Bun.Glob("*.ts").scan(dir))).filter((f) => !f.endsWith(".test.ts"));
  const keys = (await Promise.all(files.map(async (f) => Object.keys((await import(join(dir, f))).routes ?? {})))).flat();
  const paths = keys.filter((k) => k.startsWith("POST ")).map((k) => k.slice(5).replace(/:\w+/g, "x"));
  expect(paths.length).toBeGreaterThan(20);
  for (const p of paths) {
    const res = await post(p, {});
    expect([p, res.status]).toEqual([p, 403]);
    expect([p, await res.json()]).toEqual([p, { error: "forbidden" }]);
  }
});
