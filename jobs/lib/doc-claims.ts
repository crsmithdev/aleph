/**
 * The check that a doc's claims match the code. It reads the docs as they are when the check runs,
 * so a run after the last edit compares the doc text with the actual values:
 * - each default a doc gives for an `ALEPH_*` setting (a table row `| \`ALEPH_X\` | 5 |`, or
 *   `` `ALEPH_X` (5) ``, `` `ALEPH_X` (default 0.05) ``, `` (`ALEPH_X`, 30 minutes) ``) against the
 *   value the code returns with the variable unset;
 * - each `ALEPH_*` name against the source;
 * - each repo path in backticks against the tree;
 * - each `--flag` of an `aleph` or `aleph-ui` command against the CLI source.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

/** One doc: its repo-relative path and its text. */
export interface Doc { file: string; text: string }

/** A default a doc states for a setting: where, the setting, and the text of the value. */
export interface DefaultClaim { file: string; line: number; name: string; value: string; quote: string }

/** What the check compares the docs with. */
export interface Truth {
  /** The default of each setting with its variable unset; a setting a doc gives a default for must be here. */
  defaults: Record<string, () => string | number>;
  /** The source text the names and flags must appear in. */
  source: string;
  /** The text the `--flags` must appear in as a quoted literal. */
  cliSource: string;
  /** The repo root, for paths. */
  root: string;
}

const NAME = String.raw`ALEPH_[A-Z0-9_]*[A-Z0-9]`;
const TABLE = new RegExp(String.raw`^\|\s*\`(${NAME})\`\s*\|\s*([^|]+?)\s*\|`);
const PAREN = new RegExp(String.raw`\`?(${NAME})\`?\s*\((?:default\s+)?([\d.,_]+)\)`, "g");
const TIME = new RegExp(String.raw`\`(${NAME})\`,\s*([\d.]+\s+(?:seconds?|minutes?|hours?))\)`, "g");

/** The defaults the docs state, one per mention. */
export function defaultClaims(docs: Doc[]): DefaultClaim[] {
  const out: DefaultClaim[] = [];
  for (const d of docs) {
    d.text.split("\n").forEach((text, i) => {
      const line = i + 1;
      const t = text.match(TABLE);
      if (t) out.push({ file: d.file, line, name: t[1], value: t[2], quote: t[0] });
      for (const re of [PAREN, TIME]) for (const m of text.matchAll(re)) out.push({ file: d.file, line, name: m[1], value: m[2], quote: m[0] });
    });
  }
  return out;
}

const UNITS: Record<string, number> = { second: 1, minute: 60, hour: 3600 };

/** A doc value as the code would hold it: a number (times in seconds), else the text without backticks. */
export function normalize(value: string): string | number {
  const v = value.trim();
  const time = v.match(/^([\d.]+)\s+(second|minute|hour)s?$/);
  if (time) return Number(time[1]) * UNITS[time[2]];
  const n = v.replace(/[,_]/g, "");
  if (/^-?\d+(\.\d+)?$/.test(n)) return Number(n);
  return v.replace(/^`(.*)`$/, "$1");
}

/** The settings a doc names, each `ALEPH_*` word once; `ALEPH_<ROLE>_CMD` patterns are left out. */
export function namesIn(docs: Doc[]): { name: string; file: string; line: number }[] {
  const seen = new Set<string>();
  const out: { name: string; file: string; line: number }[] = [];
  for (const d of docs) d.text.split("\n").forEach((text, i) => {
    for (const m of text.matchAll(new RegExp(String.raw`\b${NAME}\b(?!<)`, "g"))) {
      if (seen.has(m[0])) continue;
      seen.add(m[0]);
      out.push({ name: m[0], file: d.file, line: i + 1 });
    }
  });
  return out;
}

/** The repo paths a doc gives in backticks: a folder and a file with an extension, not under ~ or /. */
export function pathsIn(docs: Doc[]): { path: string; file: string; line: number }[] {
  const out: { path: string; file: string; line: number }[] = [];
  for (const d of docs) d.text.split("\n").forEach((text, i) => {
    for (const m of text.matchAll(/`([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+\.[a-z]{1,5})`/g)) out.push({ path: m[1], file: d.file, line: i + 1 });
  });
  return out;
}

/** The `--flags` of `aleph` and `aleph-ui` commands in code spans and code blocks, with the command they follow. */
export function flagsIn(docs: Doc[]): { flag: string; command: string; file: string; line: number }[] {
  const out: { flag: string; command: string; file: string; line: number }[] = [];
  for (const d of docs) {
    let fenced = false;
    d.text.split("\n").forEach((text, i) => {
      if (/^\s*```/.test(text)) { fenced = !fenced; return; }
      const spans = fenced ? [text] : [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
      for (const span of spans) for (const c of span.matchAll(/(?:^|\|)\s*((?:aleph|aleph-ui)\s[^#|]*)/g)) {
        for (const f of c[1].matchAll(/(?<![\w-])--[a-z][a-z-]*/g)) out.push({ flag: f[0], command: c[1].trim(), file: d.file, line: i + 1 });
      }
    });
  }
  return out;
}

/** Each claim the code does not back, as a line that quotes the claim and says what the code has. Empty when all match. */
export function docProblems(docs: Doc[], truth: Truth): string[] {
  const problems: string[] = [];
  for (const c of defaultClaims(docs)) {
    const at = `${c.file}:${c.line}`;
    const get = truth.defaults[c.name];
    if (!get) { problems.push(`${at}: "${c.quote}" states a default for ${c.name}, which the check has no value for`); continue; }
    const doc = normalize(c.value);
    const code = get();
    if (doc !== code) problems.push(`${at}: "${c.quote}" says ${c.name} defaults to ${JSON.stringify(doc)}, the code has ${JSON.stringify(code)}`);
  }
  for (const n of namesIn(docs)) {
    if (!new RegExp(String.raw`\b${n.name}\b`).test(truth.source)) problems.push(`${n.file}:${n.line}: ${n.name} is in no source file`);
  }
  for (const p of pathsIn(docs)) {
    if (!existsSync(join(truth.root, p.path))) problems.push(`${p.file}:${p.line}: \`${p.path}\` does not exist`);
  }
  for (const f of flagsIn(docs)) {
    if (![`"${f.flag}"`, `'${f.flag}'`, `\`${f.flag}`].some((q) => truth.cliSource.includes(q))) problems.push(`${f.file}:${f.line}: "${f.command}" uses ${f.flag}, which the CLI source does not define`);
  }
  return problems;
}
