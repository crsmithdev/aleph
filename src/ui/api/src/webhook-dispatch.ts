import { eq } from 'drizzle-orm';
import { createDb } from '@aleph/data';
import { webhooks } from './db/schema.js';

type Db = ReturnType<typeof createDb>['db'];

export interface WebhookDelivery {
  id: string;
  url: string;
  status: number | 'error';
  ms: number;
}

export async function dispatchWebhooks(
  event: string,
  payload: unknown,
  db: Db,
): Promise<WebhookDelivery[]> {
  const rows = db.select().from(webhooks).where(eq(webhooks.active, true)).all();
  const targets = rows.filter(r => {
    try { return (JSON.parse(r.events) as string[]).includes(event); }
    catch { return false; }
  });

  if (targets.length === 0) return [];

  const body = JSON.stringify({ event, payload, ts: new Date().toISOString() });

  const results = await Promise.allSettled(
    targets.map(async (wh): Promise<WebhookDelivery> => {
      const start = Date.now();
      try {
        const res = await fetch(wh.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: AbortSignal.timeout(5000),
        });
        return { id: wh.id, url: wh.url, status: res.status, ms: Date.now() - start };
      } catch {
        return { id: wh.id, url: wh.url, status: 'error', ms: Date.now() - start };
      }
    }),
  );

  return results.map(r => (r.status === 'fulfilled' ? r.value : { id: '', url: '', status: 'error' as const, ms: 0 }));
}
