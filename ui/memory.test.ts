import { conn, putJson } from "../lib/db.ts";
import { setTick } from "../jobs/lib/gates/tables.ts";
import { afterAll, beforeAll, expect, setSystemTime, test } from "bun:test";
import { chmodSync, mkdirSync, utimesSync, readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withEnv, withServer, type TestServer } from "./server.testkit.ts";
import { updater } from "./updater.ts";
import { onLater } from "./build.ts";
import { items } from "./memory-items.ts";
import { writeList } from "../lib/store.ts";
import { add } from "../lib/todo.ts";
// @ts-ignore plain JS, shared with the page
import { scope } from "./views/lib/address.js";
// @ts-ignore plain JS, shared with the page
import { badge, dataTable, empty, heads, md, pageHead, priorityBadge } from "./views/lib/html.js";
// @ts-ignore
import * as v from "./views/memory.js";
// @ts-ignore
import { needs, writeWeeks } from "./views/lib/memory-health.js";
// @ts-ignore
import { renderMemoryJobs } from "./views/lib/processes.js";
// @ts-ignore
import { panel } from "./views/lib/timeline.js";
// @ts-ignore
import { noteView } from "./views/memory.js";
import { writeRepos } from "../tests/projects.testkit.ts";

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
  writeFileSync(join(root, "VAULT.md"), "# VAULT.md\n");
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
  writeRepos(JSON.parse(REPOS), join(base, "items"));
  mkdirSync(join(base, "jobs"));
  const restoreStore = withEnv({ ALEPH_ITEMS: join(base, "items"), ALEPH_JOBS_DIR: join(base, "jobs"), ALEPH_FACTORY_DIR: join(base, "factory") });
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
  expect((await at("/api/memory/notes/Nope")).status).toBe(404);
});

test("one vault misses run serves the overview and every search until the usage poll", async () => {
  const bin = join(base, "bin-once"), log = join(base, "calls-once");
  mkdirSync(bin);
  writeFileSync(join(bin, "aleph"), `#!/bin/sh\necho x >> ${log}\necho '{"days":7,"recalls":3}'\n`);
  chmodSync(join(bin, "aleph"), 0o755);
  const saveEnv = { ALEPH_CLI: process.env.ALEPH_CLI };
  process.env.ALEPH_CLI = join(bin, "aleph");
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
    if (saveEnv.ALEPH_CLI === undefined) delete process.env.ALEPH_CLI; else process.env.ALEPH_CLI = saveEnv.ALEPH_CLI;
    updater.reset();
  }
});

/** A stub `aleph` that fails and logs each call, and a Langfuse that answers 500 and counts requests. */
async function failing(name: string) {
  const bin = join(base, name), log = join(base, `${name}-calls`);
  mkdirSync(bin);
  writeFileSync(join(bin, "aleph"), `#!/bin/sh\necho x >> ${log}\nexit 1\n`);
  chmodSync(join(bin, "aleph"), 0o755);
  let requests = 0;
  const lf = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => { requests++; return new Response("boom", { status: 500 }); } });
  const keys = ["ALEPH_CLI", "LANGFUSE_BASE_URL", "LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY"];
  const saveEnv = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, { ALEPH_CLI: join(bin, "aleph"), LANGFUSE_BASE_URL: `http://127.0.0.1:${lf.port}`, LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk" });
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
  expect(h).toContain('aria-label="Offers per Day: offers 3"');
  expect(h).not.toContain("mhist");
  expect(h).not.toContain("<i title=");
  expect(v.recallFrame(hist).by.keys[0].name).toBe("offers");
  expect(v.recallFrame(hist).rows.map((r: any) => r.recalls)).toEqual(hist);
  expect(v.renderInspector(note, n, "use", Array(30).fill(0))).not.toContain("aleph-chart");
});

test("/api/memory lint still gives a stale finding to an old note that the read log shows read lately", async () => {
  const file = join(base, "vault", "wiki", "concepts", "Old idea.md");
  const log = join(base, "vault", ".recall.json");
  writeFileSync(file, `---\nkind: concept\nscope: aleph\nconfidence: measured\nupdated: 2025-01-01\nsupersedes: []\nsources: [trace:abc123]\n---\n**Claim.** Old.\n`);
  const stale = async () => { await fresh(); return ((await (await at("/api/memory")).json() as any).lint.warn as any[]).filter((f) => f.rule === "stale" && f.note === "Old idea"); };
  try {
    writeFileSync(log, JSON.stringify({ "Old idea": "2026-11-02" }));
    expect(await stale()).toHaveLength(1);
  } finally { rmSync(file); rmSync(log, { force: true }); await fresh(); }
});

test("prospective issues carry their priority, medium when they have none", async () => {
  writeRepos({ pri: { path: base } }, join(base, "items"));
  try {
    writeList({ key: "pri" }, "seed", (doc) => {
      const a = add(doc, "urgent wait", { priority: "critical" });
      const b = add(doc, "plain wait");
      a.fm.after = ["pri-9"];
      b.fm.after = ["pri-9"];
      delete b.fm.priority;
      return true;
    }, true);
    const all = await items(join(base, "vault"), [], {});
    expect(all.filter((i) => i.source === "issue").map((i) => i.priority)).toEqual(["critical", "medium"]);
  } finally {
    writeRepos(JSON.parse(REPOS), join(base, "items"));
  }
});

test("a project handoff shows its summary line", async () => {
  const dir = mkdtempSync(join(tmpdir(), "proj-"));
  mkdirSync(join(dir, "projects"));
  writeFileSync(join(dir, "projects", "aleph.md"), "summary: Fix the memory tab\n\nBody.\n");
  const restore = withEnv({ ALEPH_HANDOFFS_DIR: dir });
  try {
    const all = await items(join(base, "vault"), [], {});
    expect(all.filter((i) => i.source === "handoff").map((i) => [i.key, i.scope, i.text])).toEqual([["projects/aleph.md", "aleph", "Fix the memory tab"]]);
  } finally {
    restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a pane's handoff and a named handoff show, as handoff-start offers them", async () => {
  const dir = mkdtempSync(join(tmpdir(), "proj-"));
  mkdirSync(join(dir, "projects", "aleph"), { recursive: true });
  writeFileSync(join(dir, "projects", "aleph", "p7.md"), "summary: Pane work\n");
  writeFileSync(join(dir, "voice.md"), "summary: Voice work\n");
  const restore = withEnv({ ALEPH_HANDOFFS_DIR: dir });
  try {
    const all = await items(join(base, "vault"), [], {});
    expect(all.filter((i) => i.source === "handoff").map((i) => [i.key, i.scope, i.title, i.text])).toEqual([
      ["projects/aleph/p7.md", "aleph", "aleph p7 handoff", "Pane work"],
      ["voice.md", "", "voice handoff", "Voice work"],
    ]);
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
const page = { exists: true, total: 1, scopes: ["aleph", "other"], lint: { refuse: [], warn: [] }, writes: [], notes: [row({ title: "N", read: "2026-11-03" }), row({ title: "Never" })],
  start: { aleph: { bytes: 3000, budget: 6000, cut: 0, core: [{ title: "N", core: "c" }] } } };

test("the Notes tab is the kind filter, the search, the freshness filter, the results and the inspector, with no health", () => {
  const h = v.renderMemory(page, v.options(new URLSearchParams("q=work")), [it({}), it({ type: "working", source: "handoff", key: "current.md", title: "current handoff" })]);
  for (const t of ['data-ui="mem-search"', 'value="work"', "Offered in 7 days", 'id="mem-inspector"', '<div class="msearch">', '<datalist id="mem-titles"><option value="N"><option value="Never"></datalist>', '<option value="other">other</option>'])
    expect(h).toContain(t);
  expect(h).not.toContain("<h2>Health</h2>");
  // The page head's filter is scope().bar(): the Project select, then the window control.
  expect(h).toContain(`<div class="page sp memory">${pageHead("Memory", { aside: scope().bar({ project: "", more: page.scopes }) })}`);
  expect(h).toContain('aria-label="Window" data-name="window"');
  // Page head, kind filter, search, freshness filter, then the results.
  const at = ["<h1>Memory</h1>", 'name="project"', 'id="mem-kind"', 'data-ui="mem-search"', 'id="mem-fresh"', 'id="mem-results"'].map((t) => h.indexOf(t));
  expect(at).toEqual([...at].sort((x, y) => x - y));
  expect(at[0]).toBeGreaterThanOrEqual(0);
  const kinds = h.slice(h.indexOf('data-name="type"'), h.indexOf("</div>", h.indexOf('data-name="type"')));
  expect([...kinds.matchAll(/data-value="(\w*)"/g)].map((m) => m[1])).toEqual(["", "semantic", "procedural", "episodic", "working", "prospective"]);
  expect(kinds).toContain('data-value="" aria-pressed="true">All 2</button>');
  expect(kinds).toContain('data-value="working" aria-pressed="false">Working 1</button>');
  expect(h).toContain('data-value="never" aria-pressed="false">Never offered 0</button>');
  const loading = v.renderMemory(page, v.options(), null);
  expect(loading).toContain("Loading memory");
  expect(loading).toContain('aria-pressed="true">All</button>');
  expect(v.view.api({}, new URLSearchParams("project=aleph"))).toEqual(["/api/memory?project=aleph", "/api/memory/processes"]);
  expect(v.view.api({}, new URLSearchParams("tab=health"))).toEqual(["/api/memory", "/api/memory/processes", "/api/memory/log"]);
  expect(v.view.combine([{ notes: [] }, { steps: [] }, { rows: [1] }])).toEqual({ notes: [], processes: { steps: [] }, rows: [1] });
  const nh = v.renderNote({ title: "T", path: "wiki/x/T.md", archived: false, frontmatter: { kind: "gotcha", written_by: "w", last_verified: "2026-11-01" }, body: "see [[U]]", links: [], backlinks: [{ title: "V", kind: "gotcha", scope: "a" }] });
  expect(nh).toContain('href="#/memory/U"');
  const none = v.renderNote({ title: "T", path: "wiki/x/T.md", archived: false, frontmatter: { kind: "gotcha" }, body: "x", links: [], backlinks: [] });
  // A section with no links is left out: neither its detailPanel() nor a card.
  for (const t of ["<span>Links to</span>", "<span>Linked from</span>", 'class="card"']) expect(none).not.toContain(t);
  expect(nh).not.toContain("<span>Links to</span>");
  expect(nh).not.toContain('<section class="card" id="backlinks"');
  expect(nh).toContain('<details class="dp-panel dp-fold" open><summary><span>Linked from</span><span class="dp-aside">1</span></summary>');
  const out = v.renderNote({ title: "T", path: "wiki/x/T.md", archived: false, frontmatter: {}, body: "x", links: [{ title: "U", kind: "gotcha", scope: "a" }], backlinks: [] });
  expect(out).toContain('<details class="dp-panel dp-fold" open><summary><span>Links to</span><span class="dp-aside">1</span></summary><div class="dp-body"><ul><li><a href="#/memory/U">U</a>');
  expect(out).not.toContain('<section class="card" id="links"');
  expect(out).not.toContain("<span>Linked from</span>");
  expect(nh).toContain(panel("note", "Note", `<div class="md">${md("see [[U]]")}</div>`));
  for (const t of ["<dt>Kind</dt>", "<dt>Written by</dt>", "<dt>Last verified</dt>"]) expect(nh).toContain(t);
  expect(nh).not.toContain("<dt>Last Verified</dt>");
  expect(nh).not.toContain("<dt>kind</dt>");
});

test("each type has its own layout, filters keep by type and freshness, and the kind counts come before the type filter", () => {
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
  expect(h).toContain("<th>Loaded When</th>");          // procedural: a table
  expect(h).toContain('<th class="num">Updated</th>');
  expect(h).toContain('<ul class="mrows tl">');           // episodic: a timeline
  expect(h).toContain('<td class="wide" title="the vault">');  // procedural: the title cell's full text
  expect(v.renderResults([it({ type: "episodic", source: "episode", key: "e.md", title: "e", at: "" })], v.options(), status)).toContain('<span class="time"><span title="No date">–</span></span>');
  expect(h).toContain(priorityBadge("high"));             // prospective: cards with the priority
  expect(h).toContain("offered never");                   // semantic: the offer date
  expect(h.match(/<li class="mrow[^>]* tabindex="0"/g)?.length).toBeGreaterThan(0);
  expect(v.renderResults(rs.slice(2, 3), v.options(), status)).toMatch(/<tr class="mrow" tabindex="0"/);
  expect(v.renderResults([], v.options(new URLSearchParams("q=zz")), status)).toBe(empty());
  const many = v.renderResults(Array.from({ length: 51 }, (_, i) => it({ key: `n${i}`, title: `n${i}` })), v.options(), status);
  expect(many).toContain("50 of 51");
  expect(many.match(/<li hidden /g)).toHaveLength(1);
});

test("the procedural table is dataTable's, so it has the tscroll wrapper, the tbl class and the heads", () => {
  const o = v.options();
  const proc = it({ type: "procedural", source: "skill", key: "vault", title: "skill vault", text: "the vault", at: "2026-01-01" });
  const h = v.renderResults([proc], o, new Map());
  expect(h).toContain(dataTable(heads(["Source", "What It Says", "Loaded When", "Updated"], ["Updated"]), v.ruleRow(proc, o)));
});

test("the Notes and Health tabs write their counts through count()", () => {
  const big = { ...page, misses: { recalls: 12345, days: 30, empty: 1000, empty_share: 0.1, reformulated: 2000, unoffered_reads: 0, missed: [], hook: { runs: 0, zero_candidates: 0, capped: 0 } }, lint: { refuse: [], warn: Array.from({ length: 1200 }, () => ({ rule: "r", note: "N", detail: "d" })) },
    start: { aleph: { bytes: 2048, budget: 4096, cut: 1500, memory: 1000, core: [] } } };
  const rs = Array.from({ length: 1000 }, (_, i) => it({ key: `n${i}`, title: `n${i}` }));
  const h = v.renderMemory(big, v.options(), rs);
  expect(h).toContain('data-value="semantic" aria-pressed="false">Semantic 1,000</button>');
  expect(h).toContain('<h3>Semantic</h3><span class="count">1,000</span>');
  const health = v.renderHealthTab(big);
  for (const t of ["<dd>12,345</dd>", "<dd>1,000 of 12,345 (10%)</dd>", "2,048 B / 4,096 B", '<span class="count">1,200</span>', '<td class="num">1,200</td>', "<b>1,500<em> / 0</em></b>"]) expect(health).toContain(t);
});

test("the procedural table hides its 51st row and its pager says 50 of 51", () => {
  const o = v.options();
  const procs = Array.from({ length: 51 }, (_, i) => it({ type: "procedural", source: "skill", key: `s${i}`, title: `s${i}` }));
  const rows = procs.map((x, i) => v.ruleRow(x, o).replace("<tr ", i < 50 ? "<tr " : "<tr hidden ")).join("");
  const h = v.renderResults(procs, o, new Map());
  expect(h).toContain(dataTable(heads(["Source", "What It Says", "Loaded When", "Updated"], ["Updated"]), rows));
  expect(h).toContain("50 of 51");
  const trs = h.slice(h.indexOf("<tbody>") + 7, h.indexOf("</tbody>")).split("<tr ").slice(1);
  expect(trs).toHaveLength(51);
  expect(trs[50].startsWith("hidden ")).toBe(true);
  expect(trs.filter((r: string) => r.startsWith("hidden "))).toHaveLength(1);
});

test("the inspector says how a memory reaches the agent, shows its recall history and offers the writes its source takes", () => {
  const n = { title: "N", path: "wiki/gotchas/N.md", frontmatter: { scope: "aleph", confidence: "measured", core: "the <core>" }, body: "**Claim.** x", text: "", links: [{ title: "L" }], backlinks: [{ title: "B" }] };
  const h = v.renderInspector(it({ read: "2026-11-03" }), n, "use");
  for (const t of ["How it reaches the agent", "Reaches a session when vault recall returns it.", 'value="the &lt;core&gt;"', 'data-mact="unlink" data-target="L"', 'data-mact="link"', 'data-mact="archive"', 'data-mact="delete"', "in use", "wiki/gotchas/N.md"])
    expect(h).toContain(t);
  // No button of the page carries data-act, which router.js's own handler takes.
  expect(h).not.toContain("data-act=");
  expect(h).toContain(`· ${badge("in use")}`);
  expect(h).toContain('<button class="act danger" type="button" data-mact="delete">Delete</button>');
  expect(h).toContain('<button class="act small" type="button" data-mact="unlink" data-target="L">Unlink</button>');
  const bare = v.renderInspector(it({}), { ...n, links: [], backlinks: [] }, "use");
  for (const t of ["Links to", "Linked from", "Recall history", empty()]) expect(bare).not.toContain(t);
  const hand = v.renderInspector(it({ type: "working", source: "handoff", key: "current.md", title: "current handoff" }));
  for (const t of ['data-mact="edit"', 'data-mact="file-delete"']) expect(hand).toContain(t);
  expect(hand).not.toContain("Recall history");
  expect(v.renderInspector(it({ type: "working", source: "handoff", key: "current.md" }), null, "", [1])).not.toContain("aleph-chart");
  expect(v.renderInspector(it({ type: "procedural", source: "skill", key: "vault", href: "#/skills/vault" }))).toContain("change it on a branch");
  expect(v.renderInspector(it({ type: "procedural", source: "proposal", key: "p1" }))).toContain('data-mact="approve"');
  expect(v.renderInspector(it({ type: "prospective", source: "issue", key: "a/1" }))).toContain('data-mact="drop"');
  expect(v.renderInspector(it({ title: "<x>" }))).toContain("&lt;x&gt;");
  expect(v.renderInspector(null)).toContain("Select a memory");
});

test("/api/memory/log lists writes and recalls newest first, one recall per call, and honours the project", async () => {
  const root = join(base, "vault"), log = join(root, ".recall-log.jsonl"), daily = join(root, "daily", "2026-11-03.md");
  writeFileSync(daily, "# d\n\n- 09:00 supersede [[Use Bun]] → [[Other trap]]\n- 09:10 build abc — not a note\n- 09:20 delete Gone Note — wrong claim\n");
  writeFileSync(log, [["Use Bun", "q1"], ["Other trap", "q1"], ["Use Bun", "q2"]].map(([title, query]) => JSON.stringify({ date: "2026-11-03", title, query })).join("\n") + "\n");
  await fresh();
  try {
    const m = await (await at("/api/memory/log")).json() as any;
    expect(m.rows.map((r: any) => [r.kind, r.op, r.note, r.why, r.titles])).toEqual([
      ["write", "write", "Other trap", "why", []], ["write", "write", "Use Bun", "why", []],
      ["write", "delete", "Gone Note", "wrong claim", []],
      ["write", "supersede", "Use Bun", "→ Other trap", []],
      ["recall", "recall", "Use Bun", "q1", ["Use Bun", "Other trap"]], ["recall", "recall", "Use Bun", "q2", ["Use Bun"]],
    ]);
    const mine = await (await at("/api/memory/log?project=other")).json() as any;
    expect(mine.rows.map((r: any) => [r.op, r.titles])).toEqual([["write", []], ["recall", ["Other trap"]]]);
  } finally { rmSync(log, { force: true }); rmSync(daily, { force: true }); await fresh(); }
});

test("/api/memory/processes reads the tick, the corrections store, the episode pages and the stale notes", async () => {
  utimesSync(join(base, "factory", "episodes", "aleph-1 Goal.md"), NOW / 1000, NOW / 1000);
  setTick("episodes", { last: "2026-11-04T11:30:00.000Z", result: "failed: no page" });
  setTick("maintain", { last: "2026-11-04T10:00:00.000Z", result: "dry: 1 fixed · 0 lessons · 2 notes" });
  const runs0 = join(base, "vault", ".index", "runs");
  mkdirSync(runs0, { recursive: true });
  writeFileSync(join(runs0, "maintain.json"), JSON.stringify({ at: "2026-11-04T10:00:00.000Z", result: "ok", detail: `dry: ${JSON.stringify({ decay: 3, overlap: 5 })}` }));
  writeFileSync(join(runs0, "compile.json"), JSON.stringify({ at: "2026-11-04T10:00:00.000Z", result: "ok", detail: "dry: 2026-11-03: 2 notes" }));
  const signal = (at: string) => ({ id: at, source: "chris", at, quote: "q", link: "" });
  putJson("state", "corrections", { minedAt: "2026-11-04T11:00:00.000Z", lessons: [{ id: "l1", sentence: "Run the checks.", state: "proposed", signals: [signal("2026-11-02T10:00:00.000Z"), signal("2026-11-01T10:00:00.000Z")] }, { id: "l2", sentence: "Old.", state: "declined", signals: [] }] });
  try {
    const m = await (await at("/api/memory/processes")).json() as any;
    expect(m.steps.map((s: any) => [s.name, s.last, s.next, s.result])).toEqual([
      ["episodes", "2026-11-04T11:30:00.000Z", "2026-11-04T12:00:00.000Z", "failed: no page"],
      ["maintain", "2026-11-04T10:00:00.000Z", m.steps[1].next, "dry: 1 fixed · 0 lessons · 2 notes"],
      ["seen prune", null, null, null],
      ["recall trim", null, null, null],
      ["vault push", null, null, null],
    ]);
    expect(m.steps[1]).toMatchObject({ name: "maintain", runs: "daily after 03:00", next: "2026-11-05T03:00:00.000Z", detail: "decay 3 · overlap 5 · 2 notes" });
    const runs = join(base, "vault", ".index", "runs");
    writeFileSync(join(runs, "seen prune.json"), JSON.stringify({ at: "2026-11-04T11:45:00.000Z", result: "ok" }));
    writeFileSync(join(runs, "vault push.json"), JSON.stringify({ at: "2026-11-04T11:50:00.000Z", result: "failed", detail: "no route" }));
    await fresh("factory");
    const r = (await (await at("/api/memory/processes")).json() as any).steps.slice(2).map((s: any) => [s.name, s.last, s.result, s.detail]);
    expect(r).toEqual([["seen prune", "2026-11-04T11:45:00.000Z", "ok", null], ["recall trim", null, null, null], ["vault push", "2026-11-04T11:50:00.000Z", "failed", "no route"]]);
    const row = renderMemoryJobs(await (await at("/api/memory/processes")).json()).split("<tr>").find((t: string) => t.includes("vault push"))!;
    expect(row).toContain('<span class="badge error" title="no route">failed</span>');
    expect(m.episodes.pages).toBe(1);
    expect(m.episodes.days.at(-1)).toEqual({ date: today, pages: 1, finished: 0 });
    expect(m.corrections).toEqual({ states: { declined: 1, proposed: 1 }, waiting: [{ id: "l1", sentence: "Run the checks.", state: "proposed", since: "2026-11-01T10:00:00.000Z" }] });
    const h = renderMemoryJobs(m);
    expect(h).toContain("Run the checks.");
    expect(h).toContain('data-act="approve" data-path="/api/proposals/l1/approve"');
    expect(h).toContain('data-act="decline" data-path="/api/proposals/l1/decline"');
    expect(h).toContain('<span class="badge error">failed: no page</span>');
    expect(renderMemoryJobs({ ...m, steps: [{ ...m.steps[0], result: "2 written" }] })).toContain('<span class="badge done">2 written</span>');
    expect(h).toContain("You decided 1: 0 of 1 approved (0.0%).");
  } finally { conn().run("DELETE FROM tick"); conn().run("DELETE FROM state"); rmSync(join(base, "vault", ".index", "runs"), { recursive: true, force: true }); }
});

test("the tabs link Notes, Health and Log; the log row opens a recall to its notes; Episode pages filter alone", () => {
  const h = v.renderTabs("log", "aleph");
  expect(h).toContain('<a href="#/memory?project=aleph">Notes</a>');
  expect(h).toContain('<a href="#/memory?tab=log&project=aleph" aria-current="page">Log</a>');
  expect(h).toContain('<a href="#/memory?tab=health&project=aleph">Health</a>');
  expect(h.match(/<a /g)).toHaveLength(3);
  expect(v.renderMemory(page)).toContain('<nav class="vtabs"');
  const r = { at: "2026-11-03", kind: "recall", op: "recall", note: "A", why: "q", titles: ["A", "B"] };
  expect(v.logRow(r)).toContain('<details><summary title="q">q</summary><ol><li><a href="#/memory/A">A</a></li><li><a href="#/memory/B">B</a></li></ol></details>');
  expect(v.logRow(r)).toContain("+1");
  const rows = [r, { ...r, kind: "miss", op: "miss", note: "", titles: [] }];
  expect(v.renderLog({ project: "", rows }, v.options(new URLSearchParams("kind=miss")))).not.toContain("<details>");
  expect(v.renderLog({ project: "", rows: [] })).toContain(empty());
  const ep = { at: "2026-11-03T10:00:00.000Z", kind: "write", op: "write", note: "aleph-1 Goal", why: "episode of aleph-1", titles: [] };
  const w = { ...ep, note: "Use Bun", why: "a fix" };
  const kept = (kind: string) => v.renderLog({ project: "", rows: [ep, w] }, v.options(new URLSearchParams(`kind=${kind}`))).match(/<tr><td class="time lead">/g)?.length;
  expect([kept("episode"), kept("write")]).toEqual([1, 1]);
  const log = v.renderLog({ project: "", rows: [ep, w] });
  for (const k of ["memory/writes", "memory/episode-writes", "memory/recalls"]) expect(log).toContain(`<aleph-chart key="${k}">`);
});

test("a day frame counts the rows it keeps per local day, oldest first, and writeWeeks takes the median of the 3 weeks before", () => {
  const now = Date.parse("2026-11-17T12:00:00");
  const at = (d: number) => new Date(now - d * 86400_000).toISOString();
  const rows = [at(0), at(0), at(2), at(8), at(9), at(15), at(22), at(22), at(22)].map((a) => ({ at: a, kind: "write", op: "write", note: "N", why: "x", titles: [] }));
  const f = v.dayFrame(rows, () => true, 3, "W", now);
  expect(f.rows.map((r: any) => r.n)).toEqual([1, 0, 2]);
  expect(writeWeeks(rows, now)).toEqual({ week: 3, median: 2, lo: 1, hi: 3 });
});

test("the Needs-you strip shows each item only over its act-threshold, and nothing when none is", () => {
  const old = new Date(NOW - 10 * 86400_000).toISOString();
  const m = { lint: { refuse: [{ rule: "schema", note: "N", detail: "d" }], warn: [] }, start: { aleph: { cut: 2 }, global: { cut: 0 } }, misses: { unoffered_reads: 11 },
    processes: { corrections: { waiting: [{ id: "l", sentence: "s", state: "open", since: old }] }, decay: { stale: [{ note: "N", over: 31, window: 30 }] } } };
  const h = needs(m, NOW);
  for (const t of ["1 lesson wait, oldest 10 d", "2 core lines cut", "1 note refused", "11 reads nobody offered", "1 note over 30 d late"]) expect(h).toContain(t);
  expect(h).toContain('<span class="badge error">refused</span>');
  const calm = { lint: { refuse: [], warn: [] }, start: { aleph: { cut: 0 } }, misses: { unoffered_reads: 10 }, processes: { corrections: { waiting: [{ id: "l", sentence: "s", state: "open", since: new Date(NOW).toISOString() }] }, decay: { stale: [{ note: "N", over: 30, window: 30 }] } } };
  expect(needs(calm, NOW)).toBe("");
});

test("the Start Context card splits what the agent receives, lists the cut lines and the kept lines to trim first", () => {
  const core = (title: string, scope: string, bytes: number, kept: boolean) => ({ title, core: "c", scope, bytes, kept });
  const m = { notes: [row({ title: "A", history: Array(30).fill(1) }), row({ title: "B" }), row({ title: "C" })], lint: { refuse: [], warn: [] },
    start: { aleph: { bytes: 1000, budget: 6000, cut: 1, memory: 600, core: [core("A", "aleph", 100, true), core("B", "global", 150, true), core("C", "aleph", 80, false)] } } };
  const h = v.renderHealthTab(m);
  const text = (x: string) => x.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const sent = h.slice(h.indexOf("What the aleph agent receives"), h.indexOf("Cut lines"));
  expect(sent.split("<tr>").slice(2).map(text)).toEqual(["MEMORY.md 600 B 60%", "Global core lines · 1 150 B 15%", "Aleph core lines · 1 100 B 10%", "Tags and pointer 150 B 15%", "Total sent 1,000 B 5,000 B left"]);
  expect(h).toContain("Cut lines, 1");
  const trim = h.slice(h.indexOf("Trim first"));
  expect([...trim.matchAll(/href="#\/memory\/(\w)"/g)].map((x) => x[1])).toEqual(["B", "A"]);
});

test("Health's Offer Quality card gives the unoffered reads, the empty share of all recalls and the hook runs, or No data", () => {
  const rows = [3, 10, 10].map((n) => ({ at: "2026-11-03", kind: "recall", op: "recall", note: "A", why: "q", titles: Array(n).fill("A") }));
  const h = v.renderHealthTab({ ...page, rows, misses: { days: 7, recalls: 7, empty: 0, empty_share: 0, reformulated: 0, unoffered_reads: 1234, missed: [{ query: "lit spike", at: "2026-11-13T08:49:00Z" }], hook: { runs: 1194, zero_candidates: 4, capped: 1100 } } });
  const card = h.slice(h.indexOf('aria-label="Offer Quality"'));
  for (const t of ["<strong>1,234</strong>", "<dd>0 of 7 (0.0%)</dd>", "<dd>7</dd>", "<dd>1,194: 4 with no candidate, 1,100 over 100</dd>", "<dd>p50 10, p95 10, n=3</dd>"]) expect(card.slice(0, card.indexOf("</section>"))).toContain(t);
  expect(h).toContain('title="lit spike">lit spike</td>');
  const none = v.renderHealthTab(page);
  const body = none.slice(none.indexOf('aria-label="Offer Quality"'));
  expect(body.slice(0, body.indexOf("</section>"))).toContain(empty());
});
