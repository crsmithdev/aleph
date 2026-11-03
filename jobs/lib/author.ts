/**
 * The author: before a goal's first worker run, one `claude -p` run with no tools writes
 * acceptance scenarios from the goal alone: plain behaviour, no code, so no helper or path
 * in them can be wrong. They go to the work store, the worker never sees them, and the
 * fresh reviewer checks each one on the finished branch. A goal gets one attempt; the
 * issue's note says how it went, and a goal with no scenarios runs as before.
 */
import { note, reader, writeHidden } from "../../todo/lib/store.ts";
import * as issues from "../../todo/lib/todo.ts";
import { section } from "../../todo/lib/todo.ts";
import { callAgent } from "./agent-run.ts";
import type { Repo } from "./ledger.ts";
import { OPUS_MODEL } from "./agent-call.ts";

export const AUTHOR_MODEL = OPUS_MODEL;
/** The file of a goal's scenarios among its hidden files. It is not a test file, so no check runs it. */
export const SCENARIOS = "scenarios.md";
/** The note that marks the attempt; the UI reads it as a machine note. */
const NOTE = "sealed checks:";

/** The goal section only: the author does not see the Oracle or the Edit surface the worker is given, so its scenarios do not follow them. */
export function authorPrompt(item: issues.Issue): string {
  return `Write the acceptance scenarios for one goal. A separate evaluator checks them on the finished work; the builder never sees them.

Write 3 to 8 scenarios, each one sentence: what someone using the result does and what they then observe. Cover every requirement of the goal, including what it says stays fixed. State behaviour only: no test code and no helpers. Add nothing the goal leaves open.

# Goal: ${item.title}

${section(item.spec, "Goal") || item.spec.trim()}

Reply with the numbered scenarios and nothing else.`;
}

/** The number of scenarios in a reply: its lines that start with a number. */
export const scenarioCount = (reply: string): number => reply.match(/^\s*\d+[.)]\s+\S/gm)?.length ?? 0;

/**
 * Give the goal `id` sealed scenarios if it has had no attempt. Returns the author's cost.
 * Nothing here stops the run: a goal with no scenarios is what every goal was before.
 */
export async function seal(repo: Repo, id: number | string): Promise<number | undefined> {
  const item = reader().item(repo.key, id);
  if (!item || !item.spec.trim() || item.notes.some((n) => n.includes(NOTE))) return undefined;
  const ref = `${repo.key}-${issues.refOf(item)}`;
  const say = (text: string) => { note(repo, issues.refOf(item), `${NOTE} ${text}`); };
  let cost: number | undefined;
  try {
    const reply = await callAgent({ role: "author", who: "the author", model: AUTHOR_MODEL, seconds: 600, flags: ["--tools", ""] }, authorPrompt(item));
    cost = reply.cost;
    const n = scenarioCount(reply.text);
    if (!n) { say("none: the author's reply has no numbered scenario"); return cost; }
    writeHidden(repo, ref, { [SCENARIOS]: reply.text.trim() + "\n" });
    say(`${n} scenario${n > 1 ? "s" : ""} from a fresh author`);
  } catch (e: any) {
    say(`none: ${String(e?.message ?? e).slice(0, 200)}`);
  }
  return cost;
}
