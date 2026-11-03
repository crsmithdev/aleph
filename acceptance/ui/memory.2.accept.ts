// Archived goal tests from ui/memory.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, expect, setSystemTime, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withEnv, withServer, type TestServer } from "../../ui/test-server.ts";
import { waitFor } from "../../tests/wait.ts";
import { clearCache } from "../../ui/api/memory.ts";
// @ts-ignore plain JS, shared with the page
import { md, priorityBadge } from "../../ui/lib.js";
// @ts-ignore
import * as v from "../../ui/views/memory.js";
// @ts-ignore
import { view as noteView } from "../../ui/views/memory-note.js";

let base: string, server: TestServer, stop: () => void, restoreEnv: () => void;
const at = (p: string) => fetch(`http://127.0.0.1:${server.port}${p}`);
const today = new Date().toISOString().slice(0, 10);

function note(dir: string, title: string, kind: string, scope: string, body: string) {
  writeFileSync(join(base, "vault", "wiki", dir, `${title}.md`),
    `---\nkind: ${kind}\nscope: ${scope}\nconfidence: measured\nupdated: ${today}\nsupersedes: []\nsources: [trace:abc123]\n---\n${body}\n`);
}

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), "aleph-ui-memory-"));
  const root = join(base, "vault");
  for (const d of ["decisions", "gotchas", "concepts"]) mkdirSync(join(root, "wiki", d), { recursive: true });
  mkdirSync(join(root, "daily"));
  writeFileSync(join(root, "Home.md"), "# Home\n\n## Decisions\n\n- [[Use Bun]] — why we run on Bun\n\n## Gotchas\n\n- [[Other trap]] — elsewhere\n\nHealth: 2 notes\n");
  note("decisions", "Use Bun", "decision", "aleph", "**Claim.** We use Bun.\n\n## Related\n[[Other trap]]");
  note("gotchas", "Other trap", "gotcha", "other", "**Claim.** A trap; see [[Use Bun]].");
  note("concepts", "Bunny", "concept", "aleph", "**Claim.** Mentions bun in the body.");
  writeFileSync(join(root, "MEMORY.md"), "# Memory\n\nChris prefers short answers.\n");
  mkdirSync(join(root, "wiki", "episodes"), { recursive: true });
  note("episodes", "Goal aleph-1", "episode", "aleph", "**Claim.** It went fine.");
  const hand = join(base, "handoffs");
  mkdirSync(hand);
  writeFileSync(join(hand, "current.md"), "# Handoff\n\n## Intent\n\nFinish the memory tab.\n");
  writeFileSync(join(hand, "2026-10-01-120000-x.md"), "## Intent\nOld work.\n");
  const restoreHandoffs = withEnv({ ALEPH_HANDOFFS_DIR: hand });
  writeFileSync(join(root, "daily", `${today}.md`), `# ${today}\n\n- 10:00 write [[Use Bun]] — why\n- 10:05 write [[Other trap]] — why\n`);
  // A closed port makes `vault misses` fail whatever keys a dotenv file supplies; the cache is cleared so no answer from an earlier file in this worker is served.
  const restoreVault = withEnv({ ALEPH_VAULT: root, LANGFUSE_BASE_URL: "http://127.0.0.1:9", LANGFUSE_PUBLIC_KEY: "", LANGFUSE_SECRET_KEY: "" });
  // memoryTypes reads the repo registry, the work store and the job runs: point them at small fixtures so the first request is quick and the TTL test's clock is not spent on the network or ~/.aleph.
  const git = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd, stdio: "ignore" });
  git(base, "init", "-q", "--bare", "-b", "main", join(base, "items.git"));
  git(base, "clone", "-q", join(base, "items.git"), join(base, "items"));
  git(join(base, "items"), "commit", "-q", "--allow-empty", "-m", "start");
  git(join(base, "items"), "push", "-q", "origin", "main");
  writeFileSync(join(base, "repos.json"), "{}");
  mkdirSync(join(base, "jobs"));
  const restoreStore = withEnv({ ALEPH_REPOS: join(base, "repos.json"), ALEPH_ISSUES: join(base, "items"), ALEPH_JOBS_DIR: join(base, "jobs") });
  restoreEnv = () => { restoreStore(); restoreVault(); restoreHandoffs(); };
  clearCache();
  ({ server, stop } = await withServer());
});
afterAll(() => {
  stop();
  restoreEnv();
  rmSync(base, { recursive: true, force: true });
});

test("counts by kind and scope, Home's sections, recent writes", async () => {
  const m: any = await (await at("/api/memory")).json();
  expect(m.total).toBe(4);
  expect(m.byKind).toMatchObject({ decision: 1, gotcha: 1, concept: 1, entity: 0, project: 0, episode: 1 });
  expect(m.byScope).toEqual({ aleph: 3, other: 1 });
  expect(m.home[0]).toEqual({ heading: "Decisions", entries: [{ title: "Use Bun", hook: "why we run on Bun" }] });
  expect(m.writes.map((w: any) => w.time)).toEqual(["10:05", "10:00"]);
  expect(m.lint.refuse).toBeDefined();
  expect(m.misses).toBeUndefined();
});

test("the page shows all seven types, and an empty one says what fills it", () => {
  const h = v.renderMemory({ exists: true, total: 0, byKind: {}, byScope: {}, home: [], lint: { refuse: [], warn: [] }, writes: [] });
  for (const t of ["Working", "Semantic", "Episodic", "Procedural", "Retrieval", "Prospective", "Parametric", "Facts runs", "Proposals"]) expect(h).toContain(t);
  for (const id of ["working", "semantic", "episodic", "procedural", "retrieval", "prospective", "parametric"]) expect(h).toContain(`data-tile="${id}"`);
  expect(v.view.render({ exists: true, total: 0, byKind: {}, byScope: {}, home: [], lint: { refuse: [], warn: [] }, writes: [] }, {}, new URLSearchParams("type=working"))).toContain("No handoff yet.");
  expect(h).toContain("aleph-352");
  const many = v.renderMemory({ exists: true, total: 0, byKind: {}, byScope: {}, home: [], lint: { refuse: [], warn: [] }, writes: [], types: { episodic: { episodes: Array.from({ length: 12 }, (_, i) => ({ title: `E${i}`, scope: "a", updated: "" })), daily: { total: 0, latest: [] }, sessions: [], last: "" } } }, v.options(new URLSearchParams("type=episodic")));
  expect(many).toContain("2 more");
});

test("search ranks a title hit first", async () => {
  const s: any = await (await at("/api/memory/search?q=bun")).json();
  expect(s.results.map((r: any) => r.title)).toEqual(["Bunny", "Use Bun", "Other trap"]);  // title hits, then a body hit
  const exact: any = await (await at("/api/memory/search?q=use%20bun")).json();
  expect(exact.results[0]).toMatchObject({ title: "Use Bun", rank: 0 });
});

test("[[Title]] renders as a link to #/memory/Title", () => {
  expect(md("See [[Use Bun]] and [[A|b]].")).toContain('<a href="#/memory/Use%20Bun">Use Bun</a>');
  expect(md("[[A|b]]")).toContain('<a href="#/memory/A">b</a>');
  expect(md("`[[X]]`")).not.toContain("<a");
});

test("vault misses runs once within ALEPH_UI_CACHE_TTL, and the answer says when it was fetched", async () => {
  const bin = join(base, "bin"), log = join(base, "calls");
  mkdirSync(bin);
  writeFileSync(join(bin, "bun"), `#!/bin/sh\necho x >> ${log}\necho '{"days":7,"recalls":1}'\n`);
  chmodSync(join(bin, "bun"), 0o755);
  const saveEnv = { PATH: process.env.PATH, TTL: process.env.ALEPH_UI_CACHE_TTL };
  process.env.PATH = `${bin}:${process.env.PATH}`;
  process.env.ALEPH_UI_CACHE_TTL = "300";
  clearCache();
  // The clock is the test's: only setSystemTime moves it past the TTL, so load cannot.
  const t0 = Date.now();
  setSystemTime(new Date(t0));
  try {
    const a: any = await (await at("/api/memory")).json();
    const b: any = await (await at("/api/memory?project=other")).json();
    expect(readFileSync(log, "utf8").trim().split("\n")).toHaveLength(1);
    expect(a.misses).toEqual({ days: 7, recalls: 1 });
    expect(b.cachedAt).toBe(a.cachedAt);
    setSystemTime(new Date(t0 + 301_000));
    // The stale answer comes back at once, with the old cachedAt; the reload runs in the background.
    const c: any = await (await at("/api/memory")).json();
    expect(c.cachedAt).toBe(a.cachedAt);
    const lines = () => readFileSync(log, "utf8").trim().split("\n").length;
    await waitFor(() => lines() >= 2);
    expect(lines()).toBe(2);
    // The stub has run, but the cache stores its answer a moment later.
    let d: any = c;
    await waitFor(async () => (d = await (await at("/api/memory")).json()).cachedAt !== a.cachedAt);
    expect(d.cachedAt).toBe(new Date(t0 + 301_000).toISOString());
  } finally {
    setSystemTime();
    process.env.PATH = saveEnv.PATH;
    if (saveEnv.TTL === undefined) delete process.env.ALEPH_UI_CACHE_TTL; else process.env.ALEPH_UI_CACHE_TTL = saveEnv.TTL;
    clearCache();
  }
});

/** A stub `bun` that fails and logs each call, and a Langfuse that answers 500 and counts requests. While the file `gate` exists, the stub waits before it fails. */
async function failing(name: string, ttl: string) {
  const bin = join(base, name), log = join(base, `${name}-calls`), gate = join(base, `${name}-gate`);
  mkdirSync(bin);
  writeFileSync(join(bin, "bun"), `#!/bin/sh\necho x >> ${log}\nwhile [ -e ${gate} ]; do sleep 0.05; done\nexit 1\n`);
  chmodSync(join(bin, "bun"), 0o755);
  let requests = 0;
  const lf = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => { requests++; return new Response("boom", { status: 500 }); } });
  const keys = ["PATH", "ALEPH_UI_CACHE_TTL", "LANGFUSE_BASE_URL", "LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY"];
  const saveEnv = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, { PATH: `${bin}:${process.env.PATH}`, ALEPH_UI_CACHE_TTL: ttl, LANGFUSE_BASE_URL: `http://127.0.0.1:${lf.port}`, LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk" });
  clearCache();
  const calls = () => { try { return readFileSync(log, "utf8").trim().split("\n").length; } catch { return 0; } };
  const done = () => {
    lf.stop(true);
    for (const [k, val] of Object.entries(saveEnv)) { if (val === undefined) delete process.env[k]; else process.env[k] = val; }
    clearCache();
  };
  return { calls, requests: () => requests, gate, done };
}

test("after the TTL a failed answer comes back at once and the reload runs in the background", async () => {
  const f = await failing("bin-fail-ttl", "300");
  // The clock is the test's: only setSystemTime moves it past the TTL, so load cannot.
  const t0 = Date.now();
  setSystemTime(new Date(t0));
  try {
    await (await at("/api/memory")).json();
    expect(f.calls()).toBe(1);
    const seen = f.requests();
    setSystemTime(new Date(t0 + 301_000));
    // The reload's stub waits on the gate, which the test removes only after the answer: an answer that waited for the reload never comes.
    writeFileSync(f.gate, "");
    const c = await at("/api/memory");
    expect(c.status).toBe(200);
    expect((await c.json() as any).misses).toBeUndefined();
    rmSync(f.gate);
    await waitFor(() => f.calls() >= 2 && f.requests() > seen);
    expect(f.calls()).toBe(2);
    expect(f.requests()).toBeGreaterThan(seen);
  } finally { setSystemTime(); f.done(); }
});

test("with about 1000 notes the warm call takes under 1 s", async () => {
  const dir = join(base, "vault", "wiki", "concepts");
  for (let i = 0; i < 1000; i++)
    writeFileSync(join(dir, `Gen ${i}.md`), `---\nkind: concept\nscope: aleph\nconfidence: measured\nupdated: ${today}\nsupersedes: []\nsources: [trace:abc123]\naliases: [Alias ${i}]\n---\n**Claim.** Note ${i}, as of ${today}. See [[Gen ${(i + 1) % 1000}]] and [[Use Bun]].\n\n## Related\n[[Alias ${(i + 7) % 1000}]]\n`);
  for (let i = 0; i < 1000; i++) {
    const d = join(base, "jobs", `20261003-${String(i).padStart(6, "0")}-g-facts`);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "state.json"), JSON.stringify({ kind: "facts", job: `g${i}`, name: `g${i}`, repo: "aleph", condition: "done", told: true, started: new Date().toISOString(), ended: new Date().toISOString(), kept: ["Gen 1"], rejected: ["F: r"] }));
  }
  const f = await failing("bin-fail-big", "300");
  try {
    await (await at("/api/memory")).json();  // loads the notes and fills the caches
    const t = Date.now();
    const r = await at("/api/memory");
    expect(r.status).toBe(200);
    expect(((await r.json()) as any).total).toBeGreaterThan(1000);
    expect(Date.now() - t).toBeLessThan(1000);
  } finally {
    f.done();
    for (let i = 0; i < 1000; i++) rmSync(join(dir, `Gen ${i}.md`), { force: true });
    rmSync(join(base, "jobs"), { recursive: true, force: true }); mkdirSync(join(base, "jobs"));
    clearCache();
  }
  // Writing the 2000 fixture files and the cold call take 2 to 6 s under load, which is over the 5 s default for the whole test. The 1 s limit still applies to the warm call alone (about 90 ms). Matches the 30 s the test script uses.
}, 30000);
