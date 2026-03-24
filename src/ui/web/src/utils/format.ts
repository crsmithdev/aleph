import { format, formatDistanceToNow, addDays as addDaysFn, subDays as subDaysFn } from 'date-fns';

export function shortDate(iso: string): string {
  // Handle sub-day bucket keys: YYYY-MM-DDTHH or YYYY-MM-DDTHH:MM
  if (iso.length > 10 && iso.includes('T')) {
    const d = new Date(iso.length === 13 ? iso + ':00' : iso);
    return format(d, 'MM-dd HH:mm');
  }
  return format(new Date(iso), 'MM-dd');
}

export function longDate(iso: string): string {
  return format(new Date(iso), 'MMM d, yyyy');
}

export function dateTime(iso: string): string {
  return format(new Date(iso), 'MMM d, yyyy h:mm a');
}

export function relativeTime(iso: string): string {
  return formatDistanceToNow(new Date(iso), { addSuffix: true });
}

export function toDateStr(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}

export function addDays(dateStr: string, n: number): string {
  return toDateStr(addDaysFn(new Date(dateStr), n));
}

export function subDays(dateStr: string, n: number): string {
  return toDateStr(subDaysFn(new Date(dateStr), n));
}

export function fmtNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

export function fmtCurrency(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

export function fmtMs(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}s`;
  return `${Math.round(n)}ms`;
}

export function granLabel(granularity: string, noun: string): string {
  switch (granularity) {
    case 'minute': return `${noun} per Minute`;
    case 'hour': return `Hourly ${noun}`;
    default: return `Daily ${noun}`;
  }
}

export function rangeToDays(range: string): number {
  switch (range) {
    case '1h': return 1;
    case '1d': return 1;
    case '7d': return 7;
    case '30d': return 30;
    default: return 1;
  }
}
