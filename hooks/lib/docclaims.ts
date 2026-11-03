/**
 * The deterministic check on a final message that says a doc matches the code.
 * It reads the turn's entries, not the doc: a message with no such claim is not checked, whatever
 * the docs say. docs/verify-gate.md, decision 10. It names:
 * - a claim with no run after the last edit that reads or compares code;
 * - claimed values (backticked words, numbers with a unit) hidden in a run's cut output, when a run after the last edit was cut;
 * - a cited `file:line` that no run's visible output shows;
 * - a code file the message names ("as the code on main has them") that no tool call touched.
 */
import { bashResult, resultText } from "./digest.ts";

type Entry = Record<string, any>;

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
/** A Bash command that changes files. A `git commit` changes none, so its part of the command (often a heredoc message) is not read. */
const BASH_EDIT = /\bsed\s+(-\w*i|--in-place)|\bgit\s+(apply|checkout|restore|merge)\b|\bpatch\b|<<-?\s*['"]?\w+|(^|[^>&])>>?\s*[\w./~$"'-]|\btee\b/;
const bashEdits = (command: string) => BASH_EDIT.test(command.replace(/\bgit\s+commit\b[\s\S]*$/, ""));
/** A Bash command that reads code or compares it with something. */
const READS = /\b(grep|rg|sed|cat|head|tail|awk|diff|wc|nl)\b|\bgit\s+(show|grep|diff|log)\b|\bdoc-claims\b|\bbun\s+(run\s+)?test\b/;
const CODE_FILE = /[\w@./-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|sh|py|md)\b/g;

/** Whether `message` says a doc or a README matches, agrees with or is backed by the code. */
export function claimsDocMatch(message: string): boolean {
  const doc = String.raw`(?:docs?|documentation|readme|settings?\s+defaults|defaults)`;
  const strong = String.raw`(?:match(?:es|ed)?|agree[sd]?|consistent|in\s+sync)`;
  const weak = String.raw`(?:accurate|correct|compared|checked|confirmed|verified)`;
  // Within one sentence: a period ends it only before a space or the end, so `docs/ui.md` stays inside.
  const gap = String.raw`(?:[^.\n]|\.(?=\S)){0,120}`;
  const pair = (verb: string) => new RegExp(String.raw`\b${doc}\b${gap}\b${verb}\b|\b${verb}\b${gap}\b${doc}\b`, "i");
  // A weak verb counts only when the sentence also names the code side: "an edited spec is checked first" is no claim.
  const code = /\bcode\b|\bsettings?\b|[\w@./-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|sh|py)\b/i;
  return message.split(/\.(?=\s|$)|\n/).some((s) => pair(strong).test(s) || (pair(weak).test(s) && code.test(s)))
    || /\bas\s+the\s+code\s+(?:on\s+\w+\s+)?has\s+them\b/i.test(message);
}

interface Call { index: number; name: string; input: Entry; out: string; visible: string }

function calls(entries: Entry[]): Call[] {
  const results = new Map<string, Entry>();
  for (const e of entries) {
    if (e.type !== "user" || !Array.isArray(e.message?.content)) continue;
    for (const b of e.message.content) if (b.type === "tool_result") results.set(b.tool_use_id, e);
  }
  const out: Call[] = [];
  for (const e of entries) {
    if (e.type !== "assistant" || !Array.isArray(e.message?.content)) continue;
    for (const b of e.message.content) {
      if (b.type !== "tool_use") continue;
      const r = results.get(b.id);
      const full = r ? resultText(r) : "";
      out.push({ index: out.length, name: b.name ?? "tool", input: b.input ?? {}, out: full, visible: b.name === "Bash" ? bashResult(full) : full });
    }
  }
  return out;
}

const isEdit = (c: Call) => EDIT_TOOLS.has(c.name) || (c.name === "Bash" && bashEdits(String(c.input.command ?? "")));

/** What the message claims that the turn does not back, one sentence each. Empty: no claim, or all backed. */
export function docClaimProblems(entries: Entry[], message: string): string[] {
  if (!claimsDocMatch(message)) return [];
  const all = calls(entries);
  const lastEdit = all.reduce((n, c) => (isEdit(c) ? c.index : n), -1);
  const after = all.filter((c) => c.index > lastEdit && c.name === "Bash" && !isEdit(c));
  const problems: string[] = [];

  const comparing = after.filter((c) => READS.test(String(c.input.command ?? "")));
  if (!comparing.length) {
    problems.push(`no run after the last edit reads or compares the code with the doc text${lastEdit >= 0 ? "" : " (the turn has no edit, so any run counts but none reads code)"}`);
  }

  const cut = after.filter((c) => c.visible !== c.out);
  if (cut.length) {
    const shown = after.map((c) => c.visible).join("\n").toLowerCase();
    const claimed = new Set<string>();
    for (const m of message.matchAll(/`([^`\n]{2,60})`|\b(\d+(?:\.\d+)?\s*(?:s|seconds?|minutes?|hours?|ms|%|tries|a tick))\b/g)) claimed.add((m[1] ?? m[2]).trim());
    const hidden = [...claimed].filter((v) => !shown.includes(v.toLowerCase()) && cut.some((c) => c.out.toLowerCase().includes(v.toLowerCase())));
    if (hidden.length) problems.push(`the output of ${cut.length > 1 ? "runs" : "a run"} after the last edit was cut, and the cut part holds ${hidden.slice(0, 5).map((v) => `\`${v}\``).join(", ")}, which the digest does not show`);
  }

  const visible = all.map((c) => c.visible).join("\n");
  const unshown = new Set<string>();
  for (const m of message.matchAll(/`?([\w@./-]+\.\w+):(\d+)(?:-\d+)?`?/g)) {
    const [, file, line] = m;
    const base = file.split("/").pop()!;
    const lines = new RegExp(String.raw`^\s*${line}[:\t|-]`, "m");
    const shownAt = visible.includes(`${file}:${line}`) || visible.includes(`${base}:${line}`) || (visible.includes(base) && lines.test(visible)) || all.some((c) => c.name === "Bash" && String(c.input.command ?? "").includes(base) && lines.test(c.visible));
    if (!shownAt) unshown.add(`${file}:${line}`);
  }
  if (unshown.size) problems.push(`no run's visible output shows ${[...unshown].slice(0, 5).map((s) => `\`${s}\``).join(", ")}`);

  const touched = JSON.stringify(all.map((c) => c.input));
  const named = new Set((message.match(CODE_FILE) ?? []).filter((f) => !/^https?:/.test(f) && f.includes("/")));
  const unread = [...named].filter((f) => !touched.includes(f) && !touched.includes(f.split("/").pop()!));
  if (unread.length) problems.push(`no tool call this turn touches ${unread.slice(0, 5).map((f) => `\`${f}\``).join(", ")}, which the message gives facts about`);

  return problems;
}
