import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defaultClaims, docProblems, flagsIn, normalize, type Doc, type Truth } from "./doc-claims.ts";
import * as s from "./settings.ts";
import { stallSeconds } from "./sandbox.ts";
import { JEV_PASS_BELOW } from "../../hooks/lib/judge.ts";

const ROOT = resolve(import.meta.dir, "..", "..");

/** The docs the check reads: README.md and docs/*.md. Specs and findings are records of their day, not claims about main. */
const docs = (): Doc[] => ["README.md", ...readdirSync(join(ROOT, "docs")).filter((f) => f.endsWith(".md")).map((f) => `docs/${f}`)]
  .map((file) => ({ file, text: readFileSync(join(ROOT, file), "utf8") }));

const tracked = (patterns: string[]): string[] => patterns.flatMap((p) => [...new Bun.Glob(p).scanSync({ cwd: ROOT })]).filter((f) => !f.includes("node_modules"));
const read = (files: string[]) => files.map((f) => readFileSync(join(ROOT, f), "utf8")).join("\n");

/** Runs `fn` with `name` unset and `extra` set, then puts the environment back. */
function bare<T>(name: string, fn: () => T, extra: Record<string, string> = {}): T {
  const keys = [name, ...Object.keys(extra)];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  delete process.env[name];
  Object.assign(process.env, extra);
  try { return fn(); } finally {
    for (const k of keys) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
}

let factory = "";
const capped = (name: string, fn: () => number) => () => bare(name, fn, { ALEPH_FACTORY_DIR: factory });
const plain = (name: string, fn: () => string | number) => () => bare(name, fn);

/** Each setting a doc may give a default for, read from the code with its variable unset. */
const DEFAULTS: Truth["defaults"] = {
  ALEPH_DAY_CAP: capped("ALEPH_DAY_CAP", s.DAY_CAP),
  ALEPH_LIVE_CAP: capped("ALEPH_LIVE_CAP", s.LIVE_CAP),
  ALEPH_AWAITING_CAP: capped("ALEPH_AWAITING_CAP", s.AWAITING_CAP),
  ALEPH_EXPLAIN_CAP: plain("ALEPH_EXPLAIN_CAP", s.EXPLAIN_CAP),
  ALEPH_EXPLAIN_TRIES: plain("ALEPH_EXPLAIN_TRIES", s.EXPLAIN_TRIES),
  ALEPH_ACCEPTANCE_FAIL_CAP: plain("ALEPH_ACCEPTANCE_FAIL_CAP", s.acceptanceFailCap),
  ALEPH_TRIAGE_CAP: plain("ALEPH_TRIAGE_CAP", s.TRIAGE_CAP),
  ALEPH_TRIAGE_TRIES: plain("ALEPH_TRIAGE_TRIES", s.TRIAGE_TRIES),
  ALEPH_PROPOSE_AT: plain("ALEPH_PROPOSE_AT", s.PROPOSE_AT),
  ALEPH_JOB_TIMEOUT: plain("ALEPH_JOB_TIMEOUT", s.jobSeconds),
  ALEPH_CHECK_TIMEOUT: plain("ALEPH_CHECK_TIMEOUT", s.checkSeconds),
  ALEPH_REVIEW_TIMEOUT: plain("ALEPH_REVIEW_TIMEOUT", s.reviewSeconds),
  ALEPH_REVIEW_DIFF_MAX: plain("ALEPH_REVIEW_DIFF_MAX", s.reviewDiffMax),
  ALEPH_STALL_SECONDS: plain("ALEPH_STALL_SECONDS", stallSeconds),
  ALEPH_FIX_ROUNDS: plain("ALEPH_FIX_ROUNDS", s.fixRounds),
  ALEPH_LAND_BATCH: plain("ALEPH_LAND_BATCH", s.landBatch),
  ALEPH_CHECK_SLOTS: plain("ALEPH_CHECK_SLOTS", s.checkSlots),
  ALEPH_UI_CACHE_TTL: plain("ALEPH_UI_CACHE_TTL", () => s.uiCacheMs() / 1000),
  ALEPH_WORKER_CMD: plain("ALEPH_WORKER_CMD", s.workerCmd),
  ALEPH_REVIEWER_CMD: () => bare("ALEPH_REVIEWER_CMD", () => s.reviewerCmd() === "worker-sentinel" ? "the worker command" : s.reviewerCmd(), { ALEPH_WORKER_CMD: "worker-sentinel" }),
  ALEPH_OUTDATED_CMD: plain("ALEPH_OUTDATED_CMD", s.outdatedCmd),
  ALEPH_JEV_PASS_BELOW: plain("ALEPH_JEV_PASS_BELOW", JEV_PASS_BELOW),
};

beforeAll(() => { factory = mkdtempSync(join(tmpdir(), "doc-claims-")); });
afterAll(() => rmSync(factory, { recursive: true, force: true }));

const truth = (): Truth => ({
  defaults: DEFAULTS,
  root: ROOT,
  source: read(tracked(["{hooks,jobs,todo,ui,vault,tests}/**/*.ts", "bin/*", "package.json", "compose/*", ".env.example"]).filter((f) => f !== "jobs/lib/doc-claims.test.ts")),
  cliSource: read(tracked(["{hooks,jobs,todo,ui,vault}/**/*.ts", "bin/*"]).filter((f) => !f.endsWith(".test.ts"))),
});

describe("the docs on this tree match the code", () => {
  test("every default, setting name, repo path and aleph flag in README.md and docs/*.md", () => {
    expect(docProblems(docs(), truth())).toEqual([]);
  });

  test("the check reads the settings table of docs/factory.md", () => {
    const names = new Set(defaultClaims(docs()).filter((c) => c.file === "docs/factory.md").map((c) => c.name));
    for (const n of ["ALEPH_JOB_TIMEOUT", "ALEPH_TRIAGE_CAP", "ALEPH_TRIAGE_TRIES", "ALEPH_STALL_SECONDS"]) expect(names).toContain(n);
  });
});

describe("a doc that does not match fails, quoting the claim", () => {
  const t = (): Truth => ({ ...truth(), defaults: { ALEPH_JOB_TIMEOUT: () => 1800, ALEPH_STALL_SECONDS: () => 600 } });

  test("a wrong default in a table row and in prose", () => {
    const p = docProblems([{ file: "docs/x.md", text: "| `ALEPH_JOB_TIMEOUT` | 1200 | Seconds |\nthe time box (`ALEPH_JOB_TIMEOUT`, 20 minutes)\n`ALEPH_STALL_SECONDS` (300)." }], t());
    expect(p).toHaveLength(3);
    expect(p[0]).toContain("docs/x.md:1");
    expect(p[0]).toContain("| `ALEPH_JOB_TIMEOUT` | 1200 |");
    expect(p[0]).toContain("the code has 1800");
    expect(p[1]).toContain("`ALEPH_JOB_TIMEOUT`, 20 minutes)");
    expect(p[2]).toContain("`ALEPH_STALL_SECONDS` (300)");
  });

  test("a matching default passes, in seconds or minutes", () => {
    expect(docProblems([{ file: "docs/x.md", text: "| `ALEPH_JOB_TIMEOUT` | 1800 | s |\n(`ALEPH_JOB_TIMEOUT`, 30 minutes)" }], t())).toEqual([]);
  });

  test("a default for a setting the check has no value for", () => {
    expect(docProblems([{ file: "docs/x.md", text: "`ALEPH_JOB_TIMEOUT` and `ALEPH_NEW_THING` (7)" }], t()).join("\n")).toContain("ALEPH_NEW_THING");
  });

  test("a setting name that no source file reads", () => {
    expect(docProblems([{ file: "docs/x.md", text: "Set `ALEPH_NO_SUCH_SETTING` to 1." }], t())).toEqual(["docs/x.md:1: ALEPH_NO_SUCH_SETTING is in no source file"]);
  });

  test("a repo path that does not exist", () => {
    expect(docProblems([{ file: "docs/x.md", text: "See `jobs/lib/no-such-file.ts` and `jobs/lib/settings.ts`." }], t())).toEqual(["docs/x.md:1: `jobs/lib/no-such-file.ts` does not exist"]);
  });

  test("a CLI flag that the code does not define, in a code span and in a code block", () => {
    const text = "Run `aleph status --no-such-flag`.\n```\necho x | aleph issue add aleph t --request -\naleph-ui --port 3020 --nor-this   # --not-a-flag in a comment\n```\n`docker compose --env-file .env`";
    expect(docProblems([{ file: "docs/x.md", text }], t())).toEqual([
      'docs/x.md:1: "aleph status --no-such-flag" uses --no-such-flag, which the CLI source does not define',
      'docs/x.md:4: "aleph-ui --port 3020 --nor-this" uses --nor-this, which the CLI source does not define',
    ]);
  });
});

test("normalize reads numbers, times and backticked words", () => {
  expect(normalize("1800")).toBe(1800);
  expect(normalize("200,000")).toBe(200000);
  expect(normalize("30 minutes")).toBe(1800);
  expect(normalize("`claude`")).toBe("claude");
  expect(normalize("the worker command")).toBe("the worker command");
});

test("flagsIn leaves out other commands", () => {
  expect(flagsIn([{ file: "d.md", text: "`docker compose -p aleph-langfuse --env-file .env`" }])).toEqual([]);
});
