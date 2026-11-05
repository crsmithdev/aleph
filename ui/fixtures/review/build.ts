/**
 * Lays the review fixture out as an aleph home: `bun ui/fixtures/review/build.ts <dest> [src]` writes
 * `<dest>/{repos.json,jobs,items,vault}` from the plain files beside this one (or from `src`) and prints
 * the ALEPH_* variables that point at them. The work store needs a git repo, so it is made here, not kept in git.
 * Times in the run folders are written against ANCHOR and moved so the newest sits a few hours back from now.
 */
import { copyFileSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { writeList } from "../../../todo/lib/store.ts";
import { add, addPart, note, setStatus } from "../../../todo/lib/todo.ts";
import { putRun, setIssueAsk } from "../../../jobs/lib/record.ts";

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

interface FixtureItem { title: string; labels?: string[]; priority?: string; body?: string; status?: string; due?: string; notes?: string[]; parts?: { title: string; spec: string; status?: string }[];
  /** The new-shape fields, written as the item's own: `kind`, `source`, `route`, `issue`, `goals`, `after`, `areas`, `ask` and the ask's `reason` and `question`. */
  kind?: string; source?: string; route?: string; issue?: string; goals?: string[]; after?: string[]; areas?: string[]; ask?: string; reason?: string; question?: string; situation?: string; effects?: string[]; recommend?: string }

const NEW_SHAPE = ["kind", "source", "route", "issue", "goals", "after", "areas", "ask", "reason", "question", "situation", "effects", "recommend"] as const;

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
  // Each also gets a bare `origin` under `<dest>/remotes/<key>.git`, so `git fetch origin` works.
  for (const [key, r] of Object.entries(registry) as [string, { path: string }][]) {
    const bare = join(dest, "remotes", `${key}.git`);
    mkdirSync(r.path, { recursive: true });
    mkdirSync(join(dest, "remotes"), { recursive: true });
    sh(r.path, "git", "init", "-q", "-b", "main");
    sh(r.path, "git", "commit", "-q", "--allow-empty", "-m", "start");
    sh(dest, "git", "init", "-q", "--bare", "-b", "main", bare);
    sh(r.path, "git", "remote", "add", "origin", bare);
    sh(r.path, "git", "push", "-q", "-u", "origin", "main");
  }
  const shift = Date.now() - 2 * 3600_000 - ANCHOR;
  copyPlain(join(src, "jobs"), join(dest, "jobs"));
  // The fixture keeps each run as a state.json; the copy keeps it in its job record, where the ledger reads it.
  const records = process.env.ALEPH_RECORDS_DIR;
  process.env.ALEPH_RECORDS_DIR = join(dest, "jobs", ".records");
  try {
    for (const id of readdirSync(join(dest, "jobs"))) {
      const file = join(dest, "jobs", id, "state.json");
      let run;
      try { run = JSON.parse(readPlain(file)); } catch { continue; }
      for (const k of ["started", "ended"]) if (run[k]) run[k] = new Date(Date.parse(run[k]) + shift).toISOString();
      putRun(id, run);
      rmSync(file);
    }
  } finally {
    if (records === undefined) delete process.env.ALEPH_RECORDS_DIR; else process.env.ALEPH_RECORDS_DIR = records;
  }
  mkdirSync(join(dest, "vault"), { recursive: true });
  if (lstatSync(join(src, "vault"), { throwIfNoEntry: false })?.isDirectory()) copyPlain(join(src, "vault"), join(dest, "vault"));
  const remote = join(dest, "items.git"), items = join(dest, "items");
  sh(dest, "git", "init", "-q", "--bare", "-b", "main", remote);
  sh(dest, "git", "clone", "-q", remote, items);
  sh(items, "git", "commit", "-q", "--allow-empty", "-m", "start");
  sh(items, "git", "push", "-q", "origin", "main");
  // The factory folder is under dest too, so a tick run with this environment never writes to the live ~/.aleph/factory.
  const env = { ALEPH_JOBS_DIR: join(dest, "jobs"), ALEPH_REPOS: join(dest, "repos.json"), ALEPH_ISSUES: items, ALEPH_VAULT: join(dest, "vault"), ALEPH_FACTORY_DIR: join(dest, "factory") };
  const saved = { ...process.env };
  Object.assign(process.env, IDENT, env);
  try {
    const lists: Record<string, FixtureItem[]> = JSON.parse(readPlain(join(src, "items.json")));
    for (const [key, rows] of Object.entries(lists)) {
      writeList({ key }, "fixture", (doc) => {
        for (const r of rows) {
          // A goal or a sorted item in the fixture is an issue with a spec.
          const spec = r.kind === "goal" || r.route;
          const item = add(doc, r.title, { labels: r.labels, priority: r.priority, ...(spec ? { spec: r.body || "Do it." } : { request: r.body }) });
          for (const k of NEW_SHAPE) if (r[k] !== undefined) item.fm[k] = r[k];
          // Status reads the Ask from the job record store, so the fixture's ask is stored there.
          if (r.ask) {
            const [action, why = ""] = (r.recommend ?? "").split(" :: ");
            setIssueAsk(`${key}-${item.id}`, {
              kind: r.ask as "input" | "approval", reason: r.reason ?? "", question: r.question ?? "", options: [], why: [],
              situation: r.situation,
              effects: (r.effects ?? []).map((e) => { const [a, ...t] = e.split(" :: "); return { action: a, text: t.join(" :: ") }; }),
              recommend: { action, why },
            });
          }
          for (const n of r.notes ?? []) note(item, n);
          if (r.status && r.status !== "open") setStatus(item, r.status as "done" | "dropped");
          for (const p of r.parts ?? []) {
            const part = addPart(doc, item, { title: p.title, spec: p.spec });
            if (p.status && p.status !== "open") setStatus(part, p.status as "done" | "dropped");
          }
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
