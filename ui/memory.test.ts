import { afterAll, beforeAll, expect, setSystemTime, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withEnv, withServer, type TestServer } from "./test-server.ts";
import { clearCache, warm } from "./api/memory.ts";
import { memoryTypes } from "./api/memory-types.ts";
import { writeList } from "../issues/lib/store.ts";
import { add } from "../issues/lib/todo.ts";
// @ts-ignore plain JS, shared with the page
import { md, priorityBadge } from "./lib.js";
// @ts-ignore
import * as v from "./views/memory.js";
// @ts-ignore
import { view as noteView } from "./views/memory-note.js";

// The test's clock: the code under test reads it, and the fixtures sit at known distances from it.
const NOW = Date.parse("2026-11-04T12:00:00Z");
beforeAll(() => setSystemTime(NOW));
afterAll(() => setSystemTime());

let base: string, server: TestServer, stop: () => void, restoreEnv: () => void;
const at = (p: string) => fetch(`http://127.0.0.1:${server.port}${p}`);
const today = new Date(NOW).toISOString().slice(0, 10);

function note(dir: string, title: string, kind: string, scope: string, body: string, core = "") {
  writeFileSync(join(base, "vault", "wiki", dir, `${title}.md`),
    `---\nkind: ${kind}\nscope: ${scope}\nconfidence: measured\nupdated: ${today}\n${core ? `core: ${core}\n` : ""}supersedes: []\nsources: [trace:abc123]\n---\n${body}\n`);
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
  mkdirSync(join(base, "factory", "episodes"), { recursive: true });
  writeFileSync(join(base, "factory", "episodes", "aleph-1 Goal.md"), `---\nkind: episode\nscope: aleph\nupdated: ${today}\n---\n## Goal\nShip it.\n`);
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
  const restoreStore = withEnv({ ALEPH_REPOS: join(base, "repos.json"), ALEPH_ISSUES: join(base, "items"), ALEPH_JOBS_DIR: join(base, "jobs"), ALEPH_FACTORY_DIR: join(base, "factory") });
  restoreEnv = () => { restoreStore(); restoreVault(); restoreHandoffs(); };
  clearCache();
  ({ server, stop } = await withServer());
});
afterAll(() => {
  stop();
  restoreEnv();
  rmSync(base, { recursive: true, force: true });
});

test("the episodic block lists the pages in the factory's episodes folder", async () => {
  const m: any = await (await at("/api/memory")).json();
  expect(m.types.episodic.episodes).toEqual([{ title: "aleph-1 Goal", scope: "aleph", updated: today }]);
  expect(m.types.episodic.keepDays).toBe(14);
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

test("a note has its links and backlinks; a missing note is 404", async () => {
  const n: any = await (await at("/api/memory/note?title=Use%20Bun")).json();
  expect(n.frontmatter.kind).toBe("decision");
  expect(n.links.map((l: any) => l.title)).toEqual(["Other trap"]);
  expect(n.backlinks.map((l: any) => l.title)).toContain("Other trap");
  expect(n.backlinks.map((l: any) => l.title)).toContain("Home");
  expect((await at("/api/memory/note?title=Nope")).status).toBe(404);
});

test("the views render and the note route is wired", () => {
  expect(noteView.path).toBe("/memory/:title");
  expect(noteView.api({ title: "A b" })).toBe("/api/memory/note?title=A%20b");
  const h = v.renderMemory({ exists: true, total: 1, byKind: { decision: 1 }, byScope: { aleph: 1 }, home: [{ heading: "Decisions", entries: [{ title: "Use Bun", hook: "h" }] }], lint: { refuse: [], warn: [] }, writes: [], misses: { days: 7, recalls: 2, empty: 1, empty_share: 0.5, reformulated: 0, unoffered_reads: 0 } });
  for (const t of ["Use Bun", "#/memory/Use%20Bun", "Counts by kind and scope", "50%", "Search titles, aliases and bodies"]) expect(h).toContain(t);
  for (const t of ["<h3>When Recall Last Returned Each Note</h3>", "<h3>Notes by Kind ", "<h3>Recall Misses, 7 Days</h3>", "<h2>Factory Memory Gates</h2>", "<h2>Recent Writes</h2>", 'aria-label="Factory memory gates"', 'aria-label="Recent writes"']) expect(h).toContain(t);
  const nh = v.renderNote({ title: "T", path: "wiki/x/T.md", archived: false, frontmatter: { kind: "gotcha" }, body: "see [[U]]", links: [], backlinks: [{ title: "V", kind: "gotcha", scope: "a" }] });
  expect(nh).toContain('href="#/memory/U"');
  expect(nh).toContain("Linked From");
});

test("the Writes, counts and hooks tables show empty() with no rows and page at 50", () => {
  const base = { exists: true, total: 0, byKind: {}, byScope: {}, home: [], lint: { refuse: [], warn: [] }, notes: [] };
  const hooks = (n: number) => ({ procedural: { skills: [], claudeMd: null, hooks: Array.from({ length: n }, (_, i) => ({ event: "Stop", matcher: "", command: `c${i}`, calls: i })), last: "" } });
  const one = '<div class="empty"><p>';
  expect(v.renderWrites({ writes: [] })).toContain(`${one}No writes recorded.`);
  const sem = v.renderMemory({ ...base, writes: [] }, v.options(new URLSearchParams("type=semantic")));
  for (const t of ["No notes by kind.", "No notes by scope."]) expect(sem).toContain(`${one}${t}`);
  expect(v.renderMemory({ ...base, writes: [], types: hooks(0) }, v.options(new URLSearchParams("type=procedural")))).toContain(`${one}No hooks in`);
  const w = v.renderWrites({ writes: Array.from({ length: 51 }, (_, i) => ({ text: `w${i}`, date: "2026-11-01", time: "10:00" })) });
  expect(w).toContain("50 of 51");
  expect(w.match(/<tr hidden>/g)?.length).toBe(1);
  const h = v.renderMemory({ ...base, writes: [], types: hooks(51) }, v.options(new URLSearchParams("type=procedural")));
  expect(h).toContain('<th>Event</th><th>Command</th><th class="num">Calls</th>');
  expect(h).toContain("50 of 51");
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

const row = (over: object) => ({ title: "T", kind: "gotcha", scope: "aleph", updated: "2026-10-01", read: null, problems: [], ...over });
test("a note's status: a refusal first, then recent, earlier, never", () => {
  const now = Date.parse("2026-11-01T12:00");
  expect(v.noteStatus(row({ read: "2026-10-30" }), now)).toBe("use");
  expect(v.noteStatus(row({ read: "2026-10-01" }), now)).toBe("stale");
  expect(v.noteStatus(row({}), now)).toBe("never");
  expect(v.noteStatus(row({ read: "2026-10-30", problems: [{ rule: "schema", detail: "x" }] }), now)).toBe("lint");
});

test("the browser filters, ranks a search first and sorts; episodes come only on request", () => {
  const rows = [row({ title: "A", status: "never", updated: "2026-10-02" }), row({ title: "B", status: "use", scope: "x", updated: "2026-10-03" }), row({ title: "Ep", kind: "episode", status: "never" })];
  const t = (q: string, hits: string[] = []) => v.browseRows(rows, v.options(new URLSearchParams(q)), hits).map((n: any) => n.title);
  expect(t("")).toEqual(["B", "A"]);
  expect(t("status=never")).toEqual(["A"]);
  expect(t("scope=x")).toEqual(["B"]);
  expect(t("kind=episode")).toEqual(["Ep"]);
  expect(t("q=body", ["A", "B"])).toEqual(["A", "B"]);
  expect(t("q=body", ["B"])).toEqual(["B"]);
  expect(t("sort=title&dir=desc")).toEqual(["B", "A"]);
});

test("the page is the board, then broad health, then the note browser; the type comes from the query", () => {
  const m = { exists: true, total: 2, byKind: { gotcha: 2 }, byScope: { aleph: 2 }, home: [], writes: [],
    lint: { refuse: [{ note: "B", rule: "schema", detail: "no confidence" }, { note: "B", rule: "dangling", detail: "x" }], warn: [{ note: "A", rule: "orphan", detail: "y" }] },
    notes: [row({ title: "A" }), row({ title: "B", read: "2026-10-01", problems: [{ rule: "schema", detail: "no confidence" }] })] };
  const h = v.renderMemory({ ...m, writes: [{ text: "w", date: "2026-11-01", time: "10:00" }] });
  expect(h).toContain("<th>When</th><th>Write</th>");
  expect(h).toMatch(/data-sort="updated">Written<.*?data-sort="title">Title</s);
  expect(h).toContain('<header class="ph"><h1>Memory</h1></header>');
  expect(h.indexOf('class="tiles"')).toBeLessThan(h.indexOf('aria-label="Lint"'));
  expect(h.indexOf('aria-label="Lint"')).toBeLessThan(h.indexOf('id="mem-table"'));
  for (const id of ["working", "semantic", "episodic", "procedural", "retrieval", "prospective", "parametric"]) expect(h).toContain(`data-tile="${id}"`);
  expect(h).toContain('data-tile="semantic" aria-pressed="true"');
  const w = v.view.render(m, {}, new URLSearchParams("type=parametric"));
  expect(w).toContain('data-tile="parametric" aria-pressed="true"');
  expect(w).toContain("The model weights");
  expect(v.lintRules(m.lint).map((r: any) => [r.rule, r.refused, r.warned])).toEqual([["schema", 1, 0], ["dangling", 1, 0], ["orphan", 0, 1]]);
});

test("the inspector shows the note, its problem, sources, links and path, escaped", () => {
  const h = v.renderInspector({ title: "N", path: "wiki/N.md", frontmatter: { kind: "gotcha", scope: "a", confidence: "measured", updated: "2026-10-01", sources: ["<src>"] }, body: "**Claim.** x", links: [{ title: "L" }], backlinks: [{ title: "B" }] }, row({ status: "lint", problems: [{ rule: "schema", detail: "bad" }] }));
  for (const s of ["Lint problem", "schema: bad", "&lt;src&gt;", "<strong>Claim.</strong>", "Linked From", "wiki/N.md"]) expect(h).toContain(s);
  expect(v.renderInspector(null)).toContain("Select a note");
});

test("/api/memory lists the notes with their read date, and a page search logs no read", async () => {
  const log = join(base, "vault", ".recall.json");
  writeFileSync(log, JSON.stringify({ "Use Bun": "2026-10-30" }));
  const m = await (await at("/api/memory")).json() as any;
  expect(m.notes.find((n: any) => n.title === "Use Bun")).toMatchObject({ read: "2026-10-30", problems: expect.any(Array) });
  expect(m.notes.some((n: any) => n.read === null)).toBe(true);
  await at("/api/memory/search?q=bun");
  expect(JSON.parse(readFileSync(log, "utf8"))).toEqual({ "Use Bun": "2026-10-30" });
});

test("/api/memory lint gives no stale finding to an old note that the read log shows read lately", async () => {
  const file = join(base, "vault", "wiki", "concepts", "Old idea.md");
  const log = join(base, "vault", ".recall.json");
  writeFileSync(file, `---\nkind: concept\nscope: aleph\nconfidence: measured\nupdated: 2025-01-01\nsupersedes: []\nsources: [trace:abc123]\n---\n**Claim.** Old.\n`);
  const stale = async () => { clearCache(); return ((await (await at("/api/memory")).json() as any).lint.warn as any[]).filter((f) => f.rule === "stale" && f.note === "Old idea"); };
  try {
    writeFileSync(log, JSON.stringify({ "Old idea": "2026-11-02" }));
    expect(await stale()).toEqual([]);
    writeFileSync(log, "{}");
    expect(await stale()).toHaveLength(1);
  } finally { rmSync(file); rmSync(log, { force: true }); clearCache(); }
});

test("prospective issues carry their priority, medium when they have none, and the page shows the badge", async () => {
  writeFileSync(join(base, "repos.json"), JSON.stringify({ pri: { path: base } }));
  try {
    writeList({ key: "pri" }, "seed", (doc) => {
      const a = add(doc, "urgent wait", { priority: "critical" });
      const b = add(doc, "plain wait");
      a.fm.after = ["pri-9"];
      b.fm.after = ["pri-9"];
      delete b.fm.priority;
      return true;
    }, true);
    const t: any = await memoryTypes(join(base, "vault"), [], null);
    expect(t.prospective.issues.map((i: any) => i.priority)).toEqual(["critical", "medium"]);
    const h = v.view.render({ exists: true, total: 0, byKind: {}, byScope: {}, home: [], lint: { refuse: [], warn: [] }, writes: [], types: t }, {}, new URLSearchParams("type=prospective"));
    expect(h).toContain(priorityBadge("critical"));
    expect(h).toContain(">critical<");
    expect(h).toContain("<h3>Open Issues With a Wait<");
  } finally {
    writeFileSync(join(base, "repos.json"), "{}");
  }
});

test("working lists the per-project handoffs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "proj-"));
  mkdirSync(join(dir, "projects"));
  writeFileSync(join(dir, "projects", "aleph.md"), "summary: Fix the memory tab\n\nBody.\n");
  const restore = withEnv({ ALEPH_HANDOFFS_DIR: dir });
  try {
    const t: any = await memoryTypes(join(base, "vault"), [], null);
    expect(t.working.projects.map((x: any) => [x.name, x.text])).toEqual([["aleph", "Fix the memory tab"]]);
    expect(t.working.total).toBe(1);
    const h = v.view.render({ exists: true, total: 0, byKind: {}, byScope: {}, home: [], lint: { refuse: [], warn: [] }, writes: [], types: t }, {}, new URLSearchParams("type=working"));
    expect(h).toContain("Fix the memory tab");
    expect(h).not.toContain("No handoff yet.");
  } finally {
    restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("typeTiles writes the unrounded returned share", async () => {
  // @ts-ignore plain JS shared with the page
  const { typeTiles } = await import("./views/memory.js");
  const rows = Array.from({ length: 1000 }, (_, i) => ({ kind: "decision", read: i < 3 ? "2026-11-01" : null }));
  expect(typeTiles({ exists: true }, rows).find((t: any) => t.id === "semantic").v2).toBe("0.3%");
});

test("semantic lists each scope's core lines and the start-context bytes against the budget", async () => {
  const { loadVault, startContext, coreNotes } = await import("../vault/lib/vault.ts");
  const root = join(base, "vault");
  const core = (dir: string, title: string, scope: string, line: string) => note(dir, title, "decision", scope, "**Claim.** x", line);
  core("decisions", "Core A", "aleph", "line for aleph");
  core("decisions", "Core G", "global", "line for global");
  core("decisions", "Core O", "other", "line for other");
  try {
    const all = await loadVault(root);
    const t: any = await memoryTypes(root, [], null, all);
    for (const scope of ["aleph", "global"]) {
      const s = t.semantic.start[scope];
      expect(s.core.map((c: any) => c.title)).toEqual(coreNotes(all, scope).map((n: any) => n.title));
      expect(s.bytes).toBe(Buffer.byteLength(startContext(root, all, scope).text));
    }
    expect(t.semantic.start.aleph.core.map((c: any) => c.core).sort()).toEqual(["line for aleph", "line for global"]);
    expect(JSON.stringify(t.semantic.start)).not.toContain("line for other");
    const h = v.view.render({ exists: true, total: 0, byKind: {}, byScope: {}, home: [], lint: { refuse: [], warn: [] }, writes: [], types: t }, {}, new URLSearchParams("type=semantic"));
    for (const l of ["line for aleph", "line for global"]) expect(h).toContain(l);
    for (const scope of ["aleph", "global"]) expect(h).toContain(`${t.semantic.start[scope].bytes} / 6000 bytes`);
  } finally {
    for (const t of ["Core A", "Core G", "Core O"]) rmSync(join(root, "wiki", "decisions", `${t}.md`));
  }
});
