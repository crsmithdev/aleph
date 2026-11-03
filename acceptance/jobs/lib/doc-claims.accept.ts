// Archived goal tests from jobs/lib/doc-claims.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultClaims, docProblems, flagsIn, importsOf, normalize, type Truth } from "../../../jobs/lib/doc-claims.ts";
import { DEFAULTS, repoDocs, repoTruth } from "../../../jobs/lib/doc-claims-repo.ts";

describe("the docs on this tree match the code", () => {
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

  test("a CLI flag that the code does not define, in a code span and in a code block", () => {
    const text = "Run `aleph status --no-such-flag`.\n```\necho x | aleph issue add aleph t --request -\naleph-ui --port 3020 --nor-this   # --not-a-flag in a comment\n```\n`docker compose --env-file .env`";
    expect(one(text)).toEqual([
      'docs/x.md:1: "aleph status --no-such-flag" uses --no-such-flag, which the CLI source does not define',
      'docs/x.md:4: "aleph-ui --port 3020 --nor-this" uses --nor-this, which the CLI source does not define',
    ]);
  });
});

describe("a default stated only in prose is checked against the code constant", () => {
  let dir = "";
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  const fixture = (stall: number, warn: number) => {
    dir = mkdtempSync(join(tmpdir(), "doc-claims-prose-"));
    mkdirSync(join(dir, "jobs", "lib"), { recursive: true });
    mkdirSync(join(dir, "hooks", "lib"), { recursive: true });
    writeFileSync(join(dir, "jobs", "lib", "sandbox.ts"), `export const stallSeconds = (): number => Number(process.env.ALEPH_STALL_SECONDS ?? ${stall});\n`);
    writeFileSync(join(dir, "hooks", "lib", "context.ts"), `const DEFAULT_WARN = ${warn};\n`);
    return (text: string) => docProblems([{ file: "docs/x.md", text }], { ...repoTruth(), root: dir });
  };

  test("no output for 10 minutes passes against 600 and fails against 900", () => {
    expect(fixture(600, 0.75)("stalled: no output for 10 minutes")).toEqual([]);
    expect(fixture(900, 0.75)("a\nstalled: no output for 10 minutes")).toEqual([
      'docs/x.md:2: "no output for 10 minutes" says stallSeconds defaults to 600, the code has 900 (jobs/lib/sandbox.ts)',
    ]);
  });

  test("above 0.75 of the threshold passes against 0.75 and fails against 0.8", () => {
    expect(fixture(600, 0.75)("Warn above 0.75 of the threshold")).toEqual([]);
    expect(fixture(600, 0.8)("Warn above 0.75 of the threshold")).toEqual([
      'docs/x.md:1: "above 0.75 of the threshold" says DEFAULT_WARN defaults to 0.75, the code has 0.8 (hooks/lib/context.ts)',
    ]);
  });
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
