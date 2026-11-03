/**
 * The spec check: before a goal's first worker run, one read-only `claude -p` run reads the whole
 * spec (Goal, Edit surface, Oracle) against a clone of `origin/<main>` and says whether the spec
 * can be met. A hold names each problem with a change to the spec. The check runs once for each
 * version of the spec (goal-spec.ts): the issue's note carries the version, so an edit makes it run again.
 * The dispatch never runs it inline: it reads the recorded verdict (`recordedVerdict`) and, when there is
 * none, starts `aleph spec-check` detached (`runSpecCheck`), which ends by starting a dispatch.
 */
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { note, reader } from "../../todo/lib/store.ts";
import * as issues from "../../todo/lib/todo.ts";
import { section } from "../../todo/lib/todo.ts";
import { callAgent } from "./agent-run.ts";
import { git } from "./git.ts";
import { isVersion, specVersion } from "./goal-spec.ts";
import { lock, type Repo } from "./ledger.ts";
import { askChris, plainAsk } from "./ask.ts";
import { factoryDir, issueJob, recordHold, recordSpecCost } from "./factory-status.ts";
import { factoryLog } from "./layout.ts";
import { dispatchDetached } from "./launch.ts";
import { OPUS_MODEL } from "./agent-call.ts";

export const SPEC_CHECK_MODEL = OPUS_MODEL;
const NOTE = "spec check:";

export function specCheckPrompt(item: issues.Issue): string {
  const part = (name: string) => section(item.spec, name) || "(none)";
  return `Check one spec before a builder starts on it. The code of the codebase is your working directory; read it with your tools.

# Spec: ${item.title}

## Goal
${part("Goal")}

## Edit surface
${part("Edit surface")}

## Oracle
${part("Oracle")}

Answer three questions:
1. Can every clause of the Goal and the Oracle be true at the same time in this codebase? Name each pair that cannot.
2. Does the Edit surface hold the code that each Oracle clause needs to change? Name each clause whose code is outside it.
3. Does the Oracle ask for something that no check or reviewer can observe? Name each such clause.

End the reply with one last line, either \`VERDICT: pass\` or \`VERDICT: hold <problems>\`. Each problem must quote the clause and propose a change to the spec.`;
}

/** The last `VERDICT:` line of a reply, or null when it has none. */
export function specVerdict(reply: string): { pass: true } | { pass: false; problems: string } | null {
  const lines = reply.split("\n").map((l) => l.trim().replace(/^[`*\s]+/, "").replace(/[`*\s]+$/, ""));
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/^VERDICT:\s*(.*)$/);
    if (!m) continue;
    const rest = m[1].trim();
    if (/^pass\b/i.test(rest)) return { pass: true };
    const hold = rest.match(/^hold\b[:\s]*(.*)$/i);
    if (hold) return { pass: false, problems: hold[1].trim() };
    return null;
  }
  return null;
}

export async function checkSpec(repo: Repo, id: number | string): Promise<{ verdict: "pass" | "hold" | "skip" | "error"; problems?: string; cost?: number }> {
  const item = reader().item(repo.key, id);
  if (!item || !item.spec.trim()) return { verdict: "skip" };
  if (recordedVerdict(item)) return { verdict: "skip" };
  const version = specVersion(item);
  const say = (text: string) => { note(repo, issues.refOf(item), `${NOTE} ${version} ${text}`); };
  let clone: string | undefined;
  let cost: number | undefined;
  try {
    clone = mkdtempSync(join(tmpdir(), "spec-check-"));
    const c = git(tmpdir(), "clone", "-q", "--shared", "--no-checkout", repo.path, clone);
    if (!c.ok) throw new Error(`clone failed: ${c.out}`);
    // The clone's own origin is `repo.path`, so take that repo's remote-tracking main, not its local one.
    const f = git(clone, "fetch", "-q", repo.path, `+refs/remotes/origin/${repo.main}:refs/remotes/origin/${repo.main}`);
    if (!f.ok) throw new Error(`fetch failed: ${f.out}`);
    const o = git(clone, "checkout", "-q", "--detach", `origin/${repo.main}`);
    if (!o.ok) throw new Error(`checkout failed: ${o.out}`);
    const reply = await callAgent({ role: "speccheck", who: "the spec check", model: SPEC_CHECK_MODEL, seconds: 900, flags: ["--tools", "Read", "Grep", "Glob"], cwd: clone }, specCheckPrompt(item));
    cost = reply.cost;
    const v = specVerdict(reply.text);
    if (!v) { say("error: the reply has no verdict line"); return { verdict: "error", cost }; }
    if (v.pass) { say("pass"); return { verdict: "pass", cost }; }
    say(`hold: ${v.problems}`);
    return { verdict: "hold", problems: v.problems, cost };
  } catch (e: any) {
    say(`error: ${String(e?.message ?? e).replace(/\s+/g, " ").slice(0, 200)}`);
    return { verdict: "error", cost };
  } finally {
    if (clone) rmSync(clone, { recursive: true, force: true });
  }
}

export type Recorded = { verdict: "pass" } | { verdict: "hold"; problems: string } | { verdict: "error"; why: string };

/** The verdict `checkSpec` noted for the goal's current spec version, the last one when there are several; null when this version has none. */
export function recordedVerdict(item: issues.Issue): Recorded | null {
  for (let i = item.notes.length - 1; i >= 0; i--) {
    const m = item.notes[i].replace(/^- \d{4}-\d\d-\d\d \d\d:\d\d: /, "").match(/^spec check: (\S+) (pass|hold|error)\b:?\s*(.*)$/s);
    if (!m || !isVersion(item, m[1])) continue;
    if (m[2] === "pass") return { verdict: "pass" };
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
      recordHold(name, "spec-check", problems);
    }
    factoryLog(`${name}: spec check ${c.verdict}${c.problems ? `: ${c.problems}` : ""}`);
  } finally {
    rmSync(launchFile(name), { force: true });
    release();
  }
  dispatchDetached();
  return c;
}
