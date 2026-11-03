/**
 * The deterministic check on a final message that says a doc matches the code.
 * It reads the turn's entries and the docs the turn writes, not the docs on disk: a turn with no such
 * claim is not checked, whatever the docs say. docs/verify-gate.md, decision 10. It names:
 * - a claim with no run after the last edit that reads a doc and compares it with the code;
 * - the values a claim gives (backticked text, numbers) that no such run's visible output shows;
 * - a cited `file:line` that no run's visible output shows;
 * - a code file that a claim, or a line "as the code on main has them" that the turn wrote (by an edit tool or a Bash heredoc or redirect), names
 *   and that no tool call other than an edit touches.
 */
import { bashResult, resultText } from "./digest.ts";

type Entry = Record<string, any>;

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
/** A Bash command that changes files. A `git commit` changes none, so its part of the command (often a heredoc message) is not read. */
const BASH_EDIT = /\bsed\s+(-\w*i|--in-place)|\bgit\s+(apply|checkout|restore|merge)\b|\bpatch\b|<<-?\s*['"]?\w+|(^|[^>&])>>?\s*[\w./~$"'-]|\btee\b/;
const bashEdits = (command: string) => BASH_EDIT.test(command.replace(/\bgit\s+commit\b[\s\S]*$/, ""));
/** A Bash command that reads files or compares them; a diff of names or counts only does not. */
const READS = /\b(grep|rg|sed|cat|head|tail|awk|diff|nl)\b|\bgit\s+(show|grep|diff)\b|\bdoc-claims\b/;
const NAMES_ONLY = /--(stat|name-only|name-status|numstat|shortstat)\b|\bgrep\s+(-\w*[lLc]\b)/;
/** Text that names a doc. */
const NAMES_DOC = /\.md\b|\breadme\b|\bdoc-claims\b/i;
const CODE_FILE = /[\w@./-]*\w\.(?:ts|tsx|js|jsx|mjs|cjs|json|sh|py)\b/g;

const DOC = String.raw`(?:docs?|documentation|readme|spec(?![\s-]check)|settings?\s+defaults|defaults)`;
/** Verbs that state a match on their own. */
const STATE = String.raw`(?:match(?:es|ed)?|agree[sd]?|consistent|in\s+sync|accurate|correct)`;
/** Verbs that say something was done; a claim only in a sentence that also names the code side. */
const ACTION = String.raw`(?:compared|checked|confirmed|verified)`;
const CODE_SIDE = /\bcode\b|\bsettings?\b|[\w@./-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|sh|py)\b/i;
const AS_CODE = /\bas\s+the\s+code\s+(?:on\s+\w+\s+)?has\s+them\b/i;
// Within one sentence: a period ends it only before a space or the end, so `docs/ui.md` stays inside.
const GAP = String.raw`(?:[^.\n]|\.(?=\S)){0,120}`;
const pair = (verb: string) => new RegExp(String.raw`\b${DOC}\b${GAP}\b${verb}\b|\b${verb}\b${GAP}\b${DOC}\b`, "i");
const sentences = (text: string) => text.split(/\.(?=\s|$)|\n/).map((s) => s.trim()).filter(Boolean);

/** The sentences of `message` that say a doc, a spec or a README matches, agrees with or is backed by the code. */
export function claimSentences(message: string): string[] {
  return sentences(message).filter((s) => pair(STATE).test(s) || (pair(ACTION).test(s) && CODE_SIDE.test(s)) || AS_CODE.test(s));
}

/** Whether `message` says a doc, a spec or a README matches, agrees with or is backed by the code. */
export const claimsDocMatch = (message: string): boolean => claimSentences(message).length > 0;

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

/** The text a call writes: a Write's content, an Edit's new text, or a Bash edit's command (a heredoc body, as in `aleph issue add --spec - <<EOF`). */
function docWritten(c: Call): string {
  if (c.name === "Bash") return isEdit(c) ? String(c.input.command ?? "") : "";
  if (!EDIT_TOOLS.has(c.name)) return "";
  return [c.input.content, c.input.new_string, ...(Array.isArray(c.input.edits) ? c.input.edits.map((e: Entry) => e.new_string) : [])].filter((x) => typeof x === "string").join("\n");
}

const quote = (s: string) => `"${s.length > 120 ? `${s.slice(0, 117)}...` : s}"`;
const ticks = (xs: string[]) => xs.slice(0, 5).map((x) => `\`${x}\``).join(", ");

/** What the message, or a doc the turn writes, claims that the turn does not back, one sentence each. Empty: no claim, or all backed. */
export function docClaimProblems(entries: Entry[], message: string): string[] {
  const all = calls(entries);
  const claims = claimSentences(message);
  const written = all.flatMap((c) => sentences(docWritten(c)).filter((s) => AS_CODE.test(s)));
  if (!claims.length && !written.length) return [];
  const lastEdit = all.reduce((n, c) => (isEdit(c) ? c.index : n), -1);
  const after = all.filter((c) => c.index > lastEdit && c.name === "Bash" && !isEdit(c));
  const problems: string[] = [];

  if (claims.length) {
    const comparing = after.filter((c) => {
      const cmd = String(c.input.command ?? "");
      return READS.test(cmd) && !NAMES_ONLY.test(cmd) && (NAMES_DOC.test(cmd) || NAMES_DOC.test(c.visible));
    });
    if (!comparing.length) {
      problems.push(`no run after the last edit reads the doc and compares it with the code, so nothing backs ${claims.slice(0, 3).map(quote).join(", ")}`);
    } else {
      const shown = comparing.map((c) => c.visible).join("\n").toLowerCase();
      const values = new Set<string>();
      for (const s of claims) {
        const plain = s.replace(/`?[\w@./-]+\.\w+:\d+(?:-\d+)?`?/g, " ");
        for (const m of plain.matchAll(/`([^`\n]{1,60})`|(?<![\w.])(\d+(?:\.\d+)?)(?![\w.])/g)) {
          const v = (m[1] ?? m[2]).trim();
          if (v && !/[\/]|\.\w{1,4}$/.test(v)) values.add(v);
        }
      }
      const unseen = [...values].filter((v) => !shown.includes(v.toLowerCase()));
      if (unseen.length) problems.push(`no visible output of a comparing run after the last edit shows ${ticks(unseen)}, which ${claims.length > 1 ? "the claims give" : `${quote(claims[0])} gives`}`);
    }
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
  if (unshown.size) problems.push(`no run's visible output shows ${ticks([...unshown])}`);

  // A file counts as read when a call other than an edit names it; writing a doc about it is not reading it.
  const read = JSON.stringify(all.filter((c) => !isEdit(c)).map((c) => c.input));
  for (const s of [...claims, ...written]) {
    const named = [...new Set(s.match(CODE_FILE) ?? [])].filter((f) => !/^https?:/.test(f));
    const unread = named.filter((f) => !read.includes(f.split("/").pop()!));
    if (unread.length) problems.push(`no tool call this turn reads ${ticks(unread)}, which ${quote(s)} gives facts about`);
  }

  return problems;
}
