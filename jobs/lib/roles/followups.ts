/** A worker's follow-ups and flakes: the issues and notes its reply files. */
import * as issues from "../../../lib/todo.ts";
import { file as fileIssues, note, noteFlake, reader } from "../../../lib/store.ts";
import type { Followup } from "../gates/gate.ts";
import type { Repo, Run } from "../records/ledger.ts";
import { filing } from "../transitions/filing.ts";
import { writeTitle } from "./title.ts";

/**
 * A worker's `followups` (at most 3) each become a `task` with `source: worker`: the title writer's title, and the run, the location, what the worker saw, why it matters and the score in its request,
 * filed parked in one store commit, so Chris picks which to open. The priority comes from the score, (impact + risk) x (6 - effort): high at 30 or more, medium from 15, else low. An empty title such as "none" files nothing, and a title on the topic of an open or parked issue is a note on that issue. This reverses the aleph-826 choice (a log and no issue), which the spec supersedes.
 * `by` says who found it, as the request's words. Its `flakes` become notes on the repo's flake tracker; they file no issue and start no intake.
 */
export async function fileFollowups(repo: Repo, run: Run, followups: Followup[], flakes: string[], by = `the worker met in run ${run.name}`): Promise<void> {
  noteFlakes(repo, run, flakes);
  const lists = reader();
  const open = (lists.list(repo.key)?.items ?? []).filter((i) => ["open", "parked"].includes(issues.status(i)));
  const fresh: Followup[] = [];
  for (const f of followups) {
    if (/^(none|n\/a|nothing)\.?$/i.test(f.title.trim())) continue;
    // Chris paused flake follow-ups on 1 Nov 2026: a title about a flake is a tracker note, and files no issue.
    if (/\bflak/i.test(f.title)) { noteFlakes(repo, run, [f.title]); continue; }
    if (fresh.some((g) => sameTopic(g.title, f.title))) continue;
    const same = open.find((i) => sameTopic(i.title, f.title));
    if (same) note(repo, same.id, `also met in run ${run.name}: ${f.title}`);
    else fresh.push(f);
  }
  const files = fresh.slice(0, 3);
  if (!files.length) return;
  const titles = await Promise.all(files.map((f) => writeTitle(f.title)));
  fileIssues(repo, `followups from ${run.name}`, files.map((f, n) => {
    const score = (f.impact + f.risk) * (6 - f.effort);
    return {
      title: titles[n], kind: "task", priority: score >= 30 ? "high" : score >= 15 ? "medium" : "low", source: "worker" as const, parked: true,
      request: `A follow-up ${by}:\n\nFOLLOWUP: ${f.title}\nLocation: ${f.location}\nSeen: ${f.saw}\nWhy it matters: ${f.why}\nScore: ${score} (impact ${f.impact}, risk ${f.risk}, effort ${f.effort})`,
    };
  }), "worker", filing);
}

const PATH = /[\w.-]+(?:\/[\w.-]+)+|[\w-]+\.(?:ts|js|md|json)\b/g;
const COMMON = new Set(["the", "and", "for", "from", "with", "that", "this", "not", "but", "are", "was", "its", "into"]);
/**
 * Two titles say the same thing: most of the shorter title's words are in the other, half with a
 * shared file path, 70% without. A shared path alone is not enough: busy files have unrelated issues.
 */
export function sameTopic(a: string, b: string): boolean {
  const paths = (t: string) => new Set(t.match(PATH) ?? []);
  const words = (t: string) => new Set((t.replace(PATH, " ").toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? []).filter((w) => !COMMON.has(w)));
  const [wa, wb] = [words(a), words(b)];
  const [short, long] = wa.size <= wb.size ? [wa, wb] : [wb, wa];
  if (!short.size) return false;
  const pb = paths(b);
  const shared = [...paths(a)].some((p) => pb.has(p));
  return [...short].filter((w) => long.has(w)).length / short.size >= (shared ? 0.5 : 0.7);
}

/** Each line a note on the repo's flake tracker. */
function noteFlakes(repo: Repo, run: Run, lines: string[]): void {
  for (const line of lines) noteFlake(repo, `job ${run.name}: ${line}`);
}
