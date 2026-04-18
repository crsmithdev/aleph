import type { FastifyPluginAsync } from 'fastify';
import { getSummary, listHabits } from '@construct/goals';

const plus = `<span style="color:#6366f1;font-weight:700;font-size:12px;margin-right:6px;flex-shrink:0">+</span>`;
const check = `<span style="color:#22c55e;font-weight:700;font-size:12px;margin-right:6px;flex-shrink:0">✓</span>`;

function bulletList(items: string[], prefix: string) {
  if (items.length === 0) return '';
  return `<ul style="list-style:none;padding:6px 16px 10px;margin:0">
    ${items.map((t) => `<li style="display:flex;align-items:baseline;padding:5px 0;border-bottom:1px solid #f1f5f9;font-size:14px;color:#374151">${prefix}${t}</li>`).join('')}
  </ul>`;
}

function section(label: string, count: number, body: string) {
  return `<div style="background:white;border-radius:10px;box-shadow:0 1px 3px #0000000d;margin-bottom:16px;overflow:hidden">
    <div style="padding:12px 16px;border-bottom:1px solid #f1f5f9;font-weight:600;font-size:14px;color:#374151;background:#fafafa">
      ${label} <span style="font-weight:400;color:#9ca3af;font-size:13px">(${count})</span>
    </div>
    ${body}
  </div>`;
}

export const publicRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', async (req, reply) => {
    const now = new Date();
    const tzOffset = now.getTimezoneOffset();
    const dateStr = now.toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
    const summary = getSummary(app.db, dateStr, dateStr, tzOffset) as any;

    const habits = (listHabits(app.db) as any[]).filter((h: any) => h.active && h.completedThisPeriod);

    const goalsAdded: string[] = (summary.goalsCreated?.items ?? []).map((g: any) => g.title);
    const goalsCompleted: string[] = (summary.goalsCompleted?.items ?? []).map((g: any) => g.details?.title ?? g.goalId);
    const todosAdded: string[] = (summary.todosCreated?.items ?? []).map((t: any) => t.title);
    const todosFinished: string[] = (summary.todosCompleted?.items ?? []).map((t: any) => t.title);
    const habitsAdded: string[] = (summary.habitsCreated?.items ?? []).map((h: any) => h.title);
    const habitsFollowed: string[] = habits.map((h: any) => h.title);

    const dateDisplay = now.toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });

    const sections: string[] = [];

    if (goalsAdded.length > 0) sections.push(section('Goals added', goalsAdded.length, bulletList(goalsAdded, plus)));
    if (goalsCompleted.length > 0) sections.push(section('Goals completed', goalsCompleted.length, bulletList(goalsCompleted, check)));
    if (todosAdded.length > 0) sections.push(section('Todos added', todosAdded.length, bulletList(todosAdded, plus)));
    if (todosFinished.length > 0) sections.push(section('Todos finished', todosFinished.length, bulletList(todosFinished, check)));
    if (habitsAdded.length > 0) sections.push(section('Habits added', habitsAdded.length, bulletList(habitsAdded, plus)));
    if (habitsFollowed.length > 0) sections.push(section('Habits followed', habitsFollowed.length, bulletList(habitsFollowed, check)));

    const empty = sections.length === 0
      ? `<div style="color:#9ca3af;font-size:14px;padding:32px 0;text-align:center">Nothing recorded today yet.</div>`
      : '';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Summary — ${dateDisplay}</title>
  <style>* { box-sizing: border-box; margin: 0; padding: 0; } body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8fafc; color: #1e293b; }</style>
</head>
<body>
<div style="max-width:640px;margin:0 auto;padding:32px 16px">
  <h1 style="font-size:20px;font-weight:700;margin-bottom:4px">Summary</h1>
  <div style="color:#64748b;font-size:14px;margin-bottom:24px">${dateDisplay}</div>
  ${sections.join('')}${empty}
</div>
</body>
</html>`;

    reply.header('Content-Type', 'text/html; charset=utf-8');
    return reply.send(html);
  });
};
