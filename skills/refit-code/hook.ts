#!/usr/bin/env bun
/**
 * The refit-code Stop hook: the tool holds of the skill. It asks three questions of the current change, with no model:
 *
 *   co-change   a file that history says changes with a changed file (confidence ≥ 0.7) is left out
 *   boundaries  a changed file holds a copy of code that `.jscpd.json` keeps inside its owner
 *   new copies  a changed file holds a copy of code (renamed copies too) that the branch's base did not have
 *
 * A finding blocks the stop once per session, with the evidence, so the agent changes the companion, calls the
 * owner, or records the second way in `.refit.json`. The same findings do not block twice, and a stop that a
 * Stop hook already continued is never blocked. A change from before the session started is not the agent's: the
 * hook counts only the commits and edits since the session's start.
 */
import { createHash } from "node:crypto";
import { once, session } from "../../hooks/lib/handshake.ts";
import { scan } from "./clones.ts";
import { accepted, base, changed, history, holes, isAccepted, rules } from "./cochange.ts";

const at = (s: { name: string; start: number; function?: string }) => `${s.name}:${s.start}${s.function ? ` (${s.function})` : ""}`;

/** The block reason for the findings, or null when there are none. */
function reason(root: string, since = 0): string | null {
  const from = base(root);
  const change = changed(root, from, since);
  if (!change.size) return null;
  const ok = accepted(root);
  const left = holes(root, change, rules(history(root)), ok);
  const { clones, violations } = scan(root, from || undefined);
  const copies = violations.filter((v) => change.has(v.copy.name));
  const pasted = clones.filter((c) => c.isNew && (change.has(c.a.name) || change.has(c.b.name)) && !copies.some((v) => v.copy.name === c.a.name || v.copy.name === c.b.name) && !isAccepted(ok, c.a.name, c.b.name));
  if (!left.length && !copies.length && !pasted.length) return null;
  const lines = [
    ...left.map((h) => `- ${h.a} changed; ${h.b} changed with it in ${h.co} of ${h.n} commits (confidence ${h.conf.toFixed(2)}, e.g. ${h.shas.join(" ")}). Change ${h.b} too, or record the pair in .refit.json.`),
    ...copies.map((v) => `- ${at(v.copy)} copies ${at(v.owner)}, which boundary "${v.rule}" keeps in its owner. Call the owner instead.`),
    ...pasted.map((c) => `- ${c.b.name}:${c.b.start}-${c.b.end} repeats ${c.a.name}:${c.a.start}-${c.a.end} (${c.lines} lines), a copy the base did not have. Call or extend the first, or record the pair in .refit.json.`),
  ];
  return `Refit: this change may add a second way or leave a copy behind.\n${lines.join("\n")}\nA second way on purpose goes in .refit.json as {"copies": [...], "reason": "..."} under "accepted".`;
}

if (import.meta.main) {
  const input = JSON.parse(await Bun.stdin.text());
  if (input.hook_event_name !== "Stop" || input.stop_hook_active === true) process.exit(0);
  const top = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], { cwd: input.cwd ?? process.cwd(), stdout: "pipe", stderr: "ignore" });
  if (top.exitCode !== 0) process.exit(0);
  const text = reason(top.stdout.toString().trim(), session(input.session_id).get()?.start);
  if (!text) process.exit(0);
  const blocked = once(`oneway:${input.session_id}:${createHash("sha1").update(text).digest("hex").slice(0, 12)}`);
  if (blocked.seen()) process.exit(0);
  blocked.mark();
  console.log(JSON.stringify({ decision: "block", reason: text }));
}
