// Local time, not UTC. `toISOString` stamps the UTC date, so west of Greenwich
// every issue filed in the evening carried tomorrow's date.
export const today = (d = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
