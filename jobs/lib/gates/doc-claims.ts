/**
 * The check that a doc's claims match the code. It reads the docs and the tree as they are when the
 * check runs, so a run after the last edit compares the doc text with the actual values:
 * - each default a doc gives for an `ALEPH_*` setting (a table row `| \`ALEPH_X\` | 5 |`, or
 *   `` `ALEPH_X` (5) ``, `` `ALEPH_X` (default 0.05) ``, `` (`ALEPH_X`, 30 minutes) ``, `` `ALEPH_X` (600 s) ``,
 *   `ALEPH_X, else 3020`, `` `ALEPH_X` defaults to 5 ``) against the value the code returns with the variable unset;
 * - each default a doc gives only in prose, with no setting beside it (`no output for 10 minutes`, `above 0.75 of the
 *   threshold`), against the code constant that PROSE_DEFAULTS maps the phrase to; a time is converted to seconds;
 * - each `ALEPH_*` name against the source;
 * - each repo path in backticks, in a relative link or in a link to this repo on GitHub, against the tree;
 * - each `path:line` in backticks against the length of that file (a bare file name must name one file of the tree);
 * - each `` `name` (`path:line`) ``, `` `name` in `path:line` `` and `` (`name`, `path:line`) `` against the lines of that file: the line or range must define the name;
 * - each `` `name` in `path` `` (also `from`, `of`, `` `path`'s `name` ``) against the text of that file: it must define the name (a function, class, const, let, var, interface, type, enum or member key; a non-identifier such as a selector need only appear);
 * - each `` `.selector` in `path.css` `` (also `from`, `of`) against the text of that file;
 * - each `` `path` imports only `a` and `b` `` against the imports of that file;
 * - each `--flag` of an `aleph` or `aleph-ui` command against the CLI source.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, normalize as normPath } from "node:path";

/** One doc: its repo-relative path and its text. */
export interface Doc { file: string; text: string }

/** A default a doc states for a setting: where, the setting, and the text of the value. */
interface DefaultClaim { file: string; line: number; name: string; value: string; quote: string }

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
  /** The repo's files, repo-relative, for a bare file name in a `file:line`. Empty: bare names are not checked. */
  files?: string[];
}

const NAME = String.raw`ALEPH_[A-Z0-9_]*[A-Z0-9]`;
const UNIT = String.raw`(?:s|seconds?|minutes?|hours?)`;
const TABLE = new RegExp(String.raw`^\|\s*\`(${NAME})\`\s*\|\s*([^|]+?)\s*\|`);
const PAREN = new RegExp(String.raw`\`?(${NAME})\`?\s*\((?:default\s+)?([\d.,_]+(?:\s+${UNIT})?)\)`, "g");
const TIME = new RegExp(String.raw`\`(${NAME})\`,\s*([\d.]+\s+${UNIT})\)`, "g");
const PROSE = new RegExp(String.raw`\`?(${NAME})\`?,?\s+(?:else|defaults\s+to|default\s+is|by\s+default)\s+(\`[^\`]+\`|[\d.,_]*\d(?:\s+${UNIT}\b)?)`, "g");

/** Calls `fn` on each line of each doc, with its 1-based number. */
function each(docs: Doc[], fn: (d: Doc, text: string, line: number) => void): void {
  for (const d of docs) d.text.split("\n").forEach((text, i) => fn(d, text, i + 1));
}

/** The defaults the docs state, one per mention. */
function defaultClaims(docs: Doc[]): DefaultClaim[] {
  const out: DefaultClaim[] = [];
  each(docs, (d, text, line) => {
    const t = text.match(TABLE);
    if (t) out.push({ file: d.file, line, name: t[1], value: t[2], quote: t[0] });
    for (const re of [PAREN, TIME, PROSE]) for (const m of text.matchAll(re)) out.push({ file: d.file, line, name: m[1], value: m[2], quote: m[0] });
  });
  return out;
}

/** A default stated in prose: the phrase (group 1 is the value), the code file and the pattern whose group 1 is the code's value. */
interface ProseDefault { phrase: RegExp; file: string; code: RegExp; name: string }

/** Each prose phrase and the code constant it states. */
const PROSE_DEFAULTS: ProseDefault[] = [
  { phrase: new RegExp(String.raw`\bno output for (\d[\d.]*\s+${UNIT})`, "g"), file: "jobs/lib/infra/settings.ts", code: /\bstallSeconds\b[^\n]*?,\s*([\d.]+)\)/, name: "stallSeconds" },
  { phrase: /\babove (\d*\.\d+) of the threshold/g, file: "hooks/lib/context.ts", code: /\bDEFAULT_WARN\s*=\s*([\d.]+)/, name: "DEFAULT_WARN" },
];

/** The defaults the docs state in prose, one per mention. */
function proseClaims(docs: Doc[]): (DefaultClaim & { def: ProseDefault })[] {
  const out: (DefaultClaim & { def: ProseDefault })[] = [];
  each(docs, (d, text, line) => {
    for (const def of PROSE_DEFAULTS) for (const m of text.matchAll(def.phrase)) out.push({ file: d.file, line, name: def.name, value: m[1], quote: m[0], def });
  });
  return out;
}

const UNITS: Record<string, number> = { s: 1, second: 1, minute: 60, hour: 3600 };

/** A doc value as the code would hold it: a number (times in seconds), else the text without backticks. */
function normalize(value: string): string | number {
  const v = value.trim();
  const time = v.match(/^([\d.]+)\s+(s|second|minute|hour)s?$/);
  if (time) return Number(time[1]) * UNITS[time[2]];
  const n = v.replace(/[,_]/g, "");
  if (/^-?\d+(\.\d+)?$/.test(n)) return Number(n);
  return v.replace(/^`(.*)`$/, "$1");
}

/** The code's value in the form the doc gives it: a numeric string compares as its number. */
const asValue = (v: string | number): string | number => typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;

/** The settings a doc names, each `ALEPH_*` word once; `ALEPH_<ROLE>_CMD` patterns are left out. */
function namesIn(docs: Doc[]): { name: string; file: string; line: number }[] {
  const seen = new Set<string>();
  const out: { name: string; file: string; line: number }[] = [];
  each(docs, (d, text, line) => {
    for (const m of text.matchAll(new RegExp(String.raw`\b${NAME}\b(?!<)`, "g"))) {
      if (seen.has(m[0])) continue;
      seen.add(m[0]);
      out.push({ name: m[0], file: d.file, line });
    }
  });
  return out;
}

const PATH = String.raw`(?!\.\.?\/)[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+\.[a-z]{1,5}`;
const REPO_URL = /https:\/\/github\.com\/crsmithdev\/aleph\/(?:blob|tree)\/main\/([^\s)#]+)/g;

/**
 * The repo paths a doc gives: a folder and a file with an extension in backticks (not under ~ or /),
 * the target of a relative markdown link (from the doc's folder), and a link to this repo on GitHub.
 */
function pathsIn(docs: Doc[]): { path: string; file: string; line: number }[] {
  const out: { path: string; file: string; line: number }[] = [];
  each(docs, (d, text, line) => {
    for (const m of text.matchAll(new RegExp(String.raw`\`(${PATH})(?::\d+(?:-\d+)?)?\``, "g"))) out.push({ path: m[1], file: d.file, line });
    for (const m of text.matchAll(/\]\(([^)\s#]+)(?:#[^)\s]*)?\)/g)) {
      if (/^[a-z]+:/i.test(m[1]) || m[1].startsWith("/") || m[1].startsWith("~")) continue;
      out.push({ path: normPath(join(dirname(d.file), m[1])).replace(/\/$/, ""), file: d.file, line });
    }
    for (const m of text.matchAll(REPO_URL)) out.push({ path: m[1].replace(/\/$/, ""), file: d.file, line });
  });
  return out;
}

/** The `file:line` and `file:line-line` references in backticks, with the code name that a pair form puts beside the reference. */
function lineRefsIn(docs: Doc[]): { path: string; from: number; line: number; name?: string; quote: string; file: string; at: number }[] {
  const out: { path: string; from: number; line: number; name?: string; quote: string; file: string; at: number }[] = [];
  each(docs, (d, text, at) => {
    for (const m of text.matchAll(/`((?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*\.[a-z]{1,5}):(\d+)(?:-(\d+))?`/g)) {
      const before = text.slice(0, m.index);
      const pair = before.match(/`([^`]+?)(?:\(\))?`(?: \(| in )$/)
        ?? (text[m.index + m[0].length] === ")" ? before.match(/\(`([^`]+?)(?:\(\))?`,\s*$/) : null);
      const closed = pair && (pair[0].endsWith("(") || pair[0].startsWith("("));
      out.push({ path: m[1], from: Number(m[2]), line: Number(m[3] ?? m[2]), name: pair?.[1], quote: pair ? pair[0] + m[0] + (closed ? ")" : "") : m[0], file: d.file, at });
    }
  });
  return out;
}

const IDENT = String.raw`[A-Za-z_$][\w$]*`;
const SYMBOL_IN = new RegExp(String.raw`\`(${IDENT})(?:\(\))?\`\s+(?:in|from|of)\s+\`(${PATH})\``, "g");
const SELECTOR_IN = new RegExp(String.raw`\`([.#][\w.#>+~: -]*[\w)])\`\s+(?:in|from|of)\s+\`((?:[\w.-]+/)*[\w.-]+\.css)\``, "g");
const SYMBOL_OF = new RegExp(String.raw`\`(${PATH})\`'s\s+\`(${IDENT})(?:\(\))?\``, "g");

/** The code names a doc places in a file: `` `name` in `path` ``, `from`, `of`, and `` `path`'s `name` ``. */
function symbolsIn(docs: Doc[]): { symbol: string; path: string; quote: string; file: string; line: number }[] {
  const out: { symbol: string; path: string; quote: string; file: string; line: number }[] = [];
  each(docs, (d, text, line) => {
    for (const m of text.matchAll(SYMBOL_IN)) out.push({ symbol: m[1], path: m[2], quote: m[0], file: d.file, line });
    for (const m of text.matchAll(SELECTOR_IN)) out.push({ symbol: m[1], path: m[2], quote: m[0], file: d.file, line });
    for (const m of text.matchAll(SYMBOL_OF)) out.push({ symbol: m[2], path: m[1], quote: m[0], file: d.file, line });
  });
  return out;
}

/** The claims that a file imports only some modules: `` `path` imports only `a`, `b` and `c` ``. */
function importClaimsIn(docs: Doc[]): { path: string; modules: string[]; quote: string; file: string; line: number }[] {
  const out: { path: string; modules: string[]; quote: string; file: string; line: number }[] = [];
  each(docs, (d, text, line) => {
    for (const m of text.matchAll(new RegExp(String.raw`\`(${PATH})\`[^.;]*?\bimports\s+only\s+((?:\`[^\`]+\`(?:\s*,\s*|\s+and\s+|,\s+and\s+)?)+)`, "g"))) {
      out.push({ path: m[1], modules: [...m[2].matchAll(/`([^`]+)`/g)].map((x) => x[1]), quote: m[0].trim(), file: d.file, line });
    }
  });
  return out;
}

/** The module specifiers a source file imports, static, side-effect, re-export and dynamic. */
function importsOf(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/^\s*(?:import|export)\b[^"'`;]*?\bfrom\s*["']([^"']+)["']/gm)) out.add(m[1]);
  for (const m of text.matchAll(/^\s*import\s*["']([^"']+)["']/gm)) out.add(m[1]);
  for (const m of text.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) out.add(m[1]);
  return [...out];
}

/** The `--flags` of `aleph` and `aleph-ui` commands in code spans and code blocks, with the command they follow. */
function flagsIn(docs: Doc[]): { flag: string; command: string; file: string; line: number }[] {
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

/** The text of a repo file, or null when it is not a file. */
function fileText(root: string, path: string): string | null {
  const p = join(root, path);
  try { return statSync(p).isFile() ? readFileSync(p, "utf8") : null; } catch { return null; }
}

/** A repo path for a `file:line`: the path itself, or the one file of the tree with that name. */
function resolveRef(path: string, truth: Truth): { path?: string; why?: string } {
  if (path.includes("/") || existsSync(join(truth.root, path))) return { path };
  const hits = (truth.files ?? []).filter((f) => basename(f) === path);
  if (hits.length === 1) return { path: hits[0] };
  return { why: hits.length ? `names ${hits.length} files (${hits.join(", ")})` : "names no file of the repo" };
}

const MEMBER = String.raw`^\s*(?:(?:public|private|protected|static|readonly|async|get|set|abstract|override)\s+)*\*?`;

/** The 1-based lines of `rows` that hold `name`: its definition when it is an identifier, else any mention. */
function holdLines(rows: string[], name: string, css = false): number[] {
  const n = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const dash = css ? "-" : "";
  const has = new RegExp(!css && new RegExp(`^${IDENT}$`).test(name)
    ? String.raw`\b(?:function\*?|class|const|let|var|interface|type|enum)\s+${n}\b|[{,]\s*${n}\s*:|${MEMBER}${n}\s*(?:\??:|=[^=>]|[(<][^;]*\{\s*$)`
    : String.raw`(?<![\w$${dash}])${n}(?![\w$${dash}])`);
  return rows.flatMap((l, i) => has.test(l) ? [i + 1] : []);
}

/** A module a doc names, as the file imports it: a relative one resolved from the file's folder. */
const moduleKey = (from: string, spec: string): string => spec.startsWith(".") ? normPath(join(dirname(from), spec)) : spec;

/** Each claim the code does not back, as a line that quotes the claim and says what the code has. Empty when all match. */
export function docProblems(docs: Doc[], truth: Truth): string[] {
  const problems: string[] = [];
  for (const c of defaultClaims(docs)) {
    const at = `${c.file}:${c.line}`;
    const get = truth.defaults[c.name];
    if (!get) { problems.push(`${at}: "${c.quote}" states a default for ${c.name}, which the check has no value for`); continue; }
    const doc = normalize(c.value);
    const code = asValue(get());
    if (doc !== code) problems.push(`${at}: "${c.quote}" says ${c.name} defaults to ${JSON.stringify(doc)}, the code has ${JSON.stringify(code)}`);
  }
  for (const c of proseClaims(docs)) {
    const at = `${c.file}:${c.line}`;
    const text = fileText(truth.root, c.def.file);
    const found = text?.match(c.def.code)?.[1];
    if (found === undefined) { problems.push(`${at}: "${c.quote}" states the default of ${c.name}, which ${c.def.file} does not give`); continue; }
    const doc = normalize(c.value);
    const code = Number(found);
    if (doc !== code) problems.push(`${at}: "${c.quote}" says ${c.name} defaults to ${JSON.stringify(doc)}, the code has ${JSON.stringify(code)} (${c.def.file})`);
  }
  for (const n of namesIn(docs)) {
    if (!new RegExp(String.raw`\b${n.name}\b`).test(truth.source)) problems.push(`${n.file}:${n.line}: ${n.name} is in no source file`);
  }
  for (const p of pathsIn(docs)) {
    if (!existsSync(join(truth.root, p.path))) problems.push(`${p.file}:${p.line}: \`${p.path}\` does not exist`);
  }
  for (const r of lineRefsIn(docs)) {
    const at = `${r.file}:${r.at}`;
    const { path, why } = resolveRef(r.path, truth);
    if (!path) { problems.push(`${at}: "${r.quote}" ${why}`); continue; }
    const text = fileText(truth.root, path);
    if (text === null) continue; // pathsIn reports a missing path with a folder
    const lines = text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;
    if (r.line < 1 || r.line > lines) problems.push(`${at}: "${r.quote}" cites line ${r.line} of ${path}, which has ${lines} lines`);
    else if (r.name) {
      const hits = holdLines(text.split("\n"), r.name);
      if (!hits.some((h) => h >= r.from && h <= r.line)) {
        problems.push(`${at}: "${r.quote}": ${hits.length ? `${r.name} is at line ${hits[0]} of ${path}` : `${path} has no ${r.name}`}`);
      }
    }
  }
  for (const s of symbolsIn(docs)) {
    const text = fileText(truth.root, s.path);
    if (text === null) continue;
    if (!holdLines(text.split("\n"), s.symbol, s.path.endsWith(".css")).length) problems.push(`${s.file}:${s.line}: "${s.quote}": ${s.path} has no ${s.symbol}`);
  }
  for (const c of importClaimsIn(docs)) {
    const text = fileText(truth.root, c.path);
    if (text === null) continue;
    const has = importsOf(text);
    const want = new Set(c.modules.map((m) => moduleKey(c.path, m)));
    const got = new Set(has.map((m) => moduleKey(c.path, m)));
    const extra = has.filter((m) => !want.has(moduleKey(c.path, m)));
    const missing = c.modules.filter((m) => !got.has(moduleKey(c.path, m)));
    if (extra.length || missing.length) {
      problems.push(`${c.file}:${c.line}: "${c.quote}": ${c.path} imports ${has.length ? has.join(", ") : "nothing"}${missing.length ? `; not ${missing.join(", ")}` : ""}`);
    }
  }
  for (const f of flagsIn(docs)) {
    if (![`"${f.flag}"`, `'${f.flag}'`, `\`${f.flag}`].some((q) => truth.cliSource.includes(q))) problems.push(`${f.file}:${f.line}: "${f.command}" uses ${f.flag}, which the CLI source does not define`);
  }
  return problems;
}
