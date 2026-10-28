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

const TABLE = new URLSearchParams("view=table");
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

test("a subagent's span and tools nest under the Agent tool span that launched it", async () => {
  const at = (m: number) => new Date(now - 90 * 60000 + m * 1000).toISOString();
  TRACES.push(trace("t4", "s3", "aleph", at(0)));
  OBS.t4 = [
    { id: "p0", type: "AGENT", name: "turn", startTime: at(0) },
    { id: "ta", parentObservationId: "p0", type: "TOOL", name: "Agent", input: { subagent_type: "Explore", prompt: "look" }, startTime: at(1), endTime: at(30) },
    { id: "tb", parentObservationId: "p0", type: "TOOL", name: "Agent", input: { prompt: "do" }, startTime: at(2), endTime: at(40) },
    { id: "sa", parentObservationId: "p0", type: "AGENT", name: "Explore", metadata: { agent_id: "1", agent_type: "Explore" }, startTime: at(3), endTime: at(20) },
    { id: "sb", parentObservationId: "p0", type: "AGENT", name: "general-purpose", metadata: { agent_id: "2", agent_type: "general-purpose" }, startTime: at(4), endTime: at(35) },
    { id: "sx", parentObservationId: "p0", type: "AGENT", name: "Plan", metadata: { agent_type: "Plan" }, startTime: at(50), endTime: at(55) },
    { id: "xa", parentObservationId: "sa", type: "TOOL", name: "Grep", input: "foo", startTime: at(5) },
    { id: "xb", parentObservationId: "sb", type: "TOOL", name: "Read", input: "f", startTime: at(6) },
    { id: "xx", parentObservationId: "sx", type: "TOOL", name: "Bash", input: "ls", startTime: at(51) },
  ];
  try {
    const d: any = await (await call("GET /api/sessions/:id/turns/:n", "/api/sessions/s3/turns/1", { id: "s3", n: "1" })).json();
    const by = (list: any[], id: string) => list.find((o: any) => o.id === id);
    expect(d.observations.map((o: any) => o.id)).toEqual(["ta", "tb", "sx"]);
    expect(by(d.observations, "ta").children.map((o: any) => o.id)).toEqual(["sa"]);
    expect(by(d.observations, "ta").children[0].children.map((o: any) => o.name)).toEqual(["Grep"]);
    expect(by(d.observations, "tb").children.map((o: any) => o.id)).toEqual(["sb"]);
    expect(by(d.observations, "tb").children[0].children.map((o: any) => o.name)).toEqual(["Read"]);
    expect(by(d.observations, "sx").children.map((o: any) => o.name)).toEqual(["Bash"]);
    const c: any = await (await call("GET /api/sessions/:id/chat", "/api/sessions/s3/chat", { id: "s3" })).json();
    const tools = c.turns[0].tools;
    expect(tools.map((t: any) => t.name)).toEqual(["Agent", "Agent"]);
    expect(tools[0].children.map((t: any) => t.name)).toEqual(["Grep"]);
    expect(tools[1].children.map((t: any) => t.name)).toEqual(["Read"]);
    expect(v.chatTurn("s3", c.turns[0])).toContain('<div class="tools sub">');
  } finally { TRACES.pop(); delete OBS.t4; }
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
  expect(v.renderSession(s, {}, TABLE)).toContain('<div class="tscroll"><table class="tbl">');
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

test("the Session page's table uses pageHead, idLink and when, in the shared column order", async () => {
  const s: any = await (await call("GET /api/sessions/:id", "/api/sessions/s1", { id: "s1" })).json();
  const h = v.renderSession(s, {}, TABLE);
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
    const c: any = await (await call("GET /api/sessions/:id/chat", `/api/sessions/${JOB}/chat`, { id: JOB })).json();
    expect(c.label).toBe("aleph-361");
    expect(c.turns[0].cost).toBe(1.25);
  } finally {
    TRACES.pop();
    if (saved === undefined) delete process.env.ALEPH_JOBS_DIR; else process.env.ALEPH_JOBS_DIR = saved;
  }
});

const chat = async (id: string, q = "") => (await call("GET /api/sessions/:id/chat", `/api/sessions/${id}/chat${q}`, { id })).json() as Promise<any>;

test("the chat route gives whole prompts and replies and each turn's tool calls in order", async () => {
  const d = await chat("s1");
  expect(d).toMatchObject({ id: "s1", project: "aleph", total: 2, from: 1 });
  expect(d.turns[0]).toMatchObject({ n: 1, prompt: "prompt t1\nsecond line", model: "claude-opus", cost: 0.5, durationMs: 12000 });
  expect(d.turns[0].output).toBe("x".repeat(600));
  expect(d.turns[0].tools.map((c: any) => [c.name, c.args, c.error])).toEqual([["Bash", "ls", null], ["Read", "", "nope"]]);
  expect(d.turns[0].tools[0].output).toBe("y".repeat(900));
  expect((await call("GET /api/sessions/:id/chat", "/api/sessions/nope/chat", { id: "nope" })).status).toBe(404);
});

test("the chat route pages by from and limit", async () => {
  const d = await chat("s1", "?from=2&limit=20");
  expect(d.turns.map((t: any) => t.n)).toEqual([2]);
  expect(d.from).toBe(2);
  expect((await chat("s1", "?limit=1")).turns.map((t: any) => t.n)).toEqual([1]);
});

test("argSummary picks the key argument, also out of cut JSON", async () => {
  const { argSummary } = await import("./api/sessions.ts");
  expect(argSummary({ command: "bun test ui", description: "Run" })).toBe("bun test ui");
  expect(argSummary('{"file_path":"/w/ui/lib.js","limit":3}')).toBe("/w/ui/lib.js");
  expect(argSummary('{"description":"x","command":"echo \\"hi\\"\\nls", "more": "cut off her')).toBe('echo "hi" ls');
  expect(argSummary({ pattern: "nextTick", path: "jobs" })).toBe("nextTick");
  expect(argSummary({ todos: [] })).toBe('{"todos":[]}');
});

test("systemParts splits tags the user did not type from the text they did", async () => {
  // @ts-ignore plain JS
  const { systemParts } = await import("./lib.js");
  expect(systemParts("<task-notification><summary>done</summary></task-notification>\n\nfix it")).toEqual({ system: [{ tag: "task-notification", body: "<summary>done</summary>" }], text: "fix it" });
  expect(systemParts("hi\n<system-reminder>cut at 4 K")).toEqual({ system: [{ tag: "system-reminder", body: "cut at 4 K" }], text: "hi" });
  expect(systemParts("a <b>bold</b> claim").system).toEqual([]);
  const quoted = "System text (`<task-notification>`, `<system-reminder>`) folds.\nMore spec.";
  expect(systemParts(quoted)).toEqual({ system: [], text: quoted });
  expect(systemParts("ask\n  <system-reminder>\nnote\n</system-reminder>\nmore").system).toEqual([{ tag: "system-reminder", body: "note" }]);
});

test("the chat is the default: messages in Markdown, folded tool calls, one turn line, a toggle", async () => {
  const d = await chat("s1");
  d.turns[0].prompt = "<task-notification><summary>Agent done</summary></task-notification>";
  d.turns[0].output = "line\n\n".repeat(30);
  d.turns[1].output = "**bold** and `code`";
  const h = v.renderSession(d, { id: "s1" }, new URLSearchParams());
  expect(h).toContain('<button type="button" data-value="chat" aria-pressed="true">Chat</button>');
  expect(h).toContain('<header class="ph"><h1>aleph</h1><span class="count">2</span>');
  expect(h).toContain('<details class="sysc"><summary><span class="chip">task-notification</span><span class="peek">Agent done</span>');
  expect(h).not.toContain('<div class="msg user md"><p>&lt;task');
  expect(h).toContain('<div class="msg user md"><p>prompt t2 second line</p></div>');
  expect(h).toContain("<strong>bold</strong> and <code>code</code>");
  expect(h).toContain('<details class="tool"><summary><span class="tn">Bash</span><code class="ta">ls</code>');
  expect(h).toContain('<details class="tool err"><summary><span class="tn">Read</span><span class="terr">Error</span>');
  expect(h).toContain('<p class="tline"><a href="#/sessions/s1/turns/1">Turn 1</a><span class="dot">·</span>opus<span class="dot">·</span>12.0 s<span class="dot">·</span>$0.50');
  expect(h).toContain(`<span class="time">${when(d.turns[0].start)}</span>`);
  expect(h).toContain('<div class="clip cut">');
  expect(h).toContain('<span class="of">2 of 2</span>');
  expect(h).not.toContain("data-chat-from");
  expect(v.renderSession({ ...d, turns: [{ ...d.turns[0], prompt: "<script>x</script>" }] }, {}, new URLSearchParams())).not.toContain("<script>");
  expect(v.sessionView.api({ id: "a b" }, new URLSearchParams())).toBe("/api/sessions/a%20b/chat?limit=20");
  expect(v.sessionView.api({ id: "a b" }, TABLE)).toBe("/api/sessions/a%20b");
  expect(v.renderSession(await (await call("GET /api/sessions/:id", "/api/sessions/s1", { id: "s1" })).json(), {}, TABLE)).toContain('data-value="table" aria-pressed="true"');
});

test("a long session shows 20 turns and a pager; a long turn folds its earlier tool calls", async () => {
  const d = await chat("s1");
  const tools = Array.from({ length: 30 }, (_, i) => ({ name: "Bash", args: `cmd ${i}`, input: "", output: "", error: i === 2 ? "x" : null, durationMs: 5 }));
  const turns = Array.from({ length: 20 }, (_, i) => ({ ...d.turns[0], n: i + 1, tools }));
  const h = v.renderSession({ ...d, total: 73, turns }, {}, new URLSearchParams());
  expect(h.match(/<section class="turn"/g)?.length).toBe(20);
  expect(h).toContain('<button type="button" data-chat-from="21">Show 20 more</button><span class="of">20 of 73</span>');
  expect(h).toContain('<details class="tools-early"><summary>25 earlier tool calls <span class="terr">1 failed</span></summary>');
  const one = v.chatTurn("s1", { ...d.turns[0], tools });
  const shown = one.slice(one.indexOf("</details>", one.indexOf('class="ta">cmd 24<')) + "</details>".length);
  expect([...shown.matchAll(/class="ta">(cmd \d+)</g)].map((m) => m[1])).toEqual(["cmd 25", "cmd 26", "cmd 27", "cmd 28", "cmd 29"]);
});

test("the sessions list's first prompt skips system text", async () => {
  TRACES.push(trace("t8", "s3", "aleph", iso(2), { input: "<task-notification>agent finished</task-notification>" }), trace("t7", "s3", "aleph", iso(1), { input: "the real ask" }));
  try {
    const list: any = await (await call("GET /api/sessions", "/api/sessions")).json();
    expect(list.sessions.find((s: any) => s.id === "s3").firstPrompt).toBe("the real ask");
  } finally { TRACES.splice(-2); }
});
