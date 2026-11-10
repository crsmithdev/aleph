import { afterAll, beforeAll, beforeEach, expect, setSystemTime, test } from "bun:test";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearCache, listSkills, routes } from "./api/skills.ts";
import { memory, use } from "./langfuse.ts";
import { withEnv, withServer } from "./test-server.ts";
import { updater } from "./updater.ts";
// @ts-ignore plain JS, shared with the page
import * as v from "./views/skills.js";

const today = "2026-11-09";
const NOW = Date.parse(`${today}T12:00:00.000Z`);
setSystemTime(NOW);
const daysAgo = (n: number, time = "10:00:00") => new Date(Date.parse(today) - n * 86400_000).toISOString().slice(0, 10) + `T${time}.000Z`;

let tmp: string, lf: ReturnType<typeof Bun.serve>, stopApp: () => void, restoreEnv: () => void, appAt: (path: string) => Promise<Response>, asked: URL[] = [];
const ob = (o: any): any => ({ type: o.name === "turn" ? "AGENT" : "TOOL", level: "DEFAULT", ...o });
const observations = [
  // t1: aleph project, Skill tool call, then Read + Bash + a failing Edit in the same turn; Read before the skill does not count
  ob({ id: "1", traceId: "t1", name: "turn", input: "pickup the work", startTime: daysAgo(0, "09:00:00") }),
  ob({ id: "2", traceId: "t1", name: "Read", type: "TOOL", metadata: { tool: "Read" }, startTime: daysAgo(0, "09:00:01") }),
  ob({ id: "3", traceId: "t1", name: "skill:aleph:pickup", type: "TOOL", input: JSON.stringify({ skill: "aleph:pickup" }), metadata: { tool: "Skill" }, startTime: daysAgo(0, "09:00:02") }),
  ob({ id: "4", traceId: "t1", name: "Bash", type: "TOOL", metadata: { tool: "Bash" }, startTime: daysAgo(0, "09:00:03") }),
  ob({ id: "5", traceId: "t1", name: "Bash", type: "TOOL", metadata: { tool: "Bash" }, startTime: daysAgo(0, "09:00:04") }),
  ob({ id: "6", traceId: "t1", name: "Edit", type: "TOOL", level: "ERROR", output: "no match", metadata: { tool: "Edit" }, startTime: daysAgo(0, "09:00:05") }),
  // t2: other project, slash command two days ago
  ob({ id: "7", traceId: "t2", name: "turn", input: "<command-message>pickup</command-message>\n<command-name>/aleph:pickup</command-name>\n<command-args>aleph-9</command-args>", startTime: daysAgo(2) }),
  ob({ id: "8", traceId: "t2", name: "Grep", type: "TOOL", metadata: { tool: "Grep" }, startTime: daysAgo(2, "10:00:01") }),
  // t3: a bare slash command in the aleph project, for another skill
  ob({ id: "9", traceId: "t3", name: "turn", input: "/aleph:retro last week", startTime: daysAgo(3) }),
  // t4: a built-in slash command, not a skill
  ob({ id: "10", traceId: "t4", name: "turn", input: "/clear", startTime: daysAgo(1) }),
  // t5: too old for the default window
  ob({ id: "11", traceId: "t5", name: "turn", input: "/aleph:retro", startTime: daysAgo(40) }),
  // t6: a sandbox directory that is no registry project
  ob({ id: "12", traceId: "t6", name: "turn", input: "/aleph:sandbox", startTime: daysAgo(1) }),
  // t7 and t8: traces the way the real store has them, a project tag and no cwd; one tag is a registry key, one is not
  ob({ id: "13", traceId: "t7", name: "turn", input: "/aleph:tagged", startTime: daysAgo(1) }),
  ob({ id: "14", traceId: "t8", name: "turn", input: "/aleph:untagged", startTime: daysAgo(1) }),
];
const traces: any[] = [
  { id: "t1", sessionId: "s1", metadata: { cwd: "/work/aleph" } },
  { id: "t2", sessionId: "s2", metadata: { cwd: "/work/other" } },
  { id: "t3", sessionId: "s1", metadata: { cwd: "/work/aleph" } },
  { id: "t4", sessionId: "s1", metadata: { cwd: "/work/aleph" } },
  { id: "t5", sessionId: "s3", metadata: { cwd: "/work/aleph" } },
  { id: "t6", sessionId: "s4", metadata: { cwd: "/tmp/agent-ae1db4a1e2c301339" } },
  { id: "t7", sessionId: "s5", metadata: {}, tags: ["project:aleph"] },
  { id: "t8", sessionId: "s6", metadata: {}, tags: ["project:agent-ae1db4a1e2c301339"] },
];

// A trace's time is its turn's, as in Langfuse.
for (const t of traces) t.timestamp = observations.find((o) => o.traceId === t.id)!.startTime;
const mem = memory({ traces, observations });

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "aleph-ui-skills-"));
  mkdirSync(join(tmp, "skills", "pickup"), { recursive: true });
  mkdirSync(join(tmp, "skills", "retro"), { recursive: true });
  mkdirSync(join(tmp, "skills", "dormant"), { recursive: true });
  for (const s of ["pickup", "retro", "dormant"]) writeFileSync(join(tmp, "skills", s, "SKILL.md"), `# ${s}\n`);
  writeFileSync(join(tmp, "repos.json"), JSON.stringify({ aleph: { path: "/work/aleph" }, other: { path: "/work/other" } }));
  use(mem);
  // The server's builds run in its Worker, which reads Langfuse over HTTP: this fake answers them in one page.
  lf = Bun.serve({
    port: 0,
    fetch(req) {
      const u = new URL(req.url);
      asked.push(u);
      const from = Date.parse(u.searchParams.get("fromStartTime") ?? u.searchParams.get("fromTimestamp") ?? "0");
      const type = u.searchParams.get("type");
      if (u.pathname === "/api/public/observations") return Response.json({ data: observations.filter((o) => Date.parse(o.startTime) >= from && (!type || o.type === type)), meta: { totalPages: 1 } });
      if (u.pathname === "/api/public/traces") return Response.json({ data: traces, meta: { totalPages: 1 } });
      return new Response("not found", { status: 404 });
    },
  });
  restoreEnv = withEnv({ LANGFUSE_BASE_URL: `http://127.0.0.1:${lf.port}`, LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk", ALEPH_SKILLS_DIR: join(tmp, "skills"), ALEPH_SKILLS_STORE: join(tmp, "store.json"), ALEPH_REPOS: join(tmp, "repos.json") });
  ({ stop: stopApp, at: appAt } = await withServer({ warm: false }));
});
afterAll(() => {
  setSystemTime();
  stopApp(); lf.stop(true); use(null);
  restoreEnv();
});
beforeEach(() => { clearCache(); updater.reset(); rmSync(join(tmp, "store.json"), { force: true }); mem.asked.length = 0; mem.down = null; asked = []; });

/** A skills route's answer, built in this thread from the rows of `mem`. */
const get = async (p: string) => {
  const url = new URL(p, "http://localhost"), name = url.pathname.match(/^\/api\/skills\/(.+)$/)?.[1];
  const r = await (name ? routes["GET /api/skills/:name"](new Request(url), { name: decodeURIComponent(name) }, url) : listSkills(new Request(url)));
  return { status: r.status, body: r.headers.get("content-type")?.includes("json") ? await r.json() as any : await r.text() }; };

test("?project= that is no registry key matches nothing", async () => {
  expect((await get("/api/skills")).body.skills.length).toBeGreaterThan(0);
  expect((await get("/api/skills?project=zeta")).body.skills).toEqual([]);
});

test("a 502 goes out only after every read of the failed fetch has ended", async () => {
  let open = 0, fail!: () => void;
  const failed = new Promise<void>((r) => { fail = r; });
  // The other reads are held open past the failed one: one still open when the 502 went out would show here.
  const held = async (): Promise<any> => { open++; await failed; await new Promise((r) => setTimeout(r, 0)); open--; throw new Error("down"); };
  use({ ...mem, traces: held, observations: (q) => (q.type === "AGENT" ? (fail(), Promise.reject(new Error("down"))) : held()) });
  try {
    expect((await get("/api/skills")).status).toBe(502);
    expect(open).toBe(0);
  } finally { use(mem); }
});

test("after a restart, a reload fetches only the rows of the last two hours and keeps the older ones", async () => {
  await get("/api/skills");
  clearCache(); // as a restart: the rows are on disk only
  mem.asked.length = 0;
  const { status, body } = await get("/api/skills");
  expect(status).toBe(200);
  const from = mem.asked.find((a) => a.list === "observations")!.q.from!.getTime();
  expect(NOW - from).toBeLessThan(2 * 3600_000 + 60_000);
  expect(NOW - from).toBeGreaterThan(2 * 3600_000 - 60_000);
  expect(body.skills.find((s: any) => s.name === "aleph:pickup")).toMatchObject({ uses: 2, errors: 1 }); // t2 is two days old
});

test("a restart builds the saved keys at once: a request shares that build, and the next one hits Langfuse zero times", async () => {
  // Other warm-ups (memory's `vault misses` subprocess, the Agents page's 7-day window) reach the fake too: only the skills lists' 30-day reads count.
  const mine = () => asked.filter((u) => (u.pathname === "/api/public/traces" || ["AGENT", "TOOL"].includes(u.searchParams.get("type") ?? "")) && Date.parse(u.searchParams.get("fromStartTime") ?? u.searchParams.get("fromTimestamp") ?? "") < NOW - 10 * 86400_000).length;
  const restoreEnv = withEnv({ ALEPH_FACTORY_DIR: join(tmp, "factory") });
  // The keys the last process kept: the restart builds them before any request.
  mkdirSync(join(tmp, "ui"), { recursive: true });
  writeFileSync(join(tmp, "ui", "keys.json"), JSON.stringify({ "/api/skills/aleph:pickup": NOW, "/api/sessions?window=week": NOW }));
  const { at, stop } = await withServer();
  try {
    const r = await at("/api/skills/aleph:pickup"); // shares the build the restart started
    expect(r.status).toBe(200);
    expect(mine()).toBe(3); // 3 lists x 1 page
    expect((await at("/api/skills/aleph:pickup")).status).toBe(200);
    expect(mine()).toBe(3);
    // The Agents page: its build started at the restart too, so a request waits for it and reads nothing more.
    expect((await at("/api/sessions?window=week")).status).toBe(200);
    const seen = asked.length;
    const a = await at("/api/sessions?window=week");
    expect(a.status).toBe(200);
    const b = await a.json() as any;
    for (const k of ["activity", "skills", "sessions", "toolSessions"]) expect(b[k]).toBeDefined();
    expect(b.skills.error).toBeUndefined();
    expect(b.sessions.error).toBeUndefined();
    expect(asked.length).toBe(seen);
  } finally {
    stop();
    restoreEnv();
  }
});

test("a skill folder added while the server runs shows without a restart", async () => {
  expect((await appAt("/api/skills/fresh")).status).toBe(404);
  const rebuilt = new Promise<void>((done) => updater.onChange((keys) => { if (keys.includes("/api/skills/fresh")) done(); }));
  const staged = join(tmp, "fresh");
  mkdirSync(staged);
  writeFileSync(join(staged, "SKILL.md"), "# fresh\n");
  renameSync(staged, join(tmp, "skills", "fresh"));
  try {
    await rebuilt;
    expect((await appAt("/api/skills/fresh")).status).toBe(200);
  } finally { rmSync(join(tmp, "skills", "fresh"), { recursive: true, force: true }); }
});

test("a project tag with no cwd counts only when it is a registry key", async () => {
  const { body } = await get("/api/skills");
  expect(body.skills.find((s: any) => s.name === "aleph:tagged")).toMatchObject({ uses: 1, projects: ["aleph"] });
  expect(body.skills.find((s: any) => s.name === "aleph:untagged")).toMatchObject({ uses: 1, projects: [] });
  expect(body.skills.flatMap((s: any) => s.projects)).not.toContain("agent-ae1db4a1e2c301339");
  expect((await get("/api/skills?project=aleph")).body.skills.map((s: any) => s.name)).toContain("aleph:tagged");
});


test("the skill detail uses section heads and fit tables", async () => {
  const detail = v.renderSkill((await get("/api/skills/aleph:pickup")).body);
  expect(detail).toContain('<div class="sh"><h2>Projects</h2>');
  for (const t of ["<h2>Uses per Day</h2>", "<th>First Prompt Line</th>", "<th>Started by</th>", "<th>Started</th><th>Session</th><th>First Prompt Line</th>",  "<th>Started</th><th>Session</th><th>Error</th><th>Project</th>", "<h2>Tools Called After It, in the Same Turn</h2>", 'aria-label="Uses per Day"', 'aria-label="Tools called after it, in the same turn"']) expect(detail).toContain(t);
  // The uses chart is a panel: its title, its label and its box come from the frame.
  expect(detail).toMatch(/<aleph-chart key="skills\/aleph:pickup"><section class="card" aria-label="Uses per Day"><div class="sh"><h2>Uses per Day<\/h2>[\s\S]*?<div class="chartbox" role="img" aria-label="Uses per Day: Uses \d+"><\/div>/);
  const f = v.usesFrame({ since: "2026-11-01", perDay: [1, 0, 2] });
  expect(f.rows.map((r: any) => [r.at, r.uses])).toEqual([[Date.parse("2026-11-01"), 1], [Date.parse("2026-11-01") + 864e5, 0], [Date.parse("2026-11-01") + 2 * 864e5, 2]]);
  expect([f.measure, f.by.keys.map((k: any) => k.name)]).toEqual([{ name: "Uses per Day", unit: "count", agg: "sum" }, ["Uses"]]);
  expect(detail).not.toContain("<h3>");
  expect(detail).not.toContain("<style");
});

test("the skill detail shows empty() for each table with no rows and pages Sessions at 50", () => {
  const base = { name: "x", uses: 1, days: 7, since: "2026-11-01", perDay: [1], sessions: [], errors: [], tools: [], projects: [] };
  expect(v.renderSkill(base).match(/class="empty"/g)).toHaveLength(4);
  const sessions = Array.from({ length: 51 }, (_, i) => ({ id: `s${i}abcdefgh`, time: "2026-11-01T00:00:00Z", prompt: "p", project: "a", via: "slash" }));
  const h = v.renderSkill({ ...base, sessions });
  expect(h).toContain("50 of 51");
  expect(v.renderSkill({ ...base, sessions }, { sessions: 100 })).toContain("51 of 51");
});

test("a skill's answer fits its schema", async () => {
  const { SCHEMAS, check, epochs } = await import("./schemas.ts");
  const { status, body } = await get("/api/skills/aleph:pickup");
  expect(status).toBe(200);
  expect([...check(SCHEMAS["/api/skills/:name"] as any, body), ...epochs(body)]).toEqual([]);
});
