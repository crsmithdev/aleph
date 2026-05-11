// Pure formatting helpers for the research event log.
// Extracted so they can be unit-tested without React/DOM.
import type { ResearchStep, StreamEvent, ResearchFinding } from '../../api/research-hooks';

export type Chip = { text: string; color: string; meta?: boolean };

export const RENDER_WINDOW = 500;
export const THREAD_PALETTE = ['#c792ea', '#82aaff', '#c3e88d', '#89ddff', '#ffcb6b', '#f78c6c', '#f07178', '#b2ccd6'];

function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function firstSentence(s: string): string {
  const trimmed = s.trim();
  const m = trimmed.match(/^(.+?[.!?])(\s|$)/);
  return (m ? m[1] : trimmed).slice(0, 160);
}

export function stepChips(s: ResearchStep): Chip[] {
  const chips: Chip[] = [];
  const shortModel = s.model.includes('/') ? s.model.split('/').pop()! : s.model;
  chips.push({ text: shortModel, color: 'text-text-muted', meta: true });
  const tok = s.prompt_tokens + s.completion_tokens;
  if (tok > 0) chips.push({ text: fmtTokens(tok), color: 'text-text-muted', meta: true });
  if (s.cost_usd > 0) chips.push({ text: `$${s.cost_usd.toFixed(5)}`, color: 'text-text-muted', meta: true });
  const m = s.metadata;
  if (m) {
    if (m.decision === 'gap_analysis') {
      const hasGaps = m.has_gaps as boolean;
      const gapCount = m.gap_count as number;
      const gapMax = m.gap_max as number | undefined;
      const gapText = hasGaps ? (gapMax != null ? `${gapCount}/${gapMax} gaps` : `${gapCount} gaps`) : 'no gaps';
      chips.push({ text: gapText, color: hasGaps ? 'text-warning' : 'text-text-muted' });
    } else if (m.decision === 'synthesis') {
      chips.push({ text: `confidence ${((m.confidence as number) * 100).toFixed(0)}%`, color: 'text-success' });
      chips.push({ text: `novelty ${((m.novelty as number) * 100).toFixed(0)}%`, color: 'text-blue-400' });
    } else if (m.decision === 'dedup') {
      const dup = m.is_duplicate as boolean;
      chips.push({ text: dup ? 'duplicate' : 'unique', color: dup ? 'text-error' : 'text-success' });
      chips.push({ text: `vs ${m.existing_count as number} existing`, color: 'text-text-muted' });
    } else if (m.decision === 'follow_up_eval') {
      chips.push({ text: `${m.accepted_count as number} accepted`, color: 'text-success' });
      chips.push({ text: `${m.rejected_count as number} rejected`, color: 'text-error/70' });
      const mc = m.method_counts as Record<string, number> | undefined;
      if (mc) {
        const parts: string[] = [];
        if (mc.jaccard) parts.push(`${mc.jaccard} jaccard`);
        if (mc.embedding) parts.push(`${mc.embedding} embedding`);
        if (mc.llm) parts.push(`${mc.llm} llm`);
        if (parts.length) chips.push({ text: parts.join(' · '), color: 'text-text-muted' });
      }
    } else if (m.decision === 'formulate_queries') {
      chips.push({ text: `${(m.queries as string[]).length} queries`, color: 'text-blue-400' });
    } else if (m.decision === 'extract_concepts') {
      const cc = m.concept_count as number ?? 0;
      const rc = m.relation_count as number ?? 0;
      chips.push({ text: `${cc} concepts`, color: 'text-purple-400' });
      if (rc > 0) chips.push({ text: `${rc} relations`, color: 'text-text-muted' });
    } else if (m.decision === 'summarize_thread') {
      if (!(m.accepted as boolean)) {
        chips.push({ text: 'rejected', color: 'text-error/70' });
      }
    } else if (m.decision === 'pick_role') {
      const roleLabel = typeof m.role_label === 'string' ? m.role_label : null;
      if (roleLabel) chips.push({ text: roleLabel, color: 'text-purple-400' });
    } else if (m.decision === 'enumerate_canon') {
      const target = m.target_count as number ?? 0;
      const hint = typeof m.shape_hint === 'string' ? m.shape_hint.split(' (')[0] : '';
      chips.push({ text: `${target} canon items`, color: 'text-purple-400' });
      if (hint) chips.push({ text: hint, color: 'text-text-muted' });
    } else if (m.decision === 'enumerate_canon_failed') {
      chips.push({ text: 'canon failed', color: 'text-error/70' });
      const reason = typeof m.reason === 'string' ? m.reason : '';
      if (reason) chips.push({ text: reason.slice(0, 40), color: 'text-text-muted' });
    } else if (m.decision === 'coverage_check') {
      const covered = m.covered_count as number ?? 0;
      const total = m.total_count as number ?? 0;
      const allCovered = total > 0 && covered === total;
      chips.push({
        text: `canon ${covered}/${total}`,
        color: allCovered ? 'text-success' : covered > 0 ? 'text-warning' : 'text-text-muted',
      });
    } else if (m.decision === 'select_perturbation') {
      const strategy = typeof m.strategy === 'string' ? m.strategy : 'unknown';
      const trigger = typeof m.trigger === 'string' ? m.trigger : 'probabilistic';
      chips.push({ text: strategy, color: 'text-blue-400' });
      const triggerColor = trigger === 'probabilistic' ? 'text-text-muted' : 'text-warning';
      chips.push({ text: trigger.replace(/_/g, ' '), color: triggerColor });
    } else if (m.decision === 'perturbation_rejected') {
      const sim = typeof m.similarity === 'number' ? m.similarity : null;
      const floor = typeof m.floor === 'number' ? m.floor : null;
      chips.push({ text: 'rejected', color: 'text-error/70' });
      if (sim != null && floor != null) {
        chips.push({ text: `sim ${sim.toFixed(2)} < ${floor.toFixed(2)}`, color: 'text-text-muted' });
      }
    } else if (m.decision === 'perturbation_rate_limited') {
      const trigger = typeof m.trigger === 'string' ? m.trigger : '';
      const recent = m.recent_perturbations as number ?? 0;
      const window = m.window as number ?? 0;
      chips.push({ text: 'rate-limited', color: 'text-warning' });
      if (trigger) chips.push({ text: trigger.replace(/_/g, ' '), color: 'text-text-muted' });
      if (window) chips.push({ text: `${recent}/${window}`, color: 'text-text-muted' });
    }
  }
  if (!m?.decision || m.decision === 'pick_role') {
    const out = m && typeof m.output_excerpt === 'string' ? m.output_excerpt : null;
    if (out && out.trim()) {
      const trimmed = out.trim().replace(/\s+/g, ' ');
      const display = trimmed.length > 60 ? trimmed.slice(0, 60) + '…' : trimmed;
      if (m?.decision !== 'pick_role') {
        chips.push({ text: display, color: 'text-text-secondary' });
      }
    }
  }
  return chips;
}

export type FormattedEvent = { typeLabel: string; typeColor: string; detail: string; chips?: Chip[] };

export function formatEventDetail(ev: StreamEvent & { threadDiff?: string }): FormattedEvent | null {
  if (ev.type === 'finding') {
    const f = ev.payload as ResearchFinding;
    const chips: Chip[] = [
      { text: `confidence ${(f.confidence * 100).toFixed(0)}%`, color: f.confidence >= 0.7 ? 'text-success' : f.confidence >= 0.4 ? 'text-warning' : 'text-error' },
      { text: `novelty ${(f.novelty * 100).toFixed(0)}%`, color: 'text-blue-400' },
    ];
    return {
      typeLabel: 'finding',
      typeColor: 'text-success',
      detail: (f.summary || f.content).slice(0, 100) + ((f.summary || f.content).length > 100 ? '…' : ''),
      chips,
    };
  }
  if (ev.type === 'thread') {
    const t = ev.payload;
    const diff = ev.threadDiff;
    const name = t.short_query ?? t.query;
    if (diff && !diff.includes(' → ')) {
      if (diff === 'titled') return { typeLabel: 'named', typeColor: 'text-text-muted/70', detail: name };
      return { typeLabel: 'update', typeColor: 'text-text-muted', detail: `${name} · ${diff}` };
    }
    if (diff === 'paused → active') return { typeLabel: 'resume', typeColor: 'text-success/80', detail: name };
    const originTag = t.origin !== 'seed' ? ` [${t.origin.replace(/_/g, '·')} d${t.depth}]` : ` [d${t.depth}]`;
    if (t.status === 'active') return { typeLabel: 'start', typeColor: 'text-warning', detail: `${name}${originTag}` };
    if (t.status === 'queued') return { typeLabel: 'queue', typeColor: 'text-warning/70', detail: `${name}${originTag}` };
    if (t.status === 'pruned') return { typeLabel: 'prune', typeColor: 'text-error', detail: name };
    if (t.status === 'paused') return { typeLabel: 'pause', typeColor: 'text-warning/60', detail: name };
    if (t.status === 'exhausted') return { typeLabel: 'done', typeColor: 'text-text-muted', detail: name };
    if (t.status === 'deferred') return { typeLabel: 'defer', typeColor: 'text-text-muted', detail: `${name}${originTag}` };
    if (diff) return { typeLabel: 'update', typeColor: 'text-text-muted', detail: `${name} · ${diff}` };
    return null;
  }
  if (ev.type === 'step') {
    const s = ev.payload;
    const tools = s.tool_calls ?? [];
    const chips = stepChips(s);
    if (tools.length === 0) {
      const labelAliases: Record<string, string> = {
        'synthesize finding': 'synthesis',
        'synthesize findings': 'synthesis',
        'evaluate follow-ups': 'follow-ups',
        'summarize thread': 'thread-title',
        'dedup check': 'dedup',
        'dedup judge': 'dedup',
        'gap analysis': 'gap-analysis',
        'formulate': 'formulate',
        'extract concepts': 'concepts',
        'lead review': 'lead-review',
        'generate plan': 'plan',
        'generate lead section': 'lead-section',
        'generate document': 'document',
        'update summary': 'update-summary',
        'web search': 'web-search',
        'web search (failed)': 'search-fail',
        'empty search': 'empty-search',
        'iteration error': 'iter-error',
        'thread error': 'thread-error',
        'pick role': 'role-pick',
        'query title': 'query-title',
        'short title': 'short-title',
        'restate prompt': 'restate-prompt',
        'perturbation query': 'perturb-query',
      };
      const labelColors: Record<string, string> = {
        'gap-analysis': 'text-orange-400',
        'synthesis': 'text-purple-400',
        'dedup': 'text-text-muted',
        'follow-ups': 'text-teal-400',
        'thread-title': 'text-text-muted',
        'update-summary': 'text-text-muted',
        'formulate': 'text-blue-400',
        'concepts': 'text-purple-400',
        'lead-review': 'text-yellow-400',
        'plan': 'text-yellow-400',
        'lead-section': 'text-accent/70',
        'document': 'text-accent/70',
        'web-search': 'text-blue-400',
        'search-fail': 'text-error',
        'empty-search': 'text-text-muted',
        'iter-error': 'text-error',
        'thread-error': 'text-error',
        'role-pick': 'text-purple-400',
        'query-title': 'text-text-muted',
        'short-title': 'text-text-muted',
        'restate-prompt': 'text-text-muted',
        'perturb-query': 'text-orange-400',
      };
      const rawLbl = s.label ?? 'step';
      const isGenSection = rawLbl.startsWith('generate section:');
      const lbl = isGenSection ? 'section' : (labelAliases[rawLbl] ?? rawLbl);
      const color = isGenSection ? 'text-accent/70' : (labelColors[lbl] ?? 'text-accent/70');
      const m = s.metadata;
      let detail = '';
      if (m) {
        if (m.decision === 'synthesis' && typeof m.summary === 'string' && m.summary) {
          detail = firstSentence(m.summary);
        } else if (m.decision === 'extract_concepts' && Array.isArray(m.concepts)) {
          const names = (m.concepts as string[]).filter(n => typeof n === 'string');
          detail = names.length > 0
            ? names.slice(0, 4).join(', ') + (names.length > 4 ? ` +${names.length - 4}` : '')
            : '';
        } else if (m.decision === 'summarize_thread') {
          if (typeof m.title === 'string' && m.title) detail = m.title;
          else if (typeof m.raw_output === 'string') detail = m.raw_output;
        } else if (m.decision === 'follow_up_eval' && Array.isArray(m.candidates)) {
          const cands = m.candidates as Array<{ text: string; accepted: boolean; rank?: number; rank_score?: number }>;
          const top = cands.find(c => c.accepted) ?? cands[0];
          if (top && top.text) {
            const score = typeof top.rank_score === 'number' ? ` ${(top.rank_score * 100).toFixed(0)}%` : '';
            detail = `"${top.text.slice(0, 70)}${top.text.length > 70 ? '…' : ''}"${score}`;
          }
        } else if (m.decision === 'formulate_queries' && Array.isArray(m.queries) && m.queries.length > 0) {
          const q = (m.queries as string[])[0];
          if (q) detail = `"${q.slice(0, 80)}${q.length > 80 ? '…' : ''}"`;
        } else if (m.decision === 'gap_analysis') {
          if (Array.isArray(m.gap_queries) && (m.gap_queries as string[]).length > 0) {
            const gq = (m.gap_queries as string[])[0];
            detail = `"${gq.slice(0, 80)}${gq.length > 80 ? '…' : ''}"`;
          }
        } else if (m.decision === 'dedup' && typeof m.new_summary === 'string') {
          detail = firstSentence(m.new_summary);
        } else if (m.decision === 'pick_role' && typeof m.role_label === 'string') {
          detail = m.role_label as string;
        }
      }
      if (!detail && m && typeof m.output_excerpt === 'string' && m.output_excerpt.trim()) {
        const trimmed = m.output_excerpt.trim().replace(/\s+/g, ' ');
        if (isGenSection) {
          detail = rawLbl.replace(/^generate section:\s*/, '');
        } else {
          detail = firstSentence(trimmed);
        }
      }
      return { typeLabel: lbl, typeColor: color, detail, chips };
    }
    const first = tools[0];
    const tool = first.tool ?? 'step';
    const shortTool = tool.replace('web_search', 'search').replace('search_web', 'search').replace('fetch_url', 'fetch');
    let detail = '';
    if (tool === 'web_search' || tool === 'search_web' || tool === 'search') {
      const q = (first.input as Record<string, unknown>)?.query as string ?? '';
      detail = q ? `"${q.slice(0, 80)}"` : '';
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
    return { typeLabel: shortTool + (tools.length > 1 ? ` ×${tools.length}` : ''), typeColor, detail, chips };
  }
  return null;
}

/** Classify a stream event into one of the six event-log categories.
 *  Used by both the filter pill bar and the unit tests that assert
 *  every category renders. */
export type EventCategory = 'finding' | 'thread' | 'step' | 'search' | 'fetch' | 'error';

export function categorizeEvent(ev: StreamEvent): EventCategory | null {
  if (ev.type === 'finding') return 'finding';
  if (ev.type === 'thread') return 'thread';
  if (ev.type === 'step') {
    const s = ev.payload as ResearchStep;
    if (s.error) return 'error';
    const tools = s.tool_calls ?? [];
    if (tools.some(tc => tc.tool === 'web_search' || tc.tool === 'search_web' || tc.tool === 'search')) return 'search';
    if (tools.some(tc => tc.tool === 'fetch_url' || tc.tool === 'fetch')) return 'fetch';
    return 'step';
  }
  return null;
}
