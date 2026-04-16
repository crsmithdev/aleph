import type { FastifyPluginAsync } from 'fastify';
import { listGoals, listHabits, getTodosActive } from '@construct/goals';

function badge(text: string, color: string) {
  return `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;background:${color}20;color:${color};border:1px solid ${color}40">${text}</span>`;
}

const PRIORITY_COLOR: Record<string, string> = {
  high: '#ef4444',
  medium: '#f59e0b',
  low: '#6b7280',
};

const STATE_COLOR: Record<string, string> = {
  active: '#22c55e',
  paused: '#f59e0b',
  completed: '#6366f1',
};

export const publicRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', async (req, reply) => {
    const goals = listGoals(app.db, { archived: 'false' }).filter(
      (g: any) => g.state !== 'canceled' && g.state !== 'completed'
    );
    const { active: todos } = getTodosActive(app.db) as { active: any[] };
    const habits = (listHabits(app.db) as any[]).filter((h: any) => h.active);

    const now = new Date().toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });

    const goalRows = goals.map((g: any) => {
      const cats = (g.categories || []).map((c: any) =>
        `<span style="display:inline-block;padding:1px 7px;border-radius:3px;font-size:11px;background:${c.color}22;color:${c.color};border:1px solid ${c.color}44">${c.name}</span>`
      ).join(' ');
      return `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9">${g.title}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9">${badge(g.state, STATE_COLOR[g.state] ?? '#6b7280')}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9">${badge(g.priority, PRIORITY_COLOR[g.priority] ?? '#6b7280')}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9">${cats}</td>
        </tr>`;
    }).join('');

    const todoItems = todos.map((t: any) =>
      `<li style="padding:6px 0;border-bottom:1px solid #f1f5f9;color:#374151">${t.title}${t.goalTitle ? ` <span style="color:#9ca3af;font-size:12px">↳ ${t.goalTitle}</span>` : ''}</li>`
    ).join('');

    const habitItems = habits.map((h: any) => {
      const done = h.completedThisPeriod;
      const dot = done
        ? `<span style="color:#22c55e;font-size:18px">●</span>`
        : `<span style="color:#e5e7eb;font-size:18px">●</span>`;
      return `<li style="padding:6px 0;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;gap:8px">${dot}<span style="color:#374151">${h.title}</span><span style="color:#9ca3af;font-size:12px">${h.frequency}</span></li>`;
    }).join('');

    const completedHabits = habits.filter((h: any) => h.completedThisPeriod);
    const completedHabitItems = completedHabits.map((h: any) =>
      `<li style="padding:6px 0;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;gap:8px"><span style="color:#22c55e;font-size:18px">●</span><span style="color:#374151">${h.title}</span></li>`
    ).join('');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Goals & Todos</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8fafc; color: #1e293b; }
    .container { max-width: 860px; margin: 0 auto; padding: 32px 16px; }
    h1 { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
    .date { color: #64748b; font-size: 14px; margin-bottom: 32px; }
    .section { background: white; border-radius: 10px; box-shadow: 0 1px 3px #0000000d; margin-bottom: 24px; overflow: hidden; }
    .section-header { padding: 14px 16px; border-bottom: 1px solid #f1f5f9; font-weight: 600; font-size: 14px; color: #374151; background: #fafafa; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th { padding: 8px 12px; text-align: left; font-size: 12px; color: #9ca3af; font-weight: 600; border-bottom: 1px solid #f1f5f9; }
    ul { list-style: none; padding: 8px 16px; font-size: 14px; }
  </style>
</head>
<body>
<div class="container">
  <h1>Goals &amp; Todos</h1>
  <div class="date">${now}</div>

  <div class="section">
    <div class="section-header">Goals (${goals.length})</div>
    <table>
      <thead><tr><th>Goal</th><th>State</th><th>Priority</th><th>Categories</th></tr></thead>
      <tbody>${goalRows || '<tr><td colspan="4" style="padding:16px;color:#9ca3af">No active goals</td></tr>'}</tbody>
    </table>
  </div>

  <div class="section">
    <div class="section-header">Todos (${todos.length})</div>
    <ul>${todoItems || '<li style="padding:12px 0;color:#9ca3af">No active todos</li>'}</ul>
  </div>

  <div class="section">
    <div class="section-header">Habits followed today (${completedHabits.length})</div>
    <ul>${completedHabitItems || '<li style="padding:12px 0;color:#9ca3af">None completed today</li>'}</ul>
  </div>

  <div class="section">
    <div class="section-header">All habits (${habits.length})</div>
    <ul>${habitItems || '<li style="padding:12px 0;color:#9ca3af">No habits</li>'}</ul>
  </div>
</div>
</body>
</html>`;

    reply.header('Content-Type', 'text/html; charset=utf-8');
    return reply.send(html);
  });
};
