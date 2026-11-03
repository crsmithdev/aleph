import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { clearCache } from "./langfuse.ts";
import { clearFit } from "./usage.ts";
// @ts-ignore plain JS, shared with the page
import { idLink, pageHead, when } from "./lib.js";
import { listSessions, routes } from "./api/sessions.ts";
// @ts-ignore plain JS, shared with the page
import * as v from "./views/session.js";

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

test("the project filter narrows every route", async () => {
  const d: any = await (await listSessions(new Request("http://localhost"+"/api/sessions?project=sidetone"))).json();
  expect(d.sessions.map((s: any) => s.id)).toEqual(["s2"]);
  expect((await call("GET /api/sessions/:id", "/api/sessions/s1?project=sidetone", { id: "s1" })).status).toBe(404);
  expect((await call("GET /api/sessions/:id/turns/:n", "/api/sessions/s1/turns/1?project=sidetone", { id: "s1", n: "1" })).status).toBe(404);
  expect((await call("GET /api/sessions/:id", "/api/sessions/s1?project=aleph", { id: "s1" })).status).toBe(200);
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


test("the waterfall at 390 px: the detail pane stacks under a grid that scrolls in a short box", async () => {
  const html = await Bun.file(new URL("./app.css", import.meta.url)).text();
  const narrow = html.match(/@media \(max-width: 720px\) \{([\s\S]*?)\n\}/g)!.find((b) => b.includes(".wf "))!;
  expect(narrow).toMatch(/\.wf \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  expect(narrow).toMatch(/\.wf-detail \{ position: static; max-height: none; \}/);
  expect(narrow).toMatch(/\.wf-grid \{ max-height: \d+vh; overflow: auto; scroll-padding-top: 24px; \}/);
});

test("the Turn page uses pageHead, idLink and when", async () => {
  const t: any = await (await call("GET /api/sessions/:id/turns/:n", "/api/sessions/s1/turns/2", { id: "s1", n: "2" })).json();
  expect(t.start).toBe(TRACES[1].timestamp);
  const h = v.renderTurn(t);
  expect(h).toContain(pageHead("Turn 2 of 2").replace("</header>", ""));
  expect(h).toContain('<a href="#/sessions/s1">s1</a> / <span>turn 2</span>');
  expect(h).toContain(`<dt>Started</dt><dd>${when(t.start)}</dd>`);
  expect(h.match(/<h1/g)?.length).toBe(1);
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

test("argSummary picks the key argument, also out of cut JSON", async () => {
  const { argSummary } = await import("./api/sessions.ts");
  expect(argSummary({ command: "bun test ui", description: "Run" })).toBe("bun test ui");
  expect(argSummary('{"file_path":"/w/ui/lib.js","limit":3}')).toBe("/w/ui/lib.js");
  expect(argSummary('{"description":"x","command":"echo \\"hi\\"\\nls", "more": "cut off her')).toBe('echo "hi" ls');
  expect(argSummary({ pattern: "nextTick", path: "jobs" })).toBe("nextTick");
  expect(argSummary({ todos: [] })).toBe('{"todos":[]}');
});

test("the chat is the default: messages in Markdown, folded tool calls, one turn line, a toggle", async () => {
  const d = await chat("s1");
  d.turns[0].prompt = "<task-notification><summary>Agent done</summary></task-notification>";
  d.turns[0].output = "line\n\n".repeat(30);
  d.turns[1].output = "**bold** and `code`";
  const h = v.renderSession(d, { id: "s1" }, new URLSearchParams());
  expect(h).toContain('<button type="button" data-value="chat" aria-pressed="true">Chat</button>');
  expect(h).toContain('<header class="ph"><h1>Session s1</h1><span class="count">2</span>');
  expect(h).toContain('<details class="sysc"><summary><span class="chip">task-notification</span><span class="peek">Agent done</span>');
  expect(h).not.toContain('<div class="msg user md"><p>&lt;task');
  expect(h).toContain('<div class="msg user md"><p>prompt t2 second line</p></div>');
  expect(h).toContain("<strong>bold</strong> and <code>code</code>");
  expect(h).toContain('<details class="tool"><summary><span class="tn">Bash</span><code class="ta">ls</code>');
  expect(h).toContain('<details class="tool err"><summary><span class="tn">Read</span><span class="terr">Error</span>');
  expect(h).toContain('<p class="tline"><a href="#/sessions/s1/turns/1">Turn 1</a><span class="dot">·</span>opus<span class="dot">·</span>12.0s<span class="dot">·</span>$0.50');
  expect(h).toContain(`<span class="time">${when(d.turns[0].start)}</span>`);
  expect(h).toContain('<div class="clip cut">');
  expect(h).toContain('<span class="of">2 of 2</span>');
  expect(h).not.toContain("data-chat-from");
  expect(v.renderSession({ ...d, turns: [{ ...d.turns[0], prompt: "<script>x</script>" }] }, {}, new URLSearchParams())).not.toContain("<script>");
  expect(v.sessionView.api({ id: "a b" }, new URLSearchParams())).toBe("/api/sessions/a%20b/chat?limit=20");
  expect(v.sessionView.api({ id: "a b" }, TABLE)).toBe("/api/sessions/a%20b");
  expect(v.renderSession(await (await call("GET /api/sessions/:id", "/api/sessions/s1", { id: "s1" })).json(), {}, TABLE)).toContain('data-value="table" aria-pressed="true"');
});

test("generations: listed apart from tools with model, offsets, parent and cost; the waterfall draws them as rows", async () => {
  const at = (m: number) => new Date(now - m * 60000).toISOString();
  const extra = [
    { id: "g1", parentObservationId: "p0", type: "GENERATION", name: "gen", model: "claude-opus", startTime: at(19.85), endTime: new Date(now - 19.85 * 60000 + 4000).toISOString(), calculatedTotalCost: 0.25, usage: { input: 100, output: 20 }, input: "i".repeat(600), output: "ok" },
    { id: "a0", parentObservationId: "p0", type: "AGENT", name: "Explore", metadata: { agent_type: "Explore" }, startTime: at(19.4), endTime: at(19.0) },
    { id: "ag", parentObservationId: "p0", type: "TOOL", name: "Agent", input: { subagent_type: "Explore" }, startTime: at(19.45), endTime: at(18.9) },
    { id: "g2", parentObservationId: "a0", type: "GENERATION", name: "sub", model: "claude-haiku", startTime: at(19.3), endTime: new Date(now - 19.3 * 60000 + 2000).toISOString(), totalCost: 0.05, level: "ERROR", statusMessage: "overloaded" },
  ];
  OBS.t2.push(...extra);
  try {
    const d = await chat("s1");
    const t = d.turns[1];
    expect(t.tools.some((c: any) => c.kind === "generation" || c.id === "g1" || c.children.some((k: any) => k.id === "g2"))).toBe(false);
    expect(t.generations.map((g: any) => g.id)).toEqual(["g1", "g2"]);
    expect(t.generations[0]).toMatchObject({ parent: null, kind: "generation", model: "claude-opus", startMs: 10 * 60000 + 9000, durationMs: 4000, cost: 0.25, inputTokens: 100, outputTokens: 20, error: null });
    expect(t.generations[0].input.length).toBeLessThanOrEqual(401);
    expect(t.generations[1]).toMatchObject({ parent: "ag", model: "claude-haiku", cost: 0.05, error: "overloaded" });
    expect(d.turns[0].generations.map((g: any) => g.id)).toEqual(["o4"]);
    const rows = v.wfRows([t]);
    const g1 = rows.findIndex((r: any) => r.id === "g1"), g2 = rows.findIndex((r: any) => r.id === "g2"), ag = rows.findIndex((r: any) => r.id === "ag");
    expect(rows[g1]).toMatchObject({ kind: "generation", name: "claude-opus", depth: 1, startMs: t.generations[0].startMs });
    expect(rows[g2]).toMatchObject({ kind: "generation", depth: rows[ag].depth + 1 });
    expect(g2).toBeGreaterThan(ag);
    expect(rows.findIndex((r: any) => r.id === "p2")).toBeGreaterThan(g1);
    const h = v.waterfall(rows, "g1");
    expect(h).toContain("wf-row k-generation sel");
    expect(h).toContain("Model time <strong>6.0s</strong>");
    expect(h).not.toContain('data-select="g1"');
    const det = v.wfDetail(rows[g1]);
    expect(det).toContain("100 in, 20 out");
    expect(det).toContain("generation");
  } finally { OBS.t2.splice(-extra.length); }
});
