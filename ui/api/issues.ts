/**
 * `GET /api/issues`, `GET /api/issues/:repo/:n` and `POST /api/issues`: the
 * Issues and Issue views' data. `?all=1` lists every repo, not only the recent ones. Every route takes `?project=<key>` and shows
 * only that project. A read is the work store's origin/main; a write runs
 * `aleph issue <verb>` through ui/action.ts, so the CLI stays the one writer.
 */
import { specs } from "./specs.ts";
import { aleph, fail, post } from "../action.ts";
import { allJobs, lastReal } from "../../jobs/lib/records/job.ts";
import { loadRegistry, onOf, type Repo } from "../../jobs/lib/records/ledger.ts";
import { git } from "../../jobs/lib/infra/git.ts";
import { landedIndex, recentRepos, repoStages } from "../../jobs/lib/records/status.ts";
import { askOf, awaitsChris, refIn } from "../../jobs/lib/asks/ask.ts";
// @ts-ignore plain JS, shared with the page
import { proseDecision } from "../decision.js";
import { afterOf, areasOf, MEDIA_TYPES, mediaFiles, mediaOf, parentOf, partsOf, readList, readLists } from "../../issues/lib/store.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import * as todos from "../../issues/lib/todo.ts";
import type { Routes } from "../server.ts";
import { attend } from "../asks.ts";
import { githubBase, jobProjector, type NewIssue } from "../state.ts";
import { filed } from "./speed.ts";
import { readHolds } from "../../jobs/lib/gates/factory-status.ts";

/** An issue id from a route: `7` or `7.1`; null for anything else. */
const refOf = (raw: string): number | string | null => (/^\d+$/.test(raw) ? Number(raw) : /^\d+\.\d+$/.test(raw) ? raw : null);


const str = (v: unknown): string | null => (v === undefined || v === null || v === "" ? null : String(v));

export interface Row {
  id: number; ref: string; repo: string; title: string; kind: string; status: string; priority: string | null; labels: string[];
  after: string[]; created: string | null; createdTime: string | null; closed: string | null; closedTime: string | null; source: string | null; updated: string | null; updatedTime: string | null; notes: number;
  /** The parent's ref: `"5"` for a child of `<repo>-5`; null for a top-level issue. */
  parent: string | null;
  stage?: string; why?: string;
}

function row(repo: string, i: todos.Issue): Row {
  const createdTime = str(i.fm.created_time), closedTime = str(i.fm.closed_time), updatedTime = str(i.fm.updated_time);
  const day = (t: string | null) => (t ? todos.today(new Date(t)) : null);
  return {
    id: i.id, ref: todos.refOf(i), repo, title: i.title, kind: str(i.fm.kind) ?? "task", status: todos.status(i), priority: str(i.fm.priority), labels: areasOf(i),
    after: afterOf(i), created: day(createdTime), createdTime, closed: day(closedTime), closedTime, source: str(i.fm.source), updated: day(updatedTime), updatedTime, notes: i.notes.length, parent: todos.parentRef(i) ?? null,
  };
}

/** Each row's stage, from the list already read and one pass over main's trailers. */
function derived(repo: Repo, doc: todos.Doc, rows: Row[]): void {
  let states;
  try { states = repoStages(repo, { fetch: false, doc }); } catch { return; }
  const byId = new Map(states.map((s) => [s.id, s]));
  for (const r of rows) {
    const s = byId.get(`${repo.key}-${r.ref}`);
    if (s && r.status !== "parked") { r.stage = s.stage; r.why = s.why; }
  }
}

function list(url: URL): Response {
  const registry = loadRegistry();
  const project = url.searchParams.get("project");
  const wantRepo = url.searchParams.get("repo");
  const status = url.searchParams.get("status");
  const label = url.searchParams.get("label");
  if (status && !todos.STATUSES.includes(status as todos.Status)) return Response.json({ error: `status must be one of ${todos.STATUSES.join(", ")}` }, { status: 400 });
  if (wantRepo && !registry[wantRepo]) return Response.json({ error: `no repo named ${wantRepo}` }, { status: 404 });
  let repos = Object.values(registry).filter((r) => !project || r.key === project);
  if (wantRepo) repos = repos.filter((r) => r.key === wantRepo);
  let docs: (todos.Doc | null)[];
  try { docs = readLists(repos); } catch (e: any) { return Response.json({ error: e?.message ?? String(e) }, { status: 500 }); }
  const order = wantRepo || url.searchParams.get("all") ? repos.map((_, n) => n) : recentRepos(repos, docs);
  const out = [];
  for (const n of order) {
    const doc = docs[n];
    if (!doc) continue;
    const rows = doc.items.map((i) => row(repos[n].key, i));
    derived(repos[n], doc, rows);
    const items = rows.filter((r) => (!status || r.status === status) && (!label || r.labels.includes(label)));
    if (items.length) out.push(...items);
  }
  return Response.json(out);
}

/** A job as the Issue page lists it: its name, state, times, cost and how many runs it holds. */
function jobRow(runs: ReturnType<typeof allJobs>[number]) {
  const r = lastReal(runs).run;
  const cost = runs.some((e) => e.run.cost !== undefined) ? runs.reduce((a, e) => a + (e.run.cost ?? 0), 0) : undefined;
  return { name: r.name, condition: r.condition, kind: r.kind, started: runs[0].run.started, ended: r.ended ?? null, cost: cost ?? null, runs: runs.length };
}

/** Whether an `onOf` value names issue `n`: the number itself, or a part `<n>.<k>` of it. */
const isOfIssue = (on: number | string | undefined, n: number): boolean =>
  typeof on === "number" ? on === n : typeof on === "string" && Number(on.split(".")[0]) === n;

function detail(params: Record<string, string>, url: URL): Response {
  const project = url.searchParams.get("project");
  const repo = loadRegistry()[params.repo];
  const ref = params.n;
  if (!repo || !/^\d+(\.\d+)?$/.test(ref) || (project && project !== repo.key)) return Response.json({ error: "no such issue" }, { status: 404 });
  let doc: todos.Doc | null;
  try { doc = readList(repo); } catch (e: any) { return Response.json({ error: e?.message ?? String(e) }, { status: 500 }); }
  const item = doc && todos.find(doc, ref);
  if (!doc || !item) return Response.json({ error: "no such issue" }, { status: 404 });
  const n = item.id;

  const main = `refs/remotes/origin/${repo.main}`;
  const partRefs = partsOf(doc, item).map(todos.refOf);
  let states = new Map<string, { stage: string; why: string }>();
  try { for (const s of repoStages(repo, { fetch: false, doc, items: [ref, ...partRefs] })) states.set(s.id.slice(repo.key.length + 1), s); } catch {}
  const mine = todos.status(item) === "parked" ? undefined : states.get(ref);
  const state = mine ? { item: `${repo.key}-${ref}`, stage: mine.stage, why: mine.why } : null;

  const all = allJobs().filter((runs) => runs[0].run.repo === repo.key);
  const jobsOf = (r: string) => all.filter((runs) => runs.some((e) => String(onOf(e.run)) === r)).map(jobRow);
  // A run on this issue or on one of its children.
  const onThis = (on: number | string | undefined) => (!ref.includes(".") ? isOfIssue(on, n) || partRefs.includes(String(on)) : String(on) === ref);
  const jobs = all.filter((runs) => runs.some((e) => onThis(onOf(e.run)))).map(jobRow);

  // The Issue page: the `## Request`, then the parts, each with its Job.
  const parts = partRefs.map((g) => {
    const gi = todos.find(doc!, g), st = states.get(g);
    return { id: `${repo.key}-${g}`, title: gi?.title ?? "", href: `#/issues/${encodeURIComponent(repo.key)}/${g}`, priority: String(gi?.fm.priority ?? "medium"), stage: st?.stage ?? (gi ? todos.status(gi) : "missing"), why: st?.why ?? "", jobs: jobsOf(g) };
  });
  // The lifetime chart: every run on this issue or its parts, and the time the store got the file.
  const timeline = {
    filed: filed().issue.get(`${repo.key}-${ref}`) ?? null,
    runs: all.flat().filter((e) => onThis(onOf(e.run))).map(({ run: r }) => ({ kind: r.kind, name: r.name, on: r.on, condition: r.condition, started: r.started, ended: r.ended ?? null, model: r.model ?? null, cost: r.cost ?? null, reason: r.reason ?? null })),
  };
  // The hold records of every job name the answer shows.
  const holds = readHolds([...new Set([...jobs.map((j) => j.name), ...parts.flatMap((g) => g.jobs.map((j) => j.name)), ...timeline.runs.map((r) => r.name)])]);
  const up = parentOf(doc, item);
  const parent = up ? `${repo.key}-${todos.refOf(up)}` : null;

  const base = githubBase(git(repo.path, "remote", "get-url", "origin").out);
  // The issue's own commits, then each part's, with the part it landed for.
  const own = ref.includes(".") ? [ref] : [ref, ...partRefs];
  const seen = new Set<string>(), index = landedIndex(repo.path, main, repo.key);
  const commits = own.flatMap((r) => (index.get(r) ?? []).filter((h) => !seen.has(h) && seen.add(h)).map((h) => {
    const [hash, date, subject] = git(repo.path, "show", "-s", "--format=%H%x09%cI%x09%s", h).out.split("\t");
    return { hash, subject: subject ?? "", date, ...(r !== ref ? { part: `${repo.key}-${r}` } : {}), ...(base ? { commitUrl: `${base}/commit/${hash}` } : {}) };
  }));

  const blockers = jobProjector().blockers(repo.key, ref);

  // The Ask row of an issue that waits for Chris: the item `attend` builds, from the NewIssue as the state builds it.
  const stored = askOf(`${repo.key}-${ref}`);
  let ask: unknown;
  if (stored && todos.status(item) === "open" && (mine?.stage ?? "waiting") === "waiting") {
    const id = `${repo.key}-${ref}`;
    const c: NewIssue = { id, title: item.title, status: "open", href: `#/issues/${encodeURIComponent(repo.key)}/${ref}`, labels: areasOf(item), notes: item.notes.length, created: String(item.fm.created_time ?? ""), updated: String(item.fm.updated_time ?? ""), stage: "waiting" };
    const q = stored.question || item.notes.at(-1)?.replace(/^\s*-\s*/, "").trim();
    if (q) c.question = q;
    if (stored.options.length) c.decision = stored;
    c.ask = stored; c.reason = stored.reason; c.askKind = stored.kind;
    ask = attend({ runs: [], issues: [c] }, []).items[0];
  }

  return Response.json({ ...row(repo.key, item), id: n, ref, blockers, ...(ask ? { ask } : {}), request: item.request || null, spec: item.spec || null, goals: parts, ...(parent ? { issue: { id: parent, href: `#/issues/${encodeURIComponent(repo.key)}/${parent.replace(`${repo.key}-`, "")}` } } : {}), notes: item.notes, media: mediaOf(item), frontmatter: item.fm, derived: state, jobs, timeline, holds, commits, specs: specs(repo.key).map((s) => s.file) });
}

/**
 * Run `f` on the uploaded files, each `{ name, data }` with `data` in base64, written to a folder of their own that
 * goes after `f`: the CLI copies them into the store.
 */
async function withUploads<T>(given: unknown, f: (paths: string[]) => Promise<T>): Promise<T> {
  const files = Array.isArray(given) ? given : [];
  const dir = mkdtempSync(join(tmpdir(), "aleph-upload-"));
  try {
    const paths = files.map((m: any, i: number) => {
      const p = join(dir, String(i), basename(String(m?.name ?? "file")));
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, Buffer.from(String(m?.data ?? ""), "base64"));
      return p;
    });
    return await f(paths);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The registry repo, the issue's id and the issue a route names; a 404 when there is none. */
function target(params: Record<string, string>) {
  const none = () => fail(404, "no such issue");
  const repo = loadRegistry()[params.repo] ?? none();
  const n = refOf(params.id) ?? none();
  const item = todos.find(readList(repo) ?? none(), n) ?? none();
  return { repo, n, item };
}

/** `aleph issue attach <repo> <id>` with the uploaded files. */
const attachMedia = post(async (b, params) => {
  const { repo, n } = target(params);
  if (!Array.isArray(b.media) || !b.media.length) fail(400, "send the files as media");
  return withUploads(b.media, (paths) => aleph(["issue", "attach", "--", repo.key, String(n), ...paths]));
});

/** One media file of an issue, read from the store's main. */
function media(params: Record<string, string>): Response {
  const repo = loadRegistry()[params.repo];
  const doc = repo && /^\d+(\.\d+)?$/.test(params.n) ? readList(repo) : null;
  const item = doc ? todos.find(doc, params.n) : undefined;
  const i = item ? mediaOf(item).indexOf(params.name) : -1;
  if (!repo || !item || i < 0) return Response.json({ error: "no such file" }, { status: 404 });
  const ext = params.name.split(".").pop()!.toLowerCase();
  return new Response(Bun.file(mediaFiles(repo.key, item)[i]), { headers: { "content-type": MEDIA_TYPES[ext] ?? "application/octet-stream", "cache-control": "private, max-age=3600" } });
}

const create = post(async (b, _p, url) => {
  const project = url.searchParams.get("project");
  const repo = String(b.repo ?? b.project ?? project ?? "");
  const title = String(b.title ?? "").trim();
  if (!title) fail(400, "give the issue a title");
  if (!loadRegistry()[repo]) fail(400, repo ? `no repo named ${repo}` : "name a project");
  if (project && project !== repo) fail(400, `this view is filtered to ${project}`);
  const given = (Array.isArray(b.labels) ? b.labels : String(b.labels ?? "").split(",")).map((s: unknown) => String(s).trim()).filter(Boolean);
  // The form's factory box: the text is the issue's spec, so it builds.
  const labels = given.filter((l: string) => l !== "spec");
  const flags = [given.includes("spec") ? "--spec" : "--request", "-"];
  if (labels.length) flags.push("--labels", labels.join(","));
  const kind = str(b.kind);
  if (kind) flags.push("--kind", kind);
  const after = str(b.after)?.trim();
  if (after) flags.push("--after", after);
  return withUploads(b.media, (paths) => aleph(["issue", "add", ...flags, ...paths.flatMap((p) => ["--media", p]), "--", repo, title], { stdin: String(b.body ?? "") }));
});

/** `aleph issue drop <repo> <id>`: the CLI stays the one writer. Answers with its JSON (the new status). */
const drop = post((b, params) => {
  const { repo, n } = target(params);
  const given = typeof b.reason === "string" ? b.reason.trim() : "";
  // The note starts with Chris, so the Gates log shows the drop as his: a Deny reason already does, any other gets "Chris dropped: ".
  const reason = !given ? "Chris dropped it" : given.startsWith("Chris") ? given : `Chris dropped: ${given}`;
  return aleph(["issue", "drop", "--", repo.key, String(n), reason]);
});

/**
 * `aleph issue decide <repo> <id> <note>`: Chris's answer to an issue that asks. The body names an option's
 * `label`, or `recommendation: true` for an issue whose question is prose; the note is built here from the issue's own text.
 * The chosen option's `after` becomes the issue's `after`.
 */
const decide = post((b, params) => {
  const { repo, n, item } = target(params);
  const d = askOf(refIn(repo.key, item));
  if (todos.status(item) !== "open" || !d) return fail(409, "this issue is not waiting for a decision");
  const o = d.options.find((x) => x.label === b.label);
  if (d.options.length && !o) fail(400, `no option named ${JSON.stringify(b.label ?? null)}`);
  const rec = b.recommendation === true ? proseDecision(item.notes.at(-1)).recommendation : null;
  const note = o ? `Chris decided: ${o.label}: ${o.line}` : b.approve === true ? "Chris approved it" : rec ? `Chris decided: ${rec}` : fail(400, "this issue has no recommendation to approve");
  return aleph(["issue", "decide", ...(o?.after ? ["--after", o.after] : []), "--", repo.key, String(n), note]);
});

/** Stop Waiting: removes the waits that never end, and keeps the others. */
const unblock = post(async (_b, params) => {
  const { repo, n, item } = target(params);
  const dead = jobProjector().blockers(repo.key, n).filter((b) => b.dead).map((b) => b.id);
  if (!dead.length) fail(409, "this issue has no wait that never ends");
  const keep = afterOf(item).filter((a) => !dead.includes(a));
  await aleph(["issue", "edit", "--after", keep.join(",") || "none", "--", repo.key, String(n)]);
  return { removed: dead };
});

/** `aleph issue edit` from the Issue page: the CLI stays the one writer. */
const edit = post((b, params) => {
  const { repo, n } = target(params);
  const flags = ["--title", String(b.title ?? ""), "--priority", String(b.priority ?? ""), "--source", String(b.source ?? ""), "--labels", String(b.areas ?? ""), "--request", "-", ...(typeof b.spec === "string" ? ["--spec", b.spec] : [])];
  return aleph(["issue", "edit", ...flags, "--", repo.key, String(n)], { stdin: String(b.description ?? "").trim() });
});

/** `aleph issue note` from the Issue page. */
const addNote = post((b, params) => {
  const { repo, n } = target(params);
  const text = String(b.text ?? "").trim();
  if (!text) fail(400, "the note is empty");
  return aleph(["issue", "note", "--", repo.key, String(n), text]);
});

/**
 * An asking issue's one-line answer, run as the CLI: `retriage` is `aleph issue note` (the Ask leaves; intake runs again at once),
 * `rerun` is `aleph issue decide`, `checked` is `aleph issue done`.
 */
const answer = (verb: "note" | "decide" | "done", text: string) => post((_b, params) => {
  const { repo, n, item } = target(params);
  if (todos.status(item) !== "open" || !awaitsChris(refIn(repo.key, item))) fail(409, "this issue is not waiting for you");
  return aleph(["issue", verb, "--", repo.key, String(n), text]);
});

export const routes: Routes = {
  "POST /api/issues/:repo/:id/retriage": answer("note", "Chris: run intake again"),
  "POST /api/issues/:repo/:id/rerun": answer("decide", "Chris: run it again"),
  "POST /api/issues/:repo/:id/checked": answer("done", "Chris: checked on the host"),
  "POST /api/issues/:repo/:id/unblock": unblock,
  "POST /api/issues/:repo/:id/edit": edit,
  "POST /api/issues/:repo/:id/note": addNote,
  "POST /api/issues/:repo/:id/media": attachMedia,
  "GET /api/issues/:repo/:n/media/:name": (_req, params) => media(params),
  "POST /api/issues/:repo/:id/drop": drop,
  "POST /api/issues/:repo/:id/decide": decide,
  "GET /api/issues": (_req, _p, url) => list(url),
  "GET /api/issues/:repo/:n": (_req, params, url) => detail(params, url),
  "POST /api/issues": create,
};
