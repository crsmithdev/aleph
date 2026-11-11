/**
 * `GET /api/issues`, `GET /api/issues/:id` and `POST /api/issues`: the Issues and Issue views' data. `GET /api/issues` is
 * `{ issues, projects, tests }`: every issue row with the count and recorded cost of the jobs on it and its parts, its own alone in `own`, the
 * registry's keys and each project's suite history records. `:id` is an issue ID, short (`a1430`) or full. Every route
 * takes `?project=<key>` and shows only that project. A read is the work store's origin/main; a write runs
 * `aleph issue <verb>` through ui/action.ts, so the CLI stays the one writer.
 */
import { specs } from "./specs.ts";
import { aleph, fail, post } from "../action.ts";
import { allJobs } from "../../jobs/lib/records/job.ts";
import { allRuns, issueKeyOf, loadRegistry, runsByIssue, type Repo } from "../../jobs/lib/records/ledger.ts";
import { counting as lastReal, jobIdOf } from "../../jobs/lib/records/record.ts";
import { git } from "../../jobs/lib/infra/git.ts";
import { landedIndex, repoStages } from "../../jobs/lib/records/status.ts";
import { askOf, awaitsChris, refIn } from "../../jobs/lib/asks/ask.ts";
// @ts-ignore plain JS, shared with the page
import { proseDecision } from "../decision.js";
import { afterOf, MEDIA_TYPES, mediaFiles, mediaOf, parentOf, partsOf, priorityOf, readList, readLists } from "../../issues/lib/store.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import * as todos from "../../issues/lib/todo.ts";
import type { Routes } from "../server.ts";
import { attend } from "../asks.ts";
import { githubBase, jobProjector, logOnce } from "../state.ts";
import { card, row, stageOf, type Row } from "../issue.ts";
import { issueHref, jobHref, parseId } from "../../lib/naming.ts";
import type { Stage } from "../../jobs/lib/records/stage.ts";
import { filed } from "./speed.ts";
import { readHolds, suiteHistory } from "../../jobs/lib/gates/factory-status.ts";
import { projectOf, repoIn } from "./scope.ts";

const str = (v: unknown): string | null => (v === undefined || v === null || v === "" ? null : String(v));

/** An issue ref: `7` or `7.1`; null for anything else. */
const refOf = (raw: string): number | string | null => (/^\d+$/.test(raw) ? Number(raw) : /^\d+\.\d+$/.test(raw) ? raw : null);

/** The registry repo and the ref (`7`, `7.1`) of an issue ID from a route; null when no registry repo has it. */
function issueOf(id: string): { repo: Repo; ref: string } | null {
  const registry = loadRegistry(), p = parseId(id);
  const repo = p ? registry[p.repo] : undefined;
  return repo ? { repo, ref: p!.sub === undefined ? String(p!.n) : `${p!.n}.${p!.sub}` } : null;
}


/** Each item's stage by ref, from the list already read and one pass over main's trailers; empty when the trailers cannot be read. */
function stagesBy(repo: Repo, doc: todos.Doc, items?: string[]): Map<string, Stage> {
  try { return new Map(repoStages(repo, { fetch: false, doc, items }).map((st) => [st.id.slice(repo.key.length + 1), st])); } catch (e: any) { logOnce("stages", e); return new Map(); }
}

function list(url: URL): Response {
  const project = projectOf(url);
  const repos = Object.values(loadRegistry()).filter((r) => repoIn(r.key, project));
  let docs: (todos.Doc | null)[];
  try { docs = readLists(repos); } catch (e: any) { return Response.json({ error: e?.message ?? String(e) }, { status: 500 }); }
  const rows: Row[] = repos.flatMap((repo, n) => {
    const doc = docs[n];
    if (!doc) return [];
    const states = stagesBy(repo, doc);
    return doc.items.map((i) => row(repo.key, i, states.get(todos.refOf(i))));
  });
  const by = runsByIssue(allRuns()), key = (r: Row) => `${r.repo}-${r.ref}`;
  const own = (r: Row) => { const es = by.get(key(r)) ?? []; return { runs: es.length, cost: es.reduce((n, e) => n + (e.run.cost ?? 0), 0) }; };
  // A child's jobs also count for its parent: `runs` and `cost` hold both, `own` the row's alone.
  const kids = Map.groupBy(rows.filter((r) => r.parent !== null), (r) => `${r.repo}-${r.parent}`);
  const totals = (r: Row) => [own(r), ...(kids.get(key(r)) ?? []).map(own)].reduce((a, t) => ({ runs: a.runs + t.runs, cost: a.cost + t.cost }));
  const projects = repos.map((r) => r.key);
  return Response.json({ issues: rows.map((r) => ({ ...r, ...totals(r), own: own(r) })), projects, tests: Object.fromEntries(projects.map((k) => [k, suiteHistory(k)])) });
}

/** A job as the Issue page lists it: the job ID of its run that counts, its name, state, times, cost and how many runs it holds. */
function jobRow(runs: ReturnType<typeof allJobs>[number]) {
  const last = lastReal(runs), r = last.run;
  const cost = runs.some((e) => e.run.cost !== undefined) ? runs.reduce((a, e) => a + (e.run.cost ?? 0), 0) : undefined;
  return { id: jobIdOf(last), name: r.name, condition: r.condition, kind: r.kind, started: runs[0].run.started, ended: r.ended ?? null, cost: cost ?? null, runs: runs.length };
}

function detail(params: Record<string, string>, url: URL): Response {
  const project = projectOf(url);
  const at = issueOf(params.id);
  if (!at || !repoIn(at.repo.key, project)) return Response.json({ error: "no such issue" }, { status: 404 });
  const { repo, ref } = at;
  let doc: todos.Doc | null;
  try { doc = readList(repo); } catch (e: any) { return Response.json({ error: e?.message ?? String(e) }, { status: 500 }); }
  const item = doc && todos.find(doc, ref);
  if (!doc || !item) return Response.json({ error: "no such issue" }, { status: 404 });
  const n = item.id;

  const main = `refs/remotes/origin/${repo.main}`;
  const partRefs = partsOf(doc, item).map(todos.refOf);
  const states = stagesBy(repo, doc, [ref, ...partRefs]);
  const mine = todos.status(item) === "parked" ? undefined : states.get(ref);
  const state = mine ? { item: `${repo.key}-${ref}`, stage: mine.stage, why: mine.why } : null;

  const all = allJobs().filter((runs) => runs[0].run.repo === repo.key);
  const every = allRuns();
  const jobsOf = (r: string) => all.filter((runs) => runs.some((e) => issueKeyOf(e.run) === `${repo.key}-${r}`)).map((runs) => jobRow(runs));
  // The runs on this issue, its old parts and its children.
  const by = runsByIssue(every, { rollUp: true }), keys = [ref, ...partRefs].map((r) => `${repo.key}-${r}`);
  const ours = new Set(keys.flatMap((k) => by.get(k) ?? []).map((e) => e.id));
  const jobs = all.filter((runs) => runs.some((e) => ours.has(e.id))).map((runs) => jobRow(runs));

  // The Issue page: the `## Request`, then the parts, each with its Job.
  const parts = partRefs.map((g) => {
    const gi = todos.find(doc!, g), st = states.get(g);
    return { id: `${repo.key}-${g}`, title: gi?.title ?? "", href: issueHref(`${repo.key}-${g}`), priority: gi ? priorityOf(gi) : "medium", stage: gi ? stageOf(gi, st) : "missing", why: st?.why ?? "", jobs: jobsOf(g) };
  });
  // The lifetime chart: every run on this issue or its parts, and the time the store got the file.
  const timeline = {
    filed: ((t) => (t == null ? null : new Date(t).toISOString()))(filed().issue.get(`${repo.key}-${ref}`)),
    runs: all.flat().filter((e) => ours.has(e.id)).map((e) => ({ r: e.run, href: jobHref(jobIdOf(e)) })).map(({ r, href }) => ({ kind: r.kind, name: r.name, href, on: r.on, issue: issueKeyOf(r) ?? null, condition: r.condition, started: r.started, ended: r.ended ?? null, model: r.model ?? null, cost: r.cost ?? null, reason: r.reason ?? null })),
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
  if (stored && todos.status(item) === "open" && (mine?.stage ?? "waiting") === "waiting") ask = attend({ runs: [], issues: [card(repo.key, item, "waiting", stored)] }, []).items[0];

  return Response.json({ ...row(repo.key, item, mine), id: n, ref, blockers, ...(ask ? { ask } : {}), request: item.request || null, spec: item.spec || null, goals: parts, ...(parent ? { issue: { id: parent, href: issueHref(parent) } } : {}), notes: item.notes.map(todos.noteOf), media: mediaOf(item), frontmatter: item.fm, derived: state, jobs, timeline, holds, commits, specs: specs(repo.key).map((s) => s.file) });
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
  const { repo, ref } = issueOf(params.id) ?? none();
  const n = refOf(ref) ?? none();
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
  const at = issueOf(params.id), repo = at?.repo;
  const doc = repo ? readList(repo) : null;
  const item = doc ? todos.find(doc, at!.ref) : undefined;
  const i = item ? mediaOf(item).indexOf(params.name) : -1;
  if (!repo || !item || i < 0) return Response.json({ error: "no such file" }, { status: 404 });
  const ext = params.name.split(".").pop()!.toLowerCase();
  return new Response(Bun.file(mediaFiles(repo.key, item)[i]), { headers: { "content-type": MEDIA_TYPES[ext] ?? "application/octet-stream", "cache-control": "private, max-age=3600" } });
}

const create = post(async (b, _p, url) => {
  const project = projectOf(url);
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
  const rec = b.recommendation === true ? proseDecision(todos.noteOf(item.notes.at(-1) ?? "").text).recommendation : null;
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
  "POST /api/issues/:id/retriage": answer("note", "Chris: run intake again"),
  "POST /api/issues/:id/rerun": answer("decide", "Chris: run it again"),
  "POST /api/issues/:id/checked": answer("done", "Chris: checked on the host"),
  "POST /api/issues/:id/unblock": unblock,
  "POST /api/issues/:id/edit": edit,
  "POST /api/issues/:id/note": addNote,
  "POST /api/issues/:id/media": attachMedia,
  "GET /api/issues/:id/media/:name": (_req, params) => media(params),
  "POST /api/issues/:id/drop": drop,
  "POST /api/issues/:id/decide": decide,
  "GET /api/issues": (_req, _p, url) => list(url),
  "GET /api/issues/:id": (_req, params, url) => detail(params, url),
  "POST /api/issues": create,
};
