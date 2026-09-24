/**
 * The YAML subset the vault uses: `key: scalar`, `key: [a, b]`, and block
 * lists (`- item`). Quotes are honoured inside flow lists. Nothing nested.
 */
export type Scalar = string;
export type Frontmatter = Record<string, Scalar | Scalar[]>;

export function splitFrontmatter(text: string): { frontmatter: string | null; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { frontmatter: null, body: text };
  return { frontmatter: m[1], body: text.slice(m[0].length) };
}

function unquote(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  return t;
}

function flowList(inner: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;
  for (const ch of inner) {
    if (quote) { if (ch === quote) quote = null; else cur += ch; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === ",") { if (cur.trim()) out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * Drop a trailing ` # comment`. A `#` inside quotes or brackets is content:
 * `aliases: [deep link a draw, #go]` is a three-item list, and cutting at the
 * `#` left it unclosed, so it parsed as a string and lint called it "aliases
 * must be a list".
 */
function stripComment(line: string): string {
  let quote: string | null = null;
  let depth = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) { if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === "[") depth++;
    else if (ch === "]") depth--;
    else if (ch === "#" && depth === 0 && /\s/.test(line[i - 1] ?? "")) return line.slice(0, i);
  }
  return line;
}

export function parseFrontmatter(yaml: string): Frontmatter {
  const fm: Frontmatter = {};
  let listKey: string | null = null;
  for (const raw of yaml.split(/\r?\n/)) {
    const line = stripComment(raw).trimEnd();
    if (!line.trim()) continue;
    const item = /^\s+-\s*(.*)$/.exec(line) ?? /^-\s*(.*)$/.exec(line);
    if (item && listKey) { (fm[listKey] as string[]).push(unquote(item[1])); continue; }
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, key, value] = kv;
    if (value === "") { fm[key] = []; listKey = key; continue; }
    listKey = null;
    if (value.startsWith("[") && value.endsWith("]")) { fm[key] = flowList(value.slice(1, -1)); continue; }
    fm[key] = unquote(value);
  }
  return fm;
}

function quoteIfNeeded(s: string): string {
  return /[,:#\[\]"']/.test(s) ? JSON.stringify(s) : s;
}

export function serializeFrontmatter(fm: Frontmatter): string {
  const lines = Object.entries(fm).map(([k, v]) =>
    Array.isArray(v) ? `${k}: [${v.map(quoteIfNeeded).join(", ")}]` : `${k}: ${quoteIfNeeded(v)}`);
  return `---\n${lines.join("\n")}\n---\n`;
}
