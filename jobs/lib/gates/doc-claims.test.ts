import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { docProblems, type Truth } from "./doc-claims.ts";
import { docClaimsReport, repoProblems, repoTruth, ROOT } from "./doc-claims-repo.ts";

describe("the docs on this tree match the code", () => {
  test("every default, setting name, repo path, file:line, symbol, import claim and aleph flag in the docs", () => {
    expect(repoProblems()).toEqual([]);
  });

});

describe("a doc that does not match fails, quoting the claim", () => {
  const t = (): Truth => ({ ...repoTruth(), defaults: { ALEPH_JOB_TIMEOUT: () => 1800, ALEPH_STALL_SECONDS: () => 600, ALEPH_UI_PORT: () => "3020" } });
  const one = (text: string) => docProblems([{ file: "docs/x.md", text }], t());

  test("a wrong default for a hook or routing setting names that setting", () => {
    const bad = (text: string) => docProblems([{ file: "docs/x.md", text }], repoTruth());
    expect(bad("`ALEPH_SPOOL`, else `~/.spool`")).toEqual([expect.stringMatching(/ALEPH_SPOOL defaults to "~\/\.spool", the code has "~\/\.aleph\/spool"/)]);
    expect(bad("`ALEPH_RUN_CAP` (4)")).toEqual([expect.stringMatching(/ALEPH_RUN_CAP defaults to 4, the code has 3/)]);
    expect(bad("`ALEPH_SPOOL`, else `~/.aleph/spool`; `ALEPH_RUN_CAP` (3); `ALEPH_JUDGE`, else `jev`; `ALEPH_DISPATCH`, else `on`; `ALEPH_ENV`, else `interactive`; `ALEPH_CONTEXT_WARN` (0.75)")).toEqual([]);
  });

  test("a file:line past the end of the file, or a bare name no file has", () => {
    expect(one("`jobs/lib/infra/settings.ts:99999`, `settings.ts:1`, `jobs/lib/infra/settings.ts:2-3`, `nosuchfile.ts:5`")).toEqual([
      expect.stringMatching(/^docs\/x\.md:1: "`jobs\/lib\/infra\/settings\.ts:99999`" cites line 99999 of jobs\/lib\/infra\/settings\.ts, which has \d+ lines$/),
      'docs/x.md:1: "`nosuchfile.ts:5`" names no file of the repo',
    ]);
  });

  test("a function named in a file that does not have it", () => {
    expect(one("`dispatchIssues` in `jobs/lib/transitions/factory.ts` and `noSuchFunction()` in `jobs/lib/transitions/factory.ts`; `jobs/lib/infra/settings.ts`'s `nothingHere`")).toEqual([
      'docs/x.md:1: "`noSuchFunction()` in `jobs/lib/transitions/factory.ts`": jobs/lib/transitions/factory.ts has no noSuchFunction',
      'docs/x.md:1: "`jobs/lib/infra/settings.ts`\'s `nothingHere`": jobs/lib/infra/settings.ts has no nothingHere',
    ]);
  });

  test("a name cited in a file that only imports or calls it, not in the file that defines it", () => {
    const d = "jobs/lib/gates/doc-claims.ts";
    const u = "jobs/lib/gates/doc-claims-repo.ts";
    expect(one(`\`docProblems\` in \`${u}\`, \`docProblems\` in \`${d}\``)).toEqual([`docs/x.md:1: "\`docProblems\` in \`${u}\`": ${u} has no docProblems`]);
    const at = readFileSync(join(ROOT, d), "utf8").split("\n").findIndex((l) => l.includes("export function docProblems")) + 1;
    const use = readFileSync(join(ROOT, u), "utf8").split("\n").findIndex((l) => l.includes("docProblems(")) + 1;
    expect(one(`\`docProblems\` in \`${u}:${use}\``)).toEqual([`docs/x.md:1: "\`docProblems\` in \`${u}:${use}\`": ${u} has no docProblems`]);
    expect(one(`\`docProblems\` in \`${d}:${at}\``)).toEqual([]);
    const rows = readFileSync(join(ROOT, d), "utf8").split("\n");
    const def = rows.findIndex((l) => l.includes("function fileText")) + 1;
    const call = rows.findIndex((l) => l.includes("fileText(truth.root")) + 1;
    expect(one(`\`fileText\` (\`${d}:${call}\`)`)).toEqual([`docs/x.md:1: "\`fileText\` (\`${d}:${call}\`)": fileText is at line ${def} of ${d}`]);
    expect(one(`\`fileText\` (\`${d}:${def}\`)`)).toEqual([]);
  });

  test("a --flag of a vault command that the vault code does not read, in the Commands table or a code block", () => {
    const doc = (a: string, b: string, c: string) => `## Commands\n\n| Command | Does |\n|---|---|\n| \`recall [${a}] query [${b} name]\` | Ranks |\n\n\`\`\`\naleph memory lint ${c}\n\`\`\`\n`;
    expect(one(doc("--nosuch", "--scope", "--nosuch"))).toEqual([
      expect.stringMatching(/^docs\/x\.md:5: "recall \[--nosuch\] query \[--scope name\]" uses --nosuch, which the vault source does not define$/),
      expect.stringMatching(/^docs\/x\.md:8: "aleph memory lint --nosuch" uses --nosuch, which the vault source does not define$/),
    ]);
    expect(one(doc("--why", "--scope", "--fix"))).toEqual([]);
    expect(one("`aleph memory lint --fix`")).toEqual([]);
    expect(one("`aleph memory lint --nosuch`")).toEqual([expect.stringContaining("uses --nosuch, which the vault source does not define")]);
    expect(one("`aleph memory misses --days 3`; `aleph memory lint --overlap --template`")).toEqual([]);
  });

  test("a CSS selector cited in a stylesheet that does not hold it", () => {
    expect(one("`.no-such-class` in `ui/app.css`, `.chat .clamp` in `ui/app.css`, `.chat .clam` in `ui/app.css`")).toEqual([
      'docs/x.md:1: "`.no-such-class` in `ui/app.css`": ui/app.css has no .no-such-class',
      'docs/x.md:1: "`.chat .clam` in `ui/app.css`": ui/app.css has no .chat .clam',
    ]);
  });

  test("a name paired with a line that does not hold it", () => {
    const f = readFileSync(join(ROOT, "jobs/lib/gates/doc-claims.ts"), "utf8").split("\n");
    const at = f.findIndex((l) => l.includes("export function docProblems")) + 1;
    const p = "jobs/lib/gates/doc-claims.ts";
    expect(one(`\`docProblems()\` (\`${p}:1\`)`)).toEqual([`docs/x.md:1: "\`docProblems()\` (\`${p}:1\`)": docProblems is at line ${at} of ${p}`]);
    expect(one(`\`docProblems\` in \`${p}:1\``)).toEqual([`docs/x.md:1: "\`docProblems\` in \`${p}:1\`": docProblems is at line ${at} of ${p}`]);
    expect(one(`\`docProblems()\` (\`${p}:${at}\`), \`docProblems\` in \`${p}:${at - 2}-${at + 2}\`, \`${p}:1\``)).toEqual([]);
  });

  test("a comma pair: a name, then the line of the file that must hold it", () => {
    const f = readFileSync(join(ROOT, "jobs/lib/gates/doc-claims.ts"), "utf8").split("\n");
    const at = f.findIndex((l) => l.includes("export function docProblems")) + 1;
    const p = "jobs/lib/gates/doc-claims.ts";
    expect(one(`(\`docProblems()\`, \`${p}:1\`)`)).toEqual([`docs/x.md:1: "(\`docProblems()\`, \`${p}:1\`)": docProblems is at line ${at} of ${p}`]);
    expect(one(`(\`docProblems()\`, \`${p}:${at}\`), (\`docProblems\`, \`${p}:${at - 2}-${at + 2}\`)`)).toEqual([]);
    expect(one("(`noSuchFunction()`, `jobs/lib/infra/settings.ts:1`)")).toEqual([
      'docs/x.md:1: "(`noSuchFunction()`, `jobs/lib/infra/settings.ts:1`)": jobs/lib/infra/settings.ts has no noSuchFunction',
    ]);
  });

  test("a name paired with a line of a file that has no such name", () => {
    expect(one("`noSuchFunction()` (`jobs/lib/infra/settings.ts:1`)")).toEqual([
      'docs/x.md:1: "`noSuchFunction()` (`jobs/lib/infra/settings.ts:1`)": jobs/lib/infra/settings.ts has no noSuchFunction',
    ]);
  });

  test("a selector with a space paired with a line that does not hold it", () => {
    const p = "ui/app.css";
    const at = readFileSync(join(ROOT, p), "utf8").split("\n").findIndex((l) => l.startsWith(".chat .clamp ")) + 1;
    expect(one(`\`.chat .clamp\` (\`${p}:1\`)`)).toEqual([`docs/x.md:1: "\`.chat .clamp\` (\`${p}:1\`)": .chat .clamp is at line ${at} of ${p}`]);
    expect(one(`\`.chat .clamp\` in \`${p}:${at}\``)).toEqual([]);
  });

  test("a claim that a file imports only some modules", () => {
    const dir = mkdtempSync(join(tmpdir(), "doc-claims-imports-"));
    try {
      mkdirSync(join(dir, "jobs"));
      writeFileSync(join(dir, "jobs", "a.ts"), 'import { os } from "node:os";\nimport { b } from "./b.ts";\n');
      const at = (text: string) => docProblems([{ file: "docs/x.md", text }], { ...t(), root: dir });
      expect(at("`jobs/a.ts` imports only `node:os` and `./b.ts`.")).toEqual([]);
      expect(at("`jobs/a.ts` imports only `./c.ts` and `node:fs`.")).toEqual([
        'docs/x.md:1: "`jobs/a.ts` imports only `./c.ts` and `node:fs`": jobs/a.ts imports node:os, ./b.ts; not ./c.ts, node:fs',
      ]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
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
