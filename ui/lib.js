// Shared helpers for the factory UI's views: escaping, time and money formats,
// the empty and error states, the copy-command button, and a small Markdown
// renderer. Plain JS with no DOM, so the page and the tests both import it.
// View goals may add to this file but not change what is here.

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

const pad = (n) => String(n).padStart(2, "0");
/** "14:05" in local time, or "" for a bad date. */
export const clock = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
/** A label as the page shows it. */
export const labelName = (l) => l;
export const money = (n) => ((n ?? 0) > 0 && n < 0.005 ? "<$0.01" : `$${(n ?? 0).toFixed(2)}`);

/** `≈1.4% wk` for a job's or session's estimated share of the weekly plan limit; "" without one. */
export const wkText = (wk) => (wk ? `\u2248${wk.pct < 0.05 ? "<0.1" : wk.pct.toFixed(1)}% wk` : "");
const WK_TIP = "An estimate of the share of the weekly plan limit: the cost times the rise in weekly % per dollar aleph saw spent since the last reset. Spend outside aleph (claude.ai chat) is not in the dollars, so it reads high.";
/** The cost cell content (HTML): the weekly share first, with its tooltip, then the dollars. */
export const costHtml = (cost, wk) => {
  const dollars = cost === undefined || cost === null ? "" : esc(money(cost));
  if (!wk) return dollars;
  const tip = WK_TIP + (wk.pooled ? " The rate is the pooled one: this model has under $5 in the window." : "");
  return `<span class="wk" title="${esc(tip)}">${esc(wkText(wk))}</span>${dollars ? ` <span class="quiet">${dollars}</span>` : ""}`;
};

/** "4:12": minutes and seconds from `from` to `to` (ISO strings); minutes may pass 59. */
export function elapsed(from, to) {
  const ms = Date.parse(to) - Date.parse(from);
  if (!(ms >= 0)) return "0:00";
  const t = Math.floor(ms / 1000);
  return `${Math.floor(t / 60)}:${pad(t % 60)}`;
}

/** Seconds as "43s", "4m 05s" or "1h 02m"; "–" for none. Every duration on the page has this form. */
export function dur(s) {
  if (s === null || s === undefined || Number.isNaN(s)) return "–";
  s = Math.round(s);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${pad(s % 60)}s` : `${Math.floor(m / 60)}h ${pad(m % 60)}m`;
}

/** Milliseconds, for a span that can be under a second: "850 ms", "1.5s", then as `dur`; "" for none. */
export const durMs = (ms) => (ms == null ? "" : ms < 1000 ? `${ms} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : dur(ms / 1000));

/** The time from `from` to `to` (ISO strings) as `dur` writes it; "" for a bad pair. */
export function span(from, to) {
  const ms = Date.parse(to) - Date.parse(from);
  return ms >= 0 ? dur(ms / 1000) : "";
}

/** The empty state, after old aleph's EmptyState: one sentence, one hint. `hint` is HTML. */
export const empty = (line, hint = "") => `<div class="empty"><p>${esc(line)}</p>${hint ? `<p class="hint">${hint}</p>` : ""}</div>`;

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

/** The first-load state of a view, shown until its API answers. */
export const loading = (title) => `<div class="page"><p class="quiet loading" role="status">Loading ${esc(title)}…</p></div>`;

/** The error state: what failed, and what to try. */
export const error = (line, hint = "Check that aleph-ui is running, then reload.") =>
  `<div class="error" role="alert"><p>${esc(line)}</p><p class="hint">${esc(hint)}</p></div>`;

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

/** Markdown to HTML: headings, lists, fenced code, paragraphs, inline code, links and [[wiki links]]. Everything else is escaped. */
export function md(src) {
  const lines = String(src ?? "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let para = [], list = null;
  const flushPara = () => { if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`); para = []; };
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
    if (list && /^\s+\S/.test(l)) { list.items[list.items.length - 1] += " " + l.trim(); continue; }
    flushList();
    para.push(l.trim());
  }
  flushPara(); flushList();
  return out.join("\n");
}

/** Call the view's optional `mount(root, data)` after its markup is in `root`. Returns whether it ran. */
export function mountView(view, root, data, query) {
  if (typeof view?.mount !== "function") return false;
  view.mount(root, data, query);
  return true;
}

const PALETTE_EXTRA = ["#C792EA", "#89DDFF"];

/**
 * The ECharts theme for a token map ({bg, surface, ink, rule, run, done, need, stuck, sans}).
 * Series colours run, done, need, stuck, then purple and cyan.
 */
export function chartTheme(t) {
  const axis = { axisLine: { lineStyle: { color: t.rule } }, axisTick: { lineStyle: { color: t.rule } }, axisLabel: { color: t.ink, fontSize: 12 * (Number(t["chart-scale"]) || 1), fontWeight: Number(t["chart-weight"]) || 400 }, splitLine: { lineStyle: { color: t.rule } }, nameTextStyle: { color: t.ink } };
  return {
    color: [t.run, t.done, t.need, t.stuck, ...PALETTE_EXTRA],
    backgroundColor: "transparent",
    textStyle: { color: t.ink, fontFamily: t.chart || t.sans },
    title: { textStyle: { color: t.ink }, subtextStyle: { color: t.ink } },
    legend: { textStyle: { color: t.ink } },
    categoryAxis: axis, valueAxis: axis, timeAxis: axis, logAxis: axis,
    tooltip: { backgroundColor: t.surface, borderColor: t.rule, textStyle: { color: t.ink }, axisPointer: { lineStyle: { color: t.rule }, crossStyle: { color: t.rule } } },
  };
}

const TOKENS = ["bg", "surface", "ink", "rule", "run", "done", "need", "stuck", "hot", "muted", "focus", "sans", "mono", "chart", "chart-scale", "chart-weight", "series-1", "series-2", "series-3", "series-4", "series-5"];
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

// Now fills `.diff-panel[data-diff-for]`; Jobs fills `pre#diff` and removes its `[data-diff]` button once the diff is in.
const PANELS = "[data-diff-for], pre.diff";
const panelKey = (p) => p.getAttribute?.("data-diff-for") ?? "diff";
const FIELDS = "input, textarea, select";

/** `summary text` plus its position among the details with the same summary text. */
function detailsKeys(root) {
  const seen = new Map();
  return [...root.querySelectorAll("details")].map((el) => {
    const text = (el.querySelector("summary")?.textContent ?? "").trim();
    const n = seen.get(text) ?? 0;
    seen.set(text, n + 1);
    return [`${text}#${n}`, el];
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
  return { details, panels };
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
  : `<p class="msg">No changes from the merge base.</p>`;

/** The job states, as the ledger names them (jobs/lib/ledger.ts State), in the order the filters list them. */
export const STATES = ["running", "passed", "awaiting", "failed", "stuck", "done", "landed", "dropped"];
const TONES = { running: "run", landing: "run", open: "run", landed: "done", passed: "done", done: "done", closed: "done", awaiting: "need", building: "run", planning: "run", queued: "run", failed: "stuck", stuck: "stuck", dropped: "quiet" };
/** The badge tone of a state (a job's, land's or issue's): run, done, need, stuck, or quiet for any other. */
export const tone = (state) => TONES[state] ?? "quiet";

// ---------- shared page parts: header, table cells, filter bar, pager ----------
// The CSS for these is in index.html (.ph, table.tbl, .idl, .chips, .fbar, .seg, .pager).
// Column order for every table: id or name, title, state badge, project, labels, numbers, time last.

/** The page header: the serif title, a muted count, and an optional right-hand aside (`aside` is HTML). */
export const pageHead = (title, { count, aside = "" } = {}) =>
  `<header class="ph"><h1>${esc(title)}</h1>${count != null && count !== "" ? `<span class="count">${esc(count)}</span>` : ""}${aside ? `<div class="aside">${aside}</div>` : ""}</header>`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** A table's time, on one line: "Oct 28 08:45" for this year, "2025-12-03" for another; "" for a bad date. */
export function when(ts, now = new Date()) {
  const d = new Date(ts);
  if (ts == null || ts === "" || Number.isNaN(d.getTime())) return "";
  return d.getFullYear() === now.getFullYear()
    ? `${MONTHS[d.getMonth()]} ${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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
  const rows = waits.map((b) => `<div class="blocker">${b.href ? `<a href="${esc(safeHref(b.href))}">${esc(localId(b.id, repo))}</a>` : esc(localId(b.id, repo))}${b.title ? ` <span>${esc(b.title)}</span>` : ""}${b.dead ? ` <span class="badge stuck">${esc(b.dead)}</span>` : b.state ? ` <span class="badge quiet">${esc(b.state)}</span>` : ""}</div>`).join("");
  const dead = waits.filter((b) => b.dead);
  if (!dead.length) return rows;
  const label = `Stop waiting on ${dead.map((b) => localId(b.id, repo)).join(", ")}`;
  return rows + `<div class="blocker blocker-dead"><span>A dropped issue or a tracker never finishes, so this wait never ends.</span> <button class="act" type="button" data-act="unblock" data-repo="${esc(repo)}" data-id="${esc(id)}" data-label="${esc(label)}">${esc(label)}</button></div>`;
}

export const idLink = (id, href) => `<a class="idl" href="${esc(safeHref(href))}">${esc(id)}</a>`;

/** The page's place at its top: `« aleph / issues / 628`. Each part is [text, href], and the last part is the page itself; the mark links to `back`. */
export const crumb = (back, parts) => `<nav class="crumb" aria-label="Breadcrumb"><a href="${esc(safeHref(back))}" aria-label="Back">«</a> ${parts.map(([t, h]) => (h ? `<a href="${esc(safeHref(h))}">${esc(t)}</a>` : `<span>${esc(t)}</span>`)).join(" / ")}</nav>`;

/** The text with each `<repo>-<n>` of this repo as `<n>`. An id of another repo, and a name such as `triage-<repo>-<n>`, stay whole. */
export const localId = (text, repo) => (repo ? String(text ?? "").replace(new RegExp(`(^|[^\\w-])${repo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(?=\\d)`, "g"), "$1") : String(text ?? ""));
/** The repo of an id `<repo>-<n>[.<k>]`, or "" for any other name. */
export const repoOf = (id) => /^(.+)-\d+(?:\.\d+)?$/.exec(String(id))?.[1] ?? "";
/** An id in a view of more than one repo: the project in its own place, then the link with the short id. */
export const repoIdLink = (id, href, repo = repoOf(id)) => `${repo ? `<span class="idp">${esc(repo)}</span> ` : ""}${idLink(localId(id, repo), href)}`;

/** A state as a badge, toned by `tone`. */
export const badge = (state) => `<span class="badge ${tone(state)}">${esc(state)}</span>`;

/** Labels as small rounded chips; "" for none. */
export const chips = (labels) => (labels?.length ? `<span class="chips">${labels.map((l) => `<span class="chip">${esc(labelName(l))}</span>`).join("")}</span>` : "");

const opt = (o) => (typeof o === "object" && o ? { value: String(o.value), label: String(o.label ?? o.value) } : { value: String(o), label: String(o) });
/**
 * One row of filter controls, all 28px high. Each group is `{label, name, options, value, data}`. A fixed set of
 * options is a segmented control; `data: true` says the options come from the data, and they make a `<select>`.
 * The first option of a filter says All. Options are strings or `{value, label}`. The view wires the events:
 * a segmented button carries `data-name` on its group and `data-value`, pressed is `aria-pressed="true"`.
 */
export function filterBar(groups) {
  const control = (g) => {
    const name = esc(g.name ?? "");
    const opts = (g.options ?? []).map(opt);
    const cur = String(g.value ?? opts[0]?.value ?? "");
    if (!g.data) return `<div class="seg" role="group" aria-label="${esc(g.label ?? "")}" data-name="${name}">${opts.map((o) => `<button type="button" data-value="${esc(o.value)}" aria-pressed="${o.value === cur}">${esc(o.label)}</button>`).join("")}</div>`;
    return `<select name="${name}" aria-label="${esc(g.label ?? "")}">${opts.map((o) => `<option value="${esc(o.value)}"${o.value === cur ? " selected" : ""}>${esc(o.label)}</option>`).join("")}</select>`;
  };
  return `<div class="fbar">${groups.map((g) => `<div class="fg">${g.label ? `<span class="fl">${esc(g.label)}</span>` : ""}${control(g)}</div>`).join("")}</div>`;
}

/** The search field over a table. It stays out of what the filters redraw, so it keeps the focus while the reader types. */
export const searchBox = (ui, value, placeholder) =>
  `<div class="fbar"><input type="search" name="q" data-ui="${esc(ui)}" value="${esc(value ?? "")}" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}"></div>`;

// ---------- the address: a selection or a filter lives in the hash ----------

/** The hash's query. */
export const hashQuery = () => new URLSearchParams(location.hash.split("?")[1] ?? "");
const withQuery = (changes) => {
  const [path] = location.hash.replace(/^#/, "").split("?");
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
    if (b) { if (b.parentElement.dataset.name === "window") storeWindow(b.dataset.value); goQuery({ [b.parentElement.dataset.name]: b.dataset.value }); }
  });
  ph.addEventListener("change", (e) => { if (e.target.matches?.("select")) goQuery({ [e.target.name]: e.target.value }); });
}

/** The windows of the Factory pages, and the /api/jobs `days` of each. */
export const WINDOWS = [{ value: "hour", label: "Hour" }, { value: "day", label: "Day" }, { value: "week", label: "Week" }, { value: "month", label: "Month" }];
export const WINDOW_DAYS = { hour: 1 / 24, day: 1, week: 7, month: 30 };
const WINDOW_KEY = "aleph.window";
const isWindow = (w) => Object.hasOwn(WINDOW_DAYS, w);
/** Remember the window across the pages; storage may be missing or full. */
export function storeWindow(w) { try { if (isWindow(w)) localStorage.setItem(WINDOW_KEY, w); } catch { /* no storage: the address still holds it */ } }
/** The window of a page: the address first, then the last one chosen, else week. */
export function windowOf(q) {
  const w = q?.get?.("window");
  if (isWindow(w)) return w;
  try { const t = localStorage.getItem(WINDOW_KEY); if (isWindow(t)) return t; } catch { /* no storage */ }
  return "week";
}
/** Keep the window in storage and in the address (replaced in place, with no reload); week is the default and stays out of the address. */
export function keepWindow(w) {
  storeWindow(w);
  if (w !== "week" && hashQuery().get("window") !== w) setQuery({ window: w });
}

// ---------- the blocks of a page: tile, card, table, bar list ----------

/**
 * A metric tile. With `key` it selects the detail below it: a button with `data-tile` and `aria-pressed`.
 * With `href` it goes to another page. With neither it has no detail, and it is a plain block. `v` is text, `vHtml` is HTML.
 */
export function tile({ k, v = "", vHtml, body = "", key, on = false, href }) {
  const inner = `<span class="k">${esc(k)}</span><b>${vHtml ?? esc(v)}</b>${body}`;
  if (key) return `<button type="button" class="tile" data-tile="${esc(key)}" aria-pressed="${on}">${inner}</button>`;
  return href ? `<a class="tile" href="${esc(href)}">${inner}</a>` : `<div class="tile">${inner}</div>`;
}
export const tiles = (label, html) => `<section class="tiles" aria-label="${esc(label)}">${html}</section>`;
export const small = (t) => `<small>${esc(t)}</small>`;
/** Call `fn(key)` when a tile or another selector with `data-tile` under `el` is clicked. */
export function onTile(el, fn) {
  el?.addEventListener("click", (e) => {
    const b = e.target.closest?.("button[data-tile]");
    if (b) fn(b.dataset.tile);
  });
}

/** A block of a page: the section head (`sectionHead`'s options, plus `id`), then its body. */
export const card = (title, body, { count, aside, id, cls = "" } = {}) =>
  `<section class="card${cls ? ` ${cls}` : ""}"${id ? ` id="${esc(id)}"` : ""} aria-label="${esc(title)}">${sectionHead(title, { count, aside })}${body}</section>`;

/** The one table: `head` is the cells of the header row, or "" for none; `rows` the rows. */
export const dataTable = (head, rows, { fit = false, id = "" } = {}) =>
  `<div class="tscroll"><table class="tbl${fit ? " fit" : ""}"${id ? ` id="${esc(id)}"` : ""}>${head ? `<thead><tr>${head}</tr></thead>` : ""}<tbody>${rows}</tbody></table></div>`;
/** Plain header cells from labels; a label in `num` is right-aligned. */
export const heads = (labels, num = []) => labels.map((l) => `<th${num.includes(l) ? ' class="num"' : ""}>${esc(l)}</th>`).join("");

/**
 * One row of a bar list: a label (HTML), a bar and a value (HTML). `pct` is the bar's width, or `bar` is HTML in its place.
 * `top` marks the largest; with `key` the row is a selector, as a tile is.
 */
export function barRow(label, pct, value, { top = false, key, on = false, bar } = {}) {
  const inner = `<span class="bl">${label}</span><span class="bb">${bar ?? `<i style="width:${Number(pct).toFixed(1)}%"></i>`}</span><span class="bv">${value}</span>`;
  const cls = `barrow${top ? " top" : ""}`;
  return key ? `<button type="button" class="${cls}" data-tile="${esc(key)}" aria-pressed="${on}">${inner}</button>` : `<div class="${cls}">${inner}</div>`;
}
/** The rows of a bar list on one grid, so their bars start and end together. */
export const barList = (rows) => `<div class="bars">${rows}</div>`;

/** The ECharts option for bars over categories. Each series is `{name, data, color?}`; a `color` function gives each bar its own. */
export const barsOption = (labels, series, { labels: showValues = false } = {}) => ({
  animation: false,
  grid: { left: 32, right: 8, top: showValues ? 20 : 8, bottom: 20 },
  xAxis: { type: "category", data: labels, axisTick: { show: false } },
  yAxis: { type: "value", minInterval: 1, splitLine: { show: true } },
  tooltip: { trigger: "axis", confine: true, axisPointer: { type: "shadow" } },
  series: series.map((s) => ({ type: "bar", barMaxWidth: 64, name: s.name, data: s.data, ...(s.color ? { itemStyle: { color: s.color } } : {}), ...(showValues ? { label: { show: true, position: "top", textBorderWidth: 0 } } : {}) })),
});
/** The ECharts option for one line over categories, `area` filled. */
export const lineOption = (labels, name, data, { interval = "auto", step = false, formatter, max } = {}) => ({
  animation: false,
  grid: { left: 32, right: 16, top: 8, bottom: 20 },
  tooltip: { trigger: "axis", confine: true, ...(formatter ? { formatter } : {}) },
  xAxis: { type: "category", boundaryGap: false, data: labels, axisTick: { show: false }, axisLabel: { interval, hideOverlap: true } },
  yAxis: { type: "value", min: 0, ...(max ? { max } : {}), minInterval: 1, splitLine: { lineStyle: { opacity: 0.5 } }, axisTick: { show: false } },
  series: [{ type: "line", name, step: step ? "end" : false, symbol: "none", lineStyle: { width: step ? 0 : 2 }, areaStyle: { opacity: step ? 0.85 : 0.15 }, data }],
});

/** Under a long table: "50 of 345" and a "Show 50 more" button (`data-more` holds the step) while rows are left. */
export function pager(shown, total, step = 50) {
  const n = Math.min(shown, total), more = Math.min(step, total - n);
  return `<div class="pager">${more > 0 ? `<button type="button" class="act" data-more="${more}">Show ${more} more</button>` : ""}<span class="of">${n} of ${total}</span></div>`;
}

/** A sortable header cell; `sort` is `{key, dir}` (dir 1 up, -1 down). Every table shows the same arrow. */
export function sortHead(label, key, sort, { num = false } = {}) {
  const on = sort?.key === key;
  return `<th${num ? ' class="num"' : ""}${on ? ` aria-sort="${sort.dir > 0 ? "ascending" : "descending"}"` : ""}><button type="button" data-sort="${esc(key)}">${esc(label)}<span class="arr" aria-hidden="true">${on ? (sort.dir > 0 ? "▲" : "▼") : ""}</span></button></th>`;
}

export const sectionHead = (title, { count, aside } = {}) =>
  `<div class="sh"><h2>${esc(title)}</h2>${count != null ? `<span class="count">${esc(count)}</span>` : ""}${aside ? `<span class="aside">${aside}</span>` : ""}</div>`;

/** The tags Claude Code and its hooks wrap around text the user did not type. */
const SYSTEM_TAGS = ["task-notification", "system-reminder", "local-command-stdout", "local-command-stderr", "local-command-caveat", "command-name", "command-message", "command-args", "user-prompt-submit-hook", "bash-input", "bash-stdout", "bash-stderr"];
const SYSTEM_RE = new RegExp(`^[ \\t]*<(${SYSTEM_TAGS.join("|")})(?:\\s[^>\\n]*)?>([\\s\\S]*?)(?:</\\1>|$(?![\\s\\S]))`, "gm");
/**
 * A prompt split into its system parts and the text the user typed: `{ system: [{tag, body}], text }`.
 * A tag counts only at the start of a line, so a prompt that quotes `<system-reminder>` keeps it.
 * An unclosed tag (the hooks cut a prompt at 4 KB) runs to the end.
 */
export function systemParts(src) {
  const system = [];
  const text = String(src ?? "").replace(SYSTEM_RE, (_, tag, body) => (system.push({ tag, body: body.trim() }), "")).trim();
  return { system, text };
}
