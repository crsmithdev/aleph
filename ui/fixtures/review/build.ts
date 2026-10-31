/**
 * Lays the review fixture out as an aleph home: `bun ui/fixtures/review/build.ts <dest> [src]` writes
 * `<dest>/{repos.json,jobs,items,vault}` from the plain files beside this one (or from `src`) and prints
 * the ALEPH_* variables that point at them. The work store needs a git repo, so it is made here, not kept in git.
 * Times in the run folders are written against ANCHOR and moved so the newest sits a few hours back from now.
 */
import { copyFileSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { writeList } from "../../../todo/lib/store.ts";
import { addLegacy as add, note, setStatus } from "../../../todo/lib/todo.ts";

const ANCHOR = Date.parse("2026-10-28T12:00:00Z");
const IDENT = { GIT_AUTHOR_NAME: "fixture", GIT_AUTHOR_EMAIL: "fixture@example.com", GIT_COMMITTER_NAME: "fixture", GIT_COMMITTER_EMAIL: "fixture@example.com" };

function sh(cwd: string, ...args: string[]): void {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...IDENT }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
}

/** The text of a regular file; a link, however it points, is not read. */
function readPlain(file: string): string {
  if (!lstatSync(file).isFile()) throw new Error(`fixture file ${file} is not a regular file`);
  return readFileSync(file, "utf8");
}

/** Copy the regular files and folders under `from`; links and other entries are left out, so nothing outside `from` is reached. */
function copyPlain(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    const a = join(from, name), st = lstatSync(a);
    if (st.isDirectory()) copyPlain(a, join(to, name));
    else if (st.isFile()) copyFileSync(a, join(to, name));
  }
}

interface FixtureItem { title: string; labels?: string[]; priority?: string; body?: string; status?: string; waitingOn?: string; due?: string; notes?: string[];
  /** The new-shape fields, written as the item's own: `kind`, `source`, `issue`, `goals`, `after`, `areas`, `ask` and the ask's `reason` and `question`. */
  kind?: string; source?: string; issue?: string; goals?: string[]; after?: string[]; areas?: string[]; ask?: string; reason?: string; question?: string }

const NEW_SHAPE = ["kind", "source", "issue", "goals", "after", "areas", "ask", "reason", "question"] as const;

/** Build the home under `dest` from `src`; returns the environment that points aleph at it. */
export function buildReviewFixture(dest: string, src = import.meta.dir): Record<string, string> {
  dest = resolve(dest);
  mkdirSync(dest, { recursive: true });
  // Project paths are never read from the fixture: each is `<dest>/repos/<key>`, so git runs only inside dest.
  const named: Record<string, { checks?: unknown }> = JSON.parse(readPlain(join(src, "repos.json")));
  const registry: Record<string, unknown> = {};
  for (const [key, r] of Object.entries(named)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(key)) throw new Error(`fixture project name ${JSON.stringify(key)} is not a plain name`);
    registry[key] = { path: join(dest, "repos", key), main: "main", sandbox: true, checks: r.checks ?? [] };
  }
  writeFileSync(join(dest, "repos.json"), JSON.stringify(registry, null, 2) + "\n");
  // Each project is a git repo with one commit, so the pages that read a repo's log and branches find one.
  for (const r of Object.values(registry) as { path: string }[]) {
    mkdirSync(r.path, { recursive: true });
    sh(r.path, "git", "init", "-q", "-b", "main");
    sh(r.path, "git", "commit", "-q", "--allow-empty", "-m", "start");
    sh(r.path, "git", "update-ref", "refs/remotes/origin/main", "HEAD");
  }
  const shift = Date.now() - 2 * 3600_000 - ANCHOR;
  copyPlain(join(src, "jobs"), join(dest, "jobs"));
  for (const id of readdirSync(join(dest, "jobs"))) {
    const file = join(dest, "jobs", id, "state.json");
    let run;
    try { run = JSON.parse(readPlain(file)); } catch { continue; }
    for (const k of ["started", "ended"]) if (run[k]) run[k] = new Date(Date.parse(run[k]) + shift).toISOString();
    writeFileSync(file, JSON.stringify(run, null, 2) + "\n");
  }
  mkdirSync(join(dest, "vault"), { recursive: true });
  if (lstatSync(join(src, "vault"), { throwIfNoEntry: false })?.isDirectory()) copyPlain(join(src, "vault"), join(dest, "vault"));
  const remote = join(dest, "items.git"), items = join(dest, "items");
  sh(dest, "git", "init", "-q", "--bare", "-b", "main", remote);
  sh(dest, "git", "clone", "-q", remote, items);
  sh(items, "git", "commit", "-q", "--allow-empty", "-m", "start");
  sh(items, "git", "push", "-q", "origin", "main");
  const env = { ALEPH_JOBS_DIR: join(dest, "jobs"), ALEPH_REPOS: join(dest, "repos.json"), ALEPH_ITEMS: items, ALEPH_VAULT: join(dest, "vault") };
  const saved = { ...process.env };
  Object.assign(process.env, IDENT, env);
  try {
    const lists: Record<string, FixtureItem[]> = JSON.parse(readPlain(join(src, "items.json")));
    for (const [key, rows] of Object.entries(lists)) {
      writeList({ key }, "fixture", (doc) => {
        for (const r of rows) {
          const item = add(doc, r.title, { labels: r.labels, priority: r.priority, body: r.body, waitingOn: r.waitingOn, due: r.due });
          for (const k of NEW_SHAPE) if (r[k] !== undefined) item.fm[k] = r[k];
          for (const n of r.notes ?? []) note(item, n);
          if (r.status && r.status !== "open") setStatus(item, r.status as "done" | "dropped");
        }
        return true;
      }, true);
    }
  } finally {
    for (const k of Object.keys(env)) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
  return env;
}

if (import.meta.main) {
  const [dest, src] = process.argv.slice(2);
  if (!dest) { console.error("usage: bun build.ts <dest> [src]"); process.exit(2); }
  for (const [k, v] of Object.entries(buildReviewFixture(dest, src))) console.log(`${k}=${v}`);
}
