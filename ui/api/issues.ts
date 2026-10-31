/**
 * `GET /api/issues`, `GET /api/issues/:repo/:n` and `POST /api/issues`: the
 * Issues and Issue views' data. `?all=1` lists every repo, not only the recent ones. Every route takes `?project=<key>` and shows
 * only that project. A read is the work store's origin/main; a write runs
 * `aleph issue add`, so the CLI stays the one writer. A POST must carry `X-Aleph-UI: 1` and, when it has
 * an Origin, the server's own. The password gate in `ui/auth.ts` is what stops a LAN client, so this check is only against other web pages.
 */
import { runCli } from "../../jobs/lib/launch.ts";
import { allJobs, lastReal } from "../../jobs/lib/job.ts";
import { loadRegistry, onOf, type Repo } from "../../jobs/lib/ledger.ts";
import { git } from "../../jobs/lib/git.ts";
import { landedCommits, recentRepos, repoStages } from "../../jobs/lib/status.ts";
import { readAsk } from "../../jobs/lib/ask.ts";
import { Refusal } from "../../jobs/lib/transitions.ts";
import * as issues from "../../todo/lib/issues.ts";
// @ts-ignore plain JS, shared with the page
import { proseDecision } from "../decision.js";
import { afterOf, areasOf, awaitsChris, goalsOf, issueOf, kindOf, readList, readLists } from "../../todo/lib/store.ts";
import * as todos from "../../todo/lib/todo.ts";
import type { Routes } from "../server.ts";
import { githubBase } from "../state.ts";

/** An issue or goal id from a route: `7` or `7.1`; null for anything else. */
const refOf = (raw: string): number | string | null => (/^\d+$/.test(raw) ? Number(raw) : /^\d+\.\d+$/.test(raw) ? raw : null);


const str = (v: unknown): string | null => (v === undefined || v === null || v === "" ? null : String(v));

export interface Row {
  id: number; ref: string; kind: "goal" | "issue"; repo: string; title: string; status: string; priority: string | null; labels: string[];
  due: string | null; after: string[]; updated: string | null; notes: number;
  /** Only on a goal. */
  stage?: string; state?: string; why?: string;
}

function row(repo: string, i: todos.Issue): Row {
  return {
    id: i.id, ref: todos.refOf(i), kind: kindOf(i), repo, title: i.title, status: todos.status(i), priority: str(i.fm.priority), labels: areasOf(i),
    due: str(i.fm.due), after: afterOf(i), updated: str(i.fm.updated), notes: i.notes.length,
  };
}

/** The old state words, beside `stage` until the Issues page moves to stages. */
const OLD: Record<string, string> = { dropped: "dropped", done: "done", awaiting: "awaiting", stuck: "stuck", building: "running", landing: "running" };
const oldState = (stage: string): string => OLD[stage] ?? "open";

/** Each goal's stage, from the list already read and one pass over main's trailers. */
function derived(repo: Repo, doc: todos.Doc, rows: Row[]): void {
  const goals = rows.filter((r) => r.kind === "goal");
  if (!goals.length) return;
  let states;
  try { states = repoStages(repo, { fetch: false, doc, items: goals.map((r) => r.ref) }); } catch { return; }
  for (const r of goals) {
    const s = states.find((x) => x.id === `${repo.key}-${r.ref}`);
    if (s) { r.stage = s.stage; r.state = oldState(s.stage); r.why = s.why; }
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
    const items = rows.filter((r) => (!status || r.status === status) && (!label || (label === "goal" ? r.kind === "goal" : r.labels.includes(label))));
    if (items.length) out.push(...items);
  }
  return Response.json(out);
}

/** The text under the body's `## Request` heading, up to the next `## ` heading; none when the body has no such heading. */
export function requestOf(body: string): string | null {
  const m = /^## Request[ \t]*\r?\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(body);
  return m ? m[1].trim() : null;
}

/** A job as the Issue page lists it: its name, state, times, cost and how many runs it holds. */
function jobRow(runs: ReturnType<typeof allJobs>[number]) {
  const r = lastReal(runs).run;
  const cost = runs.some((e) => e.run.cost !== undefined) ? runs.reduce((a, e) => a + (e.run.cost ?? 0), 0) : undefined;
  return { name: r.name, state: r.state, kind: r.kind, started: runs[0].run.started, ended: r.ended ?? null, cost: cost ?? null, runs: runs.length };
}

/** Whether an `onOf` value names issue `n`: the number itself, or a goal `<n>.<k>` of it. */
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
  const goalRefs = goalsOf(item).map((g) => (g.startsWith(`${repo.key}-`) ? g.slice(repo.key.length + 1) : g));
  let states = new Map<string, { stage: string; why: string }>();
  try { for (const s of repoStages(repo, { fetch: false, doc, items: [ref, ...goalRefs] })) states.set(s.id.slice(repo.key.length + 1), s); } catch {}
  const mine = states.get(ref);
  const state = mine ? { item: `${repo.key}-${ref}`, stage: mine.stage, why: mine.why } : null;

  const all = allJobs().filter((runs) => runs[0].run.repo === repo.key);
  const jobsOf = (r: string) => all.filter((runs) => runs.some((e) => String(onOf(e.run)) === r)).map(jobRow);
  const jobs = !ref.includes(".") ? all.filter((runs) => runs.some((e) => isOfIssue(onOf(e.run), n))).map(jobRow) : jobsOf(ref);

  // The Issue page: the `## Request`, then the goals, each with its Job.
  const kind = kindOf(item);
  const goals = kind === "issue" ? goalRefs.map((g) => {
    const gi = todos.find(doc!, g), st = states.get(g);
    return { id: `${repo.key}-${g}`, title: gi?.title ?? "", href: `#/issues/${encodeURIComponent(repo.key)}/${g}`, stage: st?.stage ?? (gi ? todos.status(gi) : "missing"), why: st?.why ?? "", jobs: jobsOf(g) };
  }) : [];
  const parent = kind === "goal" ? issueOf(item) : null;

  const base = githubBase(git(repo.path, "remote", "get-url", "origin").out);
  const commits = landedCommits(repo.path, main, repo.key, n).map((h) => {
    const [hash, date, subject] = git(repo.path, "show", "-s", "--format=%H%x09%cI%x09%s", h).out.split("\t");
    return { hash, subject: subject ?? "", date, ...(base ? { commitUrl: `${base}/commit/${hash}` } : {}) };
  });

  return Response.json({ ...row(repo.key, item), id: n, ref, kind, request: kind === "issue" ? requestOf(item.body) : null, goals, ...(parent ? { issue: { id: parent, href: `#/issues/${encodeURIComponent(repo.key)}/${parent.replace(`${repo.key}-`, "")}` } } : {}), body: item.body, notes: item.notes, frontmatter: item.fm, derived: state, jobs, commits });
}

async function create(req: Request, url: URL): Promise<Response> {
  const origin = req.headers.get("origin");
  if (req.headers.get("x-aleph-ui") !== "1" || (origin !== null && origin !== url.origin)) return Response.json({ error: "forbidden" }, { status: 403 });
  let b: any;
  try { b = await req.json(); } catch { return Response.json({ error: "send JSON" }, { status: 400 }); }
  const project = url.searchParams.get("project");
  const repo = String(b?.repo ?? b?.project ?? project ?? "");
  const title = String(b?.title ?? "").trim();
  if (!title) return Response.json({ error: "give the issue a title" }, { status: 400 });
  if (!loadRegistry()[repo]) return Response.json({ error: repo ? `no repo named ${repo}` : "name a project" }, { status: 400 });
  if (project && project !== repo) return Response.json({ error: `this view is filtered to ${project}` }, { status: 400 });
  const given = (Array.isArray(b.labels) ? b.labels : String(b.labels ?? "").split(",")).map((s: unknown) => String(s).trim()).filter(Boolean);
  // The `goal` label is a goal now: the text is filed as goal `.1` beside the issue.
  const labels = given.filter((l: string) => l !== "goal");
  const args = ["issue", "add", repo, title, given.includes("goal") ? "--goal" : "--body", "-"];
  if (labels.length) args.push("--labels", labels.join(","));
  const after = str(b.after)?.trim();
  if (after) { if (!given.includes("goal")) return Response.json({ error: "an issue does not wait on another: file a goal and name the goal it follows with --after" }, { status: 400 }); args.push("--after", after); }
  const due = str(b.due)?.trim();
  if (due) args.push("--due", due);
  const { stdout: out, stderr: err, code } = await runCli(args, { stdin: String(b.body ?? "") });
  if (code !== 0) return Response.json({ error: (err || out).trim() || `aleph exited ${code}` }, { status: 422 });
  let added: unknown = {};
  try { added = JSON.parse(out); } catch { added = { output: out.trim() }; }
  return Response.json(added);
}

/** `aleph issue drop <repo> <id>`: the CLI's own command, so the CLI stays the one writer. Answers with its JSON (the new status). */
async function drop(req: Request, params: Record<string, string>, url: URL): Promise<Response> {
  const origin = req.headers.get("origin");
  if (req.headers.get("x-aleph-ui") !== "1" || (origin !== null && origin !== url.origin)) return Response.json({ error: "forbidden" }, { status: 403 });
  const repo = loadRegistry()[params.repo];
  const n = refOf(params.id);
  const none = Response.json({ error: "no such issue" }, { status: 404 });
  if (!repo || n === null) return none;
  let doc: todos.Doc | null;
  try { doc = readList(repo); } catch (e: any) { return Response.json({ error: e?.message ?? String(e) }, { status: 500 }); }
  if (!doc || !todos.find(doc, n)) return none;
  const body: any = await req.json().catch(() => ({}));
  const reason = typeof body?.reason === "string" && body.reason.trim() ? body.reason.trim() : "cancelled from the Activity page";
  const { stdout: out, stderr: err, code } = await runCli(["issue", "drop", repo.key, String(n), reason]);
  if (code !== 0) return Response.json({ error: (err || out).trim() || `aleph exited ${code}` }, { status: 422 });
  try { return Response.json(JSON.parse(out)); } catch { return Response.json({ output: out.trim() }); }
}

/**
 * `aleph issue decide <repo> <id> <note>`: Chris's answer to an issue that asks. The body names an option's
 * `label`, or `recommendation: true` for an issue whose question is prose; the note is built here from the issue's own text.
 */
async function decide(req: Request, params: Record<string, string>, url: URL): Promise<Response> {
  const origin = req.headers.get("origin");
  if (req.headers.get("x-aleph-ui") !== "1" || (origin !== null && origin !== url.origin)) return Response.json({ error: "forbidden" }, { status: 403 });
  const repo = loadRegistry()[params.repo];
  const n = refOf(params.id);
  if (!repo || n === null) return Response.json({ error: "no such issue" }, { status: 404 });
  let doc: todos.Doc | null;
  try { doc = readList(repo); } catch (e: any) { return Response.json({ error: e?.message ?? String(e) }, { status: 500 }); }
  const item = doc && todos.find(doc, n);
  if (!item) return Response.json({ error: "no such issue" }, { status: 404 });
  if (todos.status(item) !== "open" || !awaitsChris(item)) return Response.json({ error: "this issue is not waiting for a decision" }, { status: 409 });
  const body: any = await req.json().catch(() => ({}));
  const d = readAsk(item);
  let note: string;
  let after: string[] | undefined;
  if (d) {
    const o = d.options.find((x) => x.label === body?.label);
    if (!o) return Response.json({ error: `no option named ${JSON.stringify(body?.label ?? null)}` }, { status: 400 });
    note = `Chris decided: ${o.label}: ${o.line}`;
    after = o.after ? [o.after] : undefined;
  } else if (body?.approve === true) {
    note = "Chris approved it";
  } else {
    const rec = body?.recommendation === true ? proseDecision(item.notes.at(-1)).recommendation : null;
    if (!rec) return Response.json({ error: "this issue has no recommendation to approve" }, { status: 400 });
    note = `Chris decided: ${rec}`;
  }
  // In process, as the firefighter does: an option's dependency sets `after`.
  try {
    const r = issues.decide(repo, n, note, after ? { after } : {});
    return Response.json(r.result);
  } catch (e: any) {
    if (!(e instanceof Refusal)) throw e;
    return Response.json({ error: e.message }, { status: 422 });
  }
}

/**
 * An asking issue's one-line answer, run as the CLI: `retriage` is `aleph issue note` (the label leaves; the tick triages it),
 * `rerun` is `aleph issue decide`. `aleph issue note` takes the answer as its text, not as a flag.
 */
function answer(verb: "note" | "decide" | "done", text: string) {
  return async (req: Request, params: Record<string, string>, url: URL): Promise<Response> => {
    const origin = req.headers.get("origin");
    if (req.headers.get("x-aleph-ui") !== "1" || (origin !== null && origin !== url.origin)) return Response.json({ error: "forbidden" }, { status: 403 });
    const repo = loadRegistry()[params.repo];
    const n = refOf(params.id);
    const none = Response.json({ error: "no such issue" }, { status: 404 });
    if (!repo || n === null) return none;
    let doc: todos.Doc | null;
    try { doc = readList(repo); } catch (e: any) { return Response.json({ error: e?.message ?? String(e) }, { status: 500 }); }
    const item = doc && todos.find(doc, n);
    if (!item) return none;
    if (todos.status(item) !== "open" || !awaitsChris(item)) return Response.json({ error: "this issue is not waiting for you" }, { status: 409 });
    const { stdout: out, stderr: err, code } = await runCli(["issue", verb, repo.key, String(n), text]);
    if (code !== 0) return Response.json({ error: (err || out).trim() || `aleph exited ${code}` }, { status: 422 });
    try { return Response.json(JSON.parse(out)); } catch { return Response.json({ output: out.trim() }); }
  };
}

export const routes: Routes = {
  "POST /api/issues/:repo/:id/retriage": answer("note", "Chris: run triage again"),
  "POST /api/issues/:repo/:id/rerun": answer("decide", "Chris: run it again"),
  "POST /api/issues/:repo/:id/checked": answer("done", "Chris: checked on the host"),
  "POST /api/issues/:repo/:id/drop": (req, params, url) => drop(req, params, url),
  "POST /api/issues/:repo/:id/decide": (req, params, url) => decide(req, params, url),
  "GET /api/issues": (_req, _p, url) => list(url),
  "GET /api/issues/:repo/:n": (_req, params, url) => detail(params, url),
  "POST /api/issues": (req, _p, url) => create(req, url),
};
