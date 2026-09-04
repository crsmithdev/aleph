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

export function parseFrontmatter(yaml: string): Frontmatter {
  const fm: Frontmatter = {};
  let listKey: string | null = null;
  for (const raw of yaml.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, "").trimEnd();
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
