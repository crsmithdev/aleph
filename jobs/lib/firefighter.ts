/**
 * The firefighter: on each tick, code takes a snapshot of what needs watching (held, stuck and
 * failed runs, a goal that loops, a red main, `needs-chris` issues, runs whose process is gone),
 * and only when it has an event the last snapshot lacked does one read-only `claude -p` run
 * judge them. It returns typed actions; code checks each against the rules below and applies it
 * through the existing transitions and the work store, in order. Each run is a job in the
 * ledger, kind `firefighter`. See docs/specs/2026-10-26-seed-factory.md, "Firefighter".
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as todos from "../../todo/lib/todo.ts";
import * as store from "../../todo/lib/store.ts";
import * as issues from "../../todo/lib/issues.ts";
import { allRuns, isLost, jobsDir, loadRegistry, lock, readReview2, readRun, stamp, tell, updateRun, writeRun, type Entry, type Repo } from "./ledger.ts";
import { allJobs, isOpen, issue as issueOf, lastReal, markNeedsChris, openJob, readFile, type Job } from "./job.ts";
import { verdict as reviewVerdict } from "./gate.ts";
import { git } from "./git.ts";
import { factoryDir, factoryLog, factoryRepos, redBaselines, writeRerun } from "./factory.ts";
import { drop as dropJob, land as landJob, refusal } from "./transitions.ts";
import { readDecision } from "./decision.ts";
import { handed, logStanding, readStanding, standing } from "./standing.ts";

export const FIREFIGHTER_MODEL = "claude-opus-5-5";
/** The most actions one run may take; the rest are refused. */
export const MAX_ACTIONS = 10;
/** A goal with more than LOOP_RUNS agent runs started in LOOP_MS loops. */
const LOOP_RUNS = 3;
const LOOP_MS = 30 * 60_000;
const TIME_BOX_MS = () => Number(process.env.ALEPH_FIREFIGHTER_TIMEOUT ?? 900) * 1000;
const stateFile = () => join(factoryDir(), "firefighter.json");

/** Paths a firefighter never lands: a diff that touches one goes to Chris. */
export const SECURITY_PATHS = ["hooks/", "jobs/lib/sandbox.ts", "jobs/lib/gate.ts", "jobs/lib/review2-browser.ts"];

export type EventKind = "needs-you" | "stuck" | "failed" | "loop" | "red" | "needs-chris" | "lost";
/**
 * One thing the snapshot found. `key` is what makes it new: it changes when the thing does.
 * `reason` is the reason code it waits for; `handed` marks one whose reason Chris handed to the firefighter (standing.json).
 */
export interface Event { key: string; kind: EventKind; repo: string; job?: string; item?: number; line: string; reason?: string; handed?: boolean }

/** Marks an event whose reason Chris handed to the firefighter, and says so on its line. */
const hand = (e: Event): Event => (e.reason && handed(e.reason) ? { ...e, handed: true, line: `${e.line} (handed to you by Chris)` } : e);

/** What the snapshot sees now, in factory repos. */
export function snapshot(now = Date.now()): Event[] {
  const repos = factoryRepos();
  const keys = new Set(repos.map((r) => r.key));
  const events: Event[] = [];
  for (const j of allJobs()) {
    const last = lastReal(j);
    const r = last.run;
    if (!r.repo || !keys.has(r.repo) || !isOpen(j)) continue;
    const item = issueOf(j);
    const at = { repo: r.repo, job: r.name, ...(item !== undefined ? { item } : {}) };
    if (r.state === "needs-you" || r.state === "stuck" || r.state === "failed") {
      const reason = r.state === "needs-you" ? r.needs : undefined;
      events.push(hand({ key: `${r.state}:${r.repo}/${last.id}`, kind: r.state, ...at, ...(reason ? { reason } : {}), line: `${r.name} is ${r.state}${r.needs ? ` (${r.needs})` : ""}${r.reason ? `: ${r.reason}` : ""}` }));
    } else if (r.state === "running" && isLost(last.folder)) {
      events.push({ key: `lost:${r.repo}/${last.id}`, kind: "lost", ...at, line: `${r.name}: its ${r.kind} run ${last.id} is running, but its process is gone` });
    }
  }
  const byGoal = new Map<string, Entry[]>();
  for (const e of allRuns()) {
    if (e.run.kind !== "agent" || !e.run.repo || !keys.has(e.run.repo) || now - Date.parse(e.run.started) > LOOP_MS) continue;
    const k = `${e.run.repo}/${e.run.name}`;
    byGoal.set(k, [...(byGoal.get(k) ?? []), e]);
  }
  for (const [k, runs] of byGoal) {
    if (runs.length <= LOOP_RUNS) continue;
    const r = runs.at(-1)!.run;
    events.push({ key: `loop:${k}:${runs.at(-1)!.id}`, kind: "loop", repo: r.repo!, job: r.name, ...(r.todo !== undefined ? { item: r.todo } : {}),
      line: `${r.name} started ${runs.length} runs in 30 minutes: ${runs.map((e) => e.run.reason ?? e.run.state).join("; ")}` });
  }
  for (const b of redBaselines()) if (keys.has(b.repo)) events.push({ key: `red:${b.repo}:${b.commit}`, kind: "red", repo: b.repo, line: `${b.repo} main is red at ${b.commit.slice(0, 7)}: ${b.failed}` });
  const lists = store.reader();
  for (const repo of repos) {
    for (const item of lists.list(repo.key)?.items ?? []) {
      if (todos.status(item) !== "open" || !store.needsChris(item)) continue;
      const reason = reasonOf(item);
      events.push(hand({ key: `needs-chris:${repo.key}-${item.id}:${item.notes.length}`, kind: "needs-chris", repo: repo.key, item: item.id, ...(reason ? { reason } : {}), line: `${repo.key}-${item.id} ${item.title} waits for Chris: ${item.notes.at(-1) ?? ""}` }));
    }
  }
  return events;
}

interface Saved { at: string; keys: string[] }
const lastSnapshot = (): Saved | null => { try { return JSON.parse(readFileSync(stateFile(), "utf8")); } catch { return null; } };
function saveSnapshot(events: Event[]): void {
  mkdirSync(factoryDir(), { recursive: true });
  writeFileSync(stateFile(), JSON.stringify({ at: new Date().toISOString(), keys: events.map((e) => e.key) }, null, 2) + "\n");
}

export type Action =
  | { do: "land"; job: string }
  | { do: "drop"; job: string; reason: string; waiting_on?: string }
  | { do: "close"; repo: string; n: number; note: string }
  | { do: "note"; repo: string; n: number; text: string }
  | { do: "add"; repo: string; title: string; body: string }
  | { do: "clear-needs-chris"; repo: string; n: number; note: string }
  | { do: "edit-goal"; repo: string; n: number; body?: string; waiting_on?: string }
  | { do: "tell"; text: string };

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);
/** A `<repo>-<n>` ref, or undefined: any other value is ignored, as triage's verdict ignores it. */
const ref = (v: unknown): string | undefined => {
  const t = text(v);
  return t && /^[a-z0-9-]+-\d+$/.test(t) ? t : undefined;
};

/** One action from the reply's JSON, or why it is none. */
function parseAction(raw: any): Action | string {
  if (!raw || typeof raw !== "object") return "not an object";
  const f = (k: string) => text(raw[k]);
  const n = num(raw.n);
  const wait = ref(raw.waiting_on);
  switch (raw.do) {
    case "land": return f("job") ? { do: "land", job: f("job")! } : "land without a job";
    case "drop": return f("job") && f("reason") ? { do: "drop", job: f("job")!, reason: f("reason")!, ...(wait ? { waiting_on: wait } : {}) } : "drop without a job and a reason";
    case "close": return f("repo") && n && f("note") ? { do: "close", repo: f("repo")!, n, note: f("note")! } : "close without a repo, n and note";
    case "note": return f("repo") && n && f("text") ? { do: "note", repo: f("repo")!, n, text: f("text")! } : "note without a repo, n and text";
    case "add": return f("repo") && f("title") ? { do: "add", repo: f("repo")!, title: f("title")!, body: f("body") ?? "" } : "add without a repo and a title";
    case "clear-needs-chris": return f("repo") && n && f("note") ? { do: "clear-needs-chris", repo: f("repo")!, n, note: f("note")! } : "clear-needs-chris without a repo, n and note";
    case "edit-goal": return f("repo") && n && (f("body") || wait) ? { do: "edit-goal", repo: f("repo")!, n, ...(f("body") ? { body: f("body")! } : {}), ...(wait ? { waiting_on: wait } : {}) } : "edit-goal without a repo, n, and a body or waiting_on";
    case "tell": return f("text") ? { do: "tell", text: f("text")! } : "tell without text";
    default: return `unknown action ${JSON.stringify(raw.do)}`;
  }
}

/** The actions in the command's output (the whole output, or its outermost braces), each parsed or why not; a string when there is no list. */
export function parseReply(output: string): (Action | string)[] | string {
  let raw: any;
  for (const s of [output.trim(), output.slice(output.indexOf("{"), output.lastIndexOf("}") + 1)]) {
    try { raw = JSON.parse(s); break; } catch {}
  }
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.actions)) return "no JSON object with an actions list";
  return raw.actions.map(parseAction);
}

export const describe = (a: Action): string =>
  a.do === "land" ? `land ${a.job}` : a.do === "drop" ? `drop ${a.job}: ${a.reason}${a.waiting_on ? ` (waits on ${a.waiting_on})` : ""}` : a.do === "close" ? `close ${a.repo}-${a.n}: ${a.note}` : a.do === "note" ? `note ${a.repo}-${a.n}: ${a.text}`
  : a.do === "add" ? `add ${a.repo}: ${a.title}` : a.do === "clear-needs-chris" ? `clear-needs-chris ${a.repo}-${a.n}: ${a.note}`
  : a.do === "edit-goal" ? `edit-goal ${a.repo}-${a.n}${a.waiting_on ? ` (waits on ${a.waiting_on})` : ""}` : `tell: ${a.text}`;

const MAX_FILE = 4000;
const clip = (s: string) => (s.length > MAX_FILE ? `…${s.slice(-MAX_FILE)}` : s);
const RUN_FILES = ["review.md", "review2.md", "browser/report.md", "result.md"];

/** The run folders and issue bodies an event needs, as prompt text. */
function context(e: Event, jobs: Job[]): string {
  const parts: string[] = [];
  const j = e.job ? jobs.findLast((x) => x[0].run.repo === e.repo && x[0].run.name === e.job) : undefined;
  if (j) {
    const last = lastReal(j);
    const agent = j.findLast((x) => x.run.kind === "agent" || x.run.kind === "recheck") ?? last;
    parts.push(`Run folder: ${last.folder}${agent !== last ? ` (agent run: ${agent.folder})` : ""}`);
    if (last.run.stat) parts.push(`Diff stat:\n${last.run.stat}`);
    for (const f of RUN_FILES) {
      const p = join(agent.folder, f);
      if (existsSync(p)) parts.push(`### ${f}\n${clip(readFileSync(p, "utf8").trim())}`);
    }
  }
  if (e.item !== undefined) {
    const item = store.reader().item(e.repo, e.item);
    if (item) parts.push(`### Issue ${e.repo}-${item.id}: ${item.title} [${store.labels(item).join(", ")}]\n${item.body.trim() || "(no body)"}${item.notes.length ? `\n\nNotes:\n${item.notes.join("\n")}` : ""}`);
  }
  return parts.join("\n\n");
}

export function prompt(events: Event[], jobs = allJobs()): string {
  const handedReasons = Object.keys(readStanding()).filter((r) => handed(r));
  const handedRule = handedReasons.length
    ? `\n- Chris has handed these reasons to you: ${handedReasons.join(", ")}. Decide every event marked handed yourself: land, drop, clear-needs-chris, edit-goal or close, by the rules above; do not send it back to Chris.`
    : "";
  return `You are the factory's firefighter. You read what went wrong and say what to do; the code does it. You have read-only tools (Read, Grep, Glob, and Bash for \`aleph jobs\`, \`aleph issue show|list\`, \`aleph report\`, \`git log|show|diff\`). Change nothing yourself.

# The rules

- Land a held run once both reviews have a verdict and say land, unless its diff changes a held security path (${SECURITY_PATHS.join(", ")}, or REVIEW2_SANDBOX in jobs/lib/review2.ts). The code refuses those and sends them to Chris${standing("firefighter")?.action === "land" ? ", except that Chris has let you land them" : ""}.
- Drop a run a reviewer sent back, with the reviewer's reason as the drop's reason: it becomes the next run's note.
- A land with a merge conflict, a run that loops with no commit, or a goal that is already met on main is fixed without Chris: drop the first two; for a goal already met on main use close (it drops the open job and marks the issue done), never sent to Chris.
- A how-to-build question (code structure, which module, naming, test shape, whether to wait for an issue) is yours to decide: clear-needs-chris with the decision. A product choice (what the product does for Chris, what he sees, what it costs, what comes first) stays with Chris, unless Chris has handed its reason to you.
- File every follow-up you find as an issue with add.
- When a run cannot pass until another open issue lands, drop it with \`waiting_on\` set to that issue, or use edit-goal with \`waiting_on\`. A note or a drop reason alone does not stop a rerun.
- At most ${MAX_ACTIONS} actions. No action is a fine answer when nothing needs doing.${handedRule}

# What is new since the last look

${events.map((e) => `## ${e.kind}: ${e.line}\n\n${context(e, jobs)}`).join("\n\n")}

Reply with one JSON object and nothing else: {"actions": [ ... ]}, each action one of
- {"do": "land", "job": "<job name>"}
- {"do": "drop", "job": "<job name>", "reason": "<why; the next run reads it>", "waiting_on": "<repo>-<n>, optional: the open issue this waits for>"}
- {"do": "close", "repo": "<repo>", "n": <issue number>, "note": "<why the goal is already met>"}
- {"do": "note", "repo": "<repo>", "n": <issue number>, "text": "<note>"}
- {"do": "add", "repo": "<repo>", "title": "<title>", "body": "<body>"}
- {"do": "clear-needs-chris", "repo": "<repo>", "n": <issue number>, "note": "<the decision>"}
- {"do": "edit-goal", "repo": "<repo>", "n": <issue number>, "body": "<the new goal body, optional>", "waiting_on": "<repo>-<n>, optional: the open issue this waits for>"}
- {"do": "tell", "text": "<one sentence for Chris>"}
`;
}

/** The changed paths of a run's branch against its repo's main, or null when there is no branch to read. */
function changedPaths(repo: Repo, branch: string | undefined): { paths: string[]; review2Sandbox: boolean } | null {
  if (!branch || !git(repo.path, "rev-parse", "--verify", "-q", `refs/heads/${branch}`).ok) return null;
  const base = git(repo.path, "rev-parse", "--verify", "-q", `origin/${repo.main}`).ok ? `origin/${repo.main}` : repo.main;
  const d = git(repo.path, "diff", "--name-only", `${base}...${branch}`);
  if (!d.ok) return null;
  const sandbox = git(repo.path, "diff", `${base}...${branch}`, "--", "jobs/lib/review2.ts").out.split("\n").some((l) => /^[+-](?![+-])/.test(l) && l.includes("REVIEW2_SANDBOX"));
  return { paths: d.out.split("\n").filter(Boolean), review2Sandbox: sandbox };
}

/** A held security path the branch changes, or null. */
export function securityPath(repo: Repo, branch: string | undefined): string | null | "unknown" {
  const c = changedPaths(repo, branch);
  if (!c) return "unknown";
  const hit = c.paths.find((p) => SECURITY_PATHS.some((s) => (s.endsWith("/") ? p.startsWith(s) : p === s)));
  return hit ?? (c.review2Sandbox ? "REVIEW2_SANDBOX in jobs/lib/review2.ts" : null);
}

/** Whether a `needs-chris` item's question is a product choice: its decision's kind is `product` (triage's `chris` verdict writes that kind). An item with no decision is not one. */
export const isProductChoice = (item: todos.Item): boolean => readDecision(item)?.kind === "product";

/** The reason code a `needs-chris` item waits for: its `fm.reason`, or `decision` for a triage question with none. */
export const reasonOf = (item: todos.Item): string | null => (typeof item.fm.reason === "string" ? item.fm.reason : isProductChoice(item) ? "decision" : null);

/** How actions reach the factory; each returns the refusal, or null. Tests replace land and drop. */
export interface Ports {
  land: (name: string) => Promise<string | null>;
  drop: (name: string, reason: string) => Promise<string | null>;
  tell: (line: string) => Promise<boolean>;
}
export const defaultPorts: Ports = {
  land: (name) => refusal(async () => { await (await landJob(name, { lander: "firefighter" }, { output: "ignore" })).child?.exited; }),
  drop: (name, reason) => refusal(() => dropJob(name, { reason, quiet: true })),
  tell,
};

/** The result of one action: applied, refused (a line for Chris), or sent to Chris as needs-chris. */
type Outcome = { applied: string } | { refused: string } | { chris: string };

const log = (line: string) => factoryLog(`firefighter: ${line}`);

/** Check one action against the rules and apply it. */
async function applyOne(a: Action, ports: Ports): Promise<Outcome> {
  const reg = loadRegistry();
  const repoOf = (key: string): Repo | null => (reg[key]?.sandbox ? reg[key] : null);
  if (a.do === "land" || a.do === "drop") {
    const runs = openJob(a.job);
    const last = runs && lastReal(runs);
    const repo = last?.run.repo ? repoOf(last.run.repo) : null;
    if (!runs || !last || !repo) return { refused: `${describe(a)}: no open factory job named ${a.job}` };
    const issue = issueOf(runs);
    if (a.do === "drop") {
      const why = await ports.drop(a.job, a.reason);
      if (why) return { refused: `${describe(a)}: ${why}` };
      writeRerun(a.job, `The last run was dropped by the firefighter: ${a.reason}`);
      // A run that cannot pass until another issue lands waits on it: the dispatch reads waiting_on and starts nothing until it is done.
      const waits = a.waiting_on && issue !== undefined ? await refusal(async () => issues.edit(repo, issue, { waitingOn: a.waiting_on })) : null;
      if (issue !== undefined) store.note(repo, issue, `firefighter: dropped ${a.job}: ${a.reason}${a.waiting_on ? `; waits on ${a.waiting_on}` : ""}`);
      return waits ? { refused: `${describe(a)}: dropped, but waiting_on not set: ${waits}` } : { applied: describe(a) };
    }
    const agent = runs.findLast((e) => e.run.kind === "agent" || e.run.kind === "recheck") ?? last;
    if (!reviewVerdict(readFile(agent, "review.md") ?? "")) return { refused: `${describe(a)}: the reviewer has no verdict yet` };
    const r2 = readReview2(agent.folder);
    if (!r2 || r2.verdict === "pending" || r2.verdict === "error") return { refused: `${describe(a)}: review2 has no verdict yet` };
    if (r2.verdict !== "land") return { refused: `${describe(a)}: review2 says ${r2.verdict}${r2.reason ? ` (${r2.reason})` : ""}` };
    const held = securityPath(repo, agent.run.branch);
    // Chris let the firefighter land held security paths: the check is skipped, and the land is logged. An unknown branch still goes to Chris.
    const granted = held !== null && held !== "unknown" && standing("firefighter")?.action === "land";
    if (held && granted) logStanding("firefighter", "land", a.job);
    if (held && !granted) {
      const sentence = held === "unknown"
        ? `${a.job} cannot be checked for held security paths, as its branch is gone, so it needs you to land or drop it.`
        : `${a.job} changes ${held}, a held security path, so it needs your review before it lands.`;
      markNeedsChris(last, sentence);
      if (issue !== undefined) store.note(repo, issue, `needs-chris: ${sentence}`, { label: store.NEEDS_CHRIS, reason: "firefighter" });
      await ports.tell(`${repo.key}/${a.job}: needs-chris: ${sentence}`);
      return { chris: sentence };
    }
    const why = await ports.land(a.job);
    return why ? { refused: `${describe(a)}: ${why}` } : { applied: describe(a) };
  }
  if (a.do === "tell") return { applied: describe(a) };
  const repo = repoOf(a.repo);
  if (!repo) return { refused: `${describe(a)}: ${a.repo} is not a factory repo` };
  if (a.do === "add") {
    const ids = store.file(repo, `todo: firefighter files ${a.title}`, [{ title: a.title, labels: [], body: a.body }]);
    return ids.length ? { applied: `${describe(a)} as ${repo.key}-${ids[0]}` } : { refused: `${describe(a)}: not filed` };
  }
  const item = store.reader().item(repo.key, a.n);
  if (!item || todos.status(item) !== "open") return { refused: `${describe(a)}: no open issue ${repo.key}-${a.n}` };
  if (a.do === "close") {
    const open = allJobs().find((j) => isOpen(j) && j[0].run.repo === repo.key && issueOf(j) === a.n);
    if (open) {
      const why = await ports.drop(open[0].run.name, `closed by the firefighter: ${a.note}`);
      if (why) return { refused: `${describe(a)}: ${why}` };
    }
    const why = store.note(repo, a.n, `firefighter: closed: ${a.note}`, { done: true });
    return why ? { refused: `${describe(a)}: ${why}` } : { applied: describe(a) };
  }
  if (a.do === "note") {
    const why = store.note(repo, a.n, `firefighter: ${a.text}`);
    return why ? { refused: `${describe(a)}: ${why}` } : { applied: describe(a) };
  }
  if (a.do === "clear-needs-chris") {
    if (!store.needsChris(item)) return { refused: `${describe(a)}: it is not labelled needs-chris` };
    // The current mark's reason decides: a `decision` mark, or a triage question on a mark with another reason that Chris has not handed, is Chris's.
    const reason = reasonOf(item);
    const productChoice = reason === "decision" || (isProductChoice(item) && !(reason !== null && handed(reason)));
    if (productChoice && !handed("decision")) return { refused: `${describe(a)}: its question is a product choice, which is Chris's` };
    const why = await refusal(async () => issues.decide(repo, a.n, `firefighter decided: ${a.note}`));
    return why ? { refused: `${describe(a)}: ${why}` } : { applied: describe(a) };
  }
  if (!store.hasLabel(item, store.GOAL)) return { refused: `${describe(a)}: it is not a goal` };
  const why = await refusal(async () => issues.edit(repo, a.n, { ...(a.body !== undefined ? { body: a.body } : {}), ...(a.waiting_on ? { waitingOn: a.waiting_on } : {}) }));
  return why ? { refused: `${describe(a)}: ${why}` } : { applied: describe(a) };
}

/** Apply the reply's actions in order, at most MAX_ACTIONS; every outcome is a factory log line. */
export async function applyActions(actions: (Action | string)[], ports: Ports = defaultPorts): Promise<{ applied: string[]; refused: string[]; chris: string[] }> {
  const out = { applied: [] as string[], refused: [] as string[], chris: [] as string[] };
  for (const [i, a] of actions.entries()) {
    let o: Outcome;
    if (i >= MAX_ACTIONS) o = { refused: `${typeof a === "string" ? a : describe(a)}: more than ${MAX_ACTIONS} actions in one run` };
    else if (typeof a === "string") o = { refused: `a malformed action: ${a}` };
    else {
      try { o = await applyOne(a, ports); } catch (e: any) { o = { refused: `${describe(a)}: ${e?.message ?? e}` }; }
    }
    if ("applied" in o) { out.applied.push(o.applied); log(o.applied.startsWith("tell: ") ? o.applied : `did ${o.applied}`); }
    else if ("chris" in o) { out.chris.push(o.chris); log(`needs-chris: ${o.chris}`); }
    else { out.refused.push(o.refused); log(`tell: refused ${o.refused}`); }
  }
  return out;
}

/** Make the run folder of a firefighter run: its own job in the ledger. */
function makeRun(events: Event[]): string {
  mkdirSync(jobsDir(), { recursive: true });
  for (let n = 0; ; n++) {
    const folder = join(jobsDir(), `${stamp()}-firefighter${n ? `-${n}` : ""}-firefighter`);
    try { mkdirSync(folder); } catch (e: any) { if (e.code === "EEXIST") continue; throw e; }
    writeRun(folder, { kind: "firefighter", job: folder.split("/").at(-1)!, name: "firefighter", state: "running", phase: "firefighter", model: FIREFIGHTER_MODEL, told: true, shown: true, started: new Date().toISOString(), made: Date.now() });
    writeFileSync(join(folder, "command.txt"), `firefighter: ${events.length} new event${events.length > 1 ? "s" : ""}\n`);
    return folder;
  }
}

const READ_ONLY = ["Read", "Grep", "Glob", "Bash(aleph jobs:*)", "Bash(aleph issue show:*)", "Bash(aleph issue list:*)", "Bash(aleph report:*)", "Bash(git log:*)", "Bash(git show:*)", "Bash(git diff:*)"];

async function ask(input: string, folder: string): Promise<string> {
  writeFileSync(join(folder, "prompt.md"), input);
  const dirs = factoryRepos().flatMap((r) => ["--add-dir", r.path]);
  const argv = [process.env.ALEPH_FIREFIGHTER_CMD ?? "claude", "-p", "--model", FIREFIGHTER_MODEL, "--tools", "Read", "Grep", "Glob", "Bash", "--allowedTools", ...READ_ONLY, ...dirs];
  const p = Bun.spawn(argv, { cwd: jobsDir(), env: process.env, stdin: new Blob([input]), stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => p.kill(), TIME_BOX_MS());
  try {
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    writeFileSync(join(folder, "output.log"), out + err);
    if (code !== 0) throw new Error(`firefighter exited ${code}`);
    return out;
  } finally {
    clearTimeout(timer);
  }
}

export interface Fired { events: string[]; run?: string; applied: string[]; refused: string[]; chris: string[]; skipped?: string }

/**
 * One look: the snapshot, and one firefighter run when it holds an event the last one lacked.
 * The snapshot is saved either way, so an event is judged once; one that clears and comes back is new again.
 */
export async function firefight(ports: Ports = defaultPorts, now = Date.now()): Promise<Fired> {
  const release = await lock("firefighter", 0);
  if (!release) return { events: [], applied: [], refused: [], chris: [], skipped: "another firefighter is running" };
  try {
    endLost();
    const events = snapshot(now);
    const seen = new Set(lastSnapshot()?.keys ?? []);
    const fresh = events.filter((e) => !seen.has(e.key));
    saveSnapshot(events);
    if (!fresh.length) return { events: [], applied: [], refused: [], chris: [] };
    const folder = makeRun(fresh);
    const end = (reason: string) => updateRun(folder, { state: "done", reason, phase: undefined, ended: new Date().toISOString() });
    const base = { events: fresh.map((e) => e.line), run: folder.split("/").at(-1)! };
    let reply: (Action | string)[] | string;
    try { reply = parseReply(await ask(prompt(fresh), folder)); } catch (e: any) {
      end(`failed: ${e?.message ?? e}`);
      log(`failed: ${e?.message ?? e}`);
      return { ...base, applied: [], refused: [], chris: [] };
    }
    if (typeof reply === "string") { end(`malformed reply: ${reply}`); log(`malformed reply: ${reply}`); return { ...base, applied: [], refused: [], chris: [] }; }
    const r = await applyActions(reply, ports);
    end(`${r.applied.length} applied, ${r.refused.length} refused, ${r.chris.length} to Chris`);
    return { ...base, ...r };
  } finally {
    release();
  }
}

/** End the firefighter runs left `running` by a process that died: the caller holds the firefighter lock, so none is live. */
function endLost(): void {
  for (const { folder, run } of allRuns()) {
    if (run.kind !== "firefighter" || run.state !== "running") continue;
    if (readRun(folder)?.state === "running") updateRun(folder, { state: "done", phase: undefined, reason: "failed: its process ended before a reply", ended: new Date().toISOString() });
  }
}
