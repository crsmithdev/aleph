// The Timeline view: an ECharts strip of events per day (30 days, one stacked bar per
// kind), then a reverse-time stream under sticky day headers. The first day comes with
// the page; the rest load one day at a time from /api/timeline as a sentinel scrolls
// into view. `data` is /api/timeline: { days, next, strip, langfuse }.
import { chart, clock, empty, esc, money } from "../lib.js";

export const view = {
  path: "/timeline",
  title: "Timeline",
  group: "activity",
  order: 1,
  api: "/api/timeline?days=1",
  render: (d) => renderTimeline(d),
  mount: (root, d) => mountTimeline(root, d),
};

export const KINDS = [["job", "Jobs"], ["land", "Lands"], ["issue", "Issues"], ["session", "Sessions"], ["note", "Notes"]];

const STYLE = `<style>
.tl .kinds { display: flex; flex-wrap: wrap; gap: 6px 14px; margin: 0 0 8px; font: 13px var(--sans); }
.tl .kinds label { cursor: pointer; }
.tl .strip { width: 100%; height: 150px; margin-bottom: 12px; }
.tl .day h2 { position: sticky; top: 0; z-index: 1; margin: 0; padding: 6px 0; background: var(--bg); border-bottom: 1px solid var(--rule); font: 600 13px var(--sans); }
.tl .ev { display: flex; gap: 10px; align-items: baseline; padding: 4px 0; border-bottom: 1px solid var(--rule-2); font: 13px var(--sans); }
.tl .ev .t { flex: 0 0 42px; color: var(--muted); font-variant-numeric: tabular-nums; }
.tl .ev .mark { flex: 0 0 18px; text-align: center; }
.tl .ev .mark.run { color: var(--run); } .tl .ev .mark.done { color: var(--done); }
.tl .ev .mark.need { color: var(--need); } .tl .ev .mark.stuck { color: var(--stuck); }
.tl .ev .mark.quiet { color: var(--muted); }
.tl .ev .what { color: var(--muted); }
.tl .ev .title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tl .ev .cost { color: var(--muted); font-variant-numeric: tabular-nums; }
.tl .sentinel { height: 1px; }
.tl .more { color: var(--muted); font: 12px var(--sans); padding: 8px 0; }
</style>`;

const TONE = { running: "run", landed: "done", passed: "done", done: "done", "needs-you": "need", failed: "stuck", stuck: "stuck", dropped: "quiet" };
const GLYPH = {
  job: { started: "▷", ended: "■" }, land: { landed: "⬆" }, issue: { opened: "○", closed: "✓", dropped: "✕" },
  session: { started: "◆" }, note: { written: "✎" },
};

/** The kind mark of an event: its glyph and colour class. Jobs take their state's colour. */
export function mark(e) {
  const glyph = GLYPH[e.kind]?.[e.what] ?? "•";
  const tone = e.kind === "job" || e.kind === "land" ? (TONE[e.state] ?? "quiet")
    : e.kind === "issue" ? (e.what === "opened" ? "run" : e.what === "closed" ? "done" : "quiet")
    : e.kind === "session" ? "need" : "quiet";
  return { glyph, tone };
}

export function renderEvent(e) {
  const m = mark(e);
  const extra = e.kind === "session" ? `<span class="cost">${esc(money(e.cost))}</span>` : e.commit ? `<code class="cost">${esc(e.commit)}</code>` : "";
  return `<div class="ev" data-kind="${esc(e.kind)}"><span class="t">${e.dateOnly ? "" : esc(clock(e.at))}</span>` +
    `<span class="mark ${m.tone}" title="${esc(`${e.kind} ${e.what}${e.state ? `: ${e.state}` : ""}`)}">${m.glyph}</span>` +
    `<span class="what">${esc(e.what)}</span><a class="title" href="${esc(e.href)}">${esc(e.title)}</a>${extra}</div>`;
}

const dayLabel = (day) => new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: "numeric" });
export const renderDay = (d) =>
  `<section class="day" id="tl-${esc(d.day)}" data-day="${esc(d.day)}"><h2>${esc(dayLabel(d.day))}</h2>${d.events.map(renderEvent).join("")}</section>`;

export function renderTimeline(d) {
  if (!d) return `<div class="page">${empty("No data.")}</div>`;
  const note = d.langfuse === "off" ? `<p class="hint">Langfuse is not configured: sessions are left out.</p>` : d.langfuse === "error" ? `<p class="hint">Langfuse failed: sessions are left out.</p>` : "";
  return `${STYLE}<div class="page tl"><h1>Timeline</h1>${note}` +
    `<div class="kinds" role="group" aria-label="Kinds">${KINDS.map(([k, label]) => `<label><input type="checkbox" data-kind="${k}" checked> ${esc(label)}</label>`).join("")}</div>` +
    `<div class="strip" id="tl-strip" role="img" aria-label="Events per day, last 30 days"></div>` +
    `<div id="tl-days">${d.days.map(renderDay).join("")}</div>` +
    (d.days.length ? "" : empty("Nothing happened yet.", "Jobs, issues, sessions, lands and notes show up here.")) +
    `<div class="sentinel" id="tl-sentinel"></div><div class="more" id="tl-more">${d.next ? "Scroll for earlier days." : d.days.length ? "That is all of it." : ""}</div></div>`;
}

/** The strip's ECharts option: one stacked bar series per enabled kind, one category per day. */
export function stripOption(strip, kinds = KINDS.map(([k]) => k)) {
  const days = strip.map((s) => s.day);
  return {
    animation: false,
    grid: { left: 28, right: 8, top: 22, bottom: 22 },
    legend: { show: false },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    xAxis: { type: "category", data: days, axisLabel: { formatter: (v) => String(v).slice(5), hideOverlap: true } },
    yAxis: { type: "value", minInterval: 1 },
    series: KINDS.filter(([k]) => kinds.includes(k)).map(([k, label]) => ({
      name: label, type: "bar", stack: "events", data: strip.map((s) => s.counts[k] ?? 0),
    })),
  };
}

export function mountTimeline(root, d) {
  const days = root.querySelector("#tl-days"), sentinel = root.querySelector("#tl-sentinel"), more = root.querySelector("#tl-more");
  if (!days || !sentinel) return;
  const on = new Set(KINDS.map(([k]) => k));
  let next = d?.next ?? null, loading = null, c = null, io = null;
  const project = new URLSearchParams(location.hash.split("?")[1] ?? "").get("project") ?? "";

  const filter = () => {
    for (const ev of days.querySelectorAll(".ev")) ev.hidden = !on.has(ev.dataset.kind);
    for (const s of days.querySelectorAll(".day")) s.hidden = !s.querySelector(".ev:not([hidden])");
    c?.setOption(stripOption(d.strip ?? [], [...on]), true);
  };
  const loadMore = () => {
    if (!next) return Promise.resolve(false);
    return loading ??= (async () => {
      try {
        const q = new URLSearchParams({ before: next, days: "1" });
        if (project) q.set("project", project);
        const res = await fetch(`/api/timeline?${q}`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const page = await res.json();
        days.insertAdjacentHTML("beforeend", page.days.map(renderDay).join(""));
        next = page.next;
        more.textContent = next ? "Scroll for earlier days." : "That is all of it.";
        filter();
      } catch (e) { more.textContent = `Could not load earlier days (${e.message}).`; next = null; }
      finally { loading = null; if (io && next) { io.unobserve(sentinel); io.observe(sentinel); } }  // a fresh look: the sentinel may still be in view
      return true;
    })();
  };
  const goTo = async (day) => {
    let el;
    while (!(el = root.querySelector(`#tl-${day}`)) && next && day < (days.lastElementChild?.dataset.day ?? "")) await loadMore();
    // A day with no events has no section: scroll to the nearest older one.
    el ??= [...days.querySelectorAll(".day")].find((s) => s.dataset.day <= day);
    el?.scrollIntoView({ block: "start" });
  };

  if (d?.strip && globalThis.echarts) {
    try {
      c = chart(root.querySelector("#tl-strip"), stripOption(d.strip));
      c.on("click", (p) => goTo(d.strip[p.dataIndex].day));
    } catch (e) { console.error("timeline strip failed", e); }
  }
  for (const box of root.querySelectorAll(".kinds input")) box.addEventListener("change", () => { box.checked ? on.add(box.dataset.kind) : on.delete(box.dataset.kind); filter(); });
  if (typeof IntersectionObserver === "function") {
    io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) loadMore(); }, { rootMargin: "400px" });
    io.observe(sentinel);
  }
}
