import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readList } from "../../../issues/lib/store.ts";
import { section, titleProblem } from "../../../issues/lib/todo.ts";
import { approve, explainLesson, mine, proposals, readStore } from "./corrections.ts";
import { missingSections } from "../roles/goal-spec.ts";
import { storeRepos } from "../../../tests/git-fixture.ts";
import { writeRun } from "../records/ledger.ts";

const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };

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
      if (u.pathname === "/api/public/traces") { return Response.json({ data: traces, meta: { totalPages: 1 } }); }
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
  storeRepos(base);
  const stub = join(base, "rule.sh");
  writeFileSync(stub, RULE_STUB, { mode: 0o755 });
  process.env.ALEPH_RULE_CMD = stub;
  generalP = 0.9; faultP = 0.9; scope = "global"; skillPick = "alpha";
  mkdirSync(join(base, "fac-repo", "skills", "alpha"), { recursive: true });
  writeFileSync(join(base, "fac-repo", "skills", "alpha", "SKILL.md"), "---\nname: alpha\ndescription: Does alpha things.\n---\n");
  writeFileSync(join(base, "repos.json"), JSON.stringify({ fac: { path: join(base, "fac-repo"), sandbox: true } }));
  checkP = 0.9; ruleP = 0.1; delete process.env.ALEPH_PROPOSE_AT;
  noul = 0.9; choice = "new"; pickFirst = false;
  traces = [
    { id: "t1", sessionId: "s", timestamp: ago(3), input: "start", output: "I did the thing." },
    { id: "t2", sessionId: "s", timestamp: ago(2), input: "No, that is wrong. Do not mock the db.", output: "ok" },
  ];
  observations = [{ id: "o1", traceId: "t1", name: "verify-gate", metadata: { verdict: "deny" }, output: "deny: no run backs tests pass", startTime: ago(1) }];
  const run = (state: string, reason: string) => ({ kind: "build", job: "aleph-9", name: "aleph-9", condition: state, reason, told: true, started: ago(1), ended: ago(1) });
  const dir = join(base, "jobs", "20261027-aleph-9");
  mkdirSync(dir, { recursive: true });
  writeRun(join(dir), run("dropped", "Drops the test it changed.") as any);
});
afterEach(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  rmSync(base, { recursive: true, force: true });
});

const stored = () => JSON.parse(readFileSync(join(base, "factory", "corrections.json"), "utf8"));

const repo = { key: "fac" };

test("the kind falls to claude-md, then skill", async () => {
  pickFirst = true; checkP = 0.4; ruleP = 0.5;
  await mine(NOW);
  expect(proposals()[0].kind).toBe("claude-md");
  rmSync(join(base, "factory", "corrections.json"));
  ruleP = 0.49;
  await mine(NOW);
  expect(proposals()[0].kind).toBe("skill");
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

test("an approved claude-md proposal files a spec with Goal, Edit surface and Oracle", async () => {
  pickFirst = true; checkP = 0.4; ruleP = 0.5; scope = "repo";
  await mine(NOW);
  const l = proposals()[0];
  expect(approve(l.id, repo)).toBe("fac-1");
  const [item] = readList(repo)!.items;
  expect(missingSections(item.spec)).toEqual([]);
  expect(section(item.spec, "Goal")).toContain(l.sentence);
  expect(section(item.spec, "Edit surface")).toBe("- CLAUDE.md");
  expect(section(item.spec, "Oracle")).toContain(`grep -F '${l.sentence}' CLAUDE.md`);
  expect(section(item.spec, "Oracle")).not.toContain("Signals:");
});

describe("standing proposals", () => {
  const grant = (action: string, key = "proposal-check:fac") => {
    mkdirSync(join(base, "factory"), { recursive: true });
    writeFileSync(join(base, "factory", "always.json"), JSON.stringify({ [key]: { action, at: new Date(NOW).toISOString() } }));
    writeFileSync(join(base, "repos.json"), JSON.stringify({ fac: { path: base, sandbox: true } }));
  };

  test("approve files the goal at once", async () => {
    grant("approve");
    pickFirst = true;
    await mine(NOW);
    expect(stored().lessons[0]).toMatchObject({ state: "approved", issue: "fac-1" });
    expect(readList(repo)!.items.length).toBe(1);
    const [item] = readList(repo)!.items;
    expect(item.fm.kind).toBe("proposal");
    expect(titleProblem(item.title)).toBeNull();
    expect(readFileSync(join(base, "factory", "tick.log"), "utf8")).toContain("always: proposal-check:fac: approve on fac-1");
  });

  test("decline marks it declined", async () => {
    grant("decline");
    pickFirst = true;
    await mine(NOW);
    expect(stored().lessons[0].state).toBe("declined");
    expect(readFileSync(join(base, "factory", "tick.log"), "utf8")).toContain("always: proposal-check:fac: decline on");
  });
});

describe("explainLesson", () => {
  const text = { situation: "S", effects: [{ action: "approve", text: "files it" }], recommend: { action: "approve", why: "clear" } };
  const path = () => join(base, "factory", "corrections.json");
  const seed = (state: string) => {
    mkdirSync(join(base, "factory"), { recursive: true });
    writeFileSync(path(), JSON.stringify({ minedAt: "", lessons: [{ id: "l-1", sentence: "Do x.", state, signals: [], count: 1 }] }, null, 2) + "\n");
  };

  test("a proposed lesson with the same sentence takes the text", () => {
    seed("proposed");
    expect(explainLesson("l-1", "Do x.", text)).toBe(true);
    expect(readStore().lessons[0]).toMatchObject(text);
    expect(proposals()[0]).toMatchObject(text);
  });

});

describe("noise", () => {
  const noise = ["<task-notification>done</task-notification>", "<agent-message from=x>hi</agent-message>", "<system-reminder>x</system-reminder>", "[From the bridge, not from Chris] hi", "<command-name>/x</command-name>"];

  test("notifications, hand-backs and bridge text make no signal", async () => {
    traces = [{ id: "t0", sessionId: "s", timestamp: ago(4), input: "start", output: "did it" }, ...noise.map((input, i) => ({ id: `n${i}`, sessionId: "s", timestamp: ago(3 - i / 10), input, output: "ok" }))];
    await mine(NOW);
    expect(stored().lessons.flatMap((l: any) => l.signals.map((x: any) => x.source)).sort()).toEqual(["drop", "gate"]);
  });

  test("a drop whose run made no commit is not a signal, whatever Jev says", async () => {
    const dir = join(base, "jobs", "20261027-aleph-9");
    writeRun(join(dir), { kind: "build", job: "aleph-9", name: "aleph-9", condition: "dropped", reason: "the work is on main; this run found nothing to commit", noCommit: true, told: true, started: ago(1), ended: ago(1) } as any);
    await mine(NOW);
    expect(stored().lessons.flatMap((l: any) => l.signals.map((x: any) => x.source)).sort()).toEqual(["chris", "gate"]);
  });
});
