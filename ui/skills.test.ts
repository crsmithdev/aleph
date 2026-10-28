import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearCache } from "./api/skills.ts";
import { serve } from "./server.ts";
// @ts-ignore plain JS, shared with the page
import * as v from "./views/skills.js";
// @ts-ignore
import { view as skillView } from "./views/skill.js";

const today = new Date().toISOString().slice(0, 10);
const daysAgo = (n: number, time = "10:00:00") => new Date(Date.parse(today) - n * 86400_000).toISOString().slice(0, 10) + `T${time}.000Z`;

let tmp: string, lf: ReturnType<typeof Bun.serve>, app: Awaited<ReturnType<typeof serve>>, down = false, hits = 0, asked: URL[] = [];
const saved: Record<string, string | undefined> = {};
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
];
const traces = [
  { id: "t1", sessionId: "s1", metadata: { cwd: "/work/aleph" } },
  { id: "t2", sessionId: "s2", metadata: { cwd: "/work/other" } },
  { id: "t3", sessionId: "s1", metadata: { cwd: "/work/aleph" } },
  { id: "t4", sessionId: "s1", metadata: { cwd: "/work/aleph" } },
  { id: "t5", sessionId: "s3", metadata: { cwd: "/work/aleph" } },
  { id: "t6", sessionId: "s4", metadata: { cwd: "/tmp/agent-ae1db4a1e2c301339" } },
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
  for (const [k, val] of Object.entries({ LANGFUSE_BASE_URL: `http://127.0.0.1:${lf.port}`, LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk", ALEPH_SKILLS_DIR: join(tmp, "skills"), ALEPH_SKILLS_STORE: join(tmp, "store.json"), ALEPH_REPOS: join(tmp, "repos.json") })) {
    saved[k] = process.env[k];
    process.env[k] = val;
  }
  app = await serve(0, { warm: false });
});
afterAll(() => {
  app.stop(true); lf.stop(true);
  for (const [k, val] of Object.entries(saved)) val === undefined ? delete process.env[k] : (process.env[k] = val);
});
beforeEach(() => { clearCache(); rmSync(join(tmp, "store.json"), { force: true }); down = false; asked = []; });

const get = async (p: string) => { const r = await fetch(`http://127.0.0.1:${app.port}${p}`); return { status: r.status, body: r.headers.get("content-type")?.includes("json") ? await r.json() as any : await r.text() }; };

test("a Skill tool call and a slash command each count as one use", async () => {
  const { status, body } = await get("/api/skills");
  expect(status).toBe(200);
  const pickup = body.skills.find((s: any) => s.name === "aleph:pickup");
  expect(pickup).toMatchObject({ uses: 2, byTool: 1, bySlash: 1, sessions: 2, projects: ["aleph", "other"], errors: 1 });
  expect(body.skills.find((s: any) => s.name === "aleph:retro").uses).toBe(1); // the one 40 days ago is out of the window
  expect(body.skills.map((s: any) => s.name)).not.toContain("clear");
});

test("uses per day are right", async () => {
  const { body } = await get("/api/skills");
  const perDay = body.skills.find((s: any) => s.name === "aleph:pickup").perDay;
  expect(perDay).toHaveLength(30);
  expect(perDay[29]).toBe(1);
  expect(perDay[27]).toBe(1);
  expect(perDay.reduce((a: number, b: number) => a + b, 0)).toBe(2);
  const wide = (await get("/api/skills?days=60")).body;
  expect(wide.skills.find((s: any) => s.name === "aleph:retro").uses).toBe(2);
});

test("the detail lists tools called after the skill in the same turn, sessions and errors", async () => {
  const { body } = await get("/api/skills/aleph:pickup");
  expect(body.tools).toEqual([{ tool: "Bash", count: 2 }, { tool: "Edit", count: 1 }, { tool: "Grep", count: 1 }]);
  expect(body.sessions.map((s: any) => [s.id, s.project, s.via, s.prompt])).toEqual([
    ["s1", "aleph", "tool", "pickup the work"],
    ["s2", "other", "slash", "/aleph:pickup"],
  ]);
  expect(body.projects).toEqual([{ project: "aleph", uses: 1 }, { project: "other", uses: 1 }]);
  expect(body.errors).toHaveLength(1);
  expect(body.errors[0]).toMatchObject({ session: "s1", project: "aleph", message: "no match" });
});

test("?project= keeps only that project's data", async () => {
  const list = (await get("/api/skills?project=other")).body;
  expect(list.skills.map((s: any) => [s.name, s.uses])).toEqual([["aleph:pickup", 1]]);
  expect(list.skills[0].errors).toBe(0);
  const one = (await get("/api/skills/aleph:pickup?project=aleph")).body;
  expect(one.sessions.map((s: any) => s.id)).toEqual(["s1"]);
  expect(one.projects).toEqual([{ project: "aleph", uses: 1 }]);
  expect(one.tools.map((t: any) => t.tool)).not.toContain("Grep");
});

test("a skill from the skills folder with no use is listed as unused", async () => {
  const { body } = await get("/api/skills");
  expect(body.unused).toEqual(["dormant"]);
  expect(v.renderSkills(body)).toContain("dormant");
  expect((await get("/api/skills/dormant")).body.uses).toBe(0);
  expect((await get("/api/skills/nothing")).status).toBe(404);
});

test("answers are cached for 30 seconds", async () => {
  await get("/api/skills");
  const before = hits;
  await get("/api/skills");
  expect(hits).toBe(before);
});

test("Langfuse down gives a 502", async () => {
  down = true;
  const r = await get("/api/skills");
  expect(r.status).toBe(502);
  expect(r.body.error).toContain("Langfuse");
  expect((await get("/api/skills/aleph:pickup")).status).toBe(502);
});

test("only turns and tool calls are fetched, and traces without their input and output", async () => {
  await get("/api/skills");
  const obs = asked.filter((u) => u.pathname === "/api/public/observations").map((u) => u.searchParams.get("type")).sort();
  expect(obs).toEqual(["AGENT", "TOOL"]);
  expect(asked.find((u) => u.pathname === "/api/public/traces")!.searchParams.get("fields")).toBe("core");
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

test("a failed reload serves the last good rows, with their age and the error", async () => {
  await get("/api/skills");
  clearCache();
  down = true;
  const { status, body } = await get("/api/skills");
  expect(status).toBe(200);
  expect(body.failed).toContain("503");
  expect(Date.now() - Date.parse(body.asOf)).toBeLessThan(60_000);
  expect(body.skills.find((s: any) => s.name === "aleph:pickup").uses).toBe(2);
  expect(v.renderSkills(body)).toContain("Langfuse failed: ");
  expect(v.staleNote({ failed: "timed out", asOf: "2026-10-28T07:00:00Z" }, new Date("2026-10-28T09:05:00Z"))).toContain("(2 h 5 min ago)");
  expect(v.staleNote({ asOf: "2026-10-28T07:00:00Z" })).toBe("");
  expect((await get("/api/skills/aleph:pickup")).body.failed).toContain("503");
});

test("pages are fetched four at a time", async () => {
  let active = 0, peak = 0, calls = 0;
  const paged = Bun.serve({
    port: 0,
    async fetch(req) {
      const u = new URL(req.url);
      if (u.pathname !== "/api/public/observations" || u.searchParams.get("type") !== "TOOL") return Response.json({ data: [], meta: { totalPages: 1 } });
      calls++; active++; peak = Math.max(peak, active);
      await Bun.sleep(20);
      active--;
      return Response.json({ data: [], meta: { totalPages: 12 } });
    },
  });
  const before = process.env.LANGFUSE_BASE_URL;
  process.env.LANGFUSE_BASE_URL = `http://127.0.0.1:${paged.port}`;
  try {
    expect((await get("/api/skills")).status).toBe(200);
    expect(calls).toBe(12);
    expect(peak).toBe(4);
  } finally {
    paged.stop(true);
    process.env.LANGFUSE_BASE_URL = before;
  }
});

test("the view lists skills with bars and links, and the detail links sessions", async () => {
  const { body } = await get("/api/skills");
  const html = v.renderSkills(body);
  expect(html).toContain('href="#/skills/aleph%3Apickup"');
  expect(html).toContain('class="perday"');
  expect(html).not.toContain("<svg");
  expect(html).toContain('data-sort="last"');
  const detail = v.renderSkill((await get("/api/skills/aleph:pickup")).body);
  expect(detail).toContain('href="#/sessions/s1"');
  expect(detail).toContain("Bash");
  expect(v.view).toMatchObject({ path: "/skills", group: "claude" });
  expect((v.view as any).api({}, new URLSearchParams("days=7&project=aleph&x=1"))).toBe("/api/skills?days=7&project=aleph");
  expect((v.view as any).api({}, new URLSearchParams())).toBe("/api/skills");
  expect(skillView).toMatchObject({ path: "/skills/:name", api: "/api/skills/:name" });
});

test("text is escaped and an empty window shows the empty state", () => {
  expect(v.renderSkills({ days: 30, skills: [], unused: [] })).toContain("No skill");
  const html = v.renderSkills({ days: 30, unused: ["<b>x</b>"], skills: [] });
  expect(html).not.toContain("<b>x");
});

test("the skills table scrolls inside its own wrapper", async () => {
  const html = v.renderSkills((await get("/api/skills")).body);
  expect(html).toContain('class="tscroll" style="overflow-x:auto;max-width:100%"><table class="tbl');
});

test("perDayOption has one bar per day with its count, dated from since", () => {
  const o = v.perDayOption([0, 3, 1], "2026-10-25");
  expect(o.xAxis.data).toEqual(["2026-10-25", "2026-10-26", "2026-10-27"]);
  expect(o.series[0].data).toEqual([0, 3, 1]);
  expect(o.tooltip.formatter({ name: "2026-10-26", value: 3 })).toBe("2026-10-26<br>3 uses");
  expect(JSON.stringify(o)).not.toMatch(/#[0-9a-f]{3,6}|rgb/i);
  expect(typeof v.view.mount).toBe("function");
  expect(typeof skillView.mount).toBe("function");
});

test("pages are fetched concurrently, and serve() warms the cache so the first request hits Langfuse zero times", async () => {
  // Overlap is counted per list: the two lists run side by side even when each one pages serially.
  const active: Record<string, number> = {}, peak: Record<string, number> = {};
  let calls = 0;
  const paged = Bun.serve({
    port: 0,
    async fetch(req) {
      const u = new URL(req.url);
      calls++; active[u.pathname] = (active[u.pathname] ?? 0) + 1;
      peak[u.pathname] = Math.max(peak[u.pathname] ?? 0, active[u.pathname]);
      await Bun.sleep(40);
      active[u.pathname]--;
      const page = Number(u.searchParams.get("page") ?? 1);
      const data = u.pathname === "/api/public/observations" && page === 1 ? observations.filter((o) => Date.parse(o.startTime) >= Date.now() - 30 * 86400_000) : [];
      return Response.json({ data: u.pathname === "/api/public/traces" && page === 1 ? traces : data, meta: { totalPages: 4 } });
    },
  });
  const before = process.env.LANGFUSE_BASE_URL;
  process.env.LANGFUSE_BASE_URL = `http://127.0.0.1:${paged.port}`;
  clearCache();
  const warmed = await serve(0);
  try {
    for (let i = 0; i < 100 && calls < 12; i++) await Bun.sleep(20); // 3 lists x 4 pages
    await Bun.sleep(200);
    expect(peak["/api/public/traces"]).toBeGreaterThan(1);
    expect(peak["/api/public/observations"]).toBeGreaterThan(1);
    const seen = calls;
    const r = await fetch(`http://127.0.0.1:${warmed.port}/api/skills`);
    expect(r.status).toBe(200);
    expect(((await r.json()) as any).skills.length).toBeGreaterThan(0);
    expect(calls).toBe(seen);
  } finally {
    warmed.stop(true); paged.stop(true);
    process.env.LANGFUSE_BASE_URL = before;
  }
});

const mk = (name: string, uses: number, lastUsed: string) => ({ name, uses, bySlash: uses, byTool: 0, sessions: 1, projects: ["p"], lastUsed, errors: 0, perDay: [uses] });
const three = { days: 30, since: "2026-01-01", skills: [mk("b", 2, "2026-01-02T00:00:00Z"), mk("a", 2, "2026-01-05T00:00:00Z"), mk("c", 9, "2026-01-02T00:00:00Z")], unused: ["zz"] };

test("renderSkills draws one chart mount per used skill", () => {
  const html = v.renderSkills(three);
  expect(html.match(/class="perday" role="img"[^>]*data-skill/g)?.length).toBe(3);
});

test("sortSkills orders by uses or by last used, ties by name", () => {
  expect(v.sortSkills(three.skills, "uses").map((s: any) => s.name)).toEqual(["c", "a", "b"]);
  expect(v.sortSkills(three.skills, "last").map((s: any) => s.name)).toEqual(["a", "b", "c"]);
  expect(v.sortSkills(three.skills, { key: "name", dir: 1 }).map((s: any) => s.name)).toEqual(["a", "b", "c"]);
  expect(v.sortSkills(three.skills, { key: "uses", dir: 1 }).map((s: any) => s.name)).toEqual(["a", "b", "c"]);
});

test("a skills row has one number for uses, three projects at most, and a when time", () => {
  const html = v.renderSkills({ ...three, skills: [{ ...mk("a", 4, "2026-01-05T00:00:00Z"), bySlash: 3, byTool: 1, projects: ["p1", "p2", "p3", "p4", "p5"], errors: 2 }] });
  expect(html).toContain('title="3 slash, 1 tool">4</td>');
  expect(html).toContain('title="p1, p2, p3, p4, p5">p1, p2, p3 +2</td>');
  expect(html).toContain('class="badge');
  expect(html).toContain("Jan 05");
  expect(html).not.toContain("Sort by");
});

test("unused skills are listed once, after the used ones", () => {
  const html = v.renderSkills(three);
  expect(html.match(/class="unused"/g)?.length).toBe(1);
  expect(html.indexOf('class="unused"')).toBeGreaterThan(html.lastIndexOf('data-name="b"'));
});

test("a cwd that is no registry project is not listed as a project", async () => {
  const { body } = await get("/api/skills");
  expect(body.skills.find((s: any) => s.name === "aleph:sandbox")).toMatchObject({ uses: 1, projects: [] });
  expect(body.skills.flatMap((s: any) => s.projects)).not.toContain("agent-ae1db4a1e2c301339");
  expect(body.projects).toEqual(["aleph", "other"]);
});

test("the page has a Project and a Window filter, and the columns run text first, then counts", () => {
  const html = v.renderSkills({ ...three, projects: ["a", "b"] }, { days: "7", project: "b" });
  expect(html).toContain('class="fbar"');
  expect(html).toContain('data-value="b" aria-pressed="true"');
  expect(html).toContain('data-name="days"');
  expect(html).toMatch(/data-value="7" aria-pressed="true"/);
  const heads = [...html.match(/<thead>[\s\S]*?<\/thead>/)![0].matchAll(/<th[^>]*>(?:<button[^>]*>)?([A-Za-z ]+)/g)].map((m) => m[1]);
  expect(heads).toEqual(["Skill", "Projects", "Uses", "Sessions", "Errors", "Per day", "Last used"]);
});
