import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { labels as itemLabels, readList } from "../../todo/lib/store.ts";
import { approve, decline, mine, proposals } from "./corrections.ts";

const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
function sh(cwd: string, ...args: string[]): void {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
}

const NOW = Date.parse("2026-10-28T12:00:00Z");
const ago = (days: number) => new Date(NOW - days * 86400_000).toISOString();

let base: string;
let lf: ReturnType<typeof Bun.serve>;
let jev: ReturnType<typeof Bun.serve>;
let traces: any[];
let observations: any[];
let noul = 0.9;
let choice = "new";
let pickFirst = false;
let checkP = 0.9;
let ruleP = 0.1;
let traceFrom: string | null = null;
const KEYS = ["ALEPH_FACTORY_DIR", "ALEPH_JOBS_DIR", "LANGFUSE_BASE_URL", "LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY", "ALEPH_JEV_URL", "OPENROUTER_API_KEY", "HOME", "ALEPH_ITEMS", "ALEPH_REPOS", "ALEPH_PROPOSE_AT", ...Object.keys(gitEnv)];
let saved: Record<string, string | undefined>;

beforeAll(() => {
  lf = Bun.serve({
    port: 0,
    fetch(req) {
      const u = new URL(req.url);
      if (u.pathname === "/api/public/traces") { traceFrom = u.searchParams.get("fromTimestamp"); return Response.json({ data: traces, meta: { totalPages: 1 } }); }
      if (u.pathname === "/api/public/observations") return Response.json({ data: observations, meta: { totalPages: 1 } });
      return new Response("no", { status: 404 });
    },
  });
  jev = Bun.serve({
    port: 0,
    async fetch(req) {
      const { questions } = (await req.json()) as any;
      const answers: any = {};
      if (questions.correction) answers.correction = { type: "noul", noul };
      if (questions.check) answers.check = { type: "noul", noul: checkP };
      if (questions.rule) answers.rule = { type: "noul", noul: ruleP };
      if (questions.lesson) answers.lesson = { type: "choice", choice: pickFirst ? Object.keys(questions.lesson.criteria).find((k) => k !== "new") : choice };
      return Response.json({ answers, usage: { cost: 0 } });
    },
  });
});
afterAll(() => { lf.stop(true); jev.stop(true); });

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-corr-"));
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  Object.assign(process.env, gitEnv, {
    ALEPH_FACTORY_DIR: join(base, "factory"), ALEPH_JOBS_DIR: join(base, "jobs"), HOME: base,
    LANGFUSE_BASE_URL: `http://127.0.0.1:${lf.port}`, LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk",
    ALEPH_ITEMS: join(base, "items"), ALEPH_REPOS: join(base, "repos.json"),
    ALEPH_JEV_URL: `http://127.0.0.1:${jev.port}/`, OPENROUTER_API_KEY: "k",
  });
  mkdirSync(join(base, "jobs"), { recursive: true });
  sh(base, "git", "init", "-q", "--bare", "-b", "main", join(base, "items.git"));
  sh(base, "git", "clone", "-q", join(base, "items.git"), join(base, "items"));
  sh(join(base, "items"), "git", "commit", "-q", "--allow-empty", "-m", "start");
  sh(join(base, "items"), "git", "push", "-q", "origin", "main");
  checkP = 0.9; ruleP = 0.1; delete process.env.ALEPH_PROPOSE_AT;
  noul = 0.9; choice = "new"; pickFirst = false; traceFrom = null;
  traces = [
    { id: "t1", sessionId: "s", timestamp: ago(3), input: "start", output: "I did the thing." },
    { id: "t2", sessionId: "s", timestamp: ago(2), input: "No, that is wrong. Do not mock the db.", output: "ok" },
  ];
  observations = [{ id: "o1", traceId: "t1", name: "verify-gate", metadata: { verdict: "deny" }, output: "deny: no run backs tests pass", startTime: ago(1) }];
  const run = (state: string, reason: string) => ({ kind: "agent", job: "aleph-9", name: "aleph-9", state, reason, told: true, started: ago(1), ended: ago(1) });
  const dir = join(base, "jobs", "20261027-aleph-9");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "state.json"), JSON.stringify(run("dropped", "Drops the test it changed.")));
});
afterEach(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  rmSync(base, { recursive: true, force: true });
});

const stored = () => JSON.parse(readFileSync(join(base, "factory", "corrections.json"), "utf8"));

test("three signals Jev groups make one lesson of count 3", async () => {
  // Jev picks the first listed lesson for every signal after the first.
  pickFirst = true;
  await mine(NOW);
  const l = stored().lessons;
  expect(l.length).toBe(1);
  expect(l[0].count).toBe(3);
  expect(l[0].signals.map((x: any) => x.source)).toEqual(["chris", "gate", "drop"]);
  expect(l[0].id).toMatch(/^l-[0-9a-f]{8}$/);
  expect(l[0].signals[0].link).toBe(`http://127.0.0.1:${lf.port}/trace/t2`);
});

test("signals Jev splits make lessons of count 1", async () => {
  await mine(NOW);
  const s = stored();
  expect(s.lessons.map((l: any) => l.count)).toEqual([1, 1, 1]);
  expect(s.lessons[0].sentence).toBe("No, that is wrong.");
});

test("a message Jev answers below 0.7 is not a signal", async () => {
  noul = 0.69;
  await mine(NOW);
  expect(stored().lessons.flatMap((l: any) => l.signals.map((x: any) => x.source)).sort()).toEqual(["drop", "gate"]);
});

test("a second mine with the same data adds no signal", async () => {
  await mine(NOW);
  await mine(NOW + 1000);
  expect(stored().lessons.reduce((n: number, l: any) => n + l.count, 0)).toBe(3);
});

test("a trace older than 14 days is not read", async () => {
  traces = [
    { id: "t0", sessionId: "s", timestamp: ago(20), input: "start", output: "x" },
    { id: "t9", sessionId: "s", timestamp: ago(15), input: "No, wrong.", output: "y" },
  ];
  await mine(NOW);
  expect(traceFrom).toBe(ago(14));
  expect(stored().lessons.flatMap((l: any) => l.signals.map((x: any) => x.id))).not.toContain("t9");
});

const repo = { key: "fac" };

test("three signals in one lesson make one proposal of kind check", async () => {
  pickFirst = true;
  await mine(NOW);
  expect(proposals().length).toBe(1);
  expect(proposals()[0].kind).toBe("check");
  expect(proposals()[0].state).toBe("proposed");
});

test("the kind falls to claude-md, then skill", async () => {
  pickFirst = true; checkP = 0.4; ruleP = 0.5;
  await mine(NOW);
  expect(proposals()[0].kind).toBe("claude-md");
  rmSync(join(base, "factory", "corrections.json"));
  ruleP = 0.49;
  await mine(NOW);
  expect(proposals()[0].kind).toBe("skill");
});

test("two signals make no proposal; ALEPH_PROPOSE_AT=2 makes one", async () => {
  pickFirst = true;
  noul = 0.1;
  await mine(NOW);
  expect(stored().lessons[0].count).toBe(2);
  expect(proposals().length).toBe(0);
  process.env.ALEPH_PROPOSE_AT = "2";
  await mine(NOW + 1000);
  expect(proposals().length).toBe(1);
});

test("approve files one goal issue quoting all signals", async () => {
  pickFirst = true;
  await mine(NOW);
  const id = proposals()[0].id;
  const ref = approve(id, repo);
  expect(ref).toBe("fac-1");
  const items = readList(repo)!.items;
  expect(items.length).toBe(1);
  expect(itemLabels(items[0])).toEqual(["goal", "memory"]);
  expect(items[0].title).toStartWith("Add a check: ");
  expect(items[0].body).toContain("Add a check");
  for (const s of stored().lessons[0].signals) expect(items[0].body).toContain(`- ${s.at} ${s.source}: "${s.quote}" (${s.link})`);
  expect(stored().lessons[0]).toMatchObject({ state: "approved", issue: "fac-1" });
  expect(proposals().length).toBe(0);
  expect(approve(id, repo)).toContain("approved");
});

test("decline is for good; a fourth signal joins but makes no proposal; approve refuses", async () => {
  pickFirst = true;
  await mine(NOW);
  const id = proposals()[0].id;
  expect(decline(id)).toBe("");
  expect(stored().lessons[0].state).toBe("declined");
  expect(stored().lessons[0].declinedAt).toBeTruthy();
  traces.push({ id: "t4", sessionId: "s", timestamp: ago(0.4), input: "No, still wrong.", output: "w" });
  await mine(NOW + 1000);
  expect(stored().lessons[0].count).toBe(4);
  expect(stored().lessons[0].state).toBe("declined");
  expect(proposals().length).toBe(0);
  expect(approve(id, repo)).toContain("declined");
  expect(decline(id)).toContain("declined");
});

describe("standing proposals", () => {
  const grant = (action: string) => {
    mkdirSync(join(base, "factory"), { recursive: true });
    writeFileSync(join(base, "factory", "standing.json"), JSON.stringify({ "proposal-check": { action, at: new Date().toISOString() } }));
    writeFileSync(join(base, "repos.json"), JSON.stringify({ fac: { path: base, sandbox: true } }));
  };

  test("approve files the goal at once", async () => {
    grant("approve");
    pickFirst = true;
    await mine(NOW);
    expect(stored().lessons[0]).toMatchObject({ state: "approved", issue: "fac-1" });
    expect(readList(repo)!.items.length).toBe(1);
    expect(readFileSync(join(base, "factory", "tick.log"), "utf8")).toContain("standing: proposal-check: approve on fac-1");
  });

  test("decline marks it declined", async () => {
    grant("decline");
    pickFirst = true;
    await mine(NOW);
    expect(stored().lessons[0].state).toBe("declined");
    expect(readFileSync(join(base, "factory", "tick.log"), "utf8")).toContain("standing: proposal-check: decline on");
  });
});

test("an unknown id is a refusal, not a throw", () => {
  expect(approve("l-nope", repo)).toContain("no lesson");
  expect(decline("l-nope")).toContain("no lesson");
});
