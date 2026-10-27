import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeList } from "../todo/lib/store.ts";
import { add, setStatus } from "../todo/lib/todo.ts";
import { today } from "../todo/lib/todo.ts";
import { activity, clearCache, routes, summary } from "./api/activity.ts";
// @ts-ignore activity.js is plain JS, shared with the page
import { chartOption, renderActivity, view } from "./views/activity.js";

let obsHits = 0;
let base: string, jobsDir: string, fake: ReturnType<typeof Bun.serve>;
const saved: Record<string, string | undefined> = {};
const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
function sh(cwd: string, ...args: string[]): string {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
  return p.stdout.toString().trim();
}

const real = new Date();
const now = new Date(real.getFullYear(), real.getMonth(), real.getDate(), 23, 0, 0);
const at = (daysAgo: number, hour = 10) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, hour).toISOString();
const dayKey = (daysAgo: number) => today(new Date(at(daysAgo)));
function run(id: string, extra: Record<string, unknown>) {
  const dir = join(jobsDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "state.json"), JSON.stringify({ kind: "agent", told: true, started: at(0), ...extra }));
}

const gen = (day: number, model: string, cost: number, trace: string) => ({ id: `g${Math.random()}`, traceId: trace, type: "GENERATION", name: model, model, startTime: at(day), calculatedTotalCost: cost });
const tool = (day: number, name: string, trace: string, level = "DEFAULT") => ({ id: `t${Math.random()}`, traceId: trace, type: "TOOL", name, level, startTime: at(day), metadata: { tool: name } });
const span = (day: number, name: string, trace: string, metadata: object = {}, level = "DEFAULT", output = "") => ({ id: `s${Math.random()}`, traceId: trace, type: "SPAN", name, level, startTime: at(day), metadata, output });
const observations = [
  gen(0, "claude-opus-5-5", 0.25, "ta"), gen(0, "claude-haiku-5-5", 0.05, "tb"), gen(1, "claude-opus-5-5", 0.5, "ta"),
  tool(0, "Bash", "ta"), tool(0, "Bash", "ta", "ERROR"), tool(1, "Read", "ta"), tool(0, "Edit", "tb"), tool(0, "skill:goal", "ta"),
  span(0, "verify-gate", "ta", { verdict: "deny" }, "DEFAULT", "deny: nothing was run"),
  span(0, "verify-gate", "tb", { verdict: "pass" }),
  span(1, "vault-recall", "ta", {}, "ERROR"),
];
const traces = [{ id: "ta", name: "fac", metadata: { cwd: "/x/fac" } }, { id: "tb", name: "other", metadata: { cwd: "/x/other" } }];

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-ui-act-"));
  jobsDir = join(base, "jobs");
  mkdirSync(jobsDir);
  const remote = join(base, "fac.git"), repo = join(base, "fac");
  sh(base, "git", "init", "-q", "--bare", "-b", "main", remote);
  sh(base, "git", "clone", "-q", remote, repo);
  sh(repo, "git", "commit", "-q", "--allow-empty", "-m", "one");
  sh(repo, "git", "commit", "-q", "--allow-empty", "-m", "two");
  sh(repo, "git", "push", "-q", "origin", "main");
  const itemsRemote = join(base, "items.git"), items = join(base, "items");
  sh(base, "git", "init", "-q", "--bare", "-b", "main", itemsRemote);
  sh(base, "git", "clone", "-q", itemsRemote, items);
  sh(items, "git", "commit", "-q", "--allow-empty", "-m", "start");
  sh(items, "git", "push", "-q", "origin", "main");
  writeFileSync(join(base, "repos.json"), JSON.stringify({ fac: { path: repo, sandbox: true, checks: [] }, other: { path: join(base, "none"), sandbox: true, checks: [] } }));

  fake = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (!req.headers.get("authorization")?.startsWith("Basic ")) return new Response("no", { status: 401 });
      if (url.pathname === "/api/public/observations") obsHits++;
      if (url.pathname === "/api/public/observations") return Response.json({ data: observations, meta: { totalPages: 1 } });
      if (url.pathname === "/api/public/traces") return Response.json({ data: traces, meta: { totalPages: 1 } });
      return new Response("not found", { status: 404 });
    },
  });
  for (const [k, v] of Object.entries({
    ALEPH_JOBS_DIR: jobsDir, ALEPH_REPOS: join(base, "repos.json"), ALEPH_ITEMS: items,
    LANGFUSE_BASE_URL: `http://127.0.0.1:${fake.port}`, LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk",
  })) { saved[k] = process.env[k]; process.env[k] = v; }
  Object.assign(process.env, gitEnv);

  writeList({ key: "fac" }, "seed", (doc) => {
    add(doc, "done one"); add(doc, "still open");
    setStatus(doc.items[0], "done", new Date(at(1)));
    return true;
  }, true);

  run("20261027-000001-a", { job: "fac-1", name: "fac-1", repo: "fac", state: "landed", started: at(1), ended: at(1, 11), cost: 1.5 });
  run("20261027-000002-a", { job: "fac-2", name: "fac-2", repo: "fac", state: "needs-you", started: at(0), cost: 0.25 });
  run("20261027-000003-a", { job: "other-1", name: "other-1", repo: "other", state: "landed", started: at(0), ended: at(0, 12), cost: 2 });
});
afterAll(() => {
  fake.stop(true);
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  rmSync(base, { recursive: true, force: true });
});

describe("activity", () => {
  test("counts tools and their errors, leaving skills to their own view", async () => {
    const a = await activity(7, null, now);
    expect(a.langfuse).toBe("ok");
    expect(a.tools).toEqual([{ name: "Bash", calls: 2, errors: 1 }, { name: "Edit", calls: 1, errors: 0 }, { name: "Read", calls: 1, errors: 0 }]);
  });

  test("cost per day sums the generations, per model too", async () => {
    const a = await activity(7, null, now);
    expect(a.cost).toHaveLength(7);
    expect(a.cost.at(-1)).toEqual({ day: dayKey(0), cost: 0.3 });
    expect(a.cost.at(-2)!.cost).toBe(0.5);
    expect(a.models.map((m) => [m.model, m.calls, +m.cost.toFixed(2)])).toEqual([["claude-opus-5-5", 2, 0.75], ["claude-haiku-5-5", 1, 0.05]]);
  });

  test("hook runs with errors, and the verify-gate denials", async () => {
    const a = await activity(7, null, now);
    expect(a.hooks).toEqual([{ name: "verify-gate", calls: 2, errors: 0 }, { name: "vault-recall", calls: 1, errors: 1 }]);
    expect(a.denials.total).toBe(1);
    expect(a.denials.recent[0].reason).toBe("nothing was run");
  });

  test("factory runs per day with their cost", async () => {
    const a = await activity(7, null, now);
    expect(a.runs.at(-1)).toEqual({ day: dayKey(0), runs: 2, cost: 2.25 });
    expect(a.runs.at(-2)).toEqual({ day: dayKey(1), runs: 1, cost: 1.5 });
  });

  test("?project keeps one project's traces and runs", async () => {
    const a = await activity(7, "fac", now);
    expect(a.tools.find((t) => t.name === "Edit")).toBeUndefined();
    expect(a.cost.at(-1)!.cost).toBe(0.25);
    expect(a.runs.at(-1)).toEqual({ day: dayKey(0), runs: 1, cost: 0.25 });
    const o = await activity(7, "other", now);
    expect(o.tools.map((t) => t.name)).toEqual(["Edit"]);
    expect(o.runs.at(-1)!.runs).toBe(1);
  });

  test("a second request within ALEPH_UI_CACHE_TTL does not reach Langfuse; after it, one does", async () => {
    const saveTtl = process.env.ALEPH_UI_CACHE_TTL;
    process.env.ALEPH_UI_CACHE_TTL = "0.3";
    clearCache();
    try {
      obsHits = 0;
      const a = await activity(7, null, now);
      const b = await activity(7, null, now);
      expect(obsHits).toBe(1);
      expect(b.cachedAt).toBe(a.cachedAt);
      expect(b.tools).toEqual(a.tools);
      await Bun.sleep(400);
      const c = await activity(7, null, now);
      expect(obsHits).toBe(2);
      expect(c.cachedAt).not.toBe(a.cachedAt);
      await activity(7, "fac", now);
      expect(obsHits).toBe(3);
    } finally {
      if (saveTtl === undefined) delete process.env.ALEPH_UI_CACHE_TTL; else process.env.ALEPH_UI_CACHE_TTL = saveTtl;
      clearCache();
    }
  });

  test("without Langfuse keys the ledger half still answers", async () => {
    const k = process.env.LANGFUSE_PUBLIC_KEY;
    process.env.LANGFUSE_PUBLIC_KEY = "";
    try {
      const a = await activity(7, null, now);
      expect(a.langfuse).toBe("off");
      expect(a.runs.at(-1)!.runs).toBe(2);
    } finally { process.env.LANGFUSE_PUBLIC_KEY = k; }
  });
});

describe("summary", () => {
  test("counts a landed job on its day, items done, commits and runs", () => {
    const s = summary(30, null, now);
    expect(s.days).toHaveLength(30);
    const y = s.days.find((d) => d.day === dayKey(1))!, t = s.days.at(-1)!;
    expect(y).toMatchObject({ goals: 1, items: 1, runs: 1, cost: 1.5 });
    expect(t).toMatchObject({ goals: 1, items: 0, runs: 2, cost: 2.25 });
    expect(s.days.reduce((a, d) => a + d.commits, 0)).toBe(2);
  });

  test("?project keeps one project", () => {
    const s = summary(30, "other", now);
    expect(s.days.at(-1)).toMatchObject({ goals: 1, items: 0, commits: 0, runs: 1 });
    expect(summary(30, "fac", now).days.at(-1)).toMatchObject({ goals: 0, runs: 1 });
  });
});

describe("routes and view", () => {
  test("the routes take days and project", async () => {
    const a: any = await (await routes["GET /api/activity"](new Request("http://x/api/activity"), {}, new URL("http://x/api/activity?days=3&project=fac"))).json();
    expect(a.days).toHaveLength(3);
    const s: any = await (routes["GET /api/summary"](new Request("http://x/"), {}, new URL("http://x/api/summary?project=other")) as Response).json();
    expect(s.days).toHaveLength(30);
    expect(s.days.at(-1).goals).toBe(1);
  });

  test("the chart has one bar per day, themed by the page tokens", async () => {
    const a = await activity(7, null, now);
    const html = renderActivity({ activity: a, summary: summary(30, null, now) });
    expect(html).toContain('class="chart"');
    expect(html).not.toContain("<svg");
    const opt = chartOption(a.cost);
    expect(opt.xAxis.data).toEqual(a.cost.map((c: any) => c.day));
    expect(opt.series[0].data).toEqual(a.cost.map((c: any) => c.cost));
    expect(opt.series[0].data).toHaveLength(7);
    expect(JSON.stringify(opt)).not.toMatch(/#[0-9a-f]{3,6}|rgb/i);
    expect(opt.tooltip.formatter({ name: "2026-10-27", value: 1.5 })).toBe("2026-10-27<br>$1.5000");
    for (const t of ["Last 30 days", "claude-opus-5-5", "Bash", "verify-gate", "nothing was run", "Factory runs per day"]) expect(html).toContain(t);
    expect(view.group).toBe("activity");
  });

  test("mount draws the option through chart() with the theme's series colour", async () => {
    const a = await activity(7, null, now);
    const calls: any = {};
    const g: any = globalThis;
    const saved = { echarts: g.echarts, matchMedia: g.matchMedia, ResizeObserver: g.ResizeObserver, document: g.document, getComputedStyle: g.getComputedStyle };
    g.document = { documentElement: {} };
    g.getComputedStyle = () => ({ getPropertyValue: (k: string) => `tok${k}` });
    g.echarts = { registerTheme: (_n: string, t: any) => (calls.theme = t), init: () => ({ setOption: (o: any) => (calls.option = o), getOption: () => calls.option, dispose() {}, resize() {} }) };
    g.matchMedia = () => ({ addEventListener() {}, removeEventListener() {} });
    g.ResizeObserver = class { observe() {} disconnect() {} };
    try {
      const el = {};
      view.mount({ querySelector: () => el }, { activity: a, summary: {} });
      expect(calls.option.series[0].data).toHaveLength(7);
      expect(calls.theme.color.slice(0, 4)).toEqual(["tok--run", "tok--done", "tok--need", "tok--stuck"]);
      expect(calls.theme.color).toHaveLength(6);
    } finally { Object.assign(g, saved); }
  });

  test("a view with no Langfuse says so, and text is escaped", () => {
    const a = { days: ["2026-10-27"], langfuse: "off", cost: [{ day: "2026-10-27", cost: 0 }], models: [], tools: [], hooks: [], denials: { total: 0, recent: [] }, runs: [{ day: "<b>", runs: 0, cost: 0 }] };
    const html = renderActivity({ activity: a, summary: { days: [] } });
    expect(html).toContain("Langfuse is not configured");
    expect(html).toContain("&lt;b&gt;");
  });
});
