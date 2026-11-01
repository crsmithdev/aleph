// The Issue page's lifetime chart: one row per run and per wait, in time order, on a shared axis.
// Plain JS with no DOM, so the page and the tests both import it.
import { esc, when } from "./lib.js";

const KINDS = { triage: "Triage", build: "Build", plan: "Plan", land: "Land", facts: "Facts review", recheck: "Recheck", plain: "Run", firefighter: "Firefighter" };
const GAP = 60_000;

/** "42 s", "12 min", "3 h 5 min", "4 d 2 h". */
export function lifespan(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
  return h % 24 ? `${Math.floor(h / 24)} d ${h % 24} h` : `${Math.floor(h / 24)} d`;
}

/** A store date or a note's stamp as ms in local time, as the CLI writes them; NaN for neither. */
const localMs = (s) => Date.parse(String(s ?? "").replace(" ", "T") + (/^\d{4}-\d\d-\d\d$/.test(String(s ?? "")) ? "T00:00" : ""));

/** The time and text of a note line `- 2026-11-01 08:06: text`; null for one with no stamp. */
export function noteEvent(line) {
  const m = /^- (\d{4}-\d\d-\d\d \d\d:\d\d(?::\d\d)?): (.*)$/s.exec(String(line));
  return m ? { at: localMs(m[1]), text: m[2] } : null;
}

const tone = (run) => (["failed", "stuck", "dropped"].includes(run.condition) ? "bad" : run.kind === "land" ? "land" : "agent");
const waitAfter = (prev) => (!prev ? ["Queued", "wait"] : prev.condition === "awaiting" || prev.ask ? ["Awaiting", "chris"] : ["Idle", "wait"]);

/** The bars in time order: `{ label, tone, start, end, run?, wait? }`, a wait for each gap over a minute between filing, runs and closing. */
export function lifeRows(d, now = Date.now()) {
  const t = d.timeline ?? {};
  const runs = (t.runs ?? []).map((r) => {
    const start = Date.parse(r.started), end = Date.parse(r.ended ?? "");
    return { r, start, end: end >= start ? end : r.condition === "running" ? now : start };
  }).filter((x) => x.start >= 0).sort((a, b) => a.start - b.start);
  const created = localMs(d.frontmatter?.created);
  // A date with no time is midnight, which would draw a wait that did not happen: a run on that day starts the chart.
  const sameDay = runs.length && new Date(created).toDateString() === new Date(runs[0].start).toDateString();
  const filed = t.filed ?? (created >= 0 && !sameDay ? created : runs[0]?.start ?? created);
  const rows = [];
  let cursor = filed, prev = null;
  for (const { r, start, end } of runs) {
    if (start - cursor > GAP) {
      const [label, tone_] = waitAfter(prev);
      rows.push({ label, tone: tone_, start: cursor, end: start, wait: true });
    }
    const part = /^[^-].*-(\d+\.\d+)$/.exec(r.on ?? "")?.[1];
    rows.push({ label: KINDS[r.kind] ?? r.kind, part, tone: tone(r), start, end, run: r });
    cursor = Math.max(cursor, end);
    prev = r;
  }
  if (d.status === "open" && now - cursor > GAP) {
    const [label, tone_] = prev ? waitAfter(prev) : ["Open, no run yet", "wait"];
    rows.push({ label, tone: tone_, start: cursor, end: now, wait: true });
  }
  return { rows, start: filed, end: rows.length ? Math.max(...rows.map((r) => r.end)) : filed };
}

/**
 * The position of each time as a share of the axis. Each span between two neighbouring times takes the
 * square root of its length, so a three-minute run stays visible beside a two-week wait, and the times stay in order.
 */
export function compactScale(times) {
  const at = [...new Set(times.filter(Number.isFinite))].sort((a, b) => a - b);
  const cum = [0];
  for (let i = 1; i < at.length; i++) cum.push(cum[i - 1] + Math.sqrt(at[i] - at[i - 1]));
  const total = cum.at(-1) || 1;
  return (t) => {
    const i = at.findLastIndex((x) => x <= t);
    if (i < 0) return 0;
    if (i === at.length - 1) return cum[i] / total;
    return (cum[i] + ((t - at[i]) / (at[i + 1] - at[i])) * (cum[i + 1] - cum[i])) / total;
  };
}

/** Up to `max` axis labels, each at least 24% from the one before. */
export function axisTimes(times, x, max = 5) {
  const out = [];
  for (const t of [...new Set(times)].sort((a, b) => a - b)) {
    if (!out.length || x(t) - x(out.at(-1)) >= 0.24) out.push(t);
  }
  return out.slice(0, max);
}

const pct = (f) => (f * 100).toFixed(3);

/** A row of points: the notes or the commits. */
const dots = (name, list, x) => (list.length
  ? `<div class="wf-row k-dots"><div class="wf-l"><span class="tn">${esc(name)}</span><span class="ld">${list.length}</span></div><div class="wf-r">${list.map((e) => {
    const body = `style="left:${pct(x(e.at))}%" title="${esc(`${when(new Date(e.at))} ${e.text}`)}"`;
    return e.href ? `<a class="itl-dot" href="${esc(e.href)}" ${body} aria-label="${esc(e.text)}"></a>` : `<span class="itl-dot" ${body}></span>`;
  }).join("")}</div></div>`
  : "");

const LEGEND = [["agent", "Agent run"], ["land", "Land"], ["chris", "Awaiting"], ["wait", "Queued or idle"], ["bad", "Failed or dropped"]];

/** The chart: a summary line, the legend, the axis, a row per bar and the note and commit rows. "" for an issue with nothing to draw. */
export function renderLifetime(d, now = Date.now()) {
  const { rows, start, end } = lifeRows(d, now);
  const notes = (d.notes ?? []).map(noteEvent).filter(Boolean);
  const commits = (d.commits ?? []).map((c) => ({ at: Date.parse(c.date), text: c.subject, href: c.commitUrl })).filter((c) => c.at >= 0);
  if (!rows.length && !notes.length && !commits.length) return "";
  const times = [start, end, ...rows.flatMap((r) => [r.start, r.end]), ...notes.map((e) => e.at), ...commits.map((e) => e.at)].filter(Number.isFinite);
  const x = compactScale(times);
  const sum = (tones) => rows.filter((r) => tones.includes(r.tone)).reduce((n, r) => n + (r.end - r.start), 0);
  const cost = rows.reduce((n, r) => n + (r.run?.cost ?? 0), 0);
  const runs = rows.filter((r) => r.run).length;
  const hi = Math.max(...times), lo = Math.min(...times);
  const fact = (k, v) => `${k} <strong>${esc(v)}</strong>`;
  const summary = [
    fact(d.status === "open" ? "Open for" : "Lifetime", lifespan(hi - lo)),
    fact("Agents", lifespan(sum(["agent", "land", "bad"]))),
    ...(sum(["chris"]) ? [fact("Awaiting", lifespan(sum(["chris"])))] : []),
    ...(sum(["wait"]) ? [fact("Queued or idle", lifespan(sum(["wait"])))] : []),
    fact("Runs", String(runs)),
    ...(cost ? [fact("Cost", `$${cost.toFixed(2)}`)] : []),
  ].join('<span class="dot">·</span>');
  const row = (r) => {
    const name = r.run ? `<a href="#/jobs/${encodeURIComponent(r.run.name)}">${esc(r.label)}</a>` : esc(r.label);
    const tip = `${r.label}${r.run?.model ? ` · ${r.run.model}` : ""}${r.run?.condition ? ` · ${r.run.condition}` : ""} · ${when(new Date(r.start))} · ${lifespan(r.end - r.start)}${r.run?.reason ? ` · ${r.run.reason}` : ""}`;
    return `<div class="wf-row t-${r.tone}"><div class="wf-l"><span class="tn">${name}</span>${r.part ? `<span class="ta">${esc(r.part)}</span>` : ""}<span class="ld">${esc(lifespan(r.end - r.start))}</span></div>` +
      `<div class="wf-r"><span class="wf-bar" title="${esc(tip)}" style="left:${pct(x(r.start))}%;width:${pct(Math.max(0.004, x(r.end) - x(r.start)))}%"></span></div></div>`;
  };
  const ticks = axisTimes(times, x).map((t) => `<span style="left:${pct(x(t))}%">${esc(when(new Date(t)))}</span>`).join("");
  return `<div class="itl"><p class="wf-sum">${summary}</p>` +
    `<ul class="itl-key">${LEGEND.filter(([k]) => rows.some((r) => r.tone === k)).map(([k, v]) => `<li class="t-${k}"><i></i>${esc(v)}</li>`).join("")}</ul>` +
    `<div class="wf-grid" role="img" aria-label="${esc(`Lifetime of the issue: ${runs} runs and ${rows.length - runs} waits`)}"><div class="wf-axis"><div class="wf-l">Long spans are compressed</div><div class="wf-r">${ticks}</div></div>` +
    rows.map(row).join("") + dots("Notes", notes, x) + dots("Commits", commits, x) + `</div></div>`;
}
