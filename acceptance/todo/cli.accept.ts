// Archived goal tests from todo/cli.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, afterEach, beforeEach, expect, setDefaultTimeout, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseFrontmatter, splitFrontmatter } from "../../vault/lib/frontmatter.ts";
import { renderItem, type Issue } from "../../todo/lib/todo.ts";
import { config } from "../../todo/lib/store.ts";

// Matches `--timeout=30000` in the package.json test script, so running this file by name gets the same limit.
setDefaultTimeout(30000);

const CLI = join((import.meta.dir + "/../../todo"), "..", "jobs", "cli.ts");
// `repo` is a product repo; `items` is the work store's checkout and `remote` its origin.
let base: string, remote: string, repo: string, items: string;

const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
function sh(cwd: string, ...args: string[]): string {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
  return p.stdout.toString().trim();
}

function env(extra: Record<string, string> = {}): Record<string, string> {
  return { ...(process.env as Record<string, string>), CLAUDECODE: "", ...gitEnv, ALEPH_REPOS: join(base, "repos.json"), ALEPH_ISSUES: items, ...extra };
}

function aleph(...args: string[]): { code: number; out: string; err: string } {
  return alephWith({}, ...args);
}
function alephWith(extra: Record<string, string>, ...args: string[]): { code: number; out: string; err: string } {
  return alephIn(extra, undefined, ...args);
}
function alephIn(extra: Record<string, string>, stdin: string | undefined, ...args: string[]): { code: number; out: string; err: string } {
  const p = Bun.spawnSync(["bun", CLI, ...args], { env: env(extra), stdin: stdin === undefined ? "ignore" : new Blob([stdin]), stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
}

/** The items of a list in the old docs/todo.md form, in the stored shape. */
function parse(text: string): { items: Issue[] } {
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

const tasks = "proj/backlog/tasks";
const remoteItem = (id: number) => sh(base, "git", "--git-dir", remote, "show", `main:${tasks}/proj-${id}.md`);

/** Put the items of `text`, a list in the old docs/todo.md form, on the store's origin/main by hand. */
function seed(text: string | null): void {
  rmSync(join(items, "proj"), { recursive: true, force: true });
  if (text !== null) {
    mkdirSync(join(items, tasks), { recursive: true });
    writeFileSync(join(items, "proj", "backlog", "config.yml"), config("proj"));
    parse(text).items.forEach((item, n) => writeFileSync(join(items, tasks, `proj-${item.id}${n ? `-${n}` : ""}.md`), renderItem("proj", item)));
  }
  sh(items, "git", "add", "-A");
  sh(items, "git", "commit", "-qm", "seed", "--allow-empty");
  sh(items, "git", "push", "-q", "origin", "main");
}

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
afterAll(() => rmSync(templateDir, { recursive: true, force: true }));

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-todo-"));
  remote = join(base, "items.git");
  items = join(base, "items");
  repo = join(base, "proj");
  // Four repos cost twenty git processes: make them once, and copy them with their remotes pointed here.
  cpSync(template(), base, { recursive: true });
  for (const clone of [items, repo]) writeFileSync(join(clone, ".git", "config"), readFileSync(join(clone, ".git", "config"), "utf8").replaceAll(templateDir, base));
  writeFileSync(join(base, "repos.json"), JSON.stringify({ proj: { path: repo } }));
  seed("# To do\n\n## 3. An old item\n---\nid: 3\nstatus: open\ncreated: 2026-09-01\nupdated: 2026-09-01\npriority: medium\nlabels: []\n---\n\nWritten long ago.\n\nDone when it is done.\n");
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

test("add gives source agent under CLAUDECODE, chris without it, and worker for a followup label", () => {
  const src = (title: string) => JSON.parse(aleph("issue", "list", "proj", "--json").out).find((r: any) => r.title === title).source;
  expect(alephWith({ CLAUDECODE: "1" }, "issue", "add", "proj", "From agent").code).toBe(0);
  expect(aleph("issue", "add", "proj", "From human").code).toBe(0);
  expect(alephWith({ CLAUDECODE: "1" }, "issue", "add", "proj", "From worker", "--labels", "followup").code).toBe(0);
  expect(src("From agent")).toBe("agent");
  expect(src("From human")).toBe("chris");
  expect(src("From worker")).toBe("worker");
  const id = JSON.parse(aleph("issue", "list", "proj", "--json").out).find((r: any) => r.title === "From human").id;
  expect(aleph("issue", "edit", "proj", String(id), "--source", "agent").code).toBe(0);
  expect(src("From human")).toBe("agent");
  // The fixture's item 3 predates kinds, so lint names its missing kind; no source is a finding.
  const lint = aleph("issue", "lint", "proj");
  expect(lint.err).not.toContain("source");
});

test("add and edit refuse a priority outside low, medium, high, critical", () => {
  const before = sh(base, "git", "--git-dir", remote, "rev-parse", "main");
  const r = aleph("issue", "add", "proj", "Urgent thing", "--priority", "urgent");
  expect(r.code).not.toBe(0);
  for (const p of ["low", "medium", "high", "critical"]) expect(r.err).toContain(p);
  expect(sh(base, "git", "--git-dir", remote, "rev-parse", "main")).toBe(before);
  expect(aleph("issue", "add", "proj", "Kept critical", "--priority", "critical").code).toBe(0);
  expect(remoteItem(4)).toContain("priority: critical\n");
  const e = aleph("issue", "edit", "proj", "3", "--priority", "urgent");
  expect(e.code).not.toBe(0);
  expect(e.err).toContain("critical");
});

test("hidden reads the goal id directory, then the old number", async () => {
  seed("# To do\n\n" + [3, 4].map((n) => sec(n, "kind: goal")).join("\n"));
  for (const [p, text] of [["3/a.test.ts", "a"], ["proj-4/b.test.ts", "b"], ["proj-5.1/c.test.ts", "c"]]) {
    mkdirSync(join(items, "proj", "hidden", p.split("/")[0]), { recursive: true });
    writeFileSync(join(items, "proj", "hidden", p), text);
  }
  sh(items, "git", "add", "-A");
  sh(items, "git", "commit", "-qm", "hidden");
  sh(items, "git", "push", "-q", "origin", "main");
  expect(aleph("issue", "hidden", "proj", "3").out.trim()).toBe("a.test.ts");
  expect(aleph("issue", "hidden", "proj", "4").out.trim()).toBe("b.test.ts");
  expect(aleph("issue", "show", "proj", "4").out).toContain("hidden checks: 1");
  const was = process.env.ALEPH_ISSUES;
  process.env.ALEPH_ISSUES = items;
  try {
    const { readHidden } = await import("../../todo/lib/store.ts");
    expect(Object.keys(readHidden({ key: "proj" }, "proj-5.1"))).toEqual(["c.test.ts"]);
    expect(Object.keys(readHidden({ key: "proj" }, "proj-3"))).toEqual(["a.test.ts"]);
    expect(Object.keys(readHidden({ key: "proj" }, 3))).toEqual(["a.test.ts"]);
    expect(Object.keys(readHidden({ key: "proj" }, 4))).toEqual(["b.test.ts"]);
  } finally {
    if (was === undefined) delete process.env.ALEPH_ISSUES; else process.env.ALEPH_ISSUES = was;
  }
});

const sec = (id: number, fm: string, body = "Body.") => `## ${id}. Item ${id}\n---\nid: ${id}\nstatus: open\ncreated: 2026-09-01\nupdated: 2026-09-01\npriority: medium\n${fm}\n---\n\n${body}\n`;
