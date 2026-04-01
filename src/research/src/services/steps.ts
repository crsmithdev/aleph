import type { Sqlite } from '@construct/data';
import { nanoid } from 'nanoid';
import type { ResearchStep, ToolCallRecord } from '../types.js';

function rowToStep(row: Record<string, unknown>): ResearchStep {
  return {
    ...row,
    tool_calls: JSON.parse(row.tool_calls as string),
  } as unknown as ResearchStep;
}

export function createStep(
  sqlite: Sqlite,
  params: {
    thread_id: string;
    session_id: string;
    finding_id?: string | null;
    model: string;
    provider?: string;
    prompt_tokens: number;
    completion_tokens: number;
    cost_usd: number;
    tool_calls?: ToolCallRecord[];
    duration_ms: number;
    error?: string | null;
  }
): ResearchStep {
  const id = nanoid();
  const now = new Date().toISOString();

  sqlite.prepare(`
    INSERT INTO research_steps
      (id, thread_id, session_id, finding_id, model, provider,
       prompt_tokens, completion_tokens, cost_usd, tool_calls, duration_ms, error, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    params.thread_id,
    params.session_id,
    params.finding_id ?? null,
    params.model,
    params.provider ?? 'anthropic',
    params.prompt_tokens,
    params.completion_tokens,
    params.cost_usd,
    JSON.stringify(params.tool_calls ?? []),
    params.duration_ms,
    params.error ?? null,
    now
  );

  return getStep(sqlite, id)!;
}

export function getStep(sqlite: Sqlite, id: string): ResearchStep | null {
  const row = sqlite.prepare('SELECT * FROM research_steps WHERE id = ?').get(id) as Record<string, unknown> | null;
  return row ? rowToStep(row) : null;
}

export function listSteps(sqlite: Sqlite, sessionId: string, opts?: { threadId?: string; limit?: number }): ResearchStep[] {
  let sql = 'SELECT * FROM research_steps WHERE session_id = ?';
  const params: unknown[] = [sessionId];

  if (opts?.threadId) {
    sql += ' AND thread_id = ?';
    params.push(opts.threadId);
  }

  sql += ' ORDER BY created_at DESC';

  if (opts?.limit) {
    sql += ' LIMIT ?';
    params.push(opts.limit);
  }

  return (sqlite.prepare(sql).all(...params) as Record<string, unknown>[]).map(rowToStep);
}

export function getStepCosts(sqlite: Sqlite, sessionId: string): {
  total_cost: number;
  total_steps: number;
  by_model: Record<string, { cost: number; steps: number; tokens: number }>;
} {
  const rows = sqlite.prepare(`
    SELECT model,
           SUM(cost_usd) as cost,
           COUNT(*) as steps,
           SUM(prompt_tokens + completion_tokens) as tokens
    FROM research_steps WHERE session_id = ?
    GROUP BY model
  `).all(sessionId) as { model: string; cost: number; steps: number; tokens: number }[];

  const byModel: Record<string, { cost: number; steps: number; tokens: number }> = {};
  let totalCost = 0;
  let totalSteps = 0;

  for (const row of rows) {
    byModel[row.model] = { cost: row.cost, steps: row.steps, tokens: row.tokens };
    totalCost += row.cost;
    totalSteps += row.steps;
  }

  return { total_cost: totalCost, total_steps: totalSteps, by_model: byModel };
}
