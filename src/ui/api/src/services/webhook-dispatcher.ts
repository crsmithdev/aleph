import { createHmac } from 'crypto';
import type { EventBus, AppEvent } from '@construct/goals';
import type { Db } from '@construct/data';
import { webhooks } from '../db/schema.js';

export class WebhookDispatcher {
  constructor(private db: Db, private eventBus: EventBus) {}

  start() {
    this.eventBus.onMutation((event: AppEvent) => {
      this.dispatch(event).catch((err) => {
        console.error('[WebhookDispatcher] dispatch error:', err);
      });
    });
  }

  private async dispatch(event: AppEvent) {
    const allWebhooks = this.db
      .select()
      .from(webhooks)
      .all()
      .filter((w) => {
        if (!w.active) return false;
        try {
          const events: string[] = JSON.parse(w.events);
          return events.includes(event.type) || events.includes('*');
        } catch {
          return false;
        }
      });

    if (allWebhooks.length === 0) return;

    const payload = JSON.stringify({
      event: event.type,
      goalId: event.goalId,
      details: event.details,
      timestamp: event.timestamp,
    });

    await Promise.allSettled(
      allWebhooks.map((webhook) => this.sendWebhook(webhook, payload))
    );
  }

  private async sendWebhook(
    webhook: { id: string; url: string; secret: string | null },
    payload: string
  ) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'Construct-Webhook/1.0',
    };

    if (webhook.secret) {
      const sig = createHmac('sha256', webhook.secret).update(payload).digest('hex');
      headers['X-Construct-Signature'] = `sha256=${sig}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const res = await fetch(webhook.url, {
        method: 'POST',
        headers,
        body: payload,
        signal: controller.signal,
      });

      if (!res.ok) {
        console.warn(`[WebhookDispatcher] webhook ${webhook.id} returned ${res.status}`);
      }
    } catch (err) {
      console.error(`[WebhookDispatcher] failed to deliver to ${webhook.url}:`, err);
    } finally {
      clearTimeout(timeout);
    }
  }
}
