import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load } from "./load.ts";

const write = (root: string, file: string, text: string) => {
  mkdirSync(join(root, file, ".."), { recursive: true });
  writeFileSync(join(root, file), text);
};
const skill = (name: string, more = "") => `---\nname: ${name}\ndescription: >\n  ${"d".repeat(40)}\n${more}---\n\nbody\n`;

/** A repo with an imported doc, two skills, a nested memory file and hooks; home links its memory file into the repo. */
test("counts what loads on every turn and what loads on demand", () => {
  const root = mkdtempSync(join(tmpdir(), "load-"));
  const home = mkdtempSync(join(tmpdir(), "home-"));
  write(root, "CLAUDE.md", "Read @docs/rules.md first. `@not/an/import` stays text.\n");
  write(root, "docs/rules.md", "r".repeat(400));
  write(root, "identity/CLAUDE.md", "i".repeat(80));
  write(root, "ui/CLAUDE.md", "u".repeat(40));
  write(root, "skills/one/SKILL.md", skill("one"));
  write(root, "skills/one/REF.md", "x".repeat(800));
  write(root, ".claude/skills/two/SKILL.md", skill("two", "disable-model-invocation: true\n"));
  write(root, "hooks/hooks.json", JSON.stringify({ hooks: { SessionStart: [], Stop: [] } }));
  mkdirSync(join(home, ".claude"));
  symlinkSync(join(root, "identity/CLAUDE.md"), join(home, ".claude/CLAUDE.md"));

  const r = load(root, home);
  const files = (xs: { file: string }[]) => xs.map((x) => x.file);

  expect(files(r.always)).toEqual(["docs/rules.md", "~/.claude/CLAUDE.md", "CLAUDE.md", "skills/one/SKILL.md"]);
  expect(r.always.find((i) => i.file === "skills/one/SKILL.md")?.kind).toBe("skill description");
  expect(r.total).toBe(100 + 20 + 14 + 11);
  expect(files(r.lazy).sort()).toEqual([".claude/skills/two/SKILL.md", "skills/one/REF.md", "skills/one/SKILL.md", "ui/CLAUDE.md"]);
  expect(r.lazy[0].file).toBe("skills/one/REF.md");
  expect(r.skills.map((s) => [s.name, s.invoked])).toEqual([["two", "user"], ["one", "model"]]);
  expect(r.hooks).toEqual(["hooks/hooks.json: SessionStart"]);
});
