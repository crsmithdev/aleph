/**
 * The spec check: before a goal's first worker run, one read-only `claude -p` run reads the whole
 * spec (Goal, Edit surface, Oracle) against a clone of `origin/<main>` and says whether the spec
 * can be met. A hold names each problem with a change to the spec. The check runs once for each
 * version of the spec (goal-spec.ts): the issue's note carries the version, so an edit makes it run again.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { note, reader } from "../../todo/lib/store.ts";
import * as issues from "../../todo/lib/todo.ts";
import { section } from "../../todo/lib/todo.ts";
import { callAgent } from "./agent-run.ts";
import { git } from "./git.ts";
import { isVersion, specVersion } from "./goal-spec.ts";
import type { Repo } from "./ledger.ts";

export const SPEC_CHECK_MODEL = "claude-opus-5-5";
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
  const checked = (n: string) => {
    const m = n.replace(/^- \d{4}-\d\d-\d\d \d\d:\d\d: /, "").match(/^spec check: (\S+)/);
    return !!m && isVersion(item, m[1]);
  };
  if (item.notes.some(checked)) return { verdict: "skip" };
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
