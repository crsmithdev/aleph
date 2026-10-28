import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { clearCache } from "./langfuse.ts";
// @ts-ignore plain JS, shared with the page
import { idLink, pageHead, when } from "./lib.js";
import { routes } from "./api/sessions.ts";
// @ts-ignore plain JS, shared with the page
import * as v from "./views/sessions.js";

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
  t2: [], t3: [],
};
let lf: ReturnType<typeof Bun.serve>;
let hits: string[] = [];
let status = 200;

beforeAll(() => {
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
afterAll(() => lf.stop(true));
beforeEach(() => { clearCache(); hits = []; status = 200; });

const call = (key: string, path: string, params: Record<string, string> = {}) => {
  const url = new URL("http://x" + path);
  return routes[key](new Request(url), params, url) as Promise<Response>;
};

test("sessions lists id, project, first prompt, turns, cost, task types", async () => {
  const d: any = await (await call("GET /api/sessions", "/api/sessions?days=7")).json();
  expect(d.sessions.map((s: any) => s.id)).toEqual(["s2", "s1"]);
  const s1 = d.sessions[1];
  expect(s1).toMatchObject({ project: "aleph", firstPrompt: "prompt t1 second line", turns: 2, cost: 1, taskTypes: ["code_edit"] });
  expect(s1.start).toBe(TRACES[0].timestamp);
  expect(s1.last).toBe(TRACES[1].timestamp);
});

test("the project filter narrows every route", async () => {
  const d: any = await (await call("GET /api/sessions", "/api/sessions?project=sidetone")).json();
  expect(d.sessions.map((s: any) => s.id)).toEqual(["s2"]);
  expect((await call("GET /api/sessions/:id", "/api/sessions/s1?project=sidetone", { id: "s1" })).status).toBe(404);
  expect((await call("GET /api/sessions/:id/turns/:n", "/api/sessions/s1/turns/1?project=sidetone", { id: "s1", n: "1" })).status).toBe(404);
  expect((await call("GET /api/sessions/:id", "/api/sessions/s1?project=aleph", { id: "s1" })).status).toBe(200);
});

test("a session lists its turns in order", async () => {
  const d: any = await (await call("GET /api/sessions/:id", "/api/sessions/s1", { id: "s1" })).json();
  expect(d.turns.map((t: any) => t.n)).toEqual([1, 2]);
  expect(d.turns[0]).toMatchObject({ tools: 2, durationMs: 12000, cost: 0.5, model: "claude-opus" });
  expect(d.turns[0].output.length).toBeLessThanOrEqual(401);
});

test("a turn is a tree of tools, hook spans and errors", async () => {
  const d: any = await (await call("GET /api/sessions/:id/turns/:n", "/api/sessions/s1/turns/1", { id: "s1", n: "1" })).json();
  const names = d.observations.map((o: any) => o.name);
  expect(names).toEqual(["vault-recall", "Bash", "Read", "m"]);
  const by = (n: string) => d.observations.find((o: any) => o.name === n);
  expect(by("Bash")).toMatchObject({ kind: "tool", durationMs: 1500 });
  expect(by("Bash").output.length).toBeLessThanOrEqual(401);
  expect(by("Read").error).toBe("nope");
  expect(by("vault-recall").recall).toEqual({ candidates: 5, asked: 3, kept: 1 });
  expect(d.traceId).toBe("t1");
  expect(d.start).toBe(TRACES[0].timestamp);
  expect((await call("GET /api/sessions/:id/turns/:n", "/api/sessions/s1/turns/9", { id: "s1", n: "9" })).status).toBe(404);
});

test("a Langfuse 500 is a 502 with a message", async () => {
  status = 500;
  const r = await call("GET /api/sessions", "/api/sessions");
  expect(r.status).toBe(502);
  const body: any = await r.json();
  expect(body.error).toContain("500");
  expect(v.renderSessions(body)).toContain("Langfuse is unreachable");
});

test("the second request is served from the cache", async () => {
  await call("GET /api/sessions", "/api/sessions");
  const n = hits.length;
  expect(n).toBeGreaterThan(0);
  await call("GET /api/sessions", "/api/sessions");
  expect(hits.length).toBe(n);
});

test("views render, link to Langfuse, and escape", async () => {
  const list: any = await (await call("GET /api/sessions", "/api/sessions")).json();
  expect(v.renderSessions(list)).toContain('<a class="idl" title="s1" href="#/sessions/s1">s1</a>');
  expect(v.renderSessions(list)).toContain('<header class="ph"><h1>Sessions</h1><span class="count">2</span></header>');
  const s: any = await (await call("GET /api/sessions/:id", "/api/sessions/s1", { id: "s1" })).json();
  expect(v.renderSession(s)).toContain(`${s.base}/trace/t1`);
  const t: any = await (await call("GET /api/sessions/:id/turns/:n", "/api/sessions/s1/turns/1", { id: "s1", n: "1" })).json();
  const h = v.renderTurn(t);
  expect(h).toContain("candidates 5, asked 3, kept 1");
  expect(h).toContain(`${s.base}/trace/t1`);
  expect(v.renderTurn({ ...t, prompt: "<script>" })).not.toContain("<script>");
  expect(v.view.group).toBe("claude");
});

test("the sessions tables scroll inside their own wrapper", async () => {
  const html = await Bun.file(new URL("./index.html", import.meta.url)).text();
  expect(html).toMatch(/^\.tscroll \{[^}]*overflow-x: auto/m);
  const list: any = await (await call("GET /api/sessions", "/api/sessions")).json();
  expect(v.renderSessions(list)).toContain('<div class="tscroll"><table class="tbl">');
  const s: any = await (await call("GET /api/sessions/:id", "/api/sessions/s1", { id: "s1" })).json();
  expect(v.renderSession(s)).toContain('<div class="tscroll"><table class="tbl">');
});

test("the list has a filter bar, 50 rows and a pager; the turn is a table", async () => {
  const list: any = await (await call("GET /api/sessions", "/api/sessions")).json();
  const h = v.renderSessions(list);
  expect(h).toContain('class="fbar"');
  expect(h).toContain('name="q"');
  expect(h).toContain('<span class="of">2 of 2</span>');
  expect(h).toContain('<span class="chips">');
  const many = { ...list, sessions: Array.from({ length: 60 }, (_, i) => ({ ...list.sessions[0], id: `s${i}` })) };
  expect(v.renderSessions(many)).toContain('data-more="10"');
  const t: any = await (await call("GET /api/sessions/:id/turns/:n", "/api/sessions/s1/turns/1", { id: "s1", n: "1" })).json();
  expect(v.renderTurn(t)).toContain('<table class="tbl">');
});

test("the Session page uses pageHead, idLink and when, in the shared column order", async () => {
  const s: any = await (await call("GET /api/sessions/:id", "/api/sessions/s1", { id: "s1" })).json();
  const h = v.renderSession(s);
  expect(h).toContain('<header class="ph"><h1>aleph</h1><span class="count">2</span>');
  expect(h).toContain(idLink("s1", "#/sessions/s1").replace('class="idl"', 'class="idl" title="s1"'));
  const heads = [...h.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
  expect(heads).toEqual(["Turn", "Prompt", "Output", "Model", "Tools", "Duration", "Cost", "Started"]);
  expect(h).toContain(`<td class="time">${when(s.turns[0].start)}</td>`);
  expect(h.match(/<h1/g)?.length).toBe(1);
});

test("the Turn page uses pageHead, idLink and when", async () => {
  const t: any = await (await call("GET /api/sessions/:id/turns/:n", "/api/sessions/s1/turns/2", { id: "s1", n: "2" })).json();
  expect(t.start).toBe(TRACES[1].timestamp);
  const h = v.renderTurn(t);
  expect(h).toContain(pageHead("Turn 2 of 2").replace("</header>", ""));
  expect(h).toContain(`/ ${idLink("s1", "#/sessions/s1").replace('class="idl"', 'class="idl" title="s1"')}`);
  expect(h).toContain(`<dt>Started</dt><dd>${when(t.start)}</dd>`);
  expect(h.match(/<h1/g)?.length).toBe(1);
});

test("Project and Window are hash parameters that reach the API", async () => {
  expect(v.view.api({}, new URLSearchParams("days=30&project=aleph&x=1"))).toBe("/api/sessions?days=30&project=aleph");
  expect(v.view.api({}, new URLSearchParams())).toBe("/api/sessions");
  const list: any = await (await call("GET /api/sessions", "/api/sessions")).json();
  expect(Array.isArray(list.projects)).toBe(true);
  expect(list.projects).toEqual([...list.projects].sort());
  const h = v.renderSessions(list, {}, new URLSearchParams());
  expect(h).toContain('data-name="project"');
  expect(h).toContain('data-name="days"');
  expect(h).toContain('data-value="7" aria-pressed="true"');
  expect(h).toContain('name="q"');
  expect(h).not.toContain("<style");
  const heads = [...h.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
  expect(heads).toEqual(["Session", "First prompt", "Project", "Kinds", "Turns", "Cost", "Started", "Last"]);
  expect(v.renderSessions({ ...list, sessions: [] }, {}, new URLSearchParams("days=30"))).toContain("No session in the last 30 days.");
});

test("a factory session shows the job name and takes its cost from the ledger", async () => {
  const JOB = "20261028-090535-aleph-aleph-361-agent";
  const dir = mkdtempSync(join(tmpdir(), "sessions-jobs-"));
  mkdirSync(join(dir, JOB));
  writeFileSync(join(dir, JOB, "state.json"), JSON.stringify({ kind: "agent", job: JOB, name: "aleph-361", repo: "aleph", state: "landed", cost: 1.25, told: true, started: iso(60) }));
  const saved = process.env.ALEPH_JOBS_DIR;
  process.env.ALEPH_JOBS_DIR = dir;
  TRACES.push(trace("t9", JOB, "aleph", iso(5), { totalCost: 0 }));
  try {
    const list: any = await (await call("GET /api/sessions", "/api/sessions")).json();
    const job = list.sessions.find((s: any) => s.id === JOB);
    expect(job.label).toBe("aleph-361");
    expect(job.cost).toBe(1.25);
    const s1 = list.sessions.find((s: any) => s.id === "s1");
    expect(s1.label).toBeUndefined();
    expect(s1.cost).toBe(1);
    const h = v.renderSessions(list);
    expect(h).toContain(">aleph-361</a>");
    expect(h).toContain("$1.25");
    expect(h).not.toContain(">20261028</a>");
    expect(h).not.toContain("$0.00");
    expect(h).toContain(`title="${JOB}"`);
    const d: any = await (await call("GET /api/sessions/:id", `/api/sessions/${JOB}`, { id: JOB })).json();
    expect(d.label).toBe("aleph-361");
    expect(v.renderSession(d)).toContain(">aleph-361</a>");
  } finally {
    TRACES.pop();
    if (saved === undefined) delete process.env.ALEPH_JOBS_DIR; else process.env.ALEPH_JOBS_DIR = saved;
  }
});
