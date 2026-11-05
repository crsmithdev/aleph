import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearCache, listSkills } from "./api/skills.ts";
import { withEnv, withServer } from "./test-server.ts";
// @ts-ignore plain JS, shared with the page
import * as v from "./views/skills.js";
// @ts-ignore
import { view as skillView } from "./views/skill.js";

const today = new Date().toISOString().slice(0, 10);
const daysAgo = (n: number, time = "10:00:00") => new Date(Date.parse(today) - n * 86400_000).toISOString().slice(0, 10) + `T${time}.000Z`;

let tmp: string, lf: ReturnType<typeof Bun.serve>, stopApp: () => void, restoreEnv: () => void, appAt: (path: string) => Promise<Response>, down = false, hits = 0, asked: URL[] = [];
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
const traces = [
  { id: "t1", sessionId: "s1", metadata: { cwd: "/work/aleph" } },
  { id: "t2", sessionId: "s2", metadata: { cwd: "/work/other" } },
  { id: "t3", sessionId: "s1", metadata: { cwd: "/work/aleph" } },
  { id: "t4", sessionId: "s1", metadata: { cwd: "/work/aleph" } },
  { id: "t5", sessionId: "s3", metadata: { cwd: "/work/aleph" } },
  { id: "t6", sessionId: "s4", metadata: { cwd: "/tmp/agent-ae1db4a1e2c301339" } },
  { id: "t7", sessionId: "s5", metadata: {}, tags: ["project:aleph"] },
  { id: "t8", sessionId: "s6", metadata: {}, tags: ["project:agent-ae1db4a1e2c301339"] },
];

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "aleph-ui-skills-"));
  mkdirSync(join(tmp, "skills", "pickup"), { recursive: true });
  mkdirSync(join(tmp, "skills", "retro"), { recursive: true });
  mkdirSync(join(tmp, "skills", "dormant"), { recursive: true });
  for (const s of ["pickup", "retro", "dormant"]) writeFileSync(join(tmp, "skills", s, "SKILL.md"), `# ${s}\n`);
  writeFileSync(join(tmp, "repos.json"), JSON.stringify({ aleph: { path: "/work/aleph" }, other: { path: "/work/other" } }));
  lf = Bun.serve({
    port: 0,
    fetch(req) {
      hits++;
      if (down) return new Response("down", { status: 503 });
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
  stopApp(); lf.stop(true);
  restoreEnv();
});
beforeEach(() => { clearCache(); rmSync(join(tmp, "store.json"), { force: true }); down = false; asked = []; });

const get = async (p: string) => { const r = await (/^\/api\/skills(\?|$)/.test(p) ? listSkills(new Request(`http://localhost${p}`)) : appAt(p)); return { status: r.status, body: r.headers.get("content-type")?.includes("json") ? await r.json() as any : await r.text() }; };

test("?project= that is no registry key is no filter", async () => {
  expect((await get("/api/skills?project=junk")).body.skills).toEqual((await get("/api/skills")).body.skills);
});

test("a 502 goes out only after every request of the failed fetch has ended", async () => {
  let inflight = 0, requests = 0;
  const slow = Bun.serve({
    port: 0,
    async fetch(req) {
      requests++;
      if (new URL(req.url).searchParams.get("type") === "AGENT") return new Response("down", { status: 503 });
      inflight++;
      await Bun.sleep(100);
      inflight--;
      return new Response("down", { status: 503 });
    },
  });
  const before = process.env.LANGFUSE_BASE_URL;
  process.env.LANGFUSE_BASE_URL = `http://127.0.0.1:${slow.port}`;
  try {
    expect((await get("/api/skills")).status).toBe(502);
    // Each request is held 100 ms by the server: one still open when the 502 went out would show here.
    expect(inflight).toBe(0);
  } finally {
    slow.stop(true);
    process.env.LANGFUSE_BASE_URL = before;
  }
});

test("after a restart, a reload fetches only the rows of the last two hours and keeps the older ones", async () => {
  await get("/api/skills");
  clearCache(); // as a restart: the rows are on disk only
  asked = [];
  const { status, body } = await get("/api/skills");
  expect(status).toBe(200);
  const from = Date.parse(asked.find((u) => u.pathname === "/api/public/observations")!.searchParams.get("fromStartTime")!);
  expect(Date.now() - from).toBeLessThan(2 * 3600_000 + 60_000);
  expect(Date.now() - from).toBeGreaterThan(2 * 3600_000 - 60_000);
  expect(body.skills.find((s: any) => s.name === "aleph:pickup")).toMatchObject({ uses: 2, errors: 1 }); // t2 is two days old
});





test("pages are fetched concurrently, and serve() warms the skills and /api/agents caches so the first requests hit Langfuse zero times", async () => {
  // Overlap is counted per list: the two lists run side by side even when each one pages serially.
  const active: Record<string, number> = {}, peak: Record<string, number> = {};
  let calls = 0, all = 0;
  const paged = Bun.serve({
    port: 0,
    async fetch(req) {
      const u = new URL(req.url);
      if (u.pathname.startsWith("/api/public/")) all++;
      // Other warm-ups (memory's `vault misses` subprocess) reach this mock too: only the skills lists count.
      // The Agents warm-up reads the 7-day window through the same lists: only the 30-day reads count.
      const from = Date.parse(u.searchParams.get("fromStartTime") ?? u.searchParams.get("fromTimestamp") ?? "");
      const mine = (u.pathname === "/api/public/traces" || ["AGENT", "TOOL"].includes(u.searchParams.get("type") ?? "")) && from < Date.now() - 10 * 86400_000;
      if (mine) { calls++; active[u.pathname] = (active[u.pathname] ?? 0) + 1; peak[u.pathname] = Math.max(peak[u.pathname] ?? 0, active[u.pathname]); }
      await Bun.sleep(40);
      if (mine) active[u.pathname]--;
      const page = Number(u.searchParams.get("page") ?? 1);
      const data = u.pathname === "/api/public/observations" && page === 1 ? observations.filter((o) => Date.parse(o.startTime) >= Date.now() - 30 * 86400_000) : [];
      return Response.json({ data: u.pathname === "/api/public/traces" && page === 1 ? traces : data, meta: { totalPages: 4 } });
    },
  });
  const restoreEnv = withEnv({ LANGFUSE_BASE_URL: `http://127.0.0.1:${paged.port}` });
  clearCache();
  const { server: warmed, at, stop } = await withServer();
  try {
    await warmed.warmed["skills.ts"]; // the end of the skills warm-up, not a clock
    expect(calls).toBe(12); // 3 lists x 4 pages
    expect(peak["/api/public/traces"]).toBeGreaterThan(1);
    expect(peak["/api/public/observations"]).toBeGreaterThan(1);
    const seen = calls;
    const r = await listSkills(new Request("http://localhost/api/skills"));
    expect(r.status).toBe(200);
    expect(((await r.json()) as any).skills.length).toBeGreaterThan(0);
    expect(calls).toBe(seen);
    // The Agents page: every warm-up done, so none reads during the count.
    await Promise.all(Object.values(warmed.warmed));
    const allSeen = all;
    const a = await at("/api/agents?days=7");
    expect(a.status).toBe(200);
    const b = await a.json() as any;
    for (const k of ["activity", "skills", "sessions", "toolSessions"]) expect(b[k]).toBeDefined();
    expect(b.skills.error).toBeUndefined();
    expect(b.sessions.error).toBeUndefined();
    expect(all).toBe(allSeen);
  } finally {
    stop(); paged.stop(true);
    restoreEnv();
  }
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
  for (const t of ["<h2>Uses per Day</h2>", "<th>First Prompt Line</th>", "<th>Started by</th>", "<th>Time</th><th>Session</th><th>First Prompt Line</th>", "<h2>Tools Called After It, in the Same Turn</h2>", 'aria-label="Uses per day"', 'aria-label="Tools called after it, in the same turn"']) expect(detail).toContain(t);
  expect(detail).not.toContain("<h3>");
  expect(detail).not.toContain("<style");
});
