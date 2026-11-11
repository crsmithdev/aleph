#!/usr/bin/env bun
/**
 * The adherence candidates of a repo's agent files: lines a regex can find that the evidence in ADHERENCE.md says
 * an agent follows worse, over-applies, or pays for with no gain. Each hit is a candidate, not a finding: the lens
 * proves it. agnix owns the checks it has (negation with no positive, generic instructions, lines past a limit).
 *
 *   emphasis   IMPORTANT, CRITICAL, MUST, NEVER, YOU MUST in capitals, `!!`: current Claude over-applies them
 *   scaffold   "think hard", "be thorough", "don't be lazy": written for older models, now causes overwork
 *   vague      "should", "try to", "where possible", "properly", "best practice": no bar the agent can check
 *   unreasoned a clause that opens with never, always, don't or do not, on a line with no reason (because,
 *              since, so that, otherwise, or a colon before more text)
 *   dated      "as of", "currently", "recently", a date: goes stale and reads as true
 *
 * It also lists each tool the files name in code (`bun`, `uv`): naming a tool makes the agent use it.
 *
 *   bun content.ts [root] [--home <dir>]   JSON, the files with most hits first
 */
import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { load, main } from "./load.ts";

export type Hit = { line: number; check: string; text: string };
type File = { file: string; sentences: number; hits: Hit[] };

const CHECKS: [string, RegExp][] = [
  ["emphasis", /\b(IMPORTANT|CRITICAL|ESSENTIAL|MANDATORY|MUST|NEVER|ALWAYS|REQUIRED)\b|!!/],
  ["scaffold", /\b(think (hard|harder|carefully|step by step)|be (very )?thorough|don'?t be lazy|keep going until|take a deep breath|double[- ]check everything)\b/i],
  ["vague", /\b(should|try to|where possible|if possible|as needed|when appropriate|appropriate(ly)?|properly|as much as possible|best practices?|clean code)\b/i],
  ["unreasoned", /^(?!.*\b(because|since|so that|so the|so it|otherwise|or else)\b)(?!.*:\s\S).*(^|[.;:]\s+|^\s*([-*]|\d+\.)\s+(\*\*[^*]+\*\*\s+)?)(never|always|don'?t|do not)\b/i],
  ["dated", /\b(as of|currently|recently|at the moment|for now)\b|\b20\d\d-\d\d-\d\d\b/i],
];

/** Prose with code spans and fenced blocks blanked, line for line, so line numbers hold. */
function prose(text: string): string[] {
  let fence = false;
  return text.split("\n").map((l) => {
    if (/^\s*(```|~~~)/.test(l)) { fence = !fence; return ""; }
    return fence ? "" : l.replace(/`[^`]*`/g, "``");
  });
}

/** The hits of one file. Frontmatter is checked too: a description is prose the agent reads. */
export function scan(text: string): { sentences: number; hits: Hit[] } {
  const lines = prose(text);
  const hits = lines.flatMap((l, i) => CHECKS.filter(([, re]) => re.test(l)).map(([check]) => ({ line: i + 1, check, text: l.trim().slice(0, 120) })));
  const sentences = lines.join("\n").split(/[.!?](\s|$)|\n\s*[-*\d]+[.)]?\s/).filter((s) => /[a-z]{3}/i.test(s ?? "")).length;
  return { sentences, hits };
}

/** The program of each command the text shows: a code span with arguments, or a line of a shell fence, on PATH. */
export function tools(text: string): string[] {
  const spans = [...text.matchAll(/`([^`\n]+ [^`\n]+)`/g)].map((m) => m[1]);
  const fenced = [...text.matchAll(/```(?:sh|bash|shell|console)?\n([\s\S]*?)```/g)].flatMap((m) => m[1].split("\n"));
  const words = [...spans, ...fenced].map((s) => s.trim().replace(/^\$\s*/, "").split(/\s/)[0]).filter((w) => /^[a-z][\w.-]+$/.test(w));
  return [...new Set(words)].filter((w) => Bun.which(w)).sort();
}

function content(root: string, home = homedir()) {
  const l = load(root, home);
  const abs = (f: string) => (f.startsWith("~") ? join(home, f.slice(1)) : join(root, f));
  const real = new Map([...l.always, ...l.lazy].map((i) => [realpathSync(abs(i.file)), i.file]));
  const names = [...real.values()];
  const files: File[] = names.map((f) => ({ file: f, ...scan(readFileSync(abs(f), "utf8")) }));
  const used = new Map<string, string[]>();
  for (const f of names) for (const t of tools(readFileSync(abs(f), "utf8"))) used.set(t, [...(used.get(t) ?? []), f]);
  const counts = Object.fromEntries(CHECKS.map(([c]) => [c, files.reduce((n, f) => n + f.hits.filter((h) => h.check === c).length, 0)]));
  return {
    counts,
    files: files.filter((f) => f.hits.length).sort((a, b) => b.hits.length - a.hits.length),
    tools: [...used].map(([name, by]) => ({ name, files: by.length })).sort((a, b) => b.files - a.files),
  };
}

if (import.meta.main) main(content);
