// Local time, not UTC. `toISOString` stamps the UTC date, so west of Greenwich
// every issue filed in the evening carried tomorrow's date.
export const today = (d = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The local date `n` calendar days after `day` (YYYY-MM-DD). Noon keeps a DST change from moving it, which `n` times 24 hours of ms does not. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  return today(d);
}

/** The local date `n` calendar days before `from`. */
export const daysAgo = (n: number, from = new Date()): string => addDays(today(from), -n);

/** The local date before `now`. */
export const yesterday = (now: number): string => addDays(today(new Date(now)), -1);
