/**
 * The housekeeper: it keeps the parked issues of every registry repo current. The tick starts `aleph housekeep` on two
 * triggers: a main that moved since the last sweep (a land, by the factory or by hand) and an hour has passed since the
 * last sweep or daily review started, which reviews the parked issues that name a changed file across all the lands since
 * that sweep, and once a day a review of every parked issue. Each batch of up to BATCH issues of one repo
 * is one read-only `claude -p` run, kind `housekeeper`, in the repo's checkout. Its reply is typed actions; code checks
 * each one and applies it through the issue verbs. It asks nobody: where it would ask, it notes the issue and moves on.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { readJsonOr, writeJson } from "../../../lib/json.ts";
import * as issues from "../../../issues/lib/todo.ts";
import { readList } from "../../../issues/lib/store.ts";
import * as verbs from "../../../issues/lib/issues.ts";
import { loadRegistry, type Repo } from "../records/ledger.ts";
import { runFile } from "../records/run-files.ts";
import { askOf, asking, refIn } from "../asks/ask.ts";
import { factoryDir, gates } from "../gates/factory-status.ts";
import { git } from "../infra/git.ts";
import { held, lock } from "../infra/locks.ts";
import { OPUS_MODEL } from "../routing/models.ts";
import { dispatchAfterIssue } from "../transitions/filing.ts";
import { refusal } from "../transitions/transitions.ts";
import { endLost, openRun } from "./agent-run.ts";

/** Issues per run: a bad reply costs one batch. */
export const BATCH = 10;
/** One batch's time box, in seconds. */
const SECONDS = 1800;
const DAY = 86_400_000;
const HOUR = 3_600_000;
/** The lock that both triggers share. */
const LOCK = "housekeeper";
/** Read-only: Read, Grep, Glob, git's read commands and `ls`. */
const ALLOWED = ["Read", "Grep", "Glob", ...["log", "show", "diff", "ls-files", "grep"].map((c) => `Bash(git ${c}:*)`), "Bash(ls:*)"];
/** A file name in free text, with or without its directories: `tick.ts`, `jobs/lib/transitions/tick.ts`. */
const PATH = /(?:[\w.-]+\/)*[\w-]+\.[a-z]{1,4}\b/g;

/** When the daily review last started, when the last sweep or daily review started, and the main commit of each repo at its last sweep. */
export interface State { daily?: string; last?: string; main: Record<string, string> }
const stateFile = () => join(factoryDir(), "housekeeper.json");
export const readState = (): State => ({ main: {}, ...readJsonOr<Partial<State>>(stateFile(), {}) });

/** One batch: parked issues of one repo, and the land that touched them, if a land is the trigger. */
export interface Batch { repo: Repo; items: issues.Issue[]; land?: { from: string; to: string; files: string[] } }

const headOf = (repo: Repo): string => git(repo.path, "rev-parse", "--verify", "-q", `refs/heads/${repo.main}`).out;
/** The parked issues of `repo`, but those whose Ask waits for Chris: the housekeeper must not close or drop them. */
const parked = (repo: Repo): issues.Issue[] =>
  (readList(repo)?.items ?? []).filter((i) => issues.status(i) === "parked" && !asking(i, askOf(refIn(repo.key, i))));
const textOf = (i: issues.Issue): string => [i.title, i.request, i.spec, ...i.notes].join("\n");
/** Whether `file` is one of the names in `text`: the whole path, or its tail after a slash. */
const names = (text: string, file: string): boolean => (text.match(PATH) ?? []).some((t) => file === t || file.endsWith(`/${t}`));
const chunks = <T>(xs: T[], n: number): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, k) => xs.slice(k * n, k * n + n));

/** The registry repos with an issue list and a main the housekeeper can read. */
const repos = (): Repo[] => Object.values(loadRegistry()).filter((r) => readList(r) && headOf(r));

/** The repos whose main moved since its last sweep. A repo seen for the first time has not moved. */
function moved(s: State): { repo: Repo; from: string; to: string }[] {
  return repos().flatMap((repo) => {
    const from = s.main[repo.key], to = headOf(repo);
    return from && from !== to ? [{ repo, from, to }] : [];
  });
}

const dailyDue = (s: State, now: number): boolean => !s.daily || now - Date.parse(s.daily) >= DAY;

/** Whether the tick should start `aleph housekeep`: not paused, not running, and the daily review is due, or a main moved and the last run started an hour ago. */
export function housekeepDue(now: number): boolean {
  if (gates({ only: ["pause"] }) || held(LOCK)) return false;
  const s = readState();
  return dailyDue(s, now) || ((!s.last || now - Date.parse(s.last) >= HOUR) && moved(s).length > 0);
}

/** The batches of a land: the parked issues of each moved repo that name a changed file. */
function landBatches(s: State): Batch[] {
  return moved(s).flatMap(({ repo, from, to }) => {
    const files = git(repo.path, "diff", "--name-only", from, to).out.split("\n").filter(Boolean);
    const hit = parked(repo).filter((i) => files.some((f) => names(textOf(i), f)));
    return chunks(hit, BATCH).map((items) => ({ repo, items, land: { from, to, files } }));
  });
}

// The reply.

export type Action =
  | { do: "close"; id: string; why: string; how: "done" | "obsolete"; evidence: string }
  | { do: "drop"; id: string; why: string; keep: string }
  | { do: "retitle"; id: string; why: string; title: string }
  | { do: "reprioritize"; id: string; why: string; priority: string }
  | { do: "note"; id: string; why: string }
  | { do: "unpark"; id: string; why: string };

const nonEmpty = { type: "string", minLength: 1 };
const id = { type: "string", pattern: "^\\d+(\\.\\d+)?$" };
const shape = (name: string, fields: Record<string, object> = {}) => ({
  type: "object", additionalProperties: false, required: ["do", "id", "why", ...Object.keys(fields)],
  properties: { do: { const: name }, id, why: nonEmpty, ...fields },
});

/** The JSON schema of the reply: the actions, none for an issue left as it is. */
export const SCHEMA = {
  type: "object", additionalProperties: false, required: ["actions"],
  properties: {
    actions: {
      type: "array",
      items: {
        oneOf: [
          shape("close", { how: { enum: ["done", "obsolete"] }, evidence: nonEmpty }),
          shape("drop", { keep: id }),
          shape("retitle", { title: nonEmpty }),
          shape("reprioritize", { priority: { enum: [...issues.PRIORITIES] } }),
          shape("note"),
          shape("unpark"),
        ],
      },
    },
  },
};

const describe = (a: Action): string => `${a.id} ${a.do}${a.do === "drop" ? ` (keep ${a.keep})` : a.do === "retitle" ? ` "${a.title}"` : a.do === "reprioritize" ? ` ${a.priority}` : a.do === "close" ? ` ${a.how} (${a.evidence})` : ""}: ${a.why}`;

// The prompt.

/** The newest commits since the issue was filed that touch the files it names, at most 15 lines. */
function history(repo: Repo, i: issues.Issue, tracked: string[]): string {
  const files = tracked.filter((f) => names(textOf(i), f));
  if (!files.length) return "";
  const since = issues.created(i) ?? "";
  return git(repo.path, "log", "--oneline", "-n", "15", ...(since ? [`--since=${since}`] : []), repo.main, "--", ...files).out;
}

function section(repo: Repo, i: issues.Issue, tracked: string[], now: number): string {
  const filed = issues.created(i);
  const age = filed ? `filed ${filed.slice(0, 10)} (${Math.floor((now - Date.parse(filed)) / DAY)} days ago)` : "filed: unknown";
  const log = history(repo, i, tracked);
  return [
    `### ${repo.key}-${issues.refOf(i)}: ${i.title}`,
    `id ${issues.refOf(i)}, ${issues.kindOf(i)}, priority ${i.fm.priority ?? "medium"}, ${age}, updated ${(issues.updated(i) ?? "-").slice(0, 10)}`,
    i.request.trim() && `#### Request\n${i.request.trim()}`,
    i.spec.trim() && `#### Spec\n${i.spec.trim()}`,
    i.notes.length && `#### Notes\n${i.notes.join("\n")}`,
    log && `#### Commits since it was filed that touch the files it names\n${log}`,
  ].filter(Boolean).join("\n\n");
}

export function prompt(b: Batch, now: number): string {
  const all = (readList(b.repo)?.items ?? []).filter((i) => ["open", "parked"].includes(issues.status(i)));
  const tracked = git(b.repo.path, "ls-files").out.split("\n");
  const land = b.land && [
    `## The land`,
    `Main moved from ${b.land.from.slice(0, 7)} to ${b.land.to.slice(0, 7)}. Each issue below names a file it changed. Check whether the land did the issue's work, or changed what the issue says.`,
    git(b.repo.path, "log", "--oneline", "-n", "30", `${b.land.from}..${b.land.to}`).out,
    `Changed files:\n${b.land.files.slice(0, 100).join("\n")}`,
  ].join("\n\n");
  return [
    `You are the housekeeper of the ${b.repo.key} issue list. Your working directory is the repo's checkout, on ${b.repo.main}.`,
    "Review each parked issue below and keep it current. Check each claim against the code with your tools (Read, Grep, git log, git show) before you act. Act only on what you checked. When an issue is still right, take no action on it.",
    "",
    "Actions. Each names the issue's `id` and gives `why`, one or two sentences that go on the issue as a note.",
    "- close: the work is on main (`how` done) or no longer applies (`how` obsolete). `evidence` is a commit in this repo or a file path that shows it.",
    "- drop: the issue repeats another issue of this list; `keep` is the id of the one to keep.",
    `- retitle: the title is wrong or stale. A title is one imperative of at most 60 characters that says what changes, with no final period and no "<words>: " prefix.`,
    `- reprioritize: the priority is wrong now; one of ${issues.PRIORITIES.join(", ")}.`,
    "- note: a fact the issue lacks: a moved or deleted file, a commit that did part of it, a question it raises. Nobody answers here: write what is unclear and move on.",
    "- unpark: the issue is ready to build now and waits for nothing. Intake takes it from there.",
    "",
    land,
    `## Open and parked issues of this list, for duplicates\n${all.map((i) => `${issues.refOf(i)} [${issues.status(i)}] ${i.title}`).join("\n")}`,
    `## Issues to review\n\n${b.items.map((i) => section(b.repo, i, tracked, now)).join("\n\n")}`,
  ].filter((x) => x !== undefined).join("\n");
}

// Applying the actions.

const idArg = (ref: string): number | string => (/^\d+$/.test(ref) ? Number(ref) : ref);
const said = (why: string) => `housekeeper: ${why}`;

/** Whether `evidence` is a commit or a path that git has ever tracked in the repo. */
function evident(repo: Repo, evidence: string): boolean {
  if (/^[0-9a-f]{7,40}$/.test(evidence) && git(repo.path, "cat-file", "-e", `${evidence}^{commit}`).ok) return true;
  return !!git(repo.path, "log", "-1", "--format=%h", "--all", "--", evidence).out;
}

/** Check one action and apply it; the refusal, or null. Only an issue of the batch, still parked, takes an action. */
async function applyOne(b: Batch, a: Action): Promise<string | null> {
  const { repo } = b;
  if (!b.items.some((i) => issues.refOf(i) === a.id)) return "not an issue of this batch";
  const doc = readList(repo)!;
  const item = issues.find(doc, idArg(a.id));
  if (!item || issues.status(item) !== "parked") return "no longer parked";
  if (a.do === "close") {
    if (!evident(repo, a.evidence)) return `no commit or path ${a.evidence} in ${repo.key}`;
    return refusal(async () => verbs.close(repo, idArg(a.id), a.how === "done" ? "done" : "drop", said(`${a.why} (evidence ${a.evidence})`)));
  }
  if (a.do === "drop") {
    const keep = issues.find(doc, idArg(a.keep));
    if (a.keep === a.id || !keep || !["open", "parked"].includes(issues.status(keep))) return `${a.keep} is not another open or parked issue`;
    return refusal(async () => {
      verbs.close(repo, idArg(a.id), "drop", said(`duplicate of ${repo.key}-${a.keep}: ${a.why}`));
      verbs.note(repo, idArg(a.keep), said(`${repo.key}-${a.id} was dropped as its duplicate: ${a.why}`));
    });
  }
  if (a.do === "retitle") return issues.titleProblem(a.title) ?? refusal(async () => verbs.edit(repo, idArg(a.id), { title: a.title }, said(a.why)));
  if (a.do === "reprioritize") return refusal(async () => verbs.edit(repo, idArg(a.id), { priority: a.priority }, said(a.why)));
  if (a.do === "note") return refusal(async () => verbs.note(repo, idArg(a.id), said(a.why)));
  return refusal(async () => dispatchAfterIssue(repo, verbs.edit(repo, idArg(a.id), { status: "open" }, said(a.why)).item));
}

/** The tally word of each action. */
const WORD = [["close", "closed"], ["drop", "dropped"], ["retitle", "retitled"], ["reprioritize", "reprioritized"], ["note", "noted"], ["unpark", "unparked"]] as const;

export interface Outcome { repo: string; ids: string[]; applied: string[]; refused: string[]; error?: string }

/** One run on one batch: its reply's actions, each applied or refused. A failed run applies nothing. */
export async function review(b: Batch, now: number): Promise<Outcome> {
  const ids = b.items.map(issues.refOf);
  const out: Outcome = { repo: b.repo.key, ids, applied: [], refused: [] };
  const run = openRun({
    role: "housekeeper", who: "the housekeeper", model: OPUS_MODEL, seconds: SECONDS, cwd: b.repo.path, repo: b.repo.key, schema: SCHEMA,
    flags: ["--tools", "Read,Grep,Glob,Bash", "--allowedTools", ALLOWED.join(",")],
    name: `housekeeper-${b.repo.key}`, command: `housekeep ${b.repo.key}${b.land ? ` after ${b.land.to.slice(0, 7)}` : ""}: ${ids.join(", ")}`, shown: true,
  });
  let reply: any;
  try { reply = await run.askData(prompt(b, now)); } catch (e: any) {
    out.error = String(e?.message ?? e);
    run.end(`failed: ${out.error}`, { cause: "unanswered" });
    return out;
  }
  if (!Array.isArray(reply?.actions)) {
    out.error = "the reply has no actions list";
    run.end(`failed: ${out.error}`, { cause: "unanswered" });
    return out;
  }
  const did: Action[] = [];
  for (const a of reply.actions as Action[]) {
    const why = await applyOne(b, a);
    if (!why) did.push(a);
    (why ? out.refused : out.applied).push(why ? `${describe(a)}: refused: ${why}` : describe(a));
  }
  writeFileSync(runFile(run.folder, "result.md"), [`# Applied`, ...out.applied.map((l) => `- ${l}`), "", `# Refused`, ...out.refused.map((l) => `- ${l}`), ""].join("\n"));
  const tally = { reviewed: ids.length, ...Object.fromEntries(WORD.map(([k, w]) => [w, did.filter((a) => a.do === k).length])), refused: out.refused.length };
  run.end(`${out.applied.length} applied, ${out.refused.length} refused`, {
    tally: Object.fromEntries(Object.entries(tally).filter(([, n]) => n)),
    touched: [...new Set(did.map((a) => `${b.repo.key}-${a.id}`))],
    changes: did.map((a) => ({ id: `${b.repo.key}-${a.id}`, do: a.do })),
  });
  return out;
}

/**
 * `aleph housekeep`: the daily review of every parked issue when it is due, else the sweep of each main that moved.
 * The state moves before the runs, so a batch that fails is not tried again each minute: the next daily review takes it.
 * Null when another housekeeper holds the lock.
 */
export async function housekeep(now: number): Promise<Outcome[] | null> {
  await endLost("housekeeper", () => LOCK, "its reply");
  const release = await lock(LOCK, 0);
  if (!release) return null;
  try {
    const s = readState();
    const daily = dailyDue(s, now);
    const batches = daily ? repos().flatMap((repo) => chunks(parked(repo), BATCH).map((items) => ({ repo, items }))) : landBatches(s);
    writeJson(stateFile(), { daily: daily ? new Date(now).toISOString() : s.daily, last: new Date(now).toISOString(), main: { ...s.main, ...Object.fromEntries(repos().map((r) => [r.key, headOf(r)])) } });
    const out: Outcome[] = [];
    for (const b of batches) out.push(await review(b, now));
    return out;
  } finally {
    release();
  }
}
