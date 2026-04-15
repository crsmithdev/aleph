import { Icon } from '../../components/ui/Icon';
import { useState, useMemo, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { clsx } from 'clsx';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
// @ts-ignore
import dagre from 'dagre';
import { ReactFlow, Background, Controls, MiniMap, Handle, Position, BackgroundVariant } from '@xyflow/react';
import type { Node, Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  useResearchSession, useResearchFindings, useResearchThreads,
  useResearchCosts, useUpdateResearchSession, useRateFinding,
  useInjectThread, useRunResearch, useResearchRunning,
  useResearchActivity, useCancelJob, useResearchJobs, useResearchStream,
  useResearchSteps, useUpdateThread, useDeleteResearchSession, useUpdateSessionConfig,
  useResearchEnvCheck, useFetchThreadText, useRedoThread, useFetchFindingText,
  type ResearchFinding, type ResearchThread, type ResearchActivity,
  type ResearchJob, type StreamEvent, type ResearchStep,
} from '../../api/research-hooks';
import { Button } from '../../components/ui/Button';
import { PageLoading } from '../../components/ui/Spinner';
import { ErrorState } from '../../components/ui/ErrorState';

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

// --- Document Tab ---

function ConfBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-xs text-text-muted">{label}</span>
      <div className="w-12 h-1 bg-bg-tertiary rounded-full overflow-hidden">
        <div
          className={clsx('h-full rounded-full', value > 0.7 ? 'bg-success' : value > 0.4 ? 'bg-warning' : 'bg-error')}
          style={{ width: `${value * 100}%` }}
        />
      </div>
      <span className="text-xs text-text-muted">{(value * 100).toFixed(0)}%</span>
    </div>
  );
}

function Md({ children, className }: { children: string; className?: string }) {
  if (!children || typeof children !== 'string') return null;
  return (
    <div className={['md-content', className].filter(Boolean).join(' ')}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}

function FindingRow({ finding, index }: { finding: ResearchFinding; index: number }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-3">
        <span className="text-text-muted text-xs font-mono shrink-0 mt-0.5">[{index}]</span>
        <div className="flex-1 min-w-0">
          <p className="text-base text-text-primary">{finding.summary}</p>
          <div className="flex items-center gap-4 mt-1.5">
            <ConfBar label="conf" value={finding.confidence} />
            <ConfBar label="novel" value={finding.novelty} />
            {finding.source_urls.length > 0 && (
              <span className="text-xs text-text-muted">{finding.source_urls.length} source{finding.source_urls.length !== 1 ? 's' : ''}</span>
            )}
            {finding.tags.map(tag => (
              <span key={tag} className="px-1.5 py-0.5 bg-bg-tertiary text-text-muted text-xs rounded">{tag}</span>
            ))}
          </div>
          {expanded && (
            <div className="mt-3 space-y-3">
              <Md>{finding.content}</Md>
              {finding.source_texts && finding.source_texts.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-text-muted uppercase tracking-wide">Sources</p>
                  {finding.source_texts.map((text, i) => (
                    <div key={i} className="bg-bg-tertiary/30 rounded px-2 py-1.5">
                      {finding.source_urls[i] && (
                        <a href={finding.source_urls[i]} target="_blank" rel="noopener noreferrer"
                          className="block text-xs text-accent hover:underline truncate mb-1">
                          {finding.source_urls[i]}
                        </a>
                      )}
                      <Md className="md-sm">{text.length > 2000 ? text.slice(0, 2000) + '\n\n…' : text}</Md>
                    </div>
                  ))}
                </div>
              )}
              {finding.source_urls.length > finding.source_texts.length && (
                <div className="space-y-0.5">
                  {finding.source_urls.slice(finding.source_texts.length).map((url, i) => (
                    <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                      className="block text-xs text-accent hover:underline truncate">[{i + 1 + finding.source_texts.length}] {url}</a>
                  ))}
                </div>
              )}
            </div>
          )}
          <button onClick={() => setExpanded(e => !e)} className="text-xs text-accent mt-1.5 hover:underline">
            {expanded ? 'collapse' : 'expand'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DocumentView({ findings, threads }: { findings: ResearchFinding[]; threads: ResearchThread[] }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const findingsByThread = useMemo(() => {
    const map = new Map<string, ResearchFinding[]>();
    for (const f of findings) {
      const arr = map.get(f.thread_id) ?? [];
      arr.push(f);
      map.set(f.thread_id, arr);
    }
    return map;
  }, [findings]);

  const sectionsThreads = useMemo(() =>
    threads
      .filter(t => (findingsByThread.get(t.id) ?? []).length > 0)
      .sort((a, b) => {
        if (a.origin === 'seed') return -1;
        if (b.origin === 'seed') return 1;
        return a.depth - b.depth || a.created_at.localeCompare(b.created_at);
      }),
    [threads, findingsByThread]
  );

  if (sectionsThreads.length === 0) {
    return <p className="text-sm text-text-muted text-center py-12">No findings yet. Run the engine to start researching.</p>;
  }

  return (
    <div className="space-y-1">
      {sectionsThreads.map((thread, sectionIdx) => {
        const sectionFindings = (findingsByThread.get(thread.id) ?? [])
          .slice().sort((a, b) => b.confidence - a.confidence);
        const isCollapsed = collapsed.has(thread.id);

        return (
          <div key={thread.id} className="border border-border-primary rounded-lg overflow-hidden">
            <button
              onClick={() => setCollapsed(prev => {
                const n = new Set(prev);
                n.has(thread.id) ? n.delete(thread.id) : n.add(thread.id);
                return n;
              })}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-bg-tertiary/30 transition-colors text-left"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-text-muted text-xs font-mono shrink-0">{String(sectionIdx + 1).padStart(2, '0')}</span>
                <span className="text-base font-medium text-text-primary truncate">{thread.query}</span>
                <span className={clsx('px-1.5 py-0.5 rounded text-xs shrink-0',
                  thread.origin === 'seed' ? 'bg-accent/10 text-accent' : 'bg-accent/5 text-accent/70'
                )}>{thread.origin.replace('_', ' ')}</span>
              </div>
              <div className="flex items-center gap-3 shrink-0 ml-3">
                <span className="text-xs text-text-muted">{sectionFindings.length} finding{sectionFindings.length !== 1 ? 's' : ''}</span>
                <Icon name="expand_more" size="xs" className={clsx('w-4 h-4 text-text-muted transition-transform', isCollapsed && 'rotate-180')} />
              </div>
            </button>

            {!isCollapsed && (
              <div className="border-t border-border-primary divide-y divide-border-primary/50">
                {sectionFindings.map((finding, idx) => (
                  <FindingRow key={finding.id} finding={finding} index={idx + 1} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// --- Live Tab (thread-per-row view) ---

function orderThreadsDepthFirst(threads: ResearchThread[]): ResearchThread[] {
  const byParent = new Map<string | null, ResearchThread[]>();
  for (const t of threads) {
    const key = t.parent_thread_id ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(t);
  }
  for (const arr of byParent.values()) arr.sort((a, b) => a.created_at.localeCompare(b.created_at));
  const result: ResearchThread[] = [];
  function walk(parentId: string | null) {
    for (const t of byParent.get(parentId) ?? []) { result.push(t); walk(t.id); }
  }
  walk(null);
  return result;
}

const liveStatusDot: Record<string, string> = {
  active: 'bg-success animate-pulse',
  queued: 'bg-warning/70',
  exhausted: 'bg-text-muted/40',
  deferred: 'bg-accent/50',
  pruned: 'bg-error/70',
  paused: 'bg-warning/50',
};

const liveOriginColor: Record<string, string> = {
  seed: 'bg-accent/10 text-accent',
  follow_up: 'bg-accent/5 text-accent/70',
  perturbation: 'bg-warning/10 text-warning',
  verify: 'bg-error/10 text-error',
  user_injected: 'bg-success/10 text-success',
  monitor_alert: 'bg-warning/15 text-warning',
};

function ThreadLiveRow({
  thread, steps, threadFindings, childThreads, parentThread, depth, expanded, onToggle, sessionId,
}: {
  thread: ResearchThread;
  steps: ResearchStep[];
  threadFindings: ResearchFinding[];
  childThreads: ResearchThread[];
  parentThread: ResearchThread | null;
  depth: number;
  expanded: boolean;
  onToggle: () => void;
  sessionId: string;
}) {
  const updateThread = useUpdateThread();
  const fetchThreadText = useFetchThreadText();
  const redoThread = useRedoThread();
  const fetchFindingText = useFetchFindingText();
  const isTerminal = thread.status === 'exhausted' || thread.status === 'pruned';

  // Build timeline events sorted by time
  const timelineSteps = [...steps].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const errors = steps.filter(s => s.error);
  const followUpCandidates = threadFindings.flatMap(f => f.follow_up_analysis?.candidates ?? []);
  const hasAnalysis = threadFindings.some(f => f.follow_up_analysis);
  const childQuerySet = new Set(childThreads.map(t => t.query.toLowerCase().trim()));

  // Thread query display: first line as header, rest expandable
  const queryLines = thread.query.split('\n');
  const queryFirstLine = queryLines[0].length > 100
    ? queryLines[0].slice(0, 100) + '…'
    : queryLines[0];
  const queryHasMore = queryLines.length > 1 || queryLines[0].length > 100;

  // Per-thread fetch_source_text: null means use session default
  const threadFetch = thread.fetch_source_text;

  function handleFetchToggle() {
    const newVal = threadFetch === true ? false : threadFetch === false ? null : true;
    updateThread.mutate({ id: thread.id, sessionId, fetch_source_text: newVal });
    // If completed thread toggled ON, trigger fetch
    if (newVal === true && isTerminal) {
      fetchThreadText.mutate({ sessionId, threadId: thread.id });
    }
  }

  return (
    <div style={{ marginLeft: depth * 18 }}>
      <div className="flex items-center gap-1 group">
        <button
          onClick={onToggle}
          className="flex-1 flex items-start gap-2 px-3 py-2 rounded-lg hover:bg-bg-tertiary/30 transition-colors text-left"
        >
          <span className={clsx('mt-1.5 w-1.5 h-1.5 rounded-full shrink-0', liveStatusDot[thread.status] ?? 'bg-text-muted/40')} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-base text-text-primary leading-snug">
                {queryFirstLine}
                {queryHasMore && !expanded && <span className="text-text-muted/50">…</span>}
              </span>
              <span className={clsx('px-1 py-0.5 rounded text-xs shrink-0', liveOriginColor[thread.origin] ?? 'bg-bg-tertiary text-text-muted')}>
                {thread.origin.replace(/_/g, ' ')}
              </span>
              {thread.priority !== undefined && (
                <span className="text-xs text-text-muted font-mono shrink-0">p:{thread.priority.toFixed(2)}</span>
              )}
              {thread.status === 'exhausted' && threadFindings.length > 0 && (
                <span className="text-xs text-text-muted shrink-0">{threadFindings.length} finding{threadFindings.length !== 1 ? 's' : ''}</span>
              )}
              {thread.status === 'active' && (
                <span className="text-xs text-success shrink-0">running…</span>
              )}
              {/* Fetch-text indicator — always visible, shows per-thread override */}
              {threadFetch !== null && (
                <span className={clsx('px-1 py-0.5 rounded text-xs shrink-0 font-mono',
                  threadFetch ? 'bg-success/10 text-success' : 'bg-error/10 text-error/70'
                )}>
                  {threadFetch ? <><Icon name="check" size="xs" className="text-green-400" /> full-text</> : <><Icon name="close" size="xs" className="text-red-400" /> full-text</>}
                </span>
              )}
            </div>
          </div>
          <Icon name="expand_more" size="xs" className={clsx('w-3.5 h-3.5 text-text-muted shrink-0 mt-1 transition-transform', expanded && 'rotate-180')} />
        </button>
        {/* Per-row controls — always visible */}
        <div className="flex items-center gap-1 pr-2 shrink-0" onClick={e => e.stopPropagation()}>
          <button
            title={threadFetch === true ? 'Full-text ON — click to turn OFF' : threadFetch === false ? 'Full-text OFF — click to use session default' : 'Full-text: using session default — click to force ON'}
            onClick={handleFetchToggle}
            className={clsx('px-1.5 py-0.5 rounded text-xs border transition-colors',
              threadFetch === true
                ? 'bg-green-900/40 border-green-700/40 text-green-400 hover:bg-green-900/60'
                : threadFetch === false
                  ? 'bg-red-900/30 border-red-700/30 text-red-400/70 hover:bg-red-900/50'
                  : 'bg-bg-secondary border-border-primary text-text-muted/50 hover:text-text-muted'
            )}
          >txt</button>
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              title="Increase priority"
              onClick={() => updateThread.mutate({ id: thread.id, sessionId, priority: Math.min(1.0, thread.priority + 0.1) })}
              className="p-1 text-text-muted hover:text-text-primary rounded"
            ><Icon name="keyboard_arrow_up" size="xs" /></button>
            <button
              title="Decrease priority"
              onClick={() => updateThread.mutate({ id: thread.id, sessionId, priority: Math.max(0.0, thread.priority - 0.1) })}
              className="p-1 text-text-muted hover:text-text-primary rounded"
            ><Icon name="keyboard_arrow_down" size="xs" /></button>
            {isTerminal && (
              <button
                title="Redo thread (re-run all searches and generate new findings)"
                onClick={() => redoThread.mutate({ sessionId, threadId: thread.id })}
                disabled={redoThread.isPending}
                className="p-1 text-text-muted hover:text-blue-400 rounded text-xs"
              >↺</button>
            )}
            {isTerminal && (
              <button
                title="Redo thread with full-text fetching (clears findings, re-runs with source text)"
                onClick={() => redoThread.mutate({ sessionId, threadId: thread.id, fetch_source_text: true })}
                disabled={redoThread.isPending}
                className="p-1 text-text-muted hover:text-green-400 rounded text-xs font-mono"
              >↺txt</button>
            )}
            {!isTerminal && (
              <button
                title="Reject thread"
                onClick={() => updateThread.mutate({ id: thread.id, sessionId, status: 'pruned' })}
                className="p-1 text-text-muted hover:text-red-400 rounded text-xs"
              ><Icon name="close" size="xs" /></button>
            )}
          </div>
        </div>
      </div>

      {expanded && (
        <div className="ml-5 pl-3 border-l border-border-primary/40 pb-1 space-y-1">
          {/* Full query text (if multiline or truncated) */}
          {queryHasMore && (
            <p className="text-base text-text-secondary py-1 leading-relaxed">{thread.query}</p>
          )}

          {/* Thread metadata */}
          <div className="flex items-center gap-3 py-0.5 text-xs text-text-secondary">
            <span>created {new Date(thread.created_at).toLocaleTimeString()}</span>
            <span>depth {thread.depth}/{thread.max_depth}</span>
            {thread.id && <span className="font-mono">{thread.id}</span>}
          </div>

          {/* Perturbation info */}
          {thread.origin === 'perturbation' && thread.perturbation_strategy && (
            <div className="py-1 px-2 bg-orange-900/10 border border-orange-800/30 rounded text-xs space-y-0.5">
              <div className="flex items-center gap-1.5">
                <span className="text-orange-400 font-medium">perturbation</span>
                <span className="text-orange-300/70 font-mono">{thread.perturbation_strategy}</span>
              </div>
              {parentThread && (
                <div>
                  <span className="text-text-muted/60">original: </span>
                  <span className="text-text-muted/80 italic">{parentThread.query}</span>
                </div>
              )}
            </div>
          )}

          {steps.length === 0 && errors.length === 0 && threadFindings.length === 0 && (
            <p className="text-sm text-text-muted py-1 italic">waiting to run…</p>
          )}

          {/* Timeline: steps with tool calls as events */}
          {timelineSteps.map((step, si) => (
            <div key={step.id} className="py-0.5 space-y-1">
              {/* LLM invocation header */}
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <span className="text-blue-400/80 font-mono shrink-0">llm</span>
                <span className="font-mono">{step.model}</span>
                <span className="text-text-muted/70">
                  {step.prompt_tokens + step.completion_tokens} tok
                </span>
                {step.cost_usd > 0 && <span className="text-text-muted/70">${step.cost_usd.toFixed(4)}</span>}
                {step.duration_ms && <span className="text-text-muted/70">{(step.duration_ms / 1000).toFixed(1)}s</span>}
                <span className="text-text-muted/40 ml-auto">{new Date(step.created_at).toLocaleTimeString()}</span>
              </div>
              {step.error && (
                <div className="flex items-start gap-1.5 pl-4">
                  <span className="text-red-400 text-xs shrink-0">error:</span>
                  <span className="text-xs text-red-300 break-words">{step.error}</span>
                </div>
              )}
              {/* Tool calls as event rows */}
              {step.tool_calls.map((tc, ti) => (
                <div key={`${si}-${ti}`} className="pl-4 space-y-0.5">
                  {/* Tool call header */}
                  <div className="flex items-start gap-2">
                    <span className="text-text-secondary/80 text-xs font-mono shrink-0">{tc.tool}</span>
                    {tc.input && (
                      <span className="text-sm text-text-primary break-words flex-1">
                        {tc.tool === 'web_search' && tc.input.query
                          ? <span className="text-text-primary">"{tc.input.query as string}"</span>
                          : <span className="text-text-secondary/70 text-xs">{JSON.stringify(tc.input).slice(0, 120)}</span>}
                      </span>
                    )}
                    {tc.error && (
                      <span className="flex items-center gap-0.5 text-xs text-red-400 shrink-0" title={tc.error}><Icon name="close" size="xs" /> error</span>
                    )}
                  </div>
                  {/* Fetched pages as event rows (replacing badges) */}
                  {tc.jina_fetches && tc.jina_fetches.length > 0 && (
                    <div className="pl-4 space-y-0.5">
                      {tc.jina_fetches.map((jf, ji) => {
                        let hostname = jf.url;
                        try { hostname = new URL(jf.url).hostname; } catch { /* keep url */ }
                        return (
                          <div key={ji} className="flex items-center gap-2">
                            <span className={clsx('text-xs shrink-0', jf.ok ? 'text-green-400' : 'text-red-400')}>
                              {jf.ok ? <Icon name="check" size="xs" /> : <Icon name="close" size="xs" />}
                            </span>
                            <a
                              href={jf.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs text-accent hover:underline truncate max-w-[300px]"
                            >{hostname}</a>
                            {jf.ok
                              ? <span className="text-xs text-text-muted/60 shrink-0">{(jf.content_length / 1000).toFixed(1)}k</span>
                              : <span className="text-xs text-red-400/70 shrink-0" title={jf.error ?? 'fetch failed'}>{jf.error ?? 'failed'}</span>
                            }
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {tc.error && (
                    <div className="pl-4 text-xs text-red-400/80 break-words">{tc.error}</div>
                  )}
                </div>
              ))}
            </div>
          ))}

          {/* Findings */}
          {threadFindings.map(f => (
            <div key={f.id} className="flex items-start gap-2 py-1 bg-green-900/10 rounded px-2 mt-1 group/finding">
              <Icon name="check" size="sm" className="text-green-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-base text-text-primary">{f.summary}</p>
                <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                  <span className="text-xs text-text-muted" title="Confidence score">conf {(f.confidence * 100).toFixed(0)}%</span>
                  <span className="text-xs text-text-muted" title="Novelty score">novel {(f.novelty * 100).toFixed(0)}%</span>
                  <span className="text-xs text-text-muted" title="Actionability score">act {(f.actionability * 100).toFixed(0)}%</span>
                  {f.source_urls.length > 0 && <span className="text-xs text-text-muted">{f.source_urls.length} src</span>}
                  {f.source_texts.filter(t => t.length > 0).length > 0
                    ? <span className="text-xs text-green-400/70">{f.source_texts.filter(t => t.length > 0).length} full-text</span>
                    : f.source_urls.length > 0 && (
                      <button
                        title="Fetch full-text for this finding's sources"
                        onClick={() => fetchFindingText.mutate({ sessionId, findingId: f.id })}
                        disabled={fetchFindingText.isPending}
                        className="text-xs text-text-muted/50 hover:text-green-400 font-mono opacity-0 group-hover/finding:opacity-100 transition-opacity"
                      >↓txt</button>
                    )
                  }
                  {f.confidence < 0.4 && <span className="text-xs text-red-400">low confidence</span>}
                </div>
              </div>
            </div>
          ))}

          {/* Follow-up analysis */}
          {hasAnalysis && (
            <div className="mt-1.5 pt-1 border-t border-border-primary/30">
              <div className="flex items-center gap-2 mb-1">
                <p className="text-xs text-text-muted uppercase tracking-wide">Follow-up analysis</p>
                {(threadFindings[0]?.follow_up_analysis?.retry_count ?? 0) > 0 && (
                  <span className="text-xs text-text-muted/60">{threadFindings[0]?.follow_up_analysis?.retry_count} retries</span>
                )}
                <span className="text-xs text-text-muted/60">threshold: {((threadFindings[0]?.follow_up_analysis?.similarity_threshold ?? 0.75) * 100).toFixed(0)}%</span>
              </div>
              {followUpCandidates.map((c, i) => {
                const spawned = childQuerySet.has((c.text ?? '').toLowerCase().trim());
                return (
                  <div key={i} className={clsx('py-0.5 px-1 rounded mb-0.5', c.accepted ? '' : 'opacity-50')}>
                    <div className="flex items-start gap-1.5">
                      <span className={clsx('text-xs shrink-0 mt-0.5', c.accepted ? 'text-purple-400' : 'text-text-muted')}>
                        {c.accepted ? (spawned ? <Icon name="arrow_forward" size="xs" /> : <span>·</span>) : <Icon name="close" size="xs" />}
                      </span>
                      <div className="flex-1 min-w-0">
                        <span className={clsx('text-sm break-words', c.accepted ? (spawned ? 'text-text-secondary' : 'text-text-muted') : 'text-text-muted/50 line-through')}>{c.text}</span>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <span className="text-xs text-text-muted/70" title="Quality score">quality:{(c.quality_score*100).toFixed(0)}%</span>
                          <span className="text-xs text-text-muted/70" title="Rank score (aggregate)">rank:{(c.rank_score*100).toFixed(0)}%</span>
                          <span className="text-xs text-text-muted/70" title="Distance from parent">dist:{(c.distance_from_parent*100).toFixed(0)}%</span>
                          {c.dedup_similarity > 0 && (
                            <span className={clsx('text-xs', c.dedup_similarity > (threadFindings[0]?.follow_up_analysis?.similarity_threshold ?? 0.75) ? 'text-red-400' : 'text-text-muted/70')}
                              title="Max similarity vs previously-accepted candidates (deduplication score)">
                              dedup:{(c.dedup_similarity*100).toFixed(0)}%
                            </span>
                          )}
                          {c.embedding_similarity !== null && c.embedding_similarity !== undefined && (
                            <span className="text-xs text-text-muted/70" title="Embedding (cosine) similarity">emb:{(c.embedding_similarity*100).toFixed(0)}%</span>
                          )}
                          {c.llm_similarity !== null && c.llm_similarity !== undefined && (
                            <span className="text-xs text-text-muted/70" title="LLM similarity score">llm:{(c.llm_similarity*100).toFixed(0)}%</span>
                          )}
                          {c.similarity_method !== 'jaccard' && (
                            <span className="text-xs text-accent/70 font-mono">[{c.similarity_method}]</span>
                          )}
                          {c.accepted && spawned && <span className="text-xs text-purple-400">spawned</span>}
                          {!c.accepted && c.rejection_reason && (
                            <span className="text-xs text-red-400/70 italic truncate max-w-[120px]" title={c.rejection_reason}>{c.rejection_reason}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Fallback: old follow_ups display when no analysis data */}
          {!hasAnalysis && threadFindings.some(f => (f.follow_ups ?? []).length > 0) && (
            <div className="mt-1.5 pt-1 border-t border-border-primary/30">
              <p className="text-xs text-text-muted uppercase tracking-wide mb-0.5">Follow-ups</p>
              {Array.from(new Set(threadFindings.flatMap(f => f.follow_ups ?? []))).map((q, i) => {
                const spawned = childQuerySet.has(q.toLowerCase().trim());
                return (
                  <div key={i} className="flex items-start gap-1.5 py-0.5">
                    <span className="text-xs text-text-muted shrink-0 mt-0.5">{spawned ? '→' : '·'}</span>
                    <span className={clsx('text-sm break-words', spawned ? 'text-text-secondary' : 'text-text-muted')}>{q}</span>
                    {spawned && <span className="text-xs text-purple-400 shrink-0 mt-0.5">spawned</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Palette for color-coding threads in the event stream
const THREAD_PALETTE = ['#c792ea', '#82aaff', '#c3e88d', '#89ddff', '#ffcb6b', '#f78c6c', '#f07178', '#b2ccd6'];

function formatEventDetail(ev: StreamEvent): { typeLabel: string; typeColor: string; detail: string } | null {
  if (ev.type === 'finding') {
    return {
      typeLabel: 'finding',
      typeColor: 'text-success',
      detail: ev.payload.content.slice(0, 120) + (ev.payload.content.length > 120 ? '…' : ''),
    };
  }
  if (ev.type === 'thread') {
    const t = ev.payload;
    if (t.status === 'active') return { typeLabel: 'spawn', typeColor: 'text-warning', detail: `"${t.query.split('\n')[0].slice(0, 80)}"` };
    if (t.status === 'queued') return { typeLabel: 'queued', typeColor: 'text-warning/70', detail: `"${t.query.split('\n')[0].slice(0, 80)}"` };
    if (t.status === 'pruned') return { typeLabel: 'pruned', typeColor: 'text-error', detail: `thread terminated` };
    if (t.status === 'exhausted') return { typeLabel: 'done', typeColor: 'text-text-muted', detail: `thread complete` };
    return null;
  }
  if (ev.type === 'step') {
    const s = ev.payload;
    const tools = s.tool_calls ?? [];
    if (tools.length === 0) return { typeLabel: 'step', typeColor: 'text-accent/70', detail: s.label ?? '…' };
    const first = tools[0];
    const tool = first.tool ?? 'step';
    const shortTool = tool.replace('search_web', 'search').replace('fetch_url', 'fetch');
    let detail = '';
    if (tool === 'search_web' || tool === 'search') {
      const q = (first.input as Record<string, unknown>)?.query as string ?? '';
      detail = q ? `query="${q.slice(0, 80)}"` : '';
    } else if (tool === 'fetch_url' || tool === 'fetch') {
      const urls = s.tool_calls.flatMap(c => c.jina_fetches ?? []).map(j => {
        try { return new URL(j.url).hostname; } catch { return j.url; }
      });
      const count = s.tool_calls.flatMap(c => c.jina_fetches ?? []).length;
      detail = urls.slice(0, 2).join(' · ') + (count > 2 ? ` +${count - 2}` : '');
    } else {
      detail = s.label ?? shortTool;
    }
    const typeColor = shortTool === 'search' ? 'text-blue-400' : shortTool === 'fetch' ? 'text-teal-400' : 'text-accent/80';
    return { typeLabel: shortTool + (tools.length > 1 ? ` ×${tools.length}` : ''), typeColor, detail };
  }
  return null;
}

function ThreadLiveView({
  threads, findings, allSteps, events, isRunning, sessionId, sessionFetchText, onToggleSessionFetch,
}: {
  threads: ResearchThread[];
  findings: ResearchFinding[];
  allSteps: ResearchStep[];
  events: StreamEvent[];
  isRunning: boolean;
  sessionId: string;
  sessionFetchText: boolean;
  onToggleSessionFetch: () => void;
}) {
  const updateThread = useUpdateThread();
  const redoThread = useRedoThread();
  const streamRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filterFindings, setFilterFindings] = useState(false);

  const stepsByThread = useMemo(() => {
    const map = new Map<string, ResearchStep[]>();
    const seen = new Set<string>();
    for (const s of allSteps) {
      const arr = map.get(s.thread_id) ?? [];
      arr.push(s);
      map.set(s.thread_id, arr);
      seen.add(s.id);
    }
    for (const e of events) {
      if (e.type !== 'step') continue;
      if (seen.has(e.payload.id)) continue;
      const arr = map.get(e.payload.thread_id) ?? [];
      arr.push(e.payload);
      map.set(e.payload.thread_id, arr);
    }
    return map;
  }, [allSteps, events]);

  const findingsByThread = useMemo(() => {
    const map = new Map<string, ResearchFinding[]>();
    for (const f of findings) {
      const arr = map.get(f.thread_id) ?? [];
      arr.push(f);
      map.set(f.thread_id, arr);
    }
    return map;
  }, [findings]);

  const ordered = useMemo(() => orderThreadsDepthFirst(threads), [threads]);

  // Assign a stable color to each thread by its position in depth-first order
  const threadColor = useMemo(() => {
    const map = new Map<string, string>();
    ordered.forEach((t, i) => map.set(t.id, THREAD_PALETTE[i % THREAD_PALETTE.length]));
    return map;
  }, [ordered]);

  // Group findings by confidence tier
  const { highFindings, medFindings } = useMemo(() => {
    const sorted = [...findings].sort((a, b) => b.confidence - a.confidence);
    return {
      highFindings: sorted.filter(f => f.confidence >= 0.7),
      medFindings: sorted.filter(f => f.confidence >= 0.4 && f.confidence < 0.7),
    };
  }, [findings]);

  const activeThreads = useMemo(() => threads.filter(t => t.status === 'active'), [threads]);
  const queuedThreads = useMemo(() => threads.filter(t => t.status === 'queued'), [threads]);

  // Events oldest-first for display
  const streamEvents = useMemo(() => {
    const evs = [...events].reverse();
    return filterFindings ? evs.filter(e => e.type === 'finding') : evs;
  }, [events, filterFindings]);

  // Auto-scroll event pane to bottom when new events arrive
  useEffect(() => {
    if (autoScroll && streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight;
    }
  }, [streamEvents, autoScroll]);

  return (
    <div
      className="flex border border-border-primary rounded-lg overflow-hidden"
      style={{ height: 'calc(100vh - 290px)', minHeight: '520px' }}
    >
      {/* ── Pane 1: Thread controls (left) ── */}
      <div className="w-52 shrink-0 flex flex-col border-r border-border-primary bg-bg-secondary overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border-primary shrink-0">
          <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">Threads</span>
          {isRunning && <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse ml-auto shrink-0" />}
          <span className="text-xs text-text-disabled font-mono ml-auto">{threads.length}</span>
        </div>

        {/* Thread list */}
        <div className="flex-1 overflow-y-auto">
          {ordered.map(thread => {
            const isTerminal = thread.status === 'exhausted' || thread.status === 'pruned';
            const threadFindings = findingsByThread.get(thread.id) ?? [];
            const steps = stepsByThread.get(thread.id) ?? [];
            const color = threadColor.get(thread.id) ?? '#8796b0';
            const progressPct = steps.length > 0 ? Math.min(100, (steps.length / 9) * 100) : 0;
            return (
              <div
                key={thread.id}
                className="px-3 py-2 border-b border-border-primary group hover:bg-bg-tertiary transition-colors"
                style={{ borderLeft: `2px solid ${color}30` }}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', liveStatusDot[thread.status] ?? 'bg-text-muted/40')} />
                  <span className="text-xs font-medium text-text-primary truncate flex-1 leading-tight">
                    {(thread.short_query ?? thread.query.split('\n')[0]).slice(0, 36)}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className={clsx('text-xs px-1 py-0.5 rounded shrink-0', liveOriginColor[thread.origin] ?? 'bg-bg-tertiary text-text-muted')}>
                    {thread.origin.replace(/_/g, ' ')}
                  </span>
                  <span className="text-xs font-mono text-text-disabled">p:{thread.priority.toFixed(2)}</span>
                  {threadFindings.length > 0 && (
                    <span className="text-xs font-mono text-success ml-auto">{threadFindings.length}✦</span>
                  )}
                </div>
                {thread.status === 'active' && (
                  <div className="h-0.5 bg-bg-tertiary rounded-full overflow-hidden mb-1.5">
                    <div
                      className="h-full bg-success rounded-full transition-all"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                )}
                {/* Controls — show on hover */}
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    title="Increase priority"
                    onClick={() => updateThread.mutate({ id: thread.id, sessionId, priority: Math.min(1.0, thread.priority + 0.1) })}
                    className="p-0.5 text-text-disabled hover:text-text-secondary rounded"
                  ><Icon name="keyboard_arrow_up" size="xs" /></button>
                  <button
                    title="Decrease priority"
                    onClick={() => updateThread.mutate({ id: thread.id, sessionId, priority: Math.max(0.0, thread.priority - 0.1) })}
                    className="p-0.5 text-text-disabled hover:text-text-secondary rounded"
                  ><Icon name="keyboard_arrow_down" size="xs" /></button>
                  {isTerminal ? (
                    <button
                      title="Redo"
                      onClick={() => redoThread.mutate({ sessionId, threadId: thread.id })}
                      disabled={redoThread.isPending}
                      className="px-1 py-0.5 text-xs text-text-disabled hover:text-blue-400 rounded"
                    >↺</button>
                  ) : (
                    <button
                      title="Prune"
                      onClick={() => updateThread.mutate({ id: thread.id, sessionId, status: 'pruned' })}
                      className="p-0.5 text-text-disabled hover:text-error rounded ml-auto"
                    ><Icon name="close" size="xs" /></button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer controls */}
        <div className="border-t border-border-primary px-3 py-2 shrink-0 space-y-1.5">
          <button
            onClick={onToggleSessionFetch}
            className={clsx('w-full text-left px-2 py-1 rounded text-xs border transition-colors',
              sessionFetchText
                ? 'bg-green-900/30 border-green-700/30 text-green-400'
                : 'bg-bg-tertiary border-border-primary text-text-muted hover:text-text-secondary'
            )}
          >⬡ full-text: {sessionFetchText ? 'ON' : 'OFF'}</button>
        </div>
      </div>

      {/* ── Pane 2: Findings (center) ── */}
      <div className="flex flex-col overflow-hidden border-r border-border-primary" style={{ width: '38%' }}>
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border-primary bg-bg-secondary shrink-0">
          <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">Findings</span>
          {findings.length > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded font-mono bg-success/10 border border-success/20 text-success">{findings.length}</span>
          )}
        </div>

        {/* Findings scroll area */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {findings.length === 0 && activeThreads.length === 0 ? (
            <p className="text-xs text-text-muted text-center py-8">No findings yet.</p>
          ) : (
            <>
              {highFindings.length > 0 && (
                <>
                  <p className="text-xs font-semibold uppercase tracking-wider text-text-disabled">High confidence · {highFindings.length}</p>
                  {highFindings.map(f => (
                    <div key={f.id} className="bg-bg-secondary border border-border-primary rounded border-l-2 border-l-success px-3 py-2 space-y-1.5">
                      <p className="text-xs text-text-primary leading-relaxed">{f.content.slice(0, 200)}{f.content.length > 200 ? '…' : ''}</p>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {f.source_urls[0] && (
                          <span className="text-xs font-mono text-blue-400 bg-blue-400/8 border border-blue-400/15 px-1 py-0.5 rounded truncate max-w-28">
                            {(() => { try { return new URL(f.source_urls[0]).hostname; } catch { return f.source_urls[0]; } })()}
                          </span>
                        )}
                        <span className="text-xs font-mono text-text-disabled bg-bg-tertiary border border-border-primary px-1 py-0.5 rounded">
                          {threads.find(t => t.id === f.thread_id)?.origin?.replace(/_/g, ' ') ?? '—'}
                        </span>
                        <span className="text-xs font-mono text-text-muted ml-auto">{(f.confidence * 100).toFixed(0)}%</span>
                      </div>
                    </div>
                  ))}
                </>
              )}

              {medFindings.length > 0 && (
                <>
                  <p className="text-xs font-semibold uppercase tracking-wider text-text-disabled mt-3">Medium confidence · {medFindings.length}</p>
                  {medFindings.map(f => (
                    <div key={f.id} className="bg-bg-secondary border border-border-primary rounded border-l-2 border-l-blue-400/50 px-3 py-2 space-y-1.5">
                      <p className="text-xs text-text-primary leading-relaxed">{f.content.slice(0, 180)}{f.content.length > 180 ? '…' : ''}</p>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {f.source_urls[0] && (
                          <span className="text-xs font-mono text-blue-400 bg-blue-400/8 border border-blue-400/15 px-1 py-0.5 rounded truncate max-w-28">
                            {(() => { try { return new URL(f.source_urls[0]).hostname; } catch { return f.source_urls[0]; } })()}
                          </span>
                        )}
                        <span className="text-xs font-mono text-text-muted ml-auto">{(f.confidence * 100).toFixed(0)}%</span>
                      </div>
                    </div>
                  ))}
                </>
              )}

              {(activeThreads.length > 0 || queuedThreads.length > 0) && (
                <div className="mt-3 border border-dashed border-border-primary rounded px-3 py-2 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    {activeThreads.length > 0 && <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />}
                    <span className="text-xs font-semibold uppercase tracking-wider text-text-disabled">Investigating</span>
                  </div>
                  {activeThreads.map(t => (
                    <div key={t.id} className="flex items-center gap-1.5 text-xs text-text-secondary">
                      <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse shrink-0" />
                      {(t.short_query ?? t.query.split('\n')[0]).slice(0, 60)}
                    </div>
                  ))}
                  {queuedThreads.map(t => (
                    <div key={t.id} className="flex items-center gap-1.5 text-xs text-text-muted">
                      <span className="w-1.5 h-1.5 rounded-full bg-warning/60 shrink-0" />
                      {(t.short_query ?? t.query.split('\n')[0]).slice(0, 60)}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Pane 3: Live event stream (right) ── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0 bg-bg-primary">
        {/* Thread color chips */}
        <div className="flex items-center gap-0 border-b border-border-primary bg-bg-secondary overflow-x-auto shrink-0">
          {ordered.filter(t => t.status !== 'pruned' || findingsByThread.get(t.id)?.length).slice(0, 8).map(t => {
            const color = threadColor.get(t.id) ?? '#8796b0';
            const label = (t.short_query ?? t.query.split('\n')[0]).slice(0, 14);
            return (
              <div
                key={t.id}
                className="flex items-center gap-1.5 px-2.5 py-1.5 border-r border-border-primary shrink-0"
                style={{ background: `${color}08` }}
              >
                <div
                  className="w-4 h-4 rounded flex items-center justify-center text-xs font-bold font-mono shrink-0"
                  style={{ background: `${color}20`, color, border: `1px solid ${color}35` }}
                >
                  {ordered.indexOf(t) < 26 ? String.fromCharCode(65 + ordered.indexOf(t)) : '#'}
                </div>
                <div>
                  <div className="text-xs leading-tight truncate max-w-20" style={{ color }}>{label}</div>
                  <div className="text-xs text-text-disabled font-mono">{t.status === 'active' ? 'active' : t.status === 'queued' ? 'queued' : t.status}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border-primary bg-bg-secondary shrink-0">
          <span className="text-xs uppercase tracking-wider text-text-disabled font-semibold mr-1">Show</span>
          <button
            onClick={() => setFilterFindings(f => !f)}
            className={clsx('px-1.5 py-0.5 rounded text-xs border font-mono transition-colors',
              filterFindings
                ? 'border-warning/30 bg-warning/10 text-warning'
                : 'border-border-primary bg-bg-tertiary text-text-muted hover:text-text-secondary'
            )}
          >★ findings</button>
          <button
            onClick={() => setFilterFindings(false)}
            className="px-1.5 py-0.5 rounded text-xs border border-border-primary bg-bg-tertiary text-text-muted hover:text-text-secondary font-mono"
          >all</button>
          <div className="flex-1" />
          <button
            onClick={() => setAutoScroll(a => !a)}
            className={clsx('px-1.5 py-0.5 rounded text-xs border transition-colors',
              autoScroll
                ? 'border-success/25 bg-success/8 text-success'
                : 'border-border-primary bg-bg-tertiary text-text-muted'
            )}
          >↓ auto-scroll</button>
        </div>

        {/* Event stream */}
        <div
          ref={streamRef}
          className="flex-1 overflow-y-auto py-1"
          onScroll={e => {
            const el = e.currentTarget;
            const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
            setAutoScroll(atBottom);
          }}
        >
          {streamEvents.length === 0 && (
            <p className="text-xs text-text-muted text-center py-8">Waiting for events…</p>
          )}
          {streamEvents.map((ev, i) => {
            const formatted = formatEventDetail(ev);
            if (!formatted) return null;
            const threadId = ev.type === 'finding' ? ev.payload.thread_id
              : ev.type === 'step' ? ev.payload.thread_id
              : ev.type === 'thread' ? ev.payload.id
              : null;
            const color = threadId ? (threadColor.get(threadId) ?? '#8796b0') : '#8796b0';
            const threadIdx = threadId ? ordered.findIndex(t => t.id === threadId) : -1;
            const threadLetter = threadIdx >= 0 && threadIdx < 26 ? String.fromCharCode(65 + threadIdx) : '?';
            const ts = ev.type === 'finding' ? ev.payload.created_at
              : ev.type === 'step' ? ev.payload.created_at
              : ev.type === 'thread' ? ev.payload.created_at
              : null;
            const timeStr = ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
            const isFinding = ev.type === 'finding';
            const isHighFinding = isFinding && (ev.payload as ResearchFinding).confidence >= 0.7;
            return (
              <div
                key={i}
                className={clsx(
                  'grid items-baseline px-3 py-0.5 border-l-2 transition-colors hover:bg-bg-secondary/50',
                  isFinding
                    ? isHighFinding
                      ? 'bg-warning/5 border-l-warning/40'
                      : 'bg-success/4 border-l-success/25'
                    : 'border-l-transparent'
                )}
                style={{ gridTemplateColumns: '52px 22px 80px 1fr', gap: '0' }}
              >
                <span className="text-xs text-text-disabled font-mono pr-2 truncate">{timeStr}</span>
                <span className="pr-1 flex items-center">
                  <div
                    className="w-4 h-4 rounded flex items-center justify-center text-xs font-bold font-mono"
                    style={{ background: `${color}20`, color, border: `1px solid ${color}30` }}
                  >{threadLetter}</div>
                </span>
                <span className={clsx('text-xs font-mono pr-2 truncate', formatted.typeColor)}>{formatted.typeLabel}</span>
                <span className="text-xs text-text-muted truncate">
                  {isHighFinding && <span className="text-warning mr-1">★</span>}
                  {formatted.detail}
                </span>
              </div>
            );
          })}
          {isRunning && (
            <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-success font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
              <span>running</span>
              <span className="text-text-disabled ml-2">{events.length} events · {findings.length} findings</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Graph Tab ---

const NODE_WIDTH = 150;
const NODE_HEIGHT = 48;

function layoutGraph(threads: ResearchThread[]) {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', nodesep: 12, ranksep: 28 });

  for (const t of threads) {
    g.setNode(t.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const t of threads) {
    if (t.parent_thread_id) g.setEdge(t.parent_thread_id, t.id);
  }
  dagre.layout(g);

  return threads.map(t => {
    const pos = g.node(t.id);
    return { id: t.id, position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 }, data: t, type: 'thread' };
  });
}

const statusColors: Record<string, string> = {
  active: 'border-green-500 bg-green-900/20',
  queued: 'border-yellow-500/50 bg-yellow-900/10',
  exhausted: 'border-border-primary bg-bg-tertiary/30',
  deferred: 'border-blue-500/50 bg-blue-900/10',
  pruned: 'border-red-500/50 bg-red-900/10',
};

const statusDot: Record<string, string> = {
  active: 'bg-green-400 animate-pulse',
  queued: 'bg-yellow-400',
  exhausted: 'bg-text-muted',
  deferred: 'bg-blue-400',
  pruned: 'bg-red-400',
};

function ThreadNode({ data }: { data: ResearchThread & { findingCount: number } }) {
  return (
    <div className={clsx('rounded border px-2 py-1.5 w-[150px] cursor-pointer', statusColors[data.status] ?? 'border-border-primary bg-bg-secondary')}>
      <Handle type="target" position={Position.Top} className="!bg-border-primary" />
      <div className="flex items-center gap-1.5">
        <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', statusDot[data.status] ?? 'bg-text-muted')} />
        <span className="text-xs text-text-muted uppercase tracking-wide">{data.origin.replace('_', ' ')}</span>
        {data.findingCount > 0 && (
          <span className="ml-auto text-xs bg-bg-tertiary text-text-muted px-1 rounded">{data.findingCount}</span>
        )}
      </div>
      <p className="text-xs leading-tight line-clamp-2 text-text-primary">{data.query}</p>
      <Handle type="source" position={Position.Bottom} className="!bg-border-primary" />
    </div>
  );
}

const nodeTypes = { thread: ThreadNode };

function ThreadGraph({ threads, findings }: { threads: ResearchThread[]; findings: ResearchFinding[] }) {
  const findingCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const f of findings) map.set(f.thread_id, (map.get(f.thread_id) ?? 0) + 1);
    return map;
  }, [findings]);

  const nodes: Node[] = useMemo(() => {
    if (threads.length === 0) return [];
    const laid = layoutGraph(threads);
    return laid.map(n => ({ ...n, data: { ...n.data, findingCount: findingCounts.get(n.id) ?? 0 } }));
  }, [threads, findingCounts]);

  const edges: Edge[] = useMemo(() =>
    threads
      .filter(t => t.parent_thread_id)
      .map(t => ({
        id: `${t.parent_thread_id}-${t.id}`,
        source: t.parent_thread_id!,
        target: t.id,
        style: { stroke: '#374151', strokeWidth: 1 },
      })),
    [threads]
  );

  if (threads.length === 0) {
    return <p className="text-sm text-text-muted text-center py-12">No threads yet.</p>;
  }

  return (
    <div style={{ height: '650px' }} className="rounded-lg border border-border-primary overflow-hidden">
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView>
        <Background variant={BackgroundVariant.Dots} color="#374151" gap={16} />
        <Controls className="[&>button]:bg-bg-secondary [&>button]:border-border-primary [&>button]:text-text-secondary" />
        <MiniMap nodeColor={(n) => {
          const s = (n.data as unknown as ResearchThread).status;
          if (s === 'active') return '#22c55e';
          if (s === 'queued') return '#eab308';
          if (s === 'exhausted') return '#6b7280';
          if (s === 'pruned') return '#ef4444';
          return '#374151';
        }} className="!bg-bg-secondary !border-border-primary" />
      </ReactFlow>
    </div>
  );
}

// --- Workers Tab ---

function WorkersTab({ sessionId }: { sessionId: string }) {
  const { data: jobs = [] } = useResearchJobs(sessionId);
  const cancelJob = useCancelJob();
  const runResearch = useRunResearch();
  const [expandedWorkers, setExpandedWorkers] = useState<Set<string>>(new Set());
  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(new Set());

  // Derive workers from jobs
  const workers = useMemo(() => {
    const map = new Map<string, { id: string; jobs: ResearchJob[] }>();
    for (const job of jobs) {
      if (!job.claimed_by) continue;
      const entry = map.get(job.claimed_by) ?? { id: job.claimed_by, jobs: [] };
      entry.jobs.push(job);
      map.set(job.claimed_by, entry);
    }
    return Array.from(map.values());
  }, [jobs]);

  const counts = useMemo(() => ({
    running: jobs.filter(j => j.status === 'running' || j.status === 'claimed').length,
    pending: jobs.filter(j => j.status === 'pending').length,
    completed: jobs.filter(j => j.status === 'completed').length,
    failed: jobs.filter(j => j.status === 'failed').length,
    total_cost: 0, // computed from steps, not available here
  }), [jobs]);

  function jobDuration(job: ResearchJob): string {
    if (!job.started_at || !job.completed_at) {
      if (!job.started_at) return '—';
      const ms = Date.now() - new Date(job.started_at).getTime();
      if (ms < 0) return '—';
      if (ms < 60000) return `${Math.round(ms / 1000)}s`;
      return `${Math.round(ms / 60000)}m`;
    }
    const ms = new Date(job.completed_at).getTime() - new Date(job.started_at).getTime();
    if (ms < 0) return '—';
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    return `${Math.round(ms / 60000)}m`;
  }

  function workerLifetime(worker: { jobs: ResearchJob[] }): string {
    const claimedTimes = worker.jobs
      .filter(j => j.claimed_at)
      .map(j => new Date(j.claimed_at!).getTime());
    if (claimedTimes.length === 0) return '—';
    const firstSeen = Math.min(...claimedTimes);
    const lastJob = worker.jobs.find(j => j.status === 'running' || j.status === 'claimed');
    const end = lastJob ? Date.now() : Math.max(...worker.jobs
      .filter(j => j.completed_at)
      .map(j => new Date(j.completed_at!).getTime()));
    if (!end || end < firstSeen) return '—';
    const ms = end - firstSeen;
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    return `${Math.round(ms / 60000)}m`;
  }

  const jobStatusStyle: Record<string, string> = {
    running: 'bg-success/15 text-success',
    claimed: 'bg-success/10 text-success',
    pending: 'bg-warning/15 text-warning',
    completed: 'bg-bg-tertiary text-text-muted',
    failed: 'bg-error/15 text-error',
    cancelled: 'bg-bg-tertiary text-text-muted',
  };

  const activeJobs = jobs.filter(j => j.status === 'running' || j.status === 'claimed');
  const pendingJobs = jobs.filter(j => j.status === 'pending');
  const pastJobs = jobs.filter(j => j.status === 'completed' || j.status === 'failed' || j.status === 'cancelled');

  return (
    <div className="space-y-6">
      {/* Section 1: Overall stats */}
      <div>
        <p className="text-xs text-text-muted uppercase tracking-wide mb-2">Overall</p>
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Running', value: counts.running, accent: counts.running > 0 ? 'text-green-400' : 'text-text-primary' },
            { label: 'Pending', value: counts.pending, accent: 'text-text-primary' },
            { label: 'Completed', value: counts.completed, accent: 'text-text-primary' },
            { label: 'Failed', value: counts.failed, accent: counts.failed > 0 ? 'text-red-400' : 'text-text-primary' },
          ].map(s => (
            <div key={s.label} className="bg-bg-secondary border border-border-primary rounded-lg p-3">
              <p className="text-xs text-text-muted">{s.label}</p>
              <p className={clsx('text-lg font-semibold', s.accent)}>{s.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Section 2: Workers */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-text-muted uppercase tracking-wide">Workers ({workers.length})</p>
          <button
            onClick={() => runResearch.mutate({ sessionId, mode: 'background' })}
            className="text-xs text-accent hover:underline"
            disabled={runResearch.isPending}
          >+ Spawn worker</button>
        </div>
        {workers.length === 0 ? (
          <p className="text-xs text-text-muted py-4 text-center">No workers active. Start a job to spawn one.</p>
        ) : (
          <div className="bg-bg-secondary border border-border-primary rounded-lg overflow-hidden">
            {workers.map(worker => {
              const isExpanded = expandedWorkers.has(worker.id);
              const activeWorkerJob = worker.jobs.find(j => j.status === 'running' || j.status === 'claimed');
              return (
                <div key={worker.id} className="border-b border-border-primary/50 last:border-0">
                  <button
                    onClick={() => setExpandedWorkers(prev => {
                      const next = new Set(prev);
                      next.has(worker.id) ? next.delete(worker.id) : next.add(worker.id);
                      return next;
                    })}
                    className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-bg-tertiary/30 transition-colors text-left"
                  >
                    <span className={clsx('w-2 h-2 rounded-full shrink-0', activeWorkerJob ? 'bg-success animate-pulse' : 'bg-text-muted/40')} />
                    <span className="text-xs font-mono text-text-secondary flex-1 truncate">{worker.id}</span>
                    <span className="text-xs text-text-muted shrink-0">{worker.jobs.length} job{worker.jobs.length !== 1 ? 's' : ''}</span>
                    <span className="text-xs text-text-muted shrink-0">{workerLifetime(worker)}</span>
                    {activeWorkerJob && (
                      <button
                        onClick={e => { e.stopPropagation(); cancelJob.mutate({ jobId: activeWorkerJob.id }); }}
                        className="text-xs text-red-400 hover:text-red-300 shrink-0 px-1"
                        title="Kill worker (cancel current job)"
                      >kill</button>
                    )}
                    <Icon name="expand_more" size="xs" className={clsx('w-3 h-3 text-text-muted shrink-0 transition-transform', isExpanded && 'rotate-180')} />
                  </button>
                  {isExpanded && (
                    <div className="px-3 pb-2 pl-8 space-y-1">
                      {worker.jobs.map(job => (
                        <div key={job.id} className="text-xs flex items-center gap-2">
                          <span className={clsx('px-1.5 py-0.5 rounded font-medium', jobStatusStyle[job.status] ?? 'bg-bg-tertiary text-text-muted')}>
                            {job.status}
                          </span>
                          <span className="font-mono text-text-muted">{job.id}</span>
                          <span className="text-text-muted/60">{job.mode}</span>
                          <span className="text-text-muted/60">{job.iterations_completed}{job.max_iterations ? `/${job.max_iterations}` : ''} iter</span>
                          <span className="text-text-muted/60 ml-auto">{jobDuration(job)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Section 3: Jobs */}
      <div>
        <p className="text-xs text-text-muted uppercase tracking-wide mb-2">Jobs ({jobs.length})</p>
        {jobs.length === 0 ? (
          <p className="text-xs text-text-muted py-4 text-center">No jobs yet. Hit Run to start.</p>
        ) : (
          <div className="space-y-1">
            {/* Active jobs */}
            {activeJobs.length > 0 && activeJobs.map(job => (
              <div key={job.id} className="bg-success/5 border border-success/20 rounded-lg overflow-hidden">
                <button
                  onClick={() => setExpandedJobs(prev => {
                    const next = new Set(prev);
                    next.has(job.id) ? next.delete(job.id) : next.add(job.id);
                    return next;
                  })}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-success/10 transition-colors"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse shrink-0" />
                  <span className="font-mono text-xs text-text-secondary flex-1 truncate">{job.id}</span>
                  <span className={clsx('px-1.5 py-0.5 rounded text-xs font-medium', jobStatusStyle[job.status] ?? '')}>{job.status}</span>
                  <span className="text-xs text-text-muted">{job.mode}</span>
                  <span className="text-xs text-text-muted font-mono">{job.iterations_completed}{job.max_iterations ? `/${job.max_iterations}` : ''}</span>
                  <span className="text-xs text-text-muted">{jobDuration(job)}</span>
                  <button onClick={e => { e.stopPropagation(); cancelJob.mutate({ jobId: job.id }); }} className="text-xs text-red-400 hover:text-red-300 shrink-0">cancel</button>
                  <Icon name="expand_more" size="xs" className={clsx('w-3 h-3 text-text-muted shrink-0 transition-transform', expandedJobs.has(job.id) && 'rotate-180')} />
                </button>
                {expandedJobs.has(job.id) && (
                  <div className="px-3 pb-2 pl-6 text-xs space-y-0.5 text-text-muted border-t border-success/20">
                    <div className="pt-1.5 grid grid-cols-2 gap-x-4">
                      <span>id: <span className="font-mono text-text-secondary">{job.id}</span></span>
                      <span>worker: <span className="font-mono text-text-secondary">{job.claimed_by ?? '—'}</span></span>
                      {job.started_at && <span>started: {new Date(job.started_at).toLocaleTimeString()}</span>}
                      {job.heartbeat_at && <span>heartbeat: {timeAgo(job.heartbeat_at)}</span>}
                    </div>
                    {job.error && <p className="text-red-400 mt-1">{job.error}</p>}
                  </div>
                )}
              </div>
            ))}

            {/* Pending/queued jobs */}
            {pendingJobs.length > 0 && pendingJobs.map(job => (
              <div key={job.id} className="bg-warning/5 border border-warning/20 rounded-lg overflow-hidden">
                <button
                  onClick={() => setExpandedJobs(prev => {
                    const next = new Set(prev);
                    next.has(job.id) ? next.delete(job.id) : next.add(job.id);
                    return next;
                  })}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-warning/10 transition-colors"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-yellow-400/70 shrink-0" />
                  <span className="font-mono text-xs text-text-secondary flex-1 truncate">{job.id}</span>
                  <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-warning/15 text-warning">queued</span>
                  <span className="text-xs text-text-muted">{job.mode}</span>
                  <span className="text-xs text-text-muted">{timeAgo(job.created_at)}</span>
                  <button onClick={e => { e.stopPropagation(); cancelJob.mutate({ jobId: job.id }); }} className="text-xs text-red-400 hover:text-red-300 shrink-0">cancel</button>
                  <Icon name="expand_more" size="xs" className={clsx('w-3 h-3 text-text-muted shrink-0 transition-transform', expandedJobs.has(job.id) && 'rotate-180')} />
                </button>
                {expandedJobs.has(job.id) && (
                  <div className="px-3 pb-2 pl-6 text-xs text-text-muted border-t border-warning/20 pt-1.5">
                    <span>id: <span className="font-mono text-text-secondary">{job.id}</span></span>
                  </div>
                )}
              </div>
            ))}

            {/* Past jobs */}
            {pastJobs.length > 0 && (
              <div className="bg-bg-secondary border border-border-primary rounded-lg overflow-hidden">
                {[...pastJobs].reverse().map((job, i) => (
                  <div key={job.id} className="border-b border-border-primary/40 last:border-0">
                    <button
                      onClick={() => setExpandedJobs(prev => {
                        const next = new Set(prev);
                        next.has(job.id) ? next.delete(job.id) : next.add(job.id);
                        return next;
                      })}
                      className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-bg-tertiary/30 transition-colors"
                    >
                      <span className="text-text-muted text-xs font-mono shrink-0">{pastJobs.length - i}</span>
                      <span className="font-mono text-xs text-text-muted flex-1 truncate">{job.id}</span>
                      <span className={clsx('px-1.5 py-0.5 rounded text-xs font-medium', jobStatusStyle[job.status] ?? 'bg-bg-tertiary text-text-muted')}>{job.status}</span>
                      <span className="text-xs text-text-muted">{job.mode}</span>
                      <span className="text-xs text-text-muted font-mono">{job.iterations_completed}{job.max_iterations ? `/${job.max_iterations}` : ''}</span>
                      <span className="text-xs text-text-muted">{jobDuration(job)}</span>
                      <Icon name="expand_more" size="xs" className={clsx('w-3 h-3 text-text-muted shrink-0 transition-transform', expandedJobs.has(job.id) && 'rotate-180')} />
                    </button>
                    {expandedJobs.has(job.id) && (
                      <div className="px-3 pb-2 pl-6 text-xs text-text-muted border-t border-border-primary/40 pt-1.5 space-y-0.5">
                        <div className="grid grid-cols-2 gap-x-4">
                          <span>id: <span className="font-mono text-text-secondary">{job.id}</span></span>
                          {job.claimed_by && <span>worker: <span className="font-mono text-text-secondary">{job.claimed_by}</span></span>}
                          {job.started_at && <span>started: {new Date(job.started_at).toLocaleString()}</span>}
                          {job.completed_at && <span>ended: {new Date(job.completed_at).toLocaleString()}</span>}
                        </div>
                        {job.error && <p className="text-red-400">{job.error}</p>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Settings Tab ---

function EnvBadge({ set, label }: { set: boolean; label: string }) {
  return set
    ? <span className="inline-flex items-center gap-1 text-xs font-medium text-success"><span className="w-1.5 h-1.5 rounded-full bg-success inline-block" />{label}</span>
    : <span className="inline-flex items-center gap-1 text-xs font-medium text-error"><span className="w-1.5 h-1.5 rounded-full bg-error inline-block" />{label} not set</span>;
}

function SessionSettings({ session, sessionId }: { session: { id: string; config: Record<string, unknown> }; sessionId: string }) {
  const updateConfig = useUpdateSessionConfig();
  const { data: envCheck } = useResearchEnvCheck();
  const cfg = session.config as Record<string, unknown>;
  const providers = (cfg.providers as Record<string, unknown>) ?? {};
  const gapAnalysis = (cfg.gap_analysis as Record<string, unknown>) ?? {};

  const [provider, setProvider] = useState<string>((providers.primary as string) ?? 'anthropic');
  const [model, setModel] = useState<string>((cfg.model as string) ?? '');
  const [maxDepth, setMaxDepth] = useState<number>((cfg.max_thread_depth as number) ?? 9);
  const [minSearches, setMinSearches] = useState<number>((cfg.min_searches_per_thread as number) ?? 2);
  const [gapEnabled, setGapEnabled] = useState<boolean>((gapAnalysis.enabled as boolean) ?? true);
  const [maxGapSearches, setMaxGapSearches] = useState<number>((gapAnalysis.max_gap_searches as number) ?? 2);
  const [fetchSourceText, setFetchSourceText] = useState<boolean>((cfg.fetch_source_text as boolean) ?? false);
  const [openrouterKey, setOpenrouterKey] = useState<string>((providers.openrouter_api_key as string) ?? '');
  const [openrouterModels, setOpenrouterModels] = useState<string>(
    ((providers.openrouter_models as string[]) ?? []).join(', ')
  );
  const [localModel, setLocalModel] = useState<string>((providers.local_model as string) ?? '');
  const [localBaseUrl, setLocalBaseUrl] = useState<string>((providers.local_base_url as string) ?? 'http://localhost:11434');
  const [budgetDaily, setBudgetDaily] = useState<number>((cfg.budget_daily_usd as number) ?? 5.0);
  const [saved, setSaved] = useState(false);

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const config: Record<string, unknown> = {
      model,
      max_thread_depth: maxDepth,
      min_searches_per_thread: minSearches,
      fetch_source_text: fetchSourceText,
      budget_daily_usd: budgetDaily,
      gap_analysis: { enabled: gapEnabled, max_gap_searches: maxGapSearches },
      providers: {
        primary: provider,
        ...(provider === 'openrouter' ? {
          openrouter_api_key: openrouterKey || undefined,
          openrouter_models: openrouterModels.split(',').map(s => s.trim()).filter(Boolean),
        } : {}),
        ...(provider === 'ollama' ? {
          local_model: localModel,
          local_base_url: localBaseUrl,
        } : {}),
      },
    };
    updateConfig.mutate({ id: sessionId, config }, {
      onSuccess: () => { setSaved(true); setTimeout(() => setSaved(false), 2000); },
    });
  }

  const inputCls = 'bg-bg-primary border border-border-primary rounded px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent w-full';
  const labelCls = 'block text-xs text-text-muted mb-1';

  return (
    <form onSubmit={handleSave} className="space-y-6 max-w-lg">
      {/* Env errors (hard failures) */}
      {envCheck && envCheck.errors.length > 0 && (
        <div className="rounded border border-red-500/50 bg-red-500/10 p-3 space-y-1">
          {envCheck.errors.map((e, i) => (
            <p key={i} className="text-xs text-red-400 flex items-start gap-1.5 font-medium">
              <Icon name="close" size="xs" className="mt-0.5 shrink-0" />{e}
            </p>
          ))}
        </div>
      )}
      {/* Env warnings (degraded) */}
      {envCheck && envCheck.warnings.length > 0 && (
        <div className="rounded border border-yellow-500/30 bg-yellow-500/10 p-3 space-y-1">
          {envCheck.warnings.map((w, i) => (
            <p key={i} className="text-xs text-yellow-400 flex items-start gap-1.5">
              <span className="mt-0.5 shrink-0">⚠</span>{w}
            </p>
          ))}
        </div>
      )}
      {/* Provider */}
      <div>
        <p className="text-xs text-text-muted uppercase tracking-wide mb-3">Provider</p>
        <div className="flex gap-2 mb-4">
          {(['anthropic', 'openrouter', 'ollama'] as const).map(p => (
            <button key={p} type="button"
              onClick={() => setProvider(p)}
              className={clsx('px-3 py-1.5 rounded text-sm font-medium transition-colors',
                provider === p ? 'bg-accent text-white' : 'bg-bg-secondary border border-border-primary text-text-secondary hover:border-border-secondary')}>
              {p === 'anthropic' ? 'Anthropic' : p === 'openrouter' ? 'OpenRouter' : 'Local (Ollama)'}
            </button>
          ))}
        </div>

        {provider === 'anthropic' && (
          <div>
            <label className={labelCls}>Model</label>
            <input value={model} onChange={e => setModel(e.target.value)} placeholder="claude-sonnet-4-6" className={inputCls} />
            <div className="mt-1.5">
              {envCheck
                ? <EnvBadge set={envCheck.anthropic} label="ANTHROPIC_API_KEY" />
                : <span className="text-xs text-text-muted/60">Uses ANTHROPIC_API_KEY env var</span>}
            </div>
          </div>
        )}

        {provider === 'openrouter' && (
          <div className="space-y-3">
            <div>
              <label className={labelCls}>API Key (optional — uses OPENROUTER_API_KEY env var if blank)</label>
              <input type="password" value={openrouterKey} onChange={e => setOpenrouterKey(e.target.value)} placeholder="sk-or-…" className={inputCls} />
              {envCheck && !openrouterKey && (
                <div className="mt-1.5">
                  <EnvBadge set={envCheck.openrouter} label="OPENROUTER_API_KEY" />
                </div>
              )}
            </div>
            <div>
              <label className={labelCls}>Models (comma-separated, rotated)</label>
              <input value={openrouterModels} onChange={e => setOpenrouterModels(e.target.value)}
                placeholder="deepseek/deepseek-chat, google/gemini-2.0-flash-001" className={inputCls} />
            </div>
          </div>
        )}

        {provider === 'ollama' && (
          <div className="space-y-3">
            <div>
              <label className={labelCls}>Model</label>
              <input value={localModel} onChange={e => setLocalModel(e.target.value)} placeholder="qwen2.5:7b" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Base URL</label>
              <input value={localBaseUrl} onChange={e => setLocalBaseUrl(e.target.value)} className={inputCls} />
            </div>
          </div>
        )}
      </div>

      {/* Search */}
      <div>
        <p className="text-xs text-text-muted uppercase tracking-wide mb-3">Search</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Max depth <span className="text-text-muted font-normal">(0 = none, 1 = seed only)</span></label>
            <input type="number" min={0} max={20} value={maxDepth} onChange={e => setMaxDepth(Number(e.target.value))} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Min searches per thread</label>
            <input type="number" min={1} max={10} value={minSearches} onChange={e => setMinSearches(Number(e.target.value))} className={inputCls} />
          </div>
        </div>
      </div>

      {/* Source text */}
      <div>
        <p className="text-xs text-text-muted uppercase tracking-wide mb-3">Source Text</p>
        <label className="flex items-start gap-2 cursor-pointer">
          <input type="checkbox" checked={fetchSourceText} onChange={e => setFetchSourceText(e.target.checked)}
            className="w-4 h-4 accent-accent mt-0.5" />
          <div>
            <span className="text-sm text-text-primary">Fetch source page text</span>
            <div className="mt-1 flex flex-col gap-1">
              {envCheck ? (
                <>
                  <span className="text-xs text-text-muted">Page extractor: {' '}
                    <EnvBadge set={envCheck.jina} label={envCheck.jina ? 'Jina (active)' : 'JINA_API_KEY'} />
                    {!envCheck.jina && <span className="text-xs text-red-400 ml-1 font-medium">— will throw, no fallback</span>}
                  </span>
                  <span className="text-xs text-text-muted">Search: {' '}
                    {envCheck.searchProvider === 'tavily' && <EnvBadge set={true} label="Tavily (active)" />}
                    {envCheck.searchProvider === 'brave' && <EnvBadge set={true} label="Brave (active)" />}
                    {envCheck.searchProvider === 'duckduckgo' && (
                      <><EnvBadge set={false} label="TAVILY_API_KEY" /><span className="text-xs text-text-muted ml-1">— falling back to DuckDuckGo</span></>
                    )}
                  </span>
                </>
              ) : (
                <span className="text-xs text-text-muted">requires JINA_API_KEY — no fallback</span>
              )}
            </div>
          </div>
        </label>
      </div>

      {/* Gap analysis */}
      <div>
        <p className="text-xs text-text-muted uppercase tracking-wide mb-3">Gap Analysis</p>
        <div className="space-y-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={gapEnabled} onChange={e => setGapEnabled(e.target.checked)}
              className="w-4 h-4 accent-accent" />
            <span className="text-sm text-text-primary">Enabled</span>
            <span className="text-xs text-text-muted">(runs a second LLM pass to find missing information)</span>
          </label>
          {gapEnabled && (
            <div className="max-w-[160px]">
              <label className={labelCls}>Max gap searches</label>
              <input type="number" min={1} max={5} value={maxGapSearches} onChange={e => setMaxGapSearches(Number(e.target.value))} className={inputCls} />
            </div>
          )}
        </div>
      </div>

      {/* Budget */}
      <div>
        <p className="text-xs text-text-muted uppercase tracking-wide mb-3">Budget</p>
        <div className="max-w-[160px]">
          <label className={labelCls}>Daily limit (USD)</label>
          <input type="number" min={0} step={0.5} value={budgetDaily} onChange={e => setBudgetDaily(Number(e.target.value))} className={inputCls} />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" loading={updateConfig.isPending}>Save</Button>
        {saved && <span className="text-xs text-green-400">Saved</span>}
      </div>
    </form>
  );
}

// --- Main Page ---

export function ResearchSessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: session, isLoading, isError } = useResearchSession(id!);
  const { data: runningData } = useResearchRunning(id!);
  const isRunning = runningData?.running ?? false;
  const { data: findingsData = [] } = useResearchFindings(id!);
  const { data: threadsData = [] } = useResearchThreads(id!);
  const { data: costs } = useResearchCosts(id!);
  const { data: activity } = useResearchActivity(id!, { refetchInterval: isRunning ? 3000 : undefined });
  const { data: allSteps = [] } = useResearchSteps(id!, undefined, { refetchInterval: isRunning ? 3000 : undefined });
  const { events } = useResearchStream(id!);
  const { data: envCheck } = useResearchEnvCheck();
  const updateSession = useUpdateResearchSession();
  const updateConfig = useUpdateSessionConfig();
  const injectThread = useInjectThread();
  const [newQuestion, setNewQuestion] = useState('');
  const [tab, setTab] = useState<'document' | 'live' | 'graph' | 'workers' | 'settings'>('document');
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const deleteSession = useDeleteResearchSession();

  // suppress unused warnings — available for future use
  void activity;

  if (isLoading) return <PageLoading />;
  if (isError || !session) return <ErrorState message="Session not found." />;

  const sessionFetchText = (session.config as Record<string, unknown>).fetch_source_text as boolean ?? false;
  function handleToggleSessionFetch() {
    updateConfig.mutate({ id: id!, config: { fetch_source_text: !sessionFetchText } });
  }

  function handleInject(e: React.FormEvent) {
    e.preventDefault();
    if (!newQuestion.trim()) return;
    injectThread.mutate({ sessionId: id!, query: newQuestion.trim() });
    setNewQuestion('');
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div>
        <Link to="/research" className="text-xs text-accent hover:underline">&larr; All sessions</Link>
        <div className="flex items-center justify-between mt-2">
          <div>
            <h1 className="font-heading text-2xl font-bold text-text-primary">{session.title}</h1>
            <p className="text-sm text-text-muted mt-0.5">{session.seed_query}</p>
          </div>
          <div className="flex items-center gap-2">
            {(session.status === 'active' || session.status === 'paused') && (
              <Button
                variant={session.status === 'active' ? 'secondary' : 'primary'}
                size="sm"
                loading={updateSession.isPending}
                onClick={() => updateSession.mutate({ id: id!, status: session.status === 'active' ? 'paused' : 'active' })}
              >
                {session.status === 'active' ? 'Disable' : 'Enable'}
              </Button>
            )}
            {deleteConfirm ? (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-text-muted">Delete session?</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="!bg-red-900/50 !text-red-300 hover:!bg-red-900/80"
                  loading={deleteSession.isPending}
                  onClick={() => deleteSession.mutate({ id: id! }, { onSuccess: () => { window.location.href = '/research'; } })}
                >Confirm</Button>
                <Button variant="ghost" size="sm" onClick={() => setDeleteConfirm(false)}>Cancel</Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="!text-red-400 hover:!text-red-300"
                onClick={() => setDeleteConfirm(true)}
              >Delete</Button>
            )}
          </div>
        </div>
      </div>


      {/* Env warnings/errors banner */}
      {envCheck && (envCheck.errors.length > 0 || envCheck.warnings.length > 0 || envCheck.jina_balance !== null) && (
        <div className="flex flex-col gap-1.5">
          {envCheck.errors.map((e, i) => (
            <div key={i} className="rounded border border-red-500/50 bg-red-500/10 px-3 py-2 flex items-center gap-2">
              <Icon name="close" size="xs" className="text-red-400 shrink-0" />
              <span className="text-xs text-red-400 font-medium">{e}</span>
            </div>
          ))}
          {envCheck.warnings.map((w, i) => (
            <div key={i} className="rounded border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 flex items-center gap-2">
              <span className="text-yellow-400 text-xs shrink-0">⚠</span>
              <span className="text-xs text-yellow-400">{w}</span>
            </div>
          ))}
          {envCheck.jina_balance !== null && (
            <div className="rounded border border-border-primary bg-bg-secondary px-3 py-2 flex items-center gap-2">
              <span className="text-xs text-text-muted">Jina balance:</span>
              <span className={`text-xs font-medium tabular-nums ${envCheck.jina_balance < 100_000 ? 'text-red-400' : envCheck.jina_balance < 1_000_000 ? 'text-yellow-400' : 'text-green-400'}`}>
                {envCheck.jina_balance.toLocaleString()} tokens
              </span>
            </div>
          )}
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

      {/* Inject question */}
      <form onSubmit={handleInject} className="flex gap-2 items-center">
        <input type="text" value={newQuestion} onChange={e => setNewQuestion(e.target.value)}
          placeholder="Inject a research question..."
          className="flex-1 bg-bg-secondary border border-border-primary rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent" />
<Button type="submit" variant="secondary" size="sm" loading={injectThread.isPending}>Inject</Button>
      </form>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border-primary">
        {([
          { key: 'document', label: `Document (${findingsData.length})` },
          { key: 'live', label: `Live (${threadsData.length})` },
          { key: 'graph', label: `Graph (${threadsData.length})` },
          { key: 'workers', label: 'Workers' },
          { key: 'settings', label: 'Settings' },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={clsx('px-3 py-2 text-sm font-medium border-b-2 transition-colors',
              tab === t.key ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:text-text-secondary')}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'document' && <DocumentView findings={findingsData} threads={threadsData} />}
      {tab === 'live' && <ThreadLiveView threads={threadsData} findings={findingsData} allSteps={allSteps} events={events} isRunning={isRunning} sessionId={id!} sessionFetchText={sessionFetchText} onToggleSessionFetch={handleToggleSessionFetch} />}
      {tab === 'graph' && <ThreadGraph threads={threadsData} findings={findingsData} />}
      {tab === 'workers' && <WorkersTab sessionId={id!} />}
      {tab === 'settings' && <SessionSettings session={session} sessionId={id!} />}
    </div>
  );
}
