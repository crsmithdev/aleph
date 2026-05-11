import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import { useResearchErrorStatus, type ErrorKind, type SessionErrorStatus } from '../../api/research-hooks';

const KIND_LABEL: Record<ErrorKind, string> = {
  credit_exhausted: 'Credits exhausted',
  rate_limit: 'Rate-limited',
  overload: 'Provider overloaded',
};

const KIND_HINT: Record<ErrorKind, string> = {
  credit_exhausted: 'Top up at openrouter.ai/settings/credits or lower llm_max_output_tokens in config.',
  rate_limit: 'Workers are backing off automatically.',
  overload: 'Retrying with exponential backoff.',
};

const KIND_CLASSES: Record<ErrorKind, string> = {
  credit_exhausted: 'border-danger/40 bg-danger/10 text-danger',
  rate_limit: 'border-warning/40 bg-warning/10 text-warning',
  overload: 'border-warning/40 bg-warning/10 text-warning',
};

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso + 'Z').getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}

/**
 * Global banner shown when any active/paused research session is currently
 * blocked on a transient provider error. Intentionally noisy for
 * credit_exhausted — that one needs human action to clear.
 */
export function CreditExhaustedBanner({ sessionId }: { sessionId?: string } = {}) {
  const { data } = useResearchErrorStatus();
  if (!data || !data.worst) return null;

  // If sessionId provided, show only if this session is affected. Otherwise show global state.
  const relevant = sessionId ? data.sessions.filter(s => s.session_id === sessionId) : data.sessions;
  if (relevant.length === 0) return null;

  // Group by kind, show the worst.
  const severity: Record<ErrorKind, number> = { credit_exhausted: 3, overload: 2, rate_limit: 1 };
  const worstInScope = relevant.reduce<SessionErrorStatus>(
    (acc, s) => (severity[s.error_kind] > severity[acc.error_kind] ? s : acc),
    relevant[0],
  );
  const kind = worstInScope.error_kind;
  const affected = relevant.filter(s => s.error_kind === kind);
  const totalSessions = new Set(affected.map(s => s.session_id)).size;

  return (
    <div
      role="alert"
      className={clsx(
        'flex items-start gap-3 px-4 py-3 rounded-md border text-sm',
        KIND_CLASSES[kind],
      )}
    >
      <span className="material-symbols-outlined flex-shrink-0 text-lg leading-none" aria-hidden>
        {kind === 'credit_exhausted' ? 'credit_card_off' : 'hourglass_top'}
      </span>
      <div className="flex-1 min-w-0">
        <div className="font-medium">
          {KIND_LABEL[kind]}
          {sessionId
            ? ` — ${affected[0].count} attempt${affected[0].count === 1 ? '' : 's'} failed, last ${formatRelative(affected[0].last_at)}`
            : ` on ${totalSessions} session${totalSessions === 1 ? '' : 's'}, last ${formatRelative(affected[0].last_at)}`}
        </div>
        <div className="text-xs opacity-80 mt-0.5">
          {KIND_HINT[kind]}
        </div>
        {!sessionId && affected.length > 0 && (
          <div className="text-xs mt-1 flex flex-wrap gap-x-3 gap-y-0.5 opacity-90">
            {affected.slice(0, 5).map(s => (
              <Link
                key={s.session_id}
                to={`/research/${s.session_id}`}
                className="underline decoration-dotted underline-offset-2 hover:opacity-100"
              >
                {s.session_title.slice(0, 50)}
              </Link>
            ))}
            {affected.length > 5 && <span>+{affected.length - 5} more</span>}
          </div>
        )}
        {sessionId && (
          <details className="mt-1 text-xs opacity-80">
            <summary className="cursor-pointer select-none hover:opacity-100">Last error</summary>
            <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] opacity-80">{affected[0].last_message || '(no message)'}</pre>
          </details>
        )}
      </div>
      {kind === 'credit_exhausted' && (
        <a
          href="https://openrouter.ai/settings/credits"
          target="_blank"
          rel="noreferrer"
          className="flex-shrink-0 text-xs underline decoration-dotted underline-offset-2 hover:opacity-80"
        >
          Top up →
        </a>
      )}
    </div>
  );
}
