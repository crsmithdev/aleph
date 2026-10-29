/**
 * `GET /api/issues`, `GET /api/issues/:repo/:n` and `POST /api/issues`: the
 * Issues and Issue views' data. `?all=1` lists every repo, not only the recent ones. Every route takes `?project=<key>` and shows
 * only that project. A read is the work store's origin/main; a write runs
 * `aleph todo add`, so the CLI stays the one writer.
 */
import { runCli } from "../../jobs/lib/launch.ts";
import { allJobs, lastReal } from "../../jobs/lib/job.ts";
import { loadRegistry, type Repo } from "../../jobs/lib/ledger.ts";
import { git } from "../../jobs/lib/git.ts";
import { itemStates, landedCommits, recentRepos } from "../../jobs/lib/status.ts";
import { readDecision } from "../../jobs/lib/decision.ts";
// @ts-ignore plain JS, shared with the page
import { proseDecision } from "../decision.js";
import { labels, needsChris, readList, readLists } from "../../todo/lib/store.ts";
import * as todos from "../../todo/lib/todo.ts";
import type { Routes } from "../server.ts";
import { githubBase } from "../state.ts";


const str = (v: unknown): string | null => (v === undefined || v === null || v === "" ? null : String(v));

export interface Row {
  id: number; repo: string; title: string; status: string; priority: string | null; labels: string[];
  due: string | null; waiting_on: string | null; updated: string | null; notes: number;
  /** Only on an issue labelled `goal`. */
  state?: string; why?: string;
}

function row(repo: string, i: todos.Item): Row {
  return {
    id: i.id, repo, title: i.title, status: todos.status(i), priority: str(i.fm.priority), labels: labels(i),
    due: str(i.fm.due), waiting_on: str(i.fm.waiting_on), updated: str(i.fm.updated), notes: i.notes.length,
  };
}

/** Each goal's state, from the list already read and one pass over main's trailers. */
function derived(repo: Repo, doc: todos.Doc, rows: Row[]): void {
  const goals = rows.filter((r) => r.labels.includes("goal"));
  if (!goals.length) return;
  let states;
  try { states = itemStates(repo, { fetch: false, doc, items: goals.map((r) => r.id) }); } catch { return; }
  for (const r of goals) {
    const s = states.find((x) => x.item === `${repo.key}-${r.id}`);
    if (s) { r.state = s.state; r.why = s.why; }
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

function detail(params: Record<string, string>, url: URL): Response {
  const project = url.searchParams.get("project");
  const repo = loadRegistry()[params.repo];
  const n = Number(params.n);
  if (!repo || !Number.isInteger(n) || (project && project !== repo.key)) return Response.json({ error: "no such issue" }, { status: 404 });
  let doc: todos.Doc | null;
  try { doc = readList(repo); } catch (e: any) { return Response.json({ error: e?.message ?? String(e) }, { status: 500 }); }
  const item = doc && todos.find(doc, n);
  if (!doc || !item) return Response.json({ error: "no such issue" }, { status: 404 });

  const main = `refs/remotes/origin/${repo.main}`;
  let state = null;
  try { state = itemStates(repo, { fetch: false, items: [n] })[0] ?? null; } catch {}

  const jobs = allJobs()
    .filter((runs) => runs[0].run.repo === repo.key && runs.some((e) => e.run.todo === n))
    .map((runs) => {
      const r = lastReal(runs).run;
      const cost = runs.some((e) => e.run.cost !== undefined) ? runs.reduce((a, e) => a + (e.run.cost ?? 0), 0) : undefined;
      return { name: r.name, state: r.state, started: runs[0].run.started, ended: r.ended ?? null, cost: cost ?? null };
    });

  const base = githubBase(git(repo.path, "remote", "get-url", "origin").out);
  const commits = landedCommits(repo.path, main, repo.key, n).map((h) => {
    const [hash, date, subject] = git(repo.path, "show", "-s", "--format=%H%x09%cI%x09%s", h).out.split("\t");
    return { hash, subject: subject ?? "", date, ...(base ? { commitUrl: `${base}/commit/${hash}` } : {}) };
  });

  return Response.json({ ...row(repo.key, item), body: item.body, notes: item.notes, frontmatter: item.fm, derived: state, jobs, commits });
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
  const labels = (Array.isArray(b.labels) ? b.labels : String(b.labels ?? "").split(",")).map((s: unknown) => String(s).trim()).filter(Boolean);
  const args = ["todo", "add", repo, title, "--body", "-"];
  if (labels.length) args.push("--labels", labels.join(","));
  const waits = str(b.waitingOn ?? b.waiting_on)?.trim();
  if (waits) args.push("--waiting-on", waits);
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
  const n = Number(params.id);
  const none = Response.json({ error: "no such issue" }, { status: 404 });
  if (!repo || !Number.isInteger(n)) return none;
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
 * `aleph issue decide <repo> <id> <note>`: Chris's answer to a needs-chris issue. The body names an option's
 * `label`, or `recommendation: true` for an issue whose question is prose; the note is built here from the issue's own text.
 */
async function decide(req: Request, params: Record<string, string>, url: URL): Promise<Response> {
  const origin = req.headers.get("origin");
  if (req.headers.get("x-aleph-ui") !== "1" || (origin !== null && origin !== url.origin)) return Response.json({ error: "forbidden" }, { status: 403 });
  const repo = loadRegistry()[params.repo];
  const n = Number(params.id);
  if (!repo || !Number.isInteger(n)) return Response.json({ error: "no such issue" }, { status: 404 });
  let doc: todos.Doc | null;
  try { doc = readList(repo); } catch (e: any) { return Response.json({ error: e?.message ?? String(e) }, { status: 500 }); }
  const item = doc && todos.find(doc, n);
  if (!item) return Response.json({ error: "no such issue" }, { status: 404 });
  if (todos.status(item) !== "open" || !needsChris(item)) return Response.json({ error: "this issue is not waiting for a decision" }, { status: 409 });
  const body: any = await req.json().catch(() => ({}));
  const d = readDecision(item);
  let note: string;
  let waitingOn: string | undefined;
  if (d) {
    const o = d.options.find((x) => x.label === body?.label);
    if (!o) return Response.json({ error: `no option named ${JSON.stringify(body?.label ?? null)}` }, { status: 400 });
    note = `Chris decided: ${o.label}: ${o.line}`;
    waitingOn = o.waiting_on;
  } else {
    const rec = body?.recommendation === true ? proseDecision(item.notes.at(-1)).recommendation : null;
    if (!rec) return Response.json({ error: "this issue has no recommendation to approve" }, { status: 400 });
    note = `Chris decided: ${rec}`;
  }
  const { stdout: out, stderr: err, code } = await runCli(["issue", "decide", repo.key, String(n), ...(waitingOn ? ["--waiting-on", waitingOn] : []), note]);
  if (code !== 0) return Response.json({ error: (err || out).trim() || `aleph exited ${code}` }, { status: 422 });
  try { return Response.json(JSON.parse(out)); } catch { return Response.json({ output: out.trim() }); }
}

/**
 * A needs-chris issue's one-line answer, run as the CLI: `retriage` is `aleph issue note` (the label leaves; the tick triages it),
 * `rerun` is `aleph issue decide`. `aleph issue note` takes the answer as its text, not as a flag.
 */
function answer(verb: "note" | "decide", text: string) {
  return async (req: Request, params: Record<string, string>, url: URL): Promise<Response> => {
    const origin = req.headers.get("origin");
    if (req.headers.get("x-aleph-ui") !== "1" || (origin !== null && origin !== url.origin)) return Response.json({ error: "forbidden" }, { status: 403 });
    const repo = loadRegistry()[params.repo];
    const n = Number(params.id);
    const none = Response.json({ error: "no such issue" }, { status: 404 });
    if (!repo || !Number.isInteger(n)) return none;
    let doc: todos.Doc | null;
    try { doc = readList(repo); } catch (e: any) { return Response.json({ error: e?.message ?? String(e) }, { status: 500 }); }
    const item = doc && todos.find(doc, n);
    if (!item) return none;
    if (todos.status(item) !== "open" || !needsChris(item)) return Response.json({ error: "this issue is not waiting for you" }, { status: 409 });
    const { stdout: out, stderr: err, code } = await runCli(["issue", verb, repo.key, String(n), text]);
    if (code !== 0) return Response.json({ error: (err || out).trim() || `aleph exited ${code}` }, { status: 422 });
    try { return Response.json(JSON.parse(out)); } catch { return Response.json({ output: out.trim() }); }
  };
}

export const routes: Routes = {
  "POST /api/issues/:repo/:id/retriage": answer("note", "Chris: run triage again"),
  "POST /api/issues/:repo/:id/rerun": answer("decide", "Chris: run it again"),
  "POST /api/issues/:repo/:id/drop": (req, params, url) => drop(req, params, url),
  "POST /api/issues/:repo/:id/decide": (req, params, url) => decide(req, params, url),
  "GET /api/issues": (_req, _p, url) => list(url),
  "GET /api/issues/:repo/:n": (_req, params, url) => detail(params, url),
  "POST /api/issues": (req, _p, url) => create(req, url),
};
