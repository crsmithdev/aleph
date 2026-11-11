import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refs, slug } from "./refs.ts";

const repo = (tree: Record<string, string>) => {
  const root = mkdtempSync(join(tmpdir(), "refs-"));
  for (const [f, text] of Object.entries(tree)) {
    mkdirSync(join(root, f, ".."), { recursive: true });
    writeFileSync(join(root, f), text);
  }
  return root;
};

test("finds broken links, anchors, paths, env vars and own-CLI flags, both ways", () => {
  const root = repo({
    "README.md": "See [usage](docs/usage.md#run-it), [gone](docs/gone.md) and [bad](docs/usage.md#nope).\n",
    "docs/usage.md": "# Usage\n\n## Run it\n\nRun `bin/tool` with `TOOL_HOME` set, or `tool --dry`.\n\n```sh\ntool --fast\ndocker run --rm x\n```\nSee `src/missing.ts` and `origin/main`.\n",
    "docs/lost.md": "# Lost\n",
    "docs/specs/old.md": "[x](nowhere.md)\n",
    "CLAUDE.md": "Read [lost](docs/lost.md) is not this; [style](docs/style.md).\n",
    "docs/style.md": "# Style\n",
    "bin/tool": "#!/bin/sh\n",
    "src/main.ts": 'const home = process.env.TOOL_HOME;\nconst key = process.env.API_KEY;\nif (argv.includes("--dry")) {}\n',
  });
  const r = refs(root);
  expect(r.broken.map((b) => `${b.doc}:${b.line} ${b.kind} ${b.ref}`)).toEqual([
    "docs/usage.md:8 flag --fast",
    "docs/usage.md:11 path src/missing.ts",
    "README.md:1 link docs/gone.md",
    "README.md:1 anchor docs/usage.md#nope",
  ]);
  expect(r.undocumented.env).toEqual(["API_KEY"]);
  expect(r.orphans).toEqual([]);
});

test("a doc nothing links to is an orphan; records are not docs", () => {
  const r = refs(repo({ "README.md": "# Hi\n", "docs/a.md": "# A\n", "docs/specs/s.md": "# S\n" }));
  expect(r.orphans).toEqual(["docs/a.md"]);
  expect(r.docs).toEqual(["README.md", "docs/a.md"]);
});

test("slugs match GitHub anchors", () => {
  expect(slug("Run it")).toBe("run-it");
  expect(slug("The `--dry` flag!")).toBe("the---dry-flag");
});

test("aleph's own docs have no broken reference and no orphan", () => {
  const r = refs(join(import.meta.dir, "../.."));
  expect(r.broken).toEqual([]);
  expect(r.orphans).toEqual([]);
  expect(r.docs).toContain("docs/factory.md");
  expect(r.docs.filter((d) => d.startsWith("identity/"))).toEqual([]);
});
