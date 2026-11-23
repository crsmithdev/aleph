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
import { add } from "../lib/issue-file.ts";
// @ts-ignore
import * as v from "./views/memory.js";
// @ts-ignore
import { flowFrame, needs, renderHealth, writeWeeks } from "./views/lib/memory-health.js";
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

test("/api/memory gives each note its recall count per day over 30 days, and the page shows their sum", async () => {
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
const page = { exists: true, total: 2, scopes: ["aleph", "other"], lint: { refuse: [], warn: [] }, writes: [], notes: [row({ title: "N", read: "2026-11-03", history: [1, 2] }), row({ title: "Never" })], rows: [],
  start: { aleph: { bytes: 3000, budget: 6000, cut: 0, core: [{ title: "N", core: "c", scope: "global", bytes: 100, kept: true }] } }, steps: [], decay: { stale: [] } };
/** Run `fn` with a stub of the browser's storage that holds `kept` by key. */
const withStore = <T>(kept: Record<string, unknown>, fn: () => T): T => {
  const g: any = globalThis;
  g.localStorage = { getItem: (k: string) => (`${k}`.slice(6) in kept ? JSON.stringify(kept[`${k}`.slice(6)]) : null), setItem() {} };
  try { return fn(); } finally { delete g.localStorage; }
};
const draw = (m: object, q = "") => v.view.render({ ...page, ...m }, {}, new URLSearchParams(q)) as string;

test("the page loads what its view draws: Notes the search, Health the log, Log the log alone", () => {
  const api = (q: string) => v.view.api({}, new URLSearchParams(q));
  expect(api("project=aleph")).toEqual(["/api/memory?project=aleph", "/api/memory/processes", "/api/memory/search?q=&project=aleph"]);
  expect(api("view=health")).toEqual(["/api/memory", "/api/memory/processes", "/api/memory/log"]);
  expect(api("view=log")).toEqual(["/api/memory", "/api/memory/log"]);
  expect(v.view.combine([{ notes: [] }, { steps: [] }, { rows: [1] }])).toEqual({ notes: [], steps: [], rows: [1] });
});

test("the Notes view is a facts line, a Type filter on semantic and one list of the four types, with no health", () => {
  const rs = [it({ read: "2026-11-03" }), it({ key: "Never", title: "Never" }), it({ type: "working", source: "handoff", key: "current.md", title: "current handoff", at: "2026-11-03T10:00:00Z" })];
  const h = draw({ results: rs, decay: { stale: [{ note: "N" }] } });
  expect(words(find(h, ".ph button[data-view]"))).toEqual(["Notes", "Health", "Log"]);
  expect(text(find(h, ".factline")[0].text)).toBe("2 notes 1 offered in 7 days 1 never offered 1 past re-check");
  expect(find(h, ".lcard select[name=type] option").map((o) => [o.attrs.value, "selected" in o.attrs])).toEqual([["", false], ["semantic", true], ["procedural", false], ["episodic", false], ["working", false]]);
  // The list draws the rows of the filter's type; the others wait in the list for a search or a filter.
  expect(find(h, ".lrow").map((r) => r.attrs["data-key"])).toEqual(["note:N", "note:Never"]);
  expect(words(find(h, ".lhead .h"))).toEqual(["Offers", "Offered", "Written", "Updated"]);
  const every = withStore({ "browse.memory": { f: { type: "" } } }, () => draw({ results: rs }));
  expect(words(find(every, ".lhead h3"))).toEqual(["Semantic", "Procedural", "Episodic", "Working"]);
  expect(find(every, ".lrow").map((r) => r.attrs["data-key"])).toEqual(["note:N", "note:Never", "handoff:current.md"]);
  expect(words(find(every, ".lhead .h"))).toEqual(["Offers", "Offered", "Written", "Updated", "Age"]);
  // A note shows its offers, its last offer or never, and its written day; a default scope shows no chip.
  expect(words(find(h, '.lrow[data-key="note:N"] .c'))).toEqual(["3", "Nov 03", "Oct 01"]);
  expect(words(find(h, '.lrow[data-key="note:Never"] .c'))).toEqual(["", "never", "Oct 01"]);
  expect(find(h, ".lrow .chip")).toEqual([]);
  expect(find(h, '.ph [name=project]')).toHaveLength(1);
});

test("a type shows its first 25 rows and a Show all link; ?all= shows every row of that type", () => {
  const many = Array.from({ length: 30 }, (_, i) => it({ key: `n${i}`, title: `n${i}` }));
  const h = draw({ results: many });
  expect(find(h, ".lrow")).toHaveLength(25);
  expect(find(h, ".lmore").map((n) => n.text)).toEqual(["25 of 30 · Show all"]);
  expect(find(h, ".lmore a").map((a) => a.attrs.href)).toEqual(["#/memory?all=semantic"]);
  const all = draw({ results: many }, "all=semantic");
  expect(find(all, ".lrow")).toHaveLength(30);
  expect(find(all, ".lmore")).toEqual([]);
  expect(words(find(draw({ results: [] }), ".lnone"))).toContain("No data");
});

test("the inspector says how a memory reaches the agent, with its facts, its state and its Open page link", () => {
  const rs = [it({ read: "2026-11-03", kind: "gotcha", href: "#/memory/N" }), it({ type: "procedural", source: "rules", key: "r", title: "rule <x>", scope: "global" })];
  const h = draw({ results: rs });
    expect(words(find(h, "aside.ins .idp"))).toEqual(["Semantic · note"]);
  expect(words(find(h, "aside.ins > h3"))).toEqual(["N"]);
  expect(words(find(h, "aside.ins dt, aside.ins dd"))).toEqual(["Kind", "gotcha", "Scope", "aleph", "Written", "Oct 01", "Last offered", "Nov 03", "Offers", "3 in 30 days"]);
  expect(find(h, "aside.ins .mreach p").map((n) => n.text)).toEqual(["Reaches a session when vault recall returns it."]);
  expect(find(h, "aside.ins .inspect-head a").map((a) => a.attrs.href)).toEqual(["#/memory/N"]);
  // The inspector of every other drawn row waits in a template; a rule without a page opens the Memory page, and a title is escaped.
  const every = withStore({ "browse.memory": { f: { type: "" } } }, () => draw({ results: rs }));
  expect(find(every, 'template[data-inspect="rules:r"] > h3').map((n) => n.text)).toEqual(["rule &lt;x&gt;"]);
  expect(find(every, 'template[data-inspect="rules:r"] .inspect-head a').map((a) => a.attrs.href)).toEqual(["#/memory"]);
});

test("the inspector offers the writes its source takes: a note edits, archives and deletes, a handoff edits and deletes, a rule is a file", () => {
  const rs = [it({}), it({ source: "memory-md", key: "MEMORY.md", title: "MEMORY.md" }), it({ type: "working", source: "handoff", key: "current.md", title: "current handoff" }),
    it({ type: "procedural", source: "rules", key: "r", title: "rule" }), it({ type: "episodic", source: "daily", key: "d", title: "daily" })];
  const h = withStore({ "browse.memory": { f: { type: "" } } }, () => draw({ results: rs }));
  const tpl = (key: string) => find(h, `template[data-inspect="${key}"]`)[0];
  const writes = (key: string) => find(h, `template[data-inspect="${key}"] [data-mact]`).map((n) => n.attrs["data-mact"]);
  expect(writes("note:N")).toEqual(["edit", "archive", "delete"]);
  expect(find(h, 'template[data-inspect="note:N"] button[data-mact]').map((b) => [b.attrs.class, b.attrs.type, b.text])).toEqual([["act primary", "button", "Edit"], ["act", "button", "Archive"], ["act danger", "button", "Delete"]]);
  expect(find(h, 'template[data-inspect="note:N"] [data-item] > .actions, template[data-inspect="note:N"] [data-item] > .medit').map((n) => n.attrs.class)).toEqual(["actions", "medit"]);
  // The core line and the links come from the note's own answer: the slot waits for them.
  expect(find(h, 'template[data-inspect="note:N"] .mnote').map((n) => [n.attrs["data-item"], n.attrs["data-title"]])).toEqual([["note:N", "N"]]);
  expect(writes("memory-md:MEMORY.md")).toEqual(["edit"]);
  expect(writes("handoff:current.md")).toEqual(["edit", "file-delete"]);
  expect(find(h, 'template[data-inspect="handoff:current.md"] .mnote')).toEqual([]);
  expect(writes("rules:r")).toEqual([]);
  expect(text(tpl("rules:r").text)).toContain("change it on a branch");
  expect(writes("daily:d")).toEqual([]);
  expect(find(h, "[data-act]")).toEqual([]);
  expect(find(h, "datalist#mem-titles option")).toHaveLength(page.notes.length);
  expect(find(draw({ results: rs, scopes: ["aleph", "sidetone"] }), '.ph select[name=project] option').map((o) => o.attrs.value)).toContain("sidetone");
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
  } finally { conn().run("DELETE FROM tick"); conn().run("DELETE FROM state"); rmSync(join(base, "vault", ".index", "runs"), { recursive: true, force: true }); }
});

const flow = (rows: object[]) => ({ ...page, rows });
const wr = (at: string, why = "x") => ({ at, kind: "write", op: "write", note: "N", why, titles: [] });

test("the Health view opens on a figure band, then the flow chart and the cards, the memory jobs and the tables", () => {
  const rows = [wr("2026-11-03T10:00:00.000Z"), { at: "2026-11-03", kind: "recall", op: "recall", note: "A", why: "q", titles: ["A"] }];
  const big = { ...page, rows, misses: { recalls: 12345, days: 30, empty: 1000, reformulated: 2000, unoffered_reads: 7, missed: [] },
    lint: { refuse: [{ rule: "schema", note: "A", detail: "d" }], warn: Array.from({ length: 1200 }, () => ({ rule: "template", note: "B", detail: "add a claim" })) },
    start: { aleph: { bytes: 5950, budget: 6000, cut: 0, core: [{ title: "N", core: "c", scope: "global", bytes: 100, kept: true }, { title: "M", core: "c", scope: "aleph", bytes: 200, kept: true }] } },
    steps: [{ name: "maintain", runs: "daily", last: "2026-11-04T10:00:00.000Z", next: null, result: "dry: 1 fixed", detail: "decay 3", does: "fixes" }, { name: "vault push", runs: "each write", last: null, next: null, result: "failed", detail: "no route", does: "pushes" },
      { name: "seen prune", runs: "each recall", last: null, next: null, result: "ok", detail: null, does: "prunes" }],
    decay: { stale: [{ note: "N", detail: "every 30 days", window: 30, over: 12 }] } };
  const h = draw(big, "view=health");
  expect(find(h, ".band .fig").map((f) => [f.text])).toEqual([["Start Context 5,950 B 50 B left of 6,000 B"], ["Offered, 7 Days 1 of 2 notes"], ["Lint 1,201 1 refused"], ["Writes, 7 Days 1 median week 0"]]);
  expect(find(h, ".band .cmp").map((n) => n.attrs.class)).toEqual(["cmp warn", "cmp", "cmp warn", "cmp"]);
  expect(find(h, ".pair aleph-chart").map((c) => c.attrs.key)).toEqual(["memory/flow"]);
  expect(words(find(h, 'section[aria-label="Offers"] dd'))).toEqual(["12,345 in 30 days", "1,000", "2,000", "7"]);
  expect(words(find(h, 'section[aria-label="Start Context"] .bv'))).toEqual(["5,950 B / 6,000 B"]);
  expect(words(find(h, 'section[aria-label="Start Context"] tbody tr')).map((t) => t.split(" ")[0])).toEqual(["M", "N"]);
  expect(words(find(h, 'section[aria-label="Lint by Rule"] .bl, section[aria-label="Lint by Rule"] .bv'))).toEqual(["template", "1,200", "schema refused", "1"]);
  expect(find(h, 'section[aria-label="Lint by Rule"] .meter i').map((i) => i.attrs.class)).toEqual([undefined, "c-err"]);
  expect(words(find(h, 'section[aria-label="Lint Fixes"] tbody tr')).map((t) => t.split(" ").slice(0, 2).join(" "))).toEqual(["template add", "schema d"]);
  // The jobs: a failure is a badge with its detail, a result of ok is quiet, another result shows its detail.
  expect(words(find(h, 'section[aria-label="Memory Jobs"] tbody tr')).map((t) => t.split(" ")[0])).toEqual(["maintain", "vault", "seen"]);
  expect(find(h, 'section[aria-label="Memory Jobs"] .badge.error').map((b) => [b.attrs.title, b.text])).toEqual([["no route", "failed"]]);
  expect(find(h, 'section[aria-label="Memory Jobs"] td.quiet').map((n) => n.text)).toEqual(["ok"]);
  expect(find(h, 'section[aria-label="Memory Jobs"] td.wide').map((n) => [n.attrs.title, n.text])).toEqual([["dry: 1 fixed", "decay 3"]]);
  expect(words(find(h, 'section[aria-label="Stale Notes"] tbody td'))).toEqual(["N", "30 d", "+12 d"]);
  // Without the slow misses read, the offers card draws its bars alone.
  expect(find(draw({ ...page, misses: undefined }, "view=health"), 'section[aria-label="Offers"] dd')).toEqual([]);
  expect(words(find(draw({ ...page, lint: { refuse: [], warn: [] } }, "view=health"), 'section[aria-label="Lint by Rule"] .empty'))).toEqual(["No data"]);
  expect(renderHealth(flow([]))).toContain("memory/flow");
});

test("the Log view groups its rows by day, a recall's inspector lists the notes it returned, and an episode page has no link", () => {
  const recall = { at: "2026-11-03", kind: "recall", op: "recall", note: "A", why: "the query", titles: ["A", "B"] };
  const ep = wr("2026-11-03T10:00:00.000Z", "episode of aleph-1");
  ep.note = "aleph-1 Ship";
  const h = draw({ rows: [ep, recall, wr("2026-11-02T09:30:00.000Z")] }, "view=log");
  expect(text(find(h, ".factline")[0].text)).toBe("1 recalls 2 writes");
  expect(words(find(h, ".lhead h3"))).toEqual(["Nov 03", "Nov 02"]);
  expect(find(h, ".lrow").map((r) => r.attrs["data-key"])).toEqual(["log-0", "log-1", "log-2"]);
  expect(find(h, ".lcard .seg[data-name=kind] button").map((b) => b.attrs["data-value"])).toEqual(["", "episode", "recall", "write"]);
  expect(words(find(h, '.lrow[data-key="log-1"] .main'))).toEqual(["A +1"]);
  expect(find(h, 'template[data-inspect="log-1"] li a').map((a) => [a.attrs.href, a.text])).toEqual([["#/memory/A", "A"], ["#/memory/B", "B"]]);
  expect(find(h, 'template[data-inspect="log-1"] .inspect-head a').map((a) => a.attrs.href)).toEqual(["#/memory/A"]);
  expect(find(h, 'template[data-inspect="log-0"] .inspect-head a').map((a) => a.attrs.href)).toEqual(["#/memory?view=log"]);
  expect(words(find(draw({ rows: [] }, "view=log"), ".lnone"))).toContain("No data");
  const many = draw({ rows: Array.from({ length: 150 }, () => wr("2026-11-03T10:00:00.000Z")) }, "view=log");
  expect(find(many, ".lrow")).toHaveLength(100);
  expect(find(many, ".lmore").map((n) => n.text)).toEqual(["100 of 150"]);
});

test("the flow frame counts note writes and recall runs per local day, oldest first, and writeWeeks takes the median of the 3 weeks before", () => {
  const now = Date.parse("2026-11-17T12:00:00");
  const at = (d: number) => new Date(now - d * 86400_000).toISOString();
  const rows = [at(0), at(0), at(2), at(8), at(9), at(15), at(22), at(22), at(22)].map((a) => wr(a));
  const f = flowFrame([...rows, wr(at(0), "episode of a-1"), { at: at(1).slice(0, 10), kind: "recall", op: "recall", note: "A", why: "q", titles: ["A"] }], now, 3);
  expect(f.rows.map((r: any) => [r.writes, r.recalls])).toEqual([[1, 0], [0, 1], [2, 0]]);
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
