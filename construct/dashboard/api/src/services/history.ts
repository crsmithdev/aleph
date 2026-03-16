import { nanoid } from 'nanoid';
import type { Db } from '../db/client.js';
import type { EventBus, AppEvent } from './event-bus.js';
import { historyLogs } from '../db/schema.js';

export class HistoryService {
  constructor(private db: Db, private eventBus: EventBus) {}

  start() {
    this.eventBus.onMutation((event: AppEvent) => {
      this.db.insert(historyLogs).values({
        id: nanoid(),
        goalId: event.goalId,
        eventType: event.type,
        details: JSON.stringify(event.details),
        createdAt: event.timestamp,
      }).run();
    });
  }
}
