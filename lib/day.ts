// Local time, not UTC. `toISOString` stamps the UTC date, so west of Greenwich
// every issue filed in the evening carried tomorrow's date.
export const today = (d = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The local date `n` calendar days before `from`. Noon keeps a DST change from moving it, which `n` times 24 hours of ms does not. */
export const daysAgo = (n: number, from = new Date()): string => today(new Date(from.getFullYear(), from.getMonth(), from.getDate() - n, 12));
