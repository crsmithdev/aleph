// Archived goal tests from ui/sessions.test.ts: `bun run accept` runs them, `bun run test` does not.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { clearCache } from "../../ui/langfuse.ts";
import { clearFit } from "../../ui/usage.ts";
// @ts-ignore plain JS, shared with the page
import { idLink, pageHead, when } from "../../ui/lib.js";
import { routes } from "../../ui/api/sessions.ts";
// @ts-ignore plain JS, shared with the page
import * as v from "../../ui/views/session.js";

const trace = (id: string, session: string, name: string, at: string, extra: object = {}) =>
  ({ id, sessionId: session, name, timestamp: at, input: `prompt ${id}\nsecond line`, output: "x".repeat(600), totalCost: 0.5, latency: 12, metadata: { cwd: `/w/${name}`, task_type: "code_edit" }, ...extra });
const now = Date.now();
const iso = (m: number) => new Date(now - m * 60000).toISOString();
const TRACES = [
  trace("t1", "s1", "aleph", iso(30)), trace("t2", "s1", "aleph", iso(20)),
  trace("t3", "s2", "sidetone", iso(10), { metadata: { cwd: "/w/sidetone" } }),
];
const OBS: Record<string, any[]> = {
  t1: [
    { id: "o0", type: "AGENT", name: "turn", startTime: iso(30) },
    { id: "o1", parentObservationId: "o0", type: "TOOL", name: "Bash", input: "ls", output: "y".repeat(900), startTime: iso(29), endTime: new Date(now - 29 * 60000 + 1500).toISOString() },
    { id: "o2", parentObservationId: "o0", type: "TOOL", name: "Read", level: "ERROR", statusMessage: "nope", startTime: iso(28) },
    { id: "o3", parentObservationId: "o0", type: "SPAN", name: "vault-recall", metadata: { candidates: 5, asked: 3, kept: 1 }, startTime: iso(30) },
    { id: "o4", parentObservationId: "o0", type: "GENERATION", name: "m", model: "claude-opus", startTime: iso(27) },
  ],
  t2: [
    { id: "p0", type: "AGENT", name: "turn", startTime: iso(20) },
    { id: "p1", parentObservationId: "p0", type: "EVENT", name: "text", output: "first words", startTime: iso(19.9) },
    { id: "p2", parentObservationId: "p0", type: "TOOL", name: "Grep", input: "x", startTime: iso(19.8) },
    { id: "p3", parentObservationId: "p0", type: "EVENT", name: "text", output: "second words", startTime: iso(19.7) },
    { id: "p4", parentObservationId: "p0", type: "TOOL", name: "Glob", input: "y", startTime: iso(19.6) },
    { id: "p5", parentObservationId: "p0", type: "EVENT", name: "text", output: "x".repeat(600), startTime: iso(19.5) },
  ], t3: [],
};
let lf: ReturnType<typeof Bun.serve>;
let hits: string[] = [];
let status = 200;
let fixtures: string;
let savedRepos: string | undefined;
let savedJobs: string | undefined;
let savedUsage: string | undefined;

beforeAll(() => {
  // The route lists projects from the registry and reads runs from the jobs dir: give it our own, not ~/.aleph.
  savedRepos = process.env.ALEPH_REPOS;
  savedJobs = process.env.ALEPH_JOBS_DIR;
  // The chat route adds `wk` from the usage fit: read no snapshots from ~/.aleph. The file is never written.
  savedUsage = process.env.ALEPH_USAGE_FILE;
  fixtures = mkdtempSync(join(tmpdir(), "sessions-fixtures-"));
  writeFileSync(join(fixtures, "repos.json"), JSON.stringify({ aleph: { path: join(fixtures, "aleph") }, sidetone: { path: join(fixtures, "sidetone") } }));
  mkdirSync(join(fixtures, "jobs"));
  process.env.ALEPH_REPOS = join(fixtures, "repos.json");
  process.env.ALEPH_JOBS_DIR = join(fixtures, "jobs");
  process.env.ALEPH_USAGE_FILE = join(fixtures, "usage.jsonl");
  lf = Bun.serve({
    port: 0,
    fetch(req) {
      const u = new URL(req.url);
      hits.push(u.pathname + u.search);
      if (status !== 200) return new Response("boom", { status });
      if (u.pathname === "/api/public/traces") {
        const s = u.searchParams.get("sessionId");
        return Response.json({ data: TRACES.filter((t) => !s || t.sessionId === s), meta: { totalPages: 1 } });
      }
      return Response.json({ data: OBS[u.searchParams.get("traceId")!] ?? [], meta: { totalPages: 1 } });
    },
  });
  process.env.LANGFUSE_BASE_URL = `http://127.0.0.1:${lf.port}`;
  process.env.LANGFUSE_PUBLIC_KEY = "pk";
  process.env.LANGFUSE_SECRET_KEY = "sk";
});
afterAll(() => {
  lf.stop(true);
  if (savedRepos === undefined) delete process.env.ALEPH_REPOS; else process.env.ALEPH_REPOS = savedRepos;
  if (savedJobs === undefined) delete process.env.ALEPH_JOBS_DIR; else process.env.ALEPH_JOBS_DIR = savedJobs;
  if (savedUsage === undefined) delete process.env.ALEPH_USAGE_FILE; else process.env.ALEPH_USAGE_FILE = savedUsage;
  rmSync(fixtures, { recursive: true, force: true });
});
beforeEach(() => { clearCache(); clearFit(); hits = []; status = 200; });

const TABLE = new URLSearchParams("view=table");
const call = (key: string, path: string, params: Record<string, string> = {}) => {
  const url = new URL("http://x" + path);
  return routes[key](new Request(url), params, url) as Promise<Response>;
};



test("the Session page's table uses pageHead, idLink and when, in the shared column order", async () => {
  const s: any = await (await call("GET /api/sessions/:id", "/api/sessions/s1", { id: "s1" })).json();
  const h = v.renderSession(s, {}, TABLE);
  expect(h).toContain('<header class="ph"><h1>Session s1</h1><span class="count">2</span>');
  expect(h).toContain(idLink("s1", "#/sessions/s1").replace('class="idl"', 'class="idl" title="s1"'));
  const heads = [...h.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
  expect(heads).toEqual(["Turn", "Prompt", "Output", "Model", "Tools", "Duration", "Cost", "Started"]);
  expect(h).toContain(`<td class="time">${when(s.turns[0].start)}</td>`);
  expect(h.match(/<h1/g)?.length).toBe(1);
});
