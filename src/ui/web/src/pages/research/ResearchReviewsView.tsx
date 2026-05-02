import { clsx } from 'clsx';
import {
  useIterationChecks,
  usePostMortems,
  useRunPostMortem,
  type IterationCheckRecord,
  type PostMortemRecord,
  type ResearchQuery,
} from '../../api/research-hooks';
import { humanizeFlag } from '../../components/research/FlagChip';
import { shortRelativeTime } from '../../utils/format';
import { Button } from '../../components/ui/Button';

interface Props { sessionId: string; query?: ResearchQuery }

export function ReviewsView({ sessionId, query }: Props) {
  const { data: checks = [], isLoading: checksLoading } = useIterationChecks(sessionId);
  const { data: mortems = [], isLoading: mortemsLoading } = usePostMortems(sessionId);
  const runPostMortem = useRunPostMortem();
  const error = runPostMortem.error instanceof Error ? runPostMortem.error.message : null;

  if (checksLoading || mortemsLoading) {
    return <div className="p-6 text-sm text-text-muted">Loading reviews…</div>;
  }

  if (checks.length === 0 && mortems.length === 0) {
    return (
      <div className="p-6 text-sm text-text-muted max-w-2xl">
        <p className="mb-2">No agent reviews yet.</p>
        <p>Reviews appear here as the run progresses:</p>
        <ul className="list-disc pl-5 mt-2 space-y-1">
          <li><span className="text-text-secondary">Iteration checks</span> fire every 5 iterations — they spot-check drift against the original prompt and can auto-prune off-topic threads.</li>
          <li><span className="text-text-secondary">Post-mortems</span> fire once per completed burst-job — they flag anomalies like low finding yield, thread skew, or runaway cost.</li>
        </ul>
        <div className="mt-4">
          <Button size="sm"
            loading={runPostMortem.isPending}
            onClick={() => runPostMortem.mutate({ sessionId })}>
            Run review now
          </Button>
          {error && <p className="text-sm text-error mt-2">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 flex flex-col gap-6 max-w-4xl">
      {mortems.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-1 gap-3">
            <h2 className="text-sm font-medium text-text-secondary uppercase tracking-wider">
              Post-mortems ({mortems.length})
            </h2>
            <Button size="sm" variant="ghost"
              loading={runPostMortem.isPending}
              onClick={() => runPostMortem.mutate({ sessionId })}>
              Re-run review
            </Button>
          </div>
          <p className="text-sm text-text-muted mb-3">
            One snapshot per session burst-job. Numbers reflect the run as of that
            timestamp — later activity isn't re-evaluated until the next job finishes
            or you re-run the review manually.
          </p>
          {error && <p className="text-sm text-error mb-2">{error}</p>}
          <div className="flex flex-col gap-3">
            {mortems.map((m, i) => <PostMortemCard key={m.id} record={m} latest={i === 0} query={query} />)}
          </div>
        </section>
      )}
      {checks.length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-text-secondary uppercase tracking-wider mb-3">
            Iteration checks ({checks.length})
          </h2>
          <div className="flex flex-col gap-3">
            {checks.map(c => <IterationCheckCard key={c.id} record={c} query={query} />)}
          </div>
        </section>
      )}
    </div>
  );
}

function VerdictBadge({ kind, label }: { kind: 'ok' | 'warn' | 'error' | 'neutral'; label: string }) {
  const cls = {
    ok: 'bg-green-900/40 text-green-300 border-green-500/30',
    warn: 'bg-yellow-900/40 text-yellow-300 border-yellow-500/30',
    error: 'bg-red-900/40 text-red-300 border-red-500/30',
    neutral: 'bg-bg-tertiary text-text-secondary border-border-primary',
  }[kind];
  return <span className={clsx('px-2 py-0.5 rounded text-sm font-medium border tabular-nums', cls)}>{label}</span>;
}

function CopyButton({ getText }: { getText: () => string }) {
  const copy = () => {
    navigator.clipboard.writeText(getText()).catch(() => {});
  };
  return (
    <button
      onClick={copy}
      className="px-2 py-0.5 rounded text-xs text-text-muted border border-border-primary bg-bg-tertiary hover:text-text-secondary hover:border-border-secondary transition-colors"
      title="Copy review to clipboard"
    >
      Export
    </button>
  );
}

function buildConfigSummary(config: Record<string, unknown>): string {
  const c = config as Record<string, unknown>;
  const lines: string[] = [];
  const pick = (key: string, label?: string) => {
    const v = c[key];
    if (v !== undefined && v !== null) lines.push(`  ${label ?? key}: ${JSON.stringify(v)}`);
  };
  pick('model');
  pick('model_fast');
  pick('budget_daily_usd');
  pick('budget_total_usd');
  pick('max_thread_depth');
  pick('max_total_threads');
  pick('max_concurrent_threads');
  pick('burst_iterations');
  pick('novelty_threshold');
  pick('dedup_similarity_threshold');
  pick('diminishing_returns_threshold');
  pick('role_priming_enabled');
  pick('role_label');
  const fu = c.follow_up as Record<string, unknown> | undefined;
  if (fu) lines.push(`  follow_up: min=${fu.min_count} max=${fu.max_count}`);
  const ga = c.gap_analysis as Record<string, unknown> | undefined;
  if (ga) lines.push(`  gap_analysis: enabled=${ga.enabled} max_gap_searches=${ga.max_gap_searches}`);
  const tc = c.topic_coherence as Record<string, unknown> | undefined;
  if (tc) lines.push(`  topic_coherence: seed_min=${tc.seed_similarity_min} hop_min=${tc.hop_similarity_min}`);
  const prov = c.providers as Record<string, unknown> | undefined;
  const models = prov?.openrouter_models;
  if (Array.isArray(models)) lines.push(`  openrouter_models: ${models.join(', ')}`);
  return lines.join('\n');
}

function buildPostMortemExport(record: PostMortemRecord, query?: ResearchQuery): string {
  const m = record.metrics_snapshot.metrics;
  const ts = record.metrics_snapshot.thread_state;
  const sh = record.metrics_snapshot.source_health;
  const fullTime = new Date(record.created_at).toLocaleString();

  const sections: string[] = [];

  sections.push('RESEARCH REVIEW EXPORT');
  sections.push('━'.repeat(40));

  if (query) {
    sections.push(`Query: ${query.title || query.prompt_super_short || '(untitled)'}`);
    sections.push(`Session ID: ${query.id}`);
    sections.push(`Status: ${query.status}`);
  } else {
    sections.push(`Session ID: ${record.session_id}`);
  }
  sections.push(`Reviewed: ${fullTime}${record.job_id ? ` (job ${record.job_id.slice(0, 8)})` : ''}`);
  sections.push('');

  const verdictLine = record.verdict === 'pass'
    ? 'VERDICT: PASS'
    : `VERDICT: FLAG — ${record.flags.map(humanizeFlag).join(', ')}`;
  sections.push(verdictLine);

  if (query?.prompt) {
    sections.push('');
    sections.push('━━ ORIGINAL PROMPT ━━');
    sections.push(query.prompt);
    if (query.prompt_hints && Object.keys(query.prompt_hints).some(k => (query.prompt_hints as Record<string, unknown>)[k])) {
      const hints = Object.entries(query.prompt_hints as Record<string, unknown>)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
      if (hints) sections.push(`Hints: ${hints}`);
    }
  }

  sections.push('');
  sections.push('━━ REVIEW NOTES ━━');
  sections.push(record.notes);

  if (record.recommendations.length > 0) {
    sections.push('');
    sections.push('━━ RECOMMENDATIONS ━━');
    record.recommendations.forEach((r, i) => sections.push(`${i + 1}. ${r}`));
  }

  if (m) {
    sections.push('');
    sections.push('━━ METRICS ━━');
    const errPct = m.steps > 0 ? ` (${(m.errors / m.steps * 100).toFixed(1)}%)` : '';
    sections.push(`Findings: ${m.findings} | Steps: ${m.steps} | Threads: ${m.threads_total} total (${m.threads_active} active)`);
    sections.push(`Errors: ${m.errors}${errPct} | Cost: $${m.cost_usd.toFixed(4)} | Duration: ${(m.duration_ms / 60_000).toFixed(1)}m`);
  }

  if (ts) {
    const byStatus = Object.entries(ts.by_status).map(([k, v]) => `${k}=${v}`).join(', ');
    sections.push(`Thread state: ${byStatus}`);
    sections.push(`Stuck: ${ts.stuck_count} | Pruned: ${ts.pruned_count}`);
  }

  if (sh && sh.total_attempts > 0) {
    const failDomains = sh.top_failing_domains.length > 0
      ? ' — top failing: ' + sh.top_failing_domains.map(d => `${d.domain}×${d.count}`).join(', ')
      : '';
    sections.push(`Source failure: ${(sh.failure_rate * 100).toFixed(1)}% of ${sh.total_attempts} attempts${failDomains}`);
  }

  if (query?.config && Object.keys(query.config).length > 0) {
    const configSummary = buildConfigSummary(query.config);
    if (configSummary) {
      sections.push('');
      sections.push('━━ SESSION CONFIG ━━');
      sections.push(configSummary);
    }
  }

  return sections.join('\n');
}

function buildIterationCheckExport(record: IterationCheckRecord, query?: ResearchQuery): string {
  const sections: string[] = [];

  sections.push('RESEARCH ITERATION CHECK EXPORT');
  sections.push('━'.repeat(40));

  if (query) {
    sections.push(`Query: ${query.title || query.prompt_super_short || '(untitled)'}`);
    sections.push(`Session ID: ${query.id}`);
  } else {
    sections.push(`Session ID: ${record.session_id}`);
  }
  sections.push(`Iteration: ${record.iterations_completed}`);
  sections.push(`Checked: ${record.created_at}${record.job_id ? ` (job ${record.job_id.slice(0, 8)})` : ''}`);
  sections.push('');

  const verdictLabel = record.verdict.replace(/_/g, ' ').toUpperCase();
  sections.push(`VERDICT: ${verdictLabel}`);

  if (query?.prompt) {
    sections.push('');
    sections.push('━━ ORIGINAL PROMPT ━━');
    sections.push(query.prompt);
  }

  if (record.notes) {
    sections.push('');
    sections.push('━━ CHECK NOTES ━━');
    sections.push(record.notes);
  }

  const killed = record.applied_actions.filter(a => a.action === 'kill_thread' && a.ok);
  const proposed = record.applied_actions.filter(a => a.action !== 'kill_thread' || !a.ok);

  if (killed.length > 0) {
    sections.push('');
    sections.push('━━ AUTO-PRUNED THREADS ━━');
    killed.forEach(a => sections.push(`  ✕ ${a.detail || a.target}`));
  }

  if (proposed.length > 0) {
    sections.push('');
    sections.push('━━ PROPOSALS ━━');
    proposed.forEach(a => {
      const status = a.ok ? '•' : '?';
      const err = a.error ? ` (${a.error})` : '';
      sections.push(`  ${status} ${a.action.replace(/_/g, ' ')}: ${a.detail || a.target}${err}`);
    });
  }

  if (query?.config && Object.keys(query.config).length > 0) {
    const configSummary = buildConfigSummary(query.config);
    if (configSummary) {
      sections.push('');
      sections.push('━━ SESSION CONFIG ━━');
      sections.push(configSummary);
    }
  }

  return sections.join('\n');
}

function PostMortemCard({ record, latest, query }: { record: PostMortemRecord; latest: boolean; query?: ResearchQuery }) {
  const m = record.metrics_snapshot.metrics;
  const sh = record.metrics_snapshot.source_health;
  const isPass = record.verdict === 'pass';
  const fullTime = new Date(record.created_at).toLocaleString();
  return (
    <div className="rounded-lg border border-border-primary bg-bg-secondary p-4">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          {isPass
            ? <VerdictBadge kind="ok" label="pass" />
            : record.flags.map(f => <VerdictBadge key={f} kind="warn" label={humanizeFlag(f)} />)}
          {latest && <span className="text-sm text-text-muted">latest</span>}
          {!latest && <span className="text-sm text-text-muted">earlier snapshot</span>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm text-text-muted" title={fullTime}>
            {shortRelativeTime(record.created_at)}
            {record.job_id && <span className="ml-2 font-mono">job {record.job_id.slice(0, 8)}</span>}
          </span>
          <CopyButton getText={() => buildPostMortemExport(record, query)} />
        </div>
      </div>
      <p className="text-sm text-text-secondary mb-3">{record.notes}</p>
      {record.recommendations.length > 0 && (
        <div className="mb-3">
          <p className="text-sm text-text-muted uppercase tracking-wider mb-1">Recommendations</p>
          <ul className="list-disc pl-5 text-sm text-text-secondary space-y-1">
            {record.recommendations.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      )}
      {m && (
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-text-muted border-t border-border-primary pt-2">
          <span>findings: <span className="text-text-secondary tabular-nums">{m.findings}</span></span>
          <span>steps: <span className="text-text-secondary tabular-nums">{m.steps}</span></span>
          <span>threads: <span className="text-text-secondary tabular-nums">{m.threads_total}</span></span>
          <span>errors: <span className="text-text-secondary tabular-nums">{m.errors}</span></span>
          <span>cost: <span className="text-text-secondary tabular-nums">${m.cost_usd.toFixed(4)}</span></span>
          <span>duration: <span className="text-text-secondary tabular-nums">{(m.duration_ms / 60_000).toFixed(1)}m</span></span>
          {sh && sh.total_attempts > 0 && (
            <span>source failure rate: <span className="text-text-secondary tabular-nums">{(sh.failure_rate * 100).toFixed(1)}%</span></span>
          )}
        </div>
      )}
    </div>
  );
}

function IterationCheckCard({ record, query }: { record: IterationCheckRecord; query?: ResearchQuery }) {
  const kind = record.verdict === 'on_track' ? 'ok' : record.verdict === 'drifting' ? 'warn' : 'error';
  const killed = record.applied_actions.filter(a => a.action === 'kill_thread' && a.ok);
  const proposed = record.applied_actions.filter(a => a.action !== 'kill_thread' || !a.ok);
  return (
    <div className="rounded-lg border border-border-primary bg-bg-secondary p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <VerdictBadge kind={kind} label={record.verdict.replace(/_/g, ' ')} />
          <span className="text-sm text-text-muted">iter {record.iterations_completed}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-text-muted font-mono">{record.created_at}</span>
          <CopyButton getText={() => buildIterationCheckExport(record, query)} />
        </div>
      </div>
      {record.notes && <p className="text-sm text-text-secondary mb-2">{record.notes}</p>}
      {killed.length > 0 && (
        <div className="mb-2">
          <p className="text-sm text-text-muted uppercase tracking-wider mb-1">Auto-pruned threads</p>
          <ul className="text-sm text-text-secondary space-y-0.5">
            {killed.map((a, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-red-400 shrink-0">✕</span>
                <span className="truncate">{a.detail || a.target}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {proposed.length > 0 && (
        <div>
          <p className="text-sm text-text-muted uppercase tracking-wider mb-1">Proposals</p>
          <ul className="text-sm text-text-secondary space-y-0.5">
            {proposed.map((a, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-text-muted shrink-0">{a.ok ? '•' : '?'}</span>
                <span className="truncate">
                  <span className="text-text-muted">{a.action.replace(/_/g, ' ')}:</span>{' '}
                  {a.detail || a.target}
                  {a.error && <span className="text-text-muted italic ml-1">({a.error})</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
