/** `aleph report`: the runs not yet shown, the issues that came due, the new episodes, the asks and the proposed lessons. See docs/factory.md. */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { money } from "../../../lib/money.ts";
import { LANES, lane, shownId } from "../../../lib/naming.ts";
import * as issues from "../../../lib/todo.ts";
import { afterOf, fetchingOnceSync, priorityOf, readLists, reader } from "../../../lib/store.ts";
import { git } from "../../../lib/git.ts";
import { askOfItem, needsOf, refIn } from "../asks/ask.ts";
import { factoryDir, logEvent } from "../../../lib/layout.ts";
import { allRuns, isWaiting, loadRegistry, onOf, type Entry, allJobs } from "../records/ledger.ts";
import { isRunning } from "../infra/process.ts";
import { checkedBy, lookMinutes } from "../records/job.ts";
import { patchRun } from "../records/record.ts";
import { proposals } from "../learning/corrections.ts";
import { listEpisodes } from "../learning/episode.ts";
import { changedLinesOf } from "../gates/factory-status.ts";
import { paused } from "../gates/pause.ts";
import { runsToday, spentToday } from "../gates/gpu.ts";
import { pendingWaits } from "../gates/issue-decision.ts";
import { decider } from "../gates/decider.ts";
import { errText } from "../../../lib/errtext.ts";

/** The heading a run's report entry goes under: the report lane of its state. */
const laneOf = (e: Entry): string => lane(e.run.state);

/** One run as the report gives it; in an issue's block (`current` says which run is the newest) it leaves out the key the block head shows. */
function entry(e: Entry, current?: boolean): string {
  const r = e.run;
  const needs = isWaiting(r.state) ? needsOf(r.ask) : undefined;
  const lane = laneOf(e);
  const hit = (lane === "landed" || lane === "waiting") && r.repo && onOf(r) !== undefined ? reader().item(r.repo, onOf(r)!) : undefined, prio = hit && priorityOf(hit);
  const head = `${current === undefined ? `${shownId(r.name, r.repo)} ` : ""}${r.state}${current ? " (current)" : ""}${prio === "high" || prio === "critical" ? ` [${prio}]` : ""}${needs ? ` (${needs})` : ""}${r.round && r.state !== "returned" && r.state !== "failed" ? ` after ${r.round} fix rounds` : ""}`;
  const lines = [r.reason ? `${head}: ${r.reason}` : head];
  if (r.state === "landed" && r.commit) {
    lines.push(`  commit ${r.commit.slice(0, 7)}`);
    const j = allJobs().find((x) => x[0].run.job === r.job);
    if (j) lines.push(`  checked by: ${checkedBy(j).join(", ") || "nothing recorded"}`);
    const repo = r.repo ? loadRegistry()[r.repo] : undefined;
    const stat = repo ? git(repo.path, "show", "--shortstat", "--format=", r.commit).out : "";
    if (stat) lines.push(`  look: about ${lookMinutes(changedLinesOf(stat))} min (estimate)`);
  }
  if (needs === "protected" || needs === "review") {
    if (r.stat) lines.push(...r.stat.split("\n").map((l) => `  ${l}`));
    lines.push(`  aleph land ${r.name}   (lands it, with Held-by: Chris)`, `  aleph drop ${r.name}   (drops it; the item stays open)`);
  }
  for (const d of r.defaults ?? []) lines.push(`  DEFAULT: ${d}`);
  for (const c of r.checks ?? []) if (c.rerun) lines.push(`  ${c.name} passed on rerun`);
  if (r.cost !== undefined) lines.push(`  cost ${money(r.cost)} at the API price`);
  return lines.join("\n");
}

/**
 * The runs the report has not shown, oldest first; each is then marked
 * shown, unless `peek`. `told` is Sidetone's flag and the report leaves it alone.
 */
export function report(now = Date.now(), peek = false): string {
  return fetchingOnceSync(() => reportOnce(now, peek));
}

function reportOnce(now: number, peek: boolean): string {
  loadRegistry();
  const lines = runLines(now, peek);
  const due = cameDue();
  if (due.length) lines.unshift(["came due:", ...due.map((d) => `  ${d}`)].join("\n"));
  const eps = newEpisodes();
  if (eps.length) lines.push(["episodes:", ...eps.map((t) => `  ${t}`)].join("\n"));
  const asks = askLines();
  if (asks.length) lines.push(["asks:", ...asks.map((a) => `  ${a}`)].join("\n"));
  const lessons = proposals();
  if (lessons.length) lines.push(["proposed lessons (Yes or No on Status):", ...lessons.map((l) => `  ${l.id} ${l.kind}: ${l.sentence} (${l.count} signals)`)].join("\n"));
  return lines.join("\n");
}

/** Each open issue that has an Ask, by its shown key and title. */
function askLines(): string[] {
  return Object.values(loadRegistry()).flatMap((repo) => (reader({ fetch: false }).list(repo.key)?.items ?? [])
    .filter((item) => issues.status(item) === "open" && askOfItem(item))
    .map((item) => `${shownId(refIn(item), repo.key)} ${item.title}`));
}

const episodesSeenFile = () => join(factoryDir(), "episodes-seen");

/**
 * The episode page titles under `<factoryDir()>/episodes/` that no report has listed. The seen file is then
 * rewritten as the titles on disk, so a page deleted after KEEP_DAYS (episode.ts) leaves it too.
 */
function newEpisodes(): string[] {
  const titles = listEpisodes().map((e) => e.file.slice(0, -3));
  const seen = new Set(existsSync(episodesSeenFile()) ? readFileSync(episodesSeenFile(), "utf8").split("\n").filter(Boolean) : []);
  const fresh = titles.filter((t) => !seen.has(t));
  if (fresh.length || seen.size !== titles.length - fresh.length) {
    mkdirSync(factoryDir(), { recursive: true });
    writeFileSync(episodesSeenFile(), titles.map((t) => t + "\n").join(""));
  }
  return fresh;
}

const seenFile = () => join(factoryDir(), "seen");

/**
 * The open items whose waited-on item is done, that no report has listed;
 * each is then written to the seen file.
 */
function cameDue(): string[] {
  const seen = new Set(existsSync(seenFile()) ? readFileSync(seenFile(), "utf8").split("\n").filter(Boolean) : []);
  const { done } = decider({ fresh: true });
  const lines: string[] = [];
  const ids: string[] = [];
  const repos = Object.values(loadRegistry());
  let docs: (issues.Doc | null)[] = [];
  try { docs = readLists(repos); } catch (e) { logEvent({ subject: "rule", action: "failed", object: "came-due", detail: errText(e) }); }
  for (const [n, repo] of docs.map((_, n) => [n, repos[n]] as const)) {
    for (const item of docs[n]?.items ?? []) {
      const id = `${repo.key}-${item.id}`;
      if (issues.status(item) !== "open" || seen.has(id)) continue;
      const waits = afterOf(item);
      if (waits.length > 0 && !pendingWaits(waits, done).length) {
        ids.push(id);
        lines.push(`${id} ${item.title}`);
      }
    }
  }
  if (ids.length) {
    mkdirSync(factoryDir(), { recursive: true });
    appendFileSync(seenFile(), ids.join("\n") + "\n");
  }
  return lines;
}

/** The runs the report has not shown, oldest first; each is then marked shown unless `peek`, and the last line counts the day's runs. */
function runLines(now: number, peek: boolean): string[] {
  const fresh = allRuns().filter((e) => e.run.shown === false && e.run.role !== "plain" && e.run.state !== "running" && !isRunning(e));
  const lines: string[] = [];
  // The runs of one issue are one block, listed oldest first under the lane of the newest; a run with no issue target is its own.
  const blocks = new Map<string, Entry[]>();
  for (const e of fresh) {
    const k = onOf(e.run) === undefined ? e.id : `${e.run.repo}/${e.run.target}`;
    blocks.set(k, [...blocks.get(k) ?? [], e]);
  }
  const block = (runs: Entry[]) => runs.length === 1 ? entry(runs[0]) : [shownId(runs[0].run.target, runs[0].run.repo), ...runs.map((e, i) => entry(e, i === runs.length - 1).replace(/^/gm, "  "))].join("\n");
  for (const l of LANES) {
    const here = [...blocks.values()].filter((b) => laneOf(b.at(-1)!) === l);
    if (here.length) lines.push(`${l}:`, ...here.map(block));
  }
  if (!peek) for (const e of fresh) patchRun(e.id, { shown: true });
  const today = runsToday(now);
  if (lines.length) lines.push(`runs in the last 24 hours: ${today.length}, ${money(spentToday(now))} at the API price${paused() ? "; the factory is paused" : ""}`);
  return lines;
}
