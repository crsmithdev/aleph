import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeList } from "../../../issues/lib/store.ts";
import * as issues from "../../../issues/lib/todo.ts";
import { episodeTitle, KEEP_DAYS, writeEpisodes } from "./episode.ts";
import { loadRegistry, writeRun, type Run } from "../records/ledger.ts";
import { factoryRepos, vault } from "../../../tests/git-fixture.ts";

const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
function sh(cwd: string, ...args: string[]): string {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
  return p.stdout.toString().trim();
}

const KEYS = ["ALEPH_ISSUES", "ALEPH_REPOS", "ALEPH_JOBS_DIR", "ALEPH_FACTORY_DIR", "ALEPH_VAULT", "LANGFUSE_BASE_URL", "LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY", "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"];
let base: string;
let saved: Record<string, string | undefined>;
let server: ReturnType<typeof Bun.serve>;
let asked: string[];

beforeEach(() => {
  setSystemTime(NOW);
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
    ALEPH_ISSUES: join(base, "items"), ALEPH_REPOS: join(base, "repos.json"), ALEPH_JOBS_DIR: join(base, "jobs"),
    ALEPH_FACTORY_DIR: join(base, "factory"), ALEPH_VAULT: join(base, "vault"),
    LANGFUSE_BASE_URL: `http://127.0.0.1:${server.port}`, LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk",
  });
  factoryRepos(base);
  writeFileSync(join(base, "repos.json"), JSON.stringify({ fac: { path: join(base, "repo"), sandbox: true, autoland: false } }));
  vault(join(base, "vault"));
});

afterEach(() => {
  setSystemTime();
  server.stop(true);
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(base, { recursive: true, force: true });
});

const add = (title: string, o: { done?: boolean } = {}): number =>
  writeList({ key: "fac" }, "add", (doc) => {
    const item = issues.add(doc, title, { spec: "## Goal\nShip it." });

    if (o.done) issues.setStatus(item, "done");
    return item.id;
  }, true)!.value;

const land = (id: number | string): string => {
  const repo = join(base, "repo");
  writeFileSync(join(repo, `f${id}.txt`), "x\n");
  sh(repo, "git", "add", ".");
  sh(repo, "git", "commit", "-q", "-m", `ship thing ${id}`, "-m", `Issue: fac-${id}`);
  sh(repo, "git", "push", "-q", "origin", "main");
  return sh(repo, "git", "rev-parse", "HEAD");
};

const run = (id: string, o: Partial<Run>): void => {
  const folder = join(base, "jobs", id);
  mkdirSync(folder, { recursive: true });
  writeRun(folder, { kind: "build", job: id, name: "fac-1", repo: "fac", condition: "landed", told: true, started: hoursAgo(1), ended: hoursAgo(0.5), ...o });
};

const NOW = new Date("2026-11-04T12:00:00Z").getTime();
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString();
const episodes = () => join(base, "factory", "episodes");
const pages = () => readdirSync(episodes()).filter((f) => f.endsWith(".md"));
const section = (text: string, name: string) => text.split(`## ${name}\n`)[1].split("\n## ")[0];

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

test("an unreachable Langfuse does not block the page", async () => {
  const id = add("ship it");
  land(id);
  run("20261028-100000-fac-1-agent", { on: `fac-${id}` });
  process.env.LANGFUSE_BASE_URL = "http://127.0.0.1:1";
  const r = await writeEpisodes([loadRegistry().fac]);
  expect(r.failed).toEqual([]);
  expect(readFileSync(join(episodes(), pages()[0]), "utf8")).toContain("Langfuse unreachable");
});

test("a done goal gets a page in the factory's episodes folder and no vault commit", async () => {
  const id = add("ship it");
  land(id);
  run("20261028-100000-fac-1-agent", { on: `fac-${id}` });
  const head = sh(join(base, "vault"), "git", "rev-parse", "HEAD");
  const r = await writeEpisodes([loadRegistry().fac]);
  expect(r).toEqual({ written: [`fac-${id} ship it`], failed: [] });
  expect(pages()).toEqual([`fac-${id} ship it.md`]);
  expect(sh(join(base, "vault"), "git", "rev-parse", "HEAD")).toBe(head);
  expect(existsSync(join(base, "vault", "wiki", "episodes"))).toBe(false);
});

test(`a page older than ${KEEP_DAYS} days is deleted, and a goal whose last run ended before then gets no page`, async () => {
  const old = add("old one"), fresh = add("fresh one");
  land(old);
  land(fresh);
  run("20261001-100000-fac-1-agent", { on: `fac-${old}`, started: hoursAgo(24 * (KEEP_DAYS + 1)), ended: hoursAgo(24 * (KEEP_DAYS + 1) - 1) });
  run("20261028-100000-fac-1-agent", { on: `fac-${fresh}` });
  mkdirSync(episodes(), { recursive: true });
  const stale = join(episodes(), "fac-99 gone.md");
  writeFileSync(stale, "x\n");
  const then = (NOW - (KEEP_DAYS + 1) * 86400_000) / 1000;
  utimesSync(stale, then, then);
  const r = await writeEpisodes([loadRegistry().fac]);
  expect(r).toEqual({ written: [`fac-${fresh} fresh one`], failed: [] });
  expect(pages()).toEqual([`fac-${fresh} fresh one.md`]);
});

/** Adds a top-level issue and `titles.length` parts under it, all done with a landed commit and a run. */
const addParts = (titles: string[]): number => {
  const parent = writeList({ key: "fac" }, "add", (doc) => {
    const top = issues.add(doc, "the big one", { spec: "## Goal\nShip it." });
    for (const title of titles) issues.addPart(doc, top, { title, spec: "## Goal\nShip it." });
    return top.id;
  }, true)!.value;
  titles.forEach((_, i) => {
    land(`${parent}.${i + 1}`);
    run(`20261028-1000${String(i).padStart(2, "0")}-fac-1-agent`, { on: `fac-${parent}.${i + 1}` });
  });
  return parent;
};

test("two done parts of one issue get a page each, named by their refs", async () => {
  const parent = addParts(["first part", "second part"]);
  const repo = loadRegistry().fac;
  const r = await writeEpisodes([repo]);
  expect(r.failed).toEqual([]);
  expect(pages().filter((f) => f.startsWith(`fac-${parent}.1 `)).length).toBe(1);
  expect(pages().filter((f) => f.startsWith(`fac-${parent}.2 `)).length).toBe(1);
  expect(pages().filter((f) => f.startsWith(`fac-${parent} `)).length).toBe(0);
  const text = readFileSync(join(episodes(), pages().find((f) => f.startsWith(`fac-${parent}.2 `))!), "utf8");
  expect(section(text, "Cost")).toContain("1234");
  const again = await writeEpisodes([repo]);
  expect(again.written).toEqual([]);
  expect(again.failed).toEqual([]);
  expect(pages().length).toBe(2);
});
