import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readHidden, writeList } from "../../todo/lib/store.ts";
import * as issues from "../../todo/lib/todo.ts";
import { factoryRepos } from "../../tests/git-fixture.ts";
import { authorPrompt, scenarioCount, seal } from "./author.ts";

test("the numbered lines of a reply are its scenarios", () => {
  expect(scenarioCount("1. Someone opens it.\n2) Someone clicks it.\n")).toBe(2);
  expect(scenarioCount("No scenarios: 3 of them are unclear.")).toBe(0);
});

test("the prompt gives the goal and not the Oracle or the Edit surface", () => {
  const p = authorPrompt({ title: "T", spec: "## Goal\nEND\n\n## Edit surface\nSURFACE\n\n## Oracle\nORACLE\n" } as any);
  expect(p).toContain("END");
  expect(p).not.toContain("SURFACE");
  expect(p).not.toContain("ORACLE");
});

test("a part's prompt gives its own Goal and names the other parts, whose work it leaves out", () => {
  const part = { title: "[Tags] One tag list", spec: "## Goal\nPART ONE GOAL\n\n## Oracle\nORACLE\n" } as any;
  const p = authorPrompt(part, ["[Tags] Use the format sentence in the prompts"]);
  expect(p).toContain("PART ONE GOAL");
  expect(p).toContain("write no scenario for their work");
  expect(p).toContain("- [Tags] Use the format sentence in the prompts");
  expect(authorPrompt(part)).not.toContain("one part of a larger goal");
});

test("seal on a part sends the author that part's Goal, not the parent's or a sibling's", async () => {
  const base = mkdtempSync(join(tmpdir(), "aleph-author-"));
  const saved = { issues: process.env.ALEPH_ISSUES, cmd: process.env.ALEPH_AUTHOR_CMD };
  try {
    factoryRepos(base);
    process.env.ALEPH_ISSUES = join(base, "items");
    writeFileSync(join(base, "author"), `#!/bin/sh\ncat > "${join(base, "prompt")}"\necho "1. Someone sees it."\n`, { mode: 0o755 });
    process.env.ALEPH_AUTHOR_CMD = join(base, "author");
    writeList({ key: "fac" }, "add", (doc) => {
      const parent = issues.add(doc, "big", { spec: "## Goal\nPARENT GOAL" });
      issues.addPart(doc, parent, { title: "[Big] First", spec: "## Goal\nFIRST GOAL\n## Edit surface\na.ts\n## Oracle\n`bun test`" });
      issues.addPart(doc, parent, { title: "[Big] Second", spec: "## Goal\nSECOND GOAL\n## Edit surface\nb.ts\n## Oracle\n`bun test`" });
      return true;
    }, true);
    await seal({ key: "fac" } as any, "1.1");
    const p = readFileSync(join(base, "prompt"), "utf8");
    expect(p).toContain("FIRST GOAL");
    expect(p).not.toContain("SECOND GOAL");
    expect(p).not.toContain("PARENT GOAL");
    expect(p).toContain("- [Big] Second");
    expect(readHidden({ key: "fac" }, "fac-1.1")["scenarios.md"]).toBe("1. Someone sees it.\n");
  } finally {
    for (const [k, v] of [["ALEPH_ISSUES", saved.issues], ["ALEPH_AUTHOR_CMD", saved.cmd]] as const) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    rmSync(base, { recursive: true, force: true });
  }
});
