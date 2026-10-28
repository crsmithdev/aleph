/**
 * The tick's triage of open issues that are not goals: one read-only
 * `claude -p` run per issue gives one verdict, which is applied through the
 * work store. Each run is a job in the ledger, kind `triage`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as todos from "../../todo/lib/todo.ts";
import { readList, writeList } from "../../todo/lib/store.ts";
import { allRuns, isLive, jobsDir, lock, stamp, updateRun, writeRun, type Repo } from "./ledger.ts";

export const TRIAGE_CAP = () => Number(process.env.ALEPH_TRIAGE_CAP ?? 5);
export { LIVE_CAP } from "./factory.ts";
import { LIVE_CAP } from "./factory.ts";
/** Triage runs that end with no verdict, for one item, before it is labelled `needs-chris`; `ALEPH_TRIAGE_TRIES` changes it. */
export const TRIAGE_TRIES = () => Number(process.env.ALEPH_TRIAGE_TRIES ?? 2);
const TIME_BOX_MS = () => Number(process.env.ALEPH_TRIAGE_TIMEOUT ?? 600) * 1000;

/** An item with any of these labels is not triaged. */
export const SKIP_LABELS = ["goal", "needs-chris", "triaged", "proposal"];

export type Verdict =
  | { verdict: "goal"; body: string }
  | { verdict: "close"; reason: string }
  | { verdict: "chris"; question: string }
  | { verdict: "live"; note: string };

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
    case "goal": { const body = field("body"); return body ? { verdict: "goal", body } : "goal without a body"; }
    case "close": { const reason = field("reason"); return reason ? { verdict: "close", reason } : "close without a reason"; }
    case "chris": { const question = field("question"); return question ? { verdict: "chris", question } : "chris without a question"; }
    case "live": { const note = field("note"); return note ? { verdict: "live", note } : "live without a note"; }
    default: return `unknown verdict ${JSON.stringify(raw.verdict)}`;
  }
}

export function prompt(repo: Repo, item: todos.Item): string {
  return `You triage one open issue of the repo ${repo.key}, which is your working directory. You have read-only tools: read the code to decide. Change nothing.

# Issue ${repo.key}-${item.id}: ${item.title}

${item.body.trim() || "(no body)"}
${item.notes.length ? `\nNotes:\n${item.notes.join("\n")}\n` : ""}
Reply with one JSON object and nothing else, with one of these verdicts:

- {"verdict": "goal", "body": "<goal body>"}: the issue is work a factory run can do alone. "body" replaces the issue's body, in the goal format:
  ## Goal (what and why, short)
  ## Edit surface (the files the run may change)
  ## Oracle (the checks that tell it is done)
  ## Time box (default: 45 minutes, one run)

  The factory runs this repo's checks itself, so the Oracle names only real commands of this repo, as they are typed in a shell (such as \`bun test\`), or a new test that asserts the end state. There is no \`aleph check\` command: never name one.
- {"verdict": "close", "reason": "<why>"}: it is already fixed, a duplicate of <repo>-<n> (name it), or stale.
- {"verdict": "chris", "question": "<one question>"}: it needs a plan or a choice only Chris can make.
- {"verdict": "live", "note": "<what to check>"}: it is a check against a live system the sandbox cannot reach.
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
  const written = writeList(repo, `triage ${repo.key}-${id}: ${v.verdict}`, (doc) => {
    const item = todos.find(doc, id);
    if (!item || todos.status(item) !== "open") return null;
    const labels = (item.fm.labels as string[]) ?? [];
    if (labels.some((l) => SKIP_LABELS.includes(l))) return null;
    if (v.verdict === "goal") {
      todos.edit(item, { body: v.body, labels: [...labels, "goal"] });
      todos.note(item, "triage: rewritten as a goal");
    } else if (v.verdict === "close") {
      todos.setStatus(item, "done");
      todos.note(item, `triage: closed: ${v.reason}`);
    } else if (v.verdict === "chris") {
      todos.edit(item, { labels: [...labels, "needs-chris"] });
      todos.note(item, `triage: for Chris: ${v.question}`);
    } else {
      todos.edit(item, { labels: [...labels, "live-check", "triaged"] });
      todos.note(item, `triage: a live check: ${v.note}`);
    }
    return true;
  });
  return written?.value === true;
}

/**
 * After a run with no verdict: when the item's triages with none reach the
 * limit, label it `needs-chris` so later ticks skip it. The line to report, or null.
 */
function giveUp(repo: Repo, id: number, reason: string): string | null {
  const n = allRuns().filter((e) => e.run.kind === "triage" && e.run.repo === repo.key && e.run.todo === id
    && /^(malformed verdict|failed):/.test(e.run.reason ?? "")).length;
  if (n < TRIAGE_TRIES()) return null;
  const written = writeList(repo, `triage ${repo.key}-${id}: no verdict`, (doc) => {
    const item = todos.find(doc, id);
    if (!item || todos.status(item) !== "open") return null;
    const labels = (item.fm.labels as string[]) ?? [];
    if (labels.some((l) => SKIP_LABELS.includes(l))) return null;
    todos.edit(item, { labels: [...labels, "needs-chris"] });
    todos.note(item, `triage: no verdict in ${n} runs: ${reason}`);
    return true;
  });
  return written?.value === true ? `${repo.key}-${id}: no verdict in ${n} triages; labelled needs-chris` : null;
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

/** Triage one open issue now, if it is one the tick would triage; `blocked` as in triageOpen. */
export async function triageIssue(repo: Repo, id: number, done: (ref: string) => boolean, blocked: () => string | null): Promise<{ triaged: Counts; skipped: string[] }> {
  const triaged: Counts = {};
  const skipped: string[] = [];
  let item: todos.Item | undefined;
  try { item = todos.find(readList(repo)!, id); } catch {}
  if (!item || todos.status(item) !== "open") return { triaged, skipped };
  if (((item.fm.labels as string[]) ?? []).some((l) => SKIP_LABELS.includes(l))) return { triaged, skipped };
  const waits = item.fm.waiting_on;
  if (typeof waits === "string" && !done(waits)) return { triaged, skipped };
  const live = allRuns().filter((e) => e.run.kind === "agent" && isLive(e.folder)).length;
  if (live >= LIVE_CAP()) { skipped.push(`triage: ${live} agent runs are live`); return { triaged, skipped }; }
  const why = blocked();
  if (why) { skipped.push(`triage: ${why}`); return { triaged, skipped }; }
  await triageItem(repo, item, triaged, skipped);
  return { triaged, skipped };
}

/**
 * Triage the open issues that are not goals, oldest first, at most
 * `ALEPH_TRIAGE_CAP`, while live agent runs are below the live cap.
 * `blocked` names a reason no run may start (the day cap), or null.
 */
export async function triageOpen(repos: Repo[], done: (ref: string) => boolean, blocked: () => string | null): Promise<{ triaged: Counts; skipped: string[] }> {
  const triaged: Counts = {};
  const skipped: string[] = [];
  const queue: { repo: Repo; item: todos.Item }[] = [];
  for (const repo of repos) {
    let doc: todos.Doc | null = null;
    try { doc = readList(repo); } catch { continue; }
    for (const item of doc?.items ?? []) {
      if (todos.status(item) !== "open") continue;
      if (((item.fm.labels as string[]) ?? []).some((l) => SKIP_LABELS.includes(l))) continue;
      const waits = item.fm.waiting_on;
      if (typeof waits === "string" && !done(waits)) continue;
      queue.push({ repo, item });
    }
  }
  queue.sort((a, b) => String(a.item.fm.created ?? "").localeCompare(String(b.item.fm.created ?? "")) || a.repo.key.localeCompare(b.repo.key) || a.item.id - b.item.id);

  let n = 0;
  for (const { repo, item } of queue) {
    if (n >= TRIAGE_CAP()) break;
    const live = allRuns().filter((e) => e.run.kind === "agent" && isLive(e.folder)).length;
    if (live >= LIVE_CAP()) { skipped.push(`triage: ${live} agent runs are live`); break; }
    const why = blocked();
    if (why) { skipped.push(`triage: ${why}`); break; }
    n++;
    await triageItem(repo, item, triaged, skipped);
  }
  return { triaged, skipped };
}

/** `goal 1, close 2` for the tick's line; "none" when nothing was triaged. */
export const countsLine = (c: Counts): string =>
  Object.entries(c).map(([k, v]) => `${k} ${v}`).join(", ") || "none";
