import type { Frequency } from '../constants.js';

export function getPeriodKey(date: Date, frequency: Frequency): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  switch (frequency) {
    case 'daily':
      return `${year}-${month}-${day}`;
    case 'weekly': {
      const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
      const dayNum = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
      return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
    }
    case 'monthly':
      return `${year}-${month}`;
  }
}

export function getPreviousPeriodKey(date: Date, frequency: Frequency): string {
  const prev = new Date(date);
  switch (frequency) {
    case 'daily':
      prev.setDate(prev.getDate() - 1);
      break;
    case 'weekly':
      prev.setDate(prev.getDate() - 7);
      break;
    case 'monthly':
      prev.setMonth(prev.getMonth() - 1);
      break;
  }
  return getPeriodKey(prev, frequency);
}

/** Returns the last `n` period keys ending at `date`, oldest first. */
export function getRecentPeriodKeys(date: Date, frequency: Frequency, n: number): string[] {
  const out: string[] = [];
  const cursor = new Date(date);
  for (let i = 0; i < n; i++) {
    out.push(getPeriodKey(cursor, frequency));
    switch (frequency) {
      case 'daily': cursor.setDate(cursor.getDate() - 1); break;
      case 'weekly': cursor.setDate(cursor.getDate() - 7); break;
      case 'monthly': cursor.setMonth(cursor.getMonth() - 1); break;
    }
  }
  return out.reverse();
}
