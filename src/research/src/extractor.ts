import type { Sqlite } from '@construct/data';
import { fetchPageContent } from './providers/websearch.js';
import * as sources from './services/sources.js';
import type { Source } from './types.js';

const MAX_EXTRACTED_CHARS = 100_000;
const MAX_ATTEMPTS = 3;

export interface DrainOptions {
  /** How many pending sources to claim per drain. */
  batchSize?: number;
  /** Max parallel fetches per drain. */
  concurrency?: number;
  /** Scope to a single session (otherwise drains across all). */
  sessionId?: string;
  /** Fired after each successful extraction. Called with the final source row
   *  (extraction_status='extracted', extracted_text populated). Errors are caught
   *  by the drainer and logged — they don't fail the overall drain. */
  onExtracted?: (source: Source) => Promise<void> | void;
}

export interface DrainResult {
  claimed: number;
  extracted: number;
  failed: number;
  skipped: number;
}

/** Claim up to `batchSize` pending sources and extract them with bounded concurrency.
 *  Safe to call from the main worker loop — one transaction per claim, per-source DB writes. */
export async function drainPendingSources(
  sqlite: Sqlite,
  opts: DrainOptions = {}
): Promise<DrainResult> {
  const batchSize = opts.batchSize ?? 5;
  const concurrency = Math.max(1, opts.concurrency ?? 3);

  const claimed = sources.claimPendingSources(sqlite, batchSize, opts.sessionId);
  if (claimed.length === 0) {
    return { claimed: 0, extracted: 0, failed: 0, skipped: 0 };
  }

  let extracted = 0, failed = 0, skipped = 0;

  const queue = [...claimed];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const src = queue.shift();
      if (!src) return;

      if (src.attempt_count > MAX_ATTEMPTS) {
        sources.failExtraction(sqlite, src.id, `exceeded ${MAX_ATTEMPTS} attempts`);
        failed++;
        continue;
      }

      try {
        const result = await fetchPageContent(src.url);
        if (!result.ok || !result.page) {
          const err = result.error ?? 'empty content';
          if (err.includes('402') || /disabled/.test(err)) {
            sources.skipSource(sqlite, src.id);
            skipped++;
          } else {
            sources.failExtraction(sqlite, src.id, err);
            failed++;
          }
          continue;
        }
        const text = result.page.content.slice(0, MAX_EXTRACTED_CHARS);
        sources.completeExtraction(sqlite, src.id, text);
        extracted++;
        if (opts.onExtracted) {
          try {
            const finalRow = sources.getSource(sqlite, src.id);
            if (finalRow) await opts.onExtracted(finalRow);
          } catch (err) {
            console.warn(`[extractor] onExtracted failed for ${src.id}:`, err);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sources.failExtraction(sqlite, src.id, msg);
        failed++;
      }
    }
  });

  await Promise.all(workers);
  return { claimed: claimed.length, extracted, failed, skipped };
}
