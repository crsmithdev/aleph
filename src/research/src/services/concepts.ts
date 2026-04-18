import type { Sqlite } from '@construct/data';
import { generateId } from './id.js';
import type { Concept, ConceptLink, ConceptWithStats } from '../types.js';

function rowToConcept(row: Record<string, unknown>): Concept {
  return {
    id: row.id as string,
    session_id: row.session_id as string,
    canonical_name: row.canonical_name as string,
    aliases: JSON.parse((row.aliases as string) ?? '[]'),
    summary: (row.summary as string) ?? '',
    key_facts: JSON.parse((row.key_facts as string) ?? '[]'),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function rowToConceptLink(row: Record<string, unknown>): ConceptLink {
  return {
    id: row.id as string,
    session_id: row.session_id as string,
    from_concept_id: row.from_concept_id as string,
    to_concept_id: row.to_concept_id as string,
    relation: row.relation as string,
    evidence_finding_ids: JSON.parse((row.evidence_finding_ids as string) ?? '[]'),
    created_at: row.created_at as string,
  };
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

function mergeUnique(a: string[], b: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of [...a, ...b]) {
    const k = norm(v);
    if (k && !seen.has(k)) { seen.add(k); out.push(v.trim()); }
  }
  return out;
}

/** Upsert a concept in a session. Matches on canonical_name (case-insensitive) then aliases.
 *  Merges aliases and key_facts on hit; prefers the longer/non-empty summary. */
export function upsertConcept(
  sqlite: Sqlite,
  sessionId: string,
  params: { canonical_name: string; aliases?: string[]; summary?: string; key_facts?: string[] }
): Concept {
  const canon = params.canonical_name.trim();
  if (!canon) throw new Error('upsertConcept: canonical_name required');

  const canonKey = norm(canon);
  const aliases = (params.aliases ?? []).map(a => a.trim()).filter(a => a.length > 0);
  const summary = (params.summary ?? '').trim();
  const keyFacts = (params.key_facts ?? []).map(f => f.trim()).filter(f => f.length > 0);

  const existing = sqlite.prepare(
    'SELECT * FROM research_concepts WHERE session_id = ? AND LOWER(canonical_name) = ?'
  ).get(sessionId, canonKey) as Record<string, unknown> | undefined;

  const lookupCandidates = existing
    ? null
    : sqlite.prepare('SELECT * FROM research_concepts WHERE session_id = ?').all(sessionId) as Record<string, unknown>[];
  const aliasHit = existing
    ? null
    : lookupCandidates!.find(r => {
        const existingAliases = JSON.parse((r.aliases as string) ?? '[]') as string[];
        const bag = new Set(existingAliases.map(norm));
        bag.add(norm(r.canonical_name as string));
        return aliases.some(a => bag.has(norm(a))) || bag.has(canonKey);
      });

  const hit = existing ?? aliasHit ?? null;
  const now = new Date().toISOString();

  if (hit) {
    const cur = rowToConcept(hit);
    const mergedAliases = mergeUnique(cur.aliases, [canon, ...aliases].filter(a => norm(a) !== norm(cur.canonical_name)));
    const mergedFacts = mergeUnique(cur.key_facts, keyFacts);
    const newSummary = cur.summary && cur.summary.length >= summary.length ? cur.summary : summary;

    sqlite.prepare(
      'UPDATE research_concepts SET aliases = ?, summary = ?, key_facts = ?, updated_at = ? WHERE id = ?'
    ).run(JSON.stringify(mergedAliases), newSummary, JSON.stringify(mergedFacts), now, cur.id);

    return { ...cur, aliases: mergedAliases, summary: newSummary, key_facts: mergedFacts, updated_at: now };
  }

  const id = generateId();
  sqlite.prepare(
    `INSERT INTO research_concepts (id, session_id, canonical_name, aliases, summary, key_facts, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, sessionId, canon, JSON.stringify(aliases), summary, JSON.stringify(keyFacts), now, now);

  return {
    id, session_id: sessionId, canonical_name: canon,
    aliases, summary, key_facts: keyFacts,
    created_at: now, updated_at: now,
  };
}

export function linkFindingToConcept(sqlite: Sqlite, sessionId: string, findingId: string, conceptId: string): void {
  sqlite.prepare(
    `INSERT OR IGNORE INTO research_finding_concepts (finding_id, concept_id, session_id) VALUES (?, ?, ?)`
  ).run(findingId, conceptId, sessionId);
}

export function linkConcepts(
  sqlite: Sqlite,
  sessionId: string,
  fromId: string,
  toId: string,
  relation: string,
  evidenceFindingIds: string[] = []
): void {
  if (fromId === toId) return;
  const rel = relation.trim().toLowerCase();
  if (!rel) return;

  const existing = sqlite.prepare(
    'SELECT id, evidence_finding_ids FROM research_concept_links WHERE from_concept_id = ? AND to_concept_id = ? AND relation = ?'
  ).get(fromId, toId, rel) as { id: string; evidence_finding_ids: string } | undefined;

  if (existing) {
    const cur = JSON.parse(existing.evidence_finding_ids) as string[];
    const merged = Array.from(new Set([...cur, ...evidenceFindingIds]));
    sqlite.prepare('UPDATE research_concept_links SET evidence_finding_ids = ? WHERE id = ?')
      .run(JSON.stringify(merged), existing.id);
    return;
  }

  sqlite.prepare(
    `INSERT INTO research_concept_links (id, session_id, from_concept_id, to_concept_id, relation, evidence_finding_ids)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(generateId(), sessionId, fromId, toId, rel, JSON.stringify(evidenceFindingIds));
}

export function getConcept(sqlite: Sqlite, id: string): Concept | null {
  const row = sqlite.prepare('SELECT * FROM research_concepts WHERE id = ?').get(id) as Record<string, unknown> | null;
  return row ? rowToConcept(row) : null;
}

/** Resolve a concept by canonical_name or alias within a session. Used when linking relations
 *  referenced by name rather than id. */
export function findConceptByName(sqlite: Sqlite, sessionId: string, name: string): Concept | null {
  const key = norm(name);
  if (!key) return null;

  const exact = sqlite.prepare(
    'SELECT * FROM research_concepts WHERE session_id = ? AND LOWER(canonical_name) = ?'
  ).get(sessionId, key) as Record<string, unknown> | null;
  if (exact) return rowToConcept(exact);

  const rows = sqlite.prepare('SELECT * FROM research_concepts WHERE session_id = ?').all(sessionId) as Record<string, unknown>[];
  for (const r of rows) {
    const aliases = JSON.parse((r.aliases as string) ?? '[]') as string[];
    if (aliases.some(a => norm(a) === key)) return rowToConcept(r);
  }
  return null;
}

export function listConcepts(sqlite: Sqlite, sessionId: string): ConceptWithStats[] {
  const rows = sqlite.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM research_finding_concepts fc WHERE fc.concept_id = c.id) AS finding_count
    FROM research_concepts c
    WHERE c.session_id = ?
    ORDER BY finding_count DESC, c.canonical_name ASC
  `).all(sessionId) as Record<string, unknown>[];

  return rows.map(r => {
    const base = rowToConcept(r);
    const urls = countUniqueUrlsForConcept(sqlite, base.id);
    return { ...base, finding_count: Number(r.finding_count ?? 0), source_count: urls };
  });
}

function countUniqueUrlsForConcept(sqlite: Sqlite, conceptId: string): number {
  const rows = sqlite.prepare(`
    SELECT f.source_urls FROM research_findings f
    JOIN research_finding_concepts fc ON fc.finding_id = f.id
    WHERE fc.concept_id = ?
  `).all(conceptId) as Array<{ source_urls: string }>;

  const set = new Set<string>();
  for (const r of rows) {
    try { for (const u of JSON.parse(r.source_urls) as string[]) set.add(u); } catch { /* skip */ }
  }
  return set.size;
}

export function listConceptLinks(sqlite: Sqlite, sessionId: string): ConceptLink[] {
  const rows = sqlite.prepare(
    'SELECT * FROM research_concept_links WHERE session_id = ? ORDER BY created_at ASC'
  ).all(sessionId) as Record<string, unknown>[];
  return rows.map(rowToConceptLink);
}

export function listFindingsForConcept(sqlite: Sqlite, conceptId: string): string[] {
  const rows = sqlite.prepare(
    'SELECT finding_id FROM research_finding_concepts WHERE concept_id = ? ORDER BY created_at ASC'
  ).all(conceptId) as Array<{ finding_id: string }>;
  return rows.map(r => r.finding_id);
}

export function listConceptIdsForFinding(sqlite: Sqlite, findingId: string): string[] {
  const rows = sqlite.prepare(
    'SELECT concept_id FROM research_finding_concepts WHERE finding_id = ?'
  ).all(findingId) as Array<{ concept_id: string }>;
  return rows.map(r => r.concept_id);
}

/** Find findings that have no concept links yet. Used by the worker to backfill
 *  pre-existing findings that predate concept extraction or whose extraction failed.
 *  Oldest-first so the user sees concepts populate in the order findings came in. */
export function findingsMissingConcepts(
  sqlite: Sqlite,
  sessionId: string | null,
  limit: number
): Array<{ id: string; session_id: string }> {
  const sql = `
    SELECT f.id, f.session_id FROM research_findings f
    LEFT JOIN research_finding_concepts fc ON fc.finding_id = f.id
    WHERE fc.finding_id IS NULL
    ${sessionId ? 'AND f.session_id = ?' : ''}
    ORDER BY f.created_at ASC
    LIMIT ?
  `;
  const params: unknown[] = sessionId ? [sessionId, limit] : [limit];
  return sqlite.prepare(sql).all(...params) as Array<{ id: string; session_id: string }>;
}

/** Sessions that have at least one finding but no concepts yet — the common
 *  shape after a pre-extraction session resumes. */
export function sessionsMissingConcepts(sqlite: Sqlite, limit: number): string[] {
  const rows = sqlite.prepare(`
    SELECT f.session_id FROM research_findings f
    LEFT JOIN research_finding_concepts fc ON fc.finding_id = f.id
    WHERE fc.finding_id IS NULL
    GROUP BY f.session_id
    ORDER BY MIN(f.created_at) ASC
    LIMIT ?
  `).all(limit) as Array<{ session_id: string }>;
  return rows.map(r => r.session_id);
}

/** Collect unique source URLs across all findings linked to the given concept. */
export function getSourcesForConcept(
  sqlite: Sqlite,
  conceptId: string
): Array<{ url: string; title: string; snippet: string }> {
  const rows = sqlite.prepare(`
    SELECT f.source_urls, f.source_url_meta FROM research_findings f
    JOIN research_finding_concepts fc ON fc.finding_id = f.id
    WHERE fc.concept_id = ?
  `).all(conceptId) as Array<{ source_urls: string; source_url_meta: string }>;

  const byUrl = new Map<string, { url: string; title: string; snippet: string }>();
  for (const r of rows) {
    const urls = safeParse<string[]>(r.source_urls, []);
    const meta = safeParse<Array<{ url: string; title: string; snippet: string }>>(r.source_url_meta, []);
    const metaByUrl = new Map(meta.map(m => [m.url, m]));
    for (const u of urls) {
      if (byUrl.has(u)) continue;
      const m = metaByUrl.get(u);
      byUrl.set(u, { url: u, title: m?.title ?? u, snippet: m?.snippet ?? '' });
    }
  }
  return [...byUrl.values()];
}

function safeParse<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}
