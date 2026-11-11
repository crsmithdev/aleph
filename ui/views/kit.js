// #/kit: the design language's specimens. Each component of docs/design.md, drawn by its real helper from fixture
// data, in each of its states, so a review sees the code's own output. Each specimen has a `data-annotate` id, so a
// note pinned on it stays across a redraw. Beside each specimen are its rules, read from docs/design.md through
// /api/design, so the doc stays the one place they are written. The sidebar leaves the page out.
import { actButton, idLink, badge, bytes, clock, count, day, days, dur, durMs, error, hourLabel, hours, loading, mean, money, pct, scope, shortModel, span, when, wkText, barList, barRow, legendHtml, card, cardTrend, chips, clamp, cmd, crumb, dataTable, diffHtml, empty, facts, filterBar, heads, md, meter, pageHead, pager, priorityBadge, seg, sortHead, statCard, tag, tiles } from "../lib.js";
import { panelOf } from "../chart.js";
import { detailPanel, panel, renderKpis, renderTimeline } from "../timeline.js";
import { askCard } from "./cards.js";
import { eventRow, findingHtml, renderLanes } from "./now.js";
import { bar } from "./speed.js";

const THEMES = ["system", "light", "dark"];
const DAY = 864e5, T0 = new Date(2026, 10, 3).getTime();

/** The doc's section under the heading `name` (any level), to the next heading of the same level or higher; "" for none. */
export function section(doc, name) {
  const lines = String(doc ?? "").split("\n"), i = lines.findIndex((l) => /^#{2,4} /.test(l) && l.replace(/^#+ /, "") === name);
  if (i < 0) return "";
  const level = lines[i].indexOf(" "), end = lines.findIndex((l, j) => j > i && /^#{1,4} /.test(l) && l.indexOf(" ") <= level);
  return lines.slice(i + 1, end < 0 ? undefined : end).join("\n").trim();
}

let doc = "";
/** One specimen: its name, a line on what it shows, its HTML, and the rules under the doc's heading `rules` (none for ""). Not a card, so a card in it is not nested. */
const spec = (id, title, body, note = "", rules = title) => {
  const names = [rules].flat().filter(Boolean);
  const text = names.length > 1 ? names.map((n) => `#### ${n}\n\n${section(doc, n)}`).join("\n\n") : names.length ? section(doc, names[0]) : "";
  return `<section class="kit-spec" id="kit-${id}" data-annotate="kit/${id}"><h3>${title}</h3>` +
    `<div class="kit-specimen">${note ? `<p class="hint">${note}</p>` : ""}${body}</div>${text ? `<div class="kit-rules md">${md(text)}</div>` : ""}</section>`;
};
const row = (...xs) => `<div class="kit-row">${xs.join("")}</div>`;

const FRAMES = {
  time: {
    measure: { name: "Agents Live", unit: "count", agg: "max" },
    over: { kind: "time", window: "week" },
    by: { name: "Role", keys: [{ key: "worker", name: "Worker", color: "series-1" }, { key: "triage", name: "Triage", color: "series-2" }, { key: "reviewer", name: "Reviewer", color: "series-3" }] },
    rows: [3, 4, 2, 5, 3, 1, 4].map((n, i) => ({ at: new Date(T0 + i * DAY).toISOString(), worker: n, triage: (i % 3) + 1, reviewer: i % 2 })),
  },
  category: {
    measure: { name: "Outcomes", unit: "count", agg: "sum" },
    over: { kind: "category", name: "Role" },
    by: { name: "Outcome", keys: [{ key: "succeeded", name: "Succeeded", color: "done" }, { key: "failed", name: "Failed", color: "need" }, { key: "stuck", name: "Stuck", color: "stuck" }] },
    rows: [{ name: "Worker", succeeded: 31, failed: 4, stuck: 1 }, { name: "Triage", succeeded: 12, failed: 1, stuck: 0 }, { name: "Reviewer", succeeded: 9, failed: 2, stuck: 2 }],
  },
  cost: {
    measure: { name: "Cost", unit: "usd", agg: "sum" },
    over: { kind: "time", window: "week" },
    by: { name: "Model", keys: [{ key: "cost", name: "Cost", color: "series-1" }] },
    legend: false,
    rows: [12.4, 9.1, 15.75, 7.2, 11.05, 3.4, 8.9].map((n, i) => ({ at: new Date(T0 + i * DAY).toISOString(), cost: n })),
  },
  none: {
    measure: { name: "Cost", unit: "usd", agg: "sum" },
    over: { kind: "time", window: "week" },
    by: { name: "Model", keys: [{ key: "cost", name: "Cost", color: "series-1" }] },
    rows: [],
  },
};

const ISSUES = Array.from({ length: 8 }, (_, i) => ({
  at: new Date(T0 - i * 37e5).toISOString(), id: `a${1700 + i}`,
  title: ["Give each component in design.md a live render", "Fail CI on a new hard-coded colour in ui/", "Show the cost of each run on its job page"][i % 3],
  state: ["open", "landed", "failed", "waiting", "parked"][i % 5], project: i % 4 ? "aleph" : "sidetone", labels: i % 2 ? ["ui"] : ["ui", "design"], cost: (i * 1.37) % 9,
}));
const issueRow = (x) => `<tr><td>${when(x.at)}</td>` +
  `<td><a class="idl" href="#/kit">${x.id}</a></td><td class="wide">${x.title}</td><td>${badge(x.state)}</td><td>${x.project}</td><td>${chips(x.labels)}</td><td class="num">${money(x.cost)}</td></tr>`;
const ISSUE_HEAD = (sort) => [sortHead("Updated", "at", sort), sortHead("Issue", "id", sort), sortHead("Title", "title", sort), "<th>State</th>", "<th>Project</th>", "<th>Labels</th>", sortHead("Cost", "cost", sort, { num: true })].join("");

const MD = `A paragraph with \`code\`, **bold**, *em* and a [link](#/kit).

- one item
- two items

| Column | Value |
|---|---|
| tests | 71s |

\`\`\`
bun test ui/kit.test.ts
\`\`\``;

const DIFF = `diff --git a/ui/app.css b/ui/app.css
@@ -12,3 +12,3 @@
 .badge { border-radius: var(--r-tag); }
-.chip { border-radius: 9px; }
+.chip { border-radius: var(--r-pill); }`;

const H = (h, m = 0) => new Date(2026, 10, 10, h, m).getTime();
const TIMELINE = [{ title: "Runs", rows: [
  { head: "<span class=\"t\">build 1</span>", bars: [{ start: H(8, 10), end: H(8, 30), tone: "build", label: "build" }, { start: H(8, 30), end: H(8, 34), tone: "bad", label: "checks" }], waits: [{ start: H(8, 34), end: H(9, 2), chris: true }], marks: [], result: badge("returned"), time: dur(1440), cost: money(2.3), events: [{ at: H(8, 34), tag: "returned", tone: "stuck", html: "Checks failed: <code>ui/page.test.ts</code>." }] },
  { head: "<span class=\"t\">build 2</span>", bars: [{ start: H(9, 2), end: H(9, 20), tone: "build", label: "build" }, { start: H(9, 20), end: H(9, 24), tone: "land", label: "land" }], waits: [], marks: [{ at: H(9, 24), tone: "done", tip: "landed" }], result: badge("landed"), time: dur(1320), cost: money(1.82), events: [{ at: H(9, 24), tag: "landed", tone: "done", html: "Landed on main." }] },
] }];
const NOW = "2026-11-10T17:00:00Z";
const STATUS = {
  now: NOW, factory: { liveRuns: 1, liveCap: 5 }, doneCount: 1,
  running: [{ name: "aleph-1700", repo: "aleph", item: { id: 1700, title: "Give each component in design.md a live render", priority: "high" }, run: { kind: "agent", started: "2026-11-10T16:40:00Z" }, model: "claude-sonnet-5-5", started: "2026-11-10T16:40:00Z" }],
  queued: [{ repo: "aleph", id: 1701, title: "Fail CI on a new hard-coded colour in ui/", priority: "medium", stage: "queued", at: "2026-11-10T16:00:00Z" }],
  done: [{ id: "aleph-1702", href: "#/kit", title: "Show the cost of each run on its job page", priority: "low", finished: "2026-11-10T15:30:00Z" }],
};
const ASK = {
  id: "aleph-41", href: "#/kit", repo: "aleph", key: "issue:aleph-41", kind: "input", card: "decide", reason: "question", label: "Decide", tag: "question",
  title: "Pick the time format for a day with no time", headline: "Pick the time format for a day with no time", priority: "high", at: "2026-11-10T16:00:00Z",
  situation: "Two tables show a day with no time two ways: Oct 28 and 10/28.",
  actions: [{ label: "Oct 28", act: "kit", path: "/api/kit", primary: true }, { label: "10/28", act: "kit", path: "/api/kit" }, { label: "Deny", act: "kit", path: "/api/kit", input: { name: "reason" } }],
};
const FEED = [
  { at: "2026-11-10T16:58:00Z", subject: "aleph-1700", action: "landed", by: "agent", sub: "build 2" },
  { at: "2026-11-10T16:40:00Z", subject: "aleph-1701", action: "returned", by: "agent", sub: "build 1", note: "checks failed" },
];
const FLOW = { window: "week", classes: [{ key: "landed", hours: 40, text: "reached main" }, { key: "returned", hours: 12, text: "sent back once" }, { key: "failed", hours: 6, lost: true, text: "did not land" }, { key: "dropped", hours: 3, lost: true, text: "dropped" }] };

const COLOURS = [["surfaces", "Surfaces and text", /^--(bg|surface|sunk|raised|ink|ink-2|muted|rule|rule-2|on-fill)$/],
  ["tones", "Tones", /^--(run|done|need|stuck|good|hot|add|del|focus|approve|decide|unstick|quiet)(-bg|-ring)?$/],
  ["data", "Data colours", /^--(series|chart|seg|fill)-/]];
// The pairs of the doc's Contrast table.
const PAIRS = [["--ink", "--surface"], ["--ink-2", "--surface"], ["--muted", "--surface"], ["--muted", "--bg"], ["--muted", "--sunk"], ["--muted", "--raised"],
  ["--need", "--need-bg"], ["--stuck", "--stuck-bg"], ["--done", "--done-bg"], ["--run", "--run-bg"], ["--hot", "--surface"], ["--focus", "--surface"], ["--on-fill", "--seg-reran"]];
const AGO = new Date(T0 - 3 * 36e5);
const VALUES = [
  ["Absolute time", "when()", when, [AGO]], ["Day", "day()", day, [AGO]], ["Axis hour", "hourLabel()", hourLabel, [new Date(2026, 10, 10, 4), new Date(2026, 10, 10, 13, 36)], "none"],
  ["Clock", "clock()", clock, [AGO.toISOString()]], ["Duration from seconds", "dur()", dur, [43, 245, 3720, 187200]], ["Duration from milliseconds", "durMs()", durMs, [850, 1200]],
  ["Duration between two times", "span()", (a) => span(a, new Date(T0).toISOString()), [AGO.toISOString()]], ["Cost", "money()", money, [1.25, 0.003]], ["Weekly share", "wkText()", wkText, [{ pct: 1.4 }, { pct: 0.4 }]],
  ["Percent", "pct()", pct, [12, 0.4, 0.03]], ["Count", "count()", count, [12345]], ["Id", "idLink()", (x) => idLink(x, "#/kit"), ["a52"], "none"],
  ["Model", "shortModel()", shortModel, ["claude-opus-5-5"]], ["Bytes", "bytes()", bytes, [1536], "none"], ["Mean", "mean()", mean, [2.44]],
  ["Hours", "hours()", hours, [3.2, 12]], ["Days", "days()", days, [12]],
];

function renderKit(d, query) {
  doc = d?.body ?? "";
  const theme = THEMES.includes(query?.get?.("theme")) ? query.get("theme") : "system";
  const sort = { key: "at", dir: -1 };
  return `<div class="page kit">${crumb("#/", [["aleph", "#/"], ["kit"]])}` +
    pageHead("Kit", { aside: seg("Theme", THEMES.map((t) => ({ label: t[0].toUpperCase() + t.slice(1), on: t === theme, attrs: ` data-theme-pick="${t}"` }))) }) +
    `<p class="hint">Each component of <code>docs/design.md</code>, drawn by its own helper. Pin a note on a specimen with the annotate tool.</p>` +
    `<section class="kit-spec" data-annotate="kit/every"><h3>Every component</h3><div class="kit-rules md">${md(section(doc, "Every component"))}</div></section>` +

    `<h2 class="kit-h">Foundations</h2>` +
    COLOURS.map(([id, name]) => spec(id, name, `<div class="kit-swatches" data-tokens="${id}"></div>`, id === "surfaces" ? "Each swatch: light on the left, dark on the right, read from the stylesheet." : "")).join("") +
    spec("contrast", "Contrast", `<div data-tokens="contrast"></div>`, "Each ratio is computed now from the light and the dark token values. Text needs 4.5:1.") +
    spec("type", "Type", `<div data-tokens="type"></div>`, "", ["Sizes", "Weights and families", "Tracking and line height"]) +
    spec("space", "Space and shape", `<div class="kit-row" data-tokens="space"></div><div class="kit-row" data-tokens="radius"></div><div class="kit-row" data-tokens="layers"></div>`, "",
      ["Spacing", "Radii", "Controls and layers", "Breakpoints and motion"]) +

    `<h2 class="kit-h">Content</h2>` +
    spec("values", "Values", dataTable(heads(["Kind", "Helper", "Renders", "Missing"]), VALUES.map(([k, h, f, xs, none]) =>
      `<tr><td>${k}</td><td><code>${h}</code></td><td class="num">${xs.map((x) => f(x)).join(", ")}</td><td class="num">${none ? '<span class="quiet">none</span>' : f(null) || '<span class="quiet">empty</span>'}</td></tr>`).join(""), { fit: true }),
      "Each helper's output now, and its output for no value.") +
    spec("words", "Words", pageHead("Running", { count: 3 }) + row(badge("running"), badge("landed"), priorityBadge("critical")) +
      empty("No job matches.", "Widen the window or clear a filter.") + error("The agents did not load.") + loading("Jobs")) +

    `<h2 class="kit-h">Structure</h2>` +
    spec("page-head", "Page head", pageHead("Jobs", { count: 128, aside: scope(new URLSearchParams("project=aleph&window=week")).bar() })) +
    spec("detail-panel", "Detail panel", panel("kit-spec", "Spec", `<div class="md">${md("The **spec** of an issue, as Markdown, at most 80 characters wide.")}</div>`, "updated 11/10") + detailPanel("Notes", "2 notes", "<p>An open fold of a detail page.</p>")) +
    spec("kpis", "KPI strip", renderKpis([{ k: "Took", v: dur(574), sub: "build 1" }, { k: "Cost", v: money(4.12), sub: "2 runs" }, { k: "Result", v: "landed", sub: "on main", text: true }])) +
    spec("status-row", "Status row", `<div class="status-row">${badge("running")}${priorityBadge("high")}${chips(["ui", "design"])}</div>`, "Written by hand: the status row has no helper yet.") +
    spec("card", "Card", card("Section", "<p>The body of a card.</p>", { count: 3, aside: actButton("Action") })) +
    spec("facts", "Fact list", facts([["Started", "11/10 08:45"], ["Took", dur(574)], ["Model", "opus"], ["Cost", "$4.12"], ["Branch", "<code>feature/kit-page</code>"]])) +

    `<h2 class="kit-h">Data</h2>` +
    spec("metric", "Metric card", tiles("Metric cards",
      statCard({ k: "Runs", v: "198", trend: cardTrend(198, 160, 171, { kind: "relative", lowerIsGood: false, format: String, basis: "4-week mean" }), note: "today" }) +
      statCard({ k: "Lead time", v: "2.4h", trend: cardTrend(2.4, 1.8, 2, { kind: "relative", lowerIsGood: true, format: String, basis: "4-week mean" }), note: "median" }) +
      statCard({ k: "Worker slots", v: "2", v2: "5", q: ["in use", "cap"], extra: meter(40, "2 of 5 in use") }) +
      statCard({ k: "Share", v: "61%", trend: cardTrend(0.61, 0.61, 0.6, { kind: "points", lowerIsGood: null, format: String, basis: "4-week mean" }), note: "no change" }) +
      statCard({ k: "Cost", v: "–", note: "No run recorded a cost in this window." }) +
      statCard({ k: "Link", v: "12", note: "goes to another page", href: "#/kit" }) +
      statCard({ k: "Selector", v: "7", note: "pressed", key: "a", on: true }) +
      statCard({ k: "Selector", v: "3", note: "not pressed", key: "b" }))) +
    spec("table", "Table", dataTable(ISSUE_HEAD(sort), ISSUES.map(issueRow).join("")), "Column order: time, id, title, state, project, labels, numbers.") +
    spec("table-fit", "Table, fit", dataTable(heads(["Role", "Runs", "p50"], ["Runs", "p50"]), `<tr><td>Worker</td><td class="num">31</td><td class="num">6m 40s</td></tr><tr><td>Triage</td><td class="num">12</td><td class="num">38s</td></tr>`, { fit: true }), "", "") +
    spec("table-empty", "Table, empty", empty("No job ran in this window.", "Pick a longer window."), "", "") +
    spec("chart", "Chart panel", `<div class="trio">${panelOf("kit/time", FRAMES.time)}${panelOf("kit/category", FRAMES.category)}${panelOf("kit/cost", FRAMES.cost)}</div>`,
      "A level over time (Area), a category (Stacked), and a flow of one key with no legend (Columns).") +
    spec("chart-empty", "Chart panel, no data", panelOf("kit/none", FRAMES.none), "", "") +
    spec("meter", "Meter", row(meter(64, "64%"), meter([{ pct: 50, cls: "c-use" }, { pct: 20 }], "50% and 20%"), meter(30, "30% with a mark at 70%", { mark: 70 })) +
      barList(barRow("Worker", 80, money(31.2), { top: true }) + barRow("Triage", 35, money(13.65)) + barRow("Reviewer", 12, money(4.7)))) +
    spec("outcome", "Outcome bar", bar(FLOW, "landed")) +
    spec("legend", "Legend", legendHtml([["build", "t-build"], ["bad", "t-bad"], ["land", "t-land"], ["wait", "t-wait"], ["awaiting you", "t-chris"]])) +
    spec("timeline", "Timeline", renderTimeline(TIMELINE)) +

    `<h2 class="kit-h">Lists of items</h2>` +
    spec("lanes", "Item card and lane", renderLanes(STATUS), "", ["Item card", "Lane"]) +
    spec("ask", "Ask card", askCard(ASK, STATUS.now)) +
    spec("feed", "Feed row", FEED.map((e) => eventRow(e)).join("")) +
    spec("findings", "Findings list", `<ol class="findings">${["Two jobs ran over the cap at `09:12`.", "No check failed."].map((f) => `<li>${findingHtml(f)}</li>`).join("")}</ol>`) +

    `<h2 class="kit-h">Labels</h2>` +
    spec("badge", "Badge", row(...["open", "running", "landed", "waiting", "failed", "parked", "dropped"].map(badge)) + row(...["critical", "high", "medium", "low"].map(priorityBadge)) + row(tag("any text"), tag("with a title", "need", "the title"))) +
    spec("chip", "Chip", chips(["ui", "design", "a-long-label-name"])) +

    `<h2 class="kit-h">Actions</h2>` +
    spec("button", "Button", row(actButton("Retry"), actButton("Land", {}, { primary: true }), actButton("Drop", {}, { cls: "warn" }), `<button class="act" type="button" disabled>Disabled</button>`)) +
    spec("link-button", "Link button", row(`<a class="act" href="#/kit">Issue</a>`, `<a class="act" href="#/kit">Next sub-issue: a1701</a>`), "Written by hand: the link button has no helper yet.") +
    spec("link", "Link", `<p class="md">A link in prose: <a href="#/kit">the kit page</a>.</p><p>${idLink("a1700", "#/kit")} <button type="button" class="link">Show more</button></p>` + dataTable(heads(["Started", "Title"]), `<tr class="rowlink"><td class="time">11/10 14:05</td><td class="wide"><a href="#/kit">A row that goes to its item</a></td></tr>`)) +
    spec("command", "Command", row(cmd("aleph issue list aleph"), cmd("bun test", { primary: true, hint: "in the worktree" }))) +
    spec("filter", "Filter bar", filterBar([
      { label: "Status", name: "status", value: "open", options: ["open", "done", "dropped"] },
      { label: "Project", name: "project", data: true, value: "", options: [{ value: "", label: "All" }, "aleph", "sidetone"] },
    ])) +
    spec("pager", "Pager", pager(50, 345) + pager(345, 345)) +
    spec("row-actions", "Row actions", `<div><p>An item's text.</p><div class="actions">${actButton("Retry")}${actButton("Drop", {}, { cls: "warn" })}<span class="act-msg" role="alert">drop failed: the job has already landed</span></div></div>`) +
    spec("form-message", "Form message", `<div class="actions">${actButton("Retry")}<span class="act-msg" role="alert">Retry failed: the job is already running.</span></div>`) +
    spec("confirm", "Two-click confirm", row(`<button class="act ask" type="button">Drop a1700? Click again</button>`, `<span class="choice"><input class="reason" name="reason" placeholder="Why?" aria-label="Reason"> <button class="act ask" type="button">Confirm</button></span>`),
      "The second state of each: the first click shows it, and it goes back after 5 seconds.") +
    spec("disclosure", "Disclosure", `<details><summary>Closed by default</summary><p>The body of a fold.</p></details><details open><summary>Open by default</summary><p>The body of a fold.</p></details>` + clamp(`<p>${"A long text that clamps. ".repeat(30)}</p>`)) +

    `<h2 class="kit-h">Text</h2>` +
    spec("markdown", "Markdown and code", `<div class="md">${md(MD)}</div>`) +
    spec("diff", "Diff", `<div class="diff-panel">${diffHtml(DIFF)}</div>`) +
    `<h2 class="kit-h">Controls</h2>` +
    spec("states", "Empty state", empty("Nothing waits for you.", "An Ask shows here when the factory needs you.") + loading("jobs") + error("The jobs did not load.")) +

    `<h2 class="kit-h">States</h2>` +
    spec("interaction", "States", row(actButton("Default"), `<button class="act" type="button" style="outline:2px solid var(--focus);outline-offset:2px">Focus</button>`,
      `<button class="act" type="button" style="border-color:var(--ink-2)">Hover</button>`, seg("Pressed", [{ label: "Off", on: false, attrs: "" }, { label: "Pressed", on: true, attrs: "" }]),
      `<button class="act" type="button" disabled>Disabled</button>`) + `<div style="max-width:320px">${tiles("Pressed metric card", statCard({ k: "Selector", v: "7", note: "pressed", key: "a", on: true }))}</div>`,
      "Focus and hover are drawn with inline styles, so they show without a pointer or a keyboard.", "States") +
    `</div>`;
}

/** Each `--` custom property, light and dark, read from the stylesheets: the `:root` rules for light, `:root[data-theme="dark"]` over them for dark.
 * Kit and Web Awesome bridges are left out. A `var()` in a value is resolved in its own theme. */
function themeTokens() {
  const light = {}, dark = {};
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const r of rules) {
      const into = r.selectorText === ":root" ? light : r.selectorText === ':root[data-theme="dark"]' ? dark : null;
      if (into) for (const p of r.style) if (p.startsWith("--") && !/^--(wa|kit)-/.test(p)) into[p] = r.style.getPropertyValue(p).trim();
    }
  }
  const resolve = (map, v, n = 0) => (n > 8 ? v : v.replace(/var\((--[\w-]+)\)/g, (m, k) => (k in map ? resolve(map, map[k], n + 1) : m)));
  const both = { ...light, ...dark };
  return Object.fromEntries(Object.keys(light).map((k) => [k, { light: resolve(light, light[k]), dark: resolve(both, both[k]) }]));
}

// WCAG contrast of two CSS colours: a canvas turns each into sRGB.
const ctx = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d", { willReadFrequently: true });
function lum(colour) {
  ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = "#000"; ctx.fillStyle = colour; ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map((v) => (v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

function drawTokens(root) {
  const t = themeTokens(), names = Object.keys(t), val = (n) => t[n].light;
  const fill = (kind, html) => { const el = root.querySelector(`[data-tokens="${kind}"]`); if (el) el.innerHTML = html; };
  const colours = names.filter((n) => CSS.supports("color", t[n].light));
  for (const [id, , re] of COLOURS) fill(id, colours.filter((n) => re.test(n)).map((n) =>
    `<div class="kit-swatch"><i><b style="background:${t[n].light}"></b><b style="background:${t[n].dark}"></b></i><code>${n}</code><span class="quiet">${t[n].light} / ${t[n].dark}</span></div>`).join(""));
  const cell = (r) => `<td class="num">${r.toFixed(2)}${r < 4.5 ? ` ${tag("below 4.5", "stuck")}` : ""}</td>`;
  fill("contrast", dataTable(heads(["Pair", "Light", "Dark"], ["Light", "Dark"]), PAIRS.map(([f, b]) =>
    `<tr><td><code>${f}</code> on <code>${b}</code></td>${cell(ratio(t[f].light, t[b].light))}${cell(ratio(t[f].dark, t[b].dark))}</tr>`).join(""), { fit: true }));
  fill("type", names.filter((n) => n.startsWith("--fs-")).map((n) =>
    `<p style="font-size:var(${n})"><code>${n}</code> ${val(n)}: The factory landed 12 issues.</p>`).join("") +
    ["--display", "--sans", "--mono", "--num"].map((n) => `<p style="font-family:var(${n})"><code>${n}</code> ` +
      ["--fw-text", "--fw-mid", "--fw-strong"].map((w) => `<span style="font-weight:var(${w})">The factory landed 12 issues, 0123456789.</span>`).join(" · ") + "</p>").join(""));
  fill("space", names.filter((n) => n.startsWith("--sp-") || n === "--gap" || n === "--gap-in").map((n) =>
    `<div class="kit-tok"><i style="width:var(${n});height:var(${n});background:var(--series-1)"></i><code>${n}</code></div>`).join(""));
  fill("radius", names.filter((n) => n.startsWith("--r-")).map((n) =>
    `<div class="kit-tok"><i style="width:48px;height:32px;border:1px solid var(--ink-2);border-radius:var(${n})"></i><code>${n}</code></div>`).join(""));
  fill("layers", ["--lift", "--card-lift", "--float"].map((n) =>
    `<div class="kit-tok"><i style="width:96px;height:48px;background:var(--surface);border-radius:var(--r-ctl);box-shadow:var(${n})"></i><code>${n}</code></div>`).join("") +
    `<div class="kit-tok"><i style="width:96px;height:var(--ctl-h);border:1px solid var(--ink-2);border-radius:var(--r-ctl)"></i><code>--ctl-h ${val("--ctl-h")}</code></div>` +
    `<div class="kit-tok"><i style="width:96px;height:var(--bar-h);background:var(--series-1);border-radius:var(--r-hair)"></i><code>--bar-h ${val("--bar-h")}</code></div>` +
    `<div class="kit-tok"><i style="width:96px;height:32px;background:var(--series-1);opacity:var(--dim)"></i><code>--dim ${val("--dim")}</code></div>`);
}

const setTheme = (t) => (t === "system" ? delete document.documentElement.dataset.theme : (document.documentElement.dataset.theme = t));
// The theme pick is the kit's own: another page goes back to the system's.
if (typeof addEventListener !== "undefined") addEventListener("hashchange", () => { if (!location.hash.startsWith("#/kit")) setTheme("system"); });

export const view = {
  path: "/kit",
  title: "Kit",
  nav: false,
  api: "/api/design",
  render: (d, _p, query) => renderKit(d, query),
  mount: (root, _d, query) => {
    setTheme(THEMES.includes(query?.get?.("theme")) ? query.get("theme") : "system");
    drawTokens(root);
    for (const [k, f] of Object.entries(FRAMES)) root.querySelector(`aleph-chart[key="kit/${k}"]`).frame = f;
    root.querySelector("[data-theme-pick]")?.parentElement.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-theme-pick]");
      if (b) location.hash = b.dataset.themePick === "system" ? "#/kit" : `#/kit?theme=${b.dataset.themePick}`;
    });
  },
};
