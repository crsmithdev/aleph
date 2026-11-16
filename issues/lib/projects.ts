/**
 * The project files: `projects/<n>/project.md` in the items repo (docs/data-model.md). The path is the key
 * (`project.<n>`), so a file holds no id. The frontmatter is YAML, because `checks` and `manual` are lists of
 * records; the body is the description. The registry (jobs/lib/records/ledger.ts `loadRegistry`) reads them from the
 * items checkout on disk.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { splitFrontmatter } from "../../lib/frontmatter.ts";
import { layout } from "../../lib/layout.ts";
import { key } from "../../lib/naming.ts";

export interface Project {
  /** The number in its path. */
  n: number;
  /** The name: the registry key of the repo, `aleph`. */
  name: string;
  /** What the project is: the file's body. */
  description: string;
  /** The other fields of the frontmatter: `code`, `path`, `main`, `env`, `setup`, `checks`, `sandbox`, ... */
  fields: Record<string, any>;
}

export const projectsDir = (): string => join(layout().items, "projects");
export const projectFile = (n: number): string => join(projectsDir(), String(n), "project.md");

/** The text of a project file, the frontmatter first. */
export function renderProject({ name, description, fields }: Omit<Project, "n">): string {
  return `---\n${Bun.YAML.stringify({ name, ...fields }, null, 2).trimEnd()}\n---\n${description.trim() ? `\n${description.trim()}\n` : ""}`;
}

/** The project from the text of its file. */
export function parseProject(n: number, text: string): Project {
  const { frontmatter, body } = splitFrontmatter(text);
  const { name, ...fields } = (frontmatter === null ? {} : Bun.YAML.parse(frontmatter)) as Record<string, any>;
  return { n, name: String(name ?? ""), description: frontmatter === null ? "" : body.trim(), fields };
}

/** Every project on disk, by number. */
export function readProjects(): Project[] {
  const dir = projectsDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((d) => /^\d+$/.test(d) && existsSync(projectFile(Number(d)))).map(Number).sort((a, b) => a - b)
    .map((n) => parseProject(n, readFileSync(projectFile(n), "utf8")));
}

/** The key of the project named `name`, `project.3`, or undefined when the items repo has none. */
export const projectKey = (name: string): string | undefined => { const p = readProjects().find((x) => x.name === name); return p && key("project", p.n); };

/** The name of the project with key `k` (`project.3`), or undefined. */
export const projectName = (k: string): string | undefined => readProjects().find((p) => key("project", p.n) === k)?.name;
