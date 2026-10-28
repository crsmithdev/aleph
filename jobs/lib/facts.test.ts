import { expect, test } from "bun:test";
import { parseFacts } from "./facts.ts";

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

import { mkdtempSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
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
import { existsSync } from "node:fs";

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
