/**
 * Wrapper for `/research/:id` — probes `/api/loops/:id` first, falls back to
 * the legacy `ResearchQueryDetailPage` for slugs that belong to the old
 * `research_queries` table. The two backends share the slug ID namespace
 * (`generateId()` from `services/id.ts`) so a single URL can resolve to either
 * system. Phase 7 deletes the legacy fallback once `research_queries` is gone.
 */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ErrorState } from '../../components/ui/ErrorState';
import { PageLoading } from '../../components/ui/Spinner';
import { LoopDetailPage } from '../loops/LoopDetailPage';
import { ResearchQueryDetailPage } from './ResearchQueryDetailPage';

type Resolution = 'loop' | 'query' | 'not_found';

export function ResearchDetail() {
  const { id } = useParams<{ id: string }>();
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setResolution(null);
    setProbeError(null);

    (async () => {
      // Loops first — that's the active system. 200 → render loop view.
      const loopRes = await fetch(`/api/loops/${encodeURIComponent(id)}`).catch(e => e as Error);
      if (cancelled) return;
      if (loopRes instanceof Error) { setProbeError(loopRes.message); return; }
      if (loopRes.ok) { setResolution('loop'); return; }

      // Fall through on 404 only — other statuses are real errors.
      if (loopRes.status !== 404) {
        setProbeError(`Loop probe HTTP ${loopRes.status}`);
        return;
      }

      // Legacy research_queries fallback.
      const queryRes = await fetch(`/api/research/queries/${encodeURIComponent(id)}`).catch(e => e as Error);
      if (cancelled) return;
      if (queryRes instanceof Error) { setProbeError(queryRes.message); return; }
      if (queryRes.ok) { setResolution('query'); return; }
      if (queryRes.status === 404) { setResolution('not_found'); return; }
      setProbeError(`Query probe HTTP ${queryRes.status}`);
    })();

    return () => { cancelled = true; };
  }, [id]);

  if (probeError) {
    return <div data-testid="page-research-detail"><ErrorState message={probeError} /></div>;
  }
  if (resolution === null) {
    return <div data-testid="page-research-detail"><PageLoading /></div>;
  }
  if (resolution === 'not_found') {
    return (
      <div data-testid="page-research-detail">
        <ErrorState message={`No research run found for id "${id}"`} />
      </div>
    );
  }
  return resolution === 'loop' ? <LoopDetailPage /> : <ResearchQueryDetailPage />;
}
