// Archived goal tests from ui/sessions.test.ts: `bun run accept` runs them, `bun run test` does not.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { clearCache } from "../../ui/langfuse.ts";
import { clearFit } from "../../ui/usage.ts";
// @ts-ignore plain JS, shared with the page
import { idLink, pageHead, when } from "../../ui/lib.js";
import { listSessions, routes } from "../../ui/api/sessions.ts";
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
const call = (key: string, path: string, params: Record<string, string> = {}) => {
  const url = new URL("http://x" + path);
  return routes[key](new Request(url), params, url) as Promise<Response>;
};

test("sessions lists id, project, first prompt, turns, cost, task types", async () => {
  const d: any = await (await listSessions(new Request("http://localhost"+"/api/sessions?days=7"))).json();
  expect(d.sessions.map((s: any) => s.id)).toEqual(["s2", "s1"]);
  const s1 = d.sessions[1];
  expect(s1).toMatchObject({ project: "aleph", firstPrompt: "prompt t1 second line", turns: 2, cost: 1, taskTypes: ["code_edit"] });
  expect(s1.start).toBe(TRACES[0].timestamp);
  expect(s1.last).toBe(TRACES[1].timestamp);
});

test("a session lists its turns in order", async () => {
  const d: any = await (await call("GET /api/sessions/:id", "/api/sessions/s1", { id: "s1" })).json();
  expect(d.turns.map((t: any) => t.n)).toEqual([1, 2]);
  expect(d.turns[0]).toMatchObject({ tools: 2, durationMs: 12000, cost: 0.5, model: "claude-opus" });
  expect(d.turns[0].output.length).toBeLessThanOrEqual(401);
});


test("the second request is served from the cache", async () => {
  await listSessions(new Request("http://localhost"+"/api/sessions"));
  const n = hits.length;
  expect(n).toBeGreaterThan(0);
  await listSessions(new Request("http://localhost"+"/api/sessions"));
  expect(hits.length).toBe(n);
});



const chat = async (id: string, q = "") => (await call("GET /api/sessions/:id/chat", `/api/sessions/${id}/chat${q}`, { id })).json() as Promise<any>;

test("the chat route pages by from and limit", async () => {
  const d = await chat("s1", "?from=2&limit=20");
  expect(d.turns.map((t: any) => t.n)).toEqual([2]);
  expect(d.from).toBe(2);
  expect((await chat("s1", "?limit=1")).turns.map((t: any) => t.n)).toEqual([1]);
});

test("systemParts splits tags the user did not type from the text they did", async () => {
  // @ts-ignore plain JS
  const { systemParts } = await import("../../ui/system-parts.js");
  expect(systemParts("<task-notification><summary>done</summary></task-notification>\n\nfix it")).toEqual({ system: [{ tag: "task-notification", body: "<summary>done</summary>" }], text: "fix it" });
  expect(systemParts("hi\n<system-reminder>cut at 4 K")).toEqual({ system: [{ tag: "system-reminder", body: "cut at 4 K" }], text: "hi" });
  expect(systemParts("a <b>bold</b> claim").system).toEqual([]);
  const quoted = "System text (`<task-notification>`, `<system-reminder>`) folds.\nMore spec.";
  expect(systemParts(quoted)).toEqual({ system: [], text: quoted });
  expect(systemParts("ask\n  <system-reminder>\nnote\n</system-reminder>\nmore").system).toEqual([{ tag: "system-reminder", body: "note" }]);
});

test("a long session shows 20 turns and a pager; a long turn folds its earlier tool calls", async () => {
  const d = await chat("s1");
  const tools = Array.from({ length: 30 }, (_, i) => ({ name: "Bash", args: `cmd ${i}`, input: "", output: "", error: i === 2 ? "x" : null, durationMs: 5 }));
  const turns = Array.from({ length: 20 }, (_, i) => ({ ...d.turns[0], n: i + 1, tools }));
  const h = v.renderSession({ ...d, total: 73, turns }, {}, new URLSearchParams());
  expect(h.match(/<section class="turn"/g)?.length).toBe(20);
  expect(h).toContain('<button type="button" class="act" data-chat-from="21">Show 20 more</button><span class="of">20 of 73</span>');
  expect(h).toContain('<details class="tools-early"><summary>25 earlier tool calls <span class="terr">1 failed</span></summary>');
  const one = v.chatTurn("s1", { ...d.turns[0], tools });
  const shown = one.slice(one.indexOf("</details>", one.indexOf('class="ta">cmd 24<')) + "</details>".length);
  expect([...shown.matchAll(/class="ta">(cmd \d+)</g)].map((m) => m[1])).toEqual(["cmd 25", "cmd 26", "cmd 27", "cmd 28", "cmd 29"]);
});

test("the sessions list's first prompt skips system text", async () => {
  TRACES.push(trace("t8", "s3", "aleph", iso(2), { input: "<task-notification>agent finished</task-notification>" }), trace("t7", "s3", "aleph", iso(1), { input: "the real ask" }));
  try {
    const list: any = await (await listSessions(new Request("http://localhost"+"/api/sessions"))).json();
    expect(list.sessions.find((s: any) => s.id === "s3").firstPrompt).toBe("the real ask");
  } finally { TRACES.splice(-2); }
});

test("the chat shows the assistant's text blocks between the tool rows, not the final reply twice", async () => {
  const d = await chat("s1");
  expect(d.turns[1].texts.map((t: any) => t.text)).toEqual(["first words", "second words"]);
  const h = v.chatTurn("s1", d.turns[1]);
  const at = (s: string) => h.indexOf(s);
  expect(at("first words")).toBeGreaterThan(-1);
  expect(at("first words")).toBeLessThan(at('<span class="tn">Grep</span>'));
  expect(at('<span class="tn">Grep</span>')).toBeLessThan(at("second words"));
  expect(at("second words")).toBeLessThan(at('<span class="tn">Glob</span>'));
  expect(at('<span class="tn">Glob</span>')).toBeLessThan(at('<div class="msg reply md">'));
});

test("the chat route gives each call an id, parent, kind and offsets from the session start", async () => {
  const d = await chat("s1");
  expect(d.turns[0].startMs).toBe(0);
  expect(d.turns[1].startMs).toBe(10 * 60000);
  const bash = d.turns[0].tools[0];
  expect(bash).toMatchObject({ id: "o1", parent: null, kind: "tool", startMs: 60000, endMs: 61500 });
});

test("the waterfall: one row per turn and call, summary names the 3 longest and the errors, a row is selectable", async () => {
  const d = await chat("s1");
  const tools = Array.from({ length: 100 }, (_, i) => ({ id: `c${i}`, parent: null, kind: "tool", name: "Bash", args: `cmd ${i}`, input: "in", output: "out", start: d.turns[0].start, startMs: i * 1000, endMs: i * 1000 + (i % 10 === 9 ? 5000 + i : 500), durationMs: i % 10 === 9 ? 5000 + i : 500, error: i === 50 ? "boom" : null, children: [] }));
  const turn = { ...d.turns[0], tools, generations: [] };
  const rows = v.wfRows([turn]);
  expect(rows.length).toBe(101);
  expect(rows[0].kind).toBe("turn");
  const h = v.waterfall(rows, "c50");
  expect(h.match(/class="wf-row /g)!.length).toBe(101);
  expect(h).toContain('wf-row k-tool err sel');
  expect(h).toContain("1 error");
  expect(h).toContain('data-select="c99"');
  expect(h).toContain('data-select="c89"');
  expect(h).toContain('data-select="c79"');
  const q = new URLSearchParams("view=waterfall");
  expect(v.renderSession({ ...d, turns: [turn] }, {}, q)).toContain('data-value="waterfall" aria-pressed="true"');
  expect(v.wfDetail(rows.find((r: any) => r.id === "c50"))).toContain("boom");
});
