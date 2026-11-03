/**
 * Job continuation: what follows a run that ended, and the brief the next run reads.
 * This module decides and writes the brief; the unit, the land and the rescue start
 * the runs and write the store. The deciders take ledger data and do no IO when given
 * it: nextStep, afterLand, askedQuestion, rescueCase,
 * and the rescue steps but rerunStep. The briefs and notes read the run folders.
 *
 * It owns two markers: the rerun note at <factory>/rerun/<name>.md, which the goal's
 * next run reads, and `rescued` in a run folder, which counts a rescue case against
 * the goal. The Ask markers (`asked`, `asked-spec`) stay in ask.ts.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { reader } from "../../todo/lib/store.ts";
import { needsOf } from "./ask.ts";
import { factoryDir } from "./factory-status.ts";
import { ALREADY_MET } from "./gate.ts";
import { git } from "./git.ts";
import { jobById, jobsNamed, notes, readFile, tailOf, type Job } from "./job.ts";
import { askOf, isAgentRun, isBuild, lastTagged, onOf, runsDir, type Check, type Entry, type Repo, type Run } from "./ledger.ts";
import { hiddenOf } from "./checks.ts";
import { causeOf, type Fate } from "./outcome.ts";
import { jobSpec, runFile } from "./run-files.ts";

// ---------------------------------------------------------------------------
// The worker brief

// A worker that backgrounds a command and ends its turn is never woken again in a headless run.
export const FOREGROUND = "Run every command in the foreground and wait for it: nothing wakes you after your turn ends.";

const FIXED = (run: Run, main: string) => `You are a worker on job \`${run.name}\` in \`${run.worktree}\`, branch \`${run.branch}\`. Work
only there. Commit every change on the branch; the run fails if anything is
left uncommitted or untracked. Never merge, never push, never touch another
branch. \`aleph issue\` is not your push: it writes the list of issues on main by
itself, so use it for every change to the list. If the previous run was a
failed land, merge \`origin/${main}\` into the branch, resolve the conflicts,
and commit. If you need a decision from Chris, stop
and make your last line \`QUESTION: <one question>\`. ${FOREGROUND} End with a
summary of what you did and what you ran: at most 120 words of prose, plus a list only for separate items.`;

/** What the worker runs before it ends: the repo's own checks, else today's sentence. */
function checksSentence(checks: Check[]): string {
  if (!checks.length) return "Run the repo's tests before you end.";
  const list = checks.map((c) => `\n- \`${c.name}\`: \`${c.run}\`${c.when?.length ? ` (when ${c.when.join(", ")} change)` : ""}`).join("");
  return `Run each of the repo's checks before you end, and fix what fails:${list}\n`;
}

const FACTORY = (run: Run, main: string, checks: Check[] = []) => `You are a worker on job \`${run.name}\`, in a git repo on branch \`${run.branch}\`, inside
a sandbox. You see this repo and nothing else of the machine, and the network
reaches only the Anthropic API and npm. Do the goal below. Commit every change
on the branch: only commits leave the sandbox. Never switch to another branch
and never push. If the previous run's land conflicted, merge \`origin/${main}\`
into the branch and resolve the conflicts so that both changes survive. Nobody
answers questions during the run: when you must choose, take the answer you
would recommend and print a line \`DEFAULT: <question> -> <answer>\`. \`DEFAULT:\` is for choices the Oracle does not settle. If you cannot meet a clause of the Oracle (for example, because the clause conflicts with another clause of the spec), stop: do not defer that clause, and make your last line \`QUESTION: <question that names the Oracle clause>\`. Do not use \`DEFAULT:\` or \`FOLLOWUP:\` for that clause. For work
you find but do not do, print a line \`FOLLOWUP: <title>\`; a \`FOLLOWUP:\` must not cover anything the Oracle names. A test that fails or times out and is not the goal's own, and passes again alone or on a rerun, is a flake: print one line \`FLAKE: <test file> > <test name>: <what you saw>\` and no \`FOLLOWUP:\` for it. End the result with zero or more lines
\`FACT: <one sentence> [source: <file:line | commit sha | https URL>]\`, for durable
facts about the repo or its tools that you learned and checked. If the goal already
holds on your branch and no edit is needed, make no commit, run the repo's tests,
and print exactly one line \`${ALREADY_MET}: <evidence>\`, the evidence being the
files, the lines and the commit on \`${main}\` that show it. A worker that
cannot do the goal makes no commit and gives the reason in its final text; it does not commit a note.
${checksSentence(checks)} Chrome cannot start in the sandbox. For a screenshot of a page
served by your own server on 127.0.0.1, run \`aleph-shot <url> <out.png> [--width 1440] [--height 900] [--scheme light|dark] [--click <css selector>] [--wait <ms>]\`:
the factory takes the shot outside the sandbox and writes the PNG at the path, which must be inside the repo, and you commit it.
Only \`http://127.0.0.1:<port>\` URLs of your own server are loaded. ${FOREGROUND} End with a summary of what you did and what you ran, each thing said once: at most 120 words of prose, plus a list only for separate items.`;

/**
 * The goal's checks for the brief: its test files stored on the issue, with how to run them, or "" when it has none.
 * They stay on the issue and out of the repo. The sealed scenarios are not among them: only the reviewer sees those.
 */
function goalChecks(repo: Repo, run: Run): string {
  const files = Object.entries(hiddenOf(repo, run) ?? {});
  if (!files.length) return "";
  const text = files.map(([name, body]) => `### .hidden/${name}\n\n\`\`\`\n${body.trimEnd()}\n\`\`\``).join("\n\n");
  return `## The goal's checks\n\nThese test files are stored on the issue, not in the repo. The factory runs them after the repo's checks with \`${repo.hiddenRun}\`. To run them yourself, write each one at the path its heading gives and run that command. Never commit them: remove \`.hidden/\` before you end.\n\n${text}`;
}

/** The worker's brief: the fixed text, the spec, the goal's checks, every note in order, and the previous run's files. A merge run gets the merge brief. */
export function brief(id: string, folder: string, run: Run, repo: Repo): string {
  if (run.merge) {
    const land = (jobById(run.job) ?? []).filter((e) => e.run.kind === "land" && e.id !== id).at(-1)?.run;
    const n = onOf(run);
    return mergeBrief(land ?? run, repo, run.repo && n !== undefined ? reader().item(run.repo, n)?.title : undefined);
  }
  const parts = [(repo.sandbox ? FACTORY(run, repo.main, repo.checks ?? []) : FIXED(run, repo.main)), `## Spec\n\n${jobSpec(folder, run)}`];
  const goal = goalChecks(repo, run);
  if (goal) parts.push(goal);
  const runs = jobById(run.job) ?? [];
  if (runs.length) for (const n of notes(runs)) parts.push(`## Note ${n.name}\n\n${n.text.trim()}`);
  const prev = runs[runs.findIndex((e) => e.id === id) - 1];
  if (prev) {
    const p = prev.run;
    parts.push(`## Previous run: ${p.kind}, ${p.condition}${needsOf(askOf(p)) ? ` (${needsOf(askOf(p))})` : ""}${p.reason ? `: ${p.reason}` : ""}`);
    for (const f of ["result.md", "checks.log", "land.log"] as const) {
      const text = readFile(prev, f);
      if (text !== undefined) parts.push(`### ${f}\n\n${text.trim()}`);
    }
  }
  return parts.join("\n\n") + "\n";
}

/**
 * The spec of a goal's next job: the title, the spec, the reasons of the earlier drops (newest first), the notes on
 * the issue, and the rerun note when a rescue or the firefighter left one. `rerun` says a rerun note went in:
 * the factory clears it once the run starts.
 */
export function goalBrief(item: { title: string; spec: string; notes: string[] }, name: string, jobs: Job[]): { spec: string; rerun: boolean } {
  const again = rerunNote(name);
  const drops = jobsNamed(name, null, jobs).filter((j) => j.at(-1)!.run.condition === "dropped" && j.at(-1)!.run.reason).map((j) => `- ${j.at(-1)!.run.reason}`).reverse();
  const spec = `# ${item.title}\n\n${item.spec.trim()}\n${drops.length ? `\n## Reasons of the earlier drops, newest first\n\n${drops.join("\n")}\n` : ""}${item.notes.length ? `\n## Notes on the issue\n\n${item.notes.join("\n")}\n` : ""}${again ? `\n## Note on the last run\n\n${again}\n` : ""}`;
  return { spec, rerun: !!again };
}

// ---------------------------------------------------------------------------
// The rerun note: what the goal's next run reads, under "Note on the last run"

const rerunFile = (name: string) => join(factoryDir(), "rerun", `${name}.md`);
export function writeRerun(name: string, note: string): void {
  mkdirSync(dirname(rerunFile(name)), { recursive: true });
  writeFileSync(rerunFile(name), note + "\n");
}
const rerunNote = (name: string): string => (existsSync(rerunFile(name)) ? readFileSync(rerunFile(name), "utf8").trim() : "");
export const clearRerun = (name: string): void => rmSync(rerunFile(name), { force: true });

// ---------------------------------------------------------------------------
// What the unit starts after a run ends

const BOUNCES = 2;
/** The most times a job's land lands again after main moved; a land retries its own push this many times too. */
export const RELANDS = 3;
/**
 * The list file a branch must not change: only `aleph issue` writes the list. The lists left product repos for
 * the work store; a branch made before that still has the old file, and landing it would bring the file back.
 */
export const TODO_PATH = "docs/todo.md";

/** The model of a merge run: the cheapest tier the factory routes a worker to. */
export const MERGE_MODEL = "haiku";
/** The time limit of a merge run, in seconds. */
export const MERGE_SECONDS = 600;

/**
 * What the unit starts after a run ends. A land follows afterLand; an agent run
 * lands when it passes, when it was started with --land or its repo lands by itself.
 * `lands` is the job's land runs, read from the ledger when absent.
 */
export function nextStep(run: Run, autoland: boolean, lands?: Run[]): Run["next"] {
  if (isBuild(run.kind) && run.failed) return "worker";
  if (isAgentRun(run.kind)) return run.condition === "passed" && (run.land || autoland) ? "land" : undefined;
  return run.kind === "land" ? afterLand(run, lands) : undefined;
}

/**
 * What the unit starts after a failed land. A land that conflicts, or that
 * refuses a branch that changes the list, goes back to the worker, at most
 * BOUNCES times a job; a land that lost a race lands again, at most RELANDS times.
 * `lands` is the job's land runs, this one included, read from the ledger when absent.
 */
export function afterLand(run: Run, lands?: Run[]): Run["next"] {
  if (run.condition !== "failed") return undefined;
  const all = lands ?? (jobById(run.job) ?? []).filter((e) => e.run.kind === "land").map((e) => e.run);
  if (run.conflicts?.length) return all.filter((r) => r.conflicts?.length).length <= BOUNCES ? "worker" : undefined;
  if (causeOf(run) === "moved") return all.filter((r) => causeOf(r) === "moved").length <= RELANDS ? "land" : undefined;
  return undefined;
}

/** Whether the next run is a merge run: a conflict bounce, not an `own-list` one. */
export const isMergeBounce = (land: Run): boolean => causeOf(land) !== "own-list" && !!land.conflicts?.length;

/** What the worker reads when a land sent the job back. */
export function bounceNote(run: Run): string {
  return causeOf(run) === "own-list"
    ? `The land refused this branch because it changes ${TODO_PATH}. Only aleph issue writes the list. The lists live in the work store now. Remove ${TODO_PATH} from the branch, commit, and make each change to the list with aleph issue.`
    : `The land conflicted with origin/main in: ${(run.conflicts ?? []).join(", ")}. Merge origin/main into this branch, resolve each conflict so that the change on main and this job's change both survive, run the tests, and commit.`;
}

/**
 * The whole brief of a merge run: the conflicted paths, the last commit on main that touched each,
 * and the goal's title when the store has one. No spec text, no notes.
 */
function mergeBrief(land: Run, repo: Repo, title?: string): string {
  const main = `origin/${repo.main}`;
  const paths = (land.conflicts ?? []).map((p) => {
    const last = git(repo.path, "log", "-1", "--format=%h %s", main, "--", p).out.trim();
    return `- ${p}${last ? ` (last commit on ${main}: ${last})` : ""}`;
  });
  return [
    `# Merge ${main} into this branch`,
    ...(title ? [`Goal: ${title}`] : []),
    `A land of this branch conflicted with ${main}. This run does one task and nothing else: merge ${main} into the branch, resolve the conflicts so that the change on main and this job's change both survive, and commit. Do not start other work.`,
    `Conflicted paths:\n${paths.join("\n")}`,
  ].join("\n\n") + "\n";
}

/**
 * What the next worker gets when the run in `folder` sends the job back: the note it reads as its spec,
 * and whether it is a merge run. A failed check, the hidden check and the reviewer each have their note;
 * a land that bounced has bounceNote.
 */
export function nextBrief(folder: string, run: Run): { note: string; merge: boolean } {
  const note = run.failed === "hidden"
    ? hiddenNote(folder, run)
    : run.failed === "review"
    ? `The reviewer sent this branch back: ${run.reason}\n\nFix what it names, run the tests, and commit.`
    : run.failed
    ? `The check \`${run.failed}\` failed on this branch. The last 80 lines of its log:\n\n${checkLog(folder, run.failed)}\n\nFix the cause, run the tests, and commit.`
    : bounceNote(run);
  return { note, merge: !run.failed && isMergeBounce(run) };
}

/** The last 80 lines of the named check's section of the run's checks.log. */
function checkLog(folder: string, name: string): string {
  const file = runFile(folder, "checks.log");
  if (!existsSync(file)) return "";
  const section = readFileSync(file, "utf8").split(/^## /m).findLast((x) => x.startsWith(`${name}: exit`)) ?? "";
  return section.split("\n").slice(1).join("\n").trimEnd().split("\n").slice(-80).join("\n");
}

/** The failing tests of a run's hidden.log, each with the lines of its failure that precede its `(fail)` line. */
function hiddenFailures(folder: string): { name: string; failure: string }[] {
  const file = runFile(folder, "hidden.log");
  const lines = (existsSync(file) ? readFileSync(file, "utf8") : "").split("\n");
  const seen = new Map<string, string>();
  let block: string[] = [];
  for (const line of lines) {
    const m = line.match(/^\(fail\) (.*?)(?: \[[\d.]+m?s\])?$/);
    if (m) {
      if (!seen.has(m[1])) seen.set(m[1], block.slice(-10).join("\n").slice(-600));
      block = [];
    } else if (/^\(pass\)/.test(line)) block = [];
    else if (line.trim()) block.push(line.trimEnd());
  }
  return [...seen].map(([name, failure]) => ({ name, failure }));
}

/**
 * The fix-round note for a failed hidden check: the reason and the names of
 * the failing tests, read from hidden.log. The tests' source is in the brief.
 */
function hiddenNote(folder: string, run: Run): string {
  const names = hiddenFailures(folder).map((f) => f.name);
  return `${run.reason}\n${names.length ? `\nThe failing tests:\n${names.map((n) => `- ${n}`).join("\n")}\n` : ""}\nThe tests are under "The goal's checks" in this brief. Run them, fix the cause, and commit.`;
}

// ---------------------------------------------------------------------------
// Fix rounds: the runs before, and the hidden failures they share. The rule itself is in worker-verdict.ts.

/** The job's fix rounds before run `id`: its other build runs that a check or the reviewer sent back. */
export const earlierRounds = (job: Job, id: string): Entry[] => job.filter((e) => e.id !== id && isBuild(e.run.kind) && e.run.failed);

/**
 * A goal's check that fails unchanged twice: the run before this one also failed the hidden check with the same
 * failing names. A third fix round would likely fail again, so the Ask names the tests and quotes their failures,
 * and Chris tells a wrong test from a wrong branch. Null when the failures differ or there is no run before.
 */
export function repeatedHidden(folder: string, earlier: { id: string; run: Run }[]): { question: string; names: string[] } | null {
  const prev = earlier.at(-1);
  if (!prev || prev.run.failed !== "hidden") return null;
  const now = hiddenFailures(folder);
  const before = hiddenFailures(join(runsDir(), prev.id)).map((f) => f.name).sort();
  const names = now.map((f) => f.name).sort();
  if (!names.length || names.join("\n") !== before.join("\n")) return null;
  const quoted = now.slice(0, 5).map((f) => `- ${f.name}${f.failure ? `\n${f.failure.split("\n").map((l) => `    ${l}`).join("\n")}` : ""}`).join("\n");
  return {
    names,
    question: `The goal's test${names.length > 1 ? "s" : ""} on the issue failed the same way on two runs in a row, so no third fix round starts. The failing test${names.length > 1 ? "s" : ""} and the failure:\n${quoted}\nIs the test wrong, or the branch? Answer to send the worker back with your reading, or drop the run.`,
  };
}

/** The worker's question: the text of its last `QUESTION:` line, or undefined when it has none. */
export const questionOf = (result: string): string | undefined => lastTagged(result, "QUESTION");

// ---------------------------------------------------------------------------
// The rescue of a stuck or failed run: which case it is, and the step

/** The case of the safe default action taken on the run, or "" when none was. */
export const rescued = (e: Entry): string => tailOf(e, "rescued", 1);
export const markRescued = (e: Entry, key: string): void => writeFileSync(runFile(e.folder, "rescued"), key + "\n");

/**
 * The question of a run that ended with no commit and asked about the spec, or null when it did not ask.
 * The text is the run's own question, else its last `QUESTION:` line; it may be empty. A rerun reads the
 * same spec and asks again, so such a run waits for a spec edit.
 */
export function askedQuestion(r: Run, result: string): string | null {
  if (causeOf(r) !== "no-commit") return null;
  const q = questionOf(result);
  if (!r.question && q === undefined) return null;
  return r.question || q || "";
}

export type RescueCase = "duplicate" | "no-commit" | "claimed" | "time-box" | "infra" | "land-checks" | "land-conflict";

/** Which safe case a stuck or failed run is in, or null: not safe. `claim` is the worker's "already met" reason, if it made one. */
export function rescueCase(r: Run, onMainOrDone: boolean, claim: string | null): RescueCase | null {
  const cause = causeOf(r);
  if (cause === "no-commit") return onMainOrDone ? "duplicate" : claim !== null ? "claimed" : "no-commit";
  if (cause === "time-box" && r.kind !== "land") return "time-box";
  if (cause === "infra" || cause === "lock-busy") return "infra";
  if (r.kind === "land" && cause === "conflict") return "land-conflict";
  if (r.kind === "land" && !r.conflicts?.length && cause === "check") return "land-checks";
  return null;
}

/** One action on a run. `rerun` is the rerun note; `dropReason` is the drop's text, when it is not `noted`; `told` is the news, when it is not `noted`. */
export type Step = { action: "drop" | "land again" | "recheck"; rerun?: string; dropReason?: string; noted: string; told?: string; done?: boolean; fate?: Fate };

/** The run a rescue acts on: its entry, its repo, its job name, and why it stopped. */
export type Stuck = { last: Entry; r: Run; repo: Repo; reason: string };

/** The step for a run that a host restart killed. `hasWork`: its branch has commits ahead of main. The goal did not cause this: no rescue mark, so the goal keeps its rerun. */
export function killedStep({ last, r }: Stuck, hasWork: boolean): Step {
  const text = `a host restart killed ${r.kind} run ${last.id}`;
  // The branch passed, and the land may have pushed: a new land finds that, and a new goal run would do the work twice.
  if (r.kind === "land") return { action: "land again", noted: `${text}: landed again`, told: `${text}: landing again` };
  // A build or recheck with commits ahead of main has finished work: a recheck of its branch keeps it, and no new run is started.
  if (isAgentRun(r.kind) && hasWork) return { action: "recheck", noted: `${text}: rechecked, its branch has the worker's commits`, told: `${text}: rechecking its branch` };
  return { action: "drop", dropReason: `${text}. The goal did not cause this. Run the goal again from the start.`, noted: `${text}: dropped, and the goal starts again`, told: `${text}: the goal starts again` };
}

/** The step for a worker's claim that the goal is met, by `red`, the red line of main. */
export function claimStep({ last, r, repo }: Stuck, claim: string | null, red: string | null): Step {
  const said = `${r.kind} run ${last.id} says the goal is already met (${claim})`;
  if (!red) return { action: "drop", noted: `${said}, and the checks pass on origin/${repo.main}: dropped, and the item is done`, done: true, fate: "already-met" };
  return {
    action: "drop",
    rerun: `The last run said the goal is already met (${claim}), but the checks do not pass on origin/${repo.main} (${red}). Make the change the goal asks for.`,
    noted: `${said}, but ${red}; dropped, and the goal reruns once`,
  };
}

/** The step for a run that ended with no commit while the item is already on main (`onMain`) or done. */
export function duplicateStep({ last, r }: Stuck, onMain: string | null | undefined): Step {
  return { action: "drop", noted: `${r.kind} run ${last.id} ended with no commit and the item is already ${onMain ? `on main as ${onMain}` : "done"}: dropped as a duplicate, and the item is closed`, done: !!onMain, fate: "already-met" };
}

/** The step for an infrastructure failure: a land lands again, a run with a branch (`hasBranch`) is rechecked, and any other run reruns. */
export function infraStep({ last, r, reason }: Stuck, hasBranch: boolean): Step {
  const text = `${r.kind} run ${last.id} failed for infrastructure (${reason}): `;
  if (r.kind === "land") return { action: "land again", noted: `${text}landed again, once`, told: `${text}landing again` };
  if (hasBranch) return { action: "recheck", noted: `${text}rechecked, once`, told: `${text}rechecking` };
  return { action: "drop", rerun: `The last run failed before it made a branch: ${reason}.`, dropReason: `${text}dropped for one rerun`, noted: `${text}dropped; the goal reruns once`, told: `${text}the goal reruns` };
}

/** The step for a land that hit a merge conflict. `touched` is the last commit on main that changed the files. */
export function conflictStep({ last, r, repo }: Stuck, touched: string): Step {
  const files = r.conflicts ?? [];
  const what = `${files.join(", ") || "unknown files"}${touched ? `, last changed on ${repo.main} by ${touched}` : ""}`;
  return {
    action: "drop",
    rerun: `The last land failed with a merge conflict in ${what}. Another goal landed on the same lines first; this run starts from the current ${repo.main}.`,
    noted: `${r.kind} run ${last.id}: merge conflict in ${what}; dropped, and the goal reruns once from current ${repo.main}`,
  };
}

/** The step for a run that stopped with nothing to keep. The note quotes the end of its log. */
export function rerunStep({ last, r, reason }: Stuck, key: "no-commit" | "land-checks"): Step {
  const why = key === "no-commit" ? "the last run made no commit" : `the checks failed after the land merged main (${reason})`;
  const file = key === "land-checks" ? "checks.log" : "result.md";
  return {
    action: "drop",
    rerun: `${why[0].toUpperCase()}${why.slice(1)}. The last 20 lines of its ${file}:\n\n\`\`\`\n${tailOf(last, file, 20) || "(empty)"}\n\`\`\``,
    noted: `${r.kind} run ${last.id}: ${why}; dropped, and the goal reruns once`,
  };
}
