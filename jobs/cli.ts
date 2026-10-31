#!/usr/bin/env bun
/**
 * aleph <migrate|job|run|land|checked|recheck|drop|jobs|issue|unit|tick|report|pause|resume|sandbox|status|judge>
 * — detached agent jobs, plain runs, each repo's issues, and the factory.
 * Ledger: $ALEPH_JOBS_DIR or ~/.aleph/jobs. Registry: $ALEPH_REPOS or
 * ~/.aleph/repos.json. JSON on stdout, findings on stderr, exit 1 on refusal, and the foreground unit's exit code when it fails.
 * See docs/specs/2026-09-24-agent-jobs.md.
 */
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { allRuns, isLive, loadRegistry, newsLine, updateRun, type Entry, type Repo } from "./lib/ledger.ts";
import { allJobs, findJob, goal, isOpen, issue as issueOf, lastReal, readFile, view, type Job } from "./lib/job.ts";
import { git, onMain, removeBranch, reviewBack, unit } from "./lib/unit.ts";
import { fetchOrigin } from "./lib/git.ts";
import { judgeChoice, setJudgeChoice } from "../hooks/lib/jev.ts";
import * as issues from "../todo/lib/todo.ts";
import * as store from "../todo/lib/store.ts";
import * as verbs from "../todo/lib/issues.ts";
import { grant, readAlways, revoke } from "./lib/always.ts";
import { ciStep } from "./lib/ci.ts";
import { behind, correctionsStep, dispatchDetached, factoryDir, factoryLog, factoryRepos, firefighterStep, health, hold, paused, planNow, probeDue, report, setPaused, triageDetached, triageNow, triageStep, episodeStep, reacceptReopened } from "./lib/factory.ts";
import { checkName, checked, drop, land, recheck, refuse, Refusal, repoOf, runDispatch, startJob, startPlain, type Start } from "./lib/transitions.ts";
import { probe } from "./lib/probe.ts";
import * as doctor from "./lib/doctor.ts";
import { sweep } from "./lib/deps.ts";
import { recordReview, runReview } from "./lib/review.ts";
import * as migrate from "./lib/migrate.ts";
import { facts, FACTS_REF, readFacts, repoStages, stages } from "./lib/status.ts";
import type { Stage } from "./lib/stage.ts";

const DAY_MS = 24 * 3600_000;

const out = (value: unknown) => console.log(JSON.stringify(value, null, 2));

const [cmd, ...rest] = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
}
// A flag's value is not a positional. Every flag here takes one, so leaving a
// name off this list silently folds its value into the next argument: `todo add
// <repo> "<title>" --labels jobs` put "jobs" on the end of the title.
const VALUED = ["--spec", "--model", "--todo", "--on", "--priority", "--labels", "--goal", "--status", "--label", "--body", "--title", "--due", "--after", "--reopened-since", "--before", "--undo"];
const positional = rest.filter((a, i) => !a.startsWith("--") && !VALUED.includes(rest[i - 1]));
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
  if (rest.includes("--todo")) refuse("--todo is gone: use --on <n>|<n>.<k>|<repo>-<n>[.<k>]");
  const onArg = flag("on");
  await started(await startJob({ repo, name, spec, on: onArg, model: flag("model"), land: rest.includes("--land") }, { command }));
}

async function plain(): Promise<void> {
  const dash = rest.indexOf("--");
  await started(await startPlain({ name: rest[0], argv: dash >= 0 ? rest.slice(dash + 1) : [], cwd: process.cwd() }, { command }));
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
    const found = onMain(repo, last.run);
    if (found) {
      updateRun(last.folder, { state: "landed", commit: found.commit, reason: `found on main (${found.how})`, ask: undefined, told: true });
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
    name: v.name, repo: v.repo, kind: v.run.kind, job: v.job, run: v.run.id, goal: goal(runs), state: v.state, needs: v.needs, phase: v.phase,
    reason: v.reason, say: v.say, review: v.review, ...(v.check ? { check: v.check } : {}), fate: fates.get(v.job), session: v.session, started: v.started, ended: v.ended,
    ...(v.lost ? { lost: true } : {}),
  };
}

function jobs(): void {
  if (rest.includes("--news")) {
    const news: { run: string; line: string }[] = [];
    for (const e of allRuns()) {
      if (e.run.state === "running" || e.run.told) continue;
      news.push({ run: e.id, line: newsLine(e.run, e.run.repo ? loadRegistry()[e.run.repo]?.note : undefined) });
      updateRun(e.folder, { told: true });
    }
    return out(news);
  }
  const fates = reconcile(allJobs());
  const all = allJobs();
  const name = positional[0];
  // A job that landed with its check open stays in the list until `aleph checked`.
  // A job that ended in the last 24 hours follows the open ones, the latest first.
  if (!name) {
    const listed = (j: Entry[]) => isOpen(j) || (lastReal(j).run.state === "landed" && lastReal(j).run.check === "open");
    const ended = (j: Entry[]) => Date.parse(lastReal(j).run.ended ?? "");
    const recent = all.filter((j) => !listed(j) && Date.now() - ended(j) < DAY_MS).sort((a, b) => ended(b) - ended(a));
    return out([...all.filter(listed), ...recent].map((j) => summary(j, fates)));
  }
  const runs = findJob(name, null, all);
  if (!runs) refuse(`no job named ${name}`);
  const last = lastReal(runs!);
  const checks = readFile(last, "checks.log");
  out({
    ...summary(runs!, fates), question: last.run.question, result: readFile(last, "result.md"),
    checks: checks?.trimEnd().split("\n").slice(-40).join("\n"), land: readFile(last, "land.log"),
  });
}

/** After `aleph issue add` or `edit` of an open goal in a factory repo: a dispatch, so the goal starts at once. It never fails the write. */
function dispatchAfterGoal(repo: Repo, item: issues.Issue): void {
  if (!repo.sandbox || !store.isGoal(item)) return;
  dispatchDetached();
}

/**
 * aleph issue <add|list|show|note|done|drop|lint> <repo> ... — every repo in the
 * registry has a list in the work store. The verbs are todo/lib/issues.ts; this
 * parses argv, prints, and starts the dispatch or triage a write calls for.
 */
async function todoCmd(): Promise<void> {
  const [verb, repoKey, ...args] = positional;
  const json = rest.includes("--json");
  const fixing = rest.includes("--fix");
  const stat = flag("status");
  const label = flag("label");
  // `--body -` reads the body from stdin: it is prose of several lines.
  const bodyArg = flag("body");
  const labelsArg = flag("labels");
  if (rest.includes("--waiting-on")) refuse("--waiting-on is gone: a goal waits with --after <goal id>");
  // `--goal -` reads the goal-format text from stdin and files it as goal `.1`.
  const goalArg = flag("goal");
  if (rest.includes("--goal") && goalArg !== "-") refuse("--goal takes - (the goal text on stdin)");
  const afterArg = flag("after");
  const fields: verbs.Fields = {
    title: flag("title"),
    body: bodyArg === undefined ? undefined : (bodyArg === "-" ? await Bun.stdin.text() : bodyArg).trim(),
    priority: flag("priority"),
    labels: labelsArg === undefined ? undefined : labelsArg.split(",").map((s) => s.trim()).filter(Boolean),
    due: flag("due"),
    status: stat,
    ...(goalArg === "-" ? { goal: await Bun.stdin.text() } : {}),
    ...(afterArg === undefined ? {} : { after: afterArg.split(",").map((s) => s.trim()).filter(Boolean) }),
  };
  const sub = verb ?? refuse("usage: aleph issue <add|list|show|note|edit|decide|done|drop|lint> <repo> ...");
  const registry = loadRegistry();
  if (!repoKey && (sub === "list" || sub === "lint")) return todoRecent(sub, registry, { status: stat, label }, json);
  const repo = registry[repoKey ?? ""] ?? refuse(repoKey ? `no repo named ${repoKey}` : "name a repo");
  verbs.checkFields(fields);
  const id = /^\d+\.\d+$/.test(args[0] ?? "") ? args[0] : Number(args[0]);
  const text = args.slice(1).join(" ").trim();
  const warn = (follow: string | null | undefined) => { if (follow) console.error(`warn: ${follow}`); };

  switch (sub) {
    case "add": {
      const a = await verbs.add(repo, args.join(" "), fields);
      warn(a.follow);
      for (const m of a.result.maybeSame ?? []) console.error(`aleph-${m.id} may be the same task: ${m.title}`);
      out(a.result);
      if (a.goal) dispatchAfterGoal(repo, a.goal);
      if (!store.isSorted(a.item)) triageDetached(repo, a.item.id);
      return;
    }
    case "list": {
      const rows = verbs.list(repo, { status: stat, label });
      if (json) { out(rows.map(verbs.brief)); return; }
      if (!rows.length) { console.log("no issues"); return; }
      printRows(rows);
      return;
    }
    case "show": {
      const { item: i, hidden } = verbs.show(repo, id);
      if (json) { out({ ...verbs.brief(i), body: i.body, notes: i.notes, hidden }); return; }
      console.log(`## ${i.id}. ${i.title}`);
      const ask = store.askOf(i);
      console.log(`status ${issues.status(i)}   kind ${store.kindOf(i)}   source ${store.sourceOf(i)}   priority ${i.fm.priority ?? "-"}   updated ${i.fm.updated ?? "-"}`);
      console.log(`goals ${store.goalsOf(i).join(", ") || "-"}   after ${store.afterOf(i).join(", ") || "-"}   areas ${store.areasOf(i).join(", ") || "-"}   due ${i.fm.due ?? "-"}`);
      console.log(`ask ${ask ? `${ask.kind} (${ask.reason}): ${ask.question}` : "-"}`);
      console.log(`hidden checks: ${hidden}`);
      if (i.body.trim()) console.log(`\n${i.body}`);
      if (i.notes.length) console.log(`\n### Notes\n${i.notes.join("\n")}`);
      return;
    }
    case "note": {
      // Chris's answer to an issue that waits for them: not a worker's note (ALEPH_JOB_ID) and not the factory's own.
      const n = verbs.note(repo, id, text, verbs.isAnswer(text, process.env.ALEPH_JOB_ID));
      warn(n.follow);
      out(n.result);
      if (n.answered) triageDetached(repo, n.result.id);
      return;
    }
    case "decide": {
      const d = verbs.decide(repo, id, text, fields);
      warn(d.follow);
      out(d.result);
      // The note is Chris's answer: the triage that follows a note takes the issue from here.
      triageDetached(repo, d.item.id);
      return;
    }
    case "edit": {
      const e = verbs.edit(repo, id, fields);
      warn(e.follow);
      out(e.result);
      dispatchAfterGoal(repo, e.item);
      return;
    }
    case "done":
    case "drop": {
      const c = verbs.close(repo, id, sub, text);
      warn(c.follow);
      out(c.result);
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
    default: refuse("usage: aleph issue <add|list|show|note|edit|decide|done|drop|lint> <repo> ...");
  }
}

/**
 * aleph goal <list|show|note|edit|drop|hidden> <repo> <n>.<k> ... — the verbs on a repo's goals (`kindOf` goal), over todo/lib/issues.ts.
 * A goal's id is `<n>.<k>`, or `<m>` for an old child goal that keeps its plain number.
 */
async function goalCmd(): Promise<void> {
  const usage = "usage: aleph goal <list|show|note|edit|drop|hidden> <repo> <n>.<k> ...";
  const [verb, repoKey, id, ...args] = positional;
  const json = rest.includes("--json");
  const registry = loadRegistry();
  const repo = registry[repoKey ?? ""] ?? refuse(repoKey ? `no repo named ${repoKey}` : "name a repo");
  const warn = (follow: string | null | undefined) => { if (follow) console.error(`warn: ${follow}`); };
  const text = args.join(" ").trim();
  switch (verb) {
    case "list": {
      const rows = verbs.goalList(repo, { status: flag("status") });
      if (json) { out(rows.map(verbs.brief)); return; }
      if (!rows.length) { console.log("no goals"); return; }
      for (const g of rows) console.log(`${repo.key}-${issues.refOf(g)}  ${issues.status(g).padEnd(7)} ${g.title}${store.afterOf(g).length ? `  (after ${store.afterOf(g).join(",")})` : ""}`);
      return;
    }
    case "show": {
      const { item: g, hidden } = verbs.goalShow(repo, verbs.goalId(id));
      if (json) { out({ ...verbs.brief(g), body: g.body, notes: g.notes, hidden }); return; }
      console.log(`## ${repo.key}-${issues.refOf(g)}. ${g.title}`);
      console.log(`status ${issues.status(g)}   issue ${store.issueOf(g) ?? "-"}   after ${store.afterOf(g).join(", ") || "-"}   priority ${g.fm.priority ?? "-"}`);
      console.log(`hidden checks: ${hidden}`);
      if (g.body.trim()) console.log(`\n${g.body}`);
      if (g.notes.length) console.log(`\n### Notes\n${g.notes.join("\n")}`);
      return;
    }
    case "note": {
      const n = verbs.goalNote(repo, verbs.goalId(id), text);
      warn(n.follow);
      out(n.result);
      return;
    }
    case "edit": {
      const bodyArg = flag("body");
      const afterArg = flag("after");
      const e = verbs.goalEdit(repo, verbs.goalId(id), {
        title: flag("title"),
        body: bodyArg === undefined ? undefined : (bodyArg === "-" ? await Bun.stdin.text() : bodyArg).trim(),
        priority: flag("priority"),
        after: afterArg === undefined ? undefined : afterArg.split(",").map((s) => s.trim()).filter(Boolean),
      });
      warn(e.follow);
      out(e.result);
      dispatchAfterGoal(repo, e.item);
      return;
    }
    case "drop": {
      const c = verbs.close(repo, verbs.goalId(id), "drop", text);
      warn(c.follow);
      out(c.result);
      return;
    }
    case "hidden": {
      verbs.goalId(id);
      if (!args.length) {
        const have = verbs.goalHiddenList(repo, id);
        if (json) { out(have); return; }
        if (!have.length) console.log("no hidden checks");
        for (const n of have) console.log(n);
        return;
      }
      const files: Record<string, string> = {};
      for (const p of args) {
        if (!existsSync(p) || !statSync(p).isFile()) refuse(`${p} is not a file`);
        files[basename(p)] = readFileSync(p, "utf8");
      }
      const h = verbs.goalHiddenAdd(repo, id, files);
      warn(h.follow);
      out(h.result);
      return;
    }
    default: refuse(usage);
  }
}

const ready = (i: issues.Issue) => [i.fm.due ? `due ${i.fm.due}` : "", store.afterOf(i).length ? `after ${store.afterOf(i).join(",")}` : ""].filter(Boolean).join("  ");

function printRows(rows: issues.Issue[], indent = ""): void {
  const w = String(Math.max(...rows.map((i) => i.id))).length;
  for (const i of rows) console.log(`${indent}${String(i.id).padStart(w)}  ${issues.status(i).padEnd(7)} ${i.title}${ready(i) ? `  (${ready(i)})` : ""}`);
}

/** The registry's repos with a ledger run or an item update in the last 7 days, the latest first, each with its list. */
function listRecent(): { repo: Repo; doc: issues.Doc | null }[] {
  return verbs.recentLists(Object.values(loadRegistry()));
}

/** `aleph issue list` and `aleph issue lint` with no repo: each recent repo. */
function todoRecent(sub: "list" | "lint", registry: Record<string, Repo>, o: { status?: string; label?: string }, json: boolean): void {
  const repos = Object.values(registry);
  if (sub === "lint") {
    const results = verbs.lintRecent(repos);
    for (const r of results) for (const f of r.findings) console.error(`${r.repo} item ${f.id}: ${f.problem}${f.fixable ? " (--fix repairs this)" : ""}`);
    out(results);
    if (results.some((r) => r.findings.length)) process.exit(1);
    return;
  }
  const rows = verbs.listRecent(repos, o).map((r) => ({ repo: r.repo.key, items: r.items }));
  if (json) { out(rows.map((r) => ({ repo: r.repo, items: r.items.map(verbs.brief) }))); return; }
  if (!rows.length) { console.log("no issues"); return; }
  for (const r of rows) { console.log(r.repo); printRows(r.items, "  "); }
}

/** `aleph triage <repo>-<n>`: triage one issue now, under the dispatch's gates. */
async function triageCmd(): Promise<void> {
  const ref = issues.parseRef(rest[0] ?? "") ?? refuse("usage: aleph triage <repo>-<n>");
  const repo = loadRegistry()[ref.repo] ?? refuse(`no repo ${ref.repo}`);
  out(await triageNow(repo, ref.id));
}

/** `aleph plan <repo>-<n>`: plan one issue now, under the dispatch's gates. */
async function planCmd(): Promise<void> {
  const ref = issues.parseRef(rest[0] ?? "") ?? refuse("usage: aleph plan <repo>-<n> (an issue)");
  const repo = loadRegistry()[ref.repo] ?? refuse(`no repo ${ref.repo}`);
  out(await planNow(repo, ref.id));
}

/** `aleph dispatch`: start every ready goal up to the live cap. A run's end and `aleph issue` call it. */
async function dispatchCmd(): Promise<void> {
  out(await runDispatch());
}

/**
 * `aleph tick`, from the timer: the nightly probe when due, and the dependency sweep only after a
 * passing probe, then a dispatch as the fallback for what no run's end and no issue write has
 * started. A failed probe starts no run and no sweep.
 */
async function tickCmd(): Promise<void> {
  if (!paused() && probeDue()) {
    const repo = Object.values(loadRegistry()).find((r) => r.sandbox);
    if (repo) {
      mkdirSync(factoryDir(), { recursive: true });
      const p = await probe(repo, join(factoryDir(), "probe.log"));
      factoryLog(`probe ${p.ok ? "passed" : `failed: ${p.failed.join("; ")}`}`);
      if (p.ok) {
        const proposed = await sweep(Object.values(loadRegistry()).filter((r) => r.sandbox), factoryLog);
        if (proposed.length) factoryLog(`proposed ${proposed.join("; ")}`);
      }
    }
  }
  await correctionsStep();
  const d = await runDispatch();
  const t = !d.held ? await triageStep() : { triaged: {}, skipped: [] };
  const episodes = await episodeStep();
  try { ciStep(factoryRepos()); } catch (e: any) { factoryLog(`ci: failed: ${e?.message ?? e}`); }
  const f = await firefighterStep();
  out({ ...d, skipped: [...d.skipped, ...t.skipped], triaged: t.triaged, episodes, ...(f?.run ? { firefighter: f } : {}) });
}

/**
 * `aleph report`: the runs not yet shown, how far each factory repo's
 * checkout is behind origin, and the health line. With --hook it prints the
 * SessionStart hook's JSON, and nothing when there is nothing to say.
 */
function reportCmd(): void {
  const lines = [report()];
  for (const repo of Object.values(loadRegistry()).filter((r) => r.sandbox)) {
    fetchOrigin(repo.path);
    lines.push(behind(repo) ?? "");
  }
  const h = hold();
  if (h) lines.push(h.line);
  lines.push(...health());
  const text = lines.filter(Boolean).join("\n\n");
  if (!rest.includes("--hook")) { console.log(text || "nothing new"); return; }
  if (!text) return;
  const msg = `aleph report\n\n${text}`;
  out({ systemMessage: msg, hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: msg } });
}

/**
 * `aleph status <repo>-<n>[.<k>]`: the item's stage; with no issue, see statusRecent. In Chris's session the
 * facts come from the store and the ledger; in a sandbox, where neither is,
 * they come from the bundle's snapshot at refs/aleph/facts in the current repo.
 */
function statusCmd(): void {
  if (!positional[0]) return statusRecent();
  const m = (positional[0] ?? "").match(/^(.+)-(\d+(?:\.\d+)?)$/) ?? refuse("usage: aleph status [<repo>-<n>[.<k>]] [--json]");
  const [, key, n] = m!;
  const itemRef: number | string = n.includes(".") ? n : Number(n);
  const repo = loadRegistry()[key];
  let s: Stage | undefined;
  if (repo) {
    try { s = repoStages(repo, { fetch: true, items: [itemRef] })[0]; } catch (e: any) { refuse(e?.message ?? String(e)); }
  } else {
    const cwd = process.cwd();
    const snap = readFacts(cwd);
    if (!snap || snap.repo !== key) refuse(`no repo named ${key} in the registry, and no ${FACTS_REF} for it here`);
    s = stages(cwd, `refs/remotes/origin/${snap!.main}`, snap!, [itemRef])[0];
  }
  if (!s) refuse(`${key} has no issue ${n}`);
  if (rest.includes("--json")) return out(s);
  console.log(`${s!.id} ${s!.stage}: ${s!.why}`);
}

/** `aleph status` with no issue: the stage of each open issue in each recent repo. */
function statusRecent(): void {
  const states: Stage[] = [];
  for (const { repo, doc } of listRecent()) {
    const open = (doc?.items ?? []).filter((i) => issues.status(i) === "open");
    if (!open.length) continue;
    try {
      fetchOrigin(repo.path);
      const f = facts(repo, doc);
      const main = `refs/remotes/origin/${f.main}`;
      states.push(...stages(repo.path, main, f, open.map((i) => issues.refOf(i))));
    }
    catch (e: any) { console.error(`warn: ${repo.key}: ${e?.message ?? e}`); }
  }
  if (rest.includes("--json")) return out(states);
  if (!states.length) { console.log("no open items"); return; }
  for (const s of states) console.log(`${s.id} ${s.stage}: ${s.why}`);
}

/** `aleph migrate --dry-run | --apply | --undo <time>`: the work-model migration, see jobs/lib/migrate.ts. */
function migrateCmd(): void {
  const usage = "usage: aleph migrate --dry-run | --apply | --undo <time> [--discard-later]";
  const undoing = flag("undo");
  const modes = [rest.includes("--dry-run"), rest.includes("--apply"), undoing !== undefined].filter(Boolean).length;
  if (modes !== 1) refuse(usage);
  try {
    if (undoing !== undefined) return out(migrate.undo(undoing, undefined, rest.includes("--discard-later")));
    if (rest.includes("--apply")) return out(migrate.apply());
    const d = migrate.dryRun();
    for (const row of d.rows) console.log(`${row.id}\t${row.old}\t${row.stage}${row.ok ? "" : "\tOUTSIDE THE MAPPING TABLE"}`);
    for (const m of d.moves) console.log(`move\t${m.from}\t${m.to}`);
    out({ items: d.rows.length, counts: d.counts, moves: d.moves, violations: d.violations });
    if (d.violations.length) refuse(`${d.violations.length} pair(s) outside the mapping table`);
  } catch (e) {
    if (e instanceof migrate.MigrateRefusal) refuse(e.message);
    throw e;
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
    case "migrate": migrateCmd(); break;
    case "job": await job(); break;
    case "run": await plain(); break;
    case "jobs": jobs(); break;
    case "recheck": await started(await recheck(positional[0], { command })); break;
    case "review": {
      const folder = resolve(positional[0] ?? refuse("usage: aleph review <run-folder>"));
      try { await runReview(folder); } catch (e: any) { refuse(e.message); }
      recordReview(folder);
      await reviewBack(folder);
      break;
    }
    case "drop": out(await drop(positional[0], { reason: positional.slice(1).join(" "), quiet: rest.includes("--quiet") })); break;
    case "unit": await unit(resolve(positional[0])); break;
    case "land": await started(await land(positional[0], { checked: rest.includes("--checked") }, { command })); break;
    case "checked": out(checked(positional[0])); break;
    case "issue": await todoCmd(); break;
    case "goal": await goalCmd(); break;
    case "accept": {
      const lines = await reacceptReopened(positional[0] ?? refuse("usage: aleph accept <repo> [--reopened-since <iso>] [--before <iso>]"), { since: flag("reopened-since"), before: flag("before") });
      console.log(lines.join("\n") || "nothing to re-accept");
      break;
    }
    case "tick": await tickCmd(); break;
    case "dispatch": await dispatchCmd(); break;
    case "triage": await triageCmd(); break;
    case "plan": await planCmd(); break;
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
    case "judge": {
      const v = positional[0];
      if (v === "jev" || v === "haiku") setJudgeChoice(v);
      else if (v !== undefined) refuse("usage: aleph judge [jev|haiku]");
      out({ judge: judgeChoice() });
      break;
    }
    case "sandbox": {
      if (positional[0] !== "probe") refuse("usage: aleph sandbox probe");
      const repo = Object.values(loadRegistry()).find((r) => r.sandbox) ?? refuse("no repo in the registry has sandbox: true");
      mkdirSync(factoryDir(), { recursive: true });
      const p = await probe(repo, join(factoryDir(), "probe.log"));
      out(p);
      if (!p.ok) process.exit(1);
      break;
    }
    default: refuse("usage: aleph <job|run|land|checked|recheck|drop|jobs|issue|tick|report|pause|resume|sandbox|status|judge|dispatch|doctor> ...");
  }
} catch (e) {
  if (!(e instanceof Refusal)) throw e;
  console.error(e.message);
  process.exit(1);
}
