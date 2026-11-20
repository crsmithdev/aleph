/**
 * The YAML subset the vault uses: `key: scalar`, `key: [a, b]`, block
 * lists (`- item`) and block scalars (`key: >` folds its lines with spaces,
 * `key: |` keeps the line breaks). Quotes are honoured inside flow lists.
 * A `#` is content: the vault has no trailing comments, and a `core:` line
 * can say `#/design`. Nothing nested.
 */
type Scalar = string;
export type Frontmatter = Record<string, Scalar | Scalar[]>;

export function splitFrontmatter(text: string): { frontmatter: string | null; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { frontmatter: null, body: text };
  return { frontmatter: m[1], body: text.slice(m[0].length) };
}

function unquote(s: string): string {
  const t = s.trim();
  if (t.length > 1 && t.startsWith('"') && t.endsWith('"')) {
    try { return JSON.parse(t); } catch { return t.slice(1, -1); }
  }
  if (t.length > 1 && t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1);
  return t;
}

function flowList(inner: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false; // A quoted item counts even when empty.
  const end = () => { if (quoted || cur.trim()) out.push(quoted ? cur : cur.trim()); cur = ""; quoted = false; };
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < inner.length && inner[j] !== ch) j += ch === '"' && inner[j] === "\\" ? 2 : 1;
      cur = unquote(inner.slice(i, j + 1));
      quoted = true;
      i = j;
      continue;
    }
    if (ch === ",") { end(); continue; }
    if (!quoted) cur += ch;
  }
  end();
  return out;
}

export function parseFrontmatter(yaml: string): Frontmatter {
  const fm: Frontmatter = {};
  let listKey: string | null = null;
  let block: { key: string; sep: string } | null = null;
  for (const raw of yaml.split(/\r?\n/)) {
    if (block && /^\s+\S/.test(raw)) { fm[block.key] = (fm[block.key] ? `${fm[block.key]}${block.sep}` : "") + raw.trim(); continue; }
    block = null;
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const item = /^\s+-\s*(.*)$/.exec(line) ?? /^-\s*(.*)$/.exec(line);
    if (item && listKey) { (fm[listKey] as string[]).push(unquote(item[1])); continue; }
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, key, value] = kv;
    if (value === "") { fm[key] = []; listKey = key; continue; }
    listKey = null;
    if (/^[>|][+-]?$/.test(value)) { fm[key] = ""; block = { key, sep: value[0] === ">" ? " " : "\n" }; continue; }
    if (value.startsWith("[") && value.endsWith("]")) { fm[key] = flowList(value.slice(1, -1)); continue; }
    fm[key] = unquote(value);
  }
  return fm;
}

// Quoted: a value with a character YAML reads as syntax, one that starts with
// an indicator (a title can start with a backtick), one with edge spaces, a
// line break, or nothing at all (a bare `key:` reads as an empty list).
function quoteIfNeeded(s: string): string {
  return s === "" || /[,:#\[\]"'\\\r\n]/.test(s) || /^[`@&*!|>%{}?\-\s]/.test(s) || /\s$/.test(s) ? JSON.stringify(s) : s;
}

export function serializeFrontmatter(fm: Frontmatter): string {
  const lines = Object.entries(fm).map(([k, v]) =>
    Array.isArray(v) ? `${k}: [${v.map(quoteIfNeeded).join(", ")}]` : `${k}: ${quoteIfNeeded(v)}`);
  return `---\n${lines.join("\n")}\n---\n`;
}
