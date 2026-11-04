/**
 * The author: in the spec check (spec-check.ts), one `claude -p` run with no tools writes
 * acceptance scenarios from the goal alone: plain behaviour, no code, so no helper or path
 * in them can be wrong. They go to the work store, the worker never sees them, and the
 * fresh reviewer checks each one on the finished branch. Each spec version gets one attempt,
 * and its scenarios replace those of the version before; the issue's note says how it went,
 * and a goal with no scenarios runs as before.
 */
import { note, parentOf, partsOf, reader, writeHidden } from "../../todo/lib/store.ts";
import * as issues from "../../todo/lib/todo.ts";
import { section } from "../../todo/lib/todo.ts";
import { callAgent } from "./agent-run.ts";
import type { Repo } from "./ledger.ts";
import { OPUS_MODEL } from "./agent-call.ts";
import { specVersion } from "./goal-spec.ts";

export const AUTHOR_MODEL = OPUS_MODEL;
/** The file of a goal's scenarios among its hidden files. It is not a test file, so no check runs it. */
export const SCENARIOS = "scenarios.md";
/** The note that marks the attempt, `sealed checks: <version> <how it went>`; the UI reads it as a machine note. */
const NOTE = "sealed checks:";

/** Whether a note line is the attempt note of a spec version: after it, the goal's scenarios are that version's. */
export const isSealNote = (line: string): boolean => /sealed checks: [0-9a-f]{12} (?:\d+ scenarios? from a fresh author|none\b)/.test(line);

/**
 * The goal section only: the author does not see the Oracle or the Edit surface the worker is given, so its scenarios do not follow them.
 * For a part, the Goal is the part's own, and `others` are the titles of the other parts, whose work its scenarios leave out.
 */
export function authorPrompt(item: issues.Issue, others: string[] = []): string {
  return `Write the acceptance scenarios for one goal. A separate evaluator checks them on the finished work; the builder never sees them.

Write 3 to 8 scenarios, each one sentence: what someone using the result does and what they then observe. Cover every requirement of the goal, including what it says stays fixed. State behaviour only: no test code and no helpers. Add nothing the goal leaves open.

# Goal: ${item.title}

${section(item.spec, "Goal") || item.spec.trim()}
${others.length ? `\nThis goal is one part of a larger goal. These other parts do the rest of it, and are checked on their own: write no scenario for their work.\n\n${others.map((t) => `- ${t}`).join("\n")}\n` : ""}
Reply with the numbered scenarios and nothing else.`;
}

/** The number of scenarios in a reply: its lines that start with a number. */
export const scenarioCount = (reply: string): number => reply.match(/^\s*\d+[.)]\s+\S/gm)?.length ?? 0;

/** The scenarios text without the scenarios numbered in `drop`; the others keep their numbers. Empty when no scenario is left. */
export function withoutScenarios(text: string, drop: Set<number>): string {
  let skip = false;
  const kept = text.split("\n").filter((line) => {
    const m = /^\s*(\d+)[.)]\s+\S/.exec(line);
    if (m) skip = drop.has(Number(m[1]));
    return !skip;
  }).join("\n");
  return scenarioCount(kept) ? kept.trim() + "\n" : "";
}

/**
 * Give the goal `id` sealed scenarios for its spec version, if that version has had no attempt. Returns the author's cost.
 * Nothing here stops the run: a goal with no scenarios is what every goal was before.
 */
export async function seal(repo: Repo, id: number | string): Promise<number | undefined> {
  const lists = reader();
  const item = lists.item(repo.key, id);
  if (!item || !item.spec.trim()) return undefined;
  const version = specVersion(item);
  if (item.notes.some((n) => n.includes(`${NOTE} ${version} `))) return undefined;
  // A part's scenarios come from its own Goal; its siblings are named only so the author leaves their work out.
  const doc = lists.list(repo.key)!;
  const parent = parentOf(doc, item);
  const others = parent ? partsOf(doc, parent).filter((p) => p !== item).map((p) => p.title) : [];
  const ref = `${repo.key}-${issues.refOf(item)}`;
  const say = (text: string) => { note(repo, issues.refOf(item), `${NOTE} ${version} ${text}`); };
  // An earlier version's scenarios do not hold for this one: a version with none empties the file.
  const none = (why: string) => {
    if (item.notes.some((n) => n.includes(NOTE))) writeHidden(repo, ref, { [SCENARIOS]: "" });
    say(`none: ${why}`);
  };
  let cost: number | undefined;
  try {
    const reply = await callAgent({ role: "author", who: "the author", model: AUTHOR_MODEL, seconds: 600, flags: ["--tools", ""] }, authorPrompt(item, others));
    cost = reply.cost;
    const n = scenarioCount(reply.text);
    if (!n) { none("the author's reply has no numbered scenario"); return cost; }
    writeHidden(repo, ref, { [SCENARIOS]: reply.text.trim() + "\n" });
    say(`${n} scenario${n > 1 ? "s" : ""} from a fresh author`);
  } catch (e: any) {
    const why = String(e?.message ?? e).slice(0, 200);
    try { none(why); } catch { say(`none: ${why}`); }
  }
  return cost;
}
