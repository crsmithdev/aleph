/**
 * The tick's triage of open issues that are not goals: one read-only
 * `claude -p` run per issue gives one verdict, which is applied through the
 * work store. Each run is a job in the ledger, kind `triage`.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as todos from "../../todo/lib/todo.ts";
import { GOAL, NEEDS_CHRIS, isSorted, label, noteFlake, reader, sort } from "../../todo/lib/store.ts";
import { decisionNote, normalizeDecision, writeDecision, type Decision } from "./decision.ts";
import { allRuns, jobsDir, lock, readRun, stamp, updateRun, writeRun, type Repo } from "./ledger.ts";

export const TRIAGE_CAP = () => Number(process.env.ALEPH_TRIAGE_CAP ?? 5);
import { factoryDir, gates, pendingWaits, waitsOf } from "./factory.ts";
import { git } from "./git.ts";
import { logStanding, standing } from "./standing.ts";
/** Triage runs that end with no verdict, for one item, before it is labelled `needs-chris`; `ALEPH_TRIAGE_TRIES` changes it. */
export const TRIAGE_TRIES = () => Number(process.env.ALEPH_TRIAGE_TRIES ?? 2);
const TIME_BOX_MS = () => Number(process.env.ALEPH_TRIAGE_TIMEOUT ?? 600) * 1000;

/** The longest title an issue gets. */
export const TITLE_MAX = 60;

export type Verdict =
  | { verdict: "goal"; title: string; body: string; waitingOn?: string }
  | { verdict: "close"; reason: string }
  | { verdict: "done"; commit: string; reason: string }
  | { verdict: "chris"; question: string; decision?: Decision }
  | { verdict: "live"; note: string }
  | { verdict: "flake"; note: string };

export type Counts = Partial<Record<Verdict["verdict"], number>>;

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** The verdict in the command's output (the whole output, or its outermost braces), or why there is none. */
export function parseVerdict(output: string): Verdict | string {
  let raw: any;
  for (const s of [output.trim(), output.slice(output.indexOf("{"), output.lastIndexOf("}") + 1)]) {
    try { raw = JSON.parse(s); break; } catch {}
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "no JSON";
  const field = (key: string) => text(raw[key]);
  switch (raw.verdict) {
    case "goal": {
      const body = field("body"), title = field("title")?.replace(/\s+/g, " ") ?? null, wait = field("waiting_on") ?? "";
      if (!body) return "goal without a body";
      if (!title) return "goal without a title";
      if (title.length > TITLE_MAX) return `goal title over ${TITLE_MAX} characters`;
      if (!/^## Request[ \t]*$/m.test(body)) return "goal body without a ## Request section";
      return /^[a-z0-9-]+-\d+$/.test(wait) ? { verdict: "goal", title, body, waitingOn: wait } : { verdict: "goal", title, body };
    }
    case "close": { const reason = field("reason"); return reason ? { verdict: "close", reason } : "close without a reason"; }
    case "chris": { const question = field("question"); if (!question) return "chris without a question"; const decision = normalizeDecision(raw); return decision ? { verdict: "chris", question: decision.question, decision } : { verdict: "chris", question }; }
    case "done": {
      const commit = field("commit"), reason = field("reason");
      if (!commit || !/^[0-9a-f]{7,40}$/i.test(commit)) return "done without a commit";
      return reason ? { verdict: "done", commit, reason } : "done without a reason";
    }
    case "live": { const note = field("note"); return note ? { verdict: "live", note } : "live without a note"; }
    case "flake": { const note = field("note"); return note ? { verdict: "flake", note } : "flake without a note"; }
    default: return `unknown verdict ${JSON.stringify(raw.verdict)}`;
  }
}

/** The open issues of the repo, one line each, but not the issue under triage: the others a duplicate can name. */
function openIssues(repo: Repo, item: todos.Item): string {
  const others = (reader().list(repo.key)?.items ?? []).filter((o) => o.id !== item.id && todos.status(o) === "open");
  return others.map((o) => `${repo.key}-${o.id}: ${o.title.replace(/\s+/g, " ").trim()}`).join("\n") || "(none)";
}

/** The ref of the repo's main: origin/main when it has one, else main. */
function mainRef(repo: Repo): string | null {
  for (const ref of ["origin/main", "main"]) if (git(repo.path, "rev-parse", "--verify", "-q", `${ref}^{commit}`).ok) return ref;
  return null;
}

/** The commits on main since the day the item was created, one line each: what a goal may already be done by. */
function mainSince(repo: Repo, item: todos.Item): string {
  const ref = mainRef(repo);
  if (!ref) return "(main is not readable)";
  // `created` is a day; start a day early, so a time zone cannot drop the commits of the day itself.
  const day = new Date(`${String(item.fm.created ?? "").trim()}T00:00:00Z`);
  const r = git(repo.path, "log", "--oneline", "--no-decorate", ...(isNaN(+day) ? ["-n", "50"] : [`--since=${new Date(+day - 864e5).toISOString()}`]), ref);
  return (r.ok && r.out.trim()) || "(none)";
}

/** The full sha of `commit` when it is a commit on main, else null. */
function commitOnMain(repo: Repo, commit: string): string | null {
  const ref = mainRef(repo);
  if (!ref) return null;
  const full = git(repo.path, "rev-parse", "--verify", "-q", `${commit}^{commit}`);
  if (!full.ok) return null;
  const sha = full.out.trim();
  return git(repo.path, "merge-base", "--is-ancestor", sha, ref).ok ? sha : null;
}

export function prompt(repo: Repo, item: todos.Item): string {
  return `You triage one open issue of the repo ${repo.key}, which is your working directory. You have read-only tools: read the code to decide. Change nothing.

# Issue ${repo.key}-${item.id}: ${item.title}

${item.body.trim() || "(no body)"}
${item.notes.length ? `\nNotes:\n${item.notes.join("\n")}\n` : ""}
# Open issues of ${repo.key}

${openIssues(repo, item)}

# Commits on main since ${String(item.fm.created ?? "").trim() || "the issue was created"}

${mainSince(repo, item)}

Reply with one JSON object and nothing else, with one of these verdicts:

- {"verdict": "goal", "title": "<short title>", "body": "<goal body>", "waiting_on": "<optional <repo>-<n>>"}: the issue is work a factory run can do alone. "title" replaces the issue's title: a short, descriptive noun phrase of at most ${TITLE_MAX} characters, in the style of the good titles ("Status layout C: metrics left, lanes in a rail", not a sentence). "body" replaces the issue's body: it starts with the input text under a "## Request" heading, then the goal format:
  ## Request (the issue's own text above, as Markdown, word for word: change only spelling and grammar, never the content, and never edit it again in later sections)
  ## Goal (what and why, short)
  ## Edit surface (the files the run may change)
  ## Oracle (the checks that tell it is done)
  ## Time box (default: 45 minutes, one run)

  The "## Request" text is the issue's title and body as written, kept for the reader; the sections after it are yours. The factory runs this repo's checks itself, so the Oracle names only real commands of this repo, as they are typed in a shell (such as \`bun run test\`), or a new test that asserts the end state. For one file, name it, as in \`bun test path/to/x.test.ts\`; for the full suite, use \`bun run test\`. There is no \`aleph check\` command: never name one.
- {"verdict": "close", "reason": "<why>"}: it is already fixed, a duplicate of <repo>-<n> (name it), or stale.
- {"verdict": "done", "commit": "<sha>", "reason": "<what the commit holds>"}: main already holds the work. Before a "goal" verdict, check this: read the commits listed above, and grep main for the names the issue gives (files, functions, test names). When a commit on main already makes the change, return "done" with that commit's sha and say what it holds; no worker runs. When you are unsure, return "goal" as usual.
- {"verdict": "chris", "question": "<one plain sentence>", "options": [{"label": "<short>", "line": "<one line of what it does>", "waiting_on": "<optional <repo>-<n>: set only when choosing this option means waiting for that issue first>"}], "recommended": "<an option's label>", "why": ["<short bullet of context>"]}: it needs a choice only Chris can make: what the product does for him, what he sees, what it costs, or what to work on first. Write the question and the options in plain words a user of the product reads: no file paths, function names, line numbers or code. Give 2 to 4 options, and 2 to 4 short "why" lines; "recommended" is one option's label, exactly. Chris answers by pressing one option's button, so each option must be something a factory run can do.

Duplicates: when the issue asks for the same work as an open issue listed above, return "close" with the reason "duplicate of <repo>-<n>", naming that issue. When it only waits for that open issue, return "goal" with "waiting_on" set to it.

Never ask Chris about how to build it: code structure, which module or helper, naming, test shape, whether to wait for another open issue, or whether a refactor is worth it. Decide those yourself: pick the best option and return "goal" (with "waiting_on" when the work must wait for an open issue), or "close" when it is not worth doing or is already done.
- {"verdict": "live", "note": "<what to check>"}: it is a check against a live system the sandbox cannot reach.
- {"verdict": "flake", "note": "<test file> > <test name>: <what was seen>"}: the issue reports a test that fails or times out now and then, or under load, and asks for no change to the product. Name the test file, the test name and what was seen. Do not return "goal" for it: Chris picks from the tracker which flakes get a goal, and files those himself. An issue that asks to fix a named test's own bug, with a cause, is still a "goal".
`;
}

/** Make the run folder of a triage: its own job in the ledger. */
function makeRun(repo: Repo, item: todos.Item): string {
  mkdirSync(jobsDir(), { recursive: true });
  const name = `triage-${repo.key}-${item.id}`;
  for (let n = 0; ; n++) {
    const folder = join(jobsDir(), `${stamp()}-${name}${n ? `-${n}` : ""}-triage`);
    try { mkdirSync(folder); } catch (e: any) { if (e.code === "EEXIST") continue; throw e; }
    // `shown`: the tick's own line reports a triage, so the report has no line for the run.
    writeRun(folder, { kind: "triage", job: folder.split("/").at(-1)!, name, repo: repo.key, todo: item.id, state: "running", phase: "triage", told: true, shown: true, started: new Date().toISOString(), made: Date.now() });
    writeFileSync(join(folder, "command.txt"), `triage ${repo.key}-${item.id}: ${item.title}\n`);
    return folder;
  }
}

async function ask(repo: Repo, item: todos.Item, folder: string): Promise<string> {
  const input = prompt(repo, item);
  writeFileSync(join(folder, "prompt.md"), input);
  const argv = [process.env.ALEPH_TRIAGE_CMD ?? "claude", "-p", "--tools", "Read", "Grep", "Glob"];
  const p = Bun.spawn(argv, { cwd: repo.path, env: process.env, stdin: new Blob([input]), stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => p.kill(), TIME_BOX_MS());
  try {
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    writeFileSync(join(folder, "output.log"), out + err);
    if (code !== 0) throw new Error(`triage exited ${code}`);
    return out;
  } finally {
    clearTimeout(timer);
  }
}

/** Apply a verdict to the item through the work store; false when the item changed under the run. */
function apply(repo: Repo, id: number, v: Verdict): boolean {
  // The tracker first, then the close: a failed note leaves the issue open for the next triage.
  let tracker = 0;
  if (v.verdict === "flake") {
    const noted = noteFlake(repo, `triage of ${repo.key}-${id}: ${v.note}`);
    if (typeof noted === "string") throw new Error(`flake not noted: ${noted}`);
    tracker = noted.id;
  }
  return sort(repo, id, `triage ${repo.key}-${id}: ${v.verdict}`, (item) => {
    if (v.verdict === "goal") {
      todos.edit(item, { title: v.title, body: v.body, ...(v.waitingOn ? { waitingOn: v.waitingOn } : {}) });
      label(item, [GOAL]);
      todos.note(item, v.waitingOn ? `triage: rewritten as a goal; waits on ${v.waitingOn}` : "triage: rewritten as a goal");
    } else if (v.verdict === "done") {
      todos.setStatus(item, "done");
      todos.note(item, `triage: already on main in ${v.commit}: ${v.reason}`);
    } else if (v.verdict === "flake") {
      todos.setStatus(item, "done");
      todos.note(item, `triage: a flake, noted on ${repo.key}-${tracker}`);
    } else if (v.verdict === "close") {
      todos.setStatus(item, "done");
      todos.note(item, `triage: closed: ${v.reason}`);
    } else if (v.verdict === "chris" && v.decision && standing("decision")?.action === "recommended") {
      const o = v.decision.options.find((x) => x.label === v.decision!.recommended) ?? v.decision.options[0]!;
      todos.note(item, `standing: took the recommendation ${o.label}: ${o.line}`);
      label(item, [GOAL]);
      todos.edit(item, { waitingOn: o.waiting_on });
      logStanding("decision", "recommended", `${repo.key}-${id}`);
    } else if (v.verdict === "chris") {
      label(item, [NEEDS_CHRIS]);
      item.fm.reason = "decision";
      // Triage only asks Chris product questions, whatever kind the model named.
      if (v.decision) writeDecision(item, { ...v.decision, kind: "product" });
      todos.note(item, `triage: for Chris: ${v.decision ? decisionNote(v.decision) : v.question}`);
    } else {
      label(item, ["live-check", "triaged"]);
      todos.note(item, `triage: a live check: ${v.note}`);
    }
  });
}

/**
 * After a run with no verdict: when the item's triages with none reach the
 * limit, label it `needs-chris` so later ticks skip it. The line to report, or null.
 */
function giveUp(repo: Repo, id: number, reason: string): string | null {
  // After a standing retry, only the runs since it count.
  const mark = join(factoryDir(), "standing-retry", `${repo.key}-${id}`);
  let since = 0;
  try { since = Number(readFileSync(mark, "utf8")) || 0; } catch {}
  const n = allRuns().filter((e) => e.run.kind === "triage" && e.run.repo === repo.key && e.run.todo === id
    && (e.run.made ?? 0) > since
    && /^(malformed verdict|failed):/.test(e.run.reason ?? "")).length;
  if (n < TRIAGE_TRIES()) return null;
  const grant = standing("triage-no-verdict")?.action;
  const ref = `${repo.key}-${id}`;
  if (grant === "retry") {
    mkdirSync(join(factoryDir(), "standing-retry"), { recursive: true });
    writeFileSync(mark, String(Date.now()));
    logStanding("triage-no-verdict", "retry", ref);
    return `${ref}: no verdict in ${n} triages; standing: triage again next tick`;
  }
  if (grant === "close") {
    const closed = sort(repo, id, `triage ${ref}: no verdict`, (item) => {
      todos.setStatus(item, "done");
      todos.note(item, `triage: no verdict in ${n} runs; standing: closed`);
    });
    if (closed) logStanding("triage-no-verdict", "close", ref);
    return closed ? `${ref}: no verdict in ${n} triages; standing: closed` : null;
  }
  const written = sort(repo, id, `triage ${repo.key}-${id}: no verdict`, (item) => {
    label(item, [NEEDS_CHRIS]);
    item.fm.reason = "triage-no-verdict";
    todos.note(item, `triage: no verdict in ${n} runs: ${reason}`);
  });
  return written ? `${repo.key}-${id}: no verdict in ${n} triages; labelled needs-chris` : null;
}

/** One triage run of one item and its verdict applied; counts and skipped lines are added to. */
async function triageItem(repo: Repo, item: todos.Item, triaged: Counts, skipped: string[]): Promise<void> {
  const name = `${repo.key}-${item.id}`;
  // One triage of an item at a time: an issue write's run and the tick may meet.
  const release = await lock(`triage-${name}`, 0);
  if (!release) { skipped.push(`${name}: another triage is running`); return; }
  try {
    const folder = makeRun(repo, item);
    // A triage that gives no verdict is still done: it is not a job to land or drop, and the item is unchanged.
    const end = (reason: string) => updateRun(folder, { state: "done", reason, phase: undefined, ended: new Date().toISOString() });
    try {
      const v = parseVerdict(await ask(repo, item, folder));
      if (typeof v === "string") {
        const reason = `malformed verdict: ${v}`;
        end(reason);
        skipped.push(giveUp(repo, item.id, reason) ?? `${name}: triage gave a malformed verdict: ${v}`);
        return;
      }
      if (v.verdict === "done") {
        const sha = commitOnMain(repo, v.commit);
        if (!sha) {
          const reason = `malformed verdict: done names ${v.commit}, not a commit on main`;
          end(reason);
          skipped.push(giveUp(repo, item.id, reason) ?? `${name}: ${reason}`);
          return;
        }
        v.commit = sha.slice(0, 12);
      }
      if (apply(repo, item.id, v)) {
        triaged[v.verdict] = (triaged[v.verdict] ?? 0) + 1;
        end(v.verdict);
      } else {
        end("the item changed during the run");
        skipped.push(`${name}: changed during the triage`);
      }
    } catch (e: any) {
      const reason = `failed: ${e?.message ?? e}`;
      end(reason);
      skipped.push(giveUp(repo, item.id, reason) ?? `${name}: triage failed: ${e?.message ?? e}`);
    }
  } finally {
    release();
  }
}

/**
 * End the triage runs left `running` by a process that died before its `end()`.
 * A triage holds its item's lock for the whole run, so a lock taken with no wait
 * means no process is running that triage. A run whose lock is held is left alone.
 */
async function endLost(): Promise<void> {
  for (const { folder, run } of allRuns()) {
    if (run.kind !== "triage" || run.state !== "running" || !run.repo || run.todo === undefined) continue;
    const release = await lock(`triage-${run.repo}-${run.todo}`, 0);
    if (!release) continue;
    try {
      // Read again under the lock: the run may have ended since the list was read.
      if (readRun(folder)?.state !== "running") continue;
      updateRun(folder, { state: "done", phase: undefined, reason: "failed: its process ended before a verdict", ended: new Date().toISOString() });
    } finally {
      release();
    }
  }
}

/** Triage one open issue now, if it is one the tick would triage. */
export async function triageIssue(repo: Repo, id: number, done: (ref: string) => boolean): Promise<{ triaged: Counts; skipped: string[] }> {
  const triaged: Counts = {};
  const skipped: string[] = [];
  await endLost();
  const item = reader().item(repo.key, id);
  if (!item || todos.status(item) !== "open" || isSorted(item)) return { triaged, skipped };
  const waits = waitsOf(item);
  if (pendingWaits(waits, done).length) return { triaged, skipped };
  const blocked = gates({ only: ["live", "day"] });
  if (blocked) { skipped.push(`triage: ${blocked.why}`); return { triaged, skipped }; }
  await triageItem(repo, item, triaged, skipped);
  return { triaged, skipped };
}

/**
 * Triage the open issues that are not goals, oldest first, at most
 * `ALEPH_TRIAGE_CAP`, while the live and day gates allow.
 */
export async function triageOpen(repos: Repo[], done: (ref: string) => boolean): Promise<{ triaged: Counts; skipped: string[] }> {
  const triaged: Counts = {};
  const skipped: string[] = [];
  await endLost();
  const queue: { repo: Repo; item: todos.Item }[] = [];
  const lists = reader();
  for (const repo of repos) {
    for (const item of lists.list(repo.key)?.items ?? []) {
      if (todos.status(item) !== "open" || isSorted(item)) continue;
      const waits = waitsOf(item);
      if (pendingWaits(waits, done).length) continue;
      queue.push({ repo, item });
    }
  }
  queue.sort((a, b) => String(a.item.fm.created ?? "").localeCompare(String(b.item.fm.created ?? "")) || a.repo.key.localeCompare(b.repo.key) || a.item.id - b.item.id);

  let n = 0;
  for (const { repo, item } of queue) {
    if (n >= TRIAGE_CAP()) break;
    const blocked = gates({ only: ["live", "day"] });
    if (blocked) { skipped.push(`triage: ${blocked.why}`); break; }
    n++;
    await triageItem(repo, item, triaged, skipped);
  }
  return { triaged, skipped };
}

/** `goal 1, close 2` for the tick's line; "none" when nothing was triaged. */
export const countsLine = (c: Counts): string =>
  Object.entries(c).map(([k, v]) => `${k} ${v}`).join(", ") || "none";
