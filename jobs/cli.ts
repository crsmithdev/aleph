#!/usr/bin/env bun
/**
 * aleph <job|run|land|checked|recheck|drop|jobs|issue|annotation|unit|tick|suite|report|pause|resume|status|judge>
 * — detached agent jobs, plain runs, each repo's issues, and the factory.
 * Ledger: $ALEPH_JOBS_DIR or ~/.aleph/runs. Registry: $ALEPH_REPOS or
 * ~/.aleph/repos.json. JSON on stdout, findings on stderr, exit 1 on refusal, and the foreground unit's exit code when it fails.
 * See docs/workflow.md and docs/factory.md.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { allRuns, loadRegistry, newsLine, type Entry, type Repo } from "./lib/records/ledger.ts";
import { isLive } from "./lib/infra/process.ts";
import { allJobs, findJob, isOpen, issue as issueOf, issueTitle, readFile, view, type Job } from "./lib/records/job.ts";
import { counting, patchRun } from "./lib/records/record.ts";
import { unit } from "./lib/roles/unit.ts";
import { onMain } from "./lib/records/status.ts";
import { removeBranch } from "./lib/land/landing.ts";
import { fetchOrigin, git } from "./lib/infra/git.ts";
import { judgeChoice, setJudgeChoice } from "../lib/jev.ts";
import * as issues from "../issues/lib/todo.ts";
import * as store from "../issues/lib/store.ts";
import * as verbs from "../issues/lib/issues.ts";
import * as notes from "../lib/annotations.ts";
import { askOf, refIn, grant, readAlways, revoke } from "./lib/asks/ask.ts";
import { behind, directorStep, hookLines, report, runDispatch, setPaused, suiteStep, intakeNow } from "./lib/transitions/factory.ts";
import { runTick } from "./lib/transitions/tick.ts";
import { dispatchDetached, intakeDetached } from "./lib/transitions/launch.ts";
import { health } from "./lib/gates/factory-status.ts";
import { addDays, flakeLines, renderTable, reportLine } from "./lib/learning/monitor-table.ts";
import { runMonitor, tableOf } from "./lib/roles/monitor.ts";
import { fit } from "./lib/roles/title.ts";
import { checkName, checked, drop, land, recheck, repoOf, startJob, startPlain, type Start } from "./lib/transitions/transitions.ts";
import type { Fate } from "./lib/records/outcome.ts";
import { refuse, Refusal } from "../lib/refusal.ts";
import * as doctor from "./lib/infra/doctor.ts";
import { facts, repoStages, stages } from "./lib/records/status.ts";
import type { Stage } from "./lib/records/stage.ts";
import { jobId } from "./lib/infra/settings.ts";
import { readModels, setModel } from "./lib/routing/models.ts";
import { parseId, shortText } from "../lib/naming.ts";

const DAY_MS = 24 * 3600_000;

const out = (value: unknown) => console.log(JSON.stringify(value, null, 2));

const [cmd, ...argv] = process.argv.slice(2);
// Everything after `--` is positional, so a name or a text that the UI passes is never read as a flag.
const dash = argv.indexOf("--");
const rest = dash < 0 ? argv : argv.slice(0, dash);
const tail = dash < 0 ? [] : argv.slice(dash + 1);
function flag(name: string): string | undefined {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
}
// A flag's value is not a positional. Every flag here takes one, so leaving a
// name off this list silently folds its value into the next argument: `todo add
// <repo> "<title>" --labels jobs` put "jobs" on the end of the title.
const VALUED = ["--media", "--source", "--spec", "--request", "--model", "--on", "--priority", "--labels", "--status", "--label", "--kind", "--title", "--after", "--reopened-since", "--before", "--undo", "--fate", "--day", "--url", "--selector", "--by"];
const FATES: Fate[] = ["duplicate", "met", "manual"];
const positional = [...rest.filter((a, i) => !a.startsWith("--") && !VALUED.includes(rest[i - 1])), ...tail];
/** What a start is written down as in its run's `command.txt`: the argv as typed. */
const command = process.argv.slice(2);

/** Print the started run, then wait for a foreground unit: the transition has dropped its locks. */
async function started(s: Start): Promise<void> {
  out(s.started);
  const code = await s.child?.exited;
  if (code) process.exitCode = code;
}

async function job(): Promise<void> {
  repoOf(positional[0]);
  checkName(positional[1]);
  const specArg = flag("spec") ?? refuse("--spec <file|-> is required");
  const [repo, name] = positional;
  const spec = specArg === "-" ? await Bun.stdin.text() : readFileSync(specArg, "utf8");
  const onArg = flag("on");
  await started(await startJob({ repo, name, spec, on: onArg, model: flag("model"), land: rest.includes("--land") }, { command }));
}

async function plain(): Promise<void> {
  await started(await startPlain({ name: rest[0], argv: tail, cwd: process.cwd() }, { command }));
}

/**
 * The ledger follows git. An open job whose work is on origin/<main> becomes
 * landed, quietly, with its issue done. An open job with no branch and
 * no worktree left is "gone": nothing is left to land. Every other open job
 * is "unlanded". Each repo is fetched once.
 */
function reconcile(all: Entry[][]): Map<string, string> {
  const registry = loadRegistry();
  const fetched = new Set<string>();
  const fates = new Map<string, string>();
  // Only Chris's git pull moves a checkout: the ledger fetches and reads refs.
  for (const runs of all.filter(isOpen)) {
    const last = runs.at(-1)!;
    const repo = last.run.repo ? registry[last.run.repo] : undefined;
    if (!repo || last.run.kind === "plain" || isLive(last.folder)) continue;
    if (!fetched.has(repo.key)) {
      fetched.add(repo.key);
      fetchOrigin(repo.path);
    }
    const found = onMain(repo, { job: last.run.job, branch: last.run.branch, fetch: false });
    if (found) {
      patchRun(last.id, { condition: "landed", commit: found.commit, reason: `found on main (${found.how})`, cause: undefined, ask: undefined, told: true });
      removeBranch(repo, last.run);
      const todo = issueOf(runs);
      const why = todo === undefined ? null : store.close(repo, todo, `job ${last.run.name} found on main as ${found.commit.slice(0, 7)}`);
      if (why) console.error(`warn: issue ${todo} not closed: ${why}`);
      continue;
    }
    const branch = last.run.branch && git(repo.path, "rev-parse", "--verify", "-q", `refs/heads/${last.run.branch}`).ok;
    fates.set(last.run.job, branch || (last.run.worktree && existsSync(last.run.worktree)) ? "unlanded" : "gone");
  }
  return fates;
}

function summary(runs: Job, fates = new Map<string, string>()) {
  const v = view(runs);
  return {
    name: v.name, repo: v.repo, kind: v.run.kind, job: v.job, run: v.run.id, goal: issueTitle(runs), condition: v.condition, needs: v.needs, phase: v.phase,
    reason: v.reason, say: v.say, review: v.review, ...(v.check ? { check: v.check } : {}), fate: fates.get(v.job), session: v.session, started: v.started, ended: v.ended,
    ...(v.lost ? { lost: true } : {}),
  };
}

function jobs(): void {
  if (rest.includes("--news")) {
    const news: { run: string; line: string }[] = [];
    for (const e of allRuns()) {
      if (e.run.condition === "running" || e.run.told) continue;
      news.push({ run: e.id, line: newsLine(e, e.run.repo ? loadRegistry()[e.run.repo]?.note : undefined) });
      patchRun(e.id, { told: true });
    }
    return out(news);
  }
  const fates = reconcile(allJobs());
  const all = allJobs();
  const name = positional[0];
  // A job that landed with its check open stays in the list until `aleph checked`.
  // A job that ended in the last 24 hours follows the open ones, the latest first.
  if (!name) {
    const listed = (j: Entry[]) => isOpen(j) || (counting(j).run.condition === "landed" && counting(j).run.check === "open");
    const ended = (j: Entry[]) => Date.parse(counting(j).run.ended ?? "");
    const recent = all.filter((j) => !listed(j) && Date.now() - ended(j) < DAY_MS).sort((a, b) => ended(b) - ended(a));
    return out([...all.filter(listed), ...recent].map((j) => summary(j, fates)));
  }
  const runs = findJob(name, null, all);
  if (!runs) refuse(`no job named ${name}`);
  const last = counting(runs!);
  const checks = readFile(last, "checks.log");
  out({
    ...summary(runs!, fates), question: last.run.question, result: readFile(last, "result.md"),
    checks: checks?.trimEnd().split("\n").slice(-40).join("\n"), land: readFile(last, "land.log"),
  });
}

/** After `aleph issue add` or `edit` of an open issue in a factory repo: a dispatch, so the issue starts at once. It never fails the write. */
function dispatchAfterIssue(repo: Repo, item: issues.Issue): void {
  if (!repo.sandbox || !store.buildableIssue(repo, issues.idOf(item))) return;
  dispatchDetached();
}

/**
 * aleph issue <add|list|show|note|done|drop|lint> <repo> ... — every repo in the
 * registry has a list in the work store. The verbs are issues/lib/issues.ts; this
 * parses argv, prints, and starts the dispatch or intake a write calls for.
 */
async function todoCmd(): Promise<void> {
  let [verb, repoKey, ...args] = positional;
  const json = rest.includes("--json");
  const fixing = rest.includes("--fix");
  const stat = flag("status");
  const label = flag("label");
  // `--request -` or `--spec -` reads that part from stdin: it is prose of several lines.
  const requestArg = flag("request"), specArg = flag("spec");
  const labelsArg = flag("labels");
  const afterArg = flag("after");
  const fields: verbs.Fields = {
    title: flag("title"),
    kind: flag("kind"),
    request: requestArg === undefined ? undefined : (requestArg === "-" ? await Bun.stdin.text() : requestArg).trim(),
    spec: specArg === undefined ? undefined : (specArg === "-" ? await Bun.stdin.text() : specArg).trim(),
    priority: flag("priority"),
    labels: labelsArg === undefined ? undefined : labelsArg.split(",").map((s) => s.trim()).filter(Boolean),
    source: flag("source"),
    status: stat,
    ...(afterArg === undefined ? {} : { after: afterArg.split(",").map((s) => s.trim()).filter(Boolean) }),
    // `--media <file>` may repeat.
    media: rest.flatMap((a, i) => (a === "--media" && rest[i + 1] !== undefined ? [rest[i + 1]] : [])),
  };
  const sub = verb ?? refuse("usage: aleph issue <add|list|show|note|attach|edit|decide|done|drop|lint|retitle> <repo> ... [--kind task|bug|check|flake|proposal|acceptance]");
  const registry = loadRegistry();
  const ref = parseId(repoKey);
  if (ref && sub !== "add") {
    repoKey = ref.repo;
    args = [ref.sub === undefined ? String(ref.n) : `${ref.n}.${ref.sub}`, ...args];
  }
  if (!repoKey && (sub === "list" || sub === "lint")) return todoRecent(sub, registry, { status: stat, label, kind: flag("kind") }, json);
  const repo = registry[repoKey ?? ""] ?? refuse(repoKey ? `no repo named ${repoKey}` : "name a repo");
  verbs.checkFields(fields);
  const id = /^\d+\.\d+$/.test(args[0] ?? "") ? args[0] : Number(args[0]);
  const text = args.slice(1).join(" ").trim();
  const warn = (follow: string | null | undefined) => { if (follow) console.error(`warn: ${follow}`); };

  switch (sub) {
    case "add": {
      const a = await verbs.add(repo, args.join(" "), fields);
      warn(a.follow);
      for (const m of a.result.maybeSame ?? []) console.error(`${repo.key}-${m.id} may be the same task: ${m.title}`);
      out(a.result);
      dispatchAfterIssue(repo, a.item);
      const list = store.reader().list(repo.key);
      if (list && !store.isSorted(list, a.item, repo)) intakeDetached(repo, a.item.id);
      return;
    }
    case "list": {
      const rows = verbs.list(repo, { status: stat, label, kind: flag("kind") });
      if (json) { out(rows.map(verbs.brief(repo.key))); return; }
      if (!rows.length) { console.log("no issues"); return; }
      printRows(rows, repo.key);
      return;
    }
    case "show": {
      const i = verbs.show(repo, id);
      if (json) { out({ ...verbs.brief(repo.key)(i), request: i.request, spec: i.spec, notes: i.notes, media: store.mediaOf(i) }); return; }
      console.log(`## ${issues.refOf(i)}. ${i.title}`);
      const ask = askOf(refIn(repo.key, i));
      console.log(`${issues.status(i)}   source ${store.sourceOf(i)}   priority ${store.priorityOf(i)}   updated ${issues.updated(i) ?? "-"}`);
      console.log(`after ${issues.localRefs(repo.key, store.afterOf(i).join(", ")) || "-"}   areas ${store.areasOf(i).join(", ") || "-"}`);
      console.log(`ask ${ask ? `${ask.kind} (${ask.reason}): ${ask.question}` : "-"}`);
      if (i.request.trim()) console.log(`\n## Request\n\n${i.request}`);
      if (i.spec.trim()) console.log(`\n${i.spec}`);
      if (i.notes.length) console.log(`\n### Notes\n${i.notes.join("\n")}`);
      const media = store.mediaOf(i);
      if (media.length) console.log(`\n### Media\n${media.map((m) => `- ${m}`).join("\n")}`);
      return;
    }
    case "note": {
      // Chris's answer to an issue that waits for them: not a worker's note (ALEPH_JOB_ID) and not the factory's own.
      const n = verbs.note(repo, id, text, verbs.isAnswer(text, jobId()));
      warn(n.follow);
      out(n.result);
      if (n.answered) intakeDetached(repo, n.result.id);
      return;
    }
    case "attach": {
      // `aleph issue attach <repo> <n> <file>...`: images or PDFs.
      const a = verbs.attach(repo, id, args.slice(1));
      warn(a.follow);
      out(a.result);
      return;
    }
    case "decide": {
      const d = verbs.decide(repo, id, text, fields);
      warn(d.follow);
      out(d.result);
      // The note is Chris's answer: the intake that follows a note takes the issue from here.
      intakeDetached(repo, d.item.id);
      return;
    }
    case "edit": {
      const e = verbs.edit(repo, id, fields, text);
      warn(e.follow);
      out(e.result);
      dispatchAfterIssue(repo, e.item);
      return;
    }
    case "done":
    case "drop": {
      const c = verbs.close(repo, id, sub, text);
      warn(c.follow);
      out(c.result);
      // An issue that waited on this issue can start, and a dropped part can set its parent's Ask: the dispatch takes both.
      if (repo.sandbox) dispatchDetached();
      return;
    }
    case "retitle": {
      const r = await verbs.retitle(repo, fit);
      warn(r.follow);
      for (const t of r.result.retitled) console.log(`${repo.key}-${t.id}: ${t.title}`);
      return;
    }
    case "lint": {
      if (fixing) {
        const l = verbs.lintFix(repo);
        warn(l.follow);
        out(l.result);
        if (l.result.remaining.length) process.exit(1);
        return;
      }
      const l = verbs.lint(repo);
      if (!l.findings.length) { out({ repo: l.repo, items: l.items, findings: [] }); return; }
      for (const f of l.findings) console.error(`item ${f.id}: ${f.problem}${f.fixable ? " (--fix repairs this)" : ""}`);
      refuse(`${l.findings.length} problem${l.findings.length > 1 ? "s" : ""} in the ${repo.key} list`);
    }
    default: refuse("usage: aleph issue <add|list|show|note|edit|decide|done|drop|lint|retitle> <repo> ... [--kind task|bug|check|flake|proposal|acceptance]");
  }
}

/** The registry's repos with a ledger run or an item update in the last 7 days, the latest first, each with its list. */
function listRecent(): { repo: Repo; doc: issues.Doc | null }[] {
  return verbs.recentLists(Object.values(loadRegistry()));
}

/** `aleph issue list` and `aleph issue lint` with no repo: each recent repo. */
function todoRecent(sub: "list" | "lint", registry: Record<string, Repo>, o: { status?: string; label?: string; kind?: string }, json: boolean): void {
  const repos = Object.values(registry);
  if (sub === "lint") {
    const results = verbs.lintRecent(repos);
    for (const r of results) for (const f of r.findings) console.error(`${r.repo} item ${f.id}: ${f.problem}${f.fixable ? " (--fix repairs this)" : ""}`);
    out(results);
    if (results.some((r) => r.findings.length)) process.exit(1);
    return;
  }
  const rows = verbs.listRecent(repos, o).map((r) => ({ repo: r.repo.key, items: r.items }));
  if (json) { out(rows.map((r) => ({ repo: r.repo, items: r.items.map(verbs.brief(r.repo)) }))); return; }
  if (!rows.length) { console.log("no issues"); return; }
  for (const r of rows) { console.log(r.repo); printRows(r.items, r.repo, "  "); }
}

/** `aleph intake <repo>-<n>`: take in one issue now, under the dispatch's gates. */
async function intakeCmd(): Promise<void> {
  const registry = loadRegistry();
  const ref = issues.parseRef(rest[0] ?? "") ?? refuse("usage: aleph intake <repo>-<n>");
  const repo = registry[ref.repo] ?? refuse(`no repo ${ref.repo}`);
  out(await intakeNow(repo, ref.id));
}

/** `aleph dispatch`: start every ready issue up to the live cap. A run's end and `aleph issue` call it. */
async function dispatchCmd(): Promise<void> {
  out(await runDispatch());
}

/** `aleph tick`, from the timer every minute: the periodic steps that are due and the sweep (tick.ts). */
async function tickCmd(): Promise<void> {
  out(await runTick());
}

/**
 * `aleph report`: the runs not yet shown, how far each factory repo's
 * checkout is behind origin, and the health lines: the factory's alarms, then the
 * monitor's flake counts and its newest report. With --hook it prints the
 * SessionStart hook's JSON from hookLines, read-only, and nothing when there is nothing to act on.
 */
function reportCmd(): void {
  if (rest.includes("--hook")) {
    if (process.env.ALEPH_AGENT) return;
    const lines = hookLines();
    if (lines.length) out({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: lines.join("\n") } });
    return;
  }
  const lines = [report()];
  for (const repo of Object.values(loadRegistry()).filter((r) => r.sandbox)) {
    fetchOrigin(repo.path);
    lines.push(behind(repo) ?? "");
  }
  lines.push(...health().map((h) => shortText(h.text)), ...flakeLines().map(shortText));
  const m = reportLine();
  if (m) lines.push(shortText(m));
  const text = lines.filter(Boolean).join("\n\n");
  console.log(text || "nothing new");
}

/** `aleph status <repo>-<n>[.<k>]`: the item's stage, from the store and the ledger; with no issue, see statusRecent. */
function statusCmd(): void {
  if (!positional[0]) return statusRecent();
  const reg = loadRegistry();
  const p = issues.parseIssueRef(positional[0]) ?? refuse("usage: aleph status [<repo>-<n>[.<k>]] [--json]");
  const key = p.repo, itemRef = p.id, n = String(p.id);
  const repo = reg[key] ?? refuse(`no repo named ${key} in the registry`);
  let s: Stage | undefined;
  try { s = repoStages(repo, { fetch: true, items: [itemRef] })[0]; } catch (e: any) { refuse(e?.message ?? String(e)); }
  if (!s) refuse(`${key} has no issue ${n}`);
  if (rest.includes("--json")) return out(s);
  console.log(issues.localRefs(key, [s!.id, s!.stage, s!.why].filter(Boolean).join(" ")));
}

/** `aleph status` with no issue: the stage of each open issue in each recent repo. */
function statusRecent(): void {
  const states: Stage[] = [], ofRepo: { key: string; rows: Stage[] }[] = [];
  for (const { repo, doc } of listRecent()) {
    const open = (doc?.items ?? []).filter((i) => issues.status(i) === "open");
    if (!open.length) continue;
    try {
      fetchOrigin(repo.path);
      const f = facts(repo, doc);
      const main = `refs/remotes/origin/${f.main}`;
      const rows = stages(repo.path, main, f, open.map((i) => issues.refOf(i)));
      states.push(...rows);
      if (rows.length) ofRepo.push({ key: repo.key, rows });
    }
    catch (e: any) { console.error(`warn: ${repo.key}: ${e?.message ?? e}`); }
  }
  if (rest.includes("--json")) return out(states);
  if (!states.length) { console.log("no open items"); return; }
  for (const { key, rows } of ofRepo) { console.log(key); for (const s of rows) console.log(issues.localRefs(key, `  ${[s.id, s.stage, s.why].filter(Boolean).join(" ")}`)); }
}

const ready = (i: issues.Issue, key: string) => (store.afterOf(i).length ? `after ${issues.localRefs(key, store.afterOf(i).join(","))}` : "");

function printRows(rows: issues.Issue[], key: string, indent = ""): void {
  const refs = rows.map(issues.refOf);
  const w = refs.reduce((m, r) => Math.max(m, r.length), 0);
  for (const [n, i] of rows.entries()) console.log(`${indent}${refs[n].padStart(w)}  ${issues.status(i).padEnd(7)} ${store.priorityOf(i).padEnd(8)} ${i.title}${ready(i, key) ? `  (${ready(i, key)})` : ""}`);
}

const ANNOTATION_USAGE = "usage: aleph annotation <list [--all] [--url <u>] [--json] | add (--on <id> | --selector <css>) [--url <u>] <text|-> | reply <id> [--by you|agent] <text|-> | resolve <id> | reopen <id> | drop <id> | put>";

/** `aleph annotation ...`: the notes pinned on UI pages (lib/annotations.ts). `list` prints Markdown, the rest JSON; `put` reads one note as JSON on stdin. */
async function annotationCmd(): Promise<void> {
  const [verb, ...args] = positional;
  const text = async (words: string[]) => (words[0] === "-" ? await Bun.stdin.text() : words.join(" ")).trim() || refuse(ANNOTATION_USAGE);
  const by = (flag("by") ?? "agent") as notes.By;
  if (!["you", "agent"].includes(by)) refuse("--by takes you or agent");
  switch (verb) {
    case "list": {
      const url = flag("url");
      const shown = notes.read().filter((n) => (rest.includes("--all") || n.status === "open") && (!url || n.url === url || n.url === ""));
      if (rest.includes("--json")) out(shown);
      else console.log(notes.markdown(shown));
      return;
    }
    case "add": {
      const on = flag("on"), css = flag("selector");
      if (Boolean(on) === Boolean(css)) refuse(ANNOTATION_USAGE);
      out(notes.add(on ? notes.anchor(on) : css!, await text(args), { url: flag("url") ?? "", by }));
      return;
    }
    case "reply": out(notes.reply(args[0] ?? refuse(ANNOTATION_USAGE), await text(args.slice(1)), by)); return;
    case "resolve": out(notes.mark(args[0] ?? refuse(ANNOTATION_USAGE), "resolved")); return;
    case "reopen": out(notes.mark(args[0] ?? refuse(ANNOTATION_USAGE), "open")); return;
    case "drop": out(notes.drop(args[0] ?? refuse(ANNOTATION_USAGE))); return;
    case "put": {
      let raw: unknown;
      try { raw = JSON.parse(await Bun.stdin.text()); } catch { refuse("put reads one annotation as JSON on stdin"); }
      out(notes.put(raw));
      return;
    }
    default: refuse(ANNOTATION_USAGE);
  }
}

/** `aleph doctor [--fix] [--json]`: pass or fail for each part of the machine; exit 1 if any fails. */
async function doctorCmd(): Promise<void> {
  const checks = await doctor.doctor();
  const fixed = rest.includes("--fix") ? doctor.fix() : [];
  if (rest.includes("--json")) out({ checks, fixed });
  else {
    for (const c of checks) console.log(`${c.ok ? "PASS" : "FAIL"} ${c.name}: ${c.detail}`);
    for (const f of fixed) console.log(`FIX ${f}`);
  }
  if (checks.some((c) => !c.ok)) process.exit(1);
}

try {
  switch (cmd) {
    case "doctor": await doctorCmd(); break;
    case "doc-claims": {
      // Each doc claim of this repo the code does not back, read now: run it after the last edit of a doc.
      const r = (await import("./lib/gates/doc-claims-repo.ts")).docClaimsReport();
      console.log(r.text);
      if (!r.ok) process.exit(1);
      break;
    }
    case "job": await job(); break;
    case "run": await plain(); break;
    case "jobs": jobs(); break;
    case "recheck": await started(await recheck(positional[0], { command })); break;
    case "drop": {
      const quiet = rest.includes("--quiet");
      const given = flag("fate");
      if (rest.includes("--fate") && !FATES.includes(given as Fate)) refuse(`--fate takes one of ${FATES.join(", ")}`);
      const fate = (given as Fate | undefined) ?? (quiet ? undefined : "manual");
      out(await drop(positional[0], { reason: positional.slice(1).join(" "), quiet, fate }));
      break;
    }
    case "unit": await unit(resolve(positional[0])); break;
    case "land": await started(await land(positional[0], { checked: rest.includes("--checked") }, { command })); break;
    case "checked": out(checked(positional[0])); break;
    case "issue": await todoCmd(); break;
    case "annotation": await annotationCmd(); break;
    case "tick": await tickCmd(); break;
    case "director": out(await directorStep()); break;
    case "suite": out(await suiteStep()); break;
    case "monitor": {
      // `aleph monitor [--dry] [--day YYYY-MM-DD]`: the table of the day (yesterday by default) and its reading. --dry prints the table and writes nothing.
      const day = flag("day") ?? addDays(issues.today(), -1);
      if (!/^\d{4}-\d\d-\d\d$/.test(day)) refuse("usage: aleph monitor [--dry] [--day YYYY-MM-DD]");
      if (rest.includes("--dry")) { process.stdout.write(renderTable(tableOf(day))); break; }
      const r = await runMonitor(day) ?? refuse("another monitor job holds the lock");
      out({ day: r.day, findings: r.findings, ...(r.error ? { error: r.error } : {}), run: r.run, note: r.note ?? r.noteError });
      break;
    }
    case "dispatch": await dispatchCmd(); break;
    case "intake": await intakeCmd(); break;
    case "status": statusCmd(); break;
    case "report": reportCmd(); break;
    case "pause": setPaused(true); out({ paused: true }); break;
    case "resume": setPaused(false); out({ paused: false }); dispatchDetached(); break;
    case "always": {
      const [sub, reason, action] = positional;
      const rules = readAlways;
      if (sub === "list" || sub === undefined) out(rules());
      else if (sub === "grant") { const bad = grant(reason ?? refuse("usage: aleph always grant <reason> <action>"), action ?? refuse("usage: aleph always grant <reason> <action>")); if (bad) refuse(bad); out(rules()); }
      else if (sub === "revoke") { revoke(reason ?? refuse("usage: aleph always revoke <reason>")); out(rules()); }
      else refuse("usage: aleph always <list|grant <reason> <action>|revoke <reason>>");
      break;
    }
    case "models": {
      const change = positional[0] === "set" ? { model: positional[2] ?? "" } : positional[0] === "enable" || positional[0] === "disable" ? { enabled: positional[0] === "enable" } : undefined;
      if (change) { const bad = setModel(positional[1] ?? "", change); if (bad) refuse(bad); }
      else if (positional[0] !== undefined) refuse("usage: aleph models [set <tier> <model> | enable <tier> | disable <tier>]");
      out(readModels());
      break;
    }
    case "judge": {
      const v = positional[0];
      if (v === "jev" || v === "haiku") setJudgeChoice(v);
      else if (v !== undefined) refuse("usage: aleph judge [jev|haiku]");
      out({ judge: judgeChoice() });
      break;
    }
    default: refuse("usage: aleph <job|run|land|checked|recheck|drop|jobs|issue|annotation|tick|suite|report|pause|resume|status|judge|models|dispatch|doctor|doc-claims|monitor> ...");
  }
} catch (e) {
  if (!(e instanceof Refusal)) throw e;
  console.error(e.message);
  process.exit(1);
}
