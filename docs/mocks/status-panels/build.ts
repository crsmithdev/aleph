// Builds the Status page mocks: Agent Time and Pipeline redrawn as one panel, Active Issues as the second, both the
// size of today's Agent Time, and a Memory panel in the space left. parts/ holds the live page's rendered HTML of 2026-11-20 and
// data.json its numbers. Run: bun docs/mocks/status-panels/build.ts
import { barList, barRow, card, esc, meter } from "../../../ui/views/lib/html.js";
import { count } from "../../../ui/views/lib/format.js";

const dir = import.meta.dir, d = await Bun.file(`${dir}/data.json`).json();
const part = (n: string) => Bun.file(`${dir}/parts/${n}.html`).text().then((t) => t.trim());
const [outcome, pipeline, herald, scorecard, shead, side] = await Promise.all(["outcome", "pipeline", "herald", "scorecard", "shead", "side"].map(part));

/** Panel heights on the live page at 1600 px: Agent Time is 216 px, and the three cards fill 806 px with two 24 px gaps. */
const H = 216, LEFT = 806 - 2 * H - 2 * 24;

const KEYS = [["intake", "Intake", "chart-6"], ["queue", "Queued", "series-4"], ["running", "Running", "run"], ["landed", "Landed", "done"]];
const dayName = (at: string) => new Date(at).toLocaleDateString("en-US", { weekday: "short" });

/** A stacked area of the active issues per day, drawn as SVG in the chart colours of activeFrame(). */
function area(w: number, h: number, keys = KEYS) {
  const rows = d.active, n = rows.length, top = Math.max(...rows.map((r: any) => keys.reduce((a, [k]) => a + r[k], 0)));
  const x = (i: number) => (i / (n - 1)) * w, y = (v: number) => h - (v / top) * h;
  const base = rows.map(() => 0);
  const paths = keys.map(([k, , c]) => {
    const lo = [...base], hi = rows.map((r: any, i: number) => (base[i] += r[k]));
    const pts = hi.map((v: number, i: number) => `${x(i)},${y(v)}`).concat(lo.map((v, i) => `${x(i)},${y(v)}`).reverse());
    return `<polygon points="${pts.join(" ")}" fill="var(--${c})" fill-opacity=".75" stroke="var(--${c})" stroke-width="1"/>`;
  }).join("");
  const ticks = rows.map((r: any, i: number) => `<span style="position:absolute;left:${(x(i) / w) * 100}%;transform:translateX(${i === 0 ? "0" : i === n - 1 ? "-100%" : "-50%"})">${dayName(r.at)}</span>`).join("");
  return `<div style="position:relative"><span class="m" style="position:absolute;top:-2px;left:0;font-size:var(--fs-2xs);color:var(--muted)">${count(top)}</span>` +
    `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none" role="img" aria-label="Active issues per day">${paths}</svg>` +
    `<div style="position:relative;height:14px;font-size:var(--fs-2xs);color:var(--muted)">${ticks}</div></div>`;
}
const legend = (keys = KEYS) => `<div style="display:flex;gap:var(--sp-12);font-size:var(--fs-2xs);color:var(--muted)">${keys.map(([, name, c]) => `<span style="display:inline-flex;align-items:center;gap:4px"><i style="width:8px;height:8px;border-radius:50%;background:var(--${c})"></i>${name}</span>`).join("")}</div>`;
const sized = (html: string, h = H) => html.replace(/^<section class="card"/, `<section class="card" style="height:${h}px;box-sizing:border-box"`);

const st = d.stages, f = d.figures, total = f.kept + f.hours;
const hrs = (h: number) => (h < 1 ? `${h.toFixed(1)}h` : `${Math.round(h)}h`);
const dur = (x: number) => { const s = Math.round(x); return s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`; };
const tone = (share: number) => (share < 0.1 ? "fine" : share <= 0.25 ? "warning" : "alert");
const TONE: Record<string, string> = { fine: "done", warning: "need", alert: "error" };
const fail = (k: string) => st[k].unusable / st[k].runs;
const pct = (s: number) => (s > 0 && s < 0.01 ? `${(s * 100).toFixed(1)}%` : `${Math.round(s * 100)}%`);
/** The outcome bar of Agent Time: kept segments, the gap, lost segments; the same classes as the live card. */
const obar = (h = 10) => `<div class="obar thin" style="height:${h}px">${d.classes.map((c: any, i: number) => (i && c.lost && !d.classes[i - 1].lost ? '<i class="ogap"></i>' : "") + `<i class="seg-${c.key}" style="flex:${c.hours}" title="${c.key} ${hrs(c.hours)}"></i>`).join("")}</div>`;
const key = (c: any) => `<span style="display:inline-flex;align-items:center;gap:4px;white-space:nowrap"><i class="seg-${c.key}" style="width:8px;height:8px;border-radius:2px;display:inline-block"></i>${c.key} <b class="num" style="font-weight:var(--fw-mid);color:var(--ink)">${hrs(c.hours)}</b></span>`;
const keys = (cs: any[]) => `<div style="display:flex;flex-wrap:wrap;gap:var(--sp-4) var(--sp-12);font-size:var(--fs-2xs);color:var(--muted)">${cs.map(key).join("")}</div>`;
const STAGES: [string, string][] = [["intake", "Intake"], ["queue", "Queue"], ["build", "Implement"], ["review", "Review"], ["recheck", "Recheck"], ["land", "Land"]];

// B1: the pipeline, with Implement opened up. Agent Time is the time of the implement jobs, so its bar lives inside that stage.
const node = ([k, name]: [string, string]) => {
  if (k === "queue") return `<div class="pnode wait" style="width:64px"><span class="ring">wait</span><span class="pn">${name}</span><span class="pt">${dur(d.queue.p90)}</span></div>`;
  const s = fail(k), t = tone(s);
  return `<div class="pnode ${t}" style="width:64px"><span class="ring">${(st[k].runs / st[k].items).toFixed(1)}</span><span class="pn">${name}</span><span class="pt">${dur(st[k].p90)}</span><span class="pf">${pct(s)} failed</span></div>`;
};
const s = fail("build");
const open = `<div style="flex:1 1 0;min-width:0;border-radius:var(--r-card);background:var(--sunk);padding:var(--sp-8) var(--sp-12);box-shadow:inset 0 3px 0 var(--${TONE[tone(s)]})">` +
  `<div style="display:flex;align-items:baseline;gap:var(--sp-8)"><span class="pn">Implement</span><span class="pt">${(st.build.runs / st.build.items).toFixed(1)} / issue · p90 ${dur(st.build.p90)}</span><span class="pf" style="margin-left:auto;color:var(--${TONE[tone(s)]});font-weight:var(--fw-strong)">${pct(s)} failed</span></div>` +
  `<div class="ohead" style="margin:var(--sp-4) 0 var(--sp-6)"><b class="num" style="font-size:24px">${pct(f.kept / total)}</b><span>reached main · ${hrs(f.kept)} of ${hrs(total)}</span></div>${obar()}` +
  `<div style="margin-top:var(--sp-6)">${keys(d.classes).replace("gap:var(--sp-4) var(--sp-12)", "gap:var(--sp-2) var(--sp-10)")}</div></div>`;
const arrow = `<span class="parrow" aria-hidden="true" style="flex:0 0 14px;min-width:14px;margin-top:21px"></span>`;
const b1 = sized(card("Pipeline", `<div class="pflow" style="padding:0;gap:var(--sp-4);align-items:flex-start">${node(STAGES[0])}${arrow}${node(STAGES[1])}${arrow}${open}${arrow}${node(STAGES[3])}${arrow}${node(STAGES[4])}${arrow}${node(STAGES[5])}</div>`,
  { id: "pipeline", aside: `<span class="asof">runs / issue in the ring · p90 under it</span>` }));

// B2: one row per stage, with agent hours on one scale. Implement's bar is the outcome bar, so the lost time shows where it was spent.
const H_OF: Record<string, number> = { intake: st.intake.runs * st.intake.minutes / 60, review: st.review.runs * st.review.minutes / 60, recheck: st.recheck.runs * st.recheck.minutes / 60, land: st.land.runs * st.land.minutes / 60, build: total };
const top = Math.max(...Object.values(H_OF));
const cell = "padding:2px var(--sp-8) 3px 0;white-space:nowrap";
const srow = ([k, name]: [string, string]) => {
  if (k === "queue") return `<tr><td style="${cell}"><b class="pn" style="font-size:var(--fs-xs)">${name}</b></td><td class="num" style="${cell}">–</td><td class="num" style="${cell}">${dur(d.queue.p90)}</td><td class="num" style="${cell}">–</td><td style="${cell};width:100%;color:var(--muted);font-size:var(--fs-2xs)">waiting, no agent</td><td></td></tr>`;
  const sh = fail(k), t = TONE[tone(sh)], h = H_OF[k];
  const bar = k === "build" ? `<div style="width:${(h / top) * 100}%">${obar(8)}</div>` : `<div style="width:${Math.max(0.6, (h / top) * 100)}%;height:8px;border-radius:var(--r-pill);background:var(--fill-aux)"></div>`;
  return `<tr><td style="${cell}"><b class="pn" style="font-size:var(--fs-xs)">${name}</b></td><td class="num" style="${cell}">${(st[k].runs / st[k].items).toFixed(1)}</td><td class="num" style="${cell}">${dur(st[k].p90)}</td>` +
    `<td class="num" style="${cell};color:var(--${t});${sh >= 0.1 ? "font-weight:var(--fw-strong)" : ""}">${pct(sh)}</td><td style="${cell};width:100%">${bar}</td><td class="num" style="${cell};text-align:right">${hrs(h)}</td></tr>`;
};
const th = (t: string, num = true) => `<th style="text-align:${num ? "right" : "left"};padding:0 var(--sp-8) 4px 0;font-size:var(--fs-2xs);color:var(--muted);font-weight:var(--fw-strong);white-space:nowrap">${t}</th>`;
const b2 = sized(card("Pipeline", `<table style="width:100%;border-collapse:collapse;font-size:var(--fs-xs)"><thead><tr>${th("Stage", false)}${th("Runs / issue")}${th("p90")}${th("Failed")}<th style="text-align:left;padding:0 0 4px">${keys(d.classes)}</th>${th("Agent")}</tr></thead><tbody>${STAGES.map(srow).join("")}</tbody></table>`,
  { id: "pipeline", aside: `<span style="font-size:var(--fs-sm);color:var(--muted)"><b class="num" style="color:var(--ink);font-size:var(--fs-lg)">${pct(f.kept / total)}</b> reached main · ${hrs(f.kept)} of ${hrs(total)}</span>` }));

// The second panel: Active Issues alone, at the same height.
const active = sized(card("Active Issues", area(760, 118), { id: "active-issues", aside: legend() }));

// The Memory panel: the start context budget and what to trim, then the notes' health.
const m = d.memory;
const ago = (at: string) => `${Math.round((Date.parse("2026-11-20T16:47:00Z") - Date.parse(at)) / 3_600_000)} h ago`;
const stat = (k: string, v: string, q = "", t = "") => `<div style="padding:var(--sp-8) 0;border-top:1px solid var(--rule-2)"><div style="font-size:var(--fs-2xs);color:var(--muted);text-transform:uppercase;letter-spacing:var(--ls-caps);font-weight:var(--fw-strong)">${k}</div>` +
  `<div style="display:flex;align-items:baseline;gap:var(--sp-6);margin-top:2px"><b class="num" style="font:var(--fw-strong) var(--fs-2xl)/1.2 var(--num)${t ? `;color:var(--${t})` : ""}">${v}</b><span style="font-size:var(--fs-xs);color:var(--muted)">${q}</span></div></div>`;
const budget = `<div class="ohead" style="margin:0 0 var(--sp-8)"><b class="num" style="color:var(--need)">${count(m.left)} B</b><span>left in the aleph start context</span></div>` +
  Object.entries(m.scopes).map(([k, x]: [string, any]) => `<div style="display:grid;grid-template-columns:52px 1fr auto;gap:var(--sp-8);align-items:center;font-size:var(--fs-xs);padding:3px 0">${esc(k)}<span class="meter" role="img" aria-label="${esc(k)} start context"><i style="width:${((x.bytes / x.budget) * 100).toFixed(1)}%${x.budget - x.bytes < 200 ? ";background:var(--hot)" : ""}"></i></span><span class="num" style="color:var(--muted)">${count(x.bytes)} / ${count(x.budget)} B</span></div>`).join("") +
  `<div style="margin-top:var(--sp-10);font-size:var(--fs-2xs);color:var(--muted);text-transform:uppercase;letter-spacing:var(--ls-caps);font-weight:var(--fw-strong)">Trim first · 0 offers in 8 d</div>` +
  `<ul style="margin:var(--sp-4) 0 0;padding:0;list-style:none;font-size:var(--fs-xs)">${m.trim.map((c: any) => `<li style="display:flex;gap:var(--sp-8);padding:2px 0"><a href="#" style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.title)}</a><span class="num" style="color:var(--muted)">${c.bytes} B</span></li>`).join("")}</ul>`;
/** Offers per day, summed over every note's history; the recall log holds 10 whole days with offers, so the spark shows those, without today. */
const offerSpark = () => {
  const xs = m.offers30.slice(-11, -1), top = Math.max(...xs), w = 400, h = 34;
  const pts = xs.map((v: number, i: number) => `${(i / (xs.length - 1)) * w},${h - (v / top) * h}`);
  return `<div style="margin-top:var(--sp-8);border-top:1px solid var(--rule-2);padding-top:var(--sp-6)"><div style="display:flex;justify-content:space-between;font-size:var(--fs-2xs);color:var(--muted);text-transform:uppercase;letter-spacing:var(--ls-caps);font-weight:var(--fw-strong)"><span>Offers per day · 10 d</span><span class="num" style="text-transform:none">${count(xs.at(-1))} yesterday · peak ${count(top)}</span></div>` +
    `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none" aria-hidden="true"><polygon points="0,${h} ${pts.join(" ")} ${w},${h}" fill="var(--run-bg)"/><polyline points="${pts.join(" ")}" fill="none" stroke="var(--run)" stroke-width="1.5"/></svg></div>`;
};
const health = `<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));column-gap:var(--sp-16)">` +
  stat("Offered, 7 d", count(m.offered), `/ ${count(m.total)}`) + stat("Never offered", count(m.never)) + stat("Unoffered reads", count(m.unoffered), "7 d") +
  stat("Lint refused", count(m.refused), `on ${m.refusedNotes} notes`, "error") + stat("Re-check due", count(m.stale), `${m.late} over 30 d`, m.late ? "need" : "") + stat("Writes, 7 d", count(m.writes7)) +
  `</div>${offerSpark()}<p style="margin:var(--sp-6) 0 0;font-size:var(--fs-xs);color:var(--muted)">Maintainer ran ${ago(m.maintain.last)} · <span class="badge need">dry</span></p>`;
const memory = sized(card("Memory", `<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.25fr);gap:var(--sp-28)"><div>${budget}</div><div>${health}</div></div>`, { id: "memory", aside: `<a href="#/memory" class="asof">Open</a>` }), LEFT);

const ringCss = `<style>#pipeline .ring{width:44px;height:44px;font-size:var(--fs-sm)}</style>`;

const page = (title: string, main: string, css = "") => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><link rel="icon" href="data:,">
<link href="https://fonts.googleapis.com/css2?family=Merriweather:wght@400;700&family=Work+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<link href="https://cdnjs.cloudflare.com/ajax/libs/hack-font/3.3.0/web/hack.min.css" rel="stylesheet">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@awesome.me/webawesome@3.14.0/dist-cdn/styles/themes/default.css">
<script type="module" src="https://cdn.jsdelivr.net/npm/@awesome.me/webawesome@3.14.0/dist-cdn/webawesome.loader.js"></script>
<link rel="stylesheet" href="app.css">${css}</head><body><div class="shell">${side}<main><div id="view"><div class="page sp">${shead}${scorecard}
<div class="rail"><div class="rail-main">${main}</div>${herald}</div></div></div></main></div></body></html>`;


// C1: one panel split 7 : 2. Pipeline stages on the left; three metric cards on the right, reached main first.
const runs = ["intake", "build", "review", "recheck", "land"].reduce((a, k) => a + st[k].runs, 0), bad = ["intake", "build", "review", "recheck", "land"].reduce((a, k) => a + st[k].unusable, 0);
const mini = (k: string, v: string, q: string, extra = "", t = "") => `<div class="tile" style="flex:1 1 0;justify-content:center;box-shadow:none;background:var(--sunk);padding:var(--sp-6) var(--sp-12);gap:var(--sp-2)"><span class="k" style="font-size:var(--fs-2xs)">${k}</span>` +
  `<span style="display:flex;align-items:baseline;gap:var(--sp-6);min-width:0"><b style="font-size:22px${t ? `;color:var(--${t})` : ""}">${v}</b><span class="q m">${q}</span></span>${extra}</div>`;
const pipeBody = pipeline.replace(/^<section[^>]*>/, "").replace(/<\/section>$/, "");
const c1 = sized(`<section class="card" id="pipeline" aria-label="Pipeline"><div style="display:grid;grid-template-columns:minmax(0,7fr) minmax(0,2fr);gap:var(--sp-20);height:100%">` +
  `<div style="min-width:0">${pipeBody}</div>` +
  `<div style="display:flex;flex-direction:column;gap:var(--sp-8);min-width:0">` +
  mini("Reached main", pct(f.kept / total), `${hrs(f.kept)} of ${hrs(total)}`, `<div style="margin-top:var(--sp-2)">${obar(5)}</div>`) +
  mini("First run landed", pct(d.firstRun.runs / d.firstRun.of), `${count(d.firstRun.runs)} of ${count(d.firstRun.of)}`) +
  mini("Failed runs", pct(bad / runs), `${count(bad)} of ${count(runs)}`, "", bad / runs > 0.1 ? "need" : "") +
  `</div></div></section>`);
const c1Css = `<style>#pipeline{padding-top:var(--sp-14);padding-bottom:var(--sp-14)}#pipeline .pnode{width:72px}</style>`;

// C2: Chris's sketch of round 4. B2's stage rows on the left, a rule, and three stats on the right, split 3 : 1.
const stat2 = (k: string, v: string, q: string, t = "") => `<div style="display:flex;flex-direction:column;gap:2px"><span style="color:var(--muted);font:var(--fw-strong) var(--fs-2xs)/1.2 var(--sans);letter-spacing:var(--ls-caps);text-transform:uppercase">${k}</span>` +
  `<span style="display:flex;align-items:baseline;gap:var(--sp-6)"><b style="font:var(--fw-strong) 26px/1 var(--metric);letter-spacing:var(--ls-display);font-variant-numeric:tabular-nums;color:var(--${t || "ink"})">${v}</b><span style="font-size:var(--fs-xs);color:var(--muted);white-space:nowrap">${q}</span></span></div>`;
const table2 = `<table style="width:100%;border-collapse:collapse;font-size:var(--fs-xs)"><thead><tr>${th("Stage", false)}${th("Runs / issue")}${th("p90")}${th("Failed")}<th></th>${th("Agent")}</tr></thead><tbody>${STAGES.map(srow).join("")}</tbody></table>`;
const pipeSplit = (right: string) => sized(`<section class="card" id="pipeline" aria-label="Pipeline"><div style="display:grid;grid-template-columns:minmax(0,3fr) minmax(0,1fr);height:100%">` +
  `<div style="min-width:0;padding-right:var(--sp-20)"><div class="sh" style="margin-bottom:var(--sp-10)"><h2>Pipeline</h2><span class="aside">${keys(d.classes)}</span></div>${table2.replaceAll("padding:2px var(--sp-8) 2px 0", "padding:1px var(--sp-8) 1px 0")}</div>` +
  `<div style="min-width:0;border-left:1px solid var(--rule);padding-left:var(--sp-20);display:flex;flex-direction:column;justify-content:space-around">${right}</div></div></section>`);
const c2 = pipeSplit(
  stat2("Reached main", pct(f.kept / total), `${hrs(f.kept)} of ${hrs(total)}`) +
  stat2("First run landed", pct(d.firstRun.runs / d.firstRun.of), `${count(d.firstRun.runs)} of ${count(d.firstRun.of)}`) +
  stat2("Failed runs", pct(bad / runs), `${count(bad)} of ${count(runs)}`, bad / runs > 0.1 ? "need" : ""));

// E1: the right side holds the gates instead: holds this week, then each gate's holds split into useful, held up and wasted.
const g = d.gates, OUT = [["useful", "caught or handed off", "done"], ["held", "held up", "fill-aux"], ["wasted", "false, no reply or no effect", "need"]];
const gbar = (x: any) => `<div style="display:flex;gap:2px;height:6px">${OUT.map(([k, , c]) => x[k] ? `<i title="${x[k]} ${k}" style="flex:${x[k]};background:var(--${c});border-radius:2px"></i>` : "").join("")}</div>`;
const grow = (x: any) => `<div style="display:flex;flex-direction:column;gap:3px"><div style="display:flex;justify-content:space-between;font-size:var(--fs-xs)"><span style="color:var(--ink-2)">${esc(x.gate)}</span><span class="num" style="color:var(--muted)">${count(x.holds)}</span></div>${gbar(x)}</div>`;
const useful = (g.out.caught ?? 0) + (g.out.handoff ?? 0), wasted = (g.out.false ?? 0) + (g.out["no reply"] ?? 0) + (g.out["no effect"] ?? 0);
const e1 = pipeSplit(stat2("Holds", count(g.holds), `${pct(useful / g.holds)} useful, 7 d`) +
  `<div style="display:flex;flex-direction:column;gap:var(--sp-8)">${g.by.map(grow).join("")}</div>` +
  `<div style="display:flex;gap:var(--sp-10);font-size:var(--fs-2xs);color:var(--muted)">${OUT.map(([k, t, c]) => `<span title="${t}" style="display:inline-flex;align-items:center;gap:4px"><i style="width:8px;height:8px;border-radius:2px;background:var(--${c})"></i>${k}</span>`).join("")}</div>`);

// Round 5: Memory at 216 px like the others, and Active Issues at half width with a candidate panel beside it.
const memory216 = sized(card("Memory", `<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.3fr);gap:var(--sp-24)"><div>` +
  `<div class="ohead" style="margin:0 0 var(--sp-10)"><b class="num" style="color:var(--need)">${count(m.left)} B</b><span>left in aleph start context</span></div>` +
  Object.entries(m.scopes).map(([k, x]: [string, any]) => `<div style="display:grid;grid-template-columns:48px 1fr auto;gap:var(--sp-8);align-items:center;font-size:var(--fs-xs);padding:3px 0">${esc(k)}<span class="meter" role="img" aria-label="${esc(k)} start context"><i style="width:${((x.bytes / x.budget) * 100).toFixed(1)}%${x.budget - x.bytes < 200 ? ";background:var(--hot)" : ""}"></i></span><span class="num" style="color:var(--muted)">${count(x.bytes)} / ${count(x.budget)} B</span></div>`).join("") +
  `<p style="margin:var(--sp-10) 0 0;font-size:var(--fs-xs);color:var(--muted)">Maintainer ran ${ago(m.maintain.last)} · <span class="badge need">dry</span></p></div>` +
  `<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));column-gap:var(--sp-16)">` +
  stat("Offered, 7 d", count(m.offered), `/ ${count(m.total)}`) + stat("Never offered", count(m.never)) + stat("Unoffered reads", count(m.unoffered), "7 d") +
  stat("Lint refused", count(m.refused), `on ${m.refusedNotes} notes`, "error") + stat("Re-check due", count(m.stale), `${m.late} over 30 d`, m.late ? "need" : "") + stat("Writes, 7 d", count(m.writes7)) +
  `</div></div>`, { id: "memory", aside: `<a href="#/memory" class="asof">Open</a>` }));

const pair = (a: string, b: string) => `<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--gap-in)">${a}${b}</div>`;
const activeHalf = sized(card("Active Issues", area(360, 112), { id: "active-issues", aside: legend() }));

// D1: Filed and Closed per day, so a growing backlog shows next to the issues in flight.
const fd = d.flowDays.slice(0, -1), fmax = Math.max(...fd.flatMap((x: any) => [x.filed, x.closed]));
const fcol = (x: any) => `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;min-width:0"><div style="height:104px;display:flex;align-items:flex-end;gap:2px">` +
  `<i title="filed ${x.filed}" style="width:12px;height:${(x.filed / fmax) * 100}%;background:var(--chart-6);border-radius:2px 2px 0 0"></i><i title="closed ${x.closed}" style="width:12px;height:${(x.closed / fmax) * 100}%;background:var(--done);border-radius:2px 2px 0 0"></i></div>` +
  `<span style="font-size:var(--fs-2xs);color:var(--muted)">${dayName(x.day + "T12:00:00")}</span></div>`;
const netF = fd.reduce((a: number, x: any) => a + x.filed - x.closed, 0);
const flowPanel = sized(card("Filed and Closed", `<div style="display:flex;gap:var(--sp-4)">${fd.map(fcol).join("")}</div>`,
  { id: "filed-closed", aside: `<span style="font-size:var(--fs-xs);color:var(--muted)"><b class="num" style="color:var(--${netF > 0 ? "need" : "done"})">${netF > 0 ? "+" : ""}${count(netF)}</b> backlog · ${legend([["", "Filed", "chart-6"], ["", "Closed", "done"]])}</span>` }));

// D2: where the 26h of lost time went, by cause, so the largest cause leads.
const lc = [...d.lostCauses.slice(0, 4), { name: "Other causes", hours: d.lostCauses.slice(4).reduce((a: number, x: any) => a + x.hours, 0) }], lmax = lc[0].hours, lsum = d.lostCauses.reduce((a: number, x: any) => a + x.hours, 0);
const lostPanel = sized(card("Lost Time", barList(lc.map((x: any, i: number) => barRow(esc(x.name), (x.hours / lmax) * 100, `${hrs(x.hours)} · ${pct(x.hours / lsum)}`, { top: i === 0 })).join("")),
  { id: "lost", aside: `<span class="asof">${hrs(lsum)} by cause</span>` }));

// D3: the window's issues in six counts, beside Active Issues.
const w = d.week;
const issuesPanel = sized(card("Issues", `<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));column-gap:var(--sp-16)">` +
  stat("Filed", count(w.filed)) + stat("Intake", count(w.intake)) + stat("Landed", count(w.landed), "", "done") +
  stat("Dropped", count(w.dropped)) + stat("Open", count(w.open), `+ ${count(w.parked)} parked`) + stat("Errored", count(w.errored), "now", w.errored ? "error" : "") +
  `</div>`, { id: "issues", aside: `<span class="asof">week</span>` }));

// E2: the right side holds the 10 dispatch gates instead: the issues each held this week, with the hours they held them.
// job and done do not stop a start (holds.ts stopsStart), so they sit in a note under the bars.
const ih = d.issueHolds, on = ih.gates.filter((x: any) => x.issues && x.stops).sort((a: any, b: any) => b.issues - a.issues), off = ih.gates.filter((x: any) => !x.issues), pass = ih.gates.filter((x: any) => x.issues && !x.stops);
const imax = Math.max(...on.map((x: any) => x.issues));
const irow = (x: any) => `<div style="display:grid;grid-template-columns:42px 1fr auto;gap:var(--sp-6);align-items:center;font-size:var(--fs-xs);${x.stops ? "" : "opacity:var(--dim)"}" title="${esc(x.gate)}: ${x.issues} issues, ${x.hours}h held${x.stops ? "" : ", does not stop a start"}">` +
  `<span class="mono" style="font-size:var(--fs-2xs);color:var(--ink-2)">${esc(x.gate)}</span><span class="meter"><i style="width:${(x.issues / imax) * 100}%${x.stops ? ";background:var(--need)" : ""}"></i></span>` +
  `<span class="num" style="color:var(--muted);white-space:nowrap">${count(x.issues)} · ${x.hours < 1 ? x.hours : Math.round(x.hours)}h</span></div>`;
const e2 = pipeSplit(stat2("Held issues", count(ih.held), "week") +
  `<div style="display:flex;flex-direction:column;gap:6px">${on.map(irow).join("")}</div>` +
  `<div style="font-size:var(--fs-2xs);color:var(--muted);line-height:1.5">not a stop: ${pass.map((x: any) => `${x.gate} ${count(x.issues)}`).join(", ")}<br>none: ${off.map((x: any) => x.gate).join(", ")}</div>`);

// Round 8: three right sides for Pipeline, all on the issue holds, and Active Issues and Issues joined in one split panel.
const hsum = on.reduce((a: number, x: any) => a + x.hours, 0);
const hfmt = (h: number) => (h < 1 ? `${h}h` : `${Math.round(h)}h`);
const GC: Record<string, string> = { after: "need", full: "run", red: "error", file: "fill-aux" };
const noneLine = `<div style="font-size:var(--fs-2xs);color:var(--muted)">none: ${off.map((x: any) => x.gate).join(", ")}</div>`;
// F1: a small table of the gates that held issues.
const f1 = pipeSplit(stat2("Held issues", count(ih.held), "week") +
  `<table style="width:100%;border-collapse:collapse;font-size:var(--fs-xs)"><thead><tr>${["Gate", "Issues", "Hours"].map((t, i) => `<th style="text-align:${i ? "right" : "left"};font-size:var(--fs-2xs);color:var(--muted);font-weight:var(--fw-strong);padding:0 0 3px">${t}</th>`).join("")}</tr></thead>` +
  `<tbody>${on.map((x: any) => `<tr style="border-top:1px solid var(--rule-2)"><td class="mono" style="font-size:var(--fs-2xs);padding:2px 0">${esc(x.gate)}</td><td class="num" style="text-align:right">${count(x.issues)}</td><td class="num" style="text-align:right;color:var(--muted)">${hfmt(x.hours)}</td></tr>`).join("")}</tbody></table>` + noneLine);
// F2: one bar of the held issues, split by gate, with a legend of counts.
const f2 = pipeSplit(stat2("Held issues", count(ih.held), `${hfmt(hsum)} held`) +
  `<div style="display:flex;gap:2px;height:10px">${on.map((x: any) => `<i title="${x.gate} ${x.issues}" style="flex:${x.issues};background:var(--${GC[x.gate]});border-radius:2px"></i>`).join("")}</div>` +
  `<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px var(--sp-10);font-size:var(--fs-xs)">${on.map((x: any) => `<span style="display:flex;align-items:center;gap:5px"><i style="width:8px;height:8px;border-radius:2px;background:var(--${GC[x.gate]})"></i><span class="mono" style="font-size:var(--fs-2xs)">${esc(x.gate)}</span><b class="num" style="margin-left:auto;font-weight:var(--fw-mid)">${count(x.issues)}</b></span>`).join("")}</div>` + noneLine);
// F3: two figures and the gate that held the most.
const most = on[0];
const f3 = pipeSplit(stat2("Held issues", count(ih.held), "week") + stat2("Hours held", hfmt(hsum), "week") +
  `<div style="font-size:var(--fs-xs);color:var(--ink-2);line-height:1.5">Most: <span class="mono" style="font-size:var(--fs-2xs)">${esc(most.gate)}</span>, ${count(most.issues)} issues, ${hfmt(most.hours)}<br><span style="color:var(--muted)">then ${on.slice(1).map((x: any) => `${x.gate} ${x.issues}`).join(", ")}</span></div>`);

// The joined Issues panel: Active Issues on the left, the week's counts on the right, as Pipeline is split.
const st3 = (k: string, v: string, q = "", t = "") => `<div><div style="color:var(--muted);font:var(--fw-strong) var(--fs-2xs)/1.2 var(--sans);letter-spacing:var(--ls-caps);text-transform:uppercase">${k}</div>` +
  `<div style="display:flex;align-items:baseline;gap:4px;margin-top:2px"><b style="font:var(--fw-strong) 20px/1 var(--metric);font-variant-numeric:tabular-nums;color:var(--${t || "ink"})">${v}</b><span style="font-size:var(--fs-2xs);color:var(--muted);white-space:nowrap">${q}</span></div></div>`;
const issuesJoined = sized(`<section class="card" id="issues" aria-label="Issues"><div style="display:grid;grid-template-columns:minmax(0,3fr) minmax(0,1fr);height:100%">` +
  `<div style="min-width:0;padding-right:var(--sp-20)"><div class="sh" style="margin-bottom:var(--sp-14)"><h2>Issues</h2><span class="aside">${legend()}</span></div>${area(560, 108)}</div>` +
  `<div style="min-width:0;border-left:1px solid var(--rule);padding-left:var(--sp-20);display:grid;grid-template-columns:1fr 1fr;align-content:space-around;gap:var(--sp-8) var(--sp-12)">` +
  st3("Filed", count(w.filed)) + st3("Intake", count(w.intake)) + st3("Landed", count(w.landed), "", "done") + st3("Dropped", count(w.dropped)) + st3("Open", count(w.open), `+${count(w.parked)}`) + st3("Errored", count(w.errored), "now", w.errored ? "error" : "") +
  `</div></div></section>`);

// Round 9: the right of Pipeline as the week's biggest pipeline problems, aggregated from the stages, the lost time and the holds.
const prob = (n: number, tone: string, what: string, fig: string, why: string) => `<div style="display:grid;grid-template-columns:14px 1fr auto;gap:2px var(--sp-6);align-items:baseline">` +
  `<span class="num" style="font-size:var(--fs-2xs);color:var(--muted)">${n}</span><span style="font-size:var(--fs-xs);color:var(--ink);font-weight:var(--fw-mid);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${what}</span>` +
  `<b class="num" style="font-size:var(--fs-xs);color:var(--${tone})">${fig}</b><span></span><span style="grid-column:2 / -1;font-size:var(--fs-2xs);color:var(--muted)">${why}</span></div>`;
const head2 = (t: string) => `<span style="color:var(--muted);font:var(--fw-strong) var(--fs-2xs)/1.2 var(--sans);letter-spacing:var(--ls-caps);text-transform:uppercase">${t}</span>`;
// G1: the worst of each kind: the stage that fails most, the cause that loses most time, the gate that holds most.
const worst = ["build", "recheck", "land"].map((k) => ({ k, s: fail(k) })).sort((a, b) => st[b.k].unusable - st[a.k].unusable)[0];
const sname = (k: string) => STAGES.find(([x]) => x === k)![1];
const lc0 = d.lostCauses[0], ah = on[0];
const g1 = pipeSplit(head2("Biggest problems · week") +
  prob(1, "error", `${sname(worst.k)} fails`, pct(worst.s), `${count(st[worst.k].unusable)} of ${count(st[worst.k].runs)} runs`) +
  prob(2, "need", lc0.name, hfmt(lc0.hours), `${pct(lc0.hours / lsum)} of lost time`) +
  prob(3, "need", `Held: ${ah.gate}`, count(ah.issues), `issues, ${hfmt(ah.hours)} waiting`));
// G2: one ranked list in one unit: hours. Lost agent time by cause, and a hold's hours as waiting time, marked so.
const items = [...d.lostCauses.slice(0, 3).map((x: any) => ({ what: x.name, h: x.hours, kind: "agent time lost" })), ...on.slice(0, 2).map((x: any) => ({ what: `Held: ${x.gate}`, h: x.hours, kind: `${x.issues} issues waiting` }))]
  .sort((a, b) => b.h - a.h).slice(0, 4);
const gmax = items[0].h;
const g2 = pipeSplit(head2("Top costs · hours") + `<div style="display:flex;flex-direction:column;gap:var(--sp-6)">${items.map((x) => `<div title="${esc(x.kind)}"><div style="display:flex;justify-content:space-between;gap:var(--sp-6);font-size:var(--fs-xs)"><span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(x.what)}</span><b class="num" style="font-weight:var(--fw-mid)">${hfmt(x.h)}</b></div>` +
  `<div style="display:flex;align-items:center;gap:var(--sp-6)"><span class="meter" style="flex:1"><i style="width:${(x.h / gmax) * 100}%;background:var(--${x.what.startsWith("Held") ? "need" : "hot"})"></i></span><span style="font-size:var(--fs-2xs);color:var(--muted);white-space:nowrap">${esc(x.kind)}</span></div></div>`).join("")}</div>`);

// Round 10: the week's issue counts move to the right of Pipeline; the right of Issues shows how fast issues resolve.
const pcounts = pipeSplit(`<div style="display:grid;grid-template-columns:1fr 1fr;align-content:space-around;gap:var(--sp-8) var(--sp-12);height:100%">` +
  st3("Filed", count(w.filed)) + st3("Intake", count(w.intake)) + st3("Landed", count(w.landed), "", "done") + st3("Dropped", count(w.dropped)) + st3("Open", count(w.open), `+${count(w.parked)}`) + st3("Errored", count(w.errored), "now", w.errored ? "error" : "") + `</div>`);
const ph = d.phases, PH: [string, string][] = [["intake", "Intake"], ["queue", "Queue"], ["implement", "Implement"], ["land", "Land"]];
const slow = PH.reduce((a, [k]) => (ph[k].p90 > ph[a].p90 ? k : a), "intake");
const speed = `<div style="display:flex;flex-direction:column;gap:var(--sp-8);height:100%;justify-content:space-around">` + stat2("Lead time", `${Math.round(ph.lead.p50 / 60)}m`, `p50 · p90 ${dur(ph.lead.p90)}`) +
  `<table style="width:100%;border-collapse:collapse;font-size:var(--fs-xs)"><thead><tr>${["Phase", "p50", "p90"].map((t, i) => `<th style="text-align:${i ? "right" : "left"};font-size:var(--fs-2xs);color:var(--muted);font-weight:var(--fw-strong);padding:0 0 3px">${t}</th>`).join("")}</tr></thead>` +
  `<tbody>${PH.map(([k, n]) => `<tr style="border-top:1px solid var(--rule-2)"><td style="padding:2px 0">${n}</td><td class="num" style="text-align:right">${dur(ph[k].p50)}</td><td class="num" style="text-align:right;${k === slow ? "color:var(--need);font-weight:var(--fw-strong)" : "color:var(--muted)"}">${dur(ph[k].p90)}</td></tr>`).join("")}</tbody></table></div>`;
const issuesSpeed = issuesJoined.replace(/(<div style="min-width:0;border-left:1px solid var\(--rule\);padding-left:var\(--sp-20\);)[^"]*">[\s\S]*<\/div><\/div><\/section>$/, `$1">${speed}</div></div></section>`);

// H2: the right of Issues as a chart: per day, the median minutes of each phase for the issues that landed that day,
// stacked. Medians keep one slow issue (Intake's 21h p90) out; a day over CAP is cut at CAP and labelled with its total.
const SD = d.speedDays.filter((x: any) => x.n), CAP = 30;
const SK: [string, string, string][] = [["intake", "Intake", "chart-6"], ["queue", "Queue", "series-4"], ["implement", "Implement", "run"], ["land", "Land", "done"]];
const speedChart = (() => {
  const H = 104, col = (x: any) => {
    const tot = SK.reduce((a, [k]) => a + x[k], 0), cut = tot > CAP, scale = (H / CAP) * (cut ? CAP / tot : 1);
    const segs = SK.map(([k, n, c]) => `<i title="${n} ${x[k].toFixed(1)}m" style="height:${x[k] * scale}px;background:var(--${c});opacity:.85"></i>`).reverse().join("");
    return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;min-width:0" title="${x.n} landed · ${tot.toFixed(0)}m">` +
      `<span class="num" style="font-size:var(--fs-2xs);color:var(--${cut ? "need" : "muted"});font-weight:${cut ? "var(--fw-strong)" : "inherit"};height:12px">${cut ? `${Math.round(tot)}m` : Math.round(tot)}</span>` +
      `<div style="height:${H}px;width:14px;display:flex;flex-direction:column;justify-content:flex-end;position:relative">${segs}${cut ? `<b style="position:absolute;top:4px;left:-3px;right:-3px;height:3px;background:var(--surface);transform:skewY(-20deg)"></b>` : ""}</div>` +
      `<span style="font-size:var(--fs-2xs);color:var(--muted)">${dayName(x.day + "T12:00:00")}</span></div>`;
  };
  return `<div style="display:flex;justify-content:space-between;align-items:baseline">${head2("Median to land · min")}</div>` +
    `<div style="display:flex;gap:2px;align-items:flex-end;margin-top:var(--sp-4)">${SD.map(col).join("")}</div>` +
    `<div style="display:flex;flex-wrap:wrap;gap:2px var(--sp-8);margin-top:var(--sp-4);font-size:var(--fs-2xs);color:var(--muted)">${SK.map(([, n, c]) => `<span style="display:inline-flex;align-items:center;gap:3px"><i style="width:7px;height:7px;border-radius:50%;background:var(--${c})"></i>${n}</span>`).join("")}</div>`;
})();
const issuesSpeedChart = issuesJoined.replace(/(<div style="min-width:0;border-left:1px solid var\(--rule\);padding-left:var\(--sp-20\);)[^"]*">[\s\S]*<\/div><\/div><\/section>$/, `$1">${speedChart}</div></div></section>`);

const boards: Record<string, [string, string, string?]> = {
  "b1-implement-opens.html": ["B1 · Implement opens up", b1 + active + memory, ringCss],
  "b2-stage-rows.html": ["B2 · One row per stage", b2 + active + memory],
  "h2-speed-chart.html": ["H2 · Speed as a chart beside Issues", pcounts + issuesSpeedChart + memory216],
  "h1-counts-speed.html": ["H1 · Counts beside Pipeline; speed beside Issues", pcounts + issuesSpeed + memory216],
  "g1-worst-of-each.html": ["G1 · Biggest problems, worst of each kind", g1 + issuesJoined + memory216],
  "g2-top-costs.html": ["G2 · Top costs in hours", g2 + issuesJoined + memory216],
  "f1-holds-table.html": ["F1 · Holds as a table; Issues joined", f1 + issuesJoined + memory216],
  "f2-holds-bar.html": ["F2 · Holds as one bar; Issues joined", f2 + issuesJoined + memory216],
  "f3-holds-figures.html": ["F3 · Holds as two figures; Issues joined", f3 + issuesJoined + memory216],
  "e2-issue-holds.html": ["E2 · Pipeline with issue holds", e2 + pair(activeHalf, issuesPanel) + memory216],
  "e1-gates.html": ["E1 · Pipeline with gates", e1 + pair(activeHalf, issuesPanel) + memory216],
  "d3-issue-counts.html": ["D3 · Active Issues with Issues counts", c2 + pair(activeHalf, issuesPanel) + memory216],
  "d1-filed-closed.html": ["D1 · Active Issues with Filed and Closed", c2 + pair(activeHalf, flowPanel) + memory216],
  "d2-lost-causes.html": ["D2 · Active Issues with Lost Time", c2 + pair(activeHalf, lostPanel) + memory216],
  "c2-rows-stats.html": ["C2 · Stage rows left, stats right", c2 + active + memory],
  "c1-split.html": ["C1 · Pipeline left, metrics right", c1 + active + memory, c1Css],
};
for (const [f, [t, main, css]] of Object.entries(boards)) await Bun.write(`${dir}/${f}`, page(`Status · ${t}`, main, css));
await Bun.write(`${dir}/index.html`, `<!doctype html><meta charset="utf-8"><title>Status panels</title><link rel="stylesheet" href="app.css"><div class="page"><h1>Status panels</h1><ul>${Object.entries(boards).map(([f, [t]]) => `<li><a href="${f}">${esc(t)}</a></li>`).join("")}</ul></div>`);
console.log(Object.keys(boards).join(" "), { H, LEFT });
