/**
 * ResearchEventsList — the live event log.
 *
 * Extracted from ResearchQueryDetailPage so the merged Activity tab can compose
 * it as one column in the dashboard. Renders six event categories
 * (finding / thread / step / search / fetch / error), supports per-thread
 * filtering, free-text fuzzy search, expandable rows with full event detail,
 * and merges live SSE with DB-backed steps + findings so rows that aged out
 * of the 1000-event SSE cache still appear.
 */
import React, { useMemo, useRef, useState, useLayoutEffect } from 'react';
import { clsx } from 'clsx';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Icon } from '../../components/ui/Icon';
import {
  type ResearchFinding,
  type ResearchStep,
  type ResearchThread,
  type StreamEvent,
} from '../../api/research-hooks';
import { formatEventDetail, RENDER_WINDOW, THREAD_PALETTE } from './research-events-format';

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

const liveOriginColor: Record<string, string> = {
  seed: 'bg-accent/15 text-accent',
  gap_analysis: 'bg-purple-500/15 text-purple-400',
  follow_up: 'bg-blue-500/15 text-blue-400',
  perturbation: 'bg-orange-500/15 text-orange-400',
};

export type EventFilterType = 'all' | 'finding' | 'thread' | 'step' | 'search' | 'fetch' | 'error';

export interface ResearchEventsListProps {
  sessionId: string;
  threads: ResearchThread[];
  findings: ResearchFinding[];
  allSteps: ResearchStep[];
  events: StreamEvent[];
  isRunning: boolean;
  className?: string;
}

export function ResearchEventsList({
  sessionId, threads, findings, allSteps, events, isRunning, className,
}: ResearchEventsListProps) {
  const streamRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filterType, setFilterType] = useState<EventFilterType>('all');
  const [searchText, setSearchText] = useState('');
  const [filterThreadId, setFilterThreadId] = useState<string | null>(null);
  const [expandedEventKey, setExpandedEventKey] = useState<string | null>(null);

  const ordered = useMemo(() => orderThreadsDepthFirst(threads), [threads]);

  const threadColor = useMemo(() => {
    const map = new Map<string, string>();
    ordered.forEach((t, i) => map.set(t.id, THREAD_PALETTE[i % THREAD_PALETTE.length]));
    return map;
  }, [ordered]);

  type EnrichedEvent = StreamEvent & { threadDiff?: string };

  const mergedEvents = useMemo<StreamEvent[]>(() => {
    const stepIds = new Set<string>();
    const findingIds = new Set<string>();
    for (const e of events) {
      if (e.type === 'step') stepIds.add(e.payload.id);
      else if (e.type === 'finding') findingIds.add(e.payload.id);
    }
    const extra: StreamEvent[] = [];
    for (const s of allSteps) {
      if (!stepIds.has(s.id)) extra.push({ type: 'step', payload: s });
    }
    for (const f of findings) {
      if (!findingIds.has(f.id)) extra.push({ type: 'finding', payload: f });
    }
    if (extra.length === 0) return events;
    const tsOf = (e: StreamEvent): string => {
      if (e.type === 'thread') return e.payload.updated_at ?? e.payload.created_at;
      if (e.type === 'step' || e.type === 'finding') return e.payload.created_at;
      return '';
    };
    return [...events, ...extra].sort((a, b) => tsOf(b).localeCompare(tsOf(a)));
  }, [events, allSteps, findings]);

  const streamEvents = useMemo(() => {
    const prevState = new Map<string, ResearchThread>();
    const enriched: EnrichedEvent[] = mergedEvents.map(ev => {
      if (ev.type !== 'thread') return ev;
      const t = ev.payload;
      const prev = prevState.get(t.id);
      prevState.set(t.id, t);
      if (!prev) return ev;
      const changes: string[] = [];
      if (prev.status !== t.status) changes.push(`${prev.status} → ${t.status}`);
      if (prev.short_query !== t.short_query && t.short_query) changes.push(`titled`);
      if (Math.abs((prev.priority ?? 0) - (t.priority ?? 0)) > 0.005)
        changes.push(`priority ${prev.priority.toFixed(2)} → ${t.priority.toFixed(2)}`);
      if (!prev.retry_after && t.retry_after) changes.push(`backoff`);
      if (prev.retry_after && !t.retry_after && prev.status === t.status) changes.push(`retry`);
      return { ...ev, threadDiff: changes.join(' · ') || null } as EnrichedEvent;
    });

    let evs = enriched.reverse();
    if (filterType === 'finding') evs = evs.filter(e => e.type === 'finding');
    else if (filterType === 'thread') evs = evs.filter(e => e.type === 'thread');
    else if (filterType === 'step') evs = evs.filter(e => e.type === 'step');
    else if (filterType === 'search') evs = evs.filter(e => e.type === 'step' && (e.payload.tool_calls ?? []).some(tc => tc.tool === 'web_search' || tc.tool === 'search_web' || tc.tool === 'search'));
    else if (filterType === 'fetch') evs = evs.filter(e => e.type === 'step' && (e.payload.tool_calls ?? []).some(tc => tc.tool === 'fetch_url' || tc.tool === 'fetch'));
    else if (filterType === 'error') evs = evs.filter(e => e.type === 'step' && !!(e.payload as ResearchStep).error);
    if (filterThreadId) {
      evs = evs.filter(e => {
        if (e.type === 'finding') return (e.payload as ResearchFinding).thread_id === filterThreadId;
        if (e.type === 'step') return e.payload.thread_id === filterThreadId;
        if (e.type === 'thread') return e.payload.id === filterThreadId;
        return true;
      });
    }
    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase();
      evs = evs.filter(e => {
        const f = formatEventDetail(e);
        if (!f) return false;
        const haystack = [f.typeLabel, f.detail, ...(f.chips?.map(c => c.text) ?? [])].join(' ').toLowerCase();
        let qi = 0;
        for (let i = 0; i < haystack.length && qi < q.length; i++) {
          if (haystack[i] === q[qi]) qi++;
        }
        return qi === q.length;
      });
    }
    return evs;
  }, [mergedEvents, filterType, filterThreadId, searchText]);

  useLayoutEffect(() => {
    if (autoScroll && streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight;
    }
  }, [streamEvents, autoScroll]);

  const filterPills: Array<{ key: EventFilterType; label: string }> = [
    { key: 'all', label: 'all' },
    { key: 'finding', label: 'findings' },
    { key: 'thread', label: 'threads' },
    { key: 'step', label: 'steps' },
    { key: 'search', label: 'search' },
    { key: 'fetch', label: 'fetch' },
    { key: 'error', label: 'errors' },
  ];

  return (
    <div className={clsx('flex flex-col overflow-hidden bg-bg-primary', className)}>
      {/* Event log header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-primary bg-bg-secondary shrink-0 h-[37px]">
        <span className="text-sm font-semibold uppercase tracking-wider text-text-secondary shrink-0">Event Log</span>
        {filterThreadId && (() => {
          const ft = threads.find(t => t.id === filterThreadId);
          const ftColor = threadColor.get(filterThreadId) ?? '#8796b0';
          return (
            <div className="flex items-center gap-2 flex-1 overflow-hidden ml-2">
              <div
                className="text-sm px-1.5 py-0.5 rounded border truncate max-w-48"
                style={{ background: `${ftColor}15`, borderColor: `${ftColor}35`, color: ftColor }}
              >
                {ft ? (ft.short_query ?? ft.query) : filterThreadId.slice(0, 12)}
              </div>
              <button
                onClick={() => setFilterThreadId(null)}
                className="text-sm text-text-muted hover:text-text-primary px-1 py-0.5 rounded border border-border-primary shrink-0 transition-colors"
              >× clear</button>
            </div>
          );
        })()}
        <span className="text-sm text-text-muted font-mono ml-auto shrink-0">
          {streamEvents.length !== mergedEvents.length ? `${streamEvents.length} / ${mergedEvents.length}` : mergedEvents.length}
        </span>
        <button
          title="Download activity log (.md) — human-readable report with jobs, steps, findings, status history"
          onClick={() => { const a = document.createElement('a'); a.href = `/api/research/queries/${sessionId}/export/log`; a.download = ''; a.click(); }}
          className="p-1 rounded text-text-muted hover:text-text-secondary hover:bg-bg-tertiary transition-colors shrink-0"
        ><Icon name="download" size="xs" /></button>
        <button
          title="Download raw event log (.ndjson) — one event per line, for grep/jq/debug"
          onClick={() => { const a = document.createElement('a'); a.href = `/api/research/queries/${sessionId}/export/log?format=ndjson`; a.download = ''; a.click(); }}
          className="p-1 rounded text-text-muted hover:text-text-secondary hover:bg-bg-tertiary transition-colors shrink-0 font-mono text-[10px] leading-none px-1.5"
        >.nd</button>
      </div>

      {/* Filter pill bar — all six event types are addressable here. */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border-primary bg-bg-secondary shrink-0 flex-wrap">
        {filterPills.map(p => (
          <button
            key={p.key}
            onClick={() => setFilterType(p.key)}
            className={clsx(
              'px-2 py-0.5 rounded text-sm border transition-colors font-mono',
              filterType === p.key
                ? 'bg-accent/15 border-accent/35 text-accent'
                : 'bg-bg-tertiary border-border-primary text-text-muted hover:text-text-secondary'
            )}
          >{p.label}</button>
        ))}
        <input
          type="text"
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          placeholder="search…"
          className="flex-1 min-w-0 ml-2 bg-bg-tertiary border border-border-primary rounded px-2 py-0.5 text-sm text-text-secondary placeholder:text-text-disabled focus:outline-none focus:border-accent/50"
        />
        <select
          value={filterThreadId ?? ''}
          onChange={e => setFilterThreadId(e.target.value || null)}
          className="bg-bg-tertiary border border-border-primary rounded px-1.5 py-0.5 text-sm text-text-secondary focus:outline-none focus:border-accent/50 shrink-0 max-w-40"
          title="Filter by thread"
        >
          <option value="">all threads</option>
          {ordered.map(t => (
            <option key={t.id} value={t.id}>{t.short_query ?? t.query.slice(0, 40)}</option>
          ))}
        </select>
        <button
          onClick={() => { if (streamRef.current) streamRef.current.scrollTop = 0; }}
          title="Scroll to first"
          className="px-1.5 py-0.5 rounded text-sm border border-border-primary bg-bg-tertiary text-text-muted hover:text-text-secondary transition-colors font-mono"
        >▲</button>
        <button
          onClick={() => { if (streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight; }}
          title="Scroll to last"
          className="px-1.5 py-0.5 rounded text-sm border border-border-primary bg-bg-tertiary text-text-muted hover:text-text-secondary transition-colors font-mono"
        >▼</button>
        <button
          onClick={() => setAutoScroll(a => !a)}
          className={clsx('px-1.5 py-0.5 rounded text-sm border transition-colors shrink-0',
            autoScroll
              ? 'border-success/25 bg-success/8 text-success'
              : 'border-border-primary bg-bg-tertiary text-text-muted'
          )}
        >↓ auto</button>
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
          <p className="text-sm text-text-muted text-center py-8">Waiting for events…</p>
        )}
        {streamEvents.length > RENDER_WINDOW && (
          <p className="text-sm text-text-muted text-center py-1.5 border-b border-border-primary/20">
            {streamEvents.length - RENDER_WINDOW} older events not shown
          </p>
        )}
        {streamEvents.slice(-RENDER_WINDOW).map(ev => {
          const formatted = formatEventDetail(ev);
          if (!formatted) return null;
          const evKey = ev._seq !== undefined
            ? `${ev.type}:${ev._seq}`
            : ev.type === 'thread'
              ? `thread:${ev.payload.id}:${ev.payload.updated_at ?? ev.payload.created_at}`
              : `${ev.type}:${(ev.payload as { id: string }).id}`;
          const isExpanded = expandedEventKey === evKey;
          const threadId = ev.type === 'finding' ? ev.payload.thread_id
            : ev.type === 'step' ? ev.payload.thread_id
            : ev.type === 'thread' ? ev.payload.id
            : null;
          const color = threadId ? (threadColor.get(threadId) ?? '#8796b0') : '#8796b0';
          const thread = threadId ? ordered.find(t => t.id === threadId) ?? null : null;
          const ts = ev.type === 'finding' ? ev.payload.created_at
            : ev.type === 'step' ? ev.payload.created_at
            : ev.type === 'thread' ? (ev.payload.updated_at ?? ev.payload.created_at)
            : null;
          const timeStr = ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '';
          const isFinding = ev.type === 'finding';
          const isLabelOnlyStep = ev.type === 'step' && (ev.payload.tool_calls ?? []).length === 0;
          const abbrevThreadQ = thread ? (thread.short_query ?? thread.query) : null;
          const displayDetail = formatted.detail || (isLabelOnlyStep && abbrevThreadQ) || '';
          const isHighFinding = isFinding && (ev.payload as ResearchFinding).confidence >= 0.7;
          const isError = ev.type === 'step' && !!(ev.payload as ResearchStep).error;
          return (
            <div
              key={evKey}
              className={clsx(
                'border-b border-border-primary/20 transition-colors',
                isError ? 'bg-error/8'
                  : isFinding
                    ? isHighFinding ? 'bg-warning/5' : 'bg-success/4'
                    : isExpanded ? 'bg-bg-secondary/60' : 'hover:bg-bg-secondary/40'
              )}
              style={{ borderLeft: `6px solid ${color}${isHighFinding ? 'cc' : '60'}` }}
            >
              <div
                role="button"
                tabIndex={0}
                onClick={() => setExpandedEventKey(prev => prev === evKey ? null : evKey)}
                onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && setExpandedEventKey(prev => prev === evKey ? null : evKey)}
                className="grid items-baseline px-3 py-1 cursor-pointer focus:outline-none"
                style={{ gridTemplateColumns: '72px 130px auto 1fr auto', gap: '0' }}
              >
                <span className="text-sm text-text-muted font-mono pr-1.5 overflow-hidden">{timeStr}</span>
                <span className={clsx('text-sm font-mono pr-2 shrink-0', formatted.typeColor)}>{formatted.typeLabel}</span>
                <span className="flex items-baseline gap-1.5 pr-2 shrink-0">
                  {formatted.chips?.filter(c => !c.meta).map((chip, ci) => (
                    <span key={ci} className={clsx('text-sm font-mono', chip.color)}>{chip.text}</span>
                  ))}
                </span>
                <span className="text-sm min-w-0 truncate text-text-secondary pr-2">
                  {displayDetail}
                </span>
                <span className="flex items-baseline gap-1.5 justify-end shrink-0">
                  {formatted.chips?.filter(c => c.meta).map((chip, ci) => (
                    <span key={ci} className={clsx('text-sm font-mono', chip.color)}>{chip.text}</span>
                  ))}
                </span>
              </div>
              {isExpanded && (
                <div className="px-3 pb-2.5 pt-1 space-y-1.5 border-l-2 ml-[208px]" style={{ borderLeftColor: `${color}40` }}>
                  {ev.type === 'step' && (() => {
                    const s = ev.payload;
                    return (
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-sm text-text-muted flex-wrap">
                          <span className="text-blue-400/80 font-mono">llm</span>
                          <span className="font-mono">{s.model}</span>
                          <span>{s.prompt_tokens}+{s.completion_tokens}</span>
                          {s.cost_usd > 0 && <span>${s.cost_usd.toFixed(4)}</span>}
                          {s.duration_ms > 0 && <span>{(s.duration_ms / 1000).toFixed(1)}s</span>}
                        </div>
                        {s.label && s.tool_calls.length > 0 && <p className="text-sm text-text-secondary font-mono">{s.label}</p>}
                        {s.label === 'summarize thread' && thread && (
                          <div className="text-sm space-y-0.5">
                            <p className="text-text-secondary">Generates short conceptual title for thread</p>
                            <p className="text-text-secondary truncate">query: {thread.short_query ?? thread.query}</p>
                            {thread.short_query && <p className="text-text-primary">title: {thread.short_query}</p>}
                          </div>
                        )}
                        {s.tool_calls.map((tc, ti) => (
                          <div key={ti} className="space-y-0.5">
                            <div className="flex items-start gap-2">
                              <span className="text-text-secondary text-sm font-mono shrink-0">
                                {tc.tool === 'web_search' ? 'search' : tc.tool}
                              </span>
                              {tc.input && (
                                <span className="text-sm text-text-primary break-words flex-1">
                                  {(tc.tool === 'web_search' || tc.tool === 'search_web') && (tc.input as Record<string,unknown>).query
                                    ? `"${(tc.input as Record<string,unknown>).query as string}"`
                                    : <span className="text-text-secondary text-sm font-mono">{JSON.stringify(tc.input).slice(0, 160)}</span>}
                                </span>
                              )}
                            </div>
                            {tc.jina_fetches && tc.jina_fetches.length > 0 && (
                              <div className="pl-3 text-sm text-text-secondary">
                                {tc.jina_fetches.map((j, ji) => {
                                  let host = j.url; try { host = new URL(j.url).hostname; } catch { /* keep */ }
                                  return <span key={ji} className={clsx('mr-2', j.ok ? 'text-teal-400' : 'text-error')}>{host}</span>;
                                })}
                              </div>
                            )}
                            {tc.output && <p className="pl-3 text-sm text-text-secondary/70 break-words">{tc.output.slice(0, 300)}{tc.output.length > 300 ? '…' : ''}</p>}
                          </div>
                        ))}
                        {s.metadata && (() => {
                          const m = s.metadata;
                          if (m.decision === 'gap_analysis') return (
                            <div className="text-sm">
                              <span className={m.has_gaps ? 'text-warning' : 'text-text-secondary'}>
                                {m.has_gaps ? `${m.gap_count as number} gaps` : 'no gaps'}
                              </span>
                            </div>
                          );
                          if (m.decision === 'synthesis') return (
                            <div className="flex gap-3 text-sm font-mono">
                              <span className="text-success">conf {((m.confidence as number) * 100).toFixed(0)}%</span>
                              <span className="text-blue-400">novel {((m.novelty as number) * 100).toFixed(0)}%</span>
                              <span className="text-text-muted">act {((m.actionability as number) * 100).toFixed(0)}%</span>
                              {(m.tags as string[]).length > 0 && (
                                <span className="text-text-secondary">{(m.tags as string[]).join(', ')}</span>
                              )}
                            </div>
                          );
                          if (m.decision === 'dedup') return (
                            <div className="space-y-1 text-sm">
                              <p className={clsx((m.is_duplicate as boolean) ? 'text-error' : 'text-text-secondary')}>
                                {(m.is_duplicate as boolean) ? 'duplicate detected' : `unique · checked ${m.existing_count as number} findings`}
                              </p>
                              {(m.new_summary as string) && (
                                <p className="text-text-secondary italic">new: "{m.new_summary as string}"</p>
                              )}
                              {(m.compared_to as string[] | undefined)?.map((s, i) => (
                                <p key={i} className="pl-3 text-text-secondary/60 truncate">vs: "{s}"</p>
                              ))}
                            </div>
                          );
                          if (m.decision === 'follow_up_eval') return (
                            <div className="space-y-0.5 text-sm">
                              <p className="text-text-secondary">
                                {m.accepted_count as number} accepted · {m.rejected_count as number} rejected
                                {(m.retry_count as number) > 0 && ` · ${m.retry_count as number} retries`}
                                {(m.similarity_threshold as number) && ` · sim≥${(m.similarity_threshold as number).toFixed(2)}`}
                              </p>
                              {(m.candidates as Array<{text: string; accepted: boolean; reason: string|null; sim: number; rank: number}> | undefined)?.map((c, i) => (
                                <div key={i} className={clsx('pl-2 flex gap-2 items-baseline', c.accepted ? 'text-text-secondary' : 'text-text-muted/60')}>
                                  <span className="shrink-0">{c.accepted ? '✓' : '✗'}</span>
                                  <span className="truncate flex-1">"{c.text}"</span>
                                  <span className="font-mono shrink-0 text-sm">sim {c.sim.toFixed(2)}</span>
                                  {c.reason && <span className="text-error/70 shrink-0 text-sm truncate max-w-32">{c.reason}</span>}
                                </div>
                              ))}
                            </div>
                          );
                          if (m.decision === 'formulate_queries') return (
                            <div className="space-y-0.5 text-sm">
                              <p className="text-text-secondary">{(m.queries as string[]).length} queries formulated{(m.skipped_duplicates as number) > 0 && `, ${m.skipped_duplicates as number} skipped (already searched)`}</p>
                              {(m.queries as string[]).map((q, i) => (
                                <p key={i} className="pl-2 text-text-secondary/80 truncate">→ "{q}"</p>
                              ))}
                            </div>
                          );
                          if (m.decision === 'extract_concepts') {
                            const names = (m.concepts as string[] | undefined) ?? [];
                            const rels = (m.relations as Array<{from: string; to: string; relation: string}> | undefined) ?? [];
                            const fs = m.finding_summary as string | undefined;
                            return (
                              <div className="space-y-1 text-sm">
                                <p className="text-text-secondary">
                                  {m.concept_count as number} concepts{(m.relation_count as number) > 0 && `, ${m.relation_count as number} relations`} · from finding
                                </p>
                                {fs && <p className="pl-2 italic text-text-muted/80 truncate">"{fs}"</p>}
                                {names.length > 0 && (
                                  <div className="flex flex-wrap gap-1 pl-2">
                                    {names.map((n, i) => (
                                      <span key={i} className="px-1 py-0.5 rounded bg-bg-tertiary text-sm text-purple-400/90 border border-border-primary/40">{n}</span>
                                    ))}
                                  </div>
                                )}
                                {rels.length > 0 && (
                                  <div className="space-y-0 pl-2">
                                    {rels.map((r, i) => (
                                      <p key={i} className="text-sm text-text-muted/80 truncate">
                                        {r.from} <span className="text-text-muted/50">—{r.relation}→</span> {r.to}
                                      </p>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          }
                          if (m.decision === 'summarize_thread') {
                            const title = m.title as string | null;
                            const raw = m.raw_output as string | undefined;
                            const q = m.query as string | undefined;
                            const acc = m.accepted as boolean;
                            return (
                              <div className="space-y-0.5 text-sm">
                                {q && <p className="text-text-muted truncate">query: <span className="text-text-secondary">{q}</span></p>}
                                {acc && title
                                  ? <p className="text-text-primary">title: <span className="font-mono">{title}</span></p>
                                  : <p className="text-error/80">rejected{raw && `: "${raw}"`}</p>}
                              </div>
                            );
                          }
                          if (m.decision === 'synthesis') {
                            const summary = m.summary as string | undefined;
                            const preview = m.content_preview as string | undefined;
                            if (!summary && !preview) return null;
                            return (
                              <div className="space-y-0.5 text-sm">
                                {summary && <p className="text-text-primary">{summary}</p>}
                                {preview && preview !== summary && (
                                  <p className="text-text-secondary/80 line-clamp-3">{preview}</p>
                                )}
                              </div>
                            );
                          }
                          if (m.decision === 'enumerate_canon') {
                            const items = (m.items as Array<{ item: string; context: string }> | undefined) ?? [];
                            const hint = typeof m.shape_hint === 'string' ? m.shape_hint : '';
                            return (
                              <div className="space-y-1 text-sm">
                                <p className="text-text-secondary">
                                  enumerated {items.length} canonical item{items.length === 1 ? '' : 's'}
                                  {hint && <> · shape: <span className="font-mono text-text-muted">{hint}</span></>}
                                </p>
                                <div className="space-y-0.5 pl-2">
                                  {items.map((it, i) => (
                                    <div key={i} className="flex gap-2 items-baseline">
                                      <span className="text-purple-400/90 shrink-0">{it.item}</span>
                                      {it.context && <span className="text-text-muted/80 truncate">— {it.context}</span>}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          }
                          if (m.decision === 'enumerate_canon_failed') {
                            const reason = typeof m.reason === 'string' ? m.reason : 'unknown';
                            const parseErr = typeof m.parse_error === 'string' ? m.parse_error : null;
                            const slice = typeof m.slice_excerpt === 'string' ? m.slice_excerpt : null;
                            const rawCount = typeof m.raw_count === 'number' ? m.raw_count : null;
                            const hint = typeof m.shape_hint === 'string' ? m.shape_hint : '';
                            return (
                              <div className="space-y-1 text-sm">
                                <p className="text-error/90">canon enumeration failed: <span className="text-text-secondary">{reason}</span></p>
                                {hint && <p className="text-text-muted">shape: <span className="font-mono">{hint}</span></p>}
                                {rawCount != null && <p className="text-text-muted">raw items returned: {rawCount}</p>}
                                {parseErr && (
                                  <div>
                                    <p className="text-text-muted text-sm font-mono">parse error</p>
                                    <p className="text-error/80 font-mono whitespace-pre-wrap break-words">{parseErr}</p>
                                  </div>
                                )}
                                {slice && (
                                  <div>
                                    <p className="text-text-muted text-sm font-mono">response excerpt</p>
                                    <p className="text-text-secondary/80 font-mono whitespace-pre-wrap break-words">{slice}</p>
                                  </div>
                                )}
                              </div>
                            );
                          }
                          if (m.decision === 'coverage_check') {
                            const slots = (m.slots as Array<{ thread_id: string; item: string; finding_count: number; covered: boolean }> | undefined) ?? [];
                            const covered = m.covered_count as number ?? 0;
                            const total = m.total_count as number ?? 0;
                            const allCovered = total > 0 && covered === total;
                            return (
                              <div className="space-y-1 text-sm">
                                <p className={allCovered ? 'text-success' : covered > 0 ? 'text-warning' : 'text-text-muted'}>
                                  canon coverage: {covered}/{total} slots have findings
                                </p>
                                <div className="space-y-0.5 pl-2">
                                  {slots.map((slot, i) => (
                                    <div key={i} className={clsx('flex gap-2 items-baseline', slot.covered ? 'text-text-secondary' : 'text-text-muted/60')}>
                                      <span className="shrink-0">{slot.covered ? '✓' : '○'}</span>
                                      <span className="truncate flex-1">{slot.item}</span>
                                      <span className="font-mono shrink-0 text-sm text-text-muted">{slot.finding_count} finding{slot.finding_count === 1 ? '' : 's'}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          }
                          if (m.decision === 'select_perturbation') {
                            const strategy = typeof m.strategy === 'string' ? m.strategy : 'unknown';
                            const trigger = typeof m.trigger === 'string' ? m.trigger : 'probabilistic';
                            const candidates = (m.candidates as Array<{ strategy: string; weight: number }> | undefined) ?? [];
                            const cooldown = (m.cooldown_excluded as string[] | undefined) ?? [];
                            const signal = m.signal as Record<string, unknown> | undefined;
                            const sortedCands = [...candidates].sort((a, b) => b.weight - a.weight);
                            const fmtNum = (v: unknown) => typeof v === 'number' ? v.toFixed(2) : String(v ?? '');
                            return (
                              <div className="space-y-1 text-sm">
                                <p className="text-text-secondary">
                                  selected <span className="text-blue-400 font-mono">{strategy}</span>
                                  {' '}via <span className={trigger === 'probabilistic' ? 'text-text-muted' : 'text-warning'}>{trigger.replace(/_/g, ' ')}</span> trigger
                                </p>
                                {signal && Object.keys(signal).length > 0 && (
                                  <div className="pl-2 flex flex-wrap gap-x-3 gap-y-0.5 text-text-muted">
                                    {signal.rolling_avg_novelty != null && <span>avg novelty {fmtNum(signal.rolling_avg_novelty)}</span>}
                                    {signal.threshold != null && <span>threshold {fmtNum(signal.threshold)}</span>}
                                    {signal.window != null && <span>window {String(signal.window)}</span>}
                                    {typeof signal.dominant_tag === 'string' && signal.dominant_tag && <span>dominant tag <span className="font-mono text-text-secondary">{signal.dominant_tag}</span></span>}
                                    {signal.dominant_ratio != null && <span>ratio {fmtNum(signal.dominant_ratio)}</span>}
                                    {signal.canon_covered != null && signal.canon_total != null && (
                                      <span>canon {String(signal.canon_covered)}/{String(signal.canon_total)}</span>
                                    )}
                                  </div>
                                )}
                                {sortedCands.length > 0 && (
                                  <div className="space-y-0.5 pl-2">
                                    <p className="text-text-muted text-sm font-mono">candidates (weight)</p>
                                    {sortedCands.map((c, i) => (
                                      <div key={i} className={clsx('flex gap-2 items-baseline', c.strategy === strategy ? 'text-text-primary' : 'text-text-muted/80')}>
                                        <span className="shrink-0">{c.strategy === strategy ? '→' : ' '}</span>
                                        <span className="font-mono flex-1 truncate">{c.strategy}</span>
                                        <span className="font-mono shrink-0 text-sm">{c.weight.toFixed(2)}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {cooldown.length > 0 && (
                                  <div className="pl-2">
                                    <p className="text-text-muted text-sm font-mono">cooldown excluded</p>
                                    <p className="text-text-muted/70 font-mono pl-2">{cooldown.join(', ')}</p>
                                  </div>
                                )}
                              </div>
                            );
                          }
                          if (m.decision === 'perturbation_rejected') {
                            const strategy = typeof m.strategy === 'string' ? m.strategy : 'unknown';
                            const trigger = typeof m.trigger === 'string' ? m.trigger : '';
                            const attempted = typeof m.attempted_query === 'string' ? m.attempted_query : '';
                            const retry = typeof m.retry_query === 'string' ? m.retry_query : null;
                            const sim = typeof m.similarity === 'number' ? m.similarity : null;
                            const floor = typeof m.floor === 'number' ? m.floor : null;
                            const reason = typeof m.reason === 'string' ? m.reason : '';
                            return (
                              <div className="space-y-1 text-sm">
                                <p className="text-error/90">
                                  rejected <span className="font-mono text-blue-400/80">{strategy}</span>
                                  {trigger && <> ({trigger.replace(/_/g, ' ')})</>}
                                  {reason && <span className="text-text-secondary"> — {reason}</span>}
                                </p>
                                {sim != null && floor != null && (
                                  <p className="text-text-muted font-mono">
                                    similarity {sim.toFixed(3)} &lt; floor {floor.toFixed(3)}
                                  </p>
                                )}
                                {attempted && (
                                  <div>
                                    <p className="text-text-muted text-sm font-mono">attempted query</p>
                                    <p className="text-text-secondary pl-2 italic">"{attempted}"</p>
                                  </div>
                                )}
                                {retry && (
                                  <div>
                                    <p className="text-text-muted text-sm font-mono">retry query</p>
                                    <p className="text-text-secondary pl-2 italic">"{retry}"</p>
                                  </div>
                                )}
                              </div>
                            );
                          }
                          if (m.decision === 'perturbation_rate_limited') {
                            const trigger = typeof m.trigger === 'string' ? m.trigger : '';
                            const reason = typeof m.reason === 'string' ? m.reason : '';
                            const recent = m.recent_perturbations as number ?? 0;
                            const window = m.window as number ?? 0;
                            return (
                              <div className="space-y-0.5 text-sm">
                                <p className="text-warning">
                                  rate-limited
                                  {trigger && <> — <span className="font-mono">{trigger.replace(/_/g, ' ')}</span> trigger</>}
                                </p>
                                <p className="text-text-muted">
                                  {recent} perturbation{recent === 1 ? '' : 's'} in the last {window} step{window === 1 ? '' : 's'}
                                </p>
                                {reason && <p className="text-text-secondary italic">{reason}</p>}
                              </div>
                            );
                          }
                          return null;
                        })()}
                        {(() => {
                          const m = s.metadata;
                          if (!m) return null;
                          const hasDecisionBlock = m.decision === 'gap_analysis' || m.decision === 'synthesis'
                            || m.decision === 'dedup' || m.decision === 'follow_up_eval'
                            || m.decision === 'formulate_queries' || m.decision === 'extract_concepts'
                            || m.decision === 'summarize_thread' || m.decision === 'enumerate_canon'
                            || m.decision === 'enumerate_canon_failed' || m.decision === 'coverage_check'
                            || m.decision === 'select_perturbation' || m.decision === 'perturbation_rejected'
                            || m.decision === 'perturbation_rate_limited';
                          if (hasDecisionBlock) return null;
                          const input = typeof m.input_excerpt === 'string' ? m.input_excerpt : null;
                          const output = typeof m.output_excerpt === 'string' ? m.output_excerpt : null;
                          if (!input && !output) return null;
                          return (
                            <div className="space-y-1 text-sm mt-1">
                              {input && (
                                <div className="space-y-0.5">
                                  <p className="text-text-muted text-sm font-mono">prompt</p>
                                  <p className="text-text-secondary whitespace-pre-wrap break-words">{input}</p>
                                </div>
                              )}
                              {output && (
                                <div className="space-y-0.5">
                                  <p className="text-text-muted text-sm font-mono">result</p>
                                  <p className="text-text-primary whitespace-pre-wrap break-words">{output}</p>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                        {s.error && (
                          <div className="mt-1 p-2 rounded bg-error/8 border border-error/20">
                            <p className="text-sm font-mono text-error break-words whitespace-pre-wrap">{s.error}</p>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  {ev.type === 'finding' && (() => {
                    const f = ev.payload;
                    const srcMeta = f.source_url_meta?.length ? f.source_url_meta : f.source_urls.map(u => ({ url: u, title: '', snippet: '' }));
                    return (
                      <div className="space-y-1.5">
                        <div className="text-sm text-text-primary leading-relaxed prose prose-sm prose-invert max-w-none">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{f.content}</ReactMarkdown>
                        </div>
                        <div className="flex items-center gap-3 text-sm font-mono flex-wrap">
                          {f.kind === 'perturbation' && (
                            <span
                              className="px-1.5 py-0.5 rounded bg-orange-400/15 text-orange-300 text-xs"
                              title="Perturbation: an adjacent perspective from a creativity-injection thread"
                            >perturbation</span>
                          )}
                          {f.kind === 'speculation' && (
                            <span
                              className="px-1.5 py-0.5 rounded bg-yellow-400/15 text-yellow-300 text-xs"
                              title="Speculation: forward-looking content; confidence capped at 0.5"
                            >speculation</span>
                          )}
                          <span className={f.confidence >= 0.7 ? 'text-success' : f.confidence >= 0.4 ? 'text-warning' : 'text-error'}>
                            conf {(f.confidence * 100).toFixed(0)}%
                          </span>
                          <span className="text-blue-400">novel {(f.novelty * 100).toFixed(0)}%</span>
                          <span className="text-text-muted">act {(f.actionability * 100).toFixed(0)}%</span>
                        </div>
                        {srcMeta.length > 0 && (
                          <div className="space-y-0.5">
                            {srcMeta.map((src, si) => {
                              let host = src.url; try { host = new URL(src.url).hostname; } catch { /* keep */ }
                              return (
                                <a key={si} href={src.url} target="_blank" rel="noopener noreferrer"
                                  onClick={e => e.stopPropagation()}
                                  className="block text-sm text-accent hover:underline truncate">
                                  {src.title || host}
                                </a>
                              );
                            })}
                          </div>
                        )}
                        {f.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {f.tags.map(tag => (
                              <span key={tag} className="px-1 py-0.5 rounded bg-bg-tertiary text-sm text-text-muted">{tag}</span>
                            ))}
                          </div>
                        )}
                        {f.follow_up_analysis && (
                          <div className="space-y-1 pt-1 border-t border-border-primary/30">
                            <p className="text-sm font-semibold uppercase tracking-wider text-text-muted">
                              Follow-up candidates · threshold {(f.follow_up_analysis.similarity_threshold * 100).toFixed(0)}%
                              {f.follow_up_analysis.retry_count > 0 && ` · ${f.follow_up_analysis.retry_count} retries`}
                            </p>
                            {f.follow_up_analysis.candidates.map((c, ci) => (
                              <div key={ci} className="flex items-start gap-2">
                                <span className={clsx('text-sm font-mono shrink-0 mt-0.5', c.accepted ? 'text-success' : 'text-error')}>
                                  {c.accepted ? '✓' : '✗'}
                                </span>
                                <span className={clsx('text-sm flex-1', c.accepted ? 'text-text-primary' : 'text-text-muted')}>{c.text}</span>
                                <span className="text-sm font-mono text-text-muted shrink-0">
                                  q:{(c.quality_score * 100).toFixed(0)}% r:{(c.rank_score * 100).toFixed(0)}%
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  {ev.type === 'thread' && (() => {
                    const t = ev.payload;
                    return (
                      <div className="space-y-1 text-sm text-text-muted">
                        <p className="text-text-secondary">{t.query}</p>
                        <div className="flex items-center gap-3">
                          <span>depth <span className="font-mono">{t.depth}/{t.max_depth}</span></span>
                          <span>priority <span className="font-mono">{t.priority.toFixed(2)}</span></span>
                          <span className={clsx('px-1 py-0.5 rounded text-sm', liveOriginColor[t.origin] ?? 'bg-bg-tertiary text-text-muted')}>
                            {t.origin.replace(/_/g, ' ')}
                          </span>
                          {t.perturbation_strategy && (
                            <span className="text-orange-400/70">{t.perturbation_strategy.replace(/_/g, ' ')}</span>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          );
        })}
        {isRunning && (
          <div className="flex items-center gap-2 px-3 py-1.5 text-sm text-success font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
            <span>running</span>
            <span className="text-text-muted ml-2">{events.length} events · {findings.length} findings</span>
          </div>
        )}
      </div>
    </div>
  );
}
