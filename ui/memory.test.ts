import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "./server.ts";
import { clearCache, warm } from "./api/memory.ts";
// @ts-ignore plain JS, shared with the page
import { md } from "./lib.js";
// @ts-ignore
import * as v from "./views/memory.js";
// @ts-ignore
import { view as noteView } from "./views/memory-note.js";

let base: string, server: Awaited<ReturnType<typeof serve>>;
const saved: Record<string, string | undefined> = {};
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
  saved.ALEPH_HANDOFFS_DIR = process.env.ALEPH_HANDOFFS_DIR; process.env.ALEPH_HANDOFFS_DIR = hand;
  writeFileSync(join(root, "daily", `${today}.md`), `# ${today}\n\n- 10:00 write [[Use Bun]] — why\n- 10:05 write [[Other trap]] — why\n`);
  // A closed port makes `vault misses` fail whatever keys a dotenv file supplies; the cache is cleared so no answer from an earlier file in this worker is served.
  for (const [k, val] of Object.entries({ ALEPH_VAULT: root, LANGFUSE_BASE_URL: "http://127.0.0.1:9", LANGFUSE_PUBLIC_KEY: "", LANGFUSE_SECRET_KEY: "" })) { saved[k] = process.env[k]; process.env[k] = val; }
  // memoryTypes reads the repo registry, the work store and the job runs: point them at small fixtures so the first request is quick and the TTL test's clock is not spent on the network or ~/.aleph.
  const git = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd, stdio: "ignore" });
  git(base, "init", "-q", "--bare", "-b", "main", join(base, "items.git"));
  git(base, "clone", "-q", join(base, "items.git"), join(base, "items"));
  git(join(base, "items"), "commit", "-q", "--allow-empty", "-m", "start");
  git(join(base, "items"), "push", "-q", "origin", "main");
  writeFileSync(join(base, "repos.json"), "{}");
  mkdirSync(join(base, "jobs"));
  for (const [k, val] of Object.entries({ ALEPH_REPOS: join(base, "repos.json"), ALEPH_ITEMS: join(base, "items"), ALEPH_JOBS_DIR: join(base, "jobs") })) { saved[k] = process.env[k]; process.env[k] = val; }
  clearCache();
  server = await serve(0);
});
afterAll(() => {
  server.stop(true);
  for (const [k, val] of Object.entries(saved)) { if (val === undefined) delete process.env[k]; else process.env[k] = val; }
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

test("every memory type has its block", async () => {
  const t: any = (await (await at("/api/memory")).json()).types;
  expect(t.working.current.intent).toBe("Finish the memory tab.");
  expect(t.working.archived.map((h: any) => [h.date, h.intent])).toEqual([["2026-10-01", "Old work."]]);
  expect(t.semantic.memory.first).toBe("Chris prefers short answers.");
  expect(t.semantic.notes.map((n: any) => n.title)).toContain("Use Bun");
  expect(t.episodic.episodes.map((n: any) => n.title)).toEqual(["Goal aleph-1"]);
  expect(t.episodic.daily.latest).toEqual([today]);
  expect(t.procedural.skills).toContain("vault");
  expect(t.procedural.claudeMd.path).toBe("identity/CLAUDE.md");
  for (const k of ["retrieval", "prospective", "gates"]) expect(t[k]).toBeDefined();
});

test("the page shows all seven types, and an empty one says what fills it", () => {
  const h = v.renderMemory({ exists: true, total: 0, byKind: {}, byScope: {}, home: [], lint: { refuse: [], warn: [] }, writes: [] });
  for (const t of ["Working", "Semantic", "Episodic", "Procedural", "Retrieval", "Prospective", "Parametric", "Facts runs", "Proposals"]) expect(h).toContain(t);
  for (const id of ["working", "semantic", "episodic", "procedural", "retrieval", "prospective", "parametric"]) expect(h).toContain(`href="#h-${id}"`);
  expect(h).toContain("No handoff yet.");
  expect(h).toContain("aleph-352");
  const many = v.renderMemory({ exists: true, total: 0, byKind: {}, byScope: {}, home: [], lint: { refuse: [], warn: [] }, writes: [], types: { episodic: { episodes: Array.from({ length: 12 }, (_, i) => ({ title: `E${i}`, scope: "a", updated: "" })), daily: { total: 0, latest: [] }, sessions: [], last: "" } } });
  expect(many).toContain("2 more");
});

test("?project= keeps only that project's data", async () => {
  const m: any = await (await at("/api/memory?project=other")).json();
  expect(m.total).toBe(1);
  expect(m.byScope).toEqual({ other: 1 });
  expect(m.home.map((s: any) => s.heading)).toEqual(["Gotchas"]);
  expect(m.writes.map((w: any) => w.text)).toEqual(["write [[Other trap]] — why"]);
  const s: any = await (await at("/api/memory/search?q=bun&project=other")).json();
  expect(s.results.map((r: any) => r.title)).toEqual(["Other trap"]);
  expect((await at("/api/memory/note?title=Use%20Bun&project=other")).status).toBe(404);
  const n: any = await (await at("/api/memory/note?title=Other%20trap&project=other")).json();
  expect(n.links).toEqual([]);  // Use Bun is another project's
});

test("search ranks a title hit first", async () => {
  const s: any = await (await at("/api/memory/search?q=bun")).json();
  expect(s.results.map((r: any) => r.title)).toEqual(["Bunny", "Use Bun", "Other trap"]);  // title hits, then a body hit
  const exact: any = await (await at("/api/memory/search?q=use%20bun")).json();
  expect(exact.results[0]).toMatchObject({ title: "Use Bun", rank: 0 });
});

test("a note has its links and backlinks; a missing note is 404", async () => {
  const n: any = await (await at("/api/memory/note?title=Use%20Bun")).json();
  expect(n.frontmatter.kind).toBe("decision");
  expect(n.links.map((l: any) => l.title)).toEqual(["Other trap"]);
  expect(n.backlinks.map((l: any) => l.title)).toContain("Other trap");
  expect(n.backlinks.map((l: any) => l.title)).toContain("Home");
  expect((await at("/api/memory/note?title=Nope")).status).toBe(404);
});

test("[[Title]] renders as a link to #/memory/Title", () => {
  expect(md("See [[Use Bun]] and [[A|b]].")).toContain('<a href="#/memory/Use%20Bun">Use Bun</a>');
  expect(md("[[A|b]]")).toContain('<a href="#/memory/A">b</a>');
  expect(md("`[[X]]`")).not.toContain("<a");
});

test("the views render and the note route is wired", () => {
  expect(noteView.path).toBe("/memory/:title");
  expect(noteView.api({ title: "A b" })).toBe("/api/memory/note?title=A%20b");
  const h = v.renderMemory({ exists: true, total: 1, byKind: { decision: 1 }, byScope: { aleph: 1 }, home: [{ heading: "Decisions", entries: [{ title: "Use Bun", hook: "h" }] }], lint: { refuse: [], warn: [] }, writes: [], misses: { days: 7, recalls: 2, empty: 1, empty_share: 0.5, reformulated: 0, unoffered_reads: 0 } });
  for (const t of ["Use Bun", "#/memory/Use%20Bun", "Counts by kind and scope", "50%", "Search the vault"]) expect(h).toContain(t);
  const nh = v.renderNote({ title: "T", path: "wiki/x/T.md", archived: false, frontmatter: { kind: "gotcha" }, body: "see [[U]]", links: [], backlinks: [{ title: "V", kind: "gotcha", scope: "a" }] });
  expect(nh).toContain('href="#/memory/U"');
  expect(nh).toContain("Linked from");
});

test("vault misses runs once within ALEPH_UI_CACHE_TTL, and the answer says when it was fetched", async () => {
  const bin = join(base, "bin"), log = join(base, "calls");
  mkdirSync(bin);
  writeFileSync(join(bin, "bun"), `#!/bin/sh\necho x >> ${log}\necho '{"days":7,"recalls":1}'\n`);
  chmodSync(join(bin, "bun"), 0o755);
  const saveEnv = { PATH: process.env.PATH, TTL: process.env.ALEPH_UI_CACHE_TTL };
  process.env.PATH = `${bin}:${process.env.PATH}`;
  process.env.ALEPH_UI_CACHE_TTL = "300";  // load cannot use this up; the expiry below is forced by shortening it, not by waiting
  clearCache();
  try {
    const a: any = await (await at("/api/memory")).json();
    const b: any = await (await at("/api/memory?project=other")).json();
    expect(readFileSync(log, "utf8").trim().split("\n")).toHaveLength(1);
    expect(a.misses).toEqual({ days: 7, recalls: 1 });
    expect(b.cachedAt).toBe(a.cachedAt);
    process.env.ALEPH_UI_CACHE_TTL = "0.001";
    await Bun.sleep(20);
    // The stale answer comes back at once, with the old cachedAt; the reload runs in the background.
    const c: any = await (await at("/api/memory")).json();
    expect(c.cachedAt).toBe(a.cachedAt);
    const lines = () => readFileSync(log, "utf8").trim().split("\n").length;
    const deadline = Date.now() + 5000;
    while (lines() < 2 && Date.now() < deadline) await Bun.sleep(20);
    expect(lines()).toBe(2);
    // The stub has run, but the cache stores its answer a moment later.
    let d: any = c;
    while (d.cachedAt === a.cachedAt && Date.now() < deadline) {
      await Bun.sleep(20);
      d = await (await at("/api/memory")).json();
    }
    expect(d.cachedAt).not.toBe(a.cachedAt);
  } finally {
    process.env.PATH = saveEnv.PATH;
    if (saveEnv.TTL === undefined) delete process.env.ALEPH_UI_CACHE_TTL; else process.env.ALEPH_UI_CACHE_TTL = saveEnv.TTL;
    clearCache();
  }
});

test("warm() fills the misses cache, so the first request runs vault misses zero more times", async () => {
  const bin = join(base, "bin-warm"), log = join(base, "calls-warm");
  mkdirSync(bin);
  writeFileSync(join(bin, "bun"), `#!/bin/sh\necho x >> ${log}\necho '{"days":7,"recalls":3}'\n`);
  chmodSync(join(bin, "bun"), 0o755);
  const saveEnv = { PATH: process.env.PATH };
  process.env.PATH = `${bin}:${process.env.PATH}`;
  clearCache();
  try {
    await warm();
    expect(readFileSync(log, "utf8").trim().split("\n")).toHaveLength(1);
    const a: any = await (await at("/api/memory")).json();
    expect(a.misses).toEqual({ days: 7, recalls: 3 });
    expect(readFileSync(log, "utf8").trim().split("\n")).toHaveLength(1);
  } finally {
    process.env.PATH = saveEnv.PATH;
    clearCache();
  }
});

function factsRun(id: string, repo: string, started: string, kept: string[], rejected: string[]) {
  const dir = join(base, "jobs", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "state.json"), JSON.stringify({ kind: "facts", job: `job-${id}`, name: id, repo, state: "done", told: true, started, ended: started, kept, rejected }));
}

test("facts runs fill the gates section, newest first, scoped by project", async () => {
  const empty: any = await (await at("/api/memory")).json();
  expect(empty.facts).toEqual([]);
  expect(v.renderMemory(empty)).toContain("facts gate");

  for (const [t, src] of [["Kept One", "ui/a.ts:3"], ["Kept Two", "abc1234"]])
    writeFileSync(join(base, "vault", "wiki", "gotchas", `${t}.md`), `---\nkind: gotcha\nscope: aleph\nconfidence: reported\nupdated: ${today}\nsupersedes: []\nsources: [${src}, job:x]\nwritten_by: factory\n---\n**Claim.** ${t}.\n`);
  const now = Date.now();
  factsRun("20261001-000000-a-facts", "aleph", new Date(now - 3600_000).toISOString(), ["Kept One", "Kept Two"], ["A fact: it is stale"]);
  factsRun("20261002-000000-b-facts", "aleph", new Date(now).toISOString(), [], ["Fact X: reason X", "Fact Y: reason Y"]);
  clearCache();
  const m: any = await (await at("/api/memory")).json();
  expect(m.facts.map((r: any) => r.run)).toEqual(["20261002-000000-b-facts", "20261001-000000-a-facts"]);
  expect(m.facts[1].kept).toEqual([{ title: "Kept One", source: "ui/a.ts:3" }, { title: "Kept Two", source: "abc1234" }]);
  expect(m.facts[0].rejected).toEqual([{ fact: "Fact X", reason: "reason X" }, { fact: "Fact Y", reason: "reason Y" }]);
  expect(m.factsWeek).toMatchObject({ kept: 2, rejected: 3 });

  const h = v.renderMemory(m);
  for (const s of ['href="#/memory/Kept%20One"', 'href="#/memory/Kept%20Two"', "stale", "reason X", "reason Y"]) expect(h).toContain(s);

  const other: any = await (await at("/api/memory?project=other")).json();
  expect(other.facts).toEqual([]);
});

/** A stub `bun` that fails and logs each call, and a Langfuse that answers 500 and counts requests. */
async function failing(name: string, ttl: string) {
  const bin = join(base, name), log = join(base, `${name}-calls`);
  mkdirSync(bin);
  writeFileSync(join(bin, "bun"), `#!/bin/sh\necho x >> ${log}\nexit 1\n`);
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
  return { calls, requests: () => requests, done };
}

test("failed loads are kept for the TTL: no second spawn, no second Langfuse request", async () => {
  const f = await failing("bin-fail", "300");
  try {
    const a = await at("/api/memory");
    expect(a.status).toBe(200);
    const body: any = await a.json();
    expect(body.misses).toBeUndefined();
    expect(body.types.episodic.sessions).toBeNull();
    const seen = f.requests();
    expect(seen).toBeGreaterThan(0);
    const b = await at("/api/memory");
    expect(b.status).toBe(200);
    expect(f.calls()).toBe(1);
    expect(f.requests()).toBe(seen);
    await expect(warm()).rejects.toThrow();
  } finally { f.done(); }
});

test("after the TTL a failed answer comes back at once and the reload runs in the background", async () => {
  const f = await failing("bin-fail-ttl", "300");
  try {
    await (await at("/api/memory")).json();
    expect(f.calls()).toBe(1);
    const seen = f.requests();
    process.env.ALEPH_UI_CACHE_TTL = "0.001";
    await Bun.sleep(20);
    const t = Date.now();
    const c = await at("/api/memory");
    expect(c.status).toBe(200);
    expect((await c.json() as any).misses).toBeUndefined();
    expect(Date.now() - t).toBeLessThan(1000);
    const deadline = Date.now() + 5000;
    while ((f.calls() < 2 || f.requests() === seen) && Date.now() < deadline) await Bun.sleep(20);
    expect(f.calls()).toBe(2);
    expect(f.requests()).toBeGreaterThan(seen);
  } finally { f.done(); }
});

test("with about 1000 notes the warm call takes under 1 s", async () => {
  const dir = join(base, "vault", "wiki", "concepts");
  for (let i = 0; i < 1000; i++)
    writeFileSync(join(dir, `Gen ${i}.md`), `---\nkind: concept\nscope: aleph\nconfidence: measured\nupdated: ${today}\nsupersedes: []\nsources: [trace:abc123]\naliases: [Alias ${i}]\n---\n**Claim.** Note ${i}, as of ${today}. See [[Gen ${(i + 1) % 1000}]] and [[Use Bun]].\n\n## Related\n[[Alias ${(i + 7) % 1000}]]\n`);
  for (let i = 0; i < 1000; i++) {
    const d = join(base, "jobs", `20261003-${String(i).padStart(6, "0")}-g-facts`);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "state.json"), JSON.stringify({ kind: "facts", job: `g${i}`, name: `g${i}`, repo: "aleph", state: "done", told: true, started: new Date().toISOString(), ended: new Date().toISOString(), kept: ["Gen 1"], rejected: ["F: r"] }));
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
// 2000 files written and a cold load first, so it needs more than the 5 s default under load. The 1 s assertion on the warm call stays.
}, 30000);
