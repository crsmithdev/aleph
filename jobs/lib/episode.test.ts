import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { traceIdFor } from "../../hooks/lib/otlp.ts";
import { writeList } from "../../todo/lib/store.ts";
import * as todos from "../../todo/lib/todo.ts";
import { episodeTitle, writeEpisodes } from "./episode.ts";
import { loadRegistry, writeRun, type Run } from "./ledger.ts";

const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
function sh(cwd: string, ...args: string[]): string {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
  return p.stdout.toString().trim();
}

const KEYS = ["ALEPH_ITEMS", "ALEPH_REPOS", "ALEPH_JOBS_DIR", "ALEPH_FACTORY_DIR", "ALEPH_VAULT", "LANGFUSE_BASE_URL", "LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY", "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"];
let base: string;
let saved: Record<string, string | undefined>;
let server: ReturnType<typeof Bun.serve>;
let asked: string[];

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-episode-test-"));
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  asked = [];
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname;
      asked.push(path);
      return Response.json({ observations: [{ usage: { total: 1234 } }] });
    },
  });
  Object.assign(process.env, gitEnv, {
    ALEPH_ITEMS: join(base, "items"), ALEPH_REPOS: join(base, "repos.json"), ALEPH_JOBS_DIR: join(base, "jobs"),
    ALEPH_FACTORY_DIR: join(base, "factory"), ALEPH_VAULT: join(base, "vault"),
    LANGFUSE_BASE_URL: `http://127.0.0.1:${server.port}`, LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk",
  });
  sh(base, "git", "init", "-q", "--bare", "-b", "main", join(base, "repo.git"));
  sh(base, "git", "clone", "-q", join(base, "repo.git"), join(base, "repo"));
  sh(join(base, "repo"), "git", "commit", "-q", "--allow-empty", "-m", "init");
  sh(join(base, "repo"), "git", "push", "-q", "origin", "main");
  sh(base, "git", "init", "-q", "--bare", "-b", "main", join(base, "items.git"));
  sh(base, "git", "clone", "-q", join(base, "items.git"), join(base, "items"));
  sh(join(base, "items"), "git", "commit", "-q", "--allow-empty", "-m", "start");
  sh(join(base, "items"), "git", "push", "-q", "origin", "main");
  writeFileSync(join(base, "repos.json"), JSON.stringify({ fac: { path: join(base, "repo"), sandbox: true, autoland: false } }));
  const init = Bun.spawnSync(["bun", join(import.meta.dir, "..", "..", "vault", "cli.ts"), "init"], { env: process.env, stdout: "pipe", stderr: "pipe" });
  if (init.exitCode !== 0) throw new Error(`vault init: ${init.stderr}`);
});

afterEach(() => {
  server.stop(true);
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(base, { recursive: true, force: true });
});

const add = (title: string, o: { labels?: string[]; done?: boolean; waitingOn?: string } = {}): number =>
  writeList({ key: "fac" }, "add", (doc) => {
    const item = todos.addLegacy(doc, title, { labels: o.labels ?? ["goal"], body: "## Goal\nShip it." });
    if (o.waitingOn) todos.edit(item, { waitingOn: o.waitingOn });
    if (o.done) todos.setStatus(item, "done");
    return item.id;
  }, true)!.value;

const land = (id: number): string => {
  const repo = join(base, "repo");
  writeFileSync(join(repo, `f${id}.txt`), "x\n");
  sh(repo, "git", "add", ".");
  sh(repo, "git", "commit", "-q", "-m", `ship thing ${id}`, "-m", `Item: fac-${id}`);
  sh(repo, "git", "push", "-q", "origin", "main");
  return sh(repo, "git", "rev-parse", "HEAD");
};

const run = (id: string, o: Partial<Run>): void => {
  const folder = join(base, "jobs", id);
  mkdirSync(folder, { recursive: true });
  writeRun(folder, { kind: "agent", job: id, name: "fac-1", repo: "fac", state: "landed", told: true, started: "2026-10-28T10:00:00Z", ended: "2026-10-28T10:20:00Z", ...o });
};

const pages = () => readdirSync(join(base, "vault", "wiki", "episodes")).filter((f) => f.endsWith(".md"));
const section = (text: string, name: string) => text.split(`## ${name}\n`)[1].split("\n## ")[0];

test("a done goal gets one page built from git, the ledger and Langfuse", async () => {
  const one = add("ship it");
  const sha = land(one);
  const dropped = "20261028-100000-fac-1-agent", landed = "20261028-103000-fac-1-agent";
  run(dropped, { state: "dropped", reason: "the last run made no commit", todo: one, cost: 1.5 });
  writeFileSync(join(base, "jobs", dropped, "result.md"), "also fixed the login bug\n");
  run(landed, { state: "landed", commit: sha, todo: one, cost: 2, started: "2026-10-28T10:30:00Z", ended: "2026-10-28T10:50:00Z" });
  const planned = add("the parent", { labels: ["goal", "planned"], done: true, waitingOn: `fac-${one}` });
  run("20261028-090000-fac-2-plan", { kind: "plan", state: "done", todo: planned, name: "fac-2", started: "2026-10-28T09:00:00Z", ended: "2026-10-28T09:05:00Z" });

  const repo = loadRegistry().fac;
  const r = await writeEpisodes([repo]);
  expect(r.failed).toEqual([]);
  expect(pages().filter((f) => f.startsWith("fac-1 ")).length).toBe(1);
  const text = readFileSync(join(base, "vault", "wiki", "episodes", pages().find((f) => f.startsWith("fac-1 "))!), "utf8");
  expect(section(text, "How it went")).toContain("the last run made no commit");
  expect(section(text, "What landed")).toContain(sha.slice(0, 7));
  expect(section(text, "Cost")).toContain("1234");
  expect(section(text, "Cost")).toContain(traceIdFor(landed));
  expect(section(text, "Goal").trim()).toBe("Ship it.");
  expect(text).toContain("written_by: factory");
  expect(text).not.toContain("login bug");

  const parent = readFileSync(join(base, "vault", "wiki", "episodes", pages().find((f) => f.startsWith("fac-2 "))!), "utf8");
  expect(section(parent, "What landed")).toContain(sha.slice(0, 7));

  const again = await writeEpisodes([repo]);
  expect(again.written).toEqual([]);
  expect(pages().filter((f) => f.startsWith("fac-1 ")).length).toBe(1);
});

test("a goal title with a colon gets a file name without it", async () => {
  const id = add("fix: the login");
  land(id);
  run("20261028-100000-fac-1-agent", { todo: id });
  const repo = loadRegistry().fac;
  expect(episodeTitle(repo, { id, title: 'a/b\\c:d*e?f"g<h>i|j  k ' } as any)).toBe(`fac-${id} a b c d e f g h i j k`);
  const r = await writeEpisodes([repo]);
  expect(r.failed).toEqual([]);
  expect(pages()).toEqual([`fac-${id} fix the login.md`]);
});

test("a 400-character title gets a page, and writing again writes and fails nothing", async () => {
  const id = add("word ".repeat(80).trim());
  land(id);
  run("20261028-100000-fac-1-agent", { todo: id });
  const repo = loadRegistry().fac;
  const r = await writeEpisodes([repo]);
  expect(r.failed).toEqual([]);
  expect(r.written.length).toBe(1);
  expect(pages().filter((f) => f.startsWith(`fac-${id} `)).length).toBe(1);
  expect(pages().every((f) => Buffer.byteLength(f) <= 255)).toBe(true);
  const again = await writeEpisodes([repo]);
  expect(again.written).toEqual([]);
  expect(again.failed).toEqual([]);
});

test("a 400-character multi-byte title is cut to fit a file name", () => {
  const repo = { key: "fac" } as any;
  for (const ch of ["é", "日"]) {
    const title = episodeTitle(repo, { id: 7, title: ch.repeat(400) } as any);
    expect(Buffer.byteLength(`${title}.md`)).toBeLessThanOrEqual(255);
    expect(title.startsWith("fac-7 ")).toBe(true);
    expect(title).not.toContain("�");
    expect(title.endsWith(ch)).toBe(true);
  }
});

test("a cut title drops trailing spaces and dots and keeps short titles as they are", () => {
  const repo = { key: "fac" } as any;
  // the 246 bytes left after the prefix end on the space, which the cut drops
  const cut = episodeTitle(repo, { id: 7, title: "a".repeat(245) + " " + "b".repeat(20) } as any);
  expect(cut).toBe(`fac-7 ${"a".repeat(245)}`);
  expect(Buffer.byteLength(`${cut}.md`)).toBeLessThanOrEqual(255);
  expect(episodeTitle(repo, { id: 7, title: "ship it" } as any)).toBe("fac-7 ship it");
});

test("an unreachable Langfuse does not block the page", async () => {
  const id = add("ship it");
  land(id);
  run("20261028-100000-fac-1-agent", { todo: id });
  process.env.LANGFUSE_BASE_URL = "http://127.0.0.1:1";
  const r = await writeEpisodes([loadRegistry().fac]);
  expect(r.failed).toEqual([]);
  expect(existsSync(join(base, "vault", "wiki", "episodes"))).toBe(true);
  expect(readFileSync(join(base, "vault", "wiki", "episodes", pages()[0]), "utf8")).toContain("Langfuse unreachable");
});
