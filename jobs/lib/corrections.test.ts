import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readList } from "../../todo/lib/store.ts";
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
let generalP = 0.9;
let faultP = 0.9;
let scope = "global";
let skillPick = "alpha";
/** The sentence-writing stub echoes this prefix and the quote's first word. */
const RULE_STUB = "#!/bin/sh\nfor a; do :; done\nw=$(printf '%s' \"$a\" | tr -cd 'A-Za-z' | cut -c1-12)\nprintf '{\"result\":\"Follow rule %s.\"}' \"$w\"\n";
const KEYS = ["ALEPH_FACTORY_DIR", "ALEPH_JOBS_DIR", "LANGFUSE_BASE_URL", "LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY", "ALEPH_JEV_URL", "OPENROUTER_API_KEY", "HOME", "ALEPH_ISSUES", "ALEPH_REPOS", "ALEPH_PROPOSE_AT", "ALEPH_RULE_CMD", ...Object.keys(gitEnv)];
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
      if (questions.general) answers.general = { type: "noul", noul: generalP };
      if (questions.fault) answers.fault = { type: "noul", noul: faultP };
      if (questions.check) answers.check = { type: "noul", noul: checkP };
      if (questions.rule) answers.rule = { type: "noul", noul: ruleP };
      if (questions.scope) answers.scope = { type: "choice", choice: scope };
      if (questions.skill) answers.skill = { type: "choice", choice: skillPick };
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
    ALEPH_ISSUES: join(base, "items"), ALEPH_REPOS: join(base, "repos.json"),
    ALEPH_JEV_URL: `http://127.0.0.1:${jev.port}/`, OPENROUTER_API_KEY: "k",
  });
  mkdirSync(join(base, "jobs"), { recursive: true });
  sh(base, "git", "init", "-q", "--bare", "-b", "main", join(base, "items.git"));
  sh(base, "git", "clone", "-q", join(base, "items.git"), join(base, "items"));
  sh(join(base, "items"), "git", "commit", "-q", "--allow-empty", "-m", "start");
  sh(join(base, "items"), "git", "push", "-q", "origin", "main");
  const stub = join(base, "rule.sh");
  writeFileSync(stub, RULE_STUB, { mode: 0o755 });
  process.env.ALEPH_RULE_CMD = stub;
  generalP = 0.9; faultP = 0.9; scope = "global"; skillPick = "alpha";
  mkdirSync(join(base, "fac-repo", "skills", "alpha"), { recursive: true });
  writeFileSync(join(base, "fac-repo", "skills", "alpha", "SKILL.md"), "---\nname: alpha\ndescription: Does alpha things.\n---\n");
  writeFileSync(join(base, "repos.json"), JSON.stringify({ fac: { path: join(base, "fac-repo"), sandbox: true } }));
  checkP = 0.9; ruleP = 0.1; delete process.env.ALEPH_PROPOSE_AT;
  noul = 0.9; choice = "new"; pickFirst = false; traceFrom = null;
  traces = [
    { id: "t1", sessionId: "s", timestamp: ago(3), input: "start", output: "I did the thing." },
    { id: "t2", sessionId: "s", timestamp: ago(2), input: "No, that is wrong. Do not mock the db.", output: "ok" },
  ];
  observations = [{ id: "o1", traceId: "t1", name: "verify-gate", metadata: { verdict: "deny" }, output: "deny: no run backs tests pass", startTime: ago(1) }];
  const run = (state: string, reason: string) => ({ kind: "build", job: "aleph-9", name: "aleph-9", state, reason, told: true, started: ago(1), ended: ago(1) });
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
  expect(s.lessons[0].sentence).toBe("Follow rule Nothatiswron.");
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

test("every proposal has a title and a target by kind", async () => {
  pickFirst = true;
  await mine(NOW);
  let p = proposals()[0];
  expect(p.title!.length).toBeGreaterThanOrEqual(1);
  expect(p.title!.length).toBeLessThanOrEqual(60);
  expect(p.target).toBe("fac checks");
  checkP = 0.4; ruleP = 0.5;
  rmSync(join(base, "factory", "corrections.json"));
  await mine(NOW);
  expect(proposals()[0].target).toBe("identity/CLAUDE.md");
  scope = "repo";
  rmSync(join(base, "factory", "corrections.json"));
  await mine(NOW);
  expect(proposals()[0].target).toBe("fac/CLAUDE.md");
  ruleP = 0.1;
  rmSync(join(base, "factory", "corrections.json"));
  await mine(NOW);
  expect(proposals()[0].target).toBe("skills/alpha/SKILL.md");
});

test("with no sandboxed repo the lesson stays open", async () => {
  pickFirst = true;
  writeFileSync(join(base, "repos.json"), "{}");
  await mine(NOW);
  expect(proposals().length).toBe(0);
  expect(stored().lessons[0].state).toBe("open");
});

test("a proposed lesson without target gets title and target on the next mine", async () => {
  pickFirst = true;
  await mine(NOW);
  const s = stored();
  delete s.lessons[0].target; delete s.lessons[0].title;
  writeFileSync(join(base, "factory", "corrections.json"), JSON.stringify(s));
  await mine(NOW + 1000);
  expect(proposals()[0].target).toBe("fac checks");
  expect(proposals()[0].title!.length).toBeGreaterThan(0);
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
  // The issue and its goal `.1`, in the new shape.
  expect(items.map((i) => i.fm.id)).toEqual(["1", "1.1"]);
  expect(items[0].fm).toMatchObject({ kind: "issue", source: "memory", goals: ["fac-1.1"] });
  expect(items[1].fm).toMatchObject({ kind: "goal", issue: "fac-1" });
  expect(items[0].fm.labels).toBeUndefined();
  expect(items[0].title).toBe(stored().lessons[0].title);
  expect(items[0].body).toStartWith("## Request");
  expect(items[1].body).toContain("Add a check");
  expect(items[0].body).toContain("Target: fac checks");
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
  const grant = (action: string, key = "proposal-check:fac") => {
    mkdirSync(join(base, "factory"), { recursive: true });
    writeFileSync(join(base, "factory", "always.json"), JSON.stringify({ [key]: { action, at: new Date().toISOString() } }));
    writeFileSync(join(base, "repos.json"), JSON.stringify({ fac: { path: base, sandbox: true } }));
  };

  test("approve files the goal at once", async () => {
    grant("approve");
    pickFirst = true;
    await mine(NOW);
    expect(stored().lessons[0]).toMatchObject({ state: "approved", issue: "fac-1" });
    expect(readList(repo)!.items.length).toBe(2);
    expect(readFileSync(join(base, "factory", "tick.log"), "utf8")).toContain("always: proposal-check:fac: approve on fac-1");
  });

  test("the bare kind key no longer answers", async () => {
    grant("approve", "proposal-check");
    pickFirst = true;
    await mine(NOW);
    expect(stored().lessons[0].state).toBe("proposed");
  });

  test("decline marks it declined", async () => {
    grant("decline");
    pickFirst = true;
    await mine(NOW);
    expect(stored().lessons[0].state).toBe("declined");
    expect(readFileSync(join(base, "factory", "tick.log"), "utf8")).toContain("always: proposal-check:fac: decline on");
  });
});

test("an unknown id is a refusal, not a throw", () => {
  expect(approve("l-nope", repo)).toContain("no lesson");
  expect(decline("l-nope")).toContain("no lesson");
});

describe("noise", () => {
  const noise = ["<task-notification>done</task-notification>", "<agent-message from=x>hi</agent-message>", "<system-reminder>x</system-reminder>", "[From the bridge, not from Chris] hi", "<command-name>/x</command-name>"];

  test("notifications, hand-backs and bridge text make no signal", async () => {
    traces = [{ id: "t0", sessionId: "s", timestamp: ago(4), input: "start", output: "did it" }, ...noise.map((input, i) => ({ id: `n${i}`, sessionId: "s", timestamp: ago(3 - i / 10), input, output: "ok" }))];
    await mine(NOW);
    expect(stored().lessons.flatMap((l: any) => l.signals.map((x: any) => x.source)).sort()).toEqual(["drop", "gate"]);
  });

  test("factory worker sessions and traces make no signal", async () => {
    traces = [
      { id: "w1", name: "factory aleph-9", sessionId: "x", timestamp: ago(4), input: "start", output: "did it" },
      { id: "w2", name: "factory aleph-9", sessionId: "x", timestamp: ago(3), input: "No, wrong.", output: "ok" },
      { id: "j1", sessionId: "aleph-9", timestamp: ago(4), input: "start", output: "did it" },
      { id: "j2", sessionId: "aleph-9", timestamp: ago(3), input: "No, wrong.", output: "ok" },
    ];
    await mine(NOW);
    expect(stored().lessons.flatMap((l: any) => l.signals.map((x: any) => x.source)).sort()).toEqual(["drop", "gate"]);
  });

  test("a design request Jev finds no rule in is not a signal", async () => {
    generalP = 0.2;
    await mine(NOW);
    expect(stored().lessons.flatMap((l: any) => l.signals.map((x: any) => x.source)).sort()).toEqual(["drop", "gate"]);
  });

  test("a drop that is not a fault in the work is not a signal", async () => {
    faultP = 0.2;
    await mine(NOW);
    expect(stored().lessons.flatMap((l: any) => l.signals.map((x: any) => x.source)).sort()).toEqual(["chris", "gate"]);
  });

  test("a drop whose run made no commit is not a signal, whatever Jev says", async () => {
    const dir = join(base, "jobs", "20261027-aleph-9");
    writeFileSync(join(dir, "state.json"), JSON.stringify({ kind: "build", job: "aleph-9", name: "aleph-9", state: "dropped", reason: "the work is on main; this run found nothing to commit", noCommit: true, told: true, started: ago(1), ended: ago(1) }));
    await mine(NOW);
    expect(stored().lessons.flatMap((l: any) => l.signals.map((x: any) => x.source)).sort()).toEqual(["chris", "gate"]);
  });

  test("three pushbacks about one rule make one proposal with the imperative sentence", async () => {
    traces = [0, 1, 2].flatMap((i) => [
      { id: `a${i}`, sessionId: `s${i}`, timestamp: ago(5 - i * 2), input: "start", output: "All the checks pass." },
      { id: `b${i}`, sessionId: `s${i}`, timestamp: ago(4.9 - i * 2), input: `Run the checks again, you edited after they passed (${i}).`, output: "ok" },
    ]);
    observations = [];
    rmSync(join(base, "jobs"), { recursive: true });
    mkdirSync(join(base, "jobs"));
    pickFirst = true;
    await mine(NOW);
    expect(proposals().length).toBe(1);
    expect(proposals()[0].sentence).toBe("Follow rule Runthechecks.");
    expect(proposals()[0].count).toBe(3);
    expect(proposals()[0].signals[0].quote).toContain("Run the checks again");
  });
});
