/**
 * aleph <job|run|land|checked|recheck|drop|jobs|issue|idea|unit|tick|suite|report|pause|resume|status|judge>
 * — detached agent jobs, plain runs, each repo's issues, and the factory.
 * Ledger: $ALEPH_JOBS_DIR or ~/.aleph/runs. Registry: the projects of $ALEPH_ITEMS or
 * ~/.aleph/items. JSON on stdout, findings on stderr, exit 1 on refusal, and the foreground unit's exit code when it fails.
 * `run` takes the argv and gives what it printed and its exit code: cli/cli.ts calls it for the
 * command line, and a test calls it in its own process.
 * See docs/workflow.md and docs/factory.md.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadRegistry, newsLine, repoOf, type Entry, type Repo, allJobs, isOpen } from "../jobs/lib/records/ledger.ts";
import { uiPort, workerCmd } from "../jobs/lib/infra/settings.ts";
import { runFile } from "../jobs/lib/records/run-files.ts";
import { isLive } from "../jobs/lib/infra/process.ts";
import { findJob, issue as issueOf, issueTitle, readFile, stateOf, view, type Job } from "../jobs/lib/records/job.ts";
import { counting, keepingRuns, patchRun, allRuns } from "../jobs/lib/records/record.ts";
import { fetchingOnce } from "../lib/store.ts";
import { unit } from "../jobs/lib/roles/unit.ts";
import { onMain } from "../jobs/lib/records/status.ts";
import { fetchOrigin, git } from "../lib/git.ts";
import { judgeChoice, setJudgeChoice } from "../lib/jev.ts";
import * as issues from "../lib/issue-file.ts";
import { yesterday } from "../lib/day.ts";
import * as verbs from "../issues/lib/issues.ts";
import { addDevice, devices, dropDevice } from "../ui/pair.ts";
import { todoCmd } from "../issues/cli.ts";
import { ideaCmd } from "../ideas/cli.ts";
import { grant, readAlways, revoke } from "../jobs/lib/asks/ask.ts";
import { readTimeouts, setTimeoutOf } from "../jobs/lib/asks/timeout.ts";
import { behind, directorStep, hookLines, intakeNow } from "../jobs/lib/transitions/factory.ts";
import { runDispatch, runNow } from "../jobs/lib/transitions/dispatch.ts";
import { suiteStep } from "../jobs/lib/transitions/baseline.ts";
import { report } from "../jobs/lib/transitions/report.ts";
import { setPaused } from "../jobs/lib/gates/pause.ts";
import { maintainAll, runTick } from "../jobs/lib/transitions/tick.ts";
import { isVault } from "../vault/lib/vault.ts";
import { vaultDir } from "../lib/paths.ts";
import { dispatchDetached, investigatorDetached } from "../jobs/lib/transitions/launch.ts";
import { health } from "../jobs/lib/gates/factory-status.ts";
import { flakeLines, renderTable, reportLine } from "../jobs/lib/learning/monitor-table.ts";
import { runMonitor, tableOf } from "../jobs/lib/roles/monitor.ts";
import { housekeep } from "../jobs/lib/roles/housekeeper.ts";
import { caseOf, investigate, lockOf } from "../jobs/lib/roles/investigator.ts";
import { held } from "../lib/locks.ts";
import { checkName, checked, drop, foundOnMain, land, recheck, startJob, startPlain, type Start } from "../jobs/lib/transitions/transitions.ts";
import type { Fate } from "../jobs/lib/records/outcome.ts";
import { refuse, Refusal } from "../lib/refusal.ts";
import * as doctor from "../jobs/lib/infra/doctor.ts";
import { facts, repoStages, stages } from "../jobs/lib/records/status.ts";
import type { Stage } from "../jobs/lib/records/stage.ts";
import { readModels, setModel } from "../jobs/lib/routing/models.ts";
import { parseId, shortText } from "../lib/naming.ts";
import { errText } from "../lib/errtext.ts";
import { isAgent } from "../lib/env.ts";

const DAY_MS = 24 * 3600_000;

// A flag's value is not a positional. Every flag here takes one, so leaving a
// name off this list silently folds its value into the next argument: `todo add
// <repo> "<title>" --labels jobs` put "jobs" on the end of the title.
const VALUED = ["--media", "--source", "--spec", "--request", "--model", "--on", "--priority", "--labels", "--status", "--label", "--kind", "--title", "--after", "--refs", "--reopened-since", "--before", "--undo", "--fate", "--day", "--url", "--selector", "--by", "--target", "--sketch", "--writeup"];
const FATES: Fate[] = ["duplicate", "met", "manual"];

/** One row per command of route(): its usage line and its purpose. `help`, `--help`, and each usage refusal read this table. */
const COMMANDS: Record<string, { usage: string; purpose: string }> = {
  job: { usage: "aleph job <repo> <name> --spec <file|-> [--on <ref>] [--model <m>] [--land]", purpose: "start a worker job on a branch of the repo" },
  run: { usage: "aleph run <name> [-- <command...>]", purpose: "run a command as a tracked plain job" },
  jobs: { usage: "aleph jobs [<name> [--resume]|--news]", purpose: "list the open and recent jobs, show one, or open its latest session in claude" },
  recheck: { usage: "aleph recheck <name>", purpose: "run the checks of a job again" },
  drop: { usage: "aleph drop <name> [<reason>] [--quiet] [--answered] [--fate duplicate|met|manual]", purpose: "drop a job and its worktree" },
  unit: { usage: "aleph unit <run-dir>", purpose: "run a started job's unit in the foreground" },
  land: { usage: "aleph land <name> [--checked]", purpose: "land a job's branch on main" },
  checked: { usage: "aleph checked <name>", purpose: "mark a landed job's check as done" },
  issue: { usage: `aleph issue <add|list|show|note|attach|edit|decide|done|drop|lint|retitle> <repo> ... [--kind ${issues.KINDS.join("|")}]`, purpose: "read and write a repo's issues" },
  idea: { usage: "aleph idea <add|list|show|edit|note|built|drop> ...", purpose: "keep and develop ideas" },
  ui: { usage: "aleph ui <pair [label]|unpair <label>|devices>", purpose: "pair a device with the UI, drop one, or list them" },
  tick: { usage: "aleph tick", purpose: "run the periodic steps that are due and the sweep" },
  director: { usage: "aleph director", purpose: "run one director step" },
  housekeep: { usage: "aleph housekeep", purpose: "review the parked issues a land touched, or every parked issue once a day" },
  investigate: { usage: "aleph investigate <issue.N|job.N> [--detach]", purpose: "trace what happened to an issue or a job and recommend issues; --detach starts it as a unit" },
  suite: { usage: "aleph suite", purpose: "run one suite step" },
  monitor: { usage: "aleph monitor [--dry] [--day YYYY-MM-DD]", purpose: "write the monitor's table and reading of a day" },
  dispatch: { usage: "aleph dispatch [issue.N]", purpose: "start every ready issue up to the live cap, or one issue now" },
  intake: { usage: "aleph intake <repo>-<n>", purpose: "run intake on an issue" },
  status: { usage: "aleph status [<repo>-<n>[.<k>]] [--json]", purpose: "show the stage of an issue, or the recent ones" },
  report: { usage: "aleph report [--hook|--peek]", purpose: "show the runs not yet seen and the factory's health; --peek leaves the runs unseen" },
  pause: { usage: "aleph pause", purpose: "stop the factory from starting work" },
  resume: { usage: "aleph resume", purpose: "let the factory start work again" },
  always: { usage: "aleph always <list|grant <reason> <action>|revoke <reason>|timeout [<reason> <minutes> [pick|drop]]>", purpose: "list and change the standing permissions" },
  models: { usage: "aleph models [set <name> <model> | enable <size> | disable <size>]", purpose: "list and change the model of each size and role model" },
  judge: { usage: "aleph judge [jev|haiku]", purpose: "show or set the judge" },
  doctor: { usage: "aleph doctor [--fix] [--json]", purpose: "check the setup and fix what it can" },
  memory: { usage: "aleph memory <init|write|adopt|recall|lint|archive|delete|compile|misses|maintain> ...", purpose: "run a vault op" },
  help: { usage: "aleph help [--brief]", purpose: "list each command with its usage and purpose" },
};
const usage = (cmd: string) => `usage: ${COMMANDS[cmd].usage}`;

/** Where a call of `aleph` writes and reads. `stdout` gets each write as it happens; `run` also returns them all as `out`. */
interface Io { stdout?: (s: string) => void; stderr?: (s: string) => void; stdin?: () => Promise<string> }

/** One call's argv, parsed, with its output and its exit code. */
export interface Ctx {
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
  await started(ctx, await startJob({ repo, name, spec, on: onArg, model: ctx.flag("model"), land: ctx.rest.includes("--land") }, { command: ctx.command, by: "human" }));
}

async function plain(ctx: Ctx): Promise<void> {
  await started(ctx, await startPlain({ name: ctx.rest[0], argv: ctx.tail, cwd: process.cwd() }, { command: ctx.command, by: "human" }));
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
    if (!repo || last.run.role === "plain" || isLive(last.folder)) continue;
    if (!fetched.has(repo.key)) {
      fetched.add(repo.key);
      fetchOrigin(repo.path);
    }
    const found = onMain(repo, { jobs: runs.map((e) => e.id), branch: last.run.branch, fetch: false });
    if (found) {
      const todo = foundOnMain(repo, last, found);
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
    name: v.name, repo: v.repo, kind: v.run.role, job: v.job, run: v.run.id, issue: issueTitle(runs), state: v.state, needs: v.needs, phase: v.phase,
    reason: v.reason, say: v.say, review: v.review, ...(v.check ? { check: v.check } : {}), fate: fates.get(v.job), session: v.session, started: v.started, ended: v.ended,
    ...(v.lost ? { lost: true } : {}),
  };
}

/** `aleph jobs <name> --resume`: the latest run with a session, opened in `claude` from its worktree, where Claude Code finds the session. */
async function resume(runs: Job): Promise<number> {
  const last = runs.findLast((e) => e.run.session);
  if (!last) refuse("no run of this job has a session");
  const { session, worktree } = last.run;
  if (!worktree || !existsSync(worktree)) refuse(`the worktree is gone; the transcript is ${runFile(last.folder, "transcript.jsonl")}`);
  return Bun.spawn([workerCmd(), "--resume", session!], { cwd: worktree, stdio: ["inherit", "inherit", "inherit"] }).exited;
}

async function jobs(ctx: Ctx): Promise<void> {
  if (ctx.rest.includes("--news")) {
    const news: { run: string; line: string }[] = [], registry = loadRegistry();
    for (const e of allRuns()) {
      if (e.run.state === "running" || e.run.told) continue;
      news.push({ run: e.id, line: newsLine(e, e.run.repo ? registry[e.run.repo]?.note : undefined) });
      patchRun(e.id, { told: true });
    }
    return ctx.out(news);
  }
  const fates = reconcile(ctx, allJobs());
  const all = allJobs();
  const name = ctx.positional[0];
  if (ctx.rest.includes("--resume") && !name) refuse(usage("jobs"));
  // A job that landed with its check open stays in the list until `aleph checked`.
  // A job that ended in the last 24 hours follows the open ones, the latest first.
  if (!name) {
    const listed = (j: Entry[]) => isOpen(j) || (stateOf(j) === "landed" && counting(j).run.check === "open");
    const ended = (j: Entry[]) => Date.parse(counting(j).run.ended ?? "");
    const recent = all.filter((j) => !listed(j) && Date.now() - ended(j) < DAY_MS).sort((a, b) => ended(b) - ended(a));
    return ctx.out([...all.filter((j) => listed(j)), ...recent].map((j) => summary(j, fates)));
  }
  const runs = findJob(name, null, all);
  if (!runs) refuse(`no job named ${name}`);
  if (ctx.rest.includes("--resume")) { ctx.code = await resume(runs); return; }
  const last = counting(runs);
  const checks = readFile(last, "checks");
  ctx.out({
    ...summary(runs, fates), question: last.run.question, result: readFile(last, "result.md"),
    checks: checks?.trimEnd().split("\n").slice(-40).join("\n"), land: readFile(last, "land"),
  });
}

/** The registry's repos with a ledger run or an item update in the last 7 days, the latest first, each with its list. */
function listRecent(): { repo: Repo; doc: issues.Doc | null }[] {
  return verbs.recentLists(Object.values(loadRegistry()));
}

/** `aleph intake <repo>-<n>`: take in one issue now, under the dispatch's gates. */
async function intakeCmd(ctx: Ctx): Promise<void> {
  const registry = loadRegistry();
  const ref = parseId(ctx.rest[0] ?? "") ?? refuse(usage("intake"));
  const repo = registry[ref.repo] ?? refuse(`no repo ${ref.repo}`);
  ctx.out(await intakeNow(repo, ref.n));
}

/** `aleph dispatch`: start every ready issue up to the live cap. A run's end and `aleph issue` call it. With an issue key it starts that one issue now (Run now), or refuses with the text of the gate. */
async function dispatchCmd(ctx: Ctx): Promise<void> {
  // One pass reads the jobs table and fetches the items store once, as the tick does: each read in it would do both again.
  const pass = <T>(fn: () => Promise<T>) => keepingRuns(() => fetchingOnce(fn));
  if (!ctx.rest[0]) return ctx.out(await pass(() => runDispatch()));
  const d = await pass(() => runNow(ctx.rest[0]));
  if (d.refused) refuse(d.refused);
  ctx.out(d);
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
    if (isAgent()) return;
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
  try { s = repoStages(repo, { fetch: true, items: [itemRef] })[0]; } catch (e) { refuse(errText(e)); }
  if (!s) refuse(`${key} has no issue ${n}`);
  if (ctx.rest.includes("--json")) return ctx.out(s);
  ctx.log(issues.localRefs(key, stageLine(s), repo.code));
}

/** `aleph status` with no issue: the stage of each open issue in each recent repo. */
function statusRecent(ctx: Ctx): void {
  const states: Stage[] = [], ofRepo: { key: string; code?: string; rows: Stage[] }[] = [], jobs = allJobs();
  for (const { repo, doc } of listRecent()) {
    const open = (doc?.items ?? []).filter((i) => issues.status(i) === "open");
    if (!open.length) continue;
    try {
      fetchOrigin(repo.path);
      const refs = open.map((i) => String(i.id));
      const rows = stages(facts(repo, doc, jobs, refs), refs);
      states.push(...rows);
      if (rows.length) ofRepo.push({ key: repo.key, code: repo.code, rows });
    }
    catch (e) { ctx.err(`warn: ${repo.key}: ${errText(e)}`); }
  }
  if (ctx.rest.includes("--json")) return ctx.out(states);
  if (!states.length) { ctx.log("no open items"); return; }
  for (const { key, code, rows } of ofRepo) { ctx.log(key); for (const s of rows) ctx.log(issues.localRefs(key, `  ${stageLine(s)}`, code)); }
}

/** `aleph ui pair|unpair|devices`: the devices that may POST to the UI (ui/pair.ts). */
function uiCmd(ctx: Ctx): void {
  const [verb, label] = ctx.positional;
  switch (verb) {
    case "pair": {
      const { token, label: name } = (() => { try { return addDevice(label); } catch (e) { return refuse((e as Error).message); } })();
      ctx.log(`paired ${name}; open once:\nhttp://aleph.home/pair#${token}\nhttp://127.0.0.1:${uiPort()}/pair#${token}`);
      return;
    }
    case "unpair": if (!label || !dropDevice(label)) refuse(`no device ${label ?? ""}`.trim()); ctx.log(`unpaired ${label}`); return;
    case "devices": for (const d of devices()) ctx.log(`${d.label} ${d.date}`); return;
    default: refuse(usage("ui"));
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
    case "memory": {
      // `maintain` is the whole maintainer: the vault's mechanical pass, and the compile of yesterday. A missing vault falls to the op, which says so.
      if (ctx.command[1] === "maintain" && isVault(resolve(vaultDir()))) {
        const r = await maintainAll(resolve(vaultDir()), ctx.rest.includes("--dry"), Date.now(), { mech: true, compile: true, decay: true, overlap: true, misses: true });
        ctx.out(r);
        if (!r.ok || r.compile?.error || r.recheck?.error || r.dedupe?.error) ctx.code = 1;
        break;
      }
      ctx.code = await (await import("../vault/lib/cli.ts")).cli(ctx.command.slice(1), { log: ctx.log, err: ctx.err });
      break;
    }
    case "job": await job(ctx); break;
    case "run": await plain(ctx); break;
    case "jobs": await jobs(ctx); break;
    case "recheck": await started(ctx, await recheck(ctx.positional[0], { command: ctx.command, by: "human" })); break;
    case "drop": {
      const quiet = ctx.rest.includes("--quiet");
      const given = ctx.flag("fate");
      if (ctx.rest.includes("--fate") && !FATES.includes(given as Fate)) refuse(`--fate takes one of ${FATES.join(", ")}`);
      const fate = (given as Fate | undefined) ?? (quiet ? undefined : "manual");
      ctx.out(await drop(ctx.positional[0], { reason: ctx.positional.slice(1).join(" "), quiet, fate, answered: ctx.rest.includes("--answered") }));
      break;
    }
    case "unit": await unit(resolve(ctx.positional[0])); break;
    case "land": await started(ctx, await land(ctx.positional[0], { checked: ctx.rest.includes("--checked") }, { command: ctx.command, by: "human" })); break;
    case "checked": ctx.out(checked(ctx.positional[0])); break;
    case "issue": await todoCmd(ctx, usage("issue")); break;
    case "ui": uiCmd(ctx); break;
    case "idea": await ideaCmd(ctx, usage("idea")); break;
    case "tick": await tickCmd(ctx); break;
    case "director": ctx.out(await directorStep()); break;
    case "housekeep": ctx.out(await housekeep(Date.now()) ?? refuse("another housekeeper holds the lock")); break;
    case "investigate": {
      const subject = caseOf(ctx.positional[0] ?? refuse(usage("investigate")))?.subject ?? refuse(`no issue or job ${ctx.positional[0]}`);
      if (held(lockOf(subject))) refuse(`an investigation of ${subject} is running`);
      if (ctx.rest.includes("--detach")) { investigatorDetached(subject); ctx.out({ started: subject }); break; }
      ctx.out(await investigate(subject) ?? refuse(`an investigation of ${subject} is running`));
      break;
    }
    case "suite": ctx.out(await suiteStep()); break;
    case "monitor": {
      // `aleph monitor [--dry] [--day YYYY-MM-DD]`: the table of the day (yesterday by default) and its reading. --dry prints the table and writes nothing.
      const day = ctx.flag("day") ?? yesterday(Date.now());
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
