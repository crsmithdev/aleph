/**
 * The registry of a test: one `projects/<n>/project.md` per repo under an items folder, numbered from 1 in the order
 * given, so `project.1` is the first. It replaces the `repos.json` that tests wrote. The files stay uncommitted, as the
 * registry reads a project from disk.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseProject, renderProject } from "../lib/projects.ts";
import { git } from "../lib/git.ts";
import { alephPath } from "../lib/paths.ts";

/** The fields a repo has in the registry (`path`, `code`, `checks`, ...), by name. */
export type Repos = Record<string, Record<string, any>>;

/** Write `repos` as the projects of the items folder `items`, after removing its projects. */
export function writeRepos(repos: Repos, items = alephPath("ALEPH_ITEMS", "items")): void {
  rmSync(join(items, "projects"), { recursive: true, force: true });
  Object.entries(repos).forEach(([name, fields], n) => {
    const file = join(items, "projects", String(n + 1), "project.md");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, renderProject({ name, description: "", fields }));
  });
}

/** The key of the project `name` in the items folder `items` (`project.2`); throws when it has none. */
export function projectOf(name: string, items = alephPath("ALEPH_ITEMS", "items")): string {
  const n = readdirSync(join(items, "projects")).find((d) => parseProject(Number(d), readFileSync(join(items, "projects", d, "project.md"), "utf8")).name === name);
  if (!n) throw new Error(`no project ${name} in ${items}`);
  return `project.${n}`;
}

/** The registry written in the items folder `items`, as `writeRepos` takes it. */
export function readRepos(items = alephPath("ALEPH_ITEMS", "items")): Repos {
  return Object.fromEntries(readdirSync(join(items, "projects")).sort((a, b) => Number(a) - Number(b))
    .map((d) => parseProject(Number(d), readFileSync(join(items, "projects", d, "project.md"), "utf8"))).map((p) => [p.name, p.fields]));
}

/** A new items repo for one test: a bare origin and a clone with one empty commit, so its issue numbers start at 1. Returns the clone. */
export function newItems(base: string, name: string): string {
  const bare = join(base, `${name}.git`), clone = join(base, name);
  git(base, "init", "-q", "--bare", "-b", "main", bare);
  git(base, "clone", "-q", bare, clone);
  git(clone, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "start");
  git(clone, "push", "-q", "origin", "main");
  return clone;
}
