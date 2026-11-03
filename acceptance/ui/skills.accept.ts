// Archived goal tests from ui/skills.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearCache, listSkills } from "../../ui/api/skills.ts";
import { withEnv, withServer } from "../../ui/test-server.ts";
// @ts-ignore plain JS, shared with the page
import * as v from "../../ui/views/skills.js";
// @ts-ignore
import { view as skillView } from "../../ui/views/skill.js";

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

test("a cwd that is no registry project is not listed as a project", async () => {
  const { body } = await get("/api/skills");
  expect(body.skills.find((s: any) => s.name === "aleph:sandbox")).toMatchObject({ uses: 1, projects: [] });
  expect(body.skills.flatMap((s: any) => s.projects)).not.toContain("agent-ae1db4a1e2c301339");
  expect(body.projects).toEqual(["aleph", "other"]);
});
