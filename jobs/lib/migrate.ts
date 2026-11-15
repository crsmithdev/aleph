/**
 * `aleph migrate storage`: moves the old store (docs/specs/2026-11-14-storage-ids.md, Branch 1 step 8) to the new one:
 * the items repo, `aleph.db` and `jobs/<n>/`. `plan` reads the old files and decides every row and file without
 * writing; `--dry-run` prints its counts and the keys it has no rule for, and a real run refuses while there is one.
 * `aleph migrate cleanup` (step 9) deletes the old files once the check passed. All paths come from `lib/layout.ts`
 * and `ALEPH_DB`, so the tool runs on a copy of the store.
 */
import { existsSync, linkSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { conn, dbFile } from "../../lib/db.ts";
import { today } from "../../lib/day.ts";
import { git } from "../../lib/git.ts";
import { layout } from "../../lib/layout.ts";
import { parseFrontmatter, serializeFrontmatter, splitFrontmatter, type Frontmatter } from "../../lib/frontmatter.ts";
import { readJsonOr } from "../../lib/json.ts";
import { ACTIONS, ACTORS, because, FULL, key, OLD_HOLDS, ROLES, STATES, word } from "../../lib/naming.ts";
import { expand } from "../../lib/paths.ts";
import { refuse } from "../../lib/refusal.ts";
import { renderItem, type Issue } from "../../issues/lib/todo.ts";
import { renderProject } from "../../issues/lib/projects.ts";
import { readEnd } from "./infra/process.ts";
import type { Row } from "./records/record.ts";
import { SIZE_OF } from "./routing/models.ts";

// --- Paths -----------------------------------------------------------------------------------------------------------

/** Where the old store is and where the new one goes. The root is the folder of `aleph.db`. */
export function roots() {
  const root = dirname(dbFile());
  return {
    root, items: layout().items, jobs: layout().jobs, factory: layout().factory, db: dbFile(),
    issues: join(root, "issues"), ideas: join(root, "ideas"), media: join(root, "issues-media"), runs: join(root, "runs"),
    records: join(root, "jobs"), archive: join(root, "jobs-archive"), repos: join(root, "repos.json"), backups: join(root, "backups"),
  };
}
type Roots = ReturnType<typeof roots>;

// --- What the old store holds, and the rule for each key ---------------------------------------------------------------

const REPO_KEYS = ["path", "env", "setup", "checks", "manual", "note", "code", "sandbox", "held", "author", "critical", "main", "autoland", "description"];
const ISSUE_KEYS = ["id", "title", "created_time", "updated_time", "created", "updated", "closed_as", "closed_at", "closed_time", "closed_why", "kind", "priority", "source", "areas", "intake", "parked", "after", "from", "since", "media", "tracker", "plan"];
const IDEA_KEYS = ["title", "target", "status", "built"];
const RECORD_KEYS = ["issue", "ask", "askRun", "asks", "wait", "rounds", "cost", "runs", "events", "ci"];
/** Run fields that become a column, are derived, or are dropped; every other known field goes to `extra`. */
const RUN_COLUMN = ["kind", "job", "condition", "repo", "on", "commit", "cost", "model", "tier", "started", "ended", "made", "id", "n", "review"];
const RUN_EXTRA = ["name", "branch", "worktree", "phase", "reason", "question", "say", "route", "cause", "checkName", "fate", "noCommit", "session", "tally", "touched", "changes", "check", "checkItem", "land", "merge", "conflicts", "failed", "round", "next", "defaults", "followups", "alreadyMet", "checks", "checkedBase", "checkedTip", "stat", "held", "lander", "told", "shown"];
const EVENT_KEYS = ["at", "by", "subject", "action", "sub", "on", "file", "count", "result", "to", "note", "cost", "commit", "tier", "model", "p", "tally", "changes"];
const TICK_KEYS = ["last", "missed", "suite", "ran"];
const RECORD_EVENTS = ["hold", "started", "rerun", "rerun-cleared", "rescued", "asked", "director", "spec-check", "cap", "cap-cleared", "streak"];

/** The old run files: where each goes in the job folder (`as`), as a `log.txt` section (`section`), or in the reviewer's job (`review`). */
const RUN_FILES: Record<string, { as?: string; section?: string; review?: string; keep?: true; drop?: true }> = {
  "prompt.md": { as: "prompt.md" }, "spec.md": { as: "spec.md" }, "output.log": { as: "transcript.jsonl" }, "result.md": { as: "result.md" },
  "result.html": { as: "result.html" }, pid: { as: "pid" }, exit: { as: "exit" }, "batch.json": { as: "batch.json" }, "paused-next": { as: "paused-next" },
  notes: { as: "notes" }, gh: { as: "gh" },
  "command.txt": { section: "command" }, "setup.log": { section: "setup" }, "stderr.log": { section: "stderr" }, "next.log": { section: "dispatch" },
  "dispatch.log": { section: "dispatch" }, "checks.log": { section: "checks" }, "land.log": { section: "land" },
  "review-prompt.md": { review: "prompt.md" }, "review.md": { review: "result.md" }, "review.json": { review: "review.json" }, "review.log": { review: "transcript.jsonl" }, "review.err": { review: "stderr" },
  // Kept under their own names: output of a check, a hidden check, a second review or a call.
  "check.out": { keep: true }, "junit-tests.xml": { keep: true }, "junit-oracle.xml": { keep: true }, "junit-oracle.xml:all": { keep: true }, "hidden.log": { keep: true },
  "diff.stat": { keep: true }, "diff.patch": { keep: true }, "trace.log": { keep: true }, "call.md": { keep: true }, "call-prompt.md": { keep: true }, "call.err": { keep: true },
  "review2.err": { keep: true }, "review2.log": { keep: true }, "review2-prompt.md": { keep: true }, "review2.md": { keep: true },
  // Left behind by the sandbox, or a marker that a run field or an issue state holds now.
  tmp: { drop: true }, bin: { drop: true }, sock: { drop: true }, browser: { drop: true }, "srt-review-tmp.json": { drop: true }, "srt-review2-tmp.json": { drop: true },
  rescued: { drop: true }, "needs-chris": { drop: true }, asked: { drop: true }, "asked-spec": { drop: true }, "review.pid": { drop: true }, "review2.pid": { drop: true },
};
const SECTION_ORDER = ["command", "setup", "stderr", "dispatch", "checks", "land"];

/** The factory files: moved into a table, kept as they are (live, or no reader left), or old (deleted by cleanup). */
const MOVED = ["tick.json", "baseline.json", "ci.json", "stalls.json", "smoke.json", "backend-hold.json", "reran.json", "recheck-held.json", "housekeeper.json", "corrections.json", "caps.json", "models.json", "always.json", "timeouts.json", "paused", "flaky.json", "suite-history.jsonl"];
/** The dispatch logs of a past day: retention deletes them (jobs/lib/infra/retention.ts). */
const DISPATCH_DAY = /^dispatch\.\d{4}-\d\d-\d\d\.log$/;
const KEPT = ["ui-sessions.json", "ui-factory-token", "dispatch.log", "dispatch.day", "episodes-seen", "seen", "episodes", "episode-use.jsonl", "monitor", "baseline", "acceptance", "probe.log", "probe.log.stderr", "followups.log", "housekeeper.log", "standing-retry", "deps.json", "firefighter.json", "standing.json", "accept-nightly.json"];
const OLD_FILES = /^(events|tick\.converted|words-migrated|tick\.log|tick\.\d{4}-\d\d-\d\d\.log)$|\.bak/;

/** The fixture projects whose events and records decision 14 lets go. */
const FIXTURE = /^(tools|fac|oth|demo)-/;

// --- Reading the old files -------------------------------------------------------------------------------------------

type Json = Record<string, any>;
const lines = (file: string): Json[] => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const iso = (v: unknown): string | undefined => {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?$/.exec(String(v ?? ""));
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0)).toISOString() : undefined;
};
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const timeOf = (v: unknown): string | undefined => (typeof v === "string" && ISO.test(v) ? v : iso(v));

interface Counter { [k: string]: number }
const bump = (c: Counter, k: string, by = 1): void => { c[k] = (c[k] ?? 0) + by; };

// --- The plan --------------------------------------------------------------------------------------------------------

type JobRow = Row & { was: string };
interface JobPlan { n: number; row: JobRow; folder: string; review?: boolean }
interface EventRow { time: string; subject: string; action: string; object: string; detail: string | null }
type Pair = [string, string];

export interface Plan {
  projects: { n: number; name: string; text: string }[];
  /** New files of the items repo, by path: the text, or the old file to copy. */
  files: Map<string, string | { copy: string }>;
  ideas: { slug: string; n: number }[];
  jobs: JobPlan[];
  events: EventRow[];
  issueState: Json[];
  tick: Pair[];
  settings: Pair[];
  state: Pair[];
  logs: { usage: Json[]; openrouter: Json[]; jev: Json[]; suite_history: Json[]; flaky: Json[] };
  counters: Record<string, number>;
  counts: Counter;
  dropped: Counter;
  unmapped: Set<string>;
  /** Why a real run cannot start, apart from an unmapped key. */
  problems: string[];
}

/** An issue of the old store, read from `<repo>/backlog/tasks/<repo>-<n>.md`. */
interface OldIssue { repo: string; id: string; n: number; sub?: number; fm: Frontmatter; request: string; spec: string; notes: string[]; file: string }

const MARKS = { request: "<!-- request -->", spec: "<!-- spec -->", notes: "<!-- notes -->" } as const;
const unescape = (t: string): string => t.split("\n").map((l) => (Object.values(MARKS).includes(l.replace(/^\\+/, "") as never) ? l.slice(1) : l)).join("\n");
const trimmed = (t: string): string => t.replace(/^\n+/, "").replace(/\n+$/, "");
const OLD_STAMP = /^- (\d{4}-\d{2}-\d{2} \d{2}:\d{2}): /;

function parseOld(repo: string, file: string): OldIssue {
  const { frontmatter, body } = splitFrontmatter(readFileSync(file, "utf8"));
  const fm = parseFrontmatter(frontmatter ?? "");
  const m = FULL.exec(String(fm.id));
  const parts: Record<string, string[]> = { request: [], spec: [], notes: [] };
  let at: string[] | null = null;
  for (const line of body.split("\n")) {
    const opened = Object.entries(MARKS).find(([, mark]) => mark === line);
    if (opened) at = parts[opened[0]]; else at?.push(line);
  }
  return {
    repo, id: String(fm.id), n: Number(m?.[2]), sub: m?.[3] === undefined ? undefined : Number(m[3]), fm, file,
    request: trimmed(unescape(parts.request.join("\n"))), spec: trimmed(unescape(parts.spec.join("\n"))), notes: parts.notes.filter((l) => l.trim().startsWith("- ")),
  };
}

/** The sha of each `Job:` trailer value on `main` of a repo, newest commit first wins. */
function trailers(path: string, main: string): Map<string, string> {
  const out = new Map<string, string>();
  const ref = git(path, "rev-parse", "--verify", "-q", `origin/${main}`).ok ? `origin/${main}` : main;
  const r = git(path, "log", ref, "--format=%H%x1f%B%x1e");
  if (!r.ok) return out;
  for (const rec of r.out.split("\x1e")) {
    const [sha, body] = rec.trim().split("\x1f");
    for (const l of (body ?? "").split("\n")) { const m = /^Job: (.+)$/.exec(l); if (m && !out.has(m[1])) out.set(m[1], sha); }
  }
  return out;
}

export function plan(r: Roots = roots()): Plan {
  const p: Plan = {
    projects: [], files: new Map(), ideas: [], jobs: [], events: [], issueState: [], tick: [], settings: [], state: [],
    logs: { usage: [], openrouter: [], jev: [], suite_history: [], flaky: [] }, counters: {}, counts: {}, dropped: {}, unmapped: new Set(), problems: [],
  };
  const um = (s: string) => p.unmapped.add(s);
  if (!existsSync(r.issues) && !existsSync(r.items)) p.problems.push(`no old store: ${r.issues} does not exist`);
  else if (existsSync(r.items) && existsSync(r.issues)) p.problems.push(`both ${r.issues} and ${r.items} exist`);
  else if (!existsSync(r.issues)) p.problems.push(`already migrated: ${r.items} exists and ${r.issues} does not`);
  if (existsSync(r.db) && (conn().query("SELECT count(*) AS n FROM jobs").get() as { n: number }).n > 0) p.problems.push(`${r.db} already holds jobs`);
  for (const [name, dir] of [["issues", r.issues], ["ideas", r.ideas]] as const) {
    if (!existsSync(join(dir, ".git"))) continue;
    if (git(dir, "status", "--porcelain").out) p.problems.push(`the ${name} checkout has changes`);
    const behind = git(dir, "rev-list", "--count", "HEAD..origin/main");
    if (behind.ok && Number(behind.out) > 0) p.problems.push(`the ${name} checkout is ${behind.out} commits behind origin/main: fetch and fast-forward it`);
  }

  // Projects: the order of repos.json.
  const repos = readJsonOr<Record<string, Json>>(r.repos, {});
  const projectN = new Map<string, number>();
  const codes = new Map<string, string>();
  Object.entries(repos).forEach(([name, cfg], i) => {
    const n = i + 1;
    projectN.set(name, n);
    if (cfg.code) codes.set(cfg.code, name);
    for (const k of Object.keys(cfg)) if (!REPO_KEYS.includes(k)) um(`repos.json: ${k}`);
    const { description, ...fields } = cfg;
    p.projects.push({ n, name, text: renderProject({ name, description: description ?? "", fields }) });
  });
  const projectKey = (name: string): string | undefined => (projectN.has(name) ? key("project", projectN.get(name)!) : undefined);

  // Issues: aleph keeps its numbers; a part and every other project's issue takes the next number of the one counter.
  const old: OldIssue[] = [];
  if (existsSync(r.issues)) {
    for (const repo of readdirSync(r.issues).filter((d) => !d.startsWith(".")).sort()) {
      const dir = join(r.issues, repo, "backlog", "tasks");
      const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".md")) : [];
      if (files.length && !projectN.has(repo)) um(`issues: ${repo}/ is not in repos.json`);
      for (const f of files) old.push(parseOld(repo, join(dir, f)));
      const rest = readdirSync(join(r.issues, repo)).filter((n) => n !== "backlog" && n !== "hidden");
      for (const n of rest) um(`issues: ${repo}/${n}`);
    }
  }
  const order = [...projectN.keys()];
  const alephN = old.filter((i) => i.repo === "aleph" && i.sub === undefined).map((i) => i.n);
  let counter = Math.max(0, ...alephN);
  const issueN = new Map<string, number>();
  for (const i of old.filter((i) => i.repo === "aleph" && i.sub === undefined)) issueN.set(i.id, i.n);
  const rest = old.filter((i) => !issueN.has(i.id)).sort((a, b) => (a.repo === "aleph" ? -1 : 0) - (b.repo === "aleph" ? -1 : 0) || order.indexOf(a.repo) - order.indexOf(b.repo) || a.n - b.n || (a.sub ?? -1) - (b.sub ?? -1));
  for (const i of rest) issueN.set(i.id, ++counter);
  p.counters.issue = counter;
  /** `issue.<n>` for an old issue ID (`aleph-1234`, `aleph-1000.1`, `a1234`), or undefined. Aleph numbers stand even when the issue file is gone. */
  const issueKey = (id: string): string | undefined => {
    const s = String(id).trim();
    let m = FULL.exec(s);
    const short = /^([a-z]{1,2})(\d+)(?:\.(\d+))?$/.exec(s);
    if (short && codes.has(short[1])) m = [s, codes.get(short[1])!, short[2], short[3]] as unknown as RegExpExecArray;
    if (!m) return undefined;
    const full = `${m[1]}-${m[2]}${m[3] === undefined ? "" : `.${m[3]}`}`;
    const n = issueN.get(full);
    if (n !== undefined) return key("issue", n);
    if (m[1] === "aleph" && m[3] === undefined) return key("issue", Number(m[2]));
    // A run or an event names an issue whose file is gone: it takes a number too, so the link stays.
    if (!projectN.has(m[1])) return undefined;
    issueN.set(full, ++counter);
    bump(p.counts, "numbers taken for issues whose file is gone");
    return key("issue", counter);
  };
  const issueRef = (v: unknown, where: string): string => {
    const k = issueKey(String(v));
    if (!k) um(`issue ref: ${where} names ${v}`);
    return k ?? String(v);
  };
  for (const i of old) {
    const n = issueN.get(i.id)!;
    const pk = projectKey(i.repo);
    const fm: Frontmatter = {};
    for (const k of Object.keys(i.fm)) if (!ISSUE_KEYS.includes(k)) um(`issue field: ${k}`);
    if (pk) fm.project = pk;
    const created = timeOf(i.fm.created_time) ?? iso(i.fm.created);
    if (!created) um(`issue field: created is missing in ${i.id}`); else fm.created = created;
    for (const k of ["kind", "priority", "source", "areas", "closed_as", "closed_why", "intake", "parked", "since", "media", "tracker", "plan"]) if (i.fm[k] !== undefined) fm[k] = i.fm[k];
    if (i.fm.closed_as) { const t = timeOf(i.fm.closed_time) ?? iso(i.fm.closed_at); if (t) fm.closed_at = t; }
    const from = i.fm.from ?? (i.sub === undefined ? undefined : `${i.repo}-${i.n}`);
    if (from) fm.from = issueRef(from, i.id);
    if (i.fm.after !== undefined) fm.after = [i.fm.after].flat().map((a) => issueRef(a, i.id));
    const notes = i.notes.map((l) => { const m = OLD_STAMP.exec(l); return m ? `- ${iso(m[1])}: ${l.slice(m[0].length)}` : l; });
    const issue: Issue = { id: n, title: String(i.fm.title ?? ""), fm, request: i.request, spec: i.spec, notes };
    p.files.set(`issues/${n}/issue.md`, renderItem(issue));
    for (const name of [i.fm.media ?? []].flat()) {
      const src = join(r.issues, i.repo, "backlog", "media", i.id, name);
      if (existsSync(src)) p.files.set(`issues/${n}/${name}`, { copy: src });
      else um(`issue media: ${i.id} names ${name}, which is not in the repo`);
    }
    bump(p.counts, i.repo === "aleph" && i.sub === undefined ? "issues (aleph)" : i.sub !== undefined ? "issues (old parts)" : "issues (other projects)");
  }
  p.counts.issues = old.length;
  for (const pr of p.projects) p.files.set(`projects/${pr.n}/project.md`, pr.text);

  // Ideas: the slug folders of the ideas repo, in slug order.
  if (existsSync(r.ideas)) {
    const slugs = readdirSync(r.ideas).filter((d) => !d.startsWith(".") && existsSync(join(r.ideas, d, "idea.md"))).sort();
    if (existsSync(join(r.ideas, "idea.md"))) p.dropped["ideas: the empty idea.md at the root"] = 1;
    slugs.forEach((slug, i) => {
      const n = i + 1;
      const { frontmatter, body } = splitFrontmatter(readFileSync(join(r.ideas, slug, "idea.md"), "utf8"));
      const fm = parseFrontmatter(frontmatter ?? "");
      for (const k of Object.keys(fm)) if (!IDEA_KEYS.includes(k)) um(`idea field: ${k}`);
      const { target, built, ...rest } = fm;
      const project = target ? projectKey(String(target)) : undefined;
      if (target && !project) um(`idea target: ${target} is not a project`);
      const out: Frontmatter = { ...(rest.title !== undefined ? { title: rest.title } : {}), ...(project ? { project } : {}), ...(rest.status !== undefined ? { status: rest.status } : {}), built: [built ?? []].flat().map((b) => issueRef(b, `idea ${slug}`)) };
      p.ideas.push({ slug, n });
      p.files.set(`ideas/${n}/idea.md`, serializeFrontmatter(out) + body);
      for (const f of readdirSync(join(r.ideas, slug)).filter((f) => f !== "idea.md")) p.files.set(`ideas/${n}/${f}`, { copy: join(r.ideas, slug, f) });
    });
    p.counts.ideas = slugs.length;
    p.counters.idea = slugs.length;
  }
  p.counters.project = p.projects.length;
  p.counts.projects = p.projects.length;

  planJobs(r, p, { repos, issueKey, um, projectKey });
  p.counters.issue = counter;
  planState(r, p, um);
  return p;
}

// --- Jobs and events -------------------------------------------------------------------------------------------------

interface OldRun { id: string; rec: string; run: Json }
interface Helpers { repos: Record<string, Json>; issueKey: (id: string) => string | undefined; um: (s: string) => void; projectKey: (n: string) => string | undefined }

function planJobs(r: Roots, p: Plan, h: Helpers): void {
  const { um, issueKey } = h;
  // The old records, live and archived.
  const records: Json[] = [];
  for (const dir of [r.records, r.archive]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).sort()) {
      if (f.endsWith(".json")) records.push(readJsonOr(join(dir, f), {}));
      else if (dir === r.archive || statSync(join(dir, f)).isFile()) um(`record: ${f} is not a .json file`);
    }
  }
  const runs: OldRun[] = [];
  for (const rec of records) {
    for (const k of Object.keys(rec)) if (!RECORD_KEYS.includes(k)) um(`record field: ${k}`);
    if (FIXTURE.test(rec.issue)) { bump(p.dropped, "records of fixture issues"); bump(p.dropped, "runs of fixture issues", rec.runs.length); continue; }
    for (const run of rec.runs) runs.push({ id: run.id, rec: rec.issue, run });
  }
  const kept = runs.filter(({ run }) => {
    for (const k of Object.keys(run)) if (!RUN_COLUMN.includes(k) && !RUN_EXTRA.includes(k)) um(`run field: ${k}`);
    if (run.kind === "chat") { bump(p.dropped, "chat runs"); return false; }
    if (run.kind === "facts") bump(p.counts, "runs of the retired kind facts, role plain");
    else if (!ROLES.includes(run.kind)) um(`run kind: ${run.kind}`);
    if (!(STATES as readonly string[]).includes(run.condition)) um(`run condition: ${run.condition}`);
    return true;
  });
  const dropIds = new Set(runs.filter((x) => !kept.includes(x)).map((x) => x.id));

  // Old job IDs of a run: `a1844#4`, `aleph-1844#4`, `monitor#14`, `a1844-4`, and its folder name.
  const subjectOf = (x: Json): string => x.on ?? (["monitor", "chat", "lens", "housekeeper", "maintainer"].includes(x.kind) ? x.kind : x.name);
  const idForms = (x: OldRun): string[] => {
    const s = subjectOf(x.run), forms = [s];
    const m = FULL.exec(s);
    const code = m && Object.values(h.repos).find((c, i) => c.code && Object.keys(h.repos)[i] === m[1])?.code;
    if (code) forms.push(`${code}${m![2]}${m![3] === undefined ? "" : `.${m![3]}`}`);
    return [...forms.reverse().flatMap((f) => [`${f}#${x.run.n}`, `${f}-${x.run.n}`]), x.id];
  };

  // Reviews: a build that a reviewer read has a job of its own.
  const reviewed = (x: OldRun): boolean => x.run.kind === "build" && (!!x.run.review || existsSync(join(r.runs, x.id, "review-prompt.md")));
  interface Item { x: OldRun; review: boolean; name: string; started: string }
  const items: Item[] = kept.map((x) => ({ x, review: false, name: x.id, started: x.run.started }));
  for (const x of kept.filter(reviewed)) {
    const secs = x.run.review?.seconds ?? 0, end = x.run.ended ?? x.run.started;
    const at = new Date(Math.max(Date.parse(x.run.started), Date.parse(end) - secs * 1000)).toISOString();
    items.push({ x, review: true, name: `${x.id}~review`, started: at });
  }
  items.sort((a, b) => (a.started < b.started ? -1 : a.started > b.started ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const numberOf = new Map<string, number>(); // old run id (and the review of it, `<id>~review`) to job number
  items.forEach((it, i) => numberOf.set(it.name, i + 1));
  const jobKey = new Map<string, string>(); // every old form of a run's id to its key
  for (const x of kept) for (const f of idForms(x)) jobKey.set(f, key("job", numberOf.get(x.id)!));
  const dropped = new Set<string>();
  for (const x of runs.filter((x) => dropIds.has(x.id))) for (const f of idForms(x)) dropped.add(f);

  // Work chains: runs of one old `job`, in start order; `prev` is the one before that is not a review.
  const byWork = new Map<string, OldRun[]>();
  for (const x of kept) (byWork.get(x.run.job) ?? byWork.set(x.run.job, []).get(x.run.job)!).push(x);
  const prevOf = new Map<string, string | null>();
  const retryOf = new Map<string, string>();
  const order = (a: OldRun, b: OldRun) => (a.run.started < b.run.started ? -1 : a.run.started > b.run.started ? 1 : a.id < b.id ? -1 : 1);
  const worksOn = new Map<string, OldRun[][]>();
  for (const w of byWork.values()) {
    w.sort(order);
    w.forEach((x, i) => prevOf.set(x.id, i ? w[i - 1].id : null));
    if (w[0].run.on) (worksOn.get(w[0].run.on) ?? worksOn.set(w[0].run.on, []).get(w[0].run.on)!).push(w);
  }
  for (const ws of worksOn.values()) {
    ws.sort((a, b) => order(a[0], b[0]));
    ws.forEach((w, i) => { const before = ws[i - 1]?.at(-1); if (w[0].run.kind === "build" && before && ["dropped", "failed"].includes(before.run.condition)) retryOf.set(w[0].id, before.id); });
  }

  // Landing commits that a record lacks, from the Job: trailers of each repo.
  const trailerCache = new Map<string, Map<string, string>>();
  const landing = new Map<string, string>(); // work (old job) to its landing commit
  for (const [job, w] of byWork) {
    const land = w.findLast((x) => x.run.condition === "landed");
    if (!land) continue;
    let sha: string | undefined = land.run.commit;
    if (!sha && land.run.repo && h.repos[land.run.repo]) {
      const repo = h.repos[land.run.repo];
      if (!trailerCache.has(land.run.repo)) trailerCache.set(land.run.repo, trailers(expand(repo.path), repo.main ?? "main"));
      const t = trailerCache.get(land.run.repo)!;
      sha = idForms(w[0]).map((f) => t.get(f)).find(Boolean);
      if (sha) bump(p.counts, "commit_sha from a Job: trailer");
    }
    if (sha) landing.set(job, sha);
  }

  const asked = new Map<string, Json>(), rescued = new Map<string, string>(), decision = new Map<string, Json>();
  for (const rec of records.filter((x) => !FIXTURE.test(x.issue))) {
    for (const e of rec.events) {
      if (e.kind === "asked" && e.run && jobKey.has(e.run)) asked.set(e.run, { at: e.at, question: e.what, ...(e.data?.spec ? { spec: e.data.spec } : {}) });
      if (e.kind === "rescued" && e.run && jobKey.has(e.run)) rescued.set(e.run, e.what);
      if (e.kind === "director" && e.data?.run && jobKey.has(e.data.run)) decision.set(e.data.run, e.data);
    }
  }

  const targetOf = (on: string | undefined): string | null => (on === undefined ? null : issueKey(on) ?? jobKey.get(on) ?? null);
  const BY: Record<string, string> = { plain: "human", lens: "human" };
  for (const it of items) {
    const { x } = it, run = x.run, n = numberOf.get(it.name)!, id = key("job", n);
    const w = byWork.get(run.job)!;
    const ended = run.ended ?? null;
    let row: JobRow;
    if (it.review) {
      const rv = run.review, folderRv = join(r.runs, x.id);
      const verdict = readJsonOr<Json>(join(folderRv, "review.json"), {});
      const state = rv?.call === "failed" || (!rv && !verdict.verdict) ? "failed" : "done";
      const extra: Json = { name: run.name, ...(rv?.reason ? { reason: rv.reason } : {}), ...(rv?.sessions?.[0] ? { session: rv.sessions[0] } : {}), told: true };
      row = {
        id, role: "review", by: "gate", state, project: run.repo ?? null, made: Date.parse(it.started), started: it.started, ended,
        model: rv?.model ?? null, size: null, cost: rv?.cost ?? null, commit_sha: null, pid: null, exit_code: null, target: targetOf(run.on),
        prev: key("job", numberOf.get(x.id)!), retry_of: null, was: `${x.id}~review`, extra: JSON.stringify(extra),
      };
    } else {
      const extra: Json = {};
      for (const k of RUN_EXTRA) if (run[k] !== undefined) extra[k] = run[k];
      if (run.review) extra.review = run.review;
      if (extra.touched) extra.touched = extra.touched.map((t: string) => issueKey(t) ?? t);
      if (extra.changes) extra.changes = extra.changes.map((c: Json) => ({ ...c, id: issueKey(c.id) ?? c.id }));
      if (asked.has(x.id)) extra.asked = asked.get(x.id);
      if (rescued.has(x.id)) extra.rescued = rescued.get(x.id);
      if (decision.has(x.id)) extra.decision = decision.get(x.id);
      const folder = join(r.runs, x.id), end = existsSync(folder) ? readEnd(folder) : { pid: null, exit: null };
      const first = w[0].id === x.id;
      let commit: string | null = run.commit ?? null;
      if (!commit && run.condition === "landed") commit = landing.get(run.job) ?? null;
      if (!commit && first && landing.has(run.job)) commit = landing.get(run.job)!;
      const ownRetry = retryOf.get(x.id);
      row = {
        id, role: run.kind === "facts" ? "plain" : run.kind, by: BY[run.kind] ?? "rule", state: run.condition, project: run.repo ?? null,
        made: run.made ?? Date.parse(run.started), started: run.started, ended, model: run.model ?? null, size: run.kind === "build" ? SIZE_OF[run.tier ?? run.model ?? ""] ?? null : null, cost: run.cost ?? null,
        commit_sha: commit, pid: end.pid, exit_code: end.exit, target: targetOf(run.on), prev: prevOf.get(x.id) ? key("job", numberOf.get(prevOf.get(x.id)!)!) : null,
        retry_of: ownRetry ? key("job", numberOf.get(ownRetry)!) : null, was: `${idForms(x)[0]} ${x.id}`, extra: Object.keys(extra).length ? JSON.stringify(extra) : null,
      };
      if (run.on && !row.target && !dropped.has(run.on)) bump(p.counts, "runs whose `on` names no issue or job: target null");
    }
    p.jobs.push({ n, row, folder: x.id, ...(it.review ? { review: true } : {}) });
    bump(p.counts, `jobs (${row.role})`);
  }
  p.counts.jobs = p.jobs.length;
  p.counters.job = p.jobs.length;

  // issue_state: the Ask, the wait and `ci` of each record that holds one.
  for (const rec of records.filter((x) => !FIXTURE.test(x.issue))) {
    if (!rec.ask && !rec.wait && !rec.ci) continue;
    const k = issueKey(rec.issue) ?? jobKey.get(rec.issue);
    if (!k) { if (rec.runs.length) um(`record key: ${rec.issue}`); else bump(p.dropped, "issue_state of a record with no issue and no runs"); continue; }
    p.issueState.push({ issue: k, ask: rec.ask ? JSON.stringify(rec.ask) : null, ask_job: rec.askRun ? jobKey.get(rec.askRun) ?? null : null, wait_kind: rec.wait?.kind ?? null, wait_reason: rec.wait?.reason ?? null, wait_since: rec.wait?.since ?? null, ci: rec.ci ? JSON.stringify(rec.ci) : null });
  }
  p.counts.issue_state = p.issueState.length;

  planEvents(r, p, records, { ...h, jobKey, dropped, issueKey });
}

const STATE_ACTIONS: readonly string[] = STATES;

function planEvents(r: Roots, p: Plan, records: Json[], h: Helpers & { jobKey: Map<string, string>; dropped: Set<string> }): void {
  const { um, issueKey, jobKey, dropped } = h;
  const projectOf = (name: string) => h.projectKey(name);
  const keyText = (x: string): string => jobKey.get(x) ?? issueKey(x) ?? x;
  const log: { e: Json }[] = [];
  const dir = join(r.factory, "events");
  if (existsSync(dir)) for (const f of readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort()) for (const e of lines(join(dir, f))) log.push({ e });
  const toRow = (e: Json): EventRow | string => {
    for (const k of Object.keys(e)) if (!EVENT_KEYS.includes(k)) um(`event field: ${k}`);
    const by = word("actor", e.by), action = word("act", e.action);
    if (!ACTORS.includes(by)) um(`event by: ${e.by}`);
    if (action === "routed" || e.subject === "route") return "route and routed events";
    if (action === "refused") return "refused events";
    if (!ACTIONS.includes(action) && !(OLD_HOLDS as readonly string[]).includes(action)) um(`event action: ${e.action}`);
    const on: string[] = [e.on ?? []].flat();
    if (FIXTURE.test(e.subject) || on.some((o) => FIXTURE.test(o))) return "fixture events";
    if (e.subject === "chat" || [e.subject, ...on].some((o) => dropped.has(o))) return "events of chat runs";
    const jobOn = on.find((o) => jobKey.has(o));
    const job = jobOn ?? (jobKey.has(e.subject) ? e.subject : undefined);
    let object: string;
    if (job) object = jobKey.get(job)!;
    else if (issueKey(e.subject)) object = issueKey(e.subject)!;
    else if (projectOf(e.subject)) object = projectOf(e.subject)!;
    else if (by === "human" && action === "changed") object = "settings";
    else { object = e.subject || by; bump(p.counts, "events whose object is a name, not a key"); }
    const others = job && STATE_ACTIONS.includes(action) ? [] : on.filter((o) => o !== jobOn).map(keyText);
    const detail = [e.sub ? because(e.sub) : "", e.file, e.count, others.join(" "), e.note].filter(Boolean).join(": ");
    return { time: e.at, subject: by, action, object, detail: detail || null };
  };
  const logRows: { time: string; row: EventRow }[] = [];
  for (const { e } of log) {
    const r1 = toRow(e);
    if (typeof r1 === "string") bump(p.dropped, `events: ${r1}`); else logRows.push({ time: e.at, row: r1 });
  }
  const logged = new Set(log.map(({ e }) => [e.at, e.by, e.subject, e.action].join("|")));
  const starts = new Map<string, number[]>();
  for (const { row } of logRows) if (row.subject === "rule" && row.action === "started") (starts.get(row.object) ?? starts.set(row.object, []).get(row.object)!).push(Date.parse(row.time));
  // Record events: what the new code reads from the event log. The rest went to a run field, or was a marker.
  const recRows: { time: string; row: EventRow }[] = [];
  for (const rec of records.filter((x) => !FIXTURE.test(x.issue))) {
    const object = issueKey(rec.issue) ?? jobKey.get(rec.issue);
    for (const e of rec.events) {
      if (!RECORD_EVENTS.includes(e.kind)) { um(`record event: ${e.kind}`); continue; }
      if (!object) continue;
      const add = (row: Omit<EventRow, "time" | "detail"> & { detail?: string | null }) => recRows.push({ time: e.at, row: { time: e.at, detail: null, ...row } });
      if (e.kind === "started") {
        if (starts.get(object)?.some((t) => Math.abs(t - Date.parse(e.at)) <= 120_000)) bump(p.dropped, "record events: started, already in the log");
        else add({ subject: "rule", action: "started", object });
      } else if (e.kind === "rerun" || e.kind === "rerun-cleared") add({ subject: "rule", action: "reran", object, detail: e.kind === "rerun" ? e.what : null });
      else if (e.kind === "spec-check") add({ subject: "rule", action: "changed", object, detail: e.what });
      else if (e.kind === "hold") {
        const ev = e.data?.event;
        if (ev && logged.has([ev.at, ev.by, ev.subject, ev.action].join("|"))) { bump(p.dropped, "record events: hold, already in the log"); continue; }
        const mapped = ev ? toRow(ev) : null;
        if (mapped && typeof mapped !== "string") recRows.push({ time: e.at, row: mapped });
        else add({ subject: "gate", action: "waiting", object, detail: e.what });
      } else bump(p.dropped, `record events: ${e.kind}, ${["rescued", "asked", "director"].includes(e.kind) ? "kept in a run field" : "a marker that the question events replace"}`);
    }
  }
  // The log keeps its file order; a record event goes in before the first log event after it.
  recRows.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
  let i = 0;
  for (const l of logRows) {
    while (i < recRows.length && recRows[i].time < l.time) p.events.push(recRows[i++].row);
    p.events.push(l.row);
  }
  while (i < recRows.length) p.events.push(recRows[i++].row);
  p.counts.events = p.events.length;
  p.counts["events from the log"] = logRows.length;
  p.counts["events from the records"] = recRows.length;
}

// --- State files and logs ----------------------------------------------------------------------------------------------

function planState(r: Roots, p: Plan, um: (s: string) => void): void {
  const f = (name: string) => join(r.factory, name);
  const tick = readJsonOr<Json>(f("tick.json"), {});
  for (const k of Object.keys(tick)) if (!TICK_KEYS.includes(k)) um(`tick.json: ${k}`);
  const steps = new Set([...Object.keys(tick.last ?? {}), ...Object.keys(tick.ran ?? {})]);
  p.tick = [...steps].map((s) => [s, JSON.stringify({ last: tick.last?.[s] ?? tick.ran?.[s]?.at ?? null, result: tick.ran?.[s]?.result ?? null })] as Pair);
  if (existsSync(f("tick.json"))) { p.state.push(["tick.missed", JSON.stringify(tick.missed ?? [])], ["tick.suite", JSON.stringify(tick.suite ?? {})]); }
  for (const [file, row] of [["baseline.json", "baseline"], ["ci.json", "ci"], ["stalls.json", "stalls"], ["smoke.json", "smoke"], ["backend-hold.json", "backend-hold"], ["reran.json", "reran"], ["recheck-held.json", "recheck-held"], ["housekeeper.json", "housekeeper"], ["corrections.json", "corrections"]] as const) {
    if (existsSync(f(file))) p.state.push([row, JSON.stringify(readJsonOr(f(file), null))]);
  }
  for (const [file, row] of [["caps.json", "caps"], ["models.json", "models"], ["always.json", "always"], ["timeouts.json", "timeouts"]] as const) {
    if (existsSync(f(file))) p.settings.push([row, JSON.stringify(readJsonOr(f(file), null))]);
  }
  if (existsSync(f("paused"))) p.settings.push(["paused", JSON.stringify(readFileSync(f("paused"), "utf8").trim())]);
  if (existsSync(join(r.root, "judge"))) p.settings.push(["judge", JSON.stringify(readFileSync(join(r.root, "judge"), "utf8").trim())]);
  for (const name of existsSync(r.factory) ? readdirSync(r.factory) : []) {
    if (!MOVED.includes(name) && !KEPT.includes(name) && !DISPATCH_DAY.test(name) && !OLD_FILES.test(name)) um(`factory file: ${name}`);
  }
  p.logs.usage = lines(join(r.root, "usage.jsonl"));
  p.logs.openrouter = lines(join(r.root, "openrouter.jsonl"));
  p.logs.jev = lines(join(r.root, "jev.jsonl"));
  p.logs.suite_history = lines(f("suite-history.jsonl"));
  p.logs.flaky = readJsonOr<Json[]>(f("flaky.json"), []);
  const stray: [string, string[], Json[]][] = [["usage.jsonl", ["at", "five_hour", "seven_day", "seven_day_resets_at"], p.logs.usage], ["openrouter.jsonl", ["at", "usage", "factor"], p.logs.openrouter], ["jev.jsonl", ["at", "cost"], p.logs.jev],
    ["suite-history.jsonl", ["repo", "commit", "at", "ran", "passed", "failed", "skipped", "rerunPassed"], p.logs.suite_history], ["flaky.json", ["repo", "check", "run", "at", "tests"], p.logs.flaky]];
  for (const [name, known, rows] of stray) for (const k of new Set(rows.flatMap(Object.keys))) if (!known.includes(k)) um(`${name}: ${k}`);
  for (const [name, n] of [["tick", p.tick.length], ["settings", p.settings.length], ["state", p.state.length], ["usage", p.logs.usage.length], ["openrouter", p.logs.openrouter.length], ["jev", p.logs.jev.length], ["suite_history", p.logs.suite_history.length], ["flaky", p.logs.flaky.length]] as const) p.counts[name] = n;
}

// --- Writing ---------------------------------------------------------------------------------------------------------

/** The text of the counts and the unmapped keys, as `--dry-run` and the real run print them. */
export function report(p: Plan | { counts: Counter; dropped: Counter; unmapped: Set<string>; problems: string[] }): string {
  const rows = (c: Counter) => Object.entries(c).map(([k, v]) => `  ${k}: ${v}`);
  return [
    "counts:", ...rows(p.counts), "dropped:", ...rows(p.dropped),
    `unmapped keys: ${p.unmapped.size}`, ...[...p.unmapped].sort().map((k) => `  ${k}`),
    ...(p.problems.length ? ["problems:", ...p.problems.map((x) => `  ${x}`)] : []),
  ].join("\n");
}

/** The counts of what is in the new store, in the words of `Plan.counts`. */
export function measure(r: Roots = roots()): Counter {
  const d = conn(), c: Counter = {}, n = (sql: string): number => (d.query(sql).get() as { n: number }).n;
  const files = (dir: string, name: string): number => (existsSync(dir) ? readdirSync(dir).filter((x) => existsSync(join(dir, x, name))).length : 0);
  c.projects = files(join(r.items, "projects"), "project.md");
  c.ideas = files(join(r.items, "ideas"), "idea.md");
  c.issues = files(join(r.items, "issues"), "issue.md");
  c.jobs = n("SELECT count(*) AS n FROM jobs");
  for (const row of d.query("SELECT role, count(*) AS n FROM jobs GROUP BY role").all() as { role: string; n: number }[]) c[`jobs (${row.role})`] = row.n;
  c.events = n("SELECT count(*) AS n FROM events");
  for (const t of ["issue_state", "tick", "settings", "state", "usage", "openrouter", "jev", "suite_history", "flaky"]) c[t] = n(`SELECT count(*) AS n FROM ${t}`);
  return c;
}

/** The files a job folder takes from the old run folder `src`, and the text of its `log.txt`. */
function fillFolder(src: string, dst: string, review: boolean, hasReview: boolean): void {
  mkdirSync(dst, { recursive: true });
  const sections = new Map<string, string>();
  const section = (name: string, text: string) => sections.set(name, (sections.get(name) ?? "") + (text.endsWith("\n") ? text : `${text}\n`));
  const put = (from: string, to: string) => { if (statSync(from).isDirectory()) linkTree(from, join(dst, to)); else link(from, join(dst, to)); };
  for (const name of readdirSync(src)) {
    const rule = RUN_FILES[name];
    if (!rule || rule.drop) continue;
    const from = join(src, name);
    if (rule.section) { if (!review) section(rule.section, readFileSync(from, "utf8")); continue; }
    if (rule.review) {
      if (review) { if (rule.review === "stderr") section("stderr", readFileSync(from, "utf8")); else put(from, rule.review); }
      else if (!hasReview) put(from, name);
      continue;
    }
    if (!review) put(from, rule.as ?? name);
  }
  if (sections.size) writeFileSync(join(dst, "log.txt"), SECTION_ORDER.filter((s) => sections.has(s)).map((s) => `=== ${s} ===\n${sections.get(s)}`).join(""));
}
function link(from: string, to: string): void {
  try { linkSync(from, to); } catch { copyFileSync(from, to); }
}
function linkTree(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  for (const f of readdirSync(from)) {
    const s = join(from, f);
    if (statSync(s).isDirectory()) linkTree(s, join(to, f)); else link(s, join(to, f));
  }
}

const TRAILER = "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01TUujmdW4U1nNAeK13dHWAW";

/** The backup tar: everything in the root but `vault/`, `prior-art/` and `backups/`. */
function backup(r: Roots): string {
  mkdirSync(r.backups, { recursive: true });
  const out = join(r.backups, `storage-${today()}.tgz`);
  const t = Bun.spawnSync(["tar", "--exclude=./vault", "--exclude=./prior-art", "--exclude=./backups", "-czf", out, "-C", r.root, "."], { stdout: "pipe", stderr: "pipe" });
  if (t.exitCode !== 0 && t.exitCode !== 1) throw new Error(`tar failed: ${t.stderr.toString()}`);
  const z = Bun.spawnSync(["gzip", "-t", out], { stderr: "pipe" });
  if (z.exitCode !== 0) throw new Error(`the backup does not read back: ${z.stderr.toString()}`);
  return out;
}

function commit(dir: string, subject: string): void {
  git(dir, "add", "-A");
  const c = git(dir, "-c", "commit.gpgsign=false", "commit", "-q", "-m", `${subject}\n\n${TRAILER}`);
  if (!c.ok) throw new Error(`git commit failed: ${c.out}`);
}

/** Restructure the items repo and merge the ideas repo, as local git operations; the push is the caller's. */
function restructure(r: Roots, p: Plan): void {
  // The media sit in the tree that the restructure clears: read them first.
  const media = new Map([...p.files].flatMap(([path, v]) => (typeof v !== "string" && !path.startsWith("ideas/") ? [[path, readFileSync(v.copy)] as const] : [])));
  renameSync(r.issues, r.items);
  const dir = r.items;
  for (const f of readdirSync(dir).filter((f) => f !== ".git")) rmSync(join(dir, f), { recursive: true, force: true });
  for (const [path, v] of p.files) {
    if (path.startsWith("ideas/")) continue;
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), typeof v === "string" ? v : media.get(path)!);
  }
  commit(dir, "restructure into projects and issues");
  if (existsSync(join(r.ideas, ".git"))) {
    const fetched = git(dir, "fetch", "-q", r.ideas, "HEAD");
    if (!fetched.ok) throw new Error(`git fetch of the ideas repo failed: ${fetched.out}`);
    for (const args of [["merge", "-s", "ours", "--no-commit", "--allow-unrelated-histories", "-q", "FETCH_HEAD"], ["read-tree", "--prefix=ideas/", "-u", "FETCH_HEAD"]]) {
      const g = git(dir, ...args);
      if (!g.ok) throw new Error(`git ${args[0]} failed: ${g.out}`);
    }
    commit(dir, "merge the ideas repo");
    for (const { slug } of p.ideas) git(dir, "mv", `ideas/${slug}`, `ideas/${p.ideas.find((i) => i.slug === slug)!.n}`);
    git(dir, "rm", "-q", "--ignore-unmatch", "ideas/idea.md");
    for (const [path, v] of p.files) if (path.startsWith("ideas/")) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      if (typeof v === "string") writeFileSync(join(dir, path), v); else if (!existsSync(join(dir, path))) copyFileSync(v.copy, join(dir, path));
    }
    commit(dir, "number the ideas");
  }
}

/** Write the plan: the rows in one transaction, the job folders, then the items repo. */
function apply(r: Roots, p: Plan): void {
  const d = conn();
  d.transaction(() => {
    const ins = (sql: string, rows: unknown[][]) => { const q = d.query(sql); for (const row of rows) q.run(...(row as never[])); };
    ins("INSERT INTO jobs (id, role, by, state, project, made, started, ended, model, size, cost, commit_sha, pid, exit_code, target, prev, retry_of, was, extra) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      p.jobs.map(({ row: x }) => [x.id, x.role, x.by, x.state, x.project, x.made, x.started, x.ended, x.model, x.size, x.cost, x.commit_sha, x.pid, x.exit_code, x.target, x.prev, x.retry_of, x.was, x.extra]));
    ins("INSERT INTO events (time, subject, action, object, detail) VALUES (?, ?, ?, ?, ?)", p.events.map((e) => [e.time, e.subject, e.action, e.object, e.detail]));
    ins("INSERT INTO issue_state (issue, ask, ask_job, wait_kind, wait_reason, wait_since, ci) VALUES (?, ?, ?, ?, ?, ?, ?)", p.issueState.map((s) => [s.issue, s.ask, s.ask_job, s.wait_kind, s.wait_reason, s.wait_since, s.ci]));
    ins("INSERT INTO tick (step, last, result) VALUES (?, ?, ?)", p.tick.map(([s, v]) => { const j = JSON.parse(v); return [s, j.last, j.result]; }));
    ins("INSERT INTO settings (key, value) VALUES (?, ?)", p.settings);
    ins("INSERT INTO state (key, value) VALUES (?, ?)", p.state);
    ins("INSERT INTO usage (time, five_hour, seven_day, seven_day_resets_at) VALUES (?, ?, ?, ?)", p.logs.usage.map((u) => [u.at, u.five_hour ?? null, u.seven_day, u.seven_day_resets_at ?? null]));
    ins("INSERT INTO openrouter (time, usage, factor) VALUES (?, ?, ?)", p.logs.openrouter.map((u) => [u.at, u.usage, u.factor ?? null]));
    ins("INSERT INTO jev (time, cost) VALUES (?, ?)", p.logs.jev.map((u) => [u.at, u.cost]));
    ins("INSERT INTO suite_history (time, repo, commit_sha, ran, passed, failed, skipped, rerun_passed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", p.logs.suite_history.map((s) => [s.at, s.repo, s.commit, s.ran, s.passed, s.failed, s.skipped, s.rerunPassed]));
    ins("INSERT INTO flaky (time, repo, check_name, run, tests) VALUES (?, ?, ?, ?, ?)", p.logs.flaky.map((f) => [f.at, f.repo, f.check, f.run, f.tests ? JSON.stringify(f.tests) : null]));
    ins("INSERT INTO counters (kind, last) VALUES (?, ?)", Object.entries(p.counters));
  }).immediate();
  const reviewed = new Set(p.jobs.filter((j) => j.review).map((j) => j.folder));
  for (const j of p.jobs) {
    const src = join(r.runs, j.folder);
    if (existsSync(src)) fillFolder(src, join(r.jobs, String(j.n)), !!j.review, reviewed.has(j.folder));
    else mkdirSync(join(r.jobs, String(j.n)), { recursive: true });
  }
  restructure(r, p);
}

// --- The check ---------------------------------------------------------------------------------------------------------

/** The new store read back, compared with the old files that are still in place: counts, then the fields of each run. */
export function check(r: Roots, p: Plan): { bad: string[]; compared: number } {
  const bad: string[] = [];
  const d = conn(), have = measure(r);
  for (const [k, v] of Object.entries(p.counts)) if (have[k] !== undefined && have[k] !== v) bad.push(`${k}: planned ${v}, found ${have[k]}`);
  // Each old run is a row with the same fields.
  const rows = new Map((d.query("SELECT * FROM jobs").all() as JobRow[]).map((x) => [x.was.split(" ")[1] ?? x.was, x]));
  let compared = 0;
  for (const dir of [r.records, r.archive]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const rec = readJsonOr<Json>(join(dir, f), {});
      for (const run of rec.runs) {
        const row = rows.get(run.id);
        if (!row) { if (run.kind !== "chat" && !FIXTURE.test(rec.issue)) bad.push(`run ${run.id} has no row`); continue; }
        compared++;
        const want: Json = { role: run.kind === "facts" ? "plain" : run.kind, state: run.condition, started: run.started, ended: run.ended ?? null, cost: run.cost ?? null, model: run.model ?? null, project: run.repo ?? null };
        for (const [k, v] of Object.entries(want)) if ((row as unknown as Json)[k] !== v) bad.push(`${run.id} ${k}: old ${JSON.stringify(v)}, new ${JSON.stringify((row as unknown as Json)[k])}`);
        const extra = JSON.parse(row.extra ?? "{}");
        for (const k of RUN_EXTRA) if (run[k] !== undefined && k !== "touched" && k !== "changes" && JSON.stringify(extra[k]) !== JSON.stringify(run[k])) bad.push(`${run.id} ${k} differs`);
      }
    }
  }
  // Each issue file has the same title and the same status.
  for (const [path, v] of p.files) {
    if (!/^issues\/\d+\/issue\.md$/.test(path) || typeof v !== "string") continue;
    if (!existsSync(join(r.items, path)) || readFileSync(join(r.items, path), "utf8") !== v) bad.push(`${path} differs from the plan`);
  }
  // The event log, line by line, is the rows from the log and the dropped events.
  const dir = join(r.factory, "events"), raw = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".jsonl")).reduce((n, f) => n + lines(join(dir, f)).length, 0) : 0;
  const dropped = Object.entries(p.dropped).filter(([k]) => k.startsWith("events: ")).reduce((n, [, v]) => n + v, 0);
  if (raw !== (p.counts["events from the log"] ?? 0) + dropped) bad.push(`the log has ${raw} events; ${p.counts["events from the log"]} rows and ${dropped} drops`);
  for (const [table, rows] of [["settings", p.settings], ["state", p.state]] as const) {
    for (const [k, v] of rows) if ((d.query(`SELECT value FROM ${table} WHERE key = ?`).get(k) as { value: string } | null)?.value !== v) bad.push(`${table} ${k} differs`);
  }
  return { bad: bad.slice(0, 40), compared };
}

// --- The commands ------------------------------------------------------------------------------------------------------

/** Push the items repo to its origin and read the remote's main back: the first verified push. */
function pushItems(dir: string): string {
  if (!git(dir, "remote", "get-url", "origin").ok) return "items not pushed: no origin";
  const pushed = git(dir, "push", "-q", "origin", "HEAD:main");
  if (!pushed.ok) return `items not pushed: ${pushed.out.split("\n").at(-1)}`;
  const head = git(dir, "rev-parse", "HEAD").out, remote = git(dir, "ls-remote", "origin", "refs/heads/main").out.split(/\s/)[0];
  return remote === head ? `items pushed and verified: origin/main is ${head.slice(0, 8)}` : `items pushed, not verified: origin/main is ${remote.slice(0, 8)}, HEAD is ${head.slice(0, 8)}`;
}

/** Bring each old checkout up to its origin, as the issue store did at each read. */
function sync(r: Roots): void {
  for (const dir of [r.issues, r.ideas]) {
    if (!existsSync(join(dir, ".git")) || !git(dir, "remote", "get-url", "origin").ok) continue;
    const f = git(dir, "fetch", "-q", "origin");
    if (!f.ok) refuse(`git fetch in ${dir} failed: ${f.out}`);
    const m = git(dir, "merge", "--ff-only", "-q", "origin/main");
    if (!m.ok) refuse(`${dir} does not fast-forward to origin/main: ${m.out}`);
  }
}

/** `aleph migrate storage [--dry-run]`: the report of the plan, or the real run. Text for the terminal. */
export function migrateStorage(dry: boolean): string {
  const r = roots();
  if (!dry) sync(r);
  const p = plan(r);
  if (dry) return `dry run: nothing written\n${report(p)}`;
  if (p.problems.length) refuse(`cannot migrate:\n${p.problems.map((x) => `  ${x}`).join("\n")}`);
  if (p.unmapped.size) refuse(`cannot migrate while a key has no rule:\n${[...p.unmapped].sort().map((k) => `  ${k}`).join("\n")}`);
  const tar = backup(r);
  apply(r, p);
  const { bad, compared } = check(r, p);
  const have = measure(r);
  const off = Object.entries(p.counts).filter(([k, v]) => have[k] !== undefined && have[k] !== v);
  if (bad.length || off.length) refuse(`the check failed; undo with the tar ${tar}:\n${[...bad, ...off.map(([k, v]) => `count ${k}: planned ${v}, found ${have[k]}`)].join("\n")}`);
  conn().query("INSERT INTO state (key, value) VALUES ('migrated', ?)").run(JSON.stringify({ tar, checked: true }));
  return `${report({ ...p, counts: { ...p.counts, ...have }, problems: [] })}\nbackup: ${tar} (${statSync(tar).size} bytes)\ncheck: ok, ${compared} runs compared\n${pushItems(r.items)}\narchive aleph-ideas on GitHub by hand once the push shows verified`;
}

/** `aleph migrate cleanup`: delete the old files that the migration replaced. Refuses until the check passed. */
export function migrateCleanup(): string {
  const r = roots();
  const done = conn().query("SELECT value FROM state WHERE key = 'migrated'").get() as { value: string } | null;
  if (!done) refuse("run `aleph migrate storage` first: no migration has passed its check");
  const gone: string[] = [];
  const rm = (path: string) => { if (existsSync(path)) { rmSync(path, { recursive: true, force: true }); gone.push(path); } };
  for (const f of existsSync(r.root) ? readdirSync(r.root) : []) if (/^repos\.json(\.bak.*)?$|^(usage|openrouter|jev)\.jsonl$/.test(f)) rm(join(r.root, f));
  for (const f of existsSync(r.factory) ? readdirSync(r.factory) : []) if (MOVED.includes(f) || OLD_FILES.test(f)) rm(join(r.factory, f));
  for (const f of existsSync(r.records) ? readdirSync(r.records) : []) if (f.endsWith(".json")) rm(join(r.records, f));
  for (const dir of [r.runs, r.archive, r.media]) rm(dir);
  if (existsSync(join(r.ideas, ".git")) && git(r.items, "log", "-1", "--format=%H", "--", "ideas").out) rm(r.ideas);
  const by: Counter = {};
  for (const g of gone) bump(by, dirname(g).slice(r.root.length + 1) || ".");
  return `deleted ${gone.length} paths\n${Object.entries(by).sort().map(([d, n]) => `  ${d}: ${n}`).join("\n")}`;
}

/**
 * `aleph migrate asks`: set `detail` to the Ask reason on each `question` event that has none, from the `asks` of the old job
 * records in the backup tar that the `migrated` row names. An entry belongs to the issue of its record's runs and to the event of
 * the same issue and time. Writes nothing else; a second run fills 0.
 */
export function migrateAsks(): string {
  const done = conn().query("SELECT value FROM state WHERE key = 'migrated'").get() as { value: string } | null;
  if (!done) refuse("run `aleph migrate storage` first: no migration has passed its check");
  const { tar } = JSON.parse(done.value) as { tar: string };
  const dir = mkdtempSync(join(tmpdir(), "aleph-asks-"));
  try {
    const x = Bun.spawnSync(["tar", "-xzf", tar, "-C", dir, "--wildcards", "--no-wildcards-match-slash", "./jobs/*.json", "./jobs-archive/*.json"], { stdout: "pipe", stderr: "pipe" });
    if (x.exitCode !== 0) refuse(`cannot read the old records from ${tar}: ${x.stderr.toString()}`);
    const issueOfRun = new Map<string, string>();
    for (const j of conn().query("SELECT was, target FROM jobs WHERE was IS NOT NULL AND target LIKE 'issue.%'").all() as { was: string; target: string }[]) issueOfRun.set(j.was.split(" ").pop()!, j.target);
    const reasons = new Map<string, string>();
    for (const d of ["jobs", "jobs-archive"]) for (const f of readdirSync(join(dir, d))) {
      const rec = readJsonOr<Json>(join(dir, d, f), {});
      const issue = (rec.runs ?? []).map((x: Json) => issueOfRun.get(x.id)).find(Boolean);
      for (const a of issue ? rec.asks ?? [] : []) if (a.reason) reasons.set(`${issue} ${a.set}`, a.reason);
    }
    let filled = 0, missing = 0;
    for (const e of conn().query("SELECT seq, object, time FROM events WHERE action = 'question' AND detail IS NULL").all() as { seq: number; object: string; time: string }[]) {
      const reason = reasons.get(`${e.object} ${e.time}`);
      if (reason) { conn().query("UPDATE events SET detail = ? WHERE seq = ?").run(reason, e.seq); filled++; } else missing++;
    }
    return `filled ${filled} events, no reason found for ${missing}`;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
