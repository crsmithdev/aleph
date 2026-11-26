// Builds index.html: the Events card at its second page under three pager options, drawn by the real helpers from data.json.
// Run: TZ=America/Los_Angeles bun docs/mocks/events-pager/build.ts
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { renderLog } from "../../../ui/views/now.js";
import { actButton, esc } from "../../../ui/views/lib/html.js";

const here = import.meta.dir, { total, pages: [one, two] } = JSON.parse(readFileSync(`${here}/data.json`, "utf8"));
const PAGE = 25, cut = (html) => html.replace(/<div class="fbar">.*?<\/div><\/div><\/div>/, "");
const card = (rows, q) => cut(renderLog({ rows, total }, new URLSearchParams(q)));

// An icon-only pager button: a Font Awesome glyph, with the words in aria-label and title (design/rules.md, "Ellipsis and icons").
const glyph = (icon, label, data = {}) => actButton("", data, { cls: "glyph" }).replace("><", ` aria-label="${label}" title="${label}"><wa-icon name="${icon}" aria-hidden="true"></wa-icon><`);
const range = (text) => `<span class="of">${text}</span>`;
const pagerAt = (html, inner) => html.replace(/<div class="pager">.*?<\/div>/, `<div class="pager">${inner}</div>`);
// 1 and 3 draw the same pager; only the address and the request differ.
const paged = pagerAt(card(two, "page=2"), glyph("chevron-left", `Previous ${PAGE}`, { page: 1 }) + range(`26–50 of ${total}`) + glyph("chevron-right", `Next ${PAGE}`, { page: 3 }));
// 2: both pages in one table, and a More glyph in the pager's place.
const more = pagerAt(card([...one, ...two], ""), glyph("chevron-down", `More ${PAGE}`) + range(`${2 * PAGE} of ${total}`));

const next = two.at(-1).seq, before = one.at(-1).seq, prev = one[0].seq + 1;
const api = (lines) => `<pre class="api">${esc(lines.join("\n"))}</pre>`;
const part = (k, name, why, wire, html) => `<section class="opt"><h2>${k} · ${name}</h2><p>${why}</p>${api(wire)}${html}</section>`;

cpSync(`${here}/../../../ui/app.css`, `${here}/app.css`);
writeFileSync(`${here}/index.html`, `<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8"><title>Events pager options</title>
<link href="https://fonts.googleapis.com/css2?family=Merriweather:wght@400;700&family=Work+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<link href="https://cdnjs.cloudflare.com/ajax/libs/hack-font/3.3.0/web/hack.min.css" rel="stylesheet">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@awesome.me/webawesome@3.14.0/dist-cdn/styles/themes/default.css">
<script type="module" src="https://cdn.jsdelivr.net/npm/@awesome.me/webawesome@3.14.0/dist-cdn/webawesome.loader.js"></script>
<link rel="stylesheet" href="app.css"><link rel="stylesheet" href="mock.css"></head><body><main class="mock">
<p class="lede">Each option shows page 2 of a week's ${total} events (live data, 2026-11-25). Scroll to the pager under each table.</p>
${part("1", "Cursor, Previous and Next", "The pager keeps its place: a left chevron, the range, a right chevron. The address holds a cursor, not a page number. If 3 events arrive while you read, Next still starts at the row after this page's last row.", [
  "address  #/?before=" + before,
  "request  GET /api/log?window=week&before=" + before + "&limit=" + PAGE,
  `reply    { rows: [${PAGE}], next: ${next}, prev: ${prev}, from: ${PAGE + 1}, total: ${total} }`,
  "jobs     GET /api/jobs?before=<time>&limit=500     → { jobs, next }      (same form)",
], paged)}
${part("2", "Cursor, More", "A down chevron adds 25 rows under the ones shown, so the page grows. The pager rule in design/components/pager.md changes to allow it.", [
  "address  #/   (the rows shown are not in the address)",
  "request  GET /api/log?window=week&before=" + before + "&limit=" + PAGE,
  `reply    { rows: [${PAGE}], next: ${next}, total: ${total} }`,
  "jobs     GET /api/jobs?before=<time>&limit=500     → { jobs, next }      (same form)",
], more)}
${part("3", "Two forms by source", "The log and chat keep page numbers, because the server holds those lists whole. Jobs and sessions keep their cursor. If 3 events arrive while you read, Next shows 3 rows again.", [
  "address  #/?page=2",
  "request  GET /api/log?window=week&page=2",
  `reply    { rows: [${PAGE}], total: ${total} }`,
  "jobs     GET /api/jobs?before=<time>&limit=500     → { jobs, next }      (cursor)",
], paged)}
</main></body></html>`);
