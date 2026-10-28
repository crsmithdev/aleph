import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  for (const [name, extra] of [["x", { branch: "job/x" }], ["nobranch", {}]] as const) {
    const folder = join(base, "jobs", `20261027-100000-r-${name}-agent`);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "state.json"), JSON.stringify({ kind: "agent", state: "needs-you", started: new Date().toISOString(), name, job: name, repo: "r", ...extra }));
  }
  calls = join(base, "calls");
  const fake = join(base, "fake-aleph");
  writeFileSync(fake, `#!/bin/sh\necho "$*" >> ${calls}\necho out\nexit 0\n`);
  chmodSync(fake, 0o755);
  for (const [k, v] of Object.entries({ ALEPH_JOBS_DIR: join(base, "jobs"), ALEPH_REPOS: join(base, "repos.json"), ALEPH_ITEMS: join(base, "items"), ALEPH_FACTORY_DIR: join(base, "factory"), ALEPH_CLI: fake })) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  server = await serve(0, { warm: false });
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
    writeFileSync(join(folder, "state.json"), JSON.stringify({ kind: "agent", started: new Date().toISOString(), name: "dup", job: `dup-${extra.state}`, repo: "r", ...extra }));
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
