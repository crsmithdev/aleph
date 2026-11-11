import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { install } from "./install.ts";

const write = (root: string, file: string, text = "") => {
  mkdirSync(join(root, file, ".."), { recursive: true });
  writeFileSync(join(root, file), text);
};
const skill = (name: string) => `---\nname: ${name}\ndescription: ${"d".repeat(40)}\n---\n\nbody\n`;

/** A plugin repo linked into home, one of its skills copied into home by hand, a personal agent over a project one, and a dead link. */
test("finds what home copies, shadows or links to nowhere", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "repo-")));
  const home = realpathSync(mkdtempSync(join(tmpdir(), "home-")));
  write(root, ".claude-plugin/plugin.json", "{}");
  write(root, "skills/review/SKILL.md", skill("review"));
  write(root, "hooks/guard.sh");
  write(root, ".claude/agents/fixer.md", "---\ndescription: fixes\n---\n");
  write(root, ".mcp.json", JSON.stringify({ mcpServers: { db: {} } }));
  write(home, ".claude/skills/review/SKILL.md", skill("review"));
  write(home, ".claude/skills/other/SKILL.md", skill("other"));
  write(home, ".claude/agents/fixer.md", "---\ndescription: fixes\n---\n");
  write(home, ".claude/hooks/guard.sh");
  write(home, ".claude/settings.json", JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: `bash '${home}/.claude/hooks/guard.sh' stop` }] }] }, enabledPlugins: { "x@m": false } }));
  write(home, ".claude/plugins/installed_plugins.json", JSON.stringify({ plugins: { "x@m": [{ scope: "user" }] } }));
  symlinkSync(root, join(home, ".claude/skills/mine"));
  write(root, "identity/CLAUDE.md");
  symlinkSync(join(root, "identity/CLAUDE.md"), join(home, ".claude/CLAUDE.md"));
  symlinkSync(join(root, "gone"), join(home, ".claude/skills/gone"));

  const r = install(root, home);
  const at = (xs: { kind: string; name: string; source: string }[]) => xs.map((e) => `${e.kind} ${e.name} ${e.source}`).sort();

  expect(at(r.user)).toEqual(["agent fixer local", "hook guard.sh local", "memory CLAUDE.md repo", "plugin mine repo", "skill gone missing", "skill other local", "skill review local"]);
  expect(at(r.project)).toEqual(["agent fixer repo", "mcp db local", "skill review repo"]);
  expect(r.shadow).toEqual(["agent:fixer"]);
  expect(r.copies.sort()).toEqual([`${home}/.claude/agents/fixer.md`, `${home}/.claude/hooks/guard.sh`, `${home}/.claude/skills/review`]);
  expect(r.dangling).toEqual([`${home}/.claude/skills/gone`]);
  expect(r.plugins).toEqual([{ id: "x@m", scope: "user", enabled: { "~/.claude/settings.json": false } }]);
  expect(r.user.find((e) => e.name === "other")?.description).toBe(40);
});
