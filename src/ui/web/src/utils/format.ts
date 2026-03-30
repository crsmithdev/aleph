import { format, formatDistanceToNow, addDays as addDaysFn, subDays as subDaysFn } from 'date-fns';

export function shortDate(iso: string): string {
  // Handle sub-day bucket keys: YYYY-MM-DDTHH or YYYY-MM-DDTHH:MM
  if (iso.length > 10 && iso.includes('T')) {
    if (iso.includes(':')) {
      // YYYY-MM-DDTHH:MM → "2:30pm"
      const d = new Date(iso);
      return format(d, 'h:mmaaa');
    }
    // YYYY-MM-DDTHH → "3/23 2pm"
    const d = new Date(iso + ':00');
    const month = d.getMonth() + 1;
    const day = d.getDate();
    return `${month}/${day} ${format(d, 'haaa')}`;
  }
  // YYYY-MM-DD → "3/23"
  const d = new Date(iso);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

export function longDate(iso: string): string {
  return format(new Date(iso), 'MMM d, yyyy');
}

export function dateTime(iso: string): string {
  const d = new Date(iso);
  const currentYear = new Date().getFullYear();
  if (d.getFullYear() === currentYear) {
    return format(d, 'MMM d, h:mmaaa');
  }
  return format(d, 'MMM d yyyy, h:mmaaa');
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

export function fmtToolName(name: string): string {
  if (name.startsWith('mcp__')) {
    const parts = name.slice(5).split('__');
    if (parts.length >= 2) {
      const server = parts[0];
      const action = parts.slice(1).join(' ').replace(/_/g, ' ');
      return `${server} / ${action}`;
    }
  }
  return name;
}

export function parseToolSource(name: string): { server: string; tool: string } {
  if (name.startsWith('mcp__')) {
    const parts = name.slice(5).split('__');
    if (parts.length >= 2) {
      return { server: parts[0], tool: parts.slice(1).join('_') };
    }
  }
  return { server: 'builtin', tool: name };
}

export function fmtProject(raw: string): string {
  // "-home-crsmi-construct" → "crsmi/construct"
  // Strip leading /home/<user>/ or -home-<user>- prefix, then join with /
  const cleaned = raw.replace(/^-/, '').replace(/^home-/, '');
  const parts = cleaned.split('-').filter(Boolean);
  if (parts.length >= 2) return parts.join('/');
  return raw;
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
