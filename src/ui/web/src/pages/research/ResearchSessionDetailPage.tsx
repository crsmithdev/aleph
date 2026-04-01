import { useParams, Link } from 'react-router-dom';
import { clsx } from 'clsx';
import {
  useResearchSession, useResearchFindings, useResearchThreads,
  useResearchCosts, useUpdateResearchSession, useRateFinding,
  useInjectThread, useRunResearch, useResearchRunning, useUpdateThread,
  useResearchActivity, useCancelJob,
  type ResearchFinding, type ResearchThread, type ResearchActivity,
  useResearchSteps, type ResearchStep,
} from '../../api/research-hooks';
import { Button } from '../../components/ui/Button';
import { PageLoading } from '../../components/ui/Spinner';
import { ErrorState } from '../../components/ui/ErrorState';
import { useState, useMemo } from 'react';

const originColors: Record<string, string> = {
  seed: 'bg-blue-900/50 text-blue-300',
  follow_up: 'bg-purple-900/50 text-purple-300',
  perturbation: 'bg-orange-900/50 text-orange-300',
  user_injected: 'bg-green-900/50 text-green-300',
};

const ratingColors: Record<string, string> = {
  promising: 'text-green-400',
  not_useful: 'text-red-400',
  critical: 'text-yellow-400',
};

function NoveltyBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
        <div
          className={clsx('h-full rounded-full', value > 0.7 ? 'bg-green-400' : value > 0.4 ? 'bg-yellow-400' : 'bg-red-400')}
          style={{ width: `${value * 100}%` }}
        />
      </div>
      <span className="text-xs text-text-muted">{value.toFixed(2)}</span>
    </div>
  );
}

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function ActivityPanel({ activity, onCancel }: { activity: ResearchActivity; onCancel?: () => void }) {
  if (activity.running) {
    const job = activity.job;
    const progress = job?.max_iterations
      ? `${job.iterations_completed}/${job.max_iterations}`
      : job ? `${job.iterations_completed} iterations` : '';

    return (
      <div className="bg-green-900/20 border border-green-800/50 rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-sm font-medium text-green-300">
              {job?.status === 'claimed' ? 'Starting...' : 'Researching'}
            </span>
            {progress && <span className="text-xs text-green-400/70">{progress}</span>}
          </div>
          {onCancel && (
            <button onClick={onCancel} className="text-xs text-red-400/70 hover:text-red-400 transition-colors">
              Cancel
            </button>
          )}
        </div>
        {activity.active_thread && (
          <p className="text-sm text-text-secondary truncate">{activity.active_thread.query}</p>
        )}
        <div className="flex items-center gap-4 mt-2 text-xs text-text-muted">
          <span>{activity.queued_threads} queued</span>
          <span>{activity.exhausted_threads} exhausted</span>
          {activity.recent_steps[0] && (
            <span>last step {timeAgo(activity.recent_steps[0].created_at)}</span>
          )}
        </div>
      </div>
    );
  }

  // Job is pending (queued, waiting for worker to pick up)
  if (activity.job?.status === 'pending') {
    return (
      <div className="bg-yellow-900/20 border border-yellow-800/50 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
            <span className="text-sm font-medium text-yellow-300">Queued</span>
            <span className="text-xs text-text-muted">Waiting for worker...</span>
          </div>
          {onCancel && (
            <button onClick={onCancel} className="text-xs text-red-400/70 hover:text-red-400 transition-colors">
              Cancel
            </button>
          )}
        </div>
      </div>
    );
  }

  const lastStep = activity.recent_steps[0];
  if (!lastStep) {
    return (
      <div className="bg-bg-secondary border border-border-primary rounded-lg p-4">
        <p className="text-sm text-text-muted">No research activity yet. Hit Run to start.</p>
      </div>
    );
  }

  return (
    <div className="bg-bg-secondary border border-border-primary rounded-lg p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="w-2 h-2 rounded-full bg-text-muted" />
        <span className="text-sm font-medium text-text-secondary">Idle</span>
      </div>
      <div className="flex items-center gap-4 text-xs text-text-muted">
        <span>{activity.queued_threads} threads queued</span>
        <span>{activity.exhausted_threads} exhausted</span>
        <span>last activity {timeAgo(lastStep.created_at)}</span>
      </div>
      {activity.recent_steps.length > 0 && (
        <div className="mt-3 space-y-1">
          <p className="text-xs text-text-muted font-medium">Recent steps:</p>
          {activity.recent_steps.slice(0, 3).map((step, i) => (
            <div key={i} className="flex items-center gap-2 text-xs text-text-muted">
              <span className="font-mono">{step.model.split('/').pop()?.replace('claude-', '')}</span>
              <span>${step.cost_usd.toFixed(4)}</span>
              <span>{(step.duration_ms / 1000).toFixed(1)}s</span>
              {step.error && <span className="text-red-400">error</span>}
              <span className="text-text-muted/50">{timeAgo(step.created_at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FindingCard({ finding, onRate }: { finding: ResearchFinding; onRate: (id: string, rating: string) => void }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-bg-secondary border border-border-primary rounded-lg p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-text-primary">{finding.summary}</p>
          <div className="flex items-center gap-3 mt-2">
            <div className="flex items-center gap-1">
              <span className="text-xs text-text-muted">Confidence:</span>
              <NoveltyBar value={finding.confidence} />
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs text-text-muted">Novelty:</span>
              <NoveltyBar value={finding.novelty} />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {(['promising', 'critical', 'not_useful'] as const).map(rating => (
            <button
              key={rating}
              onClick={() => onRate(finding.id, rating)}
              className={clsx(
                'px-1.5 py-0.5 rounded text-xs transition-colors',
                finding.user_rating === rating
                  ? ratingColors[rating]
                  : 'text-text-muted hover:text-text-secondary'
              )}
              title={rating.replace('_', ' ')}
            >
              {rating === 'promising' ? '+' : rating === 'critical' ? '!' : '-'}
            </button>
          ))}
        </div>
      </div>

      {finding.tags.length > 0 && (
        <div className="flex gap-1 mt-2">
          {finding.tags.map(tag => (
            <span key={tag} className="px-1.5 py-0.5 bg-bg-tertiary text-text-muted text-xs rounded">{tag}</span>
          ))}
        </div>
      )}

      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-accent mt-2 hover:underline"
      >
        {expanded ? 'Collapse' : 'Expand'}
      </button>

      {expanded && (
        <div className="mt-3 space-y-3">
          <div className="text-sm text-text-secondary whitespace-pre-wrap">{finding.content}</div>
          {finding.source_urls.length > 0 && (
            <div>
              <p className="text-xs text-text-muted font-medium mb-1">Sources:</p>
              <ul className="space-y-0.5">
                {finding.source_urls.map((url, i) => (
                  <li key={i}>
                    <a href={url} target="_blank" rel="noopener noreferrer" className="text-xs text-accent hover:underline truncate block">{url}</a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {finding.follow_up_questions.length > 0 && (
            <div>
              <p className="text-xs text-text-muted font-medium mb-1">Follow-up questions:</p>
              <ul className="space-y-0.5">
                {finding.follow_up_questions.map((q, i) => (
                  <li key={i} className="text-xs text-text-secondary">- {q}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function stepLabel(step: ResearchStep): string {
  if (step.error) return `Error: ${step.error}`;
  const tools = step.tool_calls;
  if (tools.length > 0) {
    const searchTools = tools.filter(t => t.tool === 'web_search');
    if (searchTools.length > 0) {
      const query = (searchTools[0].input as Record<string, unknown>)?.query;
      return `Search: "${query}"`;
    }
    return tools.map(t => t.tool).join(', ');
  }
  return 'LLM call';
}

function ThreadSteps({ sessionId, threadId }: { sessionId: string; threadId: string }) {
  const { data: steps = [] } = useResearchSteps(sessionId, threadId);
  const sorted = [...steps].reverse(); // chronological order

  if (sorted.length === 0) return <p className="text-xs text-text-muted">No steps recorded.</p>;

  return (
    <div className="space-y-0">
      {sorted.map((step, i) => (
        <div key={step.id} className="flex items-start gap-2 py-1.5">
          <div className="flex flex-col items-center shrink-0 mt-0.5">
            <div className={clsx(
              'w-4 h-4 rounded-full border-2 flex items-center justify-center text-[10px]',
              step.error ? 'border-red-400 text-red-400' : 'border-green-400 text-green-400'
            )}>
              {step.error ? '!' : '✓'}
            </div>
            {i < sorted.length - 1 && <div className="w-px h-full min-h-[12px] bg-border-primary" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className={clsx('text-xs truncate', step.error ? 'text-red-400' : 'text-text-secondary')}>
              {stepLabel(step)}
            </p>
            <div className="flex items-center gap-2 text-[10px] text-text-muted">
              <span>{step.model.replace('claude-', '')}</span>
              <span>${step.cost_usd.toFixed(4)}</span>
              <span>{(step.duration_ms / 1000).toFixed(1)}s</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ThreadList({
  threads, findings, sessionId, onUpdateThread, onInject, onRateFinding,
}: {
  threads: ResearchThread[];
  findings: ResearchFinding[];
  sessionId: string;
  onUpdateThread: (threadId: string, updates: { status?: string; max_depth?: number }) => void;
  onInject: (query: string) => void;
  onRateFinding: (id: string, rating: string) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const findingsByThread = useMemo(() => {
    const map = new Map<string, ResearchFinding[]>();
    for (const f of findings) {
      const arr = map.get(f.thread_id) ?? [];
      arr.push(f);
      map.set(f.thread_id, arr);
    }
    return map;
  }, [findings]);

  return (
    <div className="space-y-1">
      {threads.map(thread => {
        const threadFindings = findingsByThread.get(thread.id) ?? [];
        const topFinding = threadFindings[0];
        const isExpanded = expandedId === thread.id;

        return (
          <div key={thread.id} className="bg-bg-secondary border border-border-primary rounded-lg overflow-hidden">
            <div
              className="px-4 py-3 cursor-pointer hover:bg-bg-tertiary/30 transition-colors"
              onClick={() => setExpandedId(isExpanded ? null : thread.id)}
            >
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-primary truncate">{thread.query}</p>
                  {topFinding && !isExpanded && (
                    <p className="text-xs text-text-muted mt-1 truncate">{topFinding.summary}</p>
                  )}
                  <div className="flex items-center gap-2 mt-1">
                    <span className={clsx('px-1.5 py-0.5 rounded text-xs font-medium', originColors[thread.origin])}>
                      {thread.origin.replace('_', ' ')}
                    </span>
                    {thread.perturbation_strategy && (
                      <span className="text-xs text-text-muted">{thread.perturbation_strategy.replace('_', ' ')}</span>
                    )}
                    <span className="text-xs text-text-muted flex items-center gap-0.5" onClick={e => e.stopPropagation()}>
                      depth {thread.depth}/
                      <input
                        type="number"
                        min={thread.depth + 1}
                        max={20}
                        value={thread.max_depth}
                        onChange={e => onUpdateThread(thread.id, { max_depth: Number(e.target.value) })}
                        className="w-8 bg-transparent border-b border-text-muted/30 text-text-muted text-xs text-center focus:outline-none focus:border-accent hover:border-text-muted/60"
                      />
                    </span>
                    {threadFindings.length > 0 && (
                      <span className="text-xs text-text-muted">{threadFindings.length} finding{threadFindings.length !== 1 ? 's' : ''}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                  <span className={clsx(
                    'px-2 py-0.5 rounded text-xs font-medium',
                    thread.status === 'active' ? 'bg-green-900/50 text-green-300'
                      : thread.status === 'exhausted' ? 'bg-bg-tertiary text-text-muted'
                        : thread.status === 'pruned' ? 'bg-red-900/50 text-red-300'
                          : thread.status === 'deferred' ? 'bg-blue-900/30 text-blue-400'
                            : 'bg-yellow-900/50 text-yellow-300'
                  )}>
                    {thread.status}
                  </span>
                  {(thread.status === 'exhausted' || thread.status === 'pruned' || thread.status === 'deferred') && (
                    <button
                      onClick={() => onUpdateThread(thread.id, { status: 'queued' })}
                      className="text-xs text-text-muted hover:text-accent transition-colors"
                    >
                      Re-research
                    </button>
                  )}
                  {!thread.parent_thread_id && (
                    <button
                      onClick={() => onInject(thread.query)}
                      className="text-xs text-text-muted hover:text-purple-400 transition-colors"
                    >
                      New topic
                    </button>
                  )}
                  {(thread.status === 'active' || thread.status === 'queued') && (
                    <button
                      onClick={() => onUpdateThread(thread.id, { status: 'pruned' })}
                      className="text-xs text-text-muted hover:text-red-400 transition-colors"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            </div>

            {isExpanded && (
              <div className="border-t border-border-primary px-4 py-3 space-y-3">
                <div>
                  <p className="text-xs font-medium text-text-muted mb-1">Steps</p>
                  <ThreadSteps sessionId={sessionId} threadId={thread.id} />
                </div>
                {threadFindings.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-text-muted">Findings</p>
                    {threadFindings.map(f => (
                      <FindingCard key={f.id} finding={f} onRate={onRateFinding} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ResearchSessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: session, isLoading, isError } = useResearchSession(id!);
  const { data: runningData } = useResearchRunning(id!);
  const isRunning = runningData?.running ?? false;
  const pollInterval = isRunning ? 5000 : undefined;
  const { data: findingsData = [] } = useResearchFindings(id!, { refetchInterval: pollInterval });
  const { data: threadsData = [] } = useResearchThreads(id!, { refetchInterval: pollInterval });
  const { data: costs } = useResearchCosts(id!, { refetchInterval: pollInterval });
  const { data: activity } = useResearchActivity(id!, { refetchInterval: isRunning ? 3000 : undefined });
  const updateSession = useUpdateResearchSession();
  const rateFinding = useRateFinding();
  const injectThread = useInjectThread();
  const runResearch = useRunResearch();
  const cancelJobMutation = useCancelJob();
  const updateThread = useUpdateThread();
  const [newQuestion, setNewQuestion] = useState('');
  const [injectDepth, setInjectDepth] = useState(8);
  const [tab, setTab] = useState<'findings' | 'threads'>('findings');
  const [runError, setRunError] = useState<string | null>(null);

  if (isLoading) return <PageLoading />;
  if (isError || !session) return <ErrorState message="Session not found." />;

  function handleInject(e: React.FormEvent) {
    e.preventDefault();
    if (!newQuestion.trim()) return;
    injectThread.mutate({ sessionId: id!, query: newQuestion.trim(), max_depth: injectDepth });
    setNewQuestion('');
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div>
        <Link to="/research" className="text-xs text-accent hover:underline">&larr; All sessions</Link>
        <div className="flex items-center justify-between mt-2">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">{session.title}</h1>
            <p className="text-sm text-text-muted mt-0.5">{session.seed_query}</p>
          </div>
          <div className="flex items-center gap-2">
            {(session.status === 'active' || session.status === 'paused') && (
              <Button
                variant="primary"
                size="sm"
                loading={runResearch.isPending}
                disabled={isRunning}
                onClick={() => {
                  setRunError(null);
                  runResearch.mutate(
                    { sessionId: id!, iterations: 5 },
                    { onError: (err) => setRunError(err instanceof Error ? err.message : String(err)) }
                  );
                }}
              >
                {isRunning ? 'Running...' : 'Run'}
              </Button>
            )}
            {session.status === 'active' && (
              <Button variant="secondary" size="sm" onClick={() => updateSession.mutate({ id: id!, status: 'paused' })}>
                Pause
              </Button>
            )}
            {session.status === 'paused' && (
              <Button variant="secondary" size="sm" onClick={() => updateSession.mutate({ id: id!, status: 'active' })}>
                Resume
              </Button>
            )}
            <Link to={`/research/${id}/plan`}>
              <Button variant="secondary" size="sm">Plan</Button>
            </Link>
            {session.status !== 'archived' && (
              <Button variant="ghost" size="sm" onClick={() => updateSession.mutate({ id: id!, status: 'archived' })}>
                Archive
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Error */}
      {runError && (
        <div className="bg-red-900/20 border border-red-800/50 rounded-lg px-4 py-3 flex items-center justify-between">
          <p className="text-sm text-red-300">{runError}</p>
          <button onClick={() => setRunError(null)} className="text-red-400 hover:text-red-300 text-xs">dismiss</button>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Findings', value: findingsData.length },
          { label: 'Threads', value: threadsData.length },
          { label: 'Cost', value: costs ? `$${costs.total_cost.toFixed(3)}` : '...' },
          { label: 'Today', value: costs ? `$${costs.today_cost.toFixed(3)}` : '...' },
        ].map(stat => (
          <div key={stat.label} className="bg-bg-secondary border border-border-primary rounded-lg p-3">
            <p className="text-xs text-text-muted">{stat.label}</p>
            <p className="text-lg font-semibold text-text-primary">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Activity */}
      {activity && (
        <ActivityPanel
          activity={activity}
          onCancel={activity.job ? () => cancelJobMutation.mutate({ jobId: activity.job!.id }) : undefined}
        />
      )}

      {/* Summary */}
      {session.summary && (
        <div className="bg-bg-secondary border border-border-primary rounded-lg p-4">
          <h3 className="text-xs font-medium text-text-muted mb-2">Summary</h3>
          <p className="text-sm text-text-secondary whitespace-pre-wrap">{session.summary}</p>
        </div>
      )}

      {/* Inject question */}
      <form onSubmit={handleInject} className="flex gap-2 items-center">
        <input
          type="text"
          value={newQuestion}
          onChange={e => setNewQuestion(e.target.value)}
          placeholder="Inject a research question..."
          className="flex-1 bg-bg-secondary border border-border-primary rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
        />
        <label className="flex items-center gap-1 text-xs text-text-muted shrink-0">
          Depth
          <input
            type="number"
            min={1}
            max={20}
            value={injectDepth}
            onChange={e => setInjectDepth(Number(e.target.value))}
            className="w-12 bg-bg-secondary border border-border-primary rounded px-1.5 py-1.5 text-sm text-text-primary text-center focus:outline-none focus:border-accent"
          />
        </label>
        <Button type="submit" variant="secondary" size="sm" loading={injectThread.isPending}>Inject</Button>
      </form>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border-primary">
        {(['findings', 'threads'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={clsx(
              'px-3 py-2 text-sm font-medium border-b-2 transition-colors capitalize',
              tab === t ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:text-text-secondary'
            )}
          >
            {t} ({t === 'findings' ? findingsData.length : threadsData.length})
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === 'findings' ? (
        <div className="space-y-2">
          {findingsData.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-8">No findings yet. Run the engine to start researching.</p>
          ) : (
            findingsData.map(f => (
              <FindingCard
                key={f.id}
                finding={f}
                onRate={(fid, rating) => rateFinding.mutate({ id: fid, user_rating: rating })}
              />
            ))
          )}
        </div>
      ) : (
        <ThreadList
          threads={threadsData}
          findings={findingsData}
          sessionId={id!}
          onUpdateThread={(threadId, updates) => updateThread.mutate({ id: threadId, sessionId: id!, ...updates })}
          onInject={(query) => injectThread.mutate({ sessionId: id!, query })}
          onRateFinding={(fid, rating) => rateFinding.mutate({ id: fid, user_rating: rating })}
        />
      )}
    </div>
  );
}
