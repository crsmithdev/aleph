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
export const money = (n) => `$${(n ?? 0).toFixed(4)}`;

/** "12 min", "2 h 5 min": the span from `from` to `to` (ISO strings). */
export function span(from, to) {
  const ms = Date.parse(to) - Date.parse(from);
  if (!(ms >= 0)) return "";
  const m = Math.floor(ms / 60000);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** The empty state, after old aleph's EmptyState: one sentence, one hint. `hint` is HTML. */
export const empty = (line, hint = "") => `<div class="empty"><p>${esc(line)}</p>${hint ? `<p class="hint">${hint}</p>` : ""}</div>`;

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
