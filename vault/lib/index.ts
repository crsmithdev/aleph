/**
 * The derived search index and the one ranker that `vault recall` and the
 * UserPromptSubmit hook share.
 *
 * The index is an FTS5 table at `<vault>/.index/vault.sqlite`, kept out of git.
 * It is rebuilt when the vault HEAD differs from the HEAD stored in it. A vault
 * that is not a git repo has no HEAD, so its index is rebuilt on each open.
 */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { coreNotes, loadWiki, scopeOf, screenWords as words, type Note } from "./vault.ts";
import { probe } from "../../lib/git.ts";
import { tmpName } from "../../lib/json.ts";

/** The reciprocal rank fusion constant. */
const K = 60;
/** The bm25 hits one search reads. */
const FTS_LIMIT = 200;

/** The first paragraph of a note's body on one line. */
export const claimLine = (n: Pick<Note, "body">): string => n.body.trim().split(/\n\s*\n/)[0].replace(/\s+/g, " ").trim();

/** A note as the index returns it: no path and no text. */
type Hit = Pick<Note, "rel" | "title" | "fm" | "body" | "wiki" | "archived">;

const aliasesOf = (n: Pick<Note, "fm">): string[] => {
  const a = n.fm.aliases;
  return (Array.isArray(a) ? a : a ? [a] : []).map((x) => String(x).toLowerCase());
};

function head(root: string): string {
  const p = probe(root, "rev-parse", "HEAD");
  return p.ok ? p.out : "";
}

// The suffix names the columns of the table: an index at the same HEAD with fewer is rebuilt.
const stamp = (at: string): string => (at ? `${at}:fm` : "");

/** The open index when it holds the vault HEAD `at`, else null. */
function current(root: string, at: string): Database | null {
  const file = join(root, ".index", "vault.sqlite");
  if (!at || !existsSync(file)) return null;
  const db = new Database(file);
  try {
    if ((db.query("select value from meta where key = 'head'").get() as { value: string } | null)?.value === at) return db;
  } catch (e) {
    // A vault.sqlite with no meta table is rebuilt; a busy or corrupt file is not.
    if (!/no such table/.test((e as Error).message)) { db.close(); throw e; }
  }
  db.close();
  return null;
}

/** The index for `notes` at the vault HEAD `at`, built beside the file and renamed in. */
function build(root: string, at: string, notes: Note[]): Database {
  // A hook that reads at the same time sees the old index or the new one.
  const dir = join(root, ".index");
  const file = join(dir, "vault.sqlite");
  mkdirSync(dir, { recursive: true });
  const tmp = tmpName(file);
  rmSync(tmp, { force: true });
  const db = new Database(tmp);
  db.run("create table meta (key text primary key, value text)");
  db.run(`create virtual table notes using fts5(title, aliases, claim, body, rel unindexed, scope unindexed, kind unindexed, updated unindexed, fm unindexed, tokenize = "porter unicode61")`);
  const add = db.prepare("insert into notes values (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  db.transaction(() => {
    for (const n of notes) add.run(n.title, aliasesOf(n).join(" "), claimLine(n), n.body, n.rel, scopeOf(n), String(n.fm.kind ?? ""), String(n.fm.updated ?? ""), JSON.stringify(n.fm));
    db.run("insert into meta values ('head', ?)", [at]);
  })();
  db.close();
  renameSync(tmp, file);
  return new Database(file);
}

/** The index for `notes`, rebuilt first when the vault HEAD moved. */
function openIndex(root: string, notes: Note[]): Database {
  const at = stamp(head(root));
  return current(root, at) ?? build(root, at, notes);
}

/** The rel paths of the notes that match any query word, best bm25 first. A query with no word of four letters, such as `bun`, searches on all its tokens. */
function search(db: Database, query: string): string[] {
  const long = words(query);
  const ws = [...new Set(long.length ? long : query.toLowerCase().match(/[a-z0-9]+/g) ?? [])];
  if (!ws.length) return [];
  const match = ws.map((w) => `"${w}"`).join(" OR ");
  return (db.query("select rel from notes where notes match ? order by bm25(notes, 10, 5, 3, 1) limit ?").all(match, FTS_LIMIT) as { rel: string }[]).map((r) => r.rel);
}

/**
 * How a note's title and aliases match the query: 0 the title is the query,
 * 1 an alias is, 2 the title or an alias holds the query or one of its words.
 * Undefined when none of these.
 */
function titleTier(n: Hit, q: string, want: Set<string>): { tier: number; hits: number } | undefined {
  const title = n.title.toLowerCase(), aliases = aliasesOf(n);
  if (title === q) return { tier: 0, hits: Infinity };
  if (aliases.includes(q)) return { tier: 1, hits: Infinity };
  if (title.includes(q) || aliases.some((a) => a.includes(q))) return { tier: 2, hits: Infinity };
  const have = new Set(words([n.title, ...aliases].join(" ")));
  const hits = [...want].filter((w) => have.has(w)).length;
  return hits ? { tier: 2, hits } : undefined;
}

interface Ranked<T = Note> { note: T; rank: number }

/**
 * The index for `notes`, searched for `query` among `among` (all of `notes` by default) and closed again.
 * The ranking is `rankNotes`'s.
 */
export function recall(root: string, notes: Note[], query: string, scope?: string, among: Note[] = notes): Ranked[] {
  return recallAll(root, notes, [query], scope, among)[0];
}

/** `recall` for each of `queries`, in order, on one open of the index. */
export function recallAll(root: string, notes: Note[], queries: string[], scope?: string, among: Note[] = notes): Ranked[][] {
  const db = openIndex(root, notes);
  try { return queries.map((q) => rankNotes(db, among, q, scope)); } finally { db.close(); }
}

/**
 * The notes that match `query`, fused by reciprocal rank (k = 60) over three
 * lists: the title and alias matches, the bm25 hits, and, with `scope`, that
 * scope's notes by `updated`, newest first. Only a note on one of the first
 * two lists is returned; the third list orders them and adds none.
 * `rank` is the title tier (0, 1 or 2), or 3 for a body-only hit.
 */
function rankNotes<T extends Hit>(db: Database, notes: T[], query: string, scope?: string): Ranked<T>[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const want = new Set(words(q));
  const byRel = new Map(notes.map((n) => [n.rel, n]));
  const tiers = new Map<string, number>();
  const titled = notes.flatMap((n) => { const t = titleTier(n, q, want); return t ? [{ n, ...t }] : []; })
    .sort((a, b) => a.tier - b.tier || b.hits - a.hits || a.n.title.localeCompare(b.n.title));
  for (const { n, tier } of titled) tiers.set(n.rel, tier);
  const lists: string[][] = [titled.map(({ n }) => n.rel), search(db, q).filter((rel) => byRel.has(rel))];
  if (scope !== undefined) {
    lists.push(notes.filter((n) => scopeOf(n) === scope)
      .sort((a, b) => String(b.fm.updated ?? "").localeCompare(String(a.fm.updated ?? "")) || a.title.localeCompare(b.title)).map((n) => n.rel));
  }
  const matched = new Set([...lists[0], ...lists[1]]);
  const score = new Map<string, number>();
  for (const list of lists) list.forEach((rel, i) => { if (matched.has(rel)) score.set(rel, (score.get(rel) ?? 0) + 1 / (K + i + 1)); });
  return [...matched]
    .sort((a, b) => score.get(b)! - score.get(a)! || byRel.get(a)!.title.localeCompare(byRel.get(b)!.title))
    .map((rel) => ({ note: byRel.get(rel)!, rank: tiers.get(rel) ?? 3 }));
}

/**
 * The wiki notes that match `query`, as `recall` ranks them, and the core notes of `scope`, read from the index
 * for the vault HEAD: a note file is read only when the index is stale.
 */
export async function recallWiki(root: string, query: string, scope: string): Promise<{ ranked: Ranked<Hit>[]; core: Hit[] }> {
  const at = stamp(head(root));
  const db = current(root, at) ?? build(root, at, await loadWiki(root));
  try {
    const rows = (db.query("select title, body, rel, fm from notes where rel like 'wiki/%'").all() as { title: string; body: string; rel: string; fm: string }[])
      .map((r): Hit => ({ ...r, fm: JSON.parse(r.fm), wiki: true, archived: false }));
    return { ranked: rankNotes(db, rows, query, scope), core: coreNotes(rows, scope) };
  } finally { db.close(); }
}
