/**
 * The fixture of the `aleph issue` tests: a work store with its origin, and a product repo, made fresh for each test
 * from a template. issues/cli.test.ts spawns the CLI on it; issues/lib/issues.verbs.test.ts calls the verbs in-process.
 */
import { afterAll, afterEach, beforeEach } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseFrontmatter, splitFrontmatter } from "../vault/lib/frontmatter.ts";
import { renderItem, type Issue } from "./lib/todo.ts";
import { config } from "./lib/store.ts";

/** `repo` is a product repo; `items` is the work store's checkout and `remote` its origin. Set again before each test. */
export const fx = { base: "", remote: "", repo: "", repoRemote: "", items: "" };

export const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
export function sh(cwd: string, ...args: string[]): string {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
  return p.stdout.toString().trim();
}

/** The environment of `aleph` on the fixture. */
export function env(extra: Record<string, string> = {}): Record<string, string> {
  return { ...(process.env as Record<string, string>), CLAUDECODE: "", ...gitEnv, ALEPH_REPOS: join(fx.base, "repos.json"), ALEPH_ISSUES: fx.items, ...extra };
}

/** The items of a list in the old docs/todo.md form, in the stored shape. */
export function parse(text: string): { items: Issue[] } {
  const parts = text.split(/^## (\d+)\. (.*)$/m);
  const items: Issue[] = [];
  for (let i = 1; i < parts.length; i += 3) {
    const { frontmatter, body } = splitFrontmatter(parts[i + 2].replace(/^\n/, ""));
    const { status, kind, labels, ...fm } = parseFrontmatter(frontmatter ?? "") as Record<string, any>;
    const text = body.trim();
    items.push({ id: Number(parts[i]), title: parts[i + 1].trim(), fm: { ...fm, ...(status && status !== "open" ? { closed_as: status } : {}) }, request: kind === "goal" ? "" : text, spec: kind === "goal" ? text : "", notes: [] });
  }
  return { items };
}

export const tasks = "proj/backlog/tasks";
/** Item `id` as the store's checkout has it, which follows origin/main. */
export const doc = (id: number) => readFileSync(join(fx.items, tasks, `proj-${id}.md`), "utf8");
export const remoteItem = (id: number) => sh(fx.base, "git", "--git-dir", fx.remote, "show", `main:${tasks}/proj-${id}.md`);

/** Put the items of `text`, a list in the old docs/todo.md form, on the store's origin/main by hand. */
export function seed(text: string | null): void {
  rmSync(join(fx.items, "proj"), { recursive: true, force: true });
  if (text !== null) {
    mkdirSync(join(fx.items, tasks), { recursive: true });
    writeFileSync(join(fx.items, "proj", "backlog", "config.yml"), config("proj"));
    parse(text).items.forEach((item, n) => writeFileSync(join(fx.items, tasks, `proj-${item.id}${n ? `-${n}` : ""}.md`), renderItem("proj", item)));
  }
  sh(fx.items, "git", "add", "-A");
  sh(fx.items, "git", "commit", "-qm", "seed", "--allow-empty");
  sh(fx.items, "git", "push", "-q", "origin", "main");
}

/** Put item 4 back on origin/main with `fields` in its front matter, as an old writer would have left it. */
export function breakItem(fields: string): void {
  writeFileSync(join(fx.items, tasks, "proj-4.md"), remoteItem(4).replace("source: chris", `source: chris\n${fields}`));
  sh(fx.items, "git", "add", "-A");
  sh(fx.items, "git", "commit", "-qm", "break");
  sh(fx.items, "git", "push", "-q", "origin", "main");
}

export const sec = (id: number, fm: string, body = "Body.") => `## ${id}. Item ${id}\n---\nid: ${id}\nstatus: open\ncreated: 2026-09-01\nupdated: 2026-09-01\npriority: medium\n${fm}\n---\n\n${body}\n`;

let templateDir = "";
function template(): string {
  if (templateDir) return templateDir;
  templateDir = mkdtempSync(join(tmpdir(), "aleph-todo-template-"));
  for (const name of ["items", "proj"]) {
    const bare = join(templateDir, `${name}.git`), clone = join(templateDir, name);
    sh(templateDir, "git", "init", "-q", "--bare", "-b", "main", bare);
    sh(templateDir, "git", "clone", "-q", bare, clone);
    sh(clone, "git", "commit", "-q", "--allow-empty", "-m", "start");
    sh(clone, "git", "push", "-q", "origin", "main");
  }
  return templateDir;
}

/** Make the fixture before each test of the file that calls this, and remove it after. */
export function useFixture(): void {
  // One `bun test` process without --parallel runs several files with this module loaded once: the next file builds a new template.
  afterAll(() => { rmSync(templateDir, { recursive: true, force: true }); templateDir = ""; });
  beforeEach(() => {
    fx.base = mkdtempSync(join(tmpdir(), "aleph-todo-"));
    fx.remote = join(fx.base, "items.git");
    fx.items = join(fx.base, "items");
    fx.repoRemote = join(fx.base, "proj.git");
    fx.repo = join(fx.base, "proj");
    // Four repos cost twenty git processes: make them once, and copy them with their remotes pointed here.
    cpSync(template(), fx.base, { recursive: true });
    for (const clone of [fx.items, fx.repo]) writeFileSync(join(clone, ".git", "config"), readFileSync(join(clone, ".git", "config"), "utf8").replaceAll(templateDir, fx.base));
    writeFileSync(join(fx.base, "repos.json"), JSON.stringify({ proj: { path: fx.repo, code: "p" } }));
    seed("# To do\n\n## 3. An old item\n---\nid: 3\nstatus: open\ncreated: 2026-09-01\nupdated: 2026-09-01\npriority: medium\nlabels: []\n---\n\nWritten long ago.\n\nDone when it is done.\n");
  });
  afterEach(() => rmSync(fx.base, { recursive: true, force: true }));
}
