// Shared helpers for the factory UI's views: escaping, time and money formats,
// the empty and error states, the copy-command button, and a small Markdown
// renderer. Plain JS with no DOM, so the page and the tests both import it.
// View issues may add to this file but not change what is here (the 2026-11-04 format issue did: a unit follows a number with no space).

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

const pad = (n) => String(n).padStart(2, "0");
/** "14:05" in local time, or "" for no time or a bad date. */
export const clock = (iso) => {
  const d = new Date(iso);
  if (iso == null || iso === "" || Number.isNaN(d.getTime())) return "";
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const money = (n) => ((n ?? 0) > 0 && n < 0.005 ? "<$0.01" : `$${(n ?? 0).toFixed(2)}`);
export const count = (n) => (n == null || Number.isNaN(Number(n)) ? "–" : Number(n).toLocaleString("en-US"));
/** A number cell for a count of bad things (errors, failures): `--stuck` when above 0. */
export const badCount = (n) => `<td class="num${n > 0 ? " bad" : ""}">${count(n)}</td>`;
/** A mean or other average: one decimal; "–" for none. */
export const mean = (v) => (v == null ? "–" : Number(v).toFixed(1));
/** Hours as "3.2h": one decimal under 10, whole from 10. */
export const hours = (h) => (h == null || Number.isNaN(h) ? "–" : `${h.toFixed(h < 10 ? 1 : 0)}h`); export const days = (d) => (d == null || Number.isNaN(d) ? "–" : `${Math.round(d)}d`);
/** A byte count as "512B", "1.5KiB" or "2.0MiB". */
export const bytes = (n) => (n < 1024 ? `${n}B` : n < 1048576 ? `${(n / 1024).toFixed(1)}KiB` : `${(n / 1048576).toFixed(1)}MiB`);

/** `≈1% wk` or `≈0.4% wk` for a job's or session's estimated share of the weekly plan limit; "" without one. */
/** A percent (0 to 100) as text: whole from 1%, one decimal from 0.05 to 1%, "<0.1%" above 0 and below 0.05, "–" for none. */
export const pct = (v) => (v == null || Number.isNaN(v) ? "–" : v > 0 && v < 0.05 ? "<0.1%" : `${v < 1 ? v.toFixed(1) : Math.round(v)}%`);
export const wkText = (wk) => (wk ? `\u2248${pct(wk.pct)} wk` : "");
const WK_TIP = "An estimate of the share of the weekly plan limit: the cost times the rise in weekly % per Claude dollar this machine spent, fit hour by hour over 28 days, one rate for Fable and one for the other Claude models. A week's estimate missed by about ±25% in holdout, because use off this machine (claude.ai chat, other devices) is not in the dollars. OpenRouter and local models use none of the plan.";
/** The cost cell content (HTML): the weekly share first, with its tooltip, then the dollars. */
export const costHtml = (cost, wk) => {
  const dollars = cost === undefined || cost === null ? "" : esc(money(cost));
  if (!wk) return dollars;
  const tip = WK_TIP + (wk.pooled ? " One rate prices all models: the window has too little Fable spend for its own rate." : "");
  return `<span class="wk" title="${esc(tip)}">${esc(wkText(wk))}</span>${dollars ? ` <span class="quiet">${dollars}</span>` : ""}`;
};

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

/** The line for data that failed to rebuild: "`name` is `age` old: `error`", from its mark `{ error, since }`. */
export const markLine = (name, { error, since }, now = Date.now()) => `${name} is ${dur((now - Date.parse(since)) / 1000)} old: ${error}`;

/** Milliseconds, for a span that can be under a second: "850ms", "1.5s", then as `dur`; "" for none. */
export const durMs = (ms) => (ms == null ? "" : ms < 1000 ? `${ms}ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : dur(ms / 1000));

/** The time from `from` to `to` (ISO strings) as `dur` writes it; "" for a bad pair. */
export function span(from, to) {
  const ms = Date.parse(to) - Date.parse(from);
  return ms >= 0 ? dur(ms / 1000) : "";
}

/** The one empty state: "No data". Pass `line` only for a state that is not missing data, in at most three words. */
export const empty = (line = "No data") => `<div class="empty"><p>${esc(line)}</p></div>`;

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

/** An inline loading line: "Loading <what>…". */
export const loadingLine = (what) => `<p class="quiet" role="status">Loading ${esc(what)}…</p>`;
/** The first-load state of a view, shown until its API answers. */
export const loading = (title) => `<div class="page"><p class="quiet loading" role="status">Loading ${esc(title)}…</p></div>`;

/** The error state: what failed, and what to try. */
export const error = (line, hint = "Check that aleph-ui is running, then reload.", { detail = "" } = {}) =>
  `<div class="error" role="alert"><p>${esc(line)}</p><p class="hint">${esc(hint)}</p>${detail ? fold("Technical details", `<pre>${esc(detail)}</pre>`) : ""}</div>`;

/** A note above data that still shows: `bad` marks that the data is stale or wrong. */
export const notice = (line, bad = false, id = "") => `<p class="notice${bad ? " bad" : ""}" role="${bad ? "alert" : "status"}"${id ? ` id="${esc(id)}"` : ""}>${esc(line)}</p>`;

/** A command the reader copies to run; the page's click handler does the copying. */
export function cmd(text, { primary = false, hint = "" } = {}) {
  return `<button class="cmd${primary ? " primary" : ""}" type="button" data-cmd="${esc(text)}"><span>${esc(text)}</span>${hint ? `<span class="hint">${esc(hint)}</span>` : ""}<span class="cp">Copy</span></button>`;
}

const safeHref = (u) => /^(https?:\/\/|\/|#|\.{0,2}\/)/i.test(u) || !/^[a-z][\w+.-]*:/i.test(u) ? u : "#";

/** Inline Markdown on escaped text: `code`, [links](url), **bold**, *em*. */
function inline(text) {
  const parts = String(text).split(/(`[^`]+`)/);
  return parts.map((p) => {
    if (/^`[^`]+`$/.test(p)) return `<code>${esc(p.slice(1, -1))}</code>`;
    let out = "", last = 0;
    for (const m of p.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]|\[([^\]]+)\]\(([^)\s]+)\)/g)) {
      out += emph(esc(p.slice(last, m.index)));
      // [[Title]] or [[Title|label]] links to the vault note's page.
      out += m[1] !== undefined
        ? `<a href="#/memory/${encodeURIComponent(m[1].trim())}">${esc((m[2] || m[1]).trim())}</a>`
        : `<a href="${esc(safeHref(m[4]))}">${emph(esc(m[3]))}</a>`;
      last = m.index + m[0].length;
    }
    return out + emph(esc(p.slice(last)));
  }).join("");
}
const emph = (s) => s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");

/** Markdown to HTML: headings, lists, pipe tables, fenced code, paragraphs, inline code, links and [[wiki links]]. Everything else is escaped. */
export function md(src) {
  const lines = String(src ?? "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let para = [], list = null;
  const flushPara = () => { if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`); para = []; };
  const cells = (r) => r.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => c.trim());
  const flushList = () => { if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`); list = null; };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const fence = l.match(/^\s*(```|~~~)/);
    if (fence) {
      flushPara(); flushList();
      const body = [];
      while (++i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i]);
      out.push(`<pre><code>${esc(body.join("\n"))}</code></pre>`);
      continue;
    }
    const h = l.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) { flushPara(); flushList(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }
    const li = l.match(/^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/);
    if (li) {
      flushPara();
      const tag = li[1] ? "ul" : "ol";
      if (list && list.tag !== tag) flushList();
      if (!list) list = { tag, items: [] };
      list.items.push(li[3]);
      continue;
    }
    if (!l.trim()) { flushPara(); flushList(); continue; }
    const head = l.includes("|") && cells(l);
    if (head && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(lines[i + 1] ?? "") && cells(lines[i + 1]).length === head.length) {
      flushPara(); flushList();
      const row = (tag, r) => `<tr>${r.map((c) => `<${tag}>${inline(c)}</${tag}>`).join("")}</tr>`;
      const body = [];
      for (i += 2; i < lines.length && lines[i].includes("|"); i++) body.push(row("td", cells(lines[i])));
      i--;
      out.push(`<table><thead>${row("th", head)}</thead><tbody>${body.join("")}</tbody></table>`);
      continue;
    }
    if (list && /^\s+\S/.test(l)) { list.items[list.items.length - 1] += " " + l.trim(); continue; }
    flushList();
    para.push(l.trim());
  }
  flushPara(); flushList();
  return out.join("\n");
}

/** Call the view's optional `mount(root, data)` after its markup is in `root`. Returns whether it ran, or a promise of that when the mount is async; a failed async mount rejects it. */
export function mountView(view, root, data, query) {
  if (typeof view?.mount !== "function") return false;
  const done = view.mount(root, data, query);
  return typeof done?.then === "function" ? done.then(() => true) : true;
}

/**
 * The ECharts theme for a token map ({bg, surface, ink, rule, run, done, need, stuck, sans}).
 * Series colours `series-1` to `series-5`, then `chart-6` and `chart-7`; a series that is a state sets its tone as `color`.
 */
export function chartTheme(t) {
  const axis = { axisLine: { lineStyle: { color: t.rule } }, axisTick: { lineStyle: { color: t.rule } }, axisLabel: { color: t.ink, fontSize: 12 * (Number(t["chart-scale"]) || 1), fontWeight: Number(t["chart-weight"]) || 400 }, splitLine: { lineStyle: { color: t.rule } }, nameTextStyle: { color: t.ink } };
  return {
    color: [t["series-1"], t["series-2"], t["series-3"], t["series-4"], t["series-5"], t["chart-6"], t["chart-7"]],
    backgroundColor: "transparent",
    textStyle: { color: t.ink, fontFamily: t.chart || t.sans },
    title: { textStyle: { color: t.ink }, subtextStyle: { color: t.ink } },
    legend: { textStyle: { color: t.ink } }, bar: { label: { color: t.ink } },
    categoryAxis: axis, valueAxis: axis, timeAxis: axis, logAxis: axis,
    tooltip: { backgroundColor: t.surface, borderColor: t.rule, textStyle: { color: t.ink }, axisPointer: { lineStyle: { color: t.rule }, crossStyle: { color: t.rule } } },
  };
}

const TOKENS = ["bg", "surface", "ink", "rule", "run", "done", "need", "stuck", "hot", "muted", "focus", "sans", "mono", "chart", "chart-scale", "chart-weight", "series-1", "series-2", "series-3", "series-4", "series-5", "chart-6", "chart-7"];
/** Read the page tokens off :root into a token map. */
export const readTokens = (el = document.documentElement) => {
  const cs = getComputedStyle(el);
  return Object.fromEntries(TOKENS.map((k) => [k, cs.getPropertyValue(`--${k}`).trim()]));
};

let seq = 0;
/**
 * Init an ECharts chart on `el` with `option`, themed from the page tokens. It re-themes when
 * prefers-color-scheme changes and resizes with the element. Returns a wrapper over the instance.
 */
export function chart(el, option) {
  const echarts = globalThis.echarts;
  if (!echarts) throw new Error("ECharts is not loaded");
  const name = `aleph-${++seq}`;
  const build = () => { echarts.registerTheme(name, chartTheme(readTokens())); return echarts.init(el, name); };
  const handlers = [];
  let c = build();
  c.setOption(option);
  const mq = matchMedia("(prefers-color-scheme: dark)");
  const retheme = () => {
    const opt = c.getOption();
    c.dispose();
    c = build();
    c.setOption(opt);
    for (const [ev, fn] of handlers) c.on(ev, fn);
  };
  mq.addEventListener("change", retheme);
  const ro = new ResizeObserver(() => c.resize());
  ro.observe(el);
  return {
    get instance() { return c; },
    setOption: (o, ...rest) => c.setOption(o, ...rest),
    // Handlers are kept so a re-theme, which builds a new instance, attaches them again.
    on(ev, fn) { handlers.push([ev, fn]); c.on(ev, fn); },
    dispose() { mq.removeEventListener("change", retheme); ro.disconnect(); c.dispose(); },
  };
}

// Now fills `.diff-panel[data-diff-for]`; Jobs fills `.diff-panel#diff` and removes its `[data-diff]` button once the diff is in.
const PANELS = "[data-diff-for], .diff-panel#diff";
const panelKey = (p) => p.getAttribute?.("data-diff-for") ?? "diff";
const FIELDS = "input, textarea, select";

/** The key of each details: its `data-fold` id (a fold whose summary text changes), else its `data-keep`, else `summary text`, plus its position among the details with the same key. */
function detailsKeys(root) {
  const seen = new Map();
  return [...root.querySelectorAll("details")].map((el) => {
    const text = el.dataset?.fold ?? el.dataset?.keep ?? (el.querySelector("summary")?.textContent ?? "").trim();
    const n = seen.get(text) ?? 0;
    seen.set(text, n + 1);
    return [`${text}#${n}`, el];
  });
}

/** Each clamp button keyed by its clamped text plus its position among the clamps with the same text, so a new row above it does not move the key. */
function clampKeys(root) {
  const seen = new Map();
  return [...root.querySelectorAll(".clamp-btn")].map((b) => {
    const text = b.previousElementSibling?.textContent ?? "";
    const n = seen.get(text) ?? 0;
    seen.set(text, n + 1);
    return [`${text}#${n}`, b];
  });
}

/** Capture what the reader set in `root` (open details, shown diff panels, typed fields) before a refresh re-renders it. */
export function recordState(root) {
  const details = {};
  for (const [key, el] of detailsKeys(root)) {
    const fields = {};
    if (el.open) [...el.querySelectorAll(FIELDS)].forEach((f, i) => { fields[f.name || i] = f.type === "checkbox" || f.type === "radio" ? f.checked : f.value; });
    details[key] = { open: !!el.open, fields };
  }
  const panels = {};
  for (const p of root.querySelectorAll(PANELS)) if (!p.hidden) panels[panelKey(p)] = p.innerHTML;
  const clamps = clampKeys(root);
  const open = clamps.flatMap(([k, b]) => (b.getAttribute("aria-expanded") === "true" ? [k] : []));
  return { details, panels, open, focus: clamps.find(([, b]) => b === globalThis.document?.activeElement)?.[0] };
}

/** Apply a `recordState` record to the freshly rendered `root`. What the new markup no longer has is ignored. */
export function restoreState(root, state) {
  if (!state) return;
  for (const [key, el] of detailsKeys(root)) {
    const s = state.details?.[key];
    if (!s) continue;
    el.open = s.open;
    [...el.querySelectorAll(FIELDS)].forEach((f, i) => {
      const k = f.name || i;
      if (!(k in s.fields)) return;
      if (f.type === "checkbox" || f.type === "radio") f.checked = s.fields[k];
      else f.value = s.fields[k];
    });
  }
  for (const p of root.querySelectorAll(PANELS)) {
    const html = state.panels?.[panelKey(p)];
    if (html === undefined) continue;
    p.innerHTML = html;
    p.hidden = false;
    if (!p.getAttribute?.("data-diff-for")) for (const b of root.querySelectorAll("button[data-diff]")) b.remove();
  }
  const clamps = new Map(clampKeys(root));
  for (const k of state.open ?? []) if (clamps.has(k)) openClamp(clamps.get(k), true);
  clamps.get(state.focus)?.focus();
}

/** UI state that survives the Now view's refresh: job name to its open diff text, and to its last action message. */
export const openDiffs = new Map();
export const actMessages = new Map();
/** The reason typed in a Decide row, by issue id, so a refresh keeps it. */
export const denyReasons = new Map();

/** A diff as HTML: one span per line, marked by kind. An empty diff says so. */
export const diffHtml = (t) => String(t ?? "").trim()
  ? `<pre>${String(t).split("\n").map((l) => {
      const c = l.startsWith("+++") || l.startsWith("---") || l.startsWith("diff ") || l.startsWith("index ") ? "meta" : l[0] === "+" ? "add" : l[0] === "-" ? "del" : l[0] === "@" ? "hunk" : "";
      return `<span class="l d-${c}">${esc(l)}</span>`;
    }).join("")}</pre>`
  : empty("No changes");

/** Fetch a diff from `url` into `el`: a loading line, then the diff or a `.msg` line. Returns the diff text, or null on a failure. */
export async function loadDiff(el, url) {
  el.innerHTML = loadingLine("the diff");
  const msg = (m) => { el.innerHTML = `<p class="msg">${esc(m)}</p>`; return null; };
  try {
    const res = await fetch(url, { cache: "no-store" });
    const t = await res.text();
    if (!res.ok) return msg(t.trim() || `The diff failed to load (${res.status}).`);
    el.innerHTML = diffHtml(t);
    return t;
  } catch (err) { return msg(`The diff failed to load: ${err.message}`); }
}

const TONES = { "in use": "done", stale: "need", "never read": "quiet", "lint problem": "stuck", running: "run", landing: "run", open: "run", landed: "done", passed: "done", done: "done", closed: "done", waiting: "need", working: "run", queued: "run", returned: "stuck", failed: "stuck", dropped: "quiet", parked: "parked", exploring: "run", built: "done", reran: "run", escalated: "need", red: "stuck", filed: "done", answered: "done", human: "need", rule: "done", director: "parked", firefighter: "stuck", gate: "run" };
/** The badge tone of a state (a job's, land's or issue's): run, done, need, stuck, or quiet for any other. */
export const tone = (state) => TONES[state] ?? "quiet";

// The CSS for these is in app.css (.ph, table.tbl, .idl, .chips, .fbar, .seg, .pager).
// Column order for every table: id or name, title, state badge, priority, project, labels, numbers, then time.

/** The page header: the serif title (none when `title` is empty), a muted count, and an optional right-hand aside (`aside` is HTML); `head` adds a class to the header. */
export const pageHead = (title, { count, aside = "", cls = "", after = "", head = "" } = {}) =>
  `<header class="ph${head ? ` ${head}` : ""}">${title ? `<h1${cls ? ` class="${cls}"` : ""}>${esc(title)}</h1>` : ""}${after}${count != null && count !== "" ? `<span class="count">${esc(count)}</span>` : ""}${aside ? `<div class="aside">${aside}</div>` : ""}</header>`;

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
export const shortModel = (m) => String(m ?? "").replace(/^claude-/, "").replace(/(-\d+)+(\[.*\])?$/, "");

/** An id as a link: mono, small, muted, underlined on hover. */
/** What an issue waits on, one row each; a wait that never ends says so and offers to remove it. */
export function blockersHtml(waits, repo, id) {
  const rows = waits.map((b) => `<div class="blocker">${b.href ? `<a href="${esc(safeHref(b.href))}">${esc(shortText(b.id))}</a>` : esc(shortText(b.id))}${b.title ? ` <span>${esc(b.title)}</span>` : ""}${b.dead ? ` ${tag(b.dead, "stuck")}` : b.state ? ` ${tag(b.state)}` : ""}</div>`).join("");
  const dead = waits.filter((b) => b.dead);
  if (!dead.length) return rows;
  const label = `Stop waiting on ${dead.map((b) => shortText(b.id)).join(", ")}`;
  return rows + `<div class="blocker blocker-dead"><span>A dropped issue or a tracker never finishes, so this wait never ends.</span> ${actButton(label, { act: "unblock", path: `${issueApi(repo, id)}/unblock`, label })}</div>`;
}

export const idLink = (id, href, { title } = {}) => {
  const t = title === undefined ? "" : ` title="${esc(title)}"`;
  return href ? `<a class="idl"${t} href="${esc(safeHref(href))}">${esc(id)}</a>` : `<span class="idp"${t}>${esc(id)}</span>`;
};
/** A commit as its short hash, linked to `url` when there is one. */
export const shaLink = (hash, url) => idLink(String(hash).slice(0, 7), url, { title: hash });

/** "–" for a value that is missing, with the reason as its title. */
export const miss = (reason) => `<span title="${esc(reason)}">–</span>`;
/** A count with its noun: "1 run", "2 runs"; `many` is for a plural that is not `one` + "s". */
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** A muted line of `parts` (HTML), with a "·" between them; an empty part is left out. */
export const meta = (parts) => `<p class="meta">${parts.filter(Boolean).map((p) => `<span>${p}</span>`).join("")}</p>`;
/** A plain sentence under a head or beside a list. */
export const note = (text) => `<p class="note">${esc(text)}</p>`;
/** A head inside a card, under its title. */
export const subHead = (text) => `<h3 class="sub-head">${esc(text)}</h3>`;
/** One table cell of text: `num` right-aligns it; a `wide` cell is the stretching one and shows its text as its title, or `title`. */
export const cell = (v, { num = false, wide = false, title } = {}) => {
  const t = title ?? (wide ? v : undefined);
  return `<td${num || wide ? ` class="${[num && "num", wide && "wide"].filter(Boolean).join(" ")}"` : ""}${t === undefined ? "" : ` title="${esc(t)}"`}>${esc(v)}</td>`;
};
/** A table row of `cells` (each from `cell` or other `<td>` HTML). */
export const row = (cells) => `<tr>${cells.join("")}</tr>`;
/** A stack of rows or cards (HTML). */
export const list = (html) => `<div class="list">${html}</div>`;
/** A named part of a page or card (HTML), with an id to link to. */
export const group = (id, html) => `<div class="grp" id="${esc(id)}">${html}</div>`;

/** The page's place at its top: `« aleph / issues / 628`. Each part is [text, href], and the last part is the page itself; the mark links to `back`. */
export const crumb = (back, parts) => `<nav class="crumb" aria-label="Breadcrumb"><a href="${esc(safeHref(back))}" aria-label="Back">«</a> ${parts.map(([t, h]) => (h ? `<a href="${esc(safeHref(h))}">${esc(t)}</a>` : `<span>${esc(t)}</span>`)).join(" / ")}</nav>`;

/** The repo of an id `<repo>-<n>[.<k>]`, or "" for any other name. */
export const repoOf = (id) => parseId(id)?.repo ?? "";
/** An id as a link with its short id. */
export const repoIdLink = (id, href) => idLink(shortId(id), href);

/** A small badge of any text in one of the badge tones, with an optional title. */
export const tag = (text, tone = "quiet", title) => `<span class="badge ${esc(tone)}"${title === undefined ? "" : ` title="${esc(title)}"`}>${esc(text)}</span>`;

/** A state as a badge, toned by `tone`. */
export const badge = (state) => tag(state, tone(state));

/** A priority as a badge: critical is the alert tone, high the warning tone, medium and low quiet. Missing or unknown reads medium. */
const PRIORITY_TONES = { critical: "stuck", high: "need", medium: "quiet", low: "quiet" };
export function priorityBadge(p) {
  const k = Object.hasOwn(PRIORITY_TONES, p) ? p : "medium";
  return tag(k, PRIORITY_TONES[k]);
}

/** The status row of a detail page around its built parts: the state, the priority, then the labels. */
export const statusRow = (state, priority, labels) => `<div class="status-row">${state}${priority}${labels}</div>`;

/** One chip: `text` escaped, or `html` as given; `el` is the tag, `cls` extra classes, `attrs` extra attributes (with a leading space, already escaped). */
export const chip = (text, { el = "span", cls = "", attrs = "", html } = {}) => `<${el} class="chip${cls ? ` ${cls}` : ""}"${attrs}>${html ?? esc(text)}</${el}>`;

/** Built chips in their row; `el` is the row's tag. */
export const chipRow = (html, el = "span") => `<${el} class="chips">${html}</${el}>`;

/** Labels as small rounded chips; "" for none. */
export const chips = (labels) => (labels?.length ? chipRow(labels.map((l) => chip(l)).join("")) : "");

/** A segmented control. `label` names the group for assistive tech; `items` are `{label, on, attrs, icon?}`, `attrs` the button's own attributes. An `icon` button shows the icon, and its label is the name and the tooltip. */
export const seg = (label, items, attrs = "") =>
  `<div class="seg" role="group" aria-label="${esc(label)}"${attrs}>${items.map((i) => `<button type="button"${i.attrs}${i.icon ? ` aria-label="${esc(i.label)}" title="${esc(i.label)}"` : ""} aria-pressed="${i.on}">${i.icon ? `<wa-icon name="${esc(i.icon)}" aria-hidden="true"></wa-icon>` : esc(i.label)}</button>`).join("")}</div>`;

const opt = (o) => (typeof o === "object" && o ? { value: String(o.value), label: String(o.label ?? o.value) } : { value: String(o), label: String(o) });
/**
 * One row of filter controls, all 28px high. Each group is `{label, name, options, value, data, bare}`; `bare` keeps the label as the accessible name only. A fixed set of
 * options is a segmented control; `data: true` says the options come from the data, and they make a `<select>`.
 * The first option of a filter says All. Options are strings or `{value, label}`. The view wires the events:
 * a segmented button carries `data-name` on its group and `data-value`, pressed is `aria-pressed="true"`.
 */
export function filterBar(groups) {
  const control = (g) => {
    if (g.html) return g.html;
    const name = esc(g.name ?? "");
    const opts = (g.options ?? []).map(opt);
    const cur = String(g.value ?? opts[0]?.value ?? "");
    if (!g.data) return seg(g.label, opts.map((o) => ({ label: o.label, on: o.value === cur, attrs: ` data-value="${esc(o.value)}"` })), ` data-name="${name}"`);
    return `<select name="${name}" aria-label="${esc(g.label ?? "")}">${opts.map((o) => `<option value="${esc(o.value)}"${o.value === cur ? " selected" : ""}>${esc(o.label)}</option>`).join("")}</select>`;
  };
  return `<div class="fbar">${groups.map((g) => `<div class="fg">${g.label && !g.bare ? `<span class="fl">${esc(g.label)}</span>` : ""}${control(g)}</div>`).join("")}</div>`;
}

/** The search field over a table. It stays out of what the filters redraw, so it keeps the focus while the reader types. */
export const searchBox = (ui, value, placeholder) =>
  `<div class="fbar"><input type="search" name="q" data-ui="${esc(ui)}" value="${esc(value ?? "")}" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}"></div>`;

/** The tabs of a page that shows one pane at a time: a segmented control over the panes. `items` is `[[id, label]]`; `panes` maps an id to its HTML; `on` is the open id. A button carries `data-tab`; `wireTabs()` switches the panes. */
export const tabs = (label, items, panes, on = items[0]?.[0]) =>
  `<div class="tabs">${seg(label, items.map(([id, l]) => ({ label: l, on: id === on, attrs: ` data-tab="${esc(id)}"` })))}` +
  items.map(([id]) => `<section data-pane="${esc(id)}"${id === on ? "" : " hidden"}>${panes[id] ?? ""}</section>`).join("") + `</div>`;

/** Switch the panes of each `tabs()` under `root` on a click; `onTab(id, el)` (optional) hears it, to keep the pick. */
export function wireTabs(root, onTab) {
  root._onTab = onTab;
  if (root._tabs) return;
  root._tabs = true;
  root.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tab]"), box = b?.closest(".tabs");
    if (!box) return;
    box.querySelectorAll("button[data-tab]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    box.querySelectorAll(":scope > section[data-pane]").forEach((x) => { x.hidden = x.dataset.pane !== b.dataset.tab; });
    root._onTab?.(b.dataset.tab, box);
  });
}

/** A page's contents beside its `body`: one link per section, in a rail that stays in view. `items` is `[[id, label, sub]]`;
 * a `sub` entry sits indented under the entry before it. The router scrolls an `#id` link in place. */
export const toc = (items, body) =>
  `<div class="toc-wrap"><nav class="toc" aria-label="Contents"><details open><summary>Contents</summary><ol>` +
  items.map(([id, label, sub]) => `<li${sub ? ' class="sub"' : ""}><a href="#${esc(id)}">${esc(label)}</a></li>`).join("") +
  `</ol></details></nav><div class="toc-body">${body}</div></div>`;

/** Marks the entry of the section at the top of the view with `aria-current` (the last entry at the end of the page, a clicked entry until
 * the next scroll by hand or click elsewhere; none when no section is in the band), and closes the contents under 1100px, where they sit above the body. Wiring again drops the last observer and listeners. */
export function wireToc(root) {
  root._toc?.disconnect();
  root._tocOff?.abort();
  const nav = root.querySelector(".toc");
  if (!nav) return;
  if (matchMedia("(max-width: 1100px)").matches) nav.querySelector("details").open = false;
  const links = new Map([...nav.querySelectorAll("a")].map((a) => [a.getAttribute("href").slice(1), a])), seen = new Set();
  let picked = null;
  const mark = () => {
    // The last sections of a page cannot reach the band, so at the end of a page that scrolls the last entry is current.
    const end = scrollY > 0 && scrollY + innerHeight >= document.documentElement.scrollHeight - 1;
    const id = picked ?? (end ? [...links.keys()].pop() : [...links.keys()].find((k) => seen.has(k)));
    for (const [k, a] of links) k === id ? a.setAttribute("aria-current", "location") : a.removeAttribute("aria-current");
    if (!id) return;
    // Scroll the rail, not the page: scrollIntoView() here would stop the router's smooth scroll.
    const a = links.get(id);
    if (a.offsetTop < nav.scrollTop || a.offsetTop + a.offsetHeight > nav.scrollTop + nav.clientHeight) nav.scrollTop = a.offsetTop - nav.clientHeight / 2;
  };
  // A section counts while it crosses the band from 10% to 40% down the view, so a sliver at the top does not; the first in page order is current.
  root._toc = new IntersectionObserver((es) => {
    for (const e of es) e.isIntersecting ? seen.add(e.target.id) : seen.delete(e.target.id);
    mark();
  }, { rootMargin: "-10% 0px -60% 0px" });
  const signal = (root._tocOff = new AbortController()).signal;
  addEventListener("scroll", mark, { passive: true, signal });
  // A clicked entry stays current while the router scrolls to it, which may stop short of the band at the end of a page.
  nav.addEventListener("click", (e) => { const a = e.target.closest?.("a"); if (a) { picked = a.getAttribute("href").slice(1); mark(); } }, { signal });
  for (const t of ["wheel", "touchstart", "keydown"]) addEventListener(t, () => { if (picked) { picked = null; mark(); } }, { passive: true, signal });
  // A click outside the rail also drops the pick, such as one on Edit, which can leave the page at the top with no section in the band.
  addEventListener("click", (e) => { if (picked && !nav.contains(e.target)) { picked = null; mark(); } }, { signal });
  for (const k of links.keys()) { const el = document.getElementById(k); if (el) root._toc.observe(el); }
}

/** A dot and a word for whether something is up: `state` is "fine", "alert" or anything else for unknown (a muted dot). `label` is the whole text. */
export const statusLight = (state, label) =>
  `<span class="light"><span class="event-dot ${state === "fine" || state === "alert" ? state : ""}" aria-hidden="true"></span>${esc(label)}</span>`;

/**
 * The second click of an action that is hard to undo. Call it on the click: it returns true when it armed the button
 * (the text becomes `text`, in the `.ask` look, for `ms`) and false when the button was already armed, so the action goes on.
 */
export function arm(btn, text, ms = 5000) {
  if (btn.classList.contains("ask")) { clearTimeout(btn._t); return false; }
  const was = btn.textContent;
  btn.classList.add("ask");
  btn.textContent = text;
  btn._t = setTimeout(() => { btn.classList.remove("ask"); btn.textContent = was; }, ms);
  return true;
}

/** A `<select>`: `label` is its accessible name; `options` are strings or `{value, label, disabled}`; `o` has `id` and `attrs` (raw attributes). */
export const selectBox = (label, name, options, value, o = {}) =>
  `<select name="${esc(name)}"${o.id ? ` id="${esc(o.id)}"` : ""} aria-label="${esc(label)}"${o.attrs ?? ""}>${options.map((x) => {
    const v = typeof x === "object" ? x : { value: x };
    return `<option value="${esc(v.value)}"${String(v.value) === String(value) ? " selected" : ""}${v.disabled ? " disabled" : ""}>${esc(v.label ?? v.value)}</option>`;
  }).join("")}</select>`;

/** A text, number or search `<input>`; `o` has `id`, `type` (default text) and `attrs` (raw attributes, such as `required` or `pattern`). */
export const inputBox = (name, value, o = {}) =>
  `<input name="${esc(name)}" type="${o.type ?? "text"}"${o.id ? ` id="${esc(o.id)}"` : ""} value="${esc(value ?? "")}"${o.attrs ?? ""}>`;

/** One field of a form: its label over its control; `hint` is a line under it; `check` puts a checkbox control before the label text. */
export const field = (label, control, { hint = "", check = false } = {}) =>
  `<label class="field">${check ? `${control} ${esc(label)}` : `${esc(label)} ${control}`}${hint ? `<small class="hint">${esc(hint)}</small>` : ""}</label>`;

/** A form of fields, stacked, with its submit button and the message beside it; `ui` is the `data-ui` key the view wires. */
export const form = (ui, fields, submit, attrs = "") =>
  `<form class="stack" data-ui="${esc(ui)}"${attrs}>${fields.join("")}${actButton(submit, {}, { primary: true, type: "submit" })} <span class="act-msg" role="status"></span></form>`;

/**
 * One setting: a label, its control and, with `save`, a Save button that submits it alone (a form of its own; the view wires `submit` on `attrs`' data key).
 * `id` is the control's id, so the label names it. Without `save` the control applies on change and the row is a `<div>`. `hint` is a line under the control.
 */
export const setting = (label, control, { id, hint = "", save = "", attrs = "" } = {}) => {
  const body = `<label class="sl"${id ? ` for="${esc(id)}"` : ""}>${esc(label)}</label><span class="sctl">${control}${save ? actButton(save, {}, { type: "submit" }) : ""}</span>` +
    `${hint ? `<small class="hint">${esc(hint)}</small>` : ""}`;
  return save ? `<form class="srow"${attrs}>${body}</form>` : `<div class="srow"${attrs}>${body}</div>`;
};

/** The rows of `setting()`, one group under a name. The settings of a page live here, not in table cells. */
export const settings = (label, rows) => `<div class="settings" role="group" aria-label="${esc(label)}">${rows.join("")}</div>`;

/** A value and its editor in one place: the container's `.editing` class shows the editor and hides the value. */
export const editable = (shown, editor) => `<span class="view-only">${shown}</span><span class="edit-only">${editor}</span>`;

/** Toggle `.editing` on the `.editable` that holds a `data-editor` button: `start` turns it on, anything else (`cancel`) off and resets its forms. */
export function wireEdit(root) {
  if (root._edit) return;
  root._edit = true;
  root.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-editor]"), box = b?.closest(".editable");
    if (!box) return;
    box.classList.toggle("editing", b.dataset.editor === "start");
    if (b.dataset.editor !== "start") box.querySelectorAll("form").forEach((f) => f.reset());
  });
}

// The address holds what changes the data or what a link shares (the window, the project, a filter); keep() holds
// how a component shows it (a chart's form, its hidden series). One key per component, never per row or item.

/** The value last kept for `key`, else `fallback`. Storage can be missing or blocked. */
export function kept(key, fallback = null) {
  try { const v = localStorage.getItem(`aleph.${key}`); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
}
/** Keep `value` (JSON) for `key`. With no storage the value is lost, and the component shows its default. */
export function keep(key, value) {
  try { localStorage.setItem(`aleph.${key}`, JSON.stringify(value)); } catch { /* no storage */ }
}

/** Each `<details data-keep>` of `root` keeps its open state under its own key, as the reader left it. */
export function wireFolds(root) {
  root.addEventListener("toggle", (e) => {
    const d = e.target.closest?.("details[data-keep]");
    if (d) keep(d.dataset.keep, d.open);
  }, true);
}
/** Apply the kept open state to each fold of the freshly rendered `root`; a fold with no kept state shows its default. */
export function restoreFolds(root) {
  for (const d of root.querySelectorAll("details[data-keep]")) {
    const open = kept(d.dataset.keep);
    if (open != null) d.open = open;
  }
}

/** The hash's query. */
export const hashQuery = () => new URLSearchParams(location.hash.split("?")[1] ?? "");
/** A hash split into its path and query; a hash with no path (`#?window=day`) is the path `/`. */
export function parseHash(hash) {
  const h = hash.replace(/^#/, "");
  const i = h.indexOf("?");
  return { path: (i < 0 ? h : h.slice(0, i)) || "/", query: new URLSearchParams(i < 0 ? "" : h.slice(i + 1)) };
}
const withQuery = (changes) => {
  const path = parseHash(location.hash).path;
  const q = hashQuery();
  for (const [k, v] of Object.entries(changes)) { if (v) q.set(k, v); else q.delete(k); }
  return `#${path}${q.toString() ? `?${q}` : ""}`;
};
/** Change the hash's query with no reload: for a selection, a sort or a filter the view redraws itself. */
export const setQuery = (changes) => history.replaceState(null, "", withQuery(changes));
/** Change the hash's query and load the route again: for a filter that changes what the API returns. */
export const goQuery = (changes) => { location.hash = withQuery(changes); };

/** The `.fbar` in `.ph` holds what scopes the whole page; each change goes to the hash and loads the route again. */
export function wireScope(root) {
  const ph = root.querySelector?.(".ph");
  if (!ph) return;
  ph.addEventListener("click", (e) => {
    const b = e.target.closest?.(".seg button");
    if (b) { remember(b.parentElement.dataset.name, b.dataset.value); goQuery({ [b.parentElement.dataset.name]: b.dataset.value }); }
  });
  ph.addEventListener("change", (e) => {
    if (!e.target.matches?.("select")) return;
    remember(e.target.name, e.target.value);
    goQuery({ [e.target.name]: e.target.value });
  });
  const select = ph.querySelector?.('select[name="project"]');
  if (select) projectKeysOnce().then((keys) => { if (keys.length) select.innerHTML = projectOptions(select.value); });
}

const OPTIONS = FACTORY.map((w) => ({ value: w, label: w[0].toUpperCase() + w.slice(1) }));
const isWindow = (w) => FACTORY.includes(w);
/** Remember the project ("" is All) or a window of the Factory pages across the pages; any other control is not kept. */
export function remember(name, value) {
  if (name === "project") keep("project", value || "");
  if (name === "window" && isWindow(value)) keep("window", value);
}

/** The registry's repos from /api/projects: `{ key: { code, issues, onboarded } }`. */
let projects = {};
let keysLoad = null;
/** The registry's repo keys, fetched once; a failed fetch gives [] and is tried again by the next call. */
export const projectKeysOnce = () => keysLoad ??= fetch("/api/projects").then((r) => (r.ok ? r.json() : {})).catch(() => ({})).then((all) => {
  const keys = Object.keys(all);
  if (keys.length) projects = all;
  else keysLoad = null;
  return keys;
});
/**
 * The options of the Project select: All and aleph, then the other onboarded repos, then the other repos with an open issue,
 * each with its count of open issues, once /api/projects has answered. A project of `more` or `cur` that the registry does not hold goes last, with no count.
 */
function projectOptions(cur, more = []) {
  const item = (value, label) => `<option value="${esc(value)}"${value === cur ? " selected" : ""}>${esc(label)}</option>`;
  const named = (k) => item(k, `${k} (${projects[k].issues})`);
  const keys = Object.keys(projects).sort(), rest = keys.filter((k) => k !== "aleph");
  const total = keys.reduce((n, k) => n + projects[k].issues, 0);
  const groups = [
    rest.filter((k) => projects[k].onboarded).map(named),
    [...rest.filter((k) => !projects[k].onboarded && (projects[k].issues > 0 || k === cur)).map(named),
      ...[...new Set([...more, cur])].filter((k) => k && !projects[k]).sort().map((k) => item(k, k))],
  ].filter((g) => g.length);
  return [item("", keys.length ? `All Projects (${total})` : "All Projects"), ...(projects.aleph ? [named("aleph")] : []), ...groups.map((g) => `<hr>${g.join("")}`)].join("");
}

/**
 * The scope of a page from its query `q`, the address's by default. The project ("" is All) and the window come from the
 * address first, then the last one chosen, else All and week.
 * - `url(path)`: the request URL of `path` in the project.
 * - `bar(o)`: the head's Project select, then the window control, then `o.after` (html for a control of the page). `o.more`
 *   adds project names the page knows, `o.project` and `o.value` replace the two
 *   values shown, and `o.name` and `o.options` replace the window control (a window other than `window` is not kept).
 * - `wire(root)`: keep the project and the window in storage and in the address (replaced in place, with no reload; week
 *   stays out of it), and send each change of the bar to the address, which loads the route again.
 */
export function scope(q = typeof location === "undefined" ? new URLSearchParams() : hashQuery()) {
  const w = q.get("window"), t = kept("window");
  const project = q.get("project") || kept("project", ""), window = isWindow(w) ? w : isWindow(t) ? t : "week";
  return {
    project,
    window,
    url: (path) => (project ? `${path}${path.includes("?") ? "&" : "?"}project=${encodeURIComponent(project)}` : path),
    bar: (o = {}) => filterBar([
      { html: `<select name="project" aria-label="Project">${projectOptions(o.project ?? project, o.more)}</select>` },
      { label: "Window", bare: true, name: o.name ?? "window", value: o.value ?? window, options: o.options ?? OPTIONS },
      ...(o.after ? [{ html: o.after }] : []),
    ]),
    wire: (root) => {
      remember("window", window);
      remember("project", project);
      if (window !== "week" && hashQuery().get("window") !== window) setQuery({ window });
      if (project && hashQuery().get("project") !== project) setQuery({ project });
      wireScope(root);
    },
  };
}

/**
 * The trend of a metric card: an arrow and a percent, green when good, amber when bad, muted when `lowerIsGood` is null.
 * `kind` "points" compares shares (0 to 1) in percentage points; "relative" compares times and counts by relative change.
 * The tooltip gives the previous value and the baseline, or `tip`. Empty with no value or no baseline.
 */
export function cardTrend(value, base, prev, { kind, lowerIsGood, format, basis, tip }) {
  if (value === null || value === undefined || base === null || base === undefined) return "";
  const change = kind === "points" ? (value - base) * 100 : base === 0 ? (value === 0 ? 0 : NaN) : ((value - base) / base) * 100;
  if (Number.isNaN(change)) return "";
  const down = change < 0;
  const title = tip ?? `${prev === null || prev === undefined ? "No previous value" : `Previous ${format(prev)}`}; baseline ${format(base)}, ${basis}${kind === "points" ? " (change in percentage points)" : ""}`;
  if (change === 0) return `<span class="tr" title="${esc(title)}">▬ 0%</span>`;
  const tone = lowerIsGood === null ? "" : down === lowerIsGood ? " good" : " warn";
  return `<span class="tr${tone}" title="${esc(title)}">${down ? "▼" : "▲"} ${pct(Math.abs(change))}</span>`;
}

/**
 * A metric card, 3 rows: the key and the trend; the value and the second value; one line of qualifier or note.
 * `v` and `v2` are text; `q` is `[first, second]`, naming the two values; `note` is text when there is no `q`;
 * `trend` is HTML from `cardTrend`; `extra` is HTML (a bar) between the value and row 3.
 * With `key` it selects the detail below it (a button with `data-tile` and `aria-pressed`); with `href` it goes to another page.
 */
export function statCard({ k, v, v2, q, note, trend = "", extra = "", href, key, on = false }) {
  const second = v2 === undefined ? "" : `<em> / ${esc(v2)}</em>`;
  const row3 = q ? `<span class="q"><span>${esc(q[0])}</span><span class="m"> / ${esc(q[1])}</span></span>`
    : note ? `<span class="q m" title="${esc(note)}">${esc(note)}</span>` : "";
  const inner = `<span class="r1"><span class="k">${esc(k)}</span>${trend}</span><b>${esc(v)}${second}</b>${extra}${row3}`;
  if (key) return `<button type="button" class="tile sc" data-tile="${esc(key)}" aria-pressed="${on}">${inner}</button>`;
  return href ? `<a class="tile sc" href="${esc(href)}">${inner}</a>` : `<div class="tile sc">${inner}</div>`;
}
export const tiles = (label, html, id) => `<section class="tiles"${id ? ` id="${esc(id)}"` : ""} aria-label="${esc(label)}">${html}</section>`;
/** Call `fn(key)` when a tile or another selector with `data-tile` under `el` is clicked. */
export function onTile(el, fn) {
  el?.addEventListener("click", (e) => {
    const b = e.target.closest?.("button[data-tile]");
    if (b) fn(b.dataset.tile);
  });
}

/** A block of a page: the section head (`sectionHead`'s options; `id` is also the section's id), `lede` as one summary sentence, then its body. `label` is the aria label, the title by default. */
export const card = (title, body, { count, aside, id, level, cls = "", label = title, lede } = {}) =>
  `<section class="card${cls ? ` ${cls}` : ""}"${id ? ` id="${esc(id)}"` : ""} aria-label="${esc(label)}">${sectionHead(title, { count, aside, id, level })}${lede ? `<p class="lede">${esc(lede)}</p>` : ""}${body}</section>`;

/** The one table: `head` is the cells of the header row, or "" for none; `rows` the rows. */
export const dataTable = (head, rows, { fit = false, id = "" } = {}) =>
  `<div class="tscroll"><table class="tbl${fit ? " fit" : ""}"${id ? ` id="${esc(id)}"` : ""}>${head ? `<thead><tr>${head}</tr></thead>` : ""}<tbody>${rows}</tbody></table></div>`;
/** Plain header cells from labels; a label in `num` is right-aligned. */
export const heads = (labels, num = []) => labels.map((l) => `<th${num.includes(l) ? ' class="num"' : ""}>${esc(l)}</th>`).join("");

/**
 * A 10px bar: `parts` is one share in percent, or segments `{pct, cls}` in percent of the whole bar. `label` (plain text)
 * is the text alternative; with none the bar is hidden from assistive tech, for a bar beside its visible value.
 * `mark` is a tick at that percent.
 */
export function meter(parts, label, { mark = null } = {}) {
  const segs = (Array.isArray(parts) ? parts.filter((s) => s.pct > 0) : [{ pct: parts }]).map((s) => `<i${s.cls ? ` class="${s.cls}"` : ""} style="width:${Number(s.pct).toFixed(1)}%"></i>`).join("");
  return `<span class="meter" ${label ? `role="img" aria-label="${esc(label)}" title="${esc(label)}"` : 'aria-hidden="true"'}>${segs}${mark === null ? "" : `<b style="left:${mark}%"></b>`}</span>`;
}
/**
 * One row of a bar list: a label (HTML), a bar and a value (HTML). `pct` is the bar's width, or `bar` is HTML in its place.
 * `top` marks the largest; with `key` the row is a selector, as a tile is.
 */
export function barRow(label, pct, value, { top = false, key, on = false, bar } = {}) {
  const inner = `<span class="bl">${label}</span>${bar ?? meter(pct)}<span class="bv">${value}</span>`;
  const cls = `barrow${top ? " top" : ""}`;
  return key ? `<button type="button" class="${cls}" data-tile="${esc(key)}" aria-pressed="${on}">${inner}</button>` : `<div class="${cls}">${inner}</div>`;
}
/** The rows of a bar list on one grid, so their bars start and end together. */
export const barList = (rows) => `<div class="bars">${rows}</div>`;

/** The legend of every chart: one line at the top that scrolls when its items do not fit, so it never covers the grid. */
export const legend = { type: "scroll", top: 0, right: 0, itemWidth: 10, itemHeight: 10 };
/** The HTML legend: one `<li>` per `[label, cls]`; a `cls` gives the item a swatch that CSS colours. */
export const legendHtml = (items) => `<ul class="legend">${items.map(([label, cls]) => `<li>${cls ? `<i class="${cls}"></i>` : ""}${esc(label)}</li>`).join("")}</ul>`;
/** The sort after a click on `key`: the same key flips; a new key starts largest first when `downFirst` has it, else smallest first. */
export const nextSort = (cur, key, downFirst) => ({ key, dir: cur?.key === key ? -cur.dir : downFirst.has(key) ? -1 : 1 });
/** The page number in the query `q` (URLSearchParams or object): 1 unless `page` is a larger whole number. */
export function pageOf(q) {
  const v = typeof q.get === "function" ? q.get("page") : q.page;
  return Math.max(1, Number.parseInt(v, 10) || 1);
}
/** `page` held to the pages that `total` rows fill, `step` to a page: a page past the end is the last page. */
const pageIn = (page, total, step) => Math.min(Math.max(1, page), Math.max(1, Math.ceil(total / step)));
/** The rows of page `page` of `rows`, `step` to a page. */
export const pageRows = (rows, page, step = 50) => { const p = pageIn(page, rows.length, step); return rows.slice((p - 1) * step, p * step); };
/** A copy of `rows` in the order of `sort` ({key, dir}); `by[key](row)` is the value, `tie(a, b)` orders equal rows. */
export const sortRows = (rows, by, sort, tie) => [...rows].sort((a, b) => {
  const x = by[sort.key](a), y = by[sort.key](b);
  const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
  return c * sort.dir || (tie ? tie(a, b) : 0);
});
let searchTimer;
/** Wire one table: a sort head (`data-sort`), the pager (`data-page`) and the search input (`[data-ui=opts.search]`) write the hash, then call `opts.redraw`. A sort or a search goes back to page 1. `opts` also has `sortOf(query)` and `downFirst`. */
export function wireTable(root, opts) {
  const go = (changes) => { setQuery(changes); opts.redraw(); };
  root.onclick = (e) => {
    const s = e.target.closest?.("button[data-sort]"), m = e.target.closest?.("button[data-page]");
    if (s) { const n = nextSort(opts.sortOf(Object.fromEntries(hashQuery())), s.dataset.sort, opts.downFirst); go({ sort: n.key, dir: n.dir > 0 ? "asc" : "desc", page: "" }); }
    else if (m) go({ page: m.dataset.page });
  };
  root.oninput = (e) => {
    if (!e.target.matches?.(`[data-ui="${opts.search}"]`)) return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => go({ q: e.target.value, page: "" }), 120);
  };
}

/** Under a long table: "Previous 50" and "Next 50" (`data-page` holds the page each goes to) and "51–100 of 345". */
export function pager(page, total, step = 50, { cls = "" } = {}) {
  const p = pageIn(page, total, step), from = (p - 1) * step, to = Math.min(total, from + step);
  const prev = p > 1 ? actButton(`Previous ${step}`, { page: p - 1 }) : "", next = to < total ? actButton(`Next ${Math.min(step, total - to)}`, { page: p + 1 }) : "";
  return `<div class="pager${cls ? ` ${cls}` : ""}">${prev}${next}<span class="of">${to - from > 1 && total > step ? `${from + 1}–${to}` : to} of ${total}</span></div>`;
}

/** Show page `page` of the rows in `box` (its `tbody` rows, or its list items) and hide the rest. */
export function turnPage(box, page, step = 50) {
  const rows = [...box.querySelectorAll(":scope tbody > tr, :scope > ul > li")], p = pageIn(page, rows.length, step);
  rows.forEach((r, i) => { r.hidden = i < (p - 1) * step || i >= p * step; });
  box.querySelector(".pager").outerHTML = pager(p, rows.length, step);
}

/** A `dataTable` that shows `step` rows and a pager that turns the page in place. `rows` is an array of `<tr>` strings. */
export const pagedTable = (head, rows, step = 50) =>
  `<div class="paged" data-step="${step}">${dataTable(head, rows.map((r, i) => (i < step ? r : r.replace("<tr", "<tr hidden"))).join(""))}${pager(1, rows.length, step)}</div>`;
/** Open or close the clamped text before the button `b`, and set the button to match. */
function openClamp(b, open) {
  b.previousElementSibling.classList.toggle("clamp", !open);
  b.setAttribute("aria-expanded", String(open));
  b.textContent = open ? "Show less" : "Show more";
}

if (typeof document !== "undefined") {
  document.addEventListener("click", (e) => {
    const b = e.target.closest?.(".paged .pager button[data-page]");
    if (!b) return;
    const box = b.closest(".paged");
    turnPage(box, Number(b.dataset.page), Number(box.dataset.step) || 50);
  });
  // After a page turn, bring the top of the table into view. Capture runs before the view's handler draws the table
  // again, so the box is found while the button is still in it; a box drawn again is found by its id.
  document.addEventListener("click", (e) => {
    const b = e.target.closest?.(".pager button[data-page]"), box = b?.closest(".paged, [id]");
    if (!box) return;
    requestAnimationFrame(() => {
      const el = box.isConnected ? box : box.id && document.getElementById(box.id);
      if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: "start" });
    });
  }, true);
}

/** A sortable header cell; `sort` is `{key, dir}` (dir 1 up, -1 down). Every table shows the same arrow. */
export function sortHead(label, key, sort, { num = false } = {}) {
  const on = sort?.key === key;
  return `<th${num ? ' class="num"' : ""}${on ? ` aria-sort="${sort.dir > 0 ? "ascending" : "descending"}"` : ""}><button type="button" data-sort="${esc(key)}">${esc(label)}<span class="arr" aria-hidden="true">${on ? (sort.dir > 0 ? "▲" : "▼") : ""}</span></button></th>`;
}

export const sectionHead = (title, { count, aside, id, level = 2 } = {}) =>
  `<div class="sh"><h${level}${id ? ` id="h-${esc(id)}"` : ""}>${esc(title)}</h${level}>${count != null ? `<span class="count">${esc(count)}</span>` : ""}${aside ? `<span class="aside">${aside}</span>` : ""}</div>`;

/** A Title Case heading in sentence case, for an aria label: "Lead Time" is "Lead time". */
export const sentence = (t) => t[0] + t.slice(1).toLowerCase();

/** Long text, clamped, with a button that opens and closes it. `html` is HTML. */
export const clamp = (html) => `<div class="clamp">${html}</div><button class="link clamp-btn" type="button" aria-expanded="false">Show more</button>`;

/** A fold: `summary` and `body` are HTML. `keep` keeps its open state across page loads; `id` names the fold for a refresh (page memory, no storage), where its summary text changes; `cls` is the fold's class, as `more` for technical details; `head` is the summary's class. */
export const fold = (summary, body, { open = false, keep = "", id = "", cls = "", head = "" } = {}) =>
  `<details${cls ? ` class="${esc(cls)}"` : ""}${id ? ` data-fold="${esc(id)}"` : ""}${keep ? ` data-keep="${esc(keep)}"` : ""}${open ? " open" : ""}><summary${head ? ` class="${esc(head)}"` : ""}>${summary}</summary>${body}</details>`;

/** The first `n` rows of a list; the rest sit under a "N more" fold. `row` returns the HTML inside one `<li>`. */
export const moreFold = (items, row, n = 10) => {
  const ul = (xs) => `<ul class="tight">${xs.map((x) => `<li>${row(x)}</li>`).join("")}</ul>`;
  return ul(items.slice(0, n)) + (items.length > n ? fold(`${items.length - n} more`, ul(items.slice(n))) : "");
};

if (typeof document !== "undefined") {
  document.addEventListener("click", (e) => {
    const b = e.target.closest?.(".clamp-btn");
    if (!b) return;
    openClamp(b, b.getAttribute("aria-expanded") !== "true");
  });
}

/** POSTs `body` as JSON with the header the server wants. Resolves to the JSON reply; throws its `error`, or the text of a reply that is not JSON, when the reply is not ok. */
export async function postJson(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "X-Aleph-UI": "1", "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  if (!res.ok) throw new Error(data?.error || text.trim() || `answered ${res.status}`);
  return data ?? {};
}

/** Shows `text` in the `.act-msg` line beside `el`, and makes the line when there is none. */
export function say(el, text) {
  let n = el.parentElement.querySelector(".act-msg");
  if (!n) { n = document.createElement("span"); n.className = "act-msg"; n.setAttribute("role", "alert"); el.after(n); }
  n.textContent = text;
}

/** An `.act` button: `data` becomes data attributes; `o` has `primary`, `kind` ("danger", "small" or "always"), `cls` (more classes) and `type` (default button). */
export const actButton = (label, data = {}, o = {}) =>
  `<button class="act${o.primary ? " primary" : ""}${o.kind ? ` ${esc(o.kind)}` : ""}${o.cls ? ` ${o.cls}` : ""}" type="${o.type ?? "button"}"` +
  Object.entries(data).map(([k, v]) => ` data-${esc(k)}="${esc(v)}"`).join("") + `>${esc(label)}</button>`;

/** A link that looks like a button, to another page: navigation only. `label` names the page; `href` goes through `safeHref`. */
export const linkButton = (label, href) => `<a class="act" href="${esc(safeHref(href))}">${esc(label)}</a>`;

/** Text with its `code` spans set as code, escaped. */
export const codeText = (t) => esc(t).replace(/`([^`]+)`/g, "<code>$1</code>");

/** A store date or a note's stamp as ms in local time, as the CLI writes them; NaN for neither. */
export const localMs = (s) => Date.parse(String(s ?? "").replace(" ", "T") + (/^\d{4}-\d\d-\d\d$/.test(String(s ?? "")) ? "T00:00" : ""));

/** One fact of a facts list; "" for an empty value. `v` is HTML. */
export const fact = (k, v) => (v ? `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>` : "");
/** The facts list of `[label, html]` pairs. */
export const facts = (rows) => `<dl class="facts">${rows.map(([k, v]) => fact(k, v)).join("")}</dl>`;
import { parseId, shortId, shortText } from "../lib/naming.ts";
import { FACTORY } from "../lib/windows.ts";

/** The API path of issue `<repo>-<ref>`: `/api/issues/a1430`. */
export const issueApi = (repo, ref) => `/api/issues/${encodeURIComponent(shortId(`${repo}-${ref}`))}`;
