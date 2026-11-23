// Builds the data freshness mocks: a page age in the page head (variant A) and an age on each panel (variant B).
// parts/ holds the live page's rendered HTML of 2026-11-23: Jobs (a live view of one key) and Memory Health (a
// combined view of three keys). Run: bun docs/mocks/freshness/build.ts
import { esc, notice } from "../../../ui/views/lib/html.js";
import { markLine } from "../../../ui/views/lib/format.js";

const dir = import.meta.dir;
const [jobs, memory] = await Promise.all(["jobs", "memory"].map((n) => Bun.file(`${dir}/parts/${n}.html`).text()));
const NOW = Date.parse("2026-11-23T10:42:30");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

// The proposed rule: one word, `--fs-xs`, muted; `live` takes the ink, with no tone, as design/rules.md keeps tone
// for state. A tooltip lists each key of the page with its build time.
const STYLE = `<style>
.age { margin-left: auto; font: var(--fw-mid) var(--fs-xs) var(--num); color: var(--muted); cursor: default; }
.age.live { color: var(--ink); }
.age.live::before { content: ""; display: inline-block; width: 6px; height: 6px; margin-right: var(--sp-6); border-radius: 50%; border: 1px solid currentColor; vertical-align: 1px; }
.ph .aside + .age { margin-left: 0; }
.sh .aside .age { margin-left: 0; }
.mock-tag { position: fixed; right: 12px; bottom: 12px; z-index: 9; padding: 4px 8px; border: 1px solid var(--rule); border-radius: 4px; background: var(--surface); color: var(--muted); font: var(--fs-xs) var(--mono); }
</style>`;

const clock = (min: number) => new Date(NOW - min * 60_000).toTimeString().slice(0, 8);
/** The tooltip: each key and its build time, one per line. */
const tip = (keys: [string, number][]) => keys.map(([k, m]) => `${k}  ${clock(m)}`).join("\n");
const age = (text: string, keys: [string, number][], live = false) => `<span class="age${live ? " live" : ""}" title="${esc(tip(keys))}">${text}</span>`;

/** `page` with the age at the end of its head, the `#aged` notice and a tag that names the state. */
function page(html: string, head: string, tag: string, aged = "") {
  const out = html
    .replace("</head>", `${STYLE}</head>`)
    .replace(/(<header class="ph">[\s\S]*?)(<\/header>)/, `$1${head}$2`)
    .replace('<div id="aged" hidden=""></div>', aged ? `<div id="aged">${aged}</div>` : '<div id="aged" hidden=""></div>')
    .replace("</body>", `<div class="mock-tag">${esc(tag)}</div></body>`);
  return out;
}

/** `html` with `text` at the start of the aside of the panel named `name`. */
function panelAge(html: string, name: string, text: string) {
  const re = new RegExp(`(<section class="card" aria-label="${name}"><div class="sh">)([\\s\\S]*?)(</div>)`);
  return html.replace(re, (_, a, b, c) =>
    b.includes('class="aside"') ? a + b.replace('<span class="aside">', `<span class="aside">${text}`) + c : `${a}${b}<span class="aside">${text}</span>${c}`);
}

const JOBS: [string, number][] = [["/api/jobs", 0]];
const pages: [string, string, string][] = [
  ["a1-live.html", "A1 · Live", page(jobs, age("live", JOBS, true), "A1 live: stream open, rebuilt on each change")],
  ["a2-aged.html", "A2 · Aged", page(jobs, age("4m", [["/api/jobs", 4]]), "A2 aged: no stream, or a view that is not live")],
  ["a3-rebuild.html", "A3 · Rebuild runs", page(jobs, age("4m", [["/api/jobs", 4]]), "A3 rebuild: the old answer over a rebuild",
    notice(markLine("Jobs", { error: "a rebuild runs; this is the last answer", since: ago(4) }, NOW), true))],
  ["a4-failed.html", "A4 · Build failed", page(jobs, age("12m", [["/api/jobs", 12]]), "A4 failed: the last answer, the build failed",
    notice(markLine("Jobs", { error: "build worker failed: out of memory", since: ago(12) }, NOW), true))],
];

const MEM: [string, number][] = [["/api/memory", 0], ["/api/memory/log", 6], ["/api/memory/processes", 0]];
let b = page(memory, age("live", MEM, true), "B1 per panel: the page is live, one panel is 6m old");
b = panelAge(b, "Writes and Recalls", age("6m", [["/api/memory/log", 6]]));
pages.push(["b1-panels.html", "B1 · Age per panel", b]);

// One strip of the four Jobs heads, to compare the states at a glance.
const head = jobs.match(/<header class="ph">[\s\S]*?<\/header>/)![0];
const strip = (label: string, h: string, aged = "") =>
  `<p class="notice">${esc(label)}</p>${aged ? `<div id="aged" style="margin-bottom:var(--sp-8)">${aged}</div>` : ""}${head.replace("</header>", `${h}</header>`)}`;
const heads = `<!doctype html>${jobs.match(/<head>[\s\S]*?<\/head>/)![0].replace("</head>", `${STYLE}</head>`)}<body><div class="page" style="max-width:1100px">` +
  strip("A1 live", age("live", JOBS, true)) +
  strip("A2 aged", age("4m", [["/api/jobs", 4]])) +
  strip("A3 rebuild runs", age("4m", [["/api/jobs", 4]]), notice(markLine("Jobs", { error: "a rebuild runs; this is the last answer", since: ago(4) }, NOW), true)) +
  strip("A4 build failed", age("12m", [["/api/jobs", 12]]), notice(markLine("Jobs", { error: "build worker failed: out of memory", since: ago(12) }, NOW), true)) +
  "</div></body>";
pages.unshift(["a0-heads.html", "A0 · The four heads side by side", heads]);

for (const [file, , html] of pages) await Bun.write(`${dir}/${file}`, html);
await Bun.write(`${dir}/index.html`, `<!doctype html><meta charset="utf-8"><title>Data freshness</title><link rel="stylesheet" href="app.css"><div class="page"><h1>Data freshness</h1><ul>${pages.map(([f, t]) => `<li><a href="${f}">${esc(t)}</a></li>`).join("")}</ul></div>`);
console.log(pages.map(([f]) => f).join(" "));
