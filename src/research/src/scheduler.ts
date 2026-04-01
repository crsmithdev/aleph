import type { SessionConfig } from './types.js';

export interface ScheduleWindow {
  days: string[];
  start: string; // HH:MM
  end: string;   // HH:MM
}

/**
 * Check if the current time falls within any active window.
 */
export function isInActiveWindow(
  windows: ScheduleWindow[],
  timezone: string,
  now?: Date
): boolean {
  if (windows.length === 0) return true; // No windows = always active

  const date = now ?? new Date();

  // Get day and time in the configured timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const dayName = parts.find(p => p.type === 'weekday')?.value?.toLowerCase() ?? '';
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0');
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0');
  const currentMinutes = hour * 60 + minute;

  for (const window of windows) {
    if (!window.days.includes(dayName)) continue;

    const [startH, startM] = window.start.split(':').map(Number);
    const [endH, endM] = window.end.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    if (startMinutes <= endMinutes) {
      // Normal window (e.g., 09:00-17:00)
      if (currentMinutes >= startMinutes && currentMinutes < endMinutes) return true;
    } else {
      // Overnight window (e.g., 23:00-06:00)
      if (currentMinutes >= startMinutes || currentMinutes < endMinutes) return true;
    }
  }

  return false;
}

/**
 * Calculate milliseconds until the next active window opens.
 */
export function msUntilNextWindow(
  windows: ScheduleWindow[],
  timezone: string,
  now?: Date
): number | null {
  if (windows.length === 0) return null;

  const date = now ?? new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const dayName = parts.find(p => p.type === 'weekday')?.value?.toLowerCase() ?? '';
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0');
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0');
  const currentMinutes = hour * 60 + minute;

  const dayOrder = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const currentDayIndex = dayOrder.indexOf(dayName);

  let minMs = Infinity;

  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const checkDayIndex = (currentDayIndex + dayOffset) % 7;
    const checkDay = dayOrder[checkDayIndex];

    for (const window of windows) {
      if (!window.days.includes(checkDay)) continue;

      const [startH, startM] = window.start.split(':').map(Number);
      const startMinutes = startH * 60 + startM;

      let minutesUntil: number;
      if (dayOffset === 0 && startMinutes > currentMinutes) {
        minutesUntil = startMinutes - currentMinutes;
      } else if (dayOffset > 0) {
        minutesUntil = dayOffset * 24 * 60 + startMinutes - currentMinutes;
      } else {
        continue; // Already past this window today
      }

      const ms = minutesUntil * 60 * 1000;
      if (ms < minMs) minMs = ms;
    }
  }

  return minMs === Infinity ? null : minMs;
}

/**
 * Rate limiter for steps per hour.
 */
export class StepRateLimiter {
  private timestamps: number[] = [];
  private maxPerHour: number;

  constructor(maxPerHour: number) {
    this.maxPerHour = maxPerHour;
  }

  canProceed(): boolean {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    this.timestamps = this.timestamps.filter(t => t > oneHourAgo);
    return this.timestamps.length < this.maxPerHour;
  }

  record(): void {
    this.timestamps.push(Date.now());
  }

  msUntilNextSlot(): number {
    if (this.canProceed()) return 0;
    const oldest = this.timestamps[0];
    return oldest + 60 * 60 * 1000 - Date.now();
  }
}

/**
 * Heartbeat tracker for daemon mode.
 */
export class Heartbeat {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private lastBeat = 0;
  private callback: () => void;

  constructor(callback: () => void) {
    this.callback = callback;
  }

  start(intervalMs = 60_000): void {
    this.beat();
    this.intervalId = setInterval(() => this.beat(), intervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private beat(): void {
    this.lastBeat = Date.now();
    this.callback();
  }

  isAlive(maxStalenessMs = 120_000): boolean {
    return Date.now() - this.lastBeat < maxStalenessMs;
  }

  getLastBeat(): number {
    return this.lastBeat;
  }
}
