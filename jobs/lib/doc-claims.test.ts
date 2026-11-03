import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultClaims, docProblems, flagsIn, importsOf, normalize, type Truth } from "./doc-claims.ts";
import { DEFAULTS, docClaimsReport, repoDocs, repoProblems, repoTruth, ROOT } from "./doc-claims-repo.ts";

describe("the docs on this tree match the code", () => {
  test("every default, setting name, repo path, file:line, symbol, import claim and aleph flag in the docs", () => {
    expect(repoProblems()).toEqual([]);
  });

  test("the check reads the settings table of docs/factory.md and the defaults in its prose", () => {
    const claims = defaultClaims(repoDocs()).filter((c) => c.file === "docs/factory.md");
    const names = new Set(claims.map((c) => c.name));
    for (const n of ["ALEPH_JOB_TIMEOUT", "ALEPH_TRIAGE_CAP", "ALEPH_TRIAGE_TRIES", "ALEPH_STALL_SECONDS"]) expect(names).toContain(n);
    expect(claims.some((c) => c.quote === "`ALEPH_TRIAGE_CAP` (5)")).toBe(true);
    expect(claims.some((c) => c.quote === "`ALEPH_JOB_TIMEOUT`, 30 minutes)")).toBe(true);
  });

  test("the check reads README.md, docs/*.md and llms.txt, not the dated specs and findings", () => {
    const files = repoDocs().map((d) => d.file);
    expect(files).toContain("README.md");
    expect(files).toContain("docs/factory.md");
    expect(files).toContain("llms.txt");
    expect(files.some((f) => f.startsWith("docs/specs/") || f.startsWith("docs/findings/"))).toBe(false);
  });
});

describe("a doc that does not match fails, quoting the claim", () => {
  const t = (): Truth => ({ ...repoTruth(), defaults: { ALEPH_JOB_TIMEOUT: () => 1800, ALEPH_STALL_SECONDS: () => 600, ALEPH_UI_PORT: () => "3020" } });
  const one = (text: string) => docProblems([{ file: "docs/x.md", text }], t());

  test("a wrong default in a table row and in prose", () => {
    const p = one("| `ALEPH_JOB_TIMEOUT` | 1200 | Seconds |\nthe time box (`ALEPH_JOB_TIMEOUT`, 20 minutes)\n`ALEPH_STALL_SECONDS` (300).\nthe stall default `ALEPH_STALL_SECONDS` (900 s)\nthe port is ALEPH_UI_PORT, else 3000");
    expect(p).toHaveLength(5);
    expect(p[0]).toContain("docs/x.md:1");
    expect(p[0]).toContain("| `ALEPH_JOB_TIMEOUT` | 1200 |");
    expect(p[0]).toContain("the code has 1800");
    expect(p[1]).toContain("`ALEPH_JOB_TIMEOUT`, 20 minutes)");
    expect(p[2]).toContain("`ALEPH_STALL_SECONDS` (300)");
    expect(p[3]).toContain("`ALEPH_STALL_SECONDS` (900 s)");
    expect(p[3]).toContain("the code has 600");
    expect(p[4]).toBe('docs/x.md:5: "ALEPH_UI_PORT, else 3000" says ALEPH_UI_PORT defaults to 3000, the code has 3020');
  });

  test("a matching default passes, in seconds or minutes", () => {
    expect(one("| `ALEPH_JOB_TIMEOUT` | 1800 | s |\n(`ALEPH_JOB_TIMEOUT`, 30 minutes)\n`ALEPH_STALL_SECONDS` (600 s), ALEPH_UI_PORT, else 3020")).toEqual([]);
  });

  test("a default for a setting the check has no value for", () => {
    expect(one("`ALEPH_JOB_TIMEOUT` and `ALEPH_NEW_THING` (7)").join("\n")).toContain("ALEPH_NEW_THING");
  });

  test("a setting name that no source file reads", () => {
    expect(one("Set `ALEPH_NO_SUCH_SETTING` to 1.")).toEqual(["docs/x.md:1: ALEPH_NO_SUCH_SETTING is in no source file"]);
  });

  test("a repo path that does not exist, in backticks, in a relative link and in a link to the repo", () => {
    expect(one("See `jobs/lib/no-such-file.ts` and `jobs/lib/settings.ts`.\n[f](factory.md) [g](gone.md#top) [h](https://github.com/crsmithdev/aleph/blob/main/docs/gone2.md)")).toEqual([
      "docs/x.md:1: `jobs/lib/no-such-file.ts` does not exist",
      "docs/x.md:2: `docs/gone.md` does not exist",
      "docs/x.md:2: `docs/gone2.md` does not exist",
    ]);
  });

  test("a file:line past the end of the file, or a bare name no file has", () => {
    expect(one("`jobs/lib/settings.ts:99999`, `settings.ts:1`, `jobs/lib/settings.ts:2-3`, `nosuchfile.ts:5`")).toEqual([
      expect.stringMatching(/^docs\/x\.md:1: "`jobs\/lib\/settings\.ts:99999`" cites line 99999 of jobs\/lib\/settings\.ts, which has \d+ lines$/),
      'docs/x.md:1: "`nosuchfile.ts:5`" names no file of the repo',
    ]);
  });

  test("a function named in a file that does not have it", () => {
    expect(one("`dispatchIssues` in `jobs/lib/factory.ts` and `noSuchFunction()` in `jobs/lib/factory.ts`; `jobs/lib/settings.ts`'s `nothingHere`")).toEqual([
      'docs/x.md:1: "`noSuchFunction()` in `jobs/lib/factory.ts`": jobs/lib/factory.ts has no noSuchFunction',
      'docs/x.md:1: "`jobs/lib/settings.ts`\'s `nothingHere`": jobs/lib/settings.ts has no nothingHere',
    ]);
  });

  test("a claim that a file imports only some modules", () => {
    expect(one("`jobs/lib/settings.ts` imports only `node:fs`, `node:os`, `node:path` and `./layout.ts`.")).toEqual([]);
    const p = one("`jobs/lib/settings.ts` imports only `./sandbox.ts`, `./gate.ts` and `node:fs`.");
    expect(p).toHaveLength(1);
    expect(p[0]).toStartWith('docs/x.md:1: "`jobs/lib/settings.ts` imports only `./sandbox.ts`, `./gate.ts` and `node:fs`": jobs/lib/settings.ts imports node:fs, node:os, node:path, ./layout.ts; not ./sandbox.ts, ./gate.ts');
  });

  test("a CLI flag that the code does not define, in a code span and in a code block", () => {
    const text = "Run `aleph status --no-such-flag`.\n```\necho x | aleph issue add aleph t --request -\naleph-ui --port 3020 --nor-this   # --not-a-flag in a comment\n```\n`docker compose --env-file .env`";
    expect(one(text)).toEqual([
      'docs/x.md:1: "aleph status --no-such-flag" uses --no-such-flag, which the CLI source does not define',
      'docs/x.md:4: "aleph-ui --port 3020 --nor-this" uses --nor-this, which the CLI source does not define',
    ]);
  });
});

describe("a run reads the docs as they are at that moment", () => {
  let dir = "";
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  test("an edit after a passing run fails the next run, which quotes the edited line", () => {
    dir = mkdtempSync(join(tmpdir(), "doc-claims-"));
    mkdirSync(join(dir, "docs"));
    mkdirSync(join(dir, "jobs"));
    writeFileSync(join(dir, "jobs", "a.ts"), "export const t = Number(process.env.ALEPH_JOB_TIMEOUT ?? 1800);\n");
    writeFileSync(join(dir, "README.md"), "The time box is `ALEPH_JOB_TIMEOUT` (1800). See `jobs/a.ts:1`.\n");
    expect(docClaimsReport(dir)).toEqual({ ok: true, text: "every checked doc claim matches the code" });
    writeFileSync(join(dir, "docs", "factory.md"), "| `ALEPH_JOB_TIMEOUT` | 1200 | Seconds |\nSee `jobs/a.ts:4`.\n");
    const r = docClaimsReport(dir);
    expect(r.ok).toBe(false);
    expect(r.text).toBe([
      'docs/factory.md:1: "| `ALEPH_JOB_TIMEOUT` | 1200 |" says ALEPH_JOB_TIMEOUT defaults to 1200, the code has 1800',
      'docs/factory.md:2: "`jobs/a.ts:4`" cites line 4 of jobs/a.ts, which has 1 lines',
      "2 doc claims the code does not back",
    ].join("\n"));
  });
});

test("aleph doc-claims runs the check and exits 0 on this tree", () => {
  const p = Bun.spawnSync(["bun", join(ROOT, "jobs", "cli.ts"), "doc-claims"], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  expect(p.stdout.toString().trim()).toBe("every checked doc claim matches the code");
  expect(p.exitCode).toBe(0);
});

test("every setting with a default in DEFAULTS reads a number or a word with its variable unset", () => {
  for (const [name, get] of Object.entries(DEFAULTS)) expect([name, typeof get()]).toEqual([name, expect.stringMatching(/^(number|string)$/)]);
});

test("normalize reads numbers, times and backticked words", () => {
  expect(normalize("1800")).toBe(1800);
  expect(normalize("200,000")).toBe(200000);
  expect(normalize("30 minutes")).toBe(1800);
  expect(normalize("600 s")).toBe(600);
  expect(normalize("`claude`")).toBe("claude");
  expect(normalize("the worker command")).toBe("the worker command");
});

test("importsOf reads static, side-effect, re-export and dynamic imports", () => {
  expect(importsOf('import { a } from "./a.ts";\nimport "./b.ts";\nexport { c } from "./c.ts";\nconst d = await import("./d.ts");\nimport type { E } from "./e.ts";')).toEqual(["./a.ts", "./c.ts", "./e.ts", "./b.ts", "./d.ts"]);
});

test("flagsIn leaves out other commands", () => {
  expect(flagsIn([{ file: "d.md", text: "`docker compose -p aleph-langfuse --env-file .env`" }])).toEqual([]);
});
