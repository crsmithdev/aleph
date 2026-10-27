import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "./server.ts";
import { clearCache } from "./api/memory.ts";
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
  writeFileSync(join(root, "daily", `${today}.md`), `# ${today}\n\n- 10:00 write [[Use Bun]] — why\n- 10:05 write [[Other trap]] — why\n`);
  for (const [k, val] of Object.entries({ ALEPH_VAULT: root, LANGFUSE_PUBLIC_KEY: "", LANGFUSE_SECRET_KEY: "" })) { saved[k] = process.env[k]; process.env[k] = val; }
  server = await serve(0);
});
afterAll(() => {
  server.stop(true);
  for (const [k, val] of Object.entries(saved)) { if (val === undefined) delete process.env[k]; else process.env[k] = val; }
  rmSync(base, { recursive: true, force: true });
});

test("counts by kind and scope, Home's sections, recent writes", async () => {
  const m: any = await (await at("/api/memory")).json();
  expect(m.total).toBe(3);
  expect(m.byKind).toMatchObject({ decision: 1, gotcha: 1, concept: 1, entity: 0, project: 0 });
  expect(m.byScope).toEqual({ aleph: 2, other: 1 });
  expect(m.home[0]).toEqual({ heading: "Decisions", entries: [{ title: "Use Bun", hook: "why we run on Bun" }] });
  expect(m.writes.map((w: any) => w.time)).toEqual(["10:05", "10:00"]);
  expect(m.lint.refuse).toBeDefined();
  expect(m.misses).toBeUndefined();
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
  for (const t of ["Use Bun", "#/memory/Use%20Bun", "By scope", "50%", "Search the vault"]) expect(h).toContain(t);
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
  process.env.ALEPH_UI_CACHE_TTL = "0.3";
  clearCache();
  try {
    const a: any = await (await at("/api/memory")).json();
    const b: any = await (await at("/api/memory?project=other")).json();
    expect(readFileSync(log, "utf8").trim().split("\n")).toHaveLength(1);
    expect(a.misses).toEqual({ days: 7, recalls: 1 });
    expect(b.cachedAt).toBe(a.cachedAt);
    await Bun.sleep(400);
    await at("/api/memory");
    expect(readFileSync(log, "utf8").trim().split("\n")).toHaveLength(2);
  } finally {
    process.env.PATH = saveEnv.PATH;
    if (saveEnv.TTL === undefined) delete process.env.ALEPH_UI_CACHE_TTL; else process.env.ALEPH_UI_CACHE_TTL = saveEnv.TTL;
    clearCache();
  }
});
