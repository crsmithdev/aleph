// The week's issue holds by kind, by the rule of monitor-table.ts holdRows (read-only).
// Run from the repo root: bun docs/mocks/status-panels/holds.ts > a file, then copy its rows into data.json issueHolds.
import { allHolds, stopsStart } from "../../../jobs/lib/gates/holds.ts";
const to = Date.parse("2026-11-20T16:47:00Z"), from = to - 7 * 86_400_000;
const by = new Map<string, any[]>();
for (const h of allHolds()) by.set(h.name, [...(by.get(h.name) ?? []), h]);
const rows = new Map<string, { records: number; issues: Set<string>; ms: number; stops: boolean }>();
const row = (k: string, h?: any) => { if (!rows.has(k)) rows.set(k, { records: 0, issues: new Set(), ms: 0, stops: false }); return rows.get(k)!; };
const held = new Set<string>();
for (const [name, list] of by) {
  list.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  list.forEach((h, i) => {
    const at = Date.parse(h.at);
    if (at >= from && at < to) { const r = row(h.kind); r.records++; r.issues.add(name); if (stopsStart(h)) { held.add(name); r.stops = true; } }
    const next = list[i + 1]; if (!next) return;
    const ms = Math.min(Date.parse(next.at), to) - Math.max(at, from); if (ms > 0) row(h.kind).ms += ms;
  });
}
const out = [...rows].filter(([, r]) => r.records).sort((a, b) => b[1].issues.size - a[1].issues.size).map(([kind, r]) => ({ kind, records: r.records, issues: r.issues.size, hours: +(r.ms / 3600_000).toFixed(1), stops: r.stops }));
console.log(JSON.stringify({ held: held.size, rows: out }));
