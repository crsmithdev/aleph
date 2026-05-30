import { nanoid } from 'nanoid';
import type { Db } from '@aleph/data';
import type { EventBus, AppEvent } from './event-bus.js';
import { historyLogs } from '../schema.js';
import { eq, desc } from 'drizzle-orm';

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

export function getHistory(db: Db, goalId: string) {
  const logs = db
    .select()
    .from(historyLogs)
    .where(eq(historyLogs.goalId, goalId))
    .orderBy(desc(historyLogs.createdAt))
    .all();

  return logs.map((log) => ({
    ...log,
    details: JSON.parse(log.details),
  }));
}
