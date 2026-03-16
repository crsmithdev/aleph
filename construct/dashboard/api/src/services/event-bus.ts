import { EventEmitter } from 'events';
import type { HistoryEvent } from '@goal-tracker/shared';

export interface AppEvent {
  type: HistoryEvent;
  goalId: string;
  details: Record<string, unknown>;
  timestamp: string;
}

export class EventBus extends EventEmitter {
  emitMutation(data: AppEvent): boolean {
    return super.emit('mutation', data);
  }

  onMutation(listener: (data: AppEvent) => void): this {
    return super.on('mutation', listener);
  }
}
