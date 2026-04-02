import { useState, useMemo, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { clsx } from 'clsx';
// @ts-ignore
import dagre from 'dagre';
import { ReactFlow, Background, Controls, Handle, Position, BackgroundVariant } from '@xyflow/react';
import type { Node, Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  useResearchSession, useResearchFindings, useResearchThreads,
  useResearchCosts, useUpdateResearchSession, useRateFinding,
  useInjectThread, useRunResearch, useResearchRunning,
  useResearchActivity, useCancelJob, useResearchJobs, useResearchStream,
  useResearchSteps,
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
          className={clsx('h-full rounded-full', value > 0.7 ? 'bg-green-400' : value > 0.4 ? 'bg-yellow-400' : 'bg-red-400')}
          style={{ width: `${value * 100}%` }}
        />
      </div>
      <span className="text-xs text-text-muted">{(value * 100).toFixed(0)}%</span>
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
          <p className="text-sm text-text-primary">{finding.summary}</p>
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
            <div className="mt-3 space-y-2">
              <p className="text-xs text-text-secondary whitespace-pre-wrap">{finding.content}</p>
              {finding.source_urls.length > 0 && (
                <div className="space-y-0.5">
                  {finding.source_urls.map((url, i) => (
                    <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                      className="block text-xs text-accent hover:underline truncate">[{i + 1}] {url}</a>
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
                <span className="text-sm font-medium text-text-primary truncate">{thread.query}</span>
                <span className={clsx('px-1.5 py-0.5 rounded text-xs shrink-0',
                  thread.origin === 'seed' ? 'bg-blue-900/50 text-blue-300' : 'bg-purple-900/50 text-purple-300'
                )}>{thread.origin.replace('_', ' ')}</span>
              </div>
              <div className="flex items-center gap-3 shrink-0 ml-3">
                <span className="text-xs text-text-muted">{sectionFindings.length} finding{sectionFindings.length !== 1 ? 's' : ''}</span>
                <svg className={clsx('w-4 h-4 text-text-muted transition-transform', isCollapsed && 'rotate-180')} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                </svg>
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
  active: 'bg-green-400 animate-pulse',
  queued: 'bg-yellow-400/70',
  exhausted: 'bg-text-muted/40',
  deferred: 'bg-blue-400/70',
  pruned: 'bg-red-400/70',
  paused: 'bg-orange-400/70',
};

const liveOriginColor: Record<string, string> = {
  seed: 'bg-blue-900/50 text-blue-300',
  follow_up: 'bg-purple-900/50 text-purple-300',
  perturbation: 'bg-orange-900/50 text-orange-300',
  verify: 'bg-red-900/50 text-red-300',
  user_injected: 'bg-green-900/50 text-green-300',
  monitor_alert: 'bg-yellow-900/50 text-yellow-300',
};

function ThreadLiveRow({
  thread, steps, threadFindings, childThreads, depth, expanded, onToggle,
}: {
  thread: ResearchThread;
  steps: ResearchStep[];
  threadFindings: ResearchFinding[];
  childThreads: ResearchThread[];
  depth: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const searches = steps.flatMap(s =>
    s.tool_calls
      .filter(tc => tc.tool === 'web_search')
      .map(tc => ({ query: tc.input?.query as string, cost: s.cost_usd, duration: s.duration_ms, error: tc.error }))
  );
  const errors = steps.filter(s => s.error);
  const followUpQuestions = Array.from(new Set(threadFindings.flatMap(f => f.follow_up_questions ?? [])));
  const childQuerySet = new Set(childThreads.map(t => t.query.toLowerCase().trim()));

  return (
    <div style={{ marginLeft: depth * 18 }}>
      <button
        onClick={onToggle}
        className="w-full flex items-start gap-2 px-3 py-2 rounded-lg hover:bg-bg-tertiary/30 transition-colors text-left group"
      >
        <span className={clsx('mt-1.5 w-1.5 h-1.5 rounded-full shrink-0', liveStatusDot[thread.status] ?? 'bg-text-muted/40')} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-text-primary leading-snug">{thread.query}</span>
            <span className={clsx('px-1 py-0.5 rounded text-[10px] shrink-0', liveOriginColor[thread.origin] ?? 'bg-bg-tertiary text-text-muted')}>
              {thread.origin.replace(/_/g, ' ')}
            </span>
            {thread.status === 'exhausted' && threadFindings.length > 0 && (
              <span className="text-[10px] text-text-muted shrink-0">{threadFindings.length} finding{threadFindings.length !== 1 ? 's' : ''}</span>
            )}
            {thread.status === 'active' && (
              <span className="text-[10px] text-green-400 shrink-0">running…</span>
            )}
          </div>
        </div>
        <svg className={clsx('w-3.5 h-3.5 text-text-muted shrink-0 mt-1 transition-transform', expanded && 'rotate-180')} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {expanded && (
        <div className="ml-5 pl-3 border-l border-border-primary/40 pb-1 space-y-0.5">
          {searches.length === 0 && errors.length === 0 && threadFindings.length === 0 && (
            <p className="text-xs text-text-muted py-1 italic">waiting to run…</p>
          )}

          {searches.map((s, i) => (
            <div key={i} className="flex items-start gap-2 py-0.5">
              <span className="text-text-muted text-xs shrink-0 mt-0.5">🔍</span>
              <span className="text-xs text-text-secondary flex-1 break-words">{s.query}</span>
              <span className="text-[10px] text-text-muted/60 shrink-0">
                {s.cost > 0 ? `$${s.cost.toFixed(4)}` : ''}{s.duration ? ` · ${(s.duration / 1000).toFixed(1)}s` : ''}
              </span>
            </div>
          ))}

          {errors.map((s, i) => (
            <div key={i} className="flex items-start gap-2 py-0.5">
              <span className="text-red-400 text-xs shrink-0">⚠</span>
              <span className="text-xs text-red-400 break-words">{s.error}</span>
            </div>
          ))}

          {threadFindings.map(f => (
            <div key={f.id} className="flex items-start gap-2 py-1 bg-green-900/10 rounded px-2 mt-1">
              <span className="text-green-400 text-xs shrink-0 mt-0.5">✓</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-text-primary">{f.summary}</p>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="text-[10px] text-text-muted">conf {(f.confidence * 100).toFixed(0)}%</span>
                  <span className="text-[10px] text-text-muted">novel {(f.novelty * 100).toFixed(0)}%</span>
                  {f.source_urls.length > 0 && <span className="text-[10px] text-text-muted">{f.source_urls.length} src</span>}
                  {f.confidence < 0.4 && <span className="text-[10px] text-red-400">low confidence</span>}
                </div>
              </div>
            </div>
          ))}

          {followUpQuestions.length > 0 && (
            <div className="mt-1.5 pt-1 border-t border-border-primary/30">
              <p className="text-[10px] text-text-muted uppercase tracking-wide mb-0.5">Follow-ups</p>
              {followUpQuestions.map((q, i) => {
                const spawned = childQuerySet.has(q.toLowerCase().trim());
                return (
                  <div key={i} className="flex items-start gap-1.5 py-0.5">
                    <span className="text-[10px] text-text-muted shrink-0 mt-0.5">{spawned ? '→' : '·'}</span>
                    <span className={clsx('text-xs break-words', spawned ? 'text-text-secondary' : 'text-text-muted')}>{q}</span>
                    {spawned && <span className="text-[10px] text-purple-400 shrink-0 mt-0.5">spawned</span>}
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

function ThreadLiveView({
  threads, findings, allSteps, events, isRunning,
}: {
  threads: ResearchThread[];
  findings: ResearchFinding[];
  allSteps: ResearchStep[];
  events: StreamEvent[];
  isRunning: boolean;
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Auto-expand active threads whenever thread list changes
  useEffect(() => {
    const activeIds = threads.filter(t => t.status === 'active').map(t => t.id);
    if (activeIds.length > 0) {
      setExpandedIds(prev => {
        const next = new Set(prev);
        for (const id of activeIds) next.add(id);
        return next;
      });
    }
  }, [threads]);

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

  const childrenByThread = useMemo(() => {
    const map = new Map<string, ResearchThread[]>();
    for (const t of threads) {
      if (!t.parent_thread_id) continue;
      const arr = map.get(t.parent_thread_id) ?? [];
      arr.push(t);
      map.set(t.parent_thread_id, arr);
    }
    return map;
  }, [threads]);

  const ordered = useMemo(() => orderThreadsDepthFirst(threads), [threads]);

  if (ordered.length === 0) {
    return <p className="text-sm text-text-muted text-center py-12">No threads yet. Run the engine to start.</p>;
  }

  return (
    <div className="space-y-0.5">
      {isRunning && (
        <div className="flex items-center gap-2 px-3 py-2 bg-green-900/10 border border-green-800/30 rounded-lg mb-3">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse shrink-0" />
          <span className="text-sm text-green-300 font-medium">Running</span>
        </div>
      )}
      {ordered.map(thread => (
        <ThreadLiveRow
          key={thread.id}
          thread={thread}
          steps={stepsByThread.get(thread.id) ?? []}
          threadFindings={findingsByThread.get(thread.id) ?? []}
          childThreads={childrenByThread.get(thread.id) ?? []}
          depth={thread.depth}
          expanded={expandedIds.has(thread.id)}
          onToggle={() => setExpandedIds(prev => {
            const next = new Set(prev);
            next.has(thread.id) ? next.delete(thread.id) : next.add(thread.id);
            return next;
          })}
        />
      ))}
    </div>
  );
}

// --- Graph Tab ---

const NODE_WIDTH = 200;
const NODE_HEIGHT = 70;

function layoutGraph(threads: ResearchThread[]) {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', nodesep: 20, ranksep: 40 });

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
    <div className={clsx('rounded-lg border px-3 py-2 w-[200px] cursor-pointer', statusColors[data.status] ?? 'border-border-primary bg-bg-secondary')}>
      <Handle type="target" position={Position.Top} className="!bg-border-primary" />
      <div className="flex items-center gap-1.5 mb-1">
        <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', statusDot[data.status] ?? 'bg-text-muted')} />
        <span className="text-[10px] text-text-muted uppercase tracking-wide">{data.origin.replace('_', ' ')}</span>
        {data.findingCount > 0 && (
          <span className="ml-auto text-[10px] bg-bg-tertiary text-text-muted px-1 rounded">{data.findingCount}</span>
        )}
      </div>
      <p className="text-xs text-text-primary leading-tight line-clamp-2">{data.query}</p>
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
    <div style={{ height: '500px' }} className="rounded-lg border border-border-primary overflow-hidden">
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView>
        <Background variant={BackgroundVariant.Dots} color="#374151" gap={16} />
        <Controls className="[&>button]:bg-bg-secondary [&>button]:border-border-primary [&>button]:text-text-secondary" />
      </ReactFlow>
    </div>
  );
}

// --- Workers Tab ---

function WorkersTab({ sessionId }: { sessionId: string }) {
  const { data: jobs = [] } = useResearchJobs(sessionId);
  const [selectedJob, setSelectedJob] = useState<ResearchJob | null>(null);

  const counts = useMemo(() => ({
    running: jobs.filter(j => j.status === 'running' || j.status === 'claimed').length,
    pending: jobs.filter(j => j.status === 'pending').length,
    completed: jobs.filter(j => j.status === 'completed').length,
    failed: jobs.filter(j => j.status === 'failed').length,
  }), [jobs]);

  function jobDuration(job: ResearchJob): string {
    if (!job.started_at) return '—';
    const end = job.completed_at ? new Date(job.completed_at) : new Date();
    const ms = end.getTime() - new Date(job.started_at).getTime();
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    return `${Math.round(ms / 60000)}m`;
  }

  const jobStatusStyle: Record<string, string> = {
    running: 'bg-green-900/50 text-green-300',
    claimed: 'bg-green-900/30 text-green-400',
    pending: 'bg-yellow-900/50 text-yellow-300',
    completed: 'bg-bg-tertiary text-text-muted',
    failed: 'bg-red-900/50 text-red-300',
    cancelled: 'bg-bg-tertiary text-text-muted',
  };

  return (
    <div className="space-y-4">
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

      {jobs.length === 0 ? (
        <p className="text-sm text-text-muted text-center py-8">No jobs yet. Hit Run to start.</p>
      ) : (
        <div className="bg-bg-secondary border border-border-primary rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border-primary text-text-muted">
                <th className="px-3 py-2 text-left font-medium">#</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-left font-medium">Mode</th>
                <th className="px-3 py-2 text-left font-medium">Iters</th>
                <th className="px-3 py-2 text-left font-medium">Worker</th>
                <th className="px-3 py-2 text-left font-medium">Started</th>
                <th className="px-3 py-2 text-left font-medium">Duration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-primary/50">
              {[...jobs].reverse().map((job, i) => (
                <tr key={job.id} onClick={() => setSelectedJob(job)}
                  className="hover:bg-bg-tertiary/30 cursor-pointer transition-colors">
                  <td className="px-3 py-2 text-text-muted font-mono">{jobs.length - i}</td>
                  <td className="px-3 py-2">
                    <span className={clsx('px-1.5 py-0.5 rounded text-[10px] font-medium', jobStatusStyle[job.status] ?? 'bg-bg-tertiary text-text-muted')}>
                      {job.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-text-secondary">{job.mode}</td>
                  <td className="px-3 py-2 text-text-secondary font-mono">
                    {job.iterations_completed}{job.max_iterations ? `/${job.max_iterations}` : ''}
                  </td>
                  <td className="px-3 py-2 text-text-muted font-mono truncate max-w-[100px]">
                    {job.claimed_by ? job.claimed_by.replace('worker-', '').slice(0, 12) : '—'}
                  </td>
                  <td className="px-3 py-2 text-text-muted">
                    {job.started_at ? timeAgo(job.started_at) : '—'}
                  </td>
                  <td className="px-3 py-2 text-text-muted">{jobDuration(job)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedJob && (
        <div className="bg-bg-secondary border border-border-primary rounded-lg p-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-text-muted">Job detail</p>
            <button onClick={() => setSelectedJob(null)} className="text-xs text-text-muted hover:text-text-secondary">close</button>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div><span className="text-text-muted">ID: </span><span className="font-mono text-text-secondary">{selectedJob.id.slice(0, 16)}</span></div>
            <div><span className="text-text-muted">Mode: </span><span className="text-text-secondary">{selectedJob.mode}</span></div>
            <div><span className="text-text-muted">Created: </span><span className="text-text-secondary">{new Date(selectedJob.created_at).toLocaleString()}</span></div>
            {selectedJob.started_at && <div><span className="text-text-muted">Started: </span><span className="text-text-secondary">{new Date(selectedJob.started_at).toLocaleString()}</span></div>}
            {selectedJob.completed_at && <div><span className="text-text-muted">Completed: </span><span className="text-text-secondary">{new Date(selectedJob.completed_at).toLocaleString()}</span></div>}
            {selectedJob.claimed_by && <div className="col-span-2"><span className="text-text-muted">Worker: </span><span className="font-mono text-text-secondary">{selectedJob.claimed_by}</span></div>}
          </div>
          {selectedJob.error && (
            <div className="bg-red-900/20 border border-red-800/50 rounded p-2">
              <p className="text-xs text-red-300">{selectedJob.error}</p>
            </div>
          )}
        </div>
      )}
    </div>
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
  const updateSession = useUpdateResearchSession();
  const rateFinding = useRateFinding();
  const injectThread = useInjectThread();
  const runResearch = useRunResearch();
  const cancelJobMutation = useCancelJob();
  const [newQuestion, setNewQuestion] = useState('');
  const [injectDepth, setInjectDepth] = useState(8);
  const [tab, setTab] = useState<'document' | 'live' | 'graph' | 'workers'>('document');
  const [runError, setRunError] = useState<string | null>(null);

  // suppress unused warnings — available for future use
  void rateFinding;
  void cancelJobMutation;
  void activity;

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
              <Button variant="primary" size="sm" loading={runResearch.isPending} disabled={isRunning}
                onClick={() => {
                  setRunError(null);
                  runResearch.mutate(
                    { sessionId: id!, iterations: 5 },
                    { onError: (err) => setRunError(err instanceof Error ? err.message : String(err)) }
                  );
                }}>
                {isRunning ? 'Running...' : 'Run'}
              </Button>
            )}
            {session.status === 'active' && (
              <Button variant="secondary" size="sm" onClick={() => updateSession.mutate({ id: id!, status: 'paused' })}>Pause</Button>
            )}
            {session.status === 'paused' && (
              <Button variant="secondary" size="sm" onClick={() => updateSession.mutate({ id: id!, status: 'active' })}>Resume</Button>
            )}
            {session.status !== 'archived' && (
              <Button variant="ghost" size="sm" onClick={() => updateSession.mutate({ id: id!, status: 'archived' })}>Archive</Button>
            )}
          </div>
        </div>
      </div>

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

      {/* Inject question */}
      <form onSubmit={handleInject} className="flex gap-2 items-center">
        <input type="text" value={newQuestion} onChange={e => setNewQuestion(e.target.value)}
          placeholder="Inject a research question..."
          className="flex-1 bg-bg-secondary border border-border-primary rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent" />
        <label className="flex items-center gap-1 text-xs text-text-muted shrink-0">
          Depth
          <input type="number" min={1} max={20} value={injectDepth} onChange={e => setInjectDepth(Number(e.target.value))}
            className="w-12 bg-bg-secondary border border-border-primary rounded px-1.5 py-1.5 text-sm text-text-primary text-center focus:outline-none focus:border-accent" />
        </label>
        <Button type="submit" variant="secondary" size="sm" loading={injectThread.isPending}>Inject</Button>
      </form>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border-primary">
        {([
          { key: 'document', label: `Document (${findingsData.length})` },
          { key: 'live', label: `Live (${threadsData.length})` },
          { key: 'graph', label: `Graph (${threadsData.length})` },
          { key: 'workers', label: 'Workers' },
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
      {tab === 'live' && <ThreadLiveView threads={threadsData} findings={findingsData} allSteps={allSteps} events={events} isRunning={isRunning} />}
      {tab === 'graph' && <ThreadGraph threads={threadsData} findings={findingsData} />}
      {tab === 'workers' && <WorkersTab sessionId={id!} />}
    </div>
  );
}
