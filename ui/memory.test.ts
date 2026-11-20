import { conn } from "../lib/db.ts";
import { setTick } from "../jobs/lib/gates/tables.ts";
import { afterAll, beforeAll, expect, setSystemTime, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withEnv, withServer, type TestServer } from "./server.testkit.ts";
import { updater } from "./updater.ts";
import { onLater } from "./build.ts";
import { items } from "./memory-items.ts";
import { writeList } from "../lib/store.ts";
import { add } from "../lib/todo.ts";
// @ts-ignore
import * as v from "./views/memory.js";
// @ts-ignore
import { needs, writeWeeks } from "./views/lib/memory-health.js";
// @ts-ignore
import { renderMemoryJobs } from "./views/lib/processes.js";
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

/** The words a page shows: the markup's tags dropped, its spaces collapsed. */
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
type Found = { attrs: Record<string, string | undefined>; text: string };
/** Each element of `h` that the CSS selector `sel` matches, in page order: its attributes and the words it holds. */
function find(h: string, sel: string): Found[] {
  const found: Found[] = [], open: Found[] = [];
  new HTMLRewriter()
    .on("*", { element: () => { for (const n of open) n.text += " "; } })
    .on(sel, {
      element(el) {
        const n = { attrs: Object.fromEntries(el.attributes), text: "" };
        found.push(n);
        if (!el.canHaveContent || el.selfClosing) return;
        open.push(n);
        el.onEndTag(() => { open.splice(open.indexOf(n), 1); });
      },
    })
    .onDocument({ text: (t) => { for (const n of open) n.text += t.text; } })
    .transform(h);
  return found.map((n) => ({ ...n, text: n.text.replace(/\s+/g, " ").trim() }));
}
const words = (xs: Found[]) => xs.map((n) => n.text);

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
  const f = v.recallFrame(hist);
  expect([f.measure.name, f.by.keys[0].name]).toEqual(["Offers per Day", "offers"]);
  expect(f.rows.map((r: any) => r.recalls)).toEqual(hist);
  const h = v.renderInspector(note, n, "use", hist);
  expect(find(h, "aleph-chart").map((c) => c.attrs.key)).toEqual(["memory/recall"]);
  expect(find(h, "aleph-chart [role=img]").map((c) => c.attrs["aria-label"])).toEqual(["Offers per Day: offers 3"]);
  expect(find(h, ".mhist, i[title]")).toEqual([]);
  expect(find(v.renderInspector(note, n, "use", Array(30).fill(0)), "aleph-chart")).toEqual([]);
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
  const rs = [it({}), it({ type: "working", source: "handoff", key: "current.md", title: "current handoff" })];
  const status = new Map(v.noteRows(page, NOW).map((n: any) => [n.title, n.status]));
  expect(v.options(new URLSearchParams("q=work"))).toEqual({ q: "work", type: "", fresh: "", item: "", kind: "" });
  expect(v.typeCounts(rs, v.options(), status)).toEqual({ semantic: 1, procedural: 0, episodic: 0, working: 1, prospective: 0 });
  expect(v.keepRows(rs, v.options(new URLSearchParams("fresh=never")), status)).toEqual([]);
  const h = v.renderMemory(page, v.options(new URLSearchParams("q=work")), rs);
  expect(find(h, ".msearch [data-ui=mem-search]").map((n) => n.attrs.value)).toEqual(["work"]);
  expect(find(h, "#mem-inspector")).toHaveLength(1);
  expect(find(h, "#mem-titles option").map((n) => n.attrs.value)).toEqual(["N", "Never"]);
  expect(words(find(h, "h2"))).not.toContain("Health");
  // The page head's filter is scope().bar(): the Project select, then the window control.
  expect(words(find(h, "header select[name=project] option"))).toEqual(["All Projects", "aleph", "other"]);
  expect(find(h, "header [data-name=window]").map((n) => n.attrs["aria-label"])).toEqual(["Window"]);
  // Page head, kind filter, search, freshness filter, then the results.
  expect(find(h, "h1, [name=project], #mem-kind, [data-ui=mem-search], #mem-fresh, #mem-results").map((n) => n.attrs.id ?? n.attrs.name ?? n.text))
    .toEqual(["Memory", "project", "mem-kind", "q", "mem-fresh", "mem-results"]);
  // mount() sets the query from the pressed option's data-value.
  expect(find(h, "#mem-kind button").map((b) => [b.attrs["data-value"], b.attrs["aria-pressed"], b.text])).toEqual([
    ["", "true", "All 2"], ["semantic", "false", "Semantic 1"], ["procedural", "false", "Procedural 0"],
    ["episodic", "false", "Episodic 0"], ["working", "false", "Working 1"], ["prospective", "false", "Prospective 0"],
  ]);
  expect(find(h, "#mem-fresh button").map((b) => [b.attrs["data-value"], b.attrs["aria-pressed"], b.text]).slice(1, 3))
    .toEqual([["use", "false", "Offered in 7 days 1"], ["never", "false", "Never offered 0"]]);
  const loading = v.renderMemory(page, v.options(), null);
  expect(text(loading)).toContain("Loading memory");
  expect(words(find(loading, "#mem-kind button[aria-pressed=true]"))).toEqual(["All"]);
  expect(v.view.api({}, new URLSearchParams("project=aleph"))).toEqual(["/api/memory?project=aleph", "/api/memory/processes"]);
  expect(v.view.api({}, new URLSearchParams("tab=health"))).toEqual(["/api/memory", "/api/memory/processes", "/api/memory/log"]);
  expect(v.view.combine([{ notes: [] }, { steps: [] }, { rows: [1] }])).toEqual({ notes: [], processes: { steps: [] }, rows: [1] });
  const nh = v.renderNote({ title: "T", path: "wiki/x/T.md", archived: false, frontmatter: { kind: "gotcha", written_by: "w", last_verified: "2026-11-01" }, body: "see [[U]]", links: [], backlinks: [{ title: "V", kind: "gotcha", scope: "a" }] });
  expect(find(nh, "section[aria-labelledby=h-note] .md a").map((a) => a.attrs.href)).toEqual(["#/memory/U"]);
  const none = v.renderNote({ title: "T", path: "wiki/x/T.md", archived: false, frontmatter: { kind: "gotcha" }, body: "x", links: [], backlinks: [] });
  // A section with no links is left out: neither its detailPanel() nor a card.
  expect(find(none, "details, .card")).toEqual([]);
  expect(find(nh, ".card")).toEqual([]);
  expect(words(find(nh, "details.dp-panel.dp-fold[open] > summary"))).toEqual(["Linked from 1"]);
  const out = v.renderNote({ title: "T", path: "wiki/x/T.md", archived: false, frontmatter: {}, body: "x", links: [{ title: "U", kind: "gotcha", scope: "a" }], backlinks: [] });
  expect(words(find(out, "details.dp-panel.dp-fold[open] > summary"))).toEqual(["Links to 1"]);
  expect(find(out, "details .dp-body li a").map((a) => [a.attrs.href, a.text])).toEqual([["#/memory/U", "U"]]);
  expect(find(out, ".card")).toEqual([]);
  expect(words(find(nh, "section[aria-labelledby=h-note] .md"))).toEqual(["see U"]);
  expect(words(find(nh, "dt"))).toEqual(["Kind", "Written by", "Last verified"]);
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
  // procedural: a table, its Updated column a number column
  expect(find(h, "th").map((n) => [n.text, n.attrs.class])).toEqual([["Source", undefined], ["What It Says", undefined], ["Loaded When", undefined], ["Updated", "num"]]);
  expect(find(h, "ul.mrows.tl > li").map((n) => n.attrs["data-id"])).toEqual(["episode:e.md"]);  // episodic: a timeline
  expect(find(h, "td.wide").map((n) => n.attrs.title)).toEqual(["the vault"]);  // procedural: the title cell's full text
  const undated = v.renderResults([it({ type: "episodic", source: "episode", key: "e.md", title: "e", at: "" })], v.options(), status);
  expect(find(undated, ".time [title]").map((n) => [n.attrs.title, n.text])).toEqual([["No date", "–"]]);
  expect(words(find(h, '[data-id="issue:a/1"] .badge'))).toEqual(["high"]);  // prospective: cards with the priority
  expect(words(find(h, '[data-id="note:N"] .mm'))).toEqual(["written Oct 01 · offered never"]);  // semantic: the offer date
  // Each row is a selectable stop: mount() reads its data-id on a click, Enter or Space.
  expect(find(h, "li.mrow[tabindex='0'], tr.mrow[tabindex='0']").map((n) => n.attrs["data-id"])).toEqual(["note:N", "note:Never", "skill:vault", "episode:e.md", "issue:a/1"]);
  expect(find(h, "tr.mrow[tabindex='0']").map((n) => n.attrs["data-id"])).toEqual(["skill:vault"]);
  const nothing = v.renderResults([], v.options(new URLSearchParams("q=zz")), status);
  expect(words(find(nothing, ".empty"))).toEqual([text(nothing)]);
  const many = v.renderResults(Array.from({ length: 51 }, (_, i) => it({ key: `n${i}`, title: `n${i}` })), v.options(), status);
  expect(text(many)).toContain("50 of 51");
  expect(find(many, "li[hidden]").map((n) => n.attrs["data-id"])).toEqual(["note:n50"]);
});

test("the procedural table is dataTable's, so it has the tscroll wrapper, the tbl class and the heads", () => {
  const proc = it({ type: "procedural", source: "skill", key: "vault", title: "skill vault", text: "the vault", at: "2026-01-01" });
  const h = v.renderResults([proc], v.options(), new Map());
  expect(words(find(h, ".tscroll > table.tbl > thead > tr > th"))).toEqual(["Source", "What It Says", "Loaded When", "Updated"]);
  expect(words(find(h, ".tscroll > table.tbl > tbody > tr.mrow > td"))).toEqual(["skill vault", "the vault", "Reaches a session when vault recall returns it.", "Jan 01"]);
});

test("the Notes and Health tabs write their counts through count()", () => {
  const big = { ...page, misses: { recalls: 12345, days: 30, empty: 1000, empty_share: 0.1, reformulated: 2000, unoffered_reads: 0, missed: [], hook: { runs: 0, zero_candidates: 0, capped: 0 } }, lint: { refuse: [], warn: Array.from({ length: 1200 }, () => ({ rule: "r", note: "N", detail: "d" })) },
    start: { aleph: { bytes: 2048, budget: 4096, cut: 1500, memory: 1000, core: [] } } };
  const rs = Array.from({ length: 1000 }, (_, i) => it({ key: `n${i}`, title: `n${i}` }));
  const h = v.renderMemory(big, v.options(), rs);
  expect(words(find(h, "#mem-kind button[data-value=semantic]"))).toEqual(["Semantic 1,000"]);
  expect(words(find(h, "#mem-results .sh"))).toEqual(["Semantic 1,000"]);
  const health = v.renderHealthTab(big);
  expect(words(find(health, 'section[aria-label="Offer Quality"] dd')).slice(0, 2)).toEqual(["12,345", "1,000 of 12,345 (10%)"]);
  expect(words(find(health, 'section[aria-label="Start Context"] .bv'))).toEqual(["2,048 B / 4,096 B"]);
  expect(words(find(health, "section[aria-label=Lint] .count, section[aria-label=Lint] td.num"))).toEqual(["1,200", "1,200", "1,200"]);
  expect(words(find(health, ".tile b"))).toContain("1,500 / 0");
});

test("the procedural table hides its 51st row and its pager says 50 of 51", () => {
  const procs = Array.from({ length: 51 }, (_, i) => it({ type: "procedural", source: "skill", key: `s${i}`, title: `s${i}` }));
  const h = v.renderResults(procs, v.options(), new Map());
  expect(text(h)).toContain("50 of 51");
  const trs = find(h, "tbody > tr");
  expect(trs.map((r) => r.attrs["data-id"])).toEqual(procs.map((p) => `skill:${p.key}`));
  expect(trs.map((r) => "hidden" in r.attrs)).toEqual(Array.from({ length: 51 }, (_, i) => i === 50));
});

test("the inspector says how a memory reaches the agent, shows its recall history and offers the writes its source takes", () => {
  const n = { title: "N", path: "wiki/gotchas/N.md", frontmatter: { scope: "aleph", confidence: "measured", core: "the <core>" }, body: "**Claim.** x", text: "", links: [{ title: "L" }], backlinks: [{ title: "B" }] };
  const h = v.renderInspector(it({ read: "2026-11-03" }), n, "use");
  expect(words(find(h, ".mreach > *")).slice(0, 2)).toEqual(["How it reaches the agent", "Reaches a session when vault recall returns it."]);
  expect(find(h, "input[name=core]").map((i) => i.attrs.value)).toEqual(["the &lt;core&gt;"]);
  // mount() runs the write that a button's or a form's data-mact names; unlink reads its data-target.
  expect(find(h, "[data-mact]").map((n) => n.attrs["data-mact"])).toEqual(["core", "unlink", "link", "edit", "archive", "delete"]);
  expect(find(h, "button[data-mact]").map((b) => [b.attrs["data-mact"], b.attrs.class, b.attrs.type, b.attrs["data-target"], b.text])).toEqual([
    ["unlink", "act small", "button", "L", "Unlink"], ["edit", "act primary", "button", undefined, "Edit"],
    ["archive", "act", "button", undefined, "Archive"], ["delete", "act danger", "button", undefined, "Delete"],
  ]);
  // No button of the page carries data-act, which router.js's own handler takes.
  expect(find(h, "[data-act]")).toEqual([]);
  expect(words(find(h, ".mtype, .mtype .badge"))).toEqual(["Semantic · note · in use", "in use"]);
  expect(words(find(h, ".hint code"))).toEqual(["wiki/gotchas/N.md"]);
  const bare = v.renderInspector(it({}), { ...n, links: [], backlinks: [] }, "use");
  expect(words(find(bare, ".sub-head"))).toEqual(["How it reaches the agent"]);
  expect(find(bare, ".empty")).toEqual([]);
  const hand = v.renderInspector(it({ type: "working", source: "handoff", key: "current.md", title: "current handoff" }));
  expect(find(hand, "[data-mact]").map((n) => n.attrs["data-mact"])).toEqual(["edit", "file-delete"]);
  expect(find(v.renderInspector(it({ type: "working", source: "handoff", key: "current.md" }), null, "", [1]), "aleph-chart")).toEqual([]);
  expect(text(v.renderInspector(it({ type: "procedural", source: "skill", key: "vault", href: "#/skills/vault" })))).toContain("change it on a branch");
  expect(find(v.renderInspector(it({ type: "prospective", source: "issue", key: "a/1" })), "[data-mact]").map((n) => n.attrs["data-mact"])).toEqual(["drop"]);
  expect(words(find(v.renderInspector(it({ title: "<x>" })), "h3")).slice(0, 1)).toEqual(["&lt;x&gt;"]);
  expect(words(find(v.renderInspector(null), ".empty"))).toEqual(["Select a memory"]);
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

test("/api/memory/processes reads the tick and the stale notes", async () => {
  setTick("maintain", { last: "2026-11-04T10:00:00.000Z", result: "dry: 1 fixed · 2 notes" });
  const runs0 = join(base, "vault", ".index", "runs");
  mkdirSync(runs0, { recursive: true });
  writeFileSync(join(runs0, "maintain.json"), JSON.stringify({ at: "2026-11-04T10:00:00.000Z", result: "ok", detail: `dry: ${JSON.stringify({ decay: 3, overlap: 5 })}` }));
  writeFileSync(join(runs0, "compile.json"), JSON.stringify({ at: "2026-11-04T10:00:00.000Z", result: "ok", detail: "dry: 2026-11-03: 2 notes" }));
  try {
    const m = await (await at("/api/memory/processes")).json() as any;
    expect(m.steps.map((s: any) => [s.name, s.last, s.next, s.result])).toEqual([
      ["maintain", "2026-11-04T10:00:00.000Z", m.steps[0].next, "dry: 1 fixed · 2 notes"],
      ["seen prune", null, null, null],
      ["recall trim", null, null, null],
      ["vault push", null, null, null],
    ]);
    expect(m.steps[0]).toMatchObject({ name: "maintain", runs: "daily after 03:00", next: "2026-11-05T03:00:00.000Z", detail: "decay 3 · overlap 5 · 2 notes" });
    const runs = join(base, "vault", ".index", "runs");
    writeFileSync(join(runs, "seen prune.json"), JSON.stringify({ at: "2026-11-04T11:45:00.000Z", result: "ok" }));
    writeFileSync(join(runs, "vault push.json"), JSON.stringify({ at: "2026-11-04T11:50:00.000Z", result: "failed", detail: "no route" }));
    await fresh("factory");
    const r = (await (await at("/api/memory/processes")).json() as any).steps.slice(1).map((s: any) => [s.name, s.last, s.result, s.detail]);
    expect(r).toEqual([["seen prune", "2026-11-04T11:45:00.000Z", "ok", null], ["recall trim", null, null, null], ["vault push", "2026-11-04T11:50:00.000Z", "failed", "no route"]]);
    const jobs = renderMemoryJobs(await (await at("/api/memory/processes")).json());
    expect(find(jobs, "tr .badge.error").map((b) => [b.attrs.title, b.text])).toEqual([["no route", "failed"]]);
    expect(words(find(jobs, "tbody tr")).find((t) => t.startsWith("vault push"))).toContain("failed");
  } finally { conn().run("DELETE FROM tick"); conn().run("DELETE FROM state"); rmSync(join(base, "vault", ".index", "runs"), { recursive: true, force: true }); }
});

test("the tabs link Notes, Health and Log; the log row opens a recall to its notes; Episode pages filter alone", () => {
  const h = v.renderTabs("log", "aleph");
  expect(find(h, "a").map((a) => [a.attrs.href, a.attrs["aria-current"], a.text])).toEqual([
    ["#/memory?project=aleph", undefined, "Notes"], ["#/memory?tab=health&project=aleph", undefined, "Health"], ["#/memory?tab=log&project=aleph", "page", "Log"],
  ]);
  expect(find(v.renderMemory(page), "nav.vtabs")).toHaveLength(1);
  const r = { at: "2026-11-03", kind: "recall", op: "recall", note: "A", why: "q", titles: ["A", "B"] };
  // The query opens to the notes it returned, in rank order.
  const lr = v.logRow(r);
  expect(find(lr, "details > summary").map((n) => [n.attrs.title, n.text])).toEqual([["q", "q"]]);
  expect(find(lr, "details > ol > li > a").map((a) => [a.attrs.href, a.text])).toEqual([["#/memory/A", "A"], ["#/memory/B", "B"]]);
  expect(words(find(lr, ".quiet"))).toEqual(["+1"]);
  const rows = [r, { ...r, kind: "miss", op: "miss", note: "", titles: [] }];
  expect(find(v.renderLog({ project: "", rows }, v.options(new URLSearchParams("kind=miss"))), "details")).toEqual([]);
  expect(words(find(v.renderLog({ project: "", rows: [] }), "#log-rows .empty"))).toEqual(["No data"]);
  const ep = { at: "2026-11-03T10:00:00.000Z", kind: "write", op: "write", note: "aleph-1 Ship", why: "episode of aleph-1", titles: [] };
  const w = { ...ep, note: "Use Bun", why: "a fix" };
  const kept = (kind: string) => words(find(v.renderLog({ project: "", rows: [ep, w] }, v.options(new URLSearchParams(`kind=${kind}`))), "#log-rows tbody > tr a"));
  expect([kept("episode"), kept("write")]).toEqual([["aleph-1 Ship"], ["Use Bun"]]);
  // mountLog() sets each chart's frame by its key.
  expect(find(v.renderLog({ project: "", rows: [ep, w] }), "aleph-chart").map((c) => c.attrs.key)).toEqual(["memory/writes", "memory/episode-writes", "memory/recalls"]);
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
  const m = { lint: { refuse: [{ rule: "schema", note: "N", detail: "d" }], warn: [] }, start: { aleph: { cut: 2 }, global: { cut: 0 } }, misses: { unoffered_reads: 11 },
    processes: { decay: { stale: [{ note: "N", over: 31, window: 30 }] } } };
  const h = needs(m, NOW);
  expect(words(find(h, ".mstrip a"))).toEqual(["start 2 core lines cut", "refused 1 note refused", "reads 11 reads nobody offered", "re-check 1 note over 30 d late"]);
  expect(words(find(h, ".badge.error"))).toEqual(["refused"]);
  const calm = { lint: { refuse: [], warn: [] }, start: { aleph: { cut: 0 } }, misses: { unoffered_reads: 10 }, processes: { decay: { stale: [{ note: "N", over: 30, window: 30 }] } } };
  expect(needs(calm, NOW)).toBe("");
});

test("the Start Context card splits what the agent receives, lists the cut lines and the kept lines to trim first", () => {
  const core = (title: string, scope: string, bytes: number, kept: boolean) => ({ title, core: "c", scope, bytes, kept });
  const m = { notes: [row({ title: "A", history: Array(30).fill(1) }), row({ title: "B" }), row({ title: "C" })], lint: { refuse: [], warn: [] },
    start: { aleph: { bytes: 1000, budget: 6000, cut: 1, memory: 600, core: [core("A", "aleph", 100, true), core("B", "global", 150, true), core("C", "aleph", 80, false)] } } };
  const h = v.renderHealthTab(m);
  const card = 'section[aria-label="Start Context"]';
  expect(words(find(h, `${card} .sub-head`))).toEqual(["What the aleph agent receives", "Cut lines, 1", "Trim first: fewest offers, then oldest"]);
  // The tables in card order: what the agent receives, the cut lines, then the lines to trim first.
  const trs = words(find(h, `${card} tbody > tr`));
  expect(trs.slice(0, 5)).toEqual(["MEMORY.md 600 B 60%", "Global core lines · 1 150 B 15%", "Aleph core lines · 1 100 B 10%", "Tags and pointer 150 B 15%", "Total sent 1,000 B 5,000 B left"]);
  expect(trs.slice(6).map((t) => t.split(" ")[0])).toEqual(["B", "A"]);
});

test("Health's Offer Quality card gives the unoffered reads, the empty share of all recalls and the hook runs, or No data", () => {
  const rows = [3, 10, 10].map((n) => ({ at: "2026-11-03", kind: "recall", op: "recall", note: "A", why: "q", titles: Array(n).fill("A") }));
  const h = v.renderHealthTab({ ...page, rows, misses: { days: 7, recalls: 7, empty: 0, empty_share: 0, reformulated: 0, unoffered_reads: 1234, missed: [{ query: "lit spike", at: "2026-11-13T08:49:00Z" }], hook: { runs: 1194, zero_candidates: 4, capped: 1100 } } });
  const card = 'section[aria-label="Offer Quality"]';
  expect(words(find(h, `${card} strong`))).toEqual(["1,234"]);
  expect(find(h, `${card} dt, ${card} dd`).map((n) => n.text)).toEqual(["Recalls", "7", "Empty", "0 of 7 (0.0%)", "Reformulated", "0 turns", "Hook runs", "1,194: 4 with no candidate, 1,100 over 100", "Notes per offer", "p50 10, p95 10, n=3"]);
  expect(find(h, 'section[aria-label="Empty Recalls"] td.wide').map((n) => [n.attrs.title, n.text])).toEqual([["lit spike", "lit spike"]]);
  expect(words(find(v.renderHealthTab(page), `${card} .empty`))).toEqual(["No data"]);
});
