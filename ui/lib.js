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
/** "2:24 am" in local time, or "" for a bad date. */
export const clock12 = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.getHours() % 12 || 12}:${pad(d.getMinutes())} ${d.getHours() < 12 ? "am" : "pm"}`;
};
/** A label as the page shows it: the factory's `goal` label reads "factory". */
export const labelName = (l) => (l === "goal" ? "factory" : l);
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

/** "12 min", "2 h 5 min": the span from `from` to `to` (ISO strings). */
export function span(from, to) {
  const ms = Date.parse(to) - Date.parse(from);
  if (!(ms >= 0)) return "";
  const m = Math.floor(ms / 60000);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
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

const TOKENS = ["bg", "surface", "ink", "rule", "run", "done", "need", "stuck", "focus", "sans", "mono", "chart", "chart-scale", "chart-weight"];
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

/** A model as its short name: "claude-opus-5-5" and "opus" are both "opus"; "" for none. */
export const shortModel = (m) => String(m ?? "").replace(/^claude-/, "").replace(/(-\d+)+(\[.*\])?$/, "");

/** An id as a link: mono, small, muted, underlined on hover. */
export const idLink = (id, href) => `<a class="idl" href="${esc(safeHref(href))}">${esc(id)}</a>`;

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
 * One row of filter controls, all 28px high. Each group is `{label, name, options, value}` (a choice: a
 * segmented control for six options or fewer, a `<select>` for more) or `{label, name, search: true,
 * value, placeholder}` (a search input). Options are strings or `{value, label}`. The view wires the events:
 * a segmented button carries `data-name` on its group and `data-value`, pressed is `aria-pressed="true"`.
 */
export function filterBar(groups) {
  const control = (g) => {
    const name = esc(g.name ?? "");
    if (g.search) return `<input type="search" name="${name}" value="${esc(g.value ?? "")}" placeholder="${esc(g.placeholder ?? "Search")}" aria-label="${esc(g.label ?? "Search")}">`;
    const opts = (g.options ?? []).map(opt);
    const cur = String(g.value ?? opts[0]?.value ?? "");
    if (opts.length <= 6) return `<div class="seg" role="group" aria-label="${esc(g.label ?? "")}" data-name="${name}">${opts.map((o) => `<button type="button" data-value="${esc(o.value)}" aria-pressed="${o.value === cur}">${esc(o.label)}</button>`).join("")}</div>`;
    return `<select name="${name}" aria-label="${esc(g.label ?? "")}">${opts.map((o) => `<option value="${esc(o.value)}"${o.value === cur ? " selected" : ""}>${esc(o.label)}</option>`).join("")}</select>`;
  };
  return `<div class="fbar">${groups.map((g) => `<div class="fg">${g.label ? `<span class="k">${esc(g.label)}</span>` : ""}${control(g)}</div>`).join("")}</div>`;
}

/** Under a long table: "50 of 345" and a "Show 50 more" button (`data-more` holds the step) while rows are left. */
export function pager(shown, total, step = 50) {
  const n = Math.min(shown, total), more = Math.min(step, total - n);
  return `<div class="pager">${more > 0 ? `<button type="button" data-more="${more}">Show ${more} more</button>` : ""}<span class="of">${n} of ${total}</span></div>`;
}

/** A sortable header cell; `sort` is `{key, dir}` (dir 1 up, -1 down). Every table shows the same arrow. */
export function sortHead(label, key, sort, { num = false } = {}) {
  const on = sort?.key === key;
  return `<th${num ? ' class="num"' : ""}${on ? ` aria-sort="${sort.dir > 0 ? "ascending" : "descending"}"` : ""}><button type="button" data-sort="${esc(key)}">${esc(label)}<span class="arr" aria-hidden="true">${on ? (sort.dir > 0 ? "▲" : "▼") : ""}</span></button></th>`;
}

export const sectionHead = (title, { count, aside } = {}) =>
  `<div class="sh"><h2>${esc(title)}</h2>${count != null ? `<span class="count">${esc(count)}</span>` : ""}${aside ? `<span class="aside">${aside}</span>` : ""}</div>`;

export const numCell = (n, { bad = n > 0 } = {}) => `<td class="num${bad ? " bad" : ""}">${esc(n)}</td>`;

export const nameLink = (name, href) => `<a class="nml" href="${esc(href)}">${esc(name)}</a>`;

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
