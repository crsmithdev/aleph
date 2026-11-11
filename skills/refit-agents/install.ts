#!/usr/bin/env bun
/**
 * Where each skill, subagent, command, plugin, MCP server and hook script is installed, and where its file comes
 * from. A user-scope item loads in every repo on the machine; a project-scope item loads in this repo only.
 *
 *   user      ~/.claude/CLAUDE.md, ~/.claude/{skills,agents,commands}, the hooks in ~/.claude/settings.json, user MCP servers
 *   project   .claude/{skills,agents,commands} at any depth, the repo's plugin skills, .mcp.json, local MCP servers
 *   shadow    a name at user and project scope: a personal skill runs in place of the project one
 *   copies    a file under the home directory with the name of a file this repo owns, not linked to it
 *   dangling  a link whose target is gone
 *
 *   bun install.ts [root] [--home <dir>]   JSON
 */
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { main } from "./load.ts";

type Kind = "skill" | "agent" | "command" | "plugin" | "mcp" | "hook" | "memory";
type Entry = { name: string; kind: Kind; scope: "user" | "project"; path: string; source: "repo" | "local" | "missing"; description?: number };
export type Install = { user: Entry[]; project: Entry[]; plugins: { id: string; scope: string; enabled: Record<string, boolean> }[]; shadow: string[]; copies: string[]; dangling: string[] };

const SKIP = /(^|\/)(node_modules|\.git|\.worktrees|dist|build)\//;
const json = (f: string) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {});
const ls = (dir: string) => (existsSync(dir) ? readdirSync(dir) : []);

/** The description length of a SKILL.md or an agent or command file, or undefined when it has none. */
function described(file: string): number | undefined {
  if (!existsSync(file)) return undefined;
  const m = readFileSync(file, "utf8").match(/^---\n([\s\S]*?)\n---/);
  const fm = m ? ((Bun.YAML.parse(m[1]) as Record<string, unknown>) ?? {}) : {};
  return fm.description && fm["disable-model-invocation"] !== true ? String(fm.description).length : undefined;
}

export function install(root: string, home: string): Install {
  const inside = (f: string) => f === root || f.startsWith(join(root, "/"));
  const where = (f: string): Entry["source"] => {
    if (!existsSync(f)) return "missing";
    return inside(realpathSync(f)) ? "repo" : "local";
  };

  /** The skills, agents and commands of one .claude directory. */
  const scan = (dir: string, scope: Entry["scope"]): Entry[] => [
    ...ls(join(dir, "skills")).map((n) => {
      const path = join(dir, "skills", n);
      const plugin = existsSync(join(path, ".claude-plugin/plugin.json"));
      return { name: n, kind: (plugin ? "plugin" : "skill") as Kind, scope, path, source: where(path), description: described(join(path, "SKILL.md")) };
    }),
    ...(["agents", "commands"] as const).flatMap((k) =>
      ls(join(dir, k)).filter((n) => n.endsWith(".md")).map((n) => {
        const path = join(dir, k, n);
        return { name: n.slice(0, -3), kind: k.slice(0, -1) as Kind, scope, path, source: where(path), description: described(path) };
      }),
    ),
  ];

  const settings = json(join(home, ".claude/settings.json"));
  /** Each absolute path a user hook command names, so a script copied out of a repo shows up. */
  const hooks: Entry[] = Object.values((settings.hooks ?? {}) as Record<string, { hooks?: { command?: string }[] }[]>)
    .flat()
    .flatMap((g) => g.hooks ?? [])
    .flatMap((h) => [...(h.command ?? "").matchAll(/(?:^|[\s'"])((?:~|\/)[\w./-]+)/g)].map((m) => m[1].replace(/^~/, home)))
    .filter((p) => !p.startsWith("/usr/") && !p.startsWith("/bin/"))
    .map((p) => ({ name: basename(p), kind: "hook" as Kind, scope: "user" as const, path: p, source: where(p) }));

  const claude = json(join(home, ".claude.json"));
  const mcp = (servers: object | undefined, scope: Entry["scope"], path: string): Entry[] =>
    Object.keys(servers ?? {}).map((n) => ({ name: n, kind: "mcp" as Kind, scope, path, source: "local" as const }));

  const memory = join(home, ".claude/CLAUDE.md");
  const user = [
    ...(lstatSync(memory, { throwIfNoEntry: false }) ? [{ name: "CLAUDE.md", kind: "memory" as Kind, scope: "user" as const, path: memory, source: where(memory) }] : []),
    ...scan(join(home, ".claude"), "user"),
    ...hooks, ...mcp(claude.mcpServers, "user", "~/.claude.json"),
  ];
  const nested = [...new Bun.Glob("**/.claude").scanSync({ cwd: root, dot: true, onlyFiles: false })].filter((d) => !SKIP.test(`${d}/`));
  const project = [
    ...nested.flatMap((d) => scan(join(root, d), "project")),
    ...(existsSync(join(root, ".claude-plugin/plugin.json"))
      ? ls(join(root, "skills")).filter((n) => existsSync(join(root, "skills", n, "SKILL.md"))).map((n) => {
          const path = join(root, "skills", n);
          return { name: n, kind: "skill" as Kind, scope: "project" as const, path, source: "repo" as const, description: described(join(path, "SKILL.md")) };
        })
      : []),
    ...mcp(json(join(root, ".mcp.json")).mcpServers, "project", ".mcp.json"),
    ...mcp(claude.projects?.[root]?.mcpServers, "project", "~/.claude.json"),
  ];

  // A plugin's skills are namespaced, so they never shadow; every other user name over a project name does.
  const plain = (e: Entry) => e.kind !== "plugin" && e.kind !== "hook" && !(e.kind === "skill" && e.path.startsWith(join(root, "skills/")));
  const key = (e: Entry) => `${e.kind}:${e.name}`;
  const local = new Set(project.filter(plain).map(key));
  const shadow = user.filter((e) => plain(e) && local.has(key(e))).map(key);

  const owned = new Set([
    ...ls(join(root, "skills")),
    ...ls(join(root, "hooks")),
    ...project.filter((e) => e.source === "repo").map((e) => e.name),
  ]);
  const copies = user.filter((e) => e.source === "local" && e.kind !== "mcp" && owned.has(e.name)).map((e) => e.path);
  const dangling = [...user, ...project].filter((e) => e.source === "missing" && lstatSync(e.path, { throwIfNoEntry: false })).map((e) => e.path);

  const enabled = [join(home, ".claude/settings.json"), join(root, ".claude/settings.json"), join(root, ".claude/settings.local.json")]
    .filter(existsSync)
    .map((f) => [f.replace(home, "~"), (json(f).enabledPlugins ?? {}) as Record<string, boolean>] as const);
  const plugins = Object.entries((json(join(home, ".claude/plugins/installed_plugins.json")).plugins ?? {}) as Record<string, { scope: string }[]>).map(([id, xs]) => ({
    id,
    scope: xs.map((x) => x.scope).join(","),
    enabled: Object.fromEntries(enabled.filter(([, m]) => id in m).map(([f, m]) => [f, m[id]])),
  }));

  return { user, project, plugins, shadow, copies, dangling };
}

if (import.meta.main) main((root, home) => install(realpathSync(resolve(root)), home));
