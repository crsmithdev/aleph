import type { Granularity, TimeRange } from '../components/data/TimeRangeSelector';
import type { DatasetDisplayMode } from '../components/data/ChartControlChip';

export const GRAN_LABEL: Record<Granularity, string> = { minute: 'Per-Minute', hour: 'Hourly', day: 'Daily' };

export const RANGE_PHRASE: Record<TimeRange, string> = {
  'session': 'this session',
  '1h':      'last hour',
  '1d':      'last 24 hours',
  '7d':      'last 7 days',
  '30d':     'last 30 days',
};

export function fmtCalls(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

type DayRecord = { date: string; tools?: Record<string, number>; projects?: Record<string, number> };

export function rankedKeysFromRecord(days: DayRecord[], field: 'tools' | 'projects'): [string, number][] {
  const totals: Record<string, number> = {};
  for (const day of days) {
    for (const [k, v] of Object.entries((day as Record<string, unknown>)[field] as Record<string, number> ?? {})) {
      totals[k] = (totals[k] ?? 0) + v;
    }
  }
  return Object.entries(totals).sort((a, b) => b[1] - a[1]);
}

export function topKeysFromRecord(days: DayRecord[], field: 'tools' | 'projects', n: number, mode: DatasetDisplayMode): string[] {
  const ranked = rankedKeysFromRecord(days, field);
  if (mode === 'all') return ranked.map(([k]) => k);
  const top = ranked.slice(0, n).map(([k]) => k);
  if (mode === 'top-n-other' && ranked.length > n) top.push('Other');
  return top;
}

export function stackByDay<T extends { date: string }>(days: T[], keys: string[], field: 'tools' | 'projects', mode: DatasetDisplayMode): Record<string, unknown>[] {
  const hasOther = mode === 'top-n-other' && keys.includes('Other');
  const realKeys = keys.filter(k => k !== 'Other');
  return days.map(day => {
    const entry: Record<string, unknown> = { date: day.date };
    const source = (day as Record<string, unknown>)[field] as Record<string, number> ?? {};
    for (const k of realKeys) entry[k] = source[k] ?? 0;
    if (hasOther) {
      let other = 0;
      for (const [k, v] of Object.entries(source)) {
        if (!realKeys.includes(k)) other += v;
      }
      entry['Other'] = other;
    }
    return entry;
  });
}
