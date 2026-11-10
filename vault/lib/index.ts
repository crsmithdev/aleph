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
import { screenWords as words, type Note } from "./vault.ts";

/** The reciprocal rank fusion constant. */
const K = 60;
/** The bm25 hits one search reads. */
const FTS_LIMIT = 200;

/** The first paragraph of a note's body on one line. */
export const claimLine = (n: Note): string => n.body.trim().split(/\n\s*\n/)[0].replace(/\s+/g, " ").trim();

const aliasesOf = (n: Note): string[] => {
  const a = n.fm.aliases;
  return (Array.isArray(a) ? a : a ? [a] : []).map((x) => String(x).toLowerCase());
};

function head(root: string): string {
  const p = Bun.spawnSync(["git", "-C", root, "rev-parse", "HEAD"], { stdout: "pipe", stderr: "ignore" });
  return p.exitCode === 0 ? p.stdout.toString().trim() : "";
}

/** The index for `notes`, rebuilt first when the vault HEAD moved. */
export function openIndex(root: string, notes: Note[]): Database {
  const dir = join(root, ".index");
  const file = join(dir, "vault.sqlite");
  const at = head(root);
  if (at && existsSync(file)) {
    const db = new Database(file);
    try {
      if ((db.query("select value from meta where key = 'head'").get() as { value: string } | null)?.value === at) return db;
    } catch {}
    db.close();
  }
  // Build beside the file and rename, so a hook that reads at the same time sees the old index or the new one.
  mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  rmSync(tmp, { force: true });
  const db = new Database(tmp);
  db.run("create table meta (key text primary key, value text)");
  db.run(`create virtual table notes using fts5(title, aliases, claim, body, rel unindexed, scope unindexed, kind unindexed, updated unindexed, tokenize = "porter unicode61")`);
  const add = db.prepare("insert into notes values (?, ?, ?, ?, ?, ?, ?, ?)");
  db.transaction(() => {
    for (const n of notes) add.run(n.title, aliasesOf(n).join(" "), claimLine(n), n.body, n.rel, String(n.fm.scope ?? ""), String(n.fm.kind ?? ""), String(n.fm.updated ?? ""));
    db.run("insert into meta values ('head', ?)", [at]);
  })();
  db.close();
  renameSync(tmp, file);
  return new Database(file);
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
function titleTier(n: Note, q: string, want: Set<string>): { tier: number; hits: number } | undefined {
  const title = n.title.toLowerCase(), aliases = aliasesOf(n);
  if (title === q) return { tier: 0, hits: Infinity };
  if (aliases.includes(q)) return { tier: 1, hits: Infinity };
  if (title.includes(q) || aliases.some((a) => a.includes(q))) return { tier: 2, hits: Infinity };
  const have = new Set(words([n.title, ...aliases].join(" ")));
  const hits = [...want].filter((w) => have.has(w)).length;
  return hits ? { tier: 2, hits } : undefined;
}

export interface Ranked { note: Note; rank: number }

/**
 * The notes that match `query`, fused by reciprocal rank (k = 60) over three
 * lists: the title and alias matches, the bm25 hits, and, with `scope`, that
 * scope's notes by `updated`, newest first. Only a note on one of the first
 * two lists is returned; the third list orders them and adds none.
 * `rank` is the title tier (0, 1 or 2), or 3 for a body-only hit.
 */
export function rankNotes(db: Database, notes: Note[], query: string, scope?: string): Ranked[] {
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
    lists.push(notes.filter((n) => String(n.fm.scope ?? "") === scope)
      .sort((a, b) => String(b.fm.updated ?? "").localeCompare(String(a.fm.updated ?? "")) || a.title.localeCompare(b.title)).map((n) => n.rel));
  }
  const matched = new Set([...lists[0], ...lists[1]]);
  const score = new Map<string, number>();
  for (const list of lists) list.forEach((rel, i) => { if (matched.has(rel)) score.set(rel, (score.get(rel) ?? 0) + 1 / (K + i + 1)); });
  return [...matched]
    .sort((a, b) => score.get(b)! - score.get(a)! || byRel.get(a)!.title.localeCompare(byRel.get(b)!.title))
    .map((rel) => ({ note: byRel.get(rel)!, rank: tiers.get(rel) ?? 3 }));
}
