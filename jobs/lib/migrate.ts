/**
 * `aleph migrate`: the work-model migration (docs/specs/2026-10-30-work-model.md,
 * "Migration rules" and "Migration mapping"). `plan()` reads the old store and
 * ledger and says what each becomes; `dryRun` reports each old item's old status
 * and new stage and fails on a pair outside the mapping table; `apply` backs up,
 * writes the store as one commit, rewrites the ledger's state files and the
 * factory's files, then renames the folders; `undo` puts the backup back.
 *
 * The roots come from the environment, as the rest of aleph reads them:
 * ALEPH_ITEMS (the store, becomes ALEPH_ISSUES or a sibling `issues`),
 * ALEPH_JOBS_DIR (the ledger), ALEPH_RUNS_DIR (the sandbox folders), ALEPH_FACTORY_DIR,
 * ALEPH_SANDBOX_DIR (where the sandbox folders go, default a sibling `sandbox`),
 * ALEPH_BACKUPS_DIR (default a sibling `backups` of the factory folder).
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { expand, isLive, readReview2, readRun, stamp, type Ask, type Entry, type Run } from "./ledger.ts";
import { isOpen, lastReal } from "./job.ts";
import { fetchOrigin, followMain, git, treeWithFiles } from "./git.ts";
import { runViewOf, stage, type Ctx, type Subject } from "./stage.ts";
import * as store from "../../todo/lib/store.ts";
import * as todos from "../../todo/lib/todo.ts";
import { serializeFrontmatter, type Frontmatter } from "../../vault/lib/frontmatter.ts";

export class MigrateRefusal extends Error {}
const refuse = (m: string): never => { throw new MigrateRefusal(m); };

export interface Roots { store: string; issues: string; ledger: string; sandboxOld: string; sandbox: string; factory: string; backups: string }

export function roots(): Roots {
  const items = expand(process.env.ALEPH_ITEMS ?? "~/.aleph/items");
  const old = expand(process.env.ALEPH_RUNS_DIR ?? "~/.aleph/runs");
  const factory = expand(process.env.ALEPH_FACTORY_DIR ?? "~/.aleph/factory");
  return {
    store: items, issues: expand(process.env.ALEPH_ISSUES ?? join(dirname(items), "issues")),
    ledger: expand(process.env.ALEPH_JOBS_DIR ?? "~/.aleph/jobs"), sandboxOld: old,
    sandbox: expand(process.env.ALEPH_SANDBOX_DIR ?? join(dirname(old), "sandbox")),
    factory, backups: expand(process.env.ALEPH_BACKUPS_DIR ?? join(dirname(factory), "backups")),
  };
}

// The mapping.

const INPUT_REASONS = ["question", "manual", "no-commit", "part-dropped", "triage-failed", "host-check", "rescue"];
const OLD_NEEDS: Record<string, { kind: Ask["kind"]; reason: string }> = {
  held: { kind: "approval", reason: "held-path" }, review: { kind: "approval", reason: "review" },
  question: { kind: "input", reason: "question" }, manual: { kind: "input", reason: "manual" },
};
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);
const flat = (s: string): string => s.replace(/\s+/g, " ").replace(/"/g, "'").replace(/\\/g, "/").trim();

/** The stages an old status may become: the spec's mapping table. */
const TABLE: Record<string, string[]> = {
  "untriaged": ["new"], "sorted": ["triaged"], "waiting on Chris": ["awaiting"], "queued": ["queued", "blocked"], "building": ["building"],
  "landing": ["landing"], "needs you": ["awaiting"], "stuck": ["stuck"], "landed": ["landing"], "done": ["done"], "dropped": ["dropped"],
};
/** Pairs the table leaves out and the rules make: a proposal or a live check is sorted and gets an Ask; a planned item's stage is its goals'. */
const RULED: Record<string, string[]> = { "sorted+ask": ["awaiting"], "planned": ["building", "awaiting", "stuck", "done", "dropped"] };

export interface Row { repo: string; id: string; old: string; stage: string; ok: boolean }

interface New {
  repo: string; ref: string; num: number; item: todos.Item; fm: Frontmatter; kind: "goal" | "issue"; sorted: boolean;
  ask?: { kind: "input" | "approval"; reason: string }; goals: string[]; after: string[];
}

interface Plan {
  rows: Row[]; items: New[]; runs: { folder: string; before: Run; after: Run }[]; old: Map<string, { status: string; planned: boolean; ruled: boolean }>;
  repos: string[];
}

function repoKeys(dir: string): string[] {
  const ls = git(dir, "ls-tree", "--name-only", "origin/main");
  return ls.ok ? ls.out.split("\n").filter((k) => k && git(dir, "cat-file", "-e", `origin/main:${k}/backlog/config.yml`).ok) : [];
}

function oldRuns(ledger: string): Entry[] {
  if (!existsSync(ledger)) return [];
  const out: Entry[] = [];
  for (const id of readdirSync(ledger).sort()) {
    const run = readRun(join(ledger, id));
    if (run) out.push({ id, folder: join(ledger, id), run });
  }
  return out;
}

const jobsOf = (runs: Entry[]): Entry[][] => {
  const by = new Map<string, Entry[]>();
  for (const e of runs) by.set(e.run.job, [...(by.get(e.run.job) ?? []), e]);
  return [...by.values()];
};

/** What the old `itemStatus` of the UI said of an item: the ledger's open jobs and the item's labels. */
function oldStatus(item: todos.Item, mine: Entry[][]): string {
  const st = todos.status(item);
  if (st !== "open") return st;
  if (store.needsChris(item)) return "waiting on Chris";
  const open = mine.find((j) => isOpen(j) && !["triage", "plan", "facts"].includes(j.at(-1)!.run.kind));
  if (open) {
    const real = lastReal(open).run;
    return real.state === "needs-you" || real.state === "awaiting" ? "needs you" : real.state === "stuck" || real.state === "failed" ? "stuck" : real.kind === "land" ? "landing" : "building";
  }
  if (mine.some((j) => j.at(-1)!.run.state === "landed")) return "landed";
  if (store.hasLabel(item, "goal")) return "queued";
  return store.isSorted(item) ? "sorted" : "untriaged";
}

function askFields(fm: Frontmatter, kind: "input" | "approval", reason: string, fallback: string): void {
  const question = flat(typeof fm.question === "string" && fm.question ? fm.question : fallback);
  fm.ask = kind;
  fm.reason = reason;
  fm.question = question || "Waiting for you.";
}

/** The new item(s) one old item becomes. */
function convert(key: string, item: todos.Item, goalOf: Map<number, string>): New[] {
  const L = store.labels(item);
  const has = (l: string) => L.includes(l);
  const parent = /^Part of ([^\s,]+-\d+(?:\.\d+)?)\./.exec(item.body)?.[1] ?? null;
  const planned = has("planned");
  const asGoal = !planned && (parent !== null || has("goal"));
  const needs = store.needsChris(item);
  const old = store.askOf(item);
  const source = has("followup") ? "worker" : has("deps") ? "deps" : has("memory") ? "memory" : "chris";
  const waits = list(item.fm.waiting_on).map((r) => { const m = /^(.+)-(\d+)$/.exec(r); return m ? goalOf.get(Number(m[2])) ?? r : r; });
  const areas = store.areasOf(item);

  let ask: New["ask"];
  const base: Frontmatter = {};
  for (const [k, v] of Object.entries(item.fm)) if (!["labels", "waiting_on", "kind", "options", "recommended", "why", "question", "reason", "ask"].includes(k)) base[k] = v;
  const decision: Frontmatter = {};
  for (const k of ["question", "options", "recommended", "why"]) if (item.fm[k] !== undefined) decision[k] = item.fm[k];
  const lastNote = (item.notes.at(-1) ?? "").replace(/^- \d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?:\s*/, "").replace(/^needs-chris:\s*/i, "");
  if (has("proposal")) ask = { kind: "approval", reason: "proposal" };
  else if (has("live-check")) ask = { kind: "input", reason: "host-check" };
  else if (needs) ask = { kind: "input", reason: INPUT_REASONS.includes(old?.reason ?? "") ? old!.reason : "question" };

  const make = (num: string, kind: "goal" | "issue", extra: Frontmatter, body: string, notes: string[]): New => {
    const fm: Frontmatter = { ...base, kind, source };
    Object.assign(fm, extra);
    if (areas.length) fm.areas = areas;
    const out: New = { repo: key, ref: `${key}-${num}`, num: item.id, item: { id: item.id, title: item.title, fm, body, notes, legacy: false }, fm, kind, sorted: false, goals: list(extra.goals), after: list(extra.after) };
    return out;
  };
  const withAsk = (n: New): New => {
    if (!ask) return n;
    Object.assign(n.fm, decision);
    askFields(n.fm, ask.kind, ask.reason, old?.question || lastNote || (ask.reason === "proposal" ? item.title : "Check this on the host."));
    n.ask = ask;
    return n;
  };
  const request = (body: string) => (/^##\s+Request\b/.test(body) ? body : `## Request\n\n${body}`.trimEnd());
  const sorted = store.isSorted(item) && !has("goal") && !needs && !has("proposal") && !has("live-check");
  const mark = (n: New): New => { if (sorted && has("triaged")) { n.fm.route = "triaged"; n.sorted = true; } return n; };

  if (parent && !planned) {
    const g = make(String(item.id), "goal", { issue: parent, ...(waits.length ? { after: waits } : {}) }, item.body, item.notes);
    return [withAsk(g)];
  }
  if (planned) return [withAsk(make(String(item.id), "issue", { goals: list(item.fm.waiting_on) }, request(item.body), item.notes))];
  if (asGoal) {
    const issue = make(String(item.id), "issue", { goals: [`${key}-${item.id}.1`] }, request(item.body), item.notes);
    const goal = make(`${item.id}.1`, "goal", { issue: `${key}-${item.id}`, ...(waits.length ? { after: waits } : {}) }, item.body, []);
    return [issue, withAsk(goal)];
  }
  return [mark(withAsk(make(String(item.id), "issue", {}, request(item.body), item.notes)))];
}

/** A run's new shape. `goalOf` says which items became an issue and a goal `.1`. */
function convertRun(run: Run, split: Set<string>): Run {
  const r: any = { ...run };
  const todo = r.todo;
  if (todo !== undefined && r.on === undefined && r.repo) {
    const ref = `${r.repo}-${todo}`;
    r.on = split.has(ref) && !["triage", "plan"].includes(r.kind) ? `${ref}.1` : ref;
  }
  delete r.todo;
  if (r.kind === "agent") r.kind = "build";
  if (r.state === "needs-you") r.state = "awaiting";
  if (r.needs !== undefined || r.state === "awaiting") {
    if (!r.ask) {
      const m = OLD_NEEDS[r.needs] ?? OLD_NEEDS.question;
      r.ask = { kind: m.kind, reason: m.reason, question: r.question ?? r.reason ?? "", options: [], why: r.stat ? [r.stat] : [] };
    }
    delete r.needs;
  }
  return r;
}

export function plan(r: Roots = roots()): Plan {
  if (!existsSync(r.store)) refuse(`no store at ${r.store}`);
  const fetched = fetchOrigin(r.store, "main");
  if (!fetched.ok) refuse(`store fetch failed: ${fetched.out}`);
  const repos = repoKeys(r.store);
  const runs = oldRuns(r.ledger);
  const jobs = jobsOf(runs);

  const items: New[] = [];
  const split = new Set<string>();
  const oldInfo = new Map<string, { status: string; planned: boolean; ruled: boolean }>();
  const rows: Row[] = [];
  const docs = repos.map((key) => ({ key, doc: store.readFetched({ key }) }));
  // Which old numbers become an issue with a goal `.1`, so a `waiting_on` can name the goal.
  const goalOf = new Map<number, string>();
  for (const { key, doc } of docs) for (const i of doc?.items ?? []) {
    const parent = /^Part of ([^\s,]+-\d+(?:\.\d+)?)\./.test(i.body);
    if (!store.hasLabel(i, "planned") && !parent && store.hasLabel(i, "goal")) { goalOf.set(i.id, `${key}-${i.id}.1`); split.add(`${key}-${i.id}`); }
  }
  for (const { key, doc } of docs) for (const i of doc?.items ?? []) {
    const mine = jobs.filter((j) => { const real = lastReal(j).run; return real.todo !== undefined && `${real.repo}-${real.todo}` === `${key}-${i.id}`; });
    const status = oldStatus(i, mine);
    const made = convert(key, i, goalOf);
    items.push(...made);
    oldInfo.set(`${key}-${i.id}`, { status, planned: store.hasLabel(i, "planned"), ruled: store.hasLabel(i, "proposal") || store.hasLabel(i, "live-check") });
  }

  const migrated = runs.map((e) => ({ folder: e.folder, before: e.run, after: convertRun(e.run, split) }));
  const newJobs = jobsOf(migrated.map((m) => ({ id: basename(m.folder), folder: m.folder, run: m.after })));

  const byRef = new Map(items.map((n) => [n.ref, n]));
  const subject = (n: New): Subject => ({ id: n.ref, status: todos.status(n.item), kind: n.kind, after: n.after, goals: n.goals, ...(n.ask ? { ask: n.ask } : {}), sorted: n.sorted });
  const subjects = new Map([...byRef].map(([ref, n]) => [ref, subject(n)]));
  const jobViews = new Map<string, ReturnType<typeof runViewOf>[]>();
  for (const j of newJobs) {
    const on = lastReal(j).run.on;
    if (on) jobViews.set(on, [...(jobViews.get(on) ?? []), runViewOf(j)]);
  }
  const ctx: Ctx = { main: "origin/main", landed: new Map(), reverted: new Set(), item: (ref) => subjects.get(ref), runs: (ref) => jobViews.get(ref) ?? [] };

  for (const n of items) {
    const info = oldInfo.get(n.ref) ?? oldInfo.get(`${n.repo}-${n.num}`)!;
    // An old goal that became an issue and its goal `.1` reports the goal's stage: that is the item's old self.
    if (n.kind === "issue" && n.goals.length === 1 && n.goals[0] === `${n.ref}.1`) continue;
    const s = stage(subjects.get(n.ref)!, ctx).stage;
    const allowed = [...(TABLE[info.status] ?? []), ...(info.status === "sorted" && info.ruled ? RULED["sorted+ask"] : []), ...(info.planned ? RULED.planned : [])];
    rows.push({ repo: n.repo, id: `${n.repo}-${n.num}`, old: info.status, stage: s, ok: allowed.includes(s) });
  }
  return { rows, items, runs: migrated, old: oldInfo, repos };
}

export function dryRun(r: Roots = roots()): { rows: Row[]; violations: Row[]; counts: Record<string, number> } {
  const p = plan(r);
  const counts: Record<string, number> = {};
  for (const row of p.rows) counts[`${row.old} -> ${row.stage}`] = (counts[`${row.old} -> ${row.stage}`] ?? 0) + 1;
  return { rows: p.rows, violations: p.rows.filter((x) => !x.ok), counts };
}

// Apply.

const cpDir = (from: string, to: string) => cpSync(from, to, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true });
const FACTORY_FILES = ["standing.json", "caps.json", "always.json"];

function renderNew(n: New): string {
  const { id: _, ...fields } = n.item.fm;
  const fm = serializeFrontmatter({ id: n.ref, title: n.item.title, ...fields, repo: n.repo } as Frontmatter);
  const block: string[] = [];
  if (n.item.body.trim()) block.push(n.item.body.replace(/\n+$/, ""));
  if (n.item.notes.length) block.push(["### Notes", "", ...n.item.notes].join("\n"));
  return fm + (block.length ? "\n" + block.join("\n\n") + "\n" : "");
}

const liveRun = (ledger: string): string | undefined => oldRuns(ledger).find((e) => isLive(e.folder))?.id;

export function apply(r: Roots = roots()): { backup: string; commit: string; items: number; runs: number } {
  if (!existsSync(join(r.factory, "paused"))) refuse("the factory is not paused: run `aleph pause` first");
  const live = liveRun(r.ledger);
  if (live) refuse(`a run is live: ${live}`);
  if (existsSync(r.issues) || existsSync(r.sandbox)) refuse(`${existsSync(r.issues) ? r.issues : r.sandbox} already exists: has the migration run?`);
  const p = plan(r);
  const bad = p.rows.filter((x) => !x.ok);
  if (bad.length) refuse(`${bad.length} item(s) have a status/stage pair outside the mapping table; run --dry-run`);

  // Back up first: the store checkout, the ledger's state files, and the factory's files.
  const time = stamp(todos.clock());
  const backup = join(r.backups, `${time}-migrate`);
  if (existsSync(backup)) refuse(`${backup} already exists`);
  mkdirSync(join(backup, "ledger"), { recursive: true });
  cpDir(r.store, join(backup, "store"));
  for (const m of p.runs) {
    mkdirSync(join(backup, "ledger", basename(m.folder)), { recursive: true });
    writeFileSync(join(backup, "ledger", basename(m.folder), "state.json"), readFileSync(join(m.folder, "state.json")));
  }
  const had: string[] = [];
  mkdirSync(join(backup, "factory"), { recursive: true });
  for (const f of FACTORY_FILES) if (existsSync(join(r.factory, f))) { had.push(f); writeFileSync(join(backup, "factory", f), readFileSync(join(r.factory, f))); }

  // The store: one commit on origin/main.
  const files: Record<string, string> = {};
  for (const n of p.items) files[`${n.repo}/backlog/tasks/${n.ref}.md`] = renderNew(n);
  const base = git(r.store, "rev-parse", "origin/main").out;
  const tree = treeWithFiles(r.store, `${base}^{tree}`, files);
  const commit = git(r.store, "commit-tree", tree, "-p", base, "-m", `migrate: work model, ${p.items.length} items`);
  if (!commit.ok) throw new Error(`commit-tree failed: ${commit.out}`);
  // Written before the push: undo needs both commits to roll origin back through git.
  writeFileSync(join(backup, "meta.json"), JSON.stringify({ time, roots: r, had, hadSandbox: existsSync(r.sandboxOld), preCommit: base, applyCommit: commit.out }, null, 2) + "\n");
  const push = git(r.store, "push", "-q", "origin", `${commit.out}:refs/heads/main`);
  if (!push.ok) throw new Error(`push refused: ${push.out}`);
  const follow = followMain(r.store, "main");
  if (follow) console.error(`warn: ${follow}`);

  // The ledger's state files: the new shape, and the review of a review2.md.
  let changed = 0;
  for (const m of p.runs) {
    const review = m.after.review === undefined ? readReview2(m.folder) : undefined;
    const out: Run = review && (review.verdict === "land" || review.verdict === "back" || review.verdict === "chris")
      ? { ...m.after, review: { call: review.verdict === "chris" ? "ask" : review.verdict, ...(review.reason !== undefined ? { reason: review.reason } : {}) } } : m.after;
    if (JSON.stringify(out) === JSON.stringify(m.before)) continue;
    writeFileSync(join(m.folder, "state.json"), JSON.stringify(out, null, 2) + "\n");
    changed++;
  }

  // The factory's files.
  const standing = join(r.factory, "standing.json");
  if (existsSync(standing)) {
    const RENAME: Record<string, string> = { "held": "held-path", "triage-no-verdict": "triage-failed", "decision": "question" };
    const old = JSON.parse(readFileSync(standing, "utf8"));
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(old)) next[RENAME[k] ?? k] = v;
    writeFileSync(join(r.factory, "always.json"), JSON.stringify(next, null, 2) + "\n");
    rmSync(standing);
  }
  const caps = join(r.factory, "caps.json");
  if (existsSync(caps)) {
    const old = JSON.parse(readFileSync(caps, "utf8"));
    if (old && typeof old === "object" && "waiting" in old) {
      const next: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(old)) next[k === "waiting" ? "awaiting" : k] = v;
      writeFileSync(caps, JSON.stringify(next, null, 2) + "\n");
    }
  }

  // The folders, in the spec's order: the sandbox, then the ledger, then the store.
  if (existsSync(r.sandboxOld)) renameSync(r.sandboxOld, r.sandbox);
  if (existsSync(r.ledger)) renameSync(r.ledger, r.sandboxOld);
  renameSync(r.store, r.issues);
  return { backup, commit: commit.out, items: p.items.length, runs: changed };
}

export function undo(time: string, r: Roots = roots()): { backup: string } {
  const backup = join(r.backups, time.endsWith("-migrate") ? time : `${time}-migrate`);
  if (!existsSync(join(backup, "meta.json"))) refuse(`no backup at ${backup}`);
  const meta = JSON.parse(readFileSync(join(backup, "meta.json"), "utf8")) as { roots: Roots; had: string[]; hadSandbox: boolean; preCommit: string; applyCommit: string };
  const o = meta.roots;

  // Origin first, before anything changes: undo only goes on when origin's main is the commit apply pushed.
  const live = existsSync(o.issues) ? o.issues : o.store;
  const url = git(live, "remote", "get-url", "origin");
  if (!url.ok) refuse(`the store has no origin: ${url.out}`);
  const remote = url.out.includes("://") || url.out.includes("@") || isAbsolute(url.out) ? url.out : resolve(live, url.out);
  const head = git(live, "ls-remote", "origin", "refs/heads/main");
  if (!head.ok) refuse(`cannot read origin: ${head.out}`);
  const tip = head.out.split(/\s/)[0];
  if (tip !== meta.applyCommit) {
    // Fetch into a scratch repo, so a refusal leaves the store as it was.
    const scratch = mkdtempSync(join(tmpdir(), "aleph-undo-"));
    try {
      git(scratch, "init", "-q", "--bare");
      const got = git(scratch, "fetch", "-q", remote, "refs/heads/main");
      const later = got.ok ? git(scratch, "log", "--format=%h %s", `${meta.applyCommit}..FETCH_HEAD`).out.split("\n").filter(Boolean) : [];
      refuse(`origin main is ${tip.slice(0, 7)}, not the apply commit ${meta.applyCommit.slice(0, 7)}; commits after the apply:${later.length ? "\n" + later.join("\n") : ` ${tip.slice(0, 7)}`}`);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }

  // Reverse the renames, then put the saved bytes back.
  if (existsSync(o.issues) && !existsSync(o.store)) renameSync(o.issues, o.store);
  if (existsSync(o.sandboxOld) && !existsSync(o.ledger)) renameSync(o.sandboxOld, o.ledger);
  if (meta.hadSandbox && existsSync(o.sandbox) && !existsSync(o.sandboxOld)) renameSync(o.sandbox, o.sandboxOld);
  rmSync(o.store, { recursive: true, force: true });
  cpDir(join(backup, "store"), o.store);
  // Origin: one new commit on the apply commit, with the pre-apply tree. A plain push, so a push made since is refused.
  const fetched = fetchOrigin(o.store, "main");
  if (!fetched.ok) throw new Error(`store fetch failed: ${fetched.out}`);
  const back = git(o.store, "commit-tree", `${meta.preCommit}^{tree}`, "-p", meta.applyCommit, "-m", `migrate: undo, back to ${meta.preCommit.slice(0, 7)}`);
  if (!back.ok) throw new Error(`commit-tree failed: ${back.out}`);
  const push = git(o.store, "push", "-q", "origin", `${back.out}:refs/heads/main`);
  if (!push.ok) throw new Error(`push refused: ${push.out}`);
  const follow = followMain(o.store, "main");
  if (follow) console.error(`warn: ${follow}`);
  for (const id of readdirSync(join(backup, "ledger"))) {
    if (statSync(join(backup, "ledger", id)).isDirectory() && existsSync(join(o.ledger, id))) writeFileSync(join(o.ledger, id, "state.json"), readFileSync(join(backup, "ledger", id, "state.json")));
  }
  for (const f of FACTORY_FILES) {
    if (meta.had.includes(f)) writeFileSync(join(o.factory, f), readFileSync(join(backup, "factory", f)));
    else rmSync(join(o.factory, f), { force: true });
  }
  return { backup };
}
