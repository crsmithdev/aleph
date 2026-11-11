import { afterAll, beforeAll, expect, setSystemTime, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withEnv, withServer, type TestServer } from "./test-server.ts";
import { updater } from "./updater.ts";
import { onLater } from "./build.ts";
import { items } from "./memory-items.ts";
import { writeList } from "../issues/lib/store.ts";
import { add } from "../issues/lib/todo.ts";
// @ts-ignore plain JS, shared with the page
import { dataTable, empty, heads, priorityBadge } from "./lib.js";
// @ts-ignore
import * as v from "./views/memory.js";
// @ts-ignore
import { noteView } from "./views/memory.js";

// The test's clock: the code under test reads it, and the fixtures sit at known distances from it.
const NOW = Date.parse("2026-11-04T12:00:00Z");
beforeAll(() => setSystemTime(NOW));
afterAll(() => setSystemTime());

let base: string, server: TestServer, stop: () => void, restoreEnv: () => void;
const at = (p: string) => fetch(`http://127.0.0.1:${server.port}${p}`);
/** Build the kept keys that read `source` again, as the watcher would after a write. */
const fresh = async (source = "vault") => { updater.changed(source); await updater.flush(); };
/** Ends when the Worker has reported each of the `later` reads `names` (a slow read ends after its build answered). */
function ended(...names: string[]): Promise<void> {
  const left = new Set(names.map((n) => `later:${n}`));
  return new Promise((ok) => onLater((source) => {
    updater.changed(source);
    left.delete(source);
    if (!left.size) { onLater((src) => updater.changed(src)); ok(); }
  }));
}
const today = new Date(NOW).toISOString().slice(0, 10);

/** The registry: a project filter names a key in it, or it matches nothing. */
const REPOS = JSON.stringify({ other: { path: "/nonexistent/other" } });

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
  // The memory items read the repo registry, the work store and the job runs: point them at small fixtures so the first request is quick and the TTL test's clock is not spent on the network or ~/.aleph.
  const git = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd, stdio: "ignore" });
  git(base, "init", "-q", "--bare", "-b", "main", join(base, "items.git"));
  git(base, "clone", "-q", join(base, "items.git"), join(base, "items"));
  git(join(base, "items"), "commit", "-q", "--allow-empty", "-m", "start");
  git(join(base, "items"), "push", "-q", "origin", "main");
  writeFileSync(join(base, "repos.json"), REPOS);
  mkdirSync(join(base, "jobs"));
  const restoreStore = withEnv({ ALEPH_REPOS: join(base, "repos.json"), ALEPH_ISSUES: join(base, "items"), ALEPH_JOBS_DIR: join(base, "jobs"), ALEPH_FACTORY_DIR: join(base, "factory") });
  restoreEnv = () => { restoreStore(); restoreVault(); restoreHandoffs(); };
  ({ server, stop } = await withServer());
});
afterAll(() => {
  stop();
  restoreEnv();
  rmSync(base, { recursive: true, force: true });
});

test("the search lists the pages in the factory's episodes folder", async () => {
  const r: any = await (await at("/api/memory/search?q=")).json();
  expect(r.results.filter((x: any) => x.source === "episode").map((x: any) => [x.title, x.scope, x.at, x.text])).toEqual([["aleph-1 Goal", "aleph", today, "Ship it."]]);
});

test("?project= keeps only that project's data", async () => {
  const m: any = await (await at("/api/memory?project=other")).json();
  expect(m.total).toBe(1);
  expect(m.byScope).toEqual({ other: 1 });
  expect(m.home.map((s: any) => s.heading)).toEqual(["Gotchas"]);
  expect(m.writes.map((w: any) => w.text)).toEqual(["write [[Other trap]] — why"]);
  const s: any = await (await at("/api/memory/search?q=bun&project=other")).json();
  expect(s.results.filter((r: any) => r.source === "note").map((r: any) => r.title)).toEqual(["Other trap"]);
  // A rule or a skill is global: it is in every project.
  expect(s.results.every((r: any) => ["other", "global", ""].includes(r.scope))).toBe(true);
  expect((await at("/api/memory/notes/Use%20Bun?project=other")).status).toBe(404);
  const n: any = await (await at("/api/memory/notes/Other%20trap?project=other")).json();
  expect(n.links).toEqual([]);  // Use Bun is another project's
});

test("?project= with a key not in the registry shows no notes", async () => {
  const m: any = await (await at("/api/memory?project=zeta")).json();
  expect(m.total).toBe(0);
  const s: any = await (await at("/api/memory/search?q=&project=zeta")).json();
  expect(s.results).toEqual([]);
});

test("a note has its links and backlinks; a missing note is 404", async () => {
  const n: any = await (await at("/api/memory/notes/Use%20Bun")).json();
  expect(n.frontmatter.kind).toBe("decision");
  expect(n.links.map((l: any) => l.title)).toEqual(["Other trap"]);
  expect(n.backlinks.map((l: any) => l.title)).toContain("Other trap");
  expect(n.backlinks.map((l: any) => l.title)).toContain("Home");
  expect((await at("/api/memory/notes/Nope")).status).toBe(404);
});

test("one vault misses run serves the overview and every search until the usage poll", async () => {
  const bin = join(base, "bin-once"), log = join(base, "calls-once");
  mkdirSync(bin);
  writeFileSync(join(bin, "bun"), `#!/bin/sh\necho x >> ${log}\necho '{"days":7,"recalls":3}'\n`);
  chmodSync(join(bin, "bun"), 0o755);
  const saveEnv = { PATH: process.env.PATH };
  process.env.PATH = `${bin}:${process.env.PATH}`;
  updater.reset();
  const runs = () => readFileSync(log, "utf8").trim().split("\n").length;
  try {
    // The first answer does not wait for the slow read; the next build after it ends has the misses.
    const read = ended("memory:misses");
    const a: any = await (await at("/api/memory")).json();
    expect(a.misses).toBeUndefined();
    await read;
    await updater.flush();
    expect(((await (await at("/api/memory")).json()) as any).misses).toEqual({ days: 7, recalls: 3 });
    await at("/api/memory/search?q=bun");
    await at("/api/memory/search?q=trap");
    expect(runs()).toBe(1);
    // vault misses reads Langfuse in its subprocess for ~45 s: the 10 min usage poll runs it again, and a vault change does not.
    await fresh("vault");
    expect(runs()).toBe(1);
    await fresh("usage");
    expect(runs()).toBe(2);
  } finally {
    process.env.PATH = saveEnv.PATH;
    updater.reset();
  }
});

/** A stub `bun` that fails and logs each call, and a Langfuse that answers 500 and counts requests. */
async function failing(name: string) {
  const bin = join(base, name), log = join(base, `${name}-calls`);
  mkdirSync(bin);
  writeFileSync(join(bin, "bun"), `#!/bin/sh\necho x >> ${log}\nexit 1\n`);
  chmodSync(join(bin, "bun"), 0o755);
  let requests = 0;
  const lf = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => { requests++; return new Response("boom", { status: 500 }); } });
  const keys = ["PATH", "LANGFUSE_BASE_URL", "LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY"];
  const saveEnv = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, { PATH: `${bin}:${process.env.PATH}`, LANGFUSE_BASE_URL: `http://127.0.0.1:${lf.port}`, LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk" });
  updater.reset();
  const calls = () => { try { return readFileSync(log, "utf8").trim().split("\n").length; } catch { return 0; } };
  const done = () => {
    lf.stop(true);
    for (const [k, val] of Object.entries(saveEnv)) { if (val === undefined) delete process.env[k]; else process.env[k] = val; }
    updater.reset();
  };
  return { calls, requests: () => requests, done };
}

test("a failed load is kept until its source changes: no second spawn, no second Langfuse request", async () => {
  const f = await failing("bin-fail");
  try {
    const read = ended("memory:misses", "memory:sessions", "memory:calls");
    const a = await at("/api/memory");
    expect(a.status).toBe(200);
    const body: any = await a.json();
    expect(body.misses).toBeUndefined();
    const r: any = await (await at("/api/memory/search?q=")).json();
    expect(r.results.filter((x: any) => x.source === "session")).toEqual([]);
    // The slow reads run after the answer: wait until each has failed.
    await read;
    await updater.flush();
    expect(f.calls()).toBe(1);
    expect(f.requests()).toBeGreaterThan(0);
    const seen = f.requests();
    await at("/api/memory/search?q=bun");
    await fresh("vault");
    const b = await at("/api/memory");
    expect(b.status).toBe(200);
    expect(f.calls()).toBe(1);
    expect(f.requests()).toBe(seen);
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

test("/api/memory lists the notes with their read date, and a page search logs no read", async () => {
  const log = join(base, "vault", ".recall.json");
  writeFileSync(log, JSON.stringify({ "Use Bun": "2026-10-30" }));
  await fresh();
  const m = await (await at("/api/memory")).json() as any;
  expect(m.notes.find((n: any) => n.title === "Use Bun")).toMatchObject({ read: "2026-10-30", problems: expect.any(Array) });
  expect(m.notes.some((n: any) => n.read === null)).toBe(true);
  await at("/api/memory/search?q=bun");
  expect(JSON.parse(readFileSync(log, "utf8"))).toEqual({ "Use Bun": "2026-10-30" });
});

test("/api/memory reports an error, not unread notes, when the recall log does not parse", async () => {
  const log = join(base, "vault", ".recall.json");
  writeFileSync(log, "{");
  await fresh();
  try {
    const m = await (await at("/api/memory")).json() as any;
    expect(m.error).toContain("JSON");
  } finally { rmSync(log, { force: true }); await fresh(); }
});

test("/api/memory gives each note its recall count per day over 30 days, and the inspector draws them", async () => {
  const log = join(base, "vault", ".recall-log.jsonl");
  const day = (n: number) => new Date(NOW - n * 86400_000).toISOString().slice(0, 10);
  writeFileSync(log, [day(0), day(0), day(3)].map((date) => JSON.stringify({ date, title: "Use Bun", query: "q" })).join("\n") + "\n");
  await fresh();
  try {
    const m = await (await at("/api/memory")).json() as any;
    const bun = m.notes.find((n: any) => n.title === "Use Bun");
    expect(bun.history).toHaveLength(30);
    expect(bun.history[29]).toBe(2);
    expect(bun.history[26]).toBe(1);
    expect(bun.history.reduce((a: number, b: number) => a + b)).toBe(3);
    expect(m.notes.find((n: any) => n.title !== "Use Bun").history).toEqual(Array(30).fill(0));
  } finally { rmSync(log, { force: true }); await fresh(); }
  const n = { title: "N", path: "wiki/N.md", frontmatter: {}, body: "x", links: [], backlinks: [] };
  const hist = Array(30).fill(0); hist[29] = 2; hist[26] = 1;
  const note = { type: "semantic", source: "note", key: "N", title: "N", text: "", scope: "", at: "", read: null, effect: "" };
  const h = v.renderInspector(note, n, "use", hist);
  expect(h).toContain('<aleph-chart key="memory/recall"');
  expect(h).toContain('aria-label="Recalls per Day: Recalls 3"');
  expect(h).not.toContain("mhist");
  expect(h).not.toContain("<i title=");
  expect(v.recallFrame(hist).rows.map((r: any) => r.recalls)).toEqual(hist);
  expect(v.renderInspector(note, n, "use", Array(30).fill(0))).toContain(empty("No recall in the last 30 days.", "A note shows here once recall returns it."));
});

test("/api/memory lint gives no stale finding to an old note that the read log shows read lately", async () => {
  const file = join(base, "vault", "wiki", "concepts", "Old idea.md");
  const log = join(base, "vault", ".recall.json");
  writeFileSync(file, `---\nkind: concept\nscope: aleph\nconfidence: measured\nupdated: 2025-01-01\nsupersedes: []\nsources: [trace:abc123]\n---\n**Claim.** Old.\n`);
  const stale = async () => { await fresh(); return ((await (await at("/api/memory")).json() as any).lint.warn as any[]).filter((f) => f.rule === "stale" && f.note === "Old idea"); };
  try {
    writeFileSync(log, JSON.stringify({ "Old idea": "2026-11-02" }));
    expect(await stale()).toEqual([]);
    writeFileSync(log, "{}");
    expect(await stale()).toHaveLength(1);
  } finally { rmSync(file); rmSync(log, { force: true }); await fresh(); }
});

test("prospective issues carry their priority, medium when they have none", async () => {
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
    const all = await items(join(base, "vault"), [], {}, null);
    expect(all.filter((i) => i.source === "issue").map((i) => i.priority)).toEqual(["critical", "medium"]);
  } finally {
    writeFileSync(join(base, "repos.json"), REPOS);
  }
});

test("a project handoff shows its summary line", async () => {
  const dir = mkdtempSync(join(tmpdir(), "proj-"));
  mkdirSync(join(dir, "projects"));
  writeFileSync(join(dir, "projects", "aleph.md"), "summary: Fix the memory tab\n\nBody.\n");
  const restore = withEnv({ ALEPH_HANDOFFS_DIR: dir });
  try {
    const all = await items(join(base, "vault"), [], {}, null);
    expect(all.filter((i) => i.source === "handoff").map((i) => [i.key, i.scope, i.text])).toEqual([["projects/aleph.md", "aleph", "Fix the memory tab"]]);
  } finally {
    restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("/api/memory lists each scope's core lines and the start-context bytes against the budget", async () => {
  const { loadVault, startContext, coreNotes } = await import("../vault/lib/vault.ts");
  const root = join(base, "vault");
  const core = (dir: string, title: string, scope: string, line: string) => note(dir, title, "decision", scope, "**Claim.** x", line);
  core("decisions", "Core A", "aleph", "line for aleph");
  core("decisions", "Core G", "global", "line for global");
  core("decisions", "Core O", "other", "line for other");
  try {
    const all = await loadVault(root);
    await fresh("vault");
    const t: any = await (await at("/api/memory")).json();
    for (const scope of ["aleph", "global"]) {
      const s = t.start[scope];
      expect(s.core.map((c: any) => c.title)).toEqual(coreNotes(all, scope).map((n: any) => n.title));
      expect(s.bytes).toBe(Buffer.byteLength(startContext(root, all, scope).text));
    }
    expect(t.start.aleph.core.map((c: any) => c.core).sort()).toEqual(["line for aleph", "line for global"]);
    expect(JSON.stringify(t.start)).not.toContain("line for other");
  } finally {
    for (const t of ["Core A", "Core G", "Core O"]) rmSync(join(root, "wiki", "decisions", `${t}.md`));
    await fresh("vault");
  }
});


const it = (over: object) => ({ type: "semantic", source: "note", key: "N", title: "N", text: "claim", scope: "aleph", at: "2026-10-01", read: null, effect: "Reaches a session when vault recall returns it.", ...over });
const page = { exists: true, total: 1, byKind: {}, byScope: {}, scopes: ["aleph", "other"], home: [], lint: { refuse: [], warn: [] }, writes: [], notes: [row({ title: "N", read: "2026-11-03" }), row({ title: "Never" })],
  start: { aleph: { bytes: 3000, budget: 6000, cut: 0, core: [{ title: "N", core: "c" }] } } };

test("the page is the search, the freshness filter, seven type tiles, the results and the inspector, then health", () => {
  const h = v.renderMemory(page, v.options(new URLSearchParams("q=work")), [it({}), it({ type: "working", source: "handoff", key: "current.md", title: "current handoff" })]);
  for (const t of ['data-ui="mem-search"', 'value="work"', "Read in 7 days", 'id="mem-inspector"', "<h2>Health</h2>", "3000 / 6000 bytes, 1 core lines", '<datalist id="mem-titles"><option value="N"><option value="Never"></datalist>', '<option value="other">other</option>'])
    expect(h).toContain(t);
  expect(h.match(/data-tile=/g)).toHaveLength(7);
  expect(h).toMatch(/data-tile="working" aria-pressed="false"><span class="r1"><span class="k">Working<\/span><\/span><b>1<\/b>/);
  expect(h).toMatch(/data-tile="parametric"[^]*?<b>–<\/b>/);
  expect(v.renderMemory(page, v.options(), null)).toContain("Loading memory");
  expect(v.view.api({}, new URLSearchParams("project=aleph"))).toBe("/api/memory?project=aleph");
  const nh = v.renderNote({ title: "T", path: "wiki/x/T.md", archived: false, frontmatter: { kind: "gotcha" }, body: "see [[U]]", links: [], backlinks: [{ title: "V", kind: "gotcha", scope: "a" }] });
  expect(nh).toContain('href="#/memory/U"');
  const none = v.renderNote({ title: "T", path: "wiki/x/T.md", archived: false, frontmatter: { kind: "gotcha" }, body: "x", links: [], backlinks: [] });
  expect(none).not.toContain('id="links"');
  expect(none).not.toContain('id="backlinks"');
  expect(nh).not.toContain('id="links"');
  expect(nh).toContain('<section class="card" id="backlinks"');
  expect(nh).toMatch(/id="h-backlinks">Linked from<\/h2><span class="count">1<\/span>/);
});

test("each type has its own layout, filters keep by type and freshness, and the tiles count before the type filter", () => {
  const rs = [it({}), it({ key: "Never", title: "Never" }), it({ type: "procedural", source: "skill", key: "vault", title: "skill vault", text: "the vault", at: "2026-01-01" }),
    it({ type: "episodic", source: "episode", key: "e.md", title: "e" }), it({ type: "prospective", source: "issue", key: "a/1", title: "a-1", priority: "high" })];
  const status = new Map(v.noteRows(page, NOW).map((n: any) => [n.title, n.status]));
  const keep = (q: string) => v.keepRows(rs, v.options(new URLSearchParams(q)), status, NOW).map((x: any) => x.title);
  expect(keep("type=procedural")).toEqual(["skill vault"]);
  expect(keep("fresh=use")).toEqual(["N"]);
  expect(keep("fresh=never")).toEqual(["Never"]);
  expect(keep("fresh=old")).toEqual(["skill vault"]);
  expect(v.typeCounts(rs, v.options(new URLSearchParams("type=procedural&fresh=never")), status)).toMatchObject({ semantic: 1, procedural: 0 });
  const h = v.renderResults(rs, v.options(), status);
  expect(h).toContain("<th>Loaded when</th>");          // procedural: a table
  expect(h).toContain('<ul class="mrows tl">');           // episodic: a timeline
  expect(h).toContain(priorityBadge("high"));             // prospective: cards with the priority
  expect(h).toContain("read never");                      // semantic: the read date
  expect(h.match(/<li class="mrow[^>]* tabindex="0"/g)?.length).toBeGreaterThan(0);
  expect(v.renderResults(rs.slice(2, 3), v.options(), status)).toMatch(/<tr class="mrow" tabindex="0"/);
  expect(v.renderResults([], v.options(new URLSearchParams("q=zz")), status)).toContain("No memory matches “zz”.");
  const many = v.renderResults(Array.from({ length: 51 }, (_, i) => it({ key: `n${i}`, title: `n${i}` })), v.options(), status);
  expect(many).toContain("50 of 51");
  expect(many.match(/<li hidden /g)).toHaveLength(1);
});

test("the procedural table is dataTable's, so it has the tscroll wrapper, the tbl class and the heads", () => {
  const o = v.options();
  const proc = it({ type: "procedural", source: "skill", key: "vault", title: "skill vault", text: "the vault", at: "2026-01-01" });
  const h = v.renderResults([proc], o, new Map());
  expect(h).toContain(dataTable(heads(["Source", "What it says", "Loaded when", "Changed"]), v.ruleRow(proc, o)));
});

test("the procedural table hides its 51st row and its pager says 50 of 51", () => {
  const o = v.options();
  const procs = Array.from({ length: 51 }, (_, i) => it({ type: "procedural", source: "skill", key: `s${i}`, title: `s${i}` }));
  const rows = procs.map((x, i) => v.ruleRow(x, o).replace("<tr ", i < 50 ? "<tr " : "<tr hidden ")).join("");
  const h = v.renderResults(procs, o, new Map());
  expect(h).toContain(dataTable(heads(["Source", "What it says", "Loaded when", "Changed"]), rows));
  expect(h).toContain("50 of 51");
  const trs = h.slice(h.indexOf("<tbody>") + 7, h.indexOf("</tbody>")).split("<tr ").slice(1);
  expect(trs).toHaveLength(51);
  expect(trs[50].startsWith("hidden ")).toBe(true);
  expect(trs.filter((r: string) => r.startsWith("hidden "))).toHaveLength(1);
});

test("the inspector says how a memory reaches the agent, shows its recall history and offers the writes its source takes", () => {
  const n = { title: "N", path: "wiki/gotchas/N.md", frontmatter: { scope: "aleph", confidence: "measured", core: "the <core>" }, body: "**Claim.** x", text: "", links: [{ title: "L" }], backlinks: [{ title: "B" }] };
  const h = v.renderInspector(it({ read: "2026-11-03" }), n, "use");
  for (const t of ["How it reaches the agent", "Reaches a session when vault recall returns it.", 'value="the &lt;core&gt;"', "Recall history", "No recall in the last 30 days.", 'data-mact="unlink" data-target="L"', 'data-mact="link"', 'data-mact="archive"', 'data-mact="delete"', "in use", "wiki/gotchas/N.md"])
    expect(h).toContain(t);
  // No button of the page carries data-act, which router.js's own handler takes.
  expect(h).not.toContain("data-act=");
  const hand = v.renderInspector(it({ type: "working", source: "handoff", key: "current.md", title: "current handoff" }));
  for (const t of ['data-mact="edit"', 'data-mact="file-delete"']) expect(hand).toContain(t);
  expect(hand).not.toContain("Recall history");
  expect(v.renderInspector(it({ type: "working", source: "handoff", key: "current.md" }), null, "", [1])).not.toContain("aleph-chart");
  expect(v.renderInspector(it({ type: "procedural", source: "skill", key: "vault", href: "#/skills/vault" }))).toContain("change it on a branch");
  expect(v.renderInspector(it({ type: "retrieval", source: "miss" }))).toContain('data-mact="alias"');
  expect(v.renderInspector(it({ type: "procedural", source: "proposal", key: "p1" }))).toContain('data-mact="approve"');
  expect(v.renderInspector(it({ type: "prospective", source: "issue", key: "a/1" }))).toContain('data-mact="drop"');
  expect(v.renderInspector(it({ title: "<x>" }))).toContain("&lt;x&gt;");
  expect(v.renderInspector(null)).toContain("Select a memory");
});
