import type { Sqlite } from '@construct/data';
import { generateId } from './id.js';
import type { Source, SourceExtractionStatus } from '../types.js';

function rowToSource(row: Record<string, unknown>): Source {
  return {
    id: row.id as string,
    session_id: row.session_id as string,
    url: row.url as string,
    title: (row.title as string) ?? '',
    snippet: (row.snippet as string) ?? '',
    extraction_status: (row.extraction_status as SourceExtractionStatus) ?? 'pending',
    extracted_text: (row.extracted_text as string | null) ?? null,
    extracted_at: (row.extracted_at as string | null) ?? null,
    fetched_at: (row.fetched_at as string | null) ?? null,
    error: (row.error as string | null) ?? null,
    attempt_count: Number(row.attempt_count ?? 0),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

/** Register a source discovered during research. Inserts pending if new; updates title/snippet
 *  if already present (keeps extraction_status/text intact). */
export function registerSource(
  sqlite: Sqlite,
  sessionId: string,
  params: { url: string; title?: string; snippet?: string; initialStatus?: SourceExtractionStatus }
): Source {
  if (!params.url) throw new Error('registerSource: url required');

  const existing = sqlite.prepare(
    'SELECT * FROM research_sources WHERE session_id = ? AND url = ?'
  ).get(sessionId, params.url) as Record<string, unknown> | undefined;

  const now = new Date().toISOString();
  if (existing) {
    const cur = rowToSource(existing);
    const newTitle = cur.title || params.title || '';
    const newSnippet = cur.snippet || params.snippet || '';
    if (newTitle !== cur.title || newSnippet !== cur.snippet) {
      sqlite.prepare(
        'UPDATE research_sources SET title = ?, snippet = ?, updated_at = ? WHERE id = ?'
      ).run(newTitle, newSnippet, now, cur.id);
    }
    return { ...cur, title: newTitle, snippet: newSnippet, updated_at: now };
  }

  const id = generateId();
  const status = params.initialStatus ?? 'pending';
  sqlite.prepare(
    `INSERT INTO research_sources (id, session_id, url, title, snippet, extraction_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, sessionId, params.url, params.title ?? '', params.snippet ?? '', status, now, now);

  return {
    id, session_id: sessionId, url: params.url,
    title: params.title ?? '', snippet: params.snippet ?? '',
    extraction_status: status,
    extracted_text: null, extracted_at: null, fetched_at: null, error: null,
    attempt_count: 0, created_at: now, updated_at: now,
  };
}

export function registerSources(
  sqlite: Sqlite,
  sessionId: string,
  items: Array<{ url: string; title?: string; snippet?: string }>,
  initialStatus: SourceExtractionStatus = 'pending'
): number {
  let added = 0;
  for (const item of items) {
    if (!item.url) continue;
    const before = sqlite.prepare('SELECT id FROM research_sources WHERE session_id = ? AND url = ?')
      .get(sessionId, item.url);
    registerSource(sqlite, sessionId, { ...item, initialStatus });
    if (!before) added++;
  }
  return added;
}

export function listSources(
  sqlite: Sqlite,
  sessionId: string,
  opts?: { status?: SourceExtractionStatus | 'all'; limit?: number }
): Source[] {
  const status = opts?.status && opts.status !== 'all' ? opts.status : null;
  const rows = status
    ? sqlite.prepare(
        'SELECT * FROM research_sources WHERE session_id = ? AND extraction_status = ? ORDER BY created_at DESC LIMIT ?'
      ).all(sessionId, status, opts?.limit ?? 500)
    : sqlite.prepare(
        'SELECT * FROM research_sources WHERE session_id = ? ORDER BY created_at DESC LIMIT ?'
      ).all(sessionId, opts?.limit ?? 500);
  return (rows as Record<string, unknown>[]).map(rowToSource);
}

export function getSource(sqlite: Sqlite, id: string): Source | null {
  const row = sqlite.prepare('SELECT * FROM research_sources WHERE id = ?').get(id) as Record<string, unknown> | null;
  return row ? rowToSource(row) : null;
}

export function countSourcesByStatus(
  sqlite: Sqlite,
  sessionId: string
): Record<SourceExtractionStatus, number> {
  const rows = sqlite.prepare(
    'SELECT extraction_status, COUNT(*) as n FROM research_sources WHERE session_id = ? GROUP BY extraction_status'
  ).all(sessionId) as Array<{ extraction_status: SourceExtractionStatus; n: number }>;
  const acc: Record<SourceExtractionStatus, number> = { pending: 0, extracted: 0, failed: 0, skipped: 0 };
  for (const r of rows) acc[r.extraction_status] = r.n;
  return acc;
}

/** Claim pending sources for extraction. Returns up to `batchSize` rows and bumps their attempt_count
 *  within a single transaction so concurrent callers don't double-claim. */
export function claimPendingSources(sqlite: Sqlite, batchSize: number, sessionId?: string): Source[] {
  const now = new Date().toISOString();
  const claim = sqlite.transaction((n: number) => {
    const selectSql = sessionId
      ? `SELECT * FROM research_sources WHERE extraction_status = 'pending' AND session_id = ? ORDER BY created_at ASC LIMIT ?`
      : `SELECT * FROM research_sources WHERE extraction_status = 'pending' ORDER BY created_at ASC LIMIT ?`;
    const rows = (sessionId
      ? sqlite.prepare(selectSql).all(sessionId, n)
      : sqlite.prepare(selectSql).all(n)) as Record<string, unknown>[];

    const update = sqlite.prepare(
      `UPDATE research_sources
         SET extraction_status = 'claimed', attempt_count = attempt_count + 1, fetched_at = ?, updated_at = ?
       WHERE id = ? AND extraction_status = 'pending'`
    );
    const claimed: Source[] = [];
    for (const r of rows) {
      const info = update.run(now, now, r.id as string);
      if (info.changes === 1) claimed.push(rowToSource(r));
    }
    return claimed;
  });
  return claim(batchSize);
}

export function completeExtraction(sqlite: Sqlite, id: string, extractedText: string): void {
  const now = new Date().toISOString();
  sqlite.prepare(
    `UPDATE research_sources
       SET extraction_status = 'extracted', extracted_text = ?, extracted_at = ?, error = NULL, updated_at = ?
     WHERE id = ?`
  ).run(extractedText, now, now, id);
}

export function failExtraction(sqlite: Sqlite, id: string, error: string): void {
  const now = new Date().toISOString();
  sqlite.prepare(
    `UPDATE research_sources
       SET extraction_status = 'failed', error = ?, updated_at = ?
     WHERE id = ?`
  ).run(error.slice(0, 500), now, id);
}

export function retrySource(sqlite: Sqlite, id: string): Source | null {
  const now = new Date().toISOString();
  sqlite.prepare(
    `UPDATE research_sources
       SET extraction_status = 'pending', error = NULL, updated_at = ?
     WHERE id = ?`
  ).run(now, id);
  return getSource(sqlite, id);
}

export function skipSource(sqlite: Sqlite, id: string): Source | null {
  const now = new Date().toISOString();
  sqlite.prepare(
    `UPDATE research_sources
       SET extraction_status = 'skipped', updated_at = ?
     WHERE id = ?`
  ).run(now, id);
  return getSource(sqlite, id);
}

/** Return the finding ids that cite this source url (within the source's session). */
export function findingsCitingSource(sqlite: Sqlite, source: Source): string[] {
  const rows = sqlite.prepare(
    'SELECT id, source_urls FROM research_findings WHERE session_id = ?'
  ).all(source.session_id) as Array<{ id: string; source_urls: string }>;

  const out: string[] = [];
  for (const r of rows) {
    try {
      const urls = JSON.parse(r.source_urls) as string[];
      if (urls.includes(source.url)) out.push(r.id);
    } catch { /* skip malformed */ }
  }
  return out;
}
