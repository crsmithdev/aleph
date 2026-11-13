/**
 * aleph <job|run|land|checked|recheck|drop|jobs|issue|idea|annotation|unit|tick|suite|report|pause|resume|status|judge>
 * — detached agent jobs, plain runs, each repo's issues, and the factory.
 * Ledger: $ALEPH_JOBS_DIR or ~/.aleph/runs. Registry: $ALEPH_REPOS or
 * ~/.aleph/repos.json. JSON on stdout, findings on stderr, exit 1 on refusal, and the foreground unit's exit code when it fails.
 * `run` takes the argv and gives what it printed and its exit code: jobs/cli.ts calls it for the
 * command line, and a test calls it in its own process.
 * See docs/workflow.md and docs/factory.md.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { allRuns, loadRegistry, newsLine, type Entry, type Repo } from "./lib/records/ledger.ts";
import { isLive } from "./lib/infra/process.ts";
import { allJobs, findJob, isOpen, issue as issueOf, issueTitle, openJobOfIssue, readFile, view, type Job } from "./lib/records/job.ts";
import { counting, patchRun } from "./lib/records/record.ts";
import { unit } from "./lib/roles/unit.ts";
import { onMain } from "./lib/records/status.ts";
import { settleOnMain } from "./lib/land/landing.ts";
import { fetchOrigin, git } from "./lib/infra/git.ts";
import { judgeChoice, setJudgeChoice } from "../lib/jev.ts";
import * as issues from "../issues/lib/todo.ts";
import * as store from "../issues/lib/store.ts";
import * as verbs from "../issues/lib/issues.ts";
import * as notes from "../lib/annotations.ts";
import * as ideas from "../ideas/ideas.ts";
import { askOf, refIn, grant, readAlways, revoke } from "./lib/asks/ask.ts";
import { readTimeouts, setTimeoutOf } from "./lib/asks/timeout.ts";
import { behind, directorStep, hookLines, report, runDispatch, setPaused, suiteStep, intakeNow } from "./lib/transitions/factory.ts";
import { dispatchAfterIssue, filing } from "./lib/transitions/filing.ts";
import { maintainAll, runTick } from "./lib/transitions/tick.ts";
import { vaultDir } from "../lib/paths.ts";
import { dispatchDetached, intakeDetached } from "./lib/transitions/launch.ts";
import { health } from "./lib/gates/factory-status.ts";
import { addDays, flakeLines, renderTable, reportLine } from "./lib/learning/monitor-table.ts";
import { runMonitor, tableOf } from "./lib/roles/monitor.ts";
import { housekeep } from "./lib/roles/housekeeper.ts";
import { cutTitle, fit } from "./lib/roles/title.ts";
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

// A flag's value is not a positional. Every flag here takes one, so leaving a
// name off this list silently folds its value into the next argument: `todo add
// <repo> "<title>" --labels jobs` put "jobs" on the end of the title.
const VALUED = ["--media", "--source", "--spec", "--request", "--model", "--on", "--priority", "--labels", "--status", "--label", "--kind", "--title", "--after", "--reopened-since", "--before", "--undo", "--fate", "--day", "--url", "--selector", "--by", "--target", "--sketch", "--writeup"];
const FATES: Fate[] = ["duplicate", "met", "manual"];

/** One row per command of route(): its usage line and its purpose. `help`, `--help`, and each usage refusal read this table. */
const COMMANDS: Record<string, { usage: string; purpose: string }> = {
  job: { usage: "aleph job <repo> <name> --spec <file|-> [--on <ref>] [--model <m>] [--land]", purpose: "start a worker job on a branch of the repo" },
  run: { usage: "aleph run <name> [-- <command...>]", purpose: "run a command as a tracked plain job" },
  jobs: { usage: "aleph jobs [<name>]", purpose: "list the open and recent jobs, or show one" },
  recheck: { usage: "aleph recheck <name>", purpose: "run the checks of a job again" },
  drop: { usage: "aleph drop <name> [<reason>] [--quiet] [--fate duplicate|met|manual]", purpose: "drop a job and its worktree" },
  unit: { usage: "aleph unit <run-dir>", purpose: "run a started job's unit in the foreground" },
  land: { usage: "aleph land <name> [--checked]", purpose: "land a job's branch on main" },
  checked: { usage: "aleph checked <name>", purpose: "mark a landed job's check as done" },
  issue: { usage: `aleph issue <add|list|show|note|attach|edit|decide|done|drop|lint|retitle> <repo> ... [--kind ${issues.KINDS.join("|")}]`, purpose: "read and write a repo's issues" },
  idea: { usage: "aleph idea <add|list|show|edit|note|save|lens|built|drop> ...", purpose: "keep and develop ideas" },
  annotation: { usage: "aleph annotation <list [--all] [--url <u>] [--json] | add (--on <id> | --selector <css>) [--url <u>] <text|-> | reply <id> [--by you|agent] <text|-> | resolve <id> | reopen <id> | drop <id> | put>", purpose: "read and write notes on UI pages" },
  tick: { usage: "aleph tick", purpose: "run the periodic steps that are due and the sweep" },
  director: { usage: "aleph director", purpose: "run one director step" },
  housekeep: { usage: "aleph housekeep", purpose: "review the parked issues a land touched, or every parked issue once a day" },
  suite: { usage: "aleph suite", purpose: "run one suite step" },
  monitor: { usage: "aleph monitor [--dry] [--day YYYY-MM-DD]", purpose: "write the monitor's table and reading of a day" },
  dispatch: { usage: "aleph dispatch", purpose: "start every ready issue up to the live cap" },
  intake: { usage: "aleph intake <repo>-<n>", purpose: "run intake on an issue" },
  status: { usage: "aleph status [<repo>-<n>[.<k>]] [--json]", purpose: "show the stage of an issue, or the recent ones" },
  report: { usage: "aleph report [--hook|--peek]", purpose: "show the runs not yet seen and the factory's health; --peek leaves the runs unseen" },
  pause: { usage: "aleph pause", purpose: "stop the factory from starting work" },
  resume: { usage: "aleph resume", purpose: "let the factory start work again" },
  always: { usage: "aleph always <list|grant <reason> <action>|revoke <reason>|timeout [<reason> <minutes> [pick|drop]]>", purpose: "list and change the standing permissions" },
  models: { usage: "aleph models [set <tier> <model> | enable <tier> | disable <tier>]", purpose: "list and change the model of each tier" },
  judge: { usage: "aleph judge [jev|haiku]", purpose: "show or set the judge" },
  doctor: { usage: "aleph doctor [--fix] [--json]", purpose: "check the setup and fix what it can" },
  memory: { usage: "aleph memory <init|write|adopt|recall|lint|archive|delete|compile|misses|maintain> ...", purpose: "run a vault op" },
  "doc-claims": { usage: "aleph doc-claims", purpose: "list each doc claim the code does not back" },
  help: { usage: "aleph help [--brief]", purpose: "list each command with its usage and purpose" },
};
const usage = (cmd: string) => `usage: ${COMMANDS[cmd].usage}`;

/** Where a call of `aleph` writes and reads. `stdout` gets each write as it happens; `run` also returns them all as `out`. */
export interface Io { stdout?: (s: string) => void; stderr?: (s: string) => void; stdin?: () => Promise<string> }

/** One call's argv, parsed, with its output and its exit code. */
interface Ctx {
  rest: string[];
  tail: string[];
  positional: string[];
  /** What a start is written down as in its run's `command.txt`: the argv as typed. */
  command: string[];
  flag: (name: string) => string | undefined;
  write: (s: string) => void;
  log: (s: string) => void;
  out: (value: unknown) => void;
  err: (s: string) => void;
  stdin: () => Promise<string>;
  code: number;
}

/** Run `aleph <argv>` in this process: what it printed on stdout, and its exit code (1 on a refusal, whose message goes to stderr). */
export async function run(argv: string[], io: Io = {}): Promise<{ out: string; code: number }> {
  const [cmd, ...args] = argv;
  // Everything after `--` is positional, so a name or a text that the UI passes is never read as a flag.
  const dash = args.indexOf("--");
  const rest = dash < 0 ? args : args.slice(0, dash);
  const tail = dash < 0 ? [] : args.slice(dash + 1);
  let text = "";
  const write = (s: string) => { text += s; io.stdout?.(s); };
  const ctx: Ctx = {
    rest, tail, command: argv,
    positional: [...rest.filter((a, i) => !a.startsWith("--") && !VALUED.includes(rest[i - 1])), ...tail],
    flag: (name) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined; },
    write,
    log: (s) => write(`${s}\n`),
    out: (value) => write(`${JSON.stringify(value, null, 2)}\n`),
    err: (s) => (io.stderr ?? ((t) => process.stderr.write(t)))(`${s}\n`),
    stdin: io.stdin ?? (() => Bun.stdin.text()),
    code: 0,
  };
  try {
    await route(ctx, cmd);
  } catch (e) {
    if (!(e instanceof Refusal)) throw e;
    ctx.err(e.message);
    ctx.code = 1;
  }
  return { out: text, code: ctx.code };
}

/** Print the started run, then wait for a foreground unit: the transition has dropped its locks. */
async function started(ctx: Ctx, s: Start): Promise<void> {
  ctx.out(s.started);
  const code = await s.child?.exited;
  if (code) ctx.code = code;
}

async function job(ctx: Ctx): Promise<void> {
  repoOf(ctx.positional[0]);
  checkName(ctx.positional[1]);
  const specArg = ctx.flag("spec") ?? refuse("--spec <file|-> is required");
  const [repo, name] = ctx.positional;
  const spec = specArg === "-" ? await ctx.stdin() : readFileSync(specArg, "utf8");
  const onArg = ctx.flag("on");
  await started(ctx, await startJob({ repo, name, spec, on: onArg, model: ctx.flag("model"), land: ctx.rest.includes("--land") }, { command: ctx.command }));
}

async function plain(ctx: Ctx): Promise<void> {
  await started(ctx, await startPlain({ name: ctx.rest[0], argv: ctx.tail, cwd: process.cwd() }, { command: ctx.command }));
}

/**
 * The ledger follows git. An open job whose work is on origin/<main> becomes
 * landed, quietly, and settleOnMain closes its issue. An open job with no branch and
 * no worktree left is "gone": nothing is left to land. Every other open job
 * is "unlanded". Each repo is fetched once.
 */
function reconcile(ctx: Ctx, all: Entry[][]): Map<string, string> {
  const registry = loadRegistry();
  const fetched = new Set<string>();
  const fates = new Map<string, string>();
  // Only Chris's git pull moves a checkout: the ledger fetches and reads refs.
  for (const runs of all.filter(isOpen)) {
    const last = counting(runs);
    const repo = last.run.repo ? registry[last.run.repo] : undefined;
    if (!repo || last.run.kind === "plain" || isLive(last.folder)) continue;
    if (!fetched.has(repo.key)) {
      fetched.add(repo.key);
      fetchOrigin(repo.path);
    }
    const found = onMain(repo, { job: last.run.job, branch: last.run.branch, fetch: false });
    if (found) {
      patchRun(last.id, { condition: "landed", commit: found.commit, reason: `found on main (${found.how})`, cause: undefined, ask: undefined, told: true });
      const { todo } = settleOnMain(repo, last.run, found.commit, cutTitle(last.run.say ?? last.run.name));
      if (todo && todo !== "done") ctx.err(`warn: issue ${issueOf(runs)} not closed: ${todo}`);
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

function jobs(ctx: Ctx): void {
  if (ctx.rest.includes("--news")) {
    const news: { run: string; line: string }[] = [];
    for (const e of allRuns()) {
      if (e.run.condition === "running" || e.run.told) continue;
      news.push({ run: e.id, line: newsLine(e, e.run.repo ? loadRegistry()[e.run.repo]?.note : undefined) });
      patchRun(e.id, { told: true });
    }
    return ctx.out(news);
  }
  const fates = reconcile(ctx, allJobs());
  const all = allJobs();
  const name = ctx.positional[0];
  // A job that landed with its check open stays in the list until `aleph checked`.
  // A job that ended in the last 24 hours follows the open ones, the latest first.
  if (!name) {
    const listed = (j: Entry[]) => isOpen(j) || (counting(j).run.condition === "landed" && counting(j).run.check === "open");
    const ended = (j: Entry[]) => Date.parse(counting(j).run.ended ?? "");
    const recent = all.filter((j) => !listed(j) && Date.now() - ended(j) < DAY_MS).sort((a, b) => ended(b) - ended(a));
    return ctx.out([...all.filter((j) => listed(j) && counting(j).run.kind !== "chat"), ...recent].map((j) => summary(j, fates)));
  }
  const runs = findJob(name, null, all);
  if (!runs) refuse(`no job named ${name}`);
  const last = counting(runs);
  const checks = readFile(last, "checks.log");
  ctx.out({
    ...summary(runs, fates), question: last.run.question, result: readFile(last, "result.md"),
    checks: checks?.trimEnd().split("\n").slice(-40).join("\n"), land: readFile(last, "land.log"),
  });
}

/**
 * aleph issue <add|list|show|note|done|drop|lint> <repo> ... — every repo in the
 * registry has a list in the work store. The verbs are issues/lib/issues.ts; this
 * parses argv, prints, and starts the dispatch or intake a write calls for.
 */
async function todoCmd(ctx: Ctx): Promise<void> {
  let [verb, repoKey, ...args] = ctx.positional;
  const json = ctx.rest.includes("--json");
  const fixing = ctx.rest.includes("--fix");
  const stat = ctx.flag("status");
  const label = ctx.flag("label");
  // `--request -` or `--spec -` reads that part from stdin: it is prose of several lines.
  const requestArg = ctx.flag("request"), specArg = ctx.flag("spec");
  const labelsArg = ctx.flag("labels");
  const afterArg = ctx.flag("after");
  const fields: verbs.Fields = {
    title: ctx.flag("title"),
    kind: ctx.flag("kind"),
    request: requestArg === undefined ? undefined : (requestArg === "-" ? await ctx.stdin() : requestArg).trim(),
    spec: specArg === undefined ? undefined : (specArg === "-" ? await ctx.stdin() : specArg).trim(),
    priority: ctx.flag("priority"),
    labels: labelsArg === undefined ? undefined : labelsArg.split(",").map((s) => s.trim()).filter(Boolean),
    source: ctx.flag("source"),
    status: stat,
    ...(afterArg === undefined ? {} : { after: afterArg.split(",").map((s) => s.trim()).filter(Boolean) }),
    // `--media <file>` may repeat.
    media: ctx.rest.flatMap((a, i) => (a === "--media" && ctx.rest[i + 1] !== undefined ? [ctx.rest[i + 1]] : [])),
  };
  const sub = verb ?? refuse(usage("issue"));
  const registry = loadRegistry();
  const ref = parseId(repoKey);
  if (ref && sub !== "add") {
    repoKey = ref.repo;
    args = [ref.sub === undefined ? String(ref.n) : `${ref.n}.${ref.sub}`, ...args];
  }
  if (!repoKey && (sub === "list" || sub === "lint")) return todoRecent(ctx, sub, registry, { status: stat, label, kind: ctx.flag("kind") }, json);
  const repo = registry[repoKey ?? ""] ?? refuse(repoKey ? `no repo named ${repoKey}` : "name a repo");
  verbs.checkFields(fields);
  const id = /^\d+\.\d+$/.test(args[0] ?? "") ? args[0] : Number(args[0]);
  const text = args.slice(1).join(" ").trim();
  const warn = (follow: string | null | undefined) => { if (follow) ctx.err(`warn: ${follow}`); };

  switch (sub) {
    case "add": {
      const a = await verbs.add(repo, args.join(" "), fields, filing);
      warn(a.follow);
      for (const m of a.result.maybeSame ?? []) ctx.err(`${repo.key}-${m.id} may be the same task: ${m.title}`);
      ctx.out(a.result);
      return;
    }
    case "list": {
      const rows = verbs.list(repo, { status: stat, label, kind: ctx.flag("kind") });
      if (json) { ctx.out(rows.map(verbs.brief(repo.key))); return; }
      if (!rows.length) { ctx.log("no issues"); return; }
      printRows(ctx, rows, repo.key);
      return;
    }
    case "show": {
      const i = verbs.show(repo, id);
      if (json) { ctx.out({ ...verbs.brief(repo.key)(i), request: i.request, spec: i.spec, notes: i.notes, media: store.mediaOf(i) }); return; }
      ctx.log(`## ${issues.refOf(i)}. ${i.title}`);
      const ask = askOf(refIn(repo.key, i));
      ctx.log(`${issues.status(i)}   source ${store.sourceOf(i)}   priority ${store.priorityOf(i)}   updated ${issues.updated(i) ?? "-"}`);
      ctx.log(`after ${issues.localRefs(repo.key, store.afterOf(i).join(", ")) || "-"}   areas ${store.areasOf(i).join(", ") || "-"}`);
      ctx.log(`ask ${ask ? `${ask.kind} (${ask.reason}): ${ask.question}` : "-"}`);
      if (i.request.trim()) ctx.log(`\n## Request\n\n${i.request}`);
      if (i.spec.trim()) ctx.log(`\n${i.spec}`);
      if (i.notes.length) ctx.log(`\n### Notes\n${i.notes.join("\n")}`);
      const media = store.mediaOf(i);
      if (media.length) ctx.log(`\n### Media\n${media.map((m) => `- ${m}`).join("\n")}`);
      return;
    }
    case "note": {
      // Chris's answer to an issue that waits for them: not a worker's note (ALEPH_JOB_ID) and not the factory's own.
      const n = verbs.note(repo, id, text, verbs.isAnswer(text, jobId()));
      warn(n.follow);
      ctx.out(n.result);
      if (n.answered) intakeDetached(repo, n.result.id);
      return;
    }
    case "attach": {
      // `aleph issue attach <repo> <n> <file>...`: images or PDFs.
      const a = verbs.attach(repo, id, args.slice(1));
      warn(a.follow);
      ctx.out(a.result);
      return;
    }
    case "decide": {
      const d = verbs.decide(repo, id, text, fields);
      warn(d.follow);
      ctx.out(d.result);
      // The note is Chris's answer: the intake that follows a note takes the issue from here.
      intakeDetached(repo, d.item.id);
      return;
    }
    case "edit": {
      const e = verbs.edit(repo, id, fields, text);
      warn(e.follow);
      ctx.out(e.result);
      dispatchAfterIssue(repo, e.item);
      return;
    }
    case "done":
    case "drop": {
      const c = verbs.close(repo, id, sub, text);
      warn(c.follow);
      ctx.out(c.result);
      // The dropped issue's open job goes with it, or its Ask outlives the issue. The close note is the issue's record.
      const open = sub === "drop" ? openJobOfIssue(repo.key, id)?.[0].run.name : undefined;
      if (open) await drop(open, { reason: `issue ${repo.key}-${id} was dropped`, quiet: true });
      // An issue that waited on this issue can start, and a dropped part can set its parent's Ask: the dispatch takes both.
      if (repo.sandbox) dispatchDetached();
      return;
    }
    case "retitle": {
      const r = await verbs.retitle(repo, fit);
      warn(r.follow);
      for (const t of r.result.retitled) ctx.log(`${repo.key}-${t.id}: ${t.title}`);
      return;
    }
    case "lint": {
      if (fixing) {
        const l = verbs.lintFix(repo);
        warn(l.follow);
        ctx.out(l.result);
        if (l.result.remaining.length) ctx.code = 1;
        return;
      }
      const l = verbs.lint(repo);
      if (!l.findings.length) { ctx.out({ repo: l.repo, items: l.items, findings: [] }); return; }
      for (const f of l.findings) ctx.err(`item ${f.id}: ${f.problem}${f.fixable ? " (--fix repairs this)" : ""}`);
      refuse(`${l.findings.length} problem${l.findings.length > 1 ? "s" : ""} in the ${repo.key} list`);
    }
    default: refuse(usage("issue"));
  }
}

/** The registry's repos with a ledger run or an item update in the last 7 days, the latest first, each with its list. */
function listRecent(): { repo: Repo; doc: issues.Doc | null }[] {
  return verbs.recentLists(Object.values(loadRegistry()));
}

/** `aleph issue list` and `aleph issue lint` with no repo: each recent repo. */
function todoRecent(ctx: Ctx, sub: "list" | "lint", registry: Record<string, Repo>, o: { status?: string; label?: string; kind?: string }, json: boolean): void {
  const repos = Object.values(registry);
  if (sub === "lint") {
    const results = verbs.lintRecent(repos);
    for (const r of results) for (const f of r.findings) ctx.err(`${r.repo} item ${f.id}: ${f.problem}${f.fixable ? " (--fix repairs this)" : ""}`);
    ctx.out(results);
    if (results.some((r) => r.findings.length)) ctx.code = 1;
    return;
  }
  const rows = verbs.listRecent(repos, o).map((r) => ({ repo: r.repo.key, items: r.items }));
  if (json) { ctx.out(rows.map((r) => ({ repo: r.repo, items: r.items.map(verbs.brief(r.repo)) }))); return; }
  if (!rows.length) { ctx.log("no issues"); return; }
  for (const r of rows) { ctx.log(r.repo); printRows(ctx, r.items, r.repo, "  "); }
}

/** `aleph intake <repo>-<n>`: take in one issue now, under the dispatch's gates. */
async function intakeCmd(ctx: Ctx): Promise<void> {
  const registry = loadRegistry();
  const ref = issues.parseRef(ctx.rest[0] ?? "") ?? refuse(usage("intake"));
  const repo = registry[ref.repo] ?? refuse(`no repo ${ref.repo}`);
  ctx.out(await intakeNow(repo, ref.id));
}

/** `aleph dispatch`: start every ready issue up to the live cap. A run's end and `aleph issue` call it. */
async function dispatchCmd(ctx: Ctx): Promise<void> {
  ctx.out(await runDispatch());
}

/** `aleph tick`, from the timer every minute: the periodic steps that are due and the sweep (tick.ts). */
async function tickCmd(ctx: Ctx): Promise<void> {
  ctx.out(await runTick());
}

/**
 * `aleph report`: the runs not yet shown, how far each factory repo's
 * checkout is behind origin, and the health lines: the factory's alarms, then the
 * monitor's flake counts and its newest report. With --hook it prints the
 * SessionStart hook's JSON from hookLines, read-only, and nothing when there is nothing to act on. With --peek the
 * runs stay unshown, for a check or a test that is not Chris reading.
 */
function reportCmd(ctx: Ctx): void {
  if (ctx.rest.includes("--hook")) {
    if (process.env.ALEPH_AGENT) return;
    const lines = hookLines();
    if (lines.length) ctx.out({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: lines.join("\n") } });
    return;
  }
  const lines = [report(Date.now(), ctx.rest.includes("--peek"))];
  for (const repo of Object.values(loadRegistry()).filter((r) => r.sandbox)) {
    fetchOrigin(repo.path);
    lines.push(behind(repo) ?? "");
  }
  lines.push(...health().map((h) => shortText(h.text)), ...flakeLines().map(shortText));
  const m = reportLine();
  if (m) lines.push(shortText(m));
  const text = lines.filter(Boolean).join("\n\n");
  ctx.log(text || "nothing new");
}

/** One line of `aleph status`: the id and the stage, then the reason's sentence. */
const stageLine = (s: Stage) => `${s.id} ${s.stage}${s.why ? `: ${s.why}` : ""}`;

/** `aleph status <repo>-<n>[.<k>]`: the item's stage, from the store and the ledger; with no issue, see statusRecent. */
function statusCmd(ctx: Ctx): void {
  if (!ctx.positional[0]) return statusRecent(ctx);
  const reg = loadRegistry();
  const p = issues.parseIssueRef(ctx.positional[0]) ?? refuse(usage("status"));
  const key = p.repo, itemRef = p.id, n = String(p.id);
  const repo = reg[key] ?? refuse(`no repo named ${key} in the registry`);
  let s: Stage | undefined;
  try { s = repoStages(repo, { fetch: true, items: [itemRef] })[0]; } catch (e: any) { refuse(e?.message ?? String(e)); }
  if (!s) refuse(`${key} has no issue ${n}`);
  if (ctx.rest.includes("--json")) return ctx.out(s);
  ctx.log(issues.localRefs(key, stageLine(s)));
}

/** `aleph status` with no issue: the stage of each open issue in each recent repo. */
function statusRecent(ctx: Ctx): void {
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
    catch (e: any) { ctx.err(`warn: ${repo.key}: ${e?.message ?? e}`); }
  }
  if (ctx.rest.includes("--json")) return ctx.out(states);
  if (!states.length) { ctx.log("no open items"); return; }
  for (const { key, rows } of ofRepo) { ctx.log(key); for (const s of rows) ctx.log(issues.localRefs(key, `  ${stageLine(s)}`)); }
}

const ready = (i: issues.Issue, key: string) => (store.afterOf(i).length ? `after ${issues.localRefs(key, store.afterOf(i).join(","))}` : "");

function printRows(ctx: Ctx, rows: issues.Issue[], key: string, indent = ""): void {
  const refs = rows.map(issues.refOf);
  const w = refs.reduce((m, r) => Math.max(m, r.length), 0);
  for (const [n, i] of rows.entries()) ctx.log(`${indent}${refs[n].padStart(w)}  ${issues.status(i).padEnd(7)} ${store.priorityOf(i).padEnd(8)} ${i.title}${ready(i, key) ? `  (${ready(i, key)})` : ""}`);
}

const IDEA_USAGE = usage("idea");

/** `aleph idea ...`: the ideas store (ideas/ideas.ts). `-` as a text flag reads stdin. */
async function ideaCmd(ctx: Ctx): Promise<void> {
  const [verb, ...args] = ctx.positional;
  const text = async (name: string) => { const v = ctx.flag(name); return v === "-" ? await ctx.stdin() : v ?? ""; };
  const warn = (w: string | null) => { if (w) ctx.err(w); };
  switch (verb) {
    case "add": {
      const target = ctx.flag("target");
      if (target && !loadRegistry()[target]) refuse(`no repo named ${target}`);
      const a = ideas.add(args.join(" "), await text("sketch"), target);
      warn(a.warn);
      ctx.log(a.slug);
      return;
    }
    case "list":
      for (const r of ideas.list(ctx.flag("status"))) ctx.log([r.idea.slug, r.idea.fm.target ?? "new project", r.lenses.join(",") || "-", r.last].join("  "));
      return;
    case "show": {
      const slug = args[0] ?? refuse(IDEA_USAGE);
      ideas.read(slug);
      const results = ideas.lenses(slug).map((l) => `- ${l.lens} ${l.at} ${l.file}`);
      ctx.write(`${readFileSync(ideas.file(slug), "utf8")}\n## Lens results\n\n${results.join("\n") || "none"}\n`);
      return;
    }
    case "edit": return warn(ideas.edit(args[0] ?? refuse(IDEA_USAGE), await text("writeup")));
    case "note": return warn(ideas.note(args[0] ?? refuse(IDEA_USAGE), args.slice(1).join(" ")));
    case "built": return warn(ideas.built(args[0] ?? refuse(IDEA_USAGE), args.slice(1)));
    case "drop": return warn(ideas.drop(args[0] ?? refuse(IDEA_USAGE)));
    case "lens": {
      const l = await ideas.lens(args[0] ?? refuse(IDEA_USAGE), args[1] ?? refuse(IDEA_USAGE));
      warn(l.warn);
      ctx.log(l.file);
      return;
    }
    case "save": {
      const [slug, lens, from] = args;
      const s = ideas.save(slug ?? refuse(IDEA_USAGE), lens ?? refuse(IDEA_USAGE), resolve(from ?? refuse(IDEA_USAGE)));
      warn(s.warn);
      ctx.log(s.file);
      return;
    }
    default: refuse(IDEA_USAGE);
  }
}

const ANNOTATION_USAGE = usage("annotation");

/** `aleph annotation ...`: the notes pinned on UI pages (lib/annotations.ts). `list` prints Markdown, the rest JSON; `put` reads one note as JSON on stdin. */
async function annotationCmd(ctx: Ctx): Promise<void> {
  const [verb, ...args] = ctx.positional;
  const text = async (words: string[]) => (words[0] === "-" ? await ctx.stdin() : words.join(" ")).trim() || refuse(ANNOTATION_USAGE);
  const by = (ctx.flag("by") ?? "agent") as notes.By;
  if (!["you", "agent"].includes(by)) refuse("--by takes you or agent");
  switch (verb) {
    case "list": {
      const url = ctx.flag("url");
      const shown = notes.read().filter((n) => (ctx.rest.includes("--all") || n.status === "open") && (!url || n.url === url || n.url === ""));
      if (ctx.rest.includes("--json")) ctx.out(shown);
      else ctx.log(notes.markdown(shown));
      return;
    }
    case "add": {
      const on = ctx.flag("on"), css = ctx.flag("selector");
      if (Boolean(on) === Boolean(css)) refuse(ANNOTATION_USAGE);
      ctx.out(notes.add(on ? notes.anchor(on) : css!, await text(args), { url: ctx.flag("url") ?? "", by }));
      return;
    }
    case "reply": ctx.out(notes.reply(args[0] ?? refuse(ANNOTATION_USAGE), await text(args.slice(1)), by)); return;
    case "resolve": ctx.out(notes.mark(args[0] ?? refuse(ANNOTATION_USAGE), "resolved")); return;
    case "reopen": ctx.out(notes.mark(args[0] ?? refuse(ANNOTATION_USAGE), "open")); return;
    case "drop": ctx.out(notes.drop(args[0] ?? refuse(ANNOTATION_USAGE))); return;
    case "put": {
      let raw: unknown;
      try { raw = JSON.parse(await ctx.stdin()); } catch { refuse("put reads one annotation as JSON on stdin"); }
      ctx.out(notes.put(raw));
      return;
    }
    default: refuse(ANNOTATION_USAGE);
  }
}

/** `aleph doctor [--fix] [--json]`: pass or fail for each part of the machine; exit 1 if any fails. */
async function doctorCmd(ctx: Ctx): Promise<void> {
  const checks = await doctor.doctor();
  const fixed = ctx.rest.includes("--fix") ? doctor.fix() : [];
  if (ctx.rest.includes("--json")) ctx.out({ checks, fixed });
  else {
    for (const c of checks) ctx.log(`${c.ok ? "PASS" : "FAIL"} ${c.name}: ${c.detail}`);
    for (const f of fixed) ctx.log(`FIX ${f}`);
  }
  if (checks.some((c) => !c.ok)) ctx.code = 1;
}

/** The command table: `aleph <cmd> ...`. */
async function route(ctx: Ctx, cmd: string | undefined): Promise<void> {
  if (cmd && cmd in COMMANDS && (ctx.rest.includes("--help") || ctx.rest.includes("-h"))) return ctx.log(`${COMMANDS[cmd].usage}\n  ${COMMANDS[cmd].purpose}`);
  switch (cmd) {
    case "help":
      for (const [name, c] of Object.entries(COMMANDS)) ctx.log(ctx.rest.includes("--brief") ? `${name}: ${c.purpose}` : `${c.usage}\n  ${c.purpose}`);
      break;
    case "doctor": await doctorCmd(ctx); break;
    case "doc-claims": {
      // Each doc claim of this repo the code does not back, read now: run it after the last edit of a doc.
      const r = (await import("./lib/gates/doc-claims-repo.ts")).docClaimsReport();
      ctx.log(r.text);
      if (!r.ok) ctx.code = 1;
      break;
    }
    case "memory": {
      // `maintain` is the whole maintainer: the vault's mechanical pass, the corrections mining and the compile of yesterday. A missing vault falls to the op, which says so.
      if (ctx.command[1] === "maintain" && existsSync(join(resolve(vaultDir()), "Home.md"))) {
        const r = await maintainAll(resolve(vaultDir()), ctx.rest.includes("--dry"), Date.now(), { mech: true, corr: true, compile: true });
        ctx.out(r);
        if (!r.ok || r.corrections?.error || r.compile?.error) ctx.code = 1;
        break;
      }
      // The vault ops print through console and end with an Exit: its output goes to this run's stdout and stderr, its exit code is this one's.
      const { run: vault, Exit } = await import("../vault/lib/ops.ts");
      const { log, error } = console;
      console.log = (...a) => ctx.log(a.join(" "));
      console.error = (...a) => ctx.err(a.join(" "));
      try { await vault(ctx.command.slice(1)); }
      catch (e) { if (!(e instanceof Exit)) throw e; ctx.code = e.code; }
      finally { console.log = log; console.error = error; }
      break;
    }
    case "job": await job(ctx); break;
    case "run": await plain(ctx); break;
    case "jobs": jobs(ctx); break;
    case "recheck": await started(ctx, await recheck(ctx.positional[0], { command: ctx.command })); break;
    case "drop": {
      const quiet = ctx.rest.includes("--quiet");
      const given = ctx.flag("fate");
      if (ctx.rest.includes("--fate") && !FATES.includes(given as Fate)) refuse(`--fate takes one of ${FATES.join(", ")}`);
      const fate = (given as Fate | undefined) ?? (quiet ? undefined : "manual");
      ctx.out(await drop(ctx.positional[0], { reason: ctx.positional.slice(1).join(" "), quiet, fate }));
      break;
    }
    case "unit": await unit(resolve(ctx.positional[0])); break;
    case "land": await started(ctx, await land(ctx.positional[0], { checked: ctx.rest.includes("--checked") }, { command: ctx.command })); break;
    case "checked": ctx.out(checked(ctx.positional[0])); break;
    case "issue": await todoCmd(ctx); break;
    case "annotation": await annotationCmd(ctx); break;
    case "idea": await ideaCmd(ctx); break;
    case "tick": await tickCmd(ctx); break;
    case "director": ctx.out(await directorStep()); break;
    case "housekeep": ctx.out(await housekeep(Date.now()) ?? refuse("another housekeeper holds the lock")); break;
    case "suite": ctx.out(await suiteStep()); break;
    case "monitor": {
      // `aleph monitor [--dry] [--day YYYY-MM-DD]`: the table of the day (yesterday by default) and its reading. --dry prints the table and writes nothing.
      const day = ctx.flag("day") ?? addDays(issues.today(), -1);
      if (!/^\d{4}-\d\d-\d\d$/.test(day)) refuse(usage("monitor"));
      if (ctx.rest.includes("--dry")) { ctx.write(renderTable(tableOf(day))); break; }
      const r = await runMonitor(day) ?? refuse("another monitor job holds the lock");
      ctx.out({ day: r.day, findings: r.findings, ...(r.error ? { error: r.error } : {}), run: r.run, note: r.note ?? r.noteError });
      break;
    }
    case "dispatch": await dispatchCmd(ctx); break;
    case "intake": await intakeCmd(ctx); break;
    case "status": statusCmd(ctx); break;
    case "report": reportCmd(ctx); break;
    case "pause": setPaused(true); ctx.out({ paused: true }); break;
    case "resume": setPaused(false); ctx.out({ paused: false }); dispatchDetached(); break;
    case "always": {
      const [sub, reason, action, then] = ctx.positional;
      const rules = readAlways;
      if (sub === "list" || sub === undefined) ctx.out(rules());
      else if (sub === "grant") { const bad = grant(reason ?? refuse(usage("always")), action ?? refuse(usage("always"))); if (bad) refuse(bad); ctx.out(rules()); }
      else if (sub === "revoke") { revoke(reason ?? refuse(usage("always"))); ctx.out(rules()); }
      else if (sub === "timeout") {
        if (reason !== undefined) { const bad = setTimeoutOf(reason, Number(action ?? refuse(usage("always"))), then); if (bad) refuse(bad); }
        ctx.out(readTimeouts());
      }
      else refuse(usage("always"));
      break;
    }
    case "models": {
      const change = ctx.positional[0] === "set" ? { model: ctx.positional[2] ?? "" } : ctx.positional[0] === "enable" || ctx.positional[0] === "disable" ? { enabled: ctx.positional[0] === "enable" } : undefined;
      if (change) { const bad = setModel(ctx.positional[1] ?? "", change); if (bad) refuse(bad); }
      else if (ctx.positional[0] !== undefined) refuse(usage("models"));
      ctx.out(readModels());
      break;
    }
    case "judge": {
      const v = ctx.positional[0];
      if (v === "jev" || v === "haiku") setJudgeChoice(v);
      else if (v !== undefined) refuse(usage("judge"));
      ctx.out({ judge: judgeChoice() });
      break;
    }
    default: refuse(`usage: aleph <${Object.keys(COMMANDS).join("|")}> ... (aleph help lists them)`);
  }
}
