import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeList } from "../../../issues/lib/store.ts";
import * as issues from "../../../issues/lib/todo.ts";
import { addPart } from "../../../issues/lib/parts.fixture.ts";
import { episodeTitle, KEEP_DAYS, writeEpisodes } from "./episode.ts";
import { loadRegistry, type Run } from "../records/ledger.ts";
import { seed } from "../../job.testkit.ts";
import { clock, today } from "../../../vault/lib/vault.ts";
import { factoryRepos, vault } from "../../../tests/git-fixture.ts";
import { writeRepos } from "../../../tests/projects.ts";

const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
function sh(cwd: string, ...args: string[]): string {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
  return p.stdout.toString().trim();
}

const KEYS = ["ALEPH_DB", "ALEPH_ITEMS", "ALEPH_JOBS_DIR", "ALEPH_FACTORY_DIR", "ALEPH_VAULT", "LANGFUSE_BASE_URL", "LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY", "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"];
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
    ALEPH_ITEMS: join(base, "items"), ALEPH_JOBS_DIR: join(base, "jobs"), ALEPH_DB: join(base, "aleph.db"),
    ALEPH_FACTORY_DIR: join(base, "factory"), ALEPH_VAULT: join(base, "vault"),
    LANGFUSE_BASE_URL: `http://127.0.0.1:${server.port}`, LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk",
  });
  factoryRepos(base);
  writeRepos({ fac: { path: join(base, "repo"), sandbox: true, autoland: false } }, join(base, "items"));
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
  sh(repo, "git", "commit", "-q", "-m", `ship thing ${id}`, "-m", `Issue: issue.${id}`);
  sh(repo, "git", "push", "-q", "origin", "main");
  return sh(repo, "git", "rev-parse", "HEAD");
};

const run = (o: Partial<Run>): void => {
  seed({ role: "build", name: "fac-1", repo: "fac", state: "landed", started: hoursAgo(1), ended: hoursAgo(0.5), ...o });
};

const NOW = new Date("2026-11-04T12:00:00Z").getTime();
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString();
const episodes = () => join(base, "factory", "episodes");
const section = (text: string, name: string) => text.split(`## ${name}\n`)[1].split("\n## ")[0];
const pages = () => readdirSync(episodes()).filter((f) => f.endsWith(".md"));

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
  run({ target: `issue.${id}` });
  process.env.LANGFUSE_BASE_URL = "http://127.0.0.1:1";
  const r = await writeEpisodes([loadRegistry().fac]);
  expect(r.failed).toEqual([]);
  expect(readFileSync(join(episodes(), pages()[0]), "utf8")).toContain("Langfuse unreachable");
});

test("a done issue gets a page in the factory's episodes folder and no vault commit", async () => {
  const id = add("ship it");
  land(id);
  run({ target: `issue.${id}` });
  const head = sh(join(base, "vault"), "git", "rev-parse", "HEAD");
  const r = await writeEpisodes([loadRegistry().fac]);
  expect(r).toEqual({ written: [`fac-${id} ship it`], failed: [] });
  expect(pages()).toEqual([`fac-${id} ship it.md`]);
  expect(sh(join(base, "vault"), "git", "rev-parse", "HEAD")).toBe(head);
  expect(existsSync(join(base, "vault", "wiki", "episodes"))).toBe(false);
});

test(`a page older than ${KEEP_DAYS} days is deleted, and an issue whose last run ended before then gets no page`, async () => {
  const old = add("old one"), fresh = add("fresh one");
  land(old);
  land(fresh);
  run({ target: `issue.${old}`, started: hoursAgo(24 * (KEEP_DAYS + 1)), ended: hoursAgo(24 * (KEEP_DAYS + 1) - 1) });
  run({ target: `issue.${fresh}` });
  mkdirSync(episodes(), { recursive: true });
  const stale = join(episodes(), "fac-99 gone.md");
  writeFileSync(stale, "x\n");
  const then = (NOW - (KEEP_DAYS + 1) * 86400_000) / 1000;
  utimesSync(stale, then, then);
  const use = join(base, "factory", "episode-use.jsonl");
  const line = (date: string) => JSON.stringify({ date, title: "t", event: "shown", session: null }) + "\n";
  writeFileSync(use, line("2000-01-01") + line(today()));
  const r = await writeEpisodes([loadRegistry().fac]);
  expect(r).toEqual({ written: [`fac-${fresh} fresh one`], failed: [] });
  expect(pages()).toEqual([`fac-${fresh} fresh one.md`]);
  const v = join(base, "vault");
  const daily = readFileSync(join(v, "daily", `${today()}.md`), "utf8");
  expect(daily.split("\n").filter((l) => l.includes("prune episodes"))).toEqual([`- ${clock()} prune episodes before ${today(new Date(NOW - KEEP_DAYS * 86400_000))} — 1 pages older than ${KEEP_DAYS} days`]);
  expect(sh(v, "git", "status", "--porcelain", "--", "daily")).toBe("");
  expect(readFileSync(use, "utf8")).toBe(line(today()));
});

/** Adds a top-level issue and `titles.length` parts under it, all done with a landed commit and a run. */
const addParts = (titles: string[]): { parent: number; ids: number[] } => {
  const { parent, ids } = writeList({ key: "fac" }, "add", (doc) => {
    const top = issues.add(doc, "the big one", { spec: "## Goal\nShip it." });
    return { parent: top.id, ids: titles.map((title) => addPart(doc, top, { title, spec: "## Goal\nShip it." }).id) };
  }, true)!.value;
  ids.forEach((id) => {
    land(String(id));
    run({ target: `issue.${id}` });
  });
  return { parent, ids };
};

test("two done parts of one issue get a page each, named by their refs", async () => {
  const { parent, ids } = addParts(["first part", "second part"]);
  const repo = loadRegistry().fac;
  const r = await writeEpisodes([repo]);
  expect(r.failed).toEqual([]);
  expect(pages().filter((f) => f.startsWith(`fac-${ids[0]} `)).length).toBe(1);
  expect(pages().filter((f) => f.startsWith(`fac-${ids[1]} `)).length).toBe(1);
  expect(pages().filter((f) => f.startsWith(`fac-${parent} `)).length).toBe(0);
  const text = readFileSync(join(episodes(), pages().find((f) => f.startsWith(`fac-${ids[1]} `))!), "utf8");
  expect(section(text, "Cost")).toContain("1234");
  const again = await writeEpisodes([repo]);
  expect(again.written).toEqual([]);
  expect(again.failed).toEqual([]);
  expect(pages().length).toBe(2);
});
