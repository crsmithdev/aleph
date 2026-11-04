/**
 * The spec check: before a goal's first worker run, one read-only `claude -p` run reads the whole
 * spec (Goal, Edit surface, Oracle) against a clone of `origin/<main>` and says whether the spec
 * can be met. It holds only on a problem that blocks the work, and names each with a change to the spec; it passes
 * with every other problem as a note, which the worker reads (`passNotes`). A goal is held at most once: after a hold,
 * the next check passes, with its problems as notes. The check runs once for each
 * version of the spec (goal-spec.ts): the issue's note carries the version, so an edit makes it run again.
 * With `"author": true`, the run first seals the version's acceptance scenarios (author.ts), and the check
 * judges them too: a scenario that does not follow from the Goal or cannot hold with the Oracle is set aside,
 * which removes it from the sealed file; it never holds the goal.
 * The dispatch never runs it inline: it reads the recorded verdict (`recordedVerdict`) and, when there is
 * none, starts `aleph spec-check` detached (`runSpecCheck`), which ends by starting a dispatch.
 */
import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { note, readHidden, reader, writeHidden } from "../../todo/lib/store.ts";
import * as issues from "../../todo/lib/todo.ts";
import { section } from "../../todo/lib/todo.ts";
import { callAgent } from "./agent-run.ts";
import { withMainClone } from "./main-clone.ts";
import { isVersion, specVersion } from "./goal-spec.ts";
import { lastTagged, lock, tagged, TAG_FORMAT, type Repo } from "./ledger.ts";
import { SCENARIOS, scenarioCount, seal, withoutScenarios } from "./author.ts";
import { askChris, plainAsk } from "./ask.ts";
import { factoryDir, issueJob, recordHold, recordSpecCost } from "./factory-status.ts";
import { factoryLog } from "./layout.ts";
import { dispatchDetached } from "./launch.ts";
import { OPUS_MODEL } from "./agent-call.ts";

export const SPEC_CHECK_MODEL = OPUS_MODEL;
const NOTE = "spec check:";

/**
 * The sealed scenarios go in the prompt with a fourth question; with none, the check asks three.
 * `held`: the goal was held once already, so this check may only pass, with notes.
 */
export function specCheckPrompt(item: issues.Issue, scenarios = "", held = false): string {
  const part = (name: string) => section(item.spec, name) || "(none)";
  return `Check one spec before a builder starts on it. The code of the codebase is your working directory; read it with your tools.

Read the spec as the builder who will build it alone: nobody answers questions during the run. For a choice the spec does not settle, the builder takes the answer it recommends and says so. So most problems are notes for the builder, not reasons to stop the goal.

## Method
1. Split the spec into clauses. One clause is one requirement: each sentence of the Goal and each Oracle item. Number every clause.
2. Check each clause against the code. For each file, function, command or behaviour the clause names, open it. Record each named thing as found, with \`file:line\`, or as absent, with the searches you ran.
3. Run the passes below over every clause.
4. Sort each problem into a block or a note, with the rule under "Block or note".

## Passes
- **Vague.** A word with no measure ("fast", "robust", "clean", "handles errors", "works well"), or a placeholder (\`TODO\`, \`???\`, \`<...>\`).
- **Under-specified.** A verb with no object or outcome ("improve the parser"), or a case the clause implies and does not settle: an empty input, an error path, a second caller.
- **Conflict.** Two clauses that cannot both be true in this codebase, or one clause the current code makes false in a way the spec does not ask to change.
- **One name, one thing.** The same concept under two names, or one name for two concepts.
- **Wrong about the code.** A clause that names a file, function, flag or behaviour that does not exist or does not behave as the clause says.
- **Out of reach.** An Oracle clause whose code lies outside the Edit surface.
- **Not observable.** An Oracle clause that no check can see. A check counts when it runs normally and an assertion observes the changed output, state or error. These do not count: a read of the source text, "does not throw", a snapshot alone, a mock or log call, and a manual look.
- **Bare bun test path.** An Oracle command bun test <path> whose path has no ./ prefix and whose file name has no .test or .spec: run by hand, bun reads it as a name filter that matches no test file, so it never passes (acceptance adds the ./ itself, but a worker or reader running the command as written does not). Name it and propose the ./ path.

## Block or note
A problem blocks the goal only when no builder could do the work as written:
- the Goal contradicts itself, or contradicts the issue's request;
- an Oracle clause names a command or test file that does not exist and cannot be made, or asks for something that nothing could observe;
- the work lies outside this repo.
Every other problem is a note: a vague word, an open choice, a scope edge, a false claim about the code, a clause outside the Edit surface. The builder reads the notes and settles each one with its own recommended answer.

## Evidence
- **A name is not evidence.** A function named like the behaviour may not do it: read it before you say the code agrees with a clause.
- **An absence must be earned.** Search for synonyms and callers, not only the spec's words, and record each search with its hit count.
- **Quote the clause exactly.** A paraphrase replaces the clause with your reading of it.

## Problems and rewrites
Each problem quotes its clause exactly and proposes replacement text. Write an Oracle rewrite as an observable rule in this form:
\`When <trigger or input>, <the subject> <does the observable thing>.\`
A rewrite names a test file or command that exists and the behaviour it observes. It never asks the builder to add a committed test: the factory refuses a new test that passes without the change, or that fails without it only because the code it calls does not exist yet. So a refactor or a move gets no new test, and the repo's existing tests and checks observe it. The builder decides whether a bug fix or new lasting behaviour earns a test.

# Spec: ${item.title}
${item.request.trim() ? `
## Request
What was asked, verbatim. The spec serves it.

${item.request.trim()}
` : ""}
## Goal
${part("Goal")}

## Edit surface
${part("Edit surface")}

## Oracle
${part("Oracle")}
${scenarios ? `
## Sealed scenarios
A separate author wrote these from the Goal alone; an evaluator checks each one on the finished work.

${scenarios.trim()}
` : ""}
Apply the method to every clause. Answer ${scenarios ? "four" : "three"} questions, each from the passes above:
1. Can every clause of the Goal and the Oracle be true at the same time in this codebase? Name each pair that cannot.
2. Does the Edit surface hold the code that each Oracle clause needs to change? Name each clause whose code is outside it.
3. Does the Oracle ask for something that no check or reviewer can observe? Name each such clause.
${scenarios ? `4. Does each sealed scenario follow from the Goal, and can it be true together with the Oracle? For each one that does not, write one line \`SET-ASIDE: scenario <n>: <why>\`. A set-aside scenario is removed; it is not a problem of the spec, so do not hold for it.
` : ""}${held ? "\nThis goal was held once already and its spec was edited. Do not hold it again: write every problem as a note.\n" : ""}
Write each problem as its quoted clause, then its rewrite. End the reply with one last line: \`VERDICT: pass\` when there is no problem; \`VERDICT: pass <notes>\` when there are notes only${held ? "" : "; \`VERDICT: hold <blocks>\` when one problem or more blocks the goal"}. The verdict line is the only part of the reply that the factory keeps, so write each problem on it in full: its quoted clause and its rewrite, separated by \`; \`. Never name a problem there by a number or a label.${held ? "" : " A hold line carries the blocks only; the notes are lost."} ${TAG_FORMAT}`;
}

/** The last `VERDICT:` line of a reply, or null when it has none. */
export function specVerdict(reply: string): { pass: true; notes?: string } | { pass: false; problems: string } | null {
  const rest = lastTagged(reply, "VERDICT");
  if (rest === undefined) return null;
  const pass = rest.match(/^pass\b[:\s]*(.*)$/i);
  if (pass) return pass[1].trim() ? { pass: true, notes: pass[1].trim() } : { pass: true };
  const hold = rest.match(/^hold\b[:\s]*(.*)$/i);
  return hold ? { pass: false, problems: hold[1].trim() } : null;
}

/** The scenario numbers and reasons of the `SET-ASIDE: scenario <n>: <why>` lines of a reply. */
export function specAsides(reply: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const line of tagged(reply, "SET-ASIDE")) {
    const m = line.match(/^scenario\s+(\d+)\b[:\s]*(.*)$/i);
    if (m && !out.has(Number(m[1]))) out.set(Number(m[1]), m[2].trim());
  }
  return out;
}

export async function checkSpec(repo: Repo, id: number | string): Promise<{ verdict: "pass" | "hold" | "skip" | "error"; problems?: string; cost?: number }> {
  const item = reader().item(repo.key, id);
  if (!item || !item.spec.trim()) return { verdict: "skip" };
  if (recordedVerdict(item)) return { verdict: "skip" };
  const version = specVersion(item);
  const ref = issues.refOf(item);
  const say = (text: string) => { note(repo, ref, `${NOTE} ${version} ${text}`); };
  let cost: number | undefined;
  try {
    const sealCost = repo.author ? await seal(repo, id) : undefined;
    let scenarios = "";
    if (repo.author) try { scenarios = readHidden(repo, `${repo.key}-${ref}`)[SCENARIOS] ?? ""; } catch {}
    if (!scenarioCount(scenarios)) scenarios = "";
    const held = heldBefore(item);
    const reply = await withMainClone(repo, "spec-check-", (dir) => callAgent({ role: "speccheck", who: "the spec check", model: SPEC_CHECK_MODEL, seconds: 900, flags: ["--tools", "Read", "Grep", "Glob"], cwd: dir }, specCheckPrompt(item, scenarios, held)));
    cost = sealCost === undefined && reply.cost === undefined ? undefined : (sealCost ?? 0) + (reply.cost ?? 0);
    const v = specVerdict(reply.text);
    if (!v) { say("error: the reply has no verdict line"); return { verdict: "error", cost }; }
    // A set-aside scenario leaves the sealed file; the others keep their numbers, so acceptance and the reviewer agree on them.
    const asides = [...specAsides(reply.text)].filter(([n]) => scenarios && new RegExp(`^\\s*${n}[.)]\\s+\\S`, "m").test(scenarios));
    if (asides.length) {
      writeHidden(repo, `${repo.key}-${ref}`, { [SCENARIOS]: withoutScenarios(scenarios, new Set(asides.map(([n]) => n))) });
      for (const [n, why] of asides) note(repo, ref, `sealed checks: ${version} the spec check set aside: scenario ${n}: ${why}`);
    }
    // A goal is held at most once: a second hold passes, and its problems go to the worker as notes.
    const notes = v.pass ? v.notes : held ? v.problems : undefined;
    if (v.pass || held) { say(notes ? `pass: ${notes}` : "pass"); return { verdict: "pass", cost }; }
    say(`hold: ${v.problems}`);
    return { verdict: "hold", problems: v.problems, cost };
  } catch (e: any) {
    say(`error: ${String(e?.message ?? e).replace(/\s+/g, " ").slice(0, 200)}`);
    return { verdict: "error", cost };
  }
}

/** The notes of the pass recorded for the goal's current spec version, or "" when it has none. */
export function passNotes(item: issues.Issue): string {
  const v = recordedVerdict(item);
  return v?.verdict === "pass" ? v.notes ?? "" : "";
}

/** Whether a spec check held this goal before, for any version of its spec. */
export const heldBefore = (item: issues.Issue): boolean => item.notes.some((n) => /^(- \d{4}-\d\d-\d\d \d\d:\d\d: )?spec check: \S+ hold\b/.test(n));

export type Recorded = { verdict: "pass"; notes?: string } | { verdict: "hold"; problems: string } | { verdict: "error"; why: string };

/** The verdict `checkSpec` noted for the goal's current spec version, the last one when there are several; null when this version has none. */
export function recordedVerdict(item: issues.Issue): Recorded | null {
  for (let i = item.notes.length - 1; i >= 0; i--) {
    const m = item.notes[i].replace(/^- \d{4}-\d\d-\d\d \d\d:\d\d: /, "").match(/^spec check: (\S+) (pass|hold|error)\b:?\s*(.*)$/s);
    if (!m || !isVersion(item, m[1])) continue;
    if (m[2] === "pass") return m[3].trim() ? { verdict: "pass", notes: m[3].trim() } : { verdict: "pass" };
    if (m[2] === "hold") return { verdict: "hold", problems: m[3].trim() };
    return { verdict: "error", why: m[3].trim() };
  }
  return null;
}

/** The goal's spec-check lock: its holder is the one process checking that goal. */
export const specCheckLock = (name: string, waitMs = 0) => lock(`spec-check-${name}`, waitMs);

/** A check started but not yet holding its lock counts as running for this long; a launch that never ran is retried after it. */
const LAUNCH_MS = 16 * 60_000;
const launchFile = (name: string) => join(factoryDir(), `spec-check-${name}.started`);

/** Marks that the dispatch started a check of `name`, so a dispatch before the process takes its lock starts no second one. */
export function markLaunched(name: string): void {
  mkdirSync(factoryDir(), { recursive: true });
  writeFileSync(launchFile(name), new Date().toISOString() + "\n");
}

/** Whether a check of goal `name` is running: its lock is held, or the dispatch started one in the last LAUNCH_MS. */
export async function specChecking(name: string): Promise<boolean> {
  const release = await specCheckLock(name);
  if (!release) return true;
  release();
  try { return Date.now() - statSync(launchFile(name)).mtimeMs < LAUNCH_MS; } catch { return false; }
}

/**
 * `aleph spec-check <repo>-<ref>`, the process the dispatch starts: under the goal's lock, check the spec once
 * for its version. A hold sets the `spec-check` Ask (the spec-check note is its only note) and records the hold; the cost goes into the day's spend.
 * It ends with a dispatch, so a passed goal starts at once.
 */
export async function runSpecCheck(repo: Repo, ref: number | string): Promise<{ verdict: string; problems?: string; cost?: number }> {
  const name = issueJob(repo, ref);
  const release = await specCheckLock(name);
  if (!release) return { verdict: "running" };
  let c: Awaited<ReturnType<typeof checkSpec>>;
  try {
    c = await checkSpec(repo, ref);
    if (c.cost !== undefined) recordSpecCost(name, c.cost);
    if (c.verdict === "hold") {
      const problems = c.problems ?? "";
      const bad = askChris(repo, ref, plainAsk("spec-check", problems), null);
      if (bad) factoryLog(`${name}: spec check held, but the Ask was not written: ${bad}`);
      recordHold(name, "not-ready", problems);
    }
    factoryLog(`${name}: spec check ${c.verdict}${c.problems ? `: ${c.problems}` : ""}`);
  } finally {
    rmSync(launchFile(name), { force: true });
    release();
  }
  dispatchDetached();
  return c;
}
