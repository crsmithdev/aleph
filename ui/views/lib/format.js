// Value to text: money, counts, percents, durations and times. No HTML and no DOM.

import { bare } from "../../../lib/models.ts";

const pad = (n) => String(n).padStart(2, "0");
/** "14:05" in local time, or "" for no time or a bad date. */
export const clock = (iso) => {
  const d = new Date(iso);
  if (iso == null || iso === "" || Number.isNaN(d.getTime())) return "";
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export { money } from "../../../lib/money.ts";
export const count = (n) => (n == null || Number.isNaN(Number(n)) ? "–" : Number(n).toLocaleString("en-US"));
/** A mean or other average: one decimal; "–" for none. */
export const mean = (v) => (v == null ? "–" : Number(v).toFixed(1));
/** Hours as "3.2h": one decimal under 10, whole from 10. */
export const hours = (h) => (h == null || Number.isNaN(h) ? "–" : `${h.toFixed(h < 10 ? 1 : 0)}h`); export const days = (d) => (d == null || Number.isNaN(d) ? "–" : `${Math.round(d)}d`);
/** The fewest landed issues a median of issues rests on; with fewer the Jobs page shows no figure. */
export const MIN_LANDED = 20;
/** A byte count as "512B", "1.5KiB" or "2.0MiB". */
export const bytes = (n) => (n < 1024 ? `${n}B` : n < 1048576 ? `${(n / 1024).toFixed(1)}KiB` : `${(n / 1048576).toFixed(1)}MiB`);
/** `≈1% wk` or `≈0.4% wk` for a job's or session's estimated share of the weekly plan limit; "" without one. */
/** A percent (0 to 100) as text: whole from 1%, one decimal from 0.05 to 1%, "<0.1%" above 0 and below 0.05, "–" for none. */
export const pct = (v) => (v == null || Number.isNaN(v) ? "–" : v > 0 && v < 0.05 ? "<0.1%" : `${v < 1 ? v.toFixed(1) : Math.round(v)}%`);
/** A fraction (0 to 1) as `pct` writes it; "–" for none. */
export const cardPct = (v) => (v == null ? "–" : pct(v * 100));
export const wkText = (wk) => (wk ? `\u2248${pct(wk.pct)} wk` : "");
/** Seconds as "43s", "4m 05s", "1h 02m" or "2d 04h"; "–" for none. Every duration on the page has this form. */
export function dur(s) {
  if (s === null || s === undefined || Number.isNaN(s)) return "–";
  s = Math.round(s);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${pad(s % 60)}s`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${pad(m % 60)}m` : `${Math.floor(h / 24)}d ${pad(h % 24)}h`;
}
/** The time since `ts` in its largest whole unit: "40s ago", "2m ago", "3h ago", "5d ago". A browser clock behind the server's reads "0s ago". */
export function ago(ts, now = Date.now()) {
  const s = Math.max(0, Math.floor((now - Date.parse(ts)) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`;
}
/** The line for data that failed to rebuild: "`name` is `age` old: `error`", from its mark `{ error, since }`. */
export const markLine = (name, { error, since }, now = Date.now()) => `${name} is ${dur((now - Date.parse(since)) / 1000)} old: ${error}`;
/** Milliseconds, for a span that can be under a second: "850ms", "1.5s", then as `dur`; "" for none. */
export const durMs = (ms) => (ms == null ? "" : ms < 1000 ? `${ms}ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : dur(ms / 1000));
/** The time from `from` to `to` (ISO strings) as `dur` writes it; "" for a bad pair. */
export function span(from, to) {
  const ms = Date.parse(to) - Date.parse(from);
  return ms >= 0 ? dur(ms / 1000) : "";
}
/** The line for a failed API response: the JSON body's `error`, else the body's text cut to 300 characters. */
export function failMessage(url, status, body) {
  const head = `${url} answered ${status}`;
  const text = String(body ?? "").trim();
  if (!text) return head;
  let msg = text.slice(0, 300);
  try {
    const j = JSON.parse(text);
    if (j && typeof j.error === "string" && j.error) msg = j.error;
  } catch {}
  return `${head}: ${msg}`;
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** A table's time, on one line: "10/28 08:45" for this year, "2025-12-03" for another; "" for a bad date. */
export function when(ts, now = new Date()) {
  const d = new Date(ts);
  if (ts == null || ts === "" || Number.isNaN(d.getTime())) return "";
  return d.getFullYear() === now.getFullYear()
    ? `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** A chart axis's short time of day: "4a", "1:36p". */
export function hourLabel(ts) {
  const d = new Date(ts), m = d.getMinutes();
  return `${d.getHours() % 12 || 12}${m ? `:${pad(m)}` : ""}${d.getHours() < 12 ? "a" : "p"}`;
}
/** A day, for a chart's axis or a date with no time: "Oct 28" for this year, "2025-12-03" for another; "" for a bad date. */
export function day(ts, now = new Date()) {
  const d = new Date(ts);
  if (ts == null || ts === "" || Number.isNaN(d.getTime())) return "";
  return d.getFullYear() === now.getFullYear() ? `${MONTHS[d.getMonth()]} ${pad(d.getDate())}` : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** A model as its short name: "claude-opus-5-5" and "opus" are both "opus"; "" for none. */
export const shortModel = (m) => bare(String(m ?? "")).replace(/^claude-/, "").replace(/(-\d+)+(\[.*\])?$/, "");
/** The short weekday of a time in ms: "Mon". */
export const weekday = (ms) => new Date(ms).toLocaleDateString("en-US", { weekday: "short" });
/** A count with its noun: "1 run", "2 runs"; `many` is for a plural that is not `one` + "s". */
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** A Title Case heading in sentence case, for an aria label: "Lead Time" is "Lead time". */
const sentence = (t) => t[0] + t.slice(1).toLowerCase();
/** A store date or a note's stamp as ms in local time, as the CLI writes them; NaN for neither. */
export const localMs = (s) => Date.parse(String(s ?? "").replace(" ", "T") + (/^\d{4}-\d\d-\d\d$/.test(String(s ?? "")) ? "T00:00" : ""));
/** A bucket's x-axis label: "4a" or "1:36p" in the hour and day windows, "Oct 25" in week and month. */
export function xLabel(at, window) {
  const d = new Date(at);
  if (window === "week" || window === "month") return day(d);
  return hourLabel(d);
}
