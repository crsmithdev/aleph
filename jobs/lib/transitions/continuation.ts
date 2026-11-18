/**
 * Job continuation: what follows a run that ended, and the brief the next run reads.
 * This module decides and writes the brief; the unit, the land and the rescue start
 * the runs and write the store. The deciders take ledger data and do no IO when given
 * it: nextStep, afterLand and askedQuestion. The briefs and notes read the run folders.
 *
 * It owns two markers: the rerun note, a `reran` event on the issue that its next `started` event clears, and `rescued` on a job row, which counts a rescue case against
 * the issue. The Ask markers (`asked`, `asked-spec`) stay in ask.ts.
 */
import { skillSection } from "../roles/role-skill.ts";
import { reader, runMedia } from "../../../lib/store.ts";
import { needsOf } from "../asks/ask.ts";
import { git } from "../../../lib/git.ts";
import { jobsNamed, notes, readFile, type Job } from "../records/job.ts";
import { jobOfRun } from "../records/record.ts";
import { runsBunTest } from "../gates/checks.ts";
import { isAgentRun, isBuild, lastTagged, onOf, TAG_FORMAT, type Check, type Entry, type FailedTest, type Repo, type Run } from "../records/ledger.ts";
import { causeOf } from "../records/outcome.ts";
import * as record from "../records/record.ts";
import { jobOfFolder, jobSpec, readSection } from "../records/run-files.ts";
import { eventsOf, logEvent } from "../../../lib/layout.ts";

// The worker brief

// A worker that backgrounds a command and ends its turn is never woken again in a headless run.
export const FOREGROUND = "Run every command in the foreground and wait for it: nothing wakes you after your turn ends.";

// The parsers read a tag on any line; this order keeps the worker's final text readable.
const ENDING = "After the summary come your tag lines, and the `QUESTION:` line, when you have one, is the last line.";


const FIXED = (run: Run) => `You are a worker on job \`${run.name}\` in \`${run.worktree}\`, branch \`${run.branch}\`. Work
only there. Commit every change on the branch; the run fails if anything is
left uncommitted or untracked. Never merge, never push, never touch another
branch. \`aleph issue\` is not your push: it writes the list of issues on main by
itself, so use it for every change to the list. If you need a decision from Chris, stop
and print a line \`QUESTION: <one question>\`. ${TAG_FORMAT} ${FOREGROUND} End with a
summary of what you did and what you ran: at most 120 words of prose, plus a list only for separate items.
${ENDING}`;

// The gate runs the related test files, and a timer runs the full suite, so a worker that runs it only repeats the timer.
const RELATED_ONLY = "run only the test files your change reaches, by path (`bun test ./path/to/x.test.ts`), and never the whole suite: the factory's gate runs the related tests and the full suite runs on a timer";

/** What the worker runs before it ends: the repo's own checks, else today's sentence. */
function checksSentence(checks: Check[]): string {
  if (!checks.length) return "Run the repo's tests before you end.";
  const list = checks.map((c) => `\n- \`${c.name}\`: ${runsBunTest(c.run) ? RELATED_ONLY : `\`${c.run}\``}${c.when?.length ? ` (when ${c.when.join(", ")} change)` : ""}`).join("");
  return `Run each of the repo's checks before you end, and fix what fails:${list}\n`;
}

const FACTORY = (run: Run, main: string, checks: Check[] = []) => `You are a worker on job \`${run.name}\` in \`${run.worktree}\`, branch \`${run.branch}\`.
Work only there. Do the issue below. Commit every change on this branch: only its commits count.
Never merge, never push, never touch another branch.

Nobody answers questions during the run. Your reply ends with structured output; each
fact you report is one of its fields. For a choice the Oracle does not settle, take the
answer you would recommend and add it to \`defaults\`. If you cannot meet a clause of the
Oracle, stop and set \`question\` to a question that names the clause; else \`question\` is
null. Never defer that clause with \`defaults\` or \`followups\`. For work you find but do not do, add a follow-up to \`followups\`; it must not
cover anything the Oracle names. Add at most 3 per run, and only a bug, a doc that misleads, or a check that misses: never taste or a cosmetic item.
Hold each to the evidence bar of skills/code-review: it is real, and you proved it by a run or by the code you read. Give its title, its \`path:line\`,
what you saw, why it matters, and its impact, risk and effort, each an integer from 1 to 5.
A test that is not the issue's own, fails or times out, and passes alone or on a rerun is
a flake: add it to \`flakes\` and not to \`followups\`.
Check such a failure once, by running its file alone, then go on: do not run the full
suite again to get a clean run, because the factory's checks rerun a failed check.
Each new test must fail without your change and check something the other tests of its
file do not: a changed line they do not cover, or a result they do not assert. The
factory's checks reject any other new test. So do not add a test for a helper that the
existing tests already reach through its callers.
For each new test, show it fail first: revert the non-test change, run the test, see it
fail, restore the change, and paste the failing line into \`summary\`. Where no failing
test is possible (a refactor, a moved test, a test-only change), say so in one line in
\`summary\` instead.

If the issue already holds and no edit is needed, make no commit, run the test files the issue names or reaches,
and set \`already_met.evidence\` to the files, lines and commit on \`${main}\` that show it;
else \`already_met\` is null. If you cannot do the issue, make no commit and give the reason
in \`summary\`.

${checksSentence(checks)} Chrome is at \`/usr/bin/google-chrome\`. The tests that start Chrome run only with \`ALEPH_BROWSER_TESTS=1\` (\`bun run test:all\` sets it); a plain \`bun test\` skips them, and the factory's checks set it. For a screenshot of a page that
your own server serves on \`http://127.0.0.1:<port>\`, run \`google-chrome --headless=new --password-store=basic --window-size=1440,900 --screenshot=<out.png> <url>\`
with a path inside the repo, and commit the PNG.
To install or link a systemd unit, link it from the repo's main checkout path (for aleph, \`~/aleph/jobs/systemd/...\`), never from the worktree.
For each code change, follow the write-code method at the end of this brief. ${FOREGROUND}
End with a summary of what you did and what you ran in \`summary\`, each thing said once:
at most 120 words of prose, plus a list only for separate items.`;


/** The text that has an agent search past factory work for `title` before it plans: the worker brief and the intake prompt. */
export const pastWork = (title: string): string =>
  `Before you plan, run \`aleph memory recall --episodes '${title.replace(/'/g, "'\\''")}'\` as it stands, with no pipe. It lists the pages of earlier factory work that match. Read each page about the same issue or files, and do not repeat an approach that failed there.`;
/** The worker's brief: the fixed text, the spec, every note in order, and the previous run's files. A merge run gets the merge brief. */
export function brief(id: string, run: Run, repo: Repo): string {
  if (run.merge) {
    const land = jobOfRun(run.job).filter((e) => e.run.role === "land" && e.id !== id).at(-1)?.run;
    const n = onOf(run);
    return mergeBrief(land ?? run, repo, run.repo && n !== undefined ? reader().item(run.repo, n)?.title : undefined);
  }
  const spec = jobSpec(run);
  const parts = [(repo.sandbox ? FACTORY(run, repo.main, repo.checks ?? []) : FIXED(run)), `## Spec\n\n${spec}`];
  // An issue's spec opens with `# <title>` (issueBrief).
  const title = /^# (.+)$/m.exec(spec)?.[1].trim();
  if (title) parts.push(`## Past work\n\n${pastWork(title)}`);
  const n = onOf(run);
  const media = run.repo && n !== undefined ? runMedia(run.repo, n) : [];
  if (media.length) parts.push(`## Media\n\nChris attached these files to the issue: screenshots, mockups or documents. Read each one with Read before you start, and make the change match what they show.\n\n${media.map((f) => `- ${f}`).join("\n")}`);
  const runs = jobOfRun(run.job);
  if (runs.length) for (const n of notes(runs)) parts.push(`## Note ${n.name}\n\n${n.text.trim()}`);
  const prev = runs[runs.findIndex((e) => e.id === id) - 1];
  if (prev) {
    const p = prev.run;
    parts.push(`## Previous run: ${p.role}, ${p.state}${needsOf(p.ask) ? ` (${needsOf(p.ask)})` : ""}${p.reason ? `: ${p.reason}` : ""}`);
    for (const f of ["result.md", "checks", "land"] as const) {
      const text = readFile(prev, f);
      if (text !== undefined) parts.push(`### ${f}\n\n${text.trim()}`);
    }
  }
  if (repo.sandbox) parts.push(skillSection("write-code", "Code-change method"));
  return parts.join("\n\n") + "\n";
}

/**
 * The spec of an issue's next job: the title, the spec, the reasons of the earlier drops (newest first), the notes on
 * the issue, and the rerun note when a rescue or the director left one. `rerun` says a rerun
 * note went in: the factory clears it once the run starts.
 */
export function issueBrief(item: { title: string; spec: string; notes: string[] }, name: string, jobs: Job[]): { spec: string; rerun: boolean } {
  const again = rerunNote(name);
  const drops = jobsNamed(name, null, jobs).filter((j) => j.at(-1)!.run.state === "dropped" && j.at(-1)!.run.reason).map((j) => `- ${j.at(-1)!.run.reason}`).reverse();
  const spec = `# ${item.title}\n\n${item.spec.trim()}\n${drops.length ? `\n## Reasons of the earlier drops, newest first\n\n${drops.join("\n")}\n` : ""}${item.notes.length ? `\n## Notes on the issue\n\n${item.notes.join("\n")}\n` : ""}${again ? `\n## Note on the last run\n\n${again}\n` : ""}`;
  return { spec, rerun: !!again };
}

// The rerun note: what the issue's next run reads, under "Note on the last run"

/** Leave the note on the issue: a `reran` event with the note as its detail. */
export function writeRerun(name: string, note: string): void {
  logEvent({ subject: "rule", action: "reran", object: name, detail: note });
}
/** The issue's rerun note: its newest `reran` event, unless a `started` event came after it. */
const rerunNote = (name: string): string => {
  const e = eventsOf(name, "reran", "started").findLast((x) => x.subject === "rule");
  return e?.action === "reran" ? (e.detail ?? "").trim() : "";
};

/** Take the note back: an empty `reran` event. */
export const clearRerun = (name: string): void => { if (rerunNote(name)) writeRerun(name, ""); };

// What the unit starts after a run ends

const BOUNCES = 2;
/** The most times a job's land lands again after main moved; a land retries its own push this many times too. */
export const RELANDS = 3;
/**
 * The list file a branch must not change: only `aleph issue` writes the list. The lists left product repos for
 * the work store; a branch made before that still has the old file, and landing it would bring the file back.
 */
export const TODO_PATH = "docs/todo.md";

/** The model of a merge run: the cheapest size the factory routes a worker to. */
export const MERGE_MODEL = "haiku";
/** The time limit of a merge run, in seconds. */
export const MERGE_SECONDS = 600;

/**
 * What the unit starts after a run ends. A land follows afterLand; an agent run
 * lands when it passes, when it was started with --land or its repo lands by itself.
 * `lands` is the job's land runs, read from the ledger when absent.
 */
export function nextStep(run: Run, autoland: boolean, lands?: Run[]): Run["next"] {
  if (isBuild(run.role) && run.failed) return run.failed === "doc-claims" ? "recheck" : "worker";
  if (isAgentRun(run.role)) return run.state === "passed" && (run.land || autoland) ? "land" : undefined;
  return run.role === "land" ? afterLand(run, lands) : undefined;
}

/**
 * What the unit starts after a failed land. A land that conflicts, or that
 * refuses a branch that changes the list, goes back to the worker, at most
 * BOUNCES times a job; a land that lost a race lands again, at most RELANDS times.
 * `lands` is the job's land runs, this one included, read from the ledger when absent.
 */
export function afterLand(run: Run, lands?: Run[]): Run["next"] {
  if (run.state !== "failed") return undefined;
  const all = lands ?? jobOfRun(run.job).filter((e) => e.run.role === "land").map((e) => e.run);
  if (run.conflicts?.length) return all.filter((r) => r.conflicts?.length).length <= BOUNCES ? "worker" : undefined;
  if (causeOf(run) === "moved") return all.filter((r) => causeOf(r) === "moved").length <= RELANDS ? "land" : undefined;
  return undefined;
}

/** A land that refused the branch because it changes TODO_PATH: its cause is `other` and its one conflict is TODO_PATH. */
const isOwnList = (land: Run): boolean => causeOf(land) === "other" && !!land.conflicts?.includes(TODO_PATH);

/** Whether the next run is a merge run: a conflict bounce, not an own-list one. */
export const isMergeBounce = (land: Run): boolean => !isOwnList(land) && !!land.conflicts?.length;

/** What the worker reads when a land sent the job back. */
export function bounceNote(run: Run): string {
  return isOwnList(run)
    ? `The land refused this branch because it changes ${TODO_PATH}. Only aleph issue writes the list. The lists live in the work store now. Remove ${TODO_PATH} from the branch, commit, and make each change to the list with aleph issue.`
    : `The land conflicted with origin/main in: ${(run.conflicts ?? []).join(", ")}. Merge origin/main into this branch, resolve each conflict so that the change on main and this job's change both survive, run the tests, and commit.`;
}

/**
 * The whole brief of a merge run: the conflicted paths, the last commit on main that touched each,
 * and the issue's title when the store has one. No spec text, no notes.
 */
function mergeBrief(land: Run, repo: Repo, title?: string): string {
  const main = `origin/${repo.main}`;
  const paths = (land.conflicts ?? []).map((p) => {
    const log = git(repo.path, "log", "-1", "--format=%h %s", main, "--", p);
    const last = log.ok ? log.out.trim() : "";
    return `- ${p}${last ? ` (last commit on ${main}: ${last})` : ""}`;
  });
  return [
    `# Merge ${main} into this branch`,
    ...(title ? [`Issue title: ${title}`] : []),
    `A land of this branch conflicted with ${main}. Merge ${main} into the branch, resolve the conflicts so that the change on main and this job's change both survive, and commit. Where a commit from ${main} that you merge moves or renames what this job's change cites or depends on, update this job's change to match. Your final message names each such update. Do not start other work.`,
    `Conflicted paths:\n${paths.join("\n")}`,
  ].join("\n\n") + "\n";
}

/**
 * What the next worker gets when the run in `folder` sends the job back: the note it reads as its spec,
 * and whether it is a merge run. A failed check and the reviewer each have their note;
 * a land that bounced has bounceNote.
 */
export function nextBrief(folder: string, run: Run): { note: string; merge: boolean } {
  const note = run.failed === "review"
    ? `The reviewer sent this branch back: ${run.reason}\n\nFix what it names, run the tests, and commit.`
    : run.failed
    ? `The check \`${run.failed}\` failed on this branch. ${failedTests(run, run.failed).length ? `Its failed tests:\n\n${quoteFailures(failedTests(run, run.failed))}` : `The last 80 lines of its log:\n\n${checkLog(folder, run.failed)}`}\n\nFix the cause, run the tests, and commit.`
    : bounceNote(run);
  return { note, merge: !run.failed && isMergeBounce(run) };
}

/** The named check's last block of the run's checks section, without its heading line. */
function checkSection(folder: string, name: string): string {
  const section = (readSection(folder, "checks") ?? "").split(/^## /m).findLast((x) => x.startsWith(`${name}: exit`)) ?? "";
  return section.split("\n").slice(1).join("\n").trimEnd();
}

const checkLog = (folder: string, name: string): string => checkSection(folder, name).split("\n").slice(-80).join("\n");

/** The failed tests in the run's record of the named check: empty when the check ran no `bun test` or no test failed. */
const failedTests = (run: Run | null, check: string): FailedTest[] => run?.checks?.findLast((c) => c.name === check)?.tests?.failures ?? [];

/** Each failed test as `- file > name` and its failure, indented. */
const quoteFailures = (failures: FailedTest[]): string =>
  failures.map((f) => `- ${f.file} > ${f.name}${f.message ? `\n${f.message.split("\n").map((l) => (l ? `    ${l}` : "")).join("\n")}` : ""}`).join("\n");

// Fix rounds: the runs before, and the failures they share. The rule itself is in worker-verdict.ts.

/** The job's fix rounds before run `id`: its other build runs that a check or the reviewer sent back. */
export const earlierRounds = (job: Job, id: string): Entry[] => job.filter((e) => e.id !== id && record.sentBack(e.run));

/**
 * A check that fails unchanged twice: the run before this one also failed `check` with the same failing test
 * names. A third fix round would likely fail again, so the Ask names the tests and quotes their failures,
 * and Chris tells a wrong test from a wrong branch. Null when the failures differ, the check's record names no
 * failed test, or there is no run before.
 */
export function repeatedFailure(folder: string, check: string, earlier: { id: string; run: Run }[]): { question: string; names: string[] } | null {
  const prev = earlier.at(-1);
  if (!prev || prev.run.failed !== check) return null;
  const now = failedTests(record.getRun(jobOfFolder(folder)), check);
  const key = (f: FailedTest) => `${f.file} > ${f.name}`;
  const before = failedTests(prev.run, check).map(key).sort();
  const names = now.map(key).sort();
  if (!names.length || names.join("\n") !== before.join("\n")) return null;
  const quoted = quoteFailures(now.slice(0, 5));
  return {
    names,
    question: `The check \`${check}\` failed the same way on two runs in a row, so no third fix round starts. The failing test${names.length > 1 ? "s" : ""} and the failure:\n${quoted}\nIs the test wrong, or the branch? Answer to send the worker back with your reading, or drop the run.`,
  };
}

/** The worker's question: the text of its last `QUESTION:` line, or undefined when it has none. */
export const questionOf = (result: string): string | undefined => lastTagged(result, "QUESTION");

// The rescue of a returned or failed run: which case it is, and the step

/** The case of the safe default action taken on the run, or "" when none was. */
export const rescued = (e: Entry): string => e.run.rescued ?? "";
export const markRescued = (e: Entry, key: string): void => void record.patchRun(e.id, { rescued: key });

/**
 * The question of a run that ended with no commit and asked about the spec, or null when it did not ask: the
 * worker's `question` field, kept on the run. A rerun reads the same spec and asks again, so such a run waits for a spec edit.
 */
export function askedQuestion(r: Run): string | null {
  if (causeOf(r) !== "no-commit" || !r.question) return null;
  return r.question;
}
