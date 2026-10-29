import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { parseFacts, writeFact, kindOf, parseVerdicts, type Verdict } from "./facts.ts";

test("sourced FACT lines give facts with their sources", () => {
  const r = parseFacts("done\nFACT: bun test runs everything [source: package.json:7]\nFACT: the gate lives in gate.ts [source: abc1234]\nFACT: docs [source: https://example.com/a]");
  expect(r.facts).toEqual([
    { fact: "bun test runs everything", source: "package.json:7" },
    { fact: "the gate lives in gate.ts", source: "abc1234" },
    { fact: "docs", source: "https://example.com/a" },
  ]);
  expect(r.unsourced).toEqual([]);
});

test("a FACT line without a source, or with a bad one, is unsourced", () => {
  const r = parseFacts("FACT: no source here\nFACT: empty [source: ]\nFACT: vague [source: I remember it]");
  expect(r.facts).toEqual([]);
  expect(r.unsourced).toHaveLength(3);
});

test("no FACT lines gives empty lists; DEFAULT and FOLLOWUP are not facts", () => {
  expect(parseFacts("summary")).toEqual({ facts: [], unsourced: [] });
  expect(parseFacts("DEFAULT: q -> a [source: x.ts]\nFOLLOWUP: t [source: x.ts]")).toEqual({ facts: [], unsourced: [] });
});

import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reviewFacts } from "./facts.ts";

const FACTS = [{ fact: "alpha holds", source: "a.txt:1" }, { fact: "beta holds", source: "b.txt" }];
async function review(script: string) {
  const dir = mkdtempSync(join(tmpdir(), "facts-"));
  const jobs = join(dir, "jobs"), repo = join(dir, "repo"), bin = join(dir, "fake.sh"), seen = join(dir, "stdin.txt");
  Bun.spawnSync(["git", "init", "-q", repo]);
  writeFileSync(bin, `#!/bin/sh\ncat > ${seen}\n${script}\n`);
  chmodSync(bin, 0o755);
  const old = { j: process.env.ALEPH_JOBS_DIR, c: process.env.ALEPH_FACTS_CMD };
  process.env.ALEPH_JOBS_DIR = jobs; process.env.ALEPH_FACTS_CMD = bin;
  try {
    const landed: any = { id: "x", folder: "x", run: { kind: "land", job: "job-1", name: "demo-7", repo: "demo", todo: 7, state: "landed", told: true, started: "" } };
    const r = await reviewFacts({ key: "demo", path: repo, main: "main" } as any, landed, FACTS, "abc1234");
    const state = JSON.parse(readFileSync(join(r.folder, "state.json"), "utf8"));
    return { r, state, stdin: existsSync(seen) ? readFileSync(seen, "utf8") : "" };
  } finally {
    process.env.ALEPH_JOBS_DIR = old.j; process.env.ALEPH_FACTS_CMD = old.c;
    if (old.j === undefined) delete process.env.ALEPH_JOBS_DIR;
    if (old.c === undefined) delete process.env.ALEPH_FACTS_CMD;
  }
}
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { dispatchGoals } from "./factory.ts";

test("reviewFacts keeps one fact and rejects one", async () => {
  const reply = JSON.stringify({ verdicts: [{ fact: "alpha holds", verdict: "keep", reason: "a.txt says so", scope: "demo", title: "Alpha Holds" }, { fact: "beta holds", verdict: "reject", reason: "b.txt says otherwise", scope: "global", title: "Beta" }] });
  const { r, state, stdin } = await review(`echo '${reply}'`);
  expect(r.verdicts.map((v) => [v.verdict, v.reason, v.source])).toEqual([["keep", "a.txt says so", "a.txt:1"], ["reject", "b.txt says otherwise", "b.txt"]]);
  for (const s of ["alpha holds", "a.txt:1", "beta holds", "b.txt", "abc1234"]) expect(stdin).toContain(s);
  expect(state).toMatchObject({ kind: "facts", state: "done", shown: false, job: "job-1", reason: "kept 1, rejected 1", model: "claude-opus-5-5" });
});

test("a reply with no JSON fails the run and rejects every fact", async () => {
  const { r, state } = await review("echo nothing useful");
  expect(state.state).toBe("done");
  expect(state.reason).toStartWith("failed: malformed verdicts");
  expect(r.verdicts.map((v) => v.verdict)).toEqual(["reject", "reject"]);
});

test("a wrong count is malformed", async () => {
  const { state } = await review(`echo '{"verdicts":[{"fact":"alpha holds","verdict":"keep","reason":"ok"}]}'`);
  expect(state.reason).toStartWith("failed: malformed verdicts");
});

test("a command that exits 1 ends the run failed", async () => {
  const { r, state } = await review("exit 1");
  expect(state.reason).toStartWith("failed:");
  expect(r.verdicts.every((v) => v.verdict === "reject")).toBe(true);
});

describe("writeFact", () => {
  let base: string, vault: string, server: ReturnType<typeof Bun.serve>, answer = 0.9;
  const git = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  const saved: Record<string, string | undefined> = {};
  const set = (k: string, val: string) => { saved[k] = process.env[k]; process.env[k] = val; };
  const verdict = (title: string, over: Partial<Verdict> = {}): Verdict => ({ fact: `${title} behaves oddly`, source: "src/a.ts:3", verdict: "keep", reason: "a.ts shows it", scope: "screen", title, ...over });
  const files = () => Bun.spawnSync(["bash", "-c", `cd ${vault} && find wiki -type f | sort`], { stdout: "pipe" }).stdout.toString();

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), "facts-vault-"));
    vault = join(base, "vault");
    for (const [k, val] of Object.entries(git)) set(k, val);
    set("ALEPH_VAULT", vault); set("ALEPH_JUDGE", "haiku");
    expect(Bun.spawnSync(["bun", join(import.meta.dir, "..", "..", "vault", "cli.ts"), "init"], { env: process.env }).exitCode).toBe(0);
    server = Bun.serve({ port: 0, async fetch(req) {
      const body: any = await req.json();
      const answers = Object.fromEntries(Object.keys(body.questions).map((k) => [k, { type: "noul", noul: answer }]));
      return Response.json({ answers, model: "m", usage: { cost: 0 } });
    } });
    set("ALEPH_JEV_URL", `http://127.0.0.1:${server.port}/`); set("OPENROUTER_API_KEY", "k");
    set("CLAUDE_CODE_SESSION_ID", "leaky");
  });
  afterAll(() => {
    server.stop(true);
    for (const [k, val] of Object.entries(saved)) { if (val === undefined) delete process.env[k]; else process.env[k] = val; }
    rmSync(base, { recursive: true, force: true });
  });

  test("a kept fact lands under wiki/gotchas, stamped factory, with no session", async () => {
    process.env.ALEPH_JUDGE = "haiku";
    const r = await writeFact(verdict("Zebra Quirk"), "job-9", "gotcha");
    expect(r).toEqual({ written: true, path: "wiki/gotchas/Zebra Quirk.md" });
    const text = readFileSync(join(vault, "wiki", "gotchas", "Zebra Quirk.md"), "utf8");
    expect(text).toContain("written_by: factory");
    expect(text).toMatch(/sources: \[src\/a\.ts:3, job:job-9\]/);
    expect(text).not.toContain("session:");
    expect(text).toContain("confidence: reported");
  });
  test("a concept goes to wiki/concepts", async () => {
    const r = await writeFact(verdict("Yak Model"), "job-9", kindOf(verdict("Yak Model", { kind: "concept" })));
    expect(r).toMatchObject({ written: true });
    expect(existsSync(join(vault, "wiki", "concepts", "Yak Model.md"))).toBe(true);
  });
  test("the contradiction screen refusal is a rejection naming the note", async () => {
    expect((await writeFact(verdict("Widget Registry"), "j", "gotcha")).written).toBe(true);
    process.env.ALEPH_JUDGE = "jev"; answer = 0.9;
    const before = files();
    const r = await writeFact(verdict("Widget Registry Rules"), "j", "gotcha");
    process.env.ALEPH_JUDGE = "haiku";
    expect(r.written).toBe(false);
    expect((r as any).reason).toContain("Widget Registry");
    expect((r as any).reason).not.toContain("\n");
    expect(files()).toBe(before);
  });
  test("a title the vault already holds is rejected", async () => {
    const r = await writeFact(verdict("Zebra Quirk", { fact: "different claim" }), "job-10", "gotcha");
    expect(r.written).toBe(false);
    expect(readFileSync(join(vault, "wiki", "gotchas", "Zebra Quirk.md"), "utf8")).toContain("Zebra Quirk behaves oddly");
  });
  test("kindOf and the parser's kind field", () => {
    expect(kindOf(verdict("A", { scope: "concept" }))).toBe("concept");
    expect(kindOf(verdict("A"))).toBe("gotcha");
    const p = parseVerdicts('{"verdicts":[{"fact":"f","verdict":"keep","reason":"r","kind":"concept"}]}');
    expect((p as Verdict[])[0].kind).toBe("concept");
  });
});

describe("factsGate through the dispatch", () => {
  const saved: Record<string, string | undefined> = {};
  const set = (k: string, val: string) => { saved[k] = process.env[k]; process.env[k] = val; };
  let base: string, vault: string, jobs: string, server: ReturnType<typeof Bun.serve>, answer = 0;

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), "facts-gate-"));
    vault = join(base, "vault"); jobs = join(base, "jobs");
    const repo = join(base, "repo");
    Bun.spawnSync(["git", "init", "-q", repo]);
    writeFileSync(join(base, "repos.json"), JSON.stringify({ fac: { path: repo, sandbox: true, autoland: false } }));
    for (const [k, val] of Object.entries({ GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" })) set(k, val);
    set("ALEPH_VAULT", vault); set("ALEPH_JUDGE", "jev"); set("ALEPH_JOBS_DIR", jobs); set("ALEPH_REPOS", join(base, "repos.json"));
    set("ALEPH_FACTORY_DIR", join(base, "factory")); set("XDG_RUNTIME_DIR", join(base, "run")); set("ALEPH_ITEMS", join(base, "items"));
    expect(Bun.spawnSync(["bun", join(import.meta.dir, "..", "..", "vault", "cli.ts"), "init"], { env: { ...process.env, ALEPH_JUDGE: "haiku" } }).exitCode).toBe(0);
    server = Bun.serve({ port: 0, async fetch(req) {
      const body: any = await req.json();
      const answers = Object.fromEntries(Object.keys(body.questions).map((k) => [k, { type: "noul", noul: answer }]));
      return Response.json({ answers, model: "m", usage: { cost: 0 } });
    } });
    set("ALEPH_JEV_URL", `http://127.0.0.1:${server.port}/`); set("OPENROUTER_API_KEY", "k");
  });
  afterAll(() => {
    server.stop(true);
    for (const [k, val] of Object.entries(saved)) { if (val === undefined) delete process.env[k]; else process.env[k] = val; }
    rmSync(base, { recursive: true, force: true });
  });

  /** A landed job: a worker run with `result`, then its land. */
  function landed(name: string, result: string): void {
    const id = `20261028-0000${name.slice(-2)}-${name}`;
    const w = join(jobs, id);
    mkdirSync(w, { recursive: true });
    const base = { job: id, name, repo: "fac", told: true, shown: true };
    writeFileSync(join(w, "state.json"), JSON.stringify({ ...base, kind: "agent", state: "passed", started: "2026-10-28T00:00:00Z" }));
    writeFileSync(join(w, "result.md"), result);
    const l = join(jobs, `${id}-land`);
    mkdirSync(l, { recursive: true });
    writeFileSync(join(l, "state.json"), JSON.stringify({ ...base, kind: "land", state: "landed", commit: "abc1234def", started: "2026-10-28T00:01:00Z" }));
  }
  const factsRuns = () => (existsSync(jobs) ? readdirSync(jobs).filter((f) => f.endsWith("-facts")) : []);
  const reviewer = (reply: object) => {
    const bin = join(base, "fake.sh"), seen = join(base, "stdin.txt");
    writeFileSync(bin, `#!/bin/sh\ncat > ${seen}\necho '${JSON.stringify(reply)}'\n`);
    chmodSync(bin, 0o755);
    process.env.ALEPH_FACTS_CMD = bin;
    return seen;
  };
  const log = () => readFileSync(join(base, "factory", "tick.log"), "utf8");

  test("a kept fact is written, an unsourced one dropped, a rejected one logged, a contradiction rejected; a second dispatch adds no run", async () => {
    landed("gate-01", "done\nFACT: lemons float [source: src/a.ts:1]\nFACT: no source at all\nFACT: pears sink [source: src/b.ts]\n");
    const seen = reviewer({ verdicts: [
      { fact: "lemons float", verdict: "keep", reason: "a.ts shows it", scope: "fac", title: "Lemons Float" },
      { fact: "pears sink", verdict: "reject", reason: "b.ts says otherwise", scope: "fac", title: "Pears" },
    ] });
    await dispatchGoals((() => { throw new Error("no start"); }) as any);
    const note = readFileSync(join(vault, "wiki", "gotchas", "Lemons Float.md"), "utf8");
    expect(note).toContain("written_by: factory");
    expect(note).toMatch(/sources: \[src\/a\.ts:1, /);
    const runs = factsRuns();
    expect(runs).toHaveLength(1);
    const state = JSON.parse(readFileSync(join(jobs, runs[0], "state.json"), "utf8"));
    expect(state.kept).toEqual(["Lemons Float"]);
    expect(state.rejected).toEqual([{ fact: "pears sink", reason: "b.ts says otherwise" }]);
    expect(readFileSync(seen, "utf8")).not.toContain("no source at all");
    expect(log()).toContain("gate-01: fact dropped, no source: no source at all");
    expect(log()).toContain("gate-01: fact rejected (b.ts says otherwise): pears sink");
    expect(existsSync(join(vault, "wiki", "gotchas", "Pears.md"))).toBe(false);
    await dispatchGoals((() => { throw new Error("no start"); }) as any);
    expect(factsRuns()).toHaveLength(1);
  });

  test("a kept fact the Jev screen marks as a contradiction is rejected", async () => {
    // A first note the screen can compare with.
    expect((await writeFact({ fact: "Widgets exist", source: "src/w.ts", verdict: "keep", reason: "w.ts", scope: "fac", title: "Widget Registry" }, "j", "gotcha")).written).toBe(true);
    answer = 0.9;
    landed("gate-02", "FACT: widgets are not registered [source: src/w.ts:2]\n");
    reviewer({ verdicts: [{ fact: "widgets are not registered", verdict: "keep", reason: "w.ts shows it", scope: "fac", title: "Widget Registry Rules" }] });
    await dispatchGoals((() => { throw new Error("no start"); }) as any);
    answer = 0;
    expect(existsSync(join(vault, "wiki", "gotchas", "Widget Registry Rules.md"))).toBe(false);
    const run = factsRuns().map((f) => JSON.parse(readFileSync(join(jobs, f, "state.json"), "utf8"))).find((s) => s.name === "facts-gate-02");
    expect(run.kept).toEqual([]);
    expect(run.rejected[0].fact).toContain("widgets are not registered");
    expect(run.rejected[0].reason).toContain("may contradict");
  });

  test("a landed job with no FACT lines makes no facts run", async () => {
    const before = factsRuns().length;
    landed("gate-03", "done, nothing learned\n");
    await dispatchGoals((() => { throw new Error("no start"); }) as any);
    expect(factsRuns()).toHaveLength(before);
  });

  test("a job with only unsourced FACT lines is gated once and marked", async () => {
    const before = factsRuns().length;
    landed("gate-04", "FACT: nothing to cite\nFACT: still nothing [source: not a source!]\n");
    const count = () => log().split("\n").filter((l) => l.includes("gate-04: fact dropped, no source")).length;
    await dispatchGoals((() => { throw new Error("no start"); }) as any);
    expect(count()).toBe(2);
    await dispatchGoals((() => { throw new Error("no start"); }) as any);
    expect(count()).toBe(2);
    expect(factsRuns()).toHaveLength(before);
    const land = JSON.parse(readFileSync(join(jobs, "20261028-000004-gate-04-land", "state.json"), "utf8"));
    expect(land.facts).toBe(true);
    expect(land.state).toBe("landed");
  });

  test("a job with no FACT lines gets the marker; a sourced one gets one run over two dispatches", async () => {
    const before = factsRuns().length;
    landed("gate-05", "nothing\n");
    landed("gate-06", "FACT: ok [source: src/a.ts:1]\n");
    reviewer({ verdicts: [{ fact: "ok", verdict: "reject", reason: "no", scope: "fac", title: "Ok" }] });
    await dispatchGoals((() => { throw new Error("no start"); }) as any);
    await dispatchGoals((() => { throw new Error("no start"); }) as any);
    expect(factsRuns()).toHaveLength(before + 1);
    for (const n of ["000005-gate-05", "000006-gate-06"]) {
      const land = JSON.parse(readFileSync(join(jobs, `20261028-${n}-land`, "state.json"), "utf8"));
      expect(land.facts).toBe(true);
      expect(land.state).toBe("landed");
    }
  });
});
