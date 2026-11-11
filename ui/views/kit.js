// #/kit: the design language's specimens. Each component of docs/design.md, drawn by its real helper from fixture
// data, in each of its states, so a review sees the code's own output. Each specimen has a `data-annotate` id, so a
// note pinned on it stays across a redraw. Beside each specimen are its rules, read from docs/design.md through
// /api/design, so the doc stays the one place they are written. The sidebar leaves the page out.
import { actButton, badge, dur, error, loading, money, when, barList, barRow, card, cardTrend, chips, clamp, cmd, crumb, dataTable, diffHtml, empty, facts, filterBar, heads, md, meter, pageHead, pager, priorityBadge, seg, sortHead, statCard, tag, tiles } from "../lib.js";
import { panelOf } from "../chart.js";
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
  const text = rules ? section(doc, rules) : "";
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

const FLOW = { window: "week", classes: [{ key: "landed", hours: 40, text: "reached main" }, { key: "returned", hours: 12, text: "sent back once" }, { key: "failed", hours: 6, lost: true, text: "did not land" }, { key: "dropped", hours: 3, lost: true, text: "dropped" }] };

function renderKit(d, query) {
  doc = d?.body ?? "";
  const theme = THEMES.includes(query?.get?.("theme")) ? query.get("theme") : "system";
  const sort = { key: "at", dir: -1 };
  return `<div class="page kit">${crumb("#/", [["aleph", "#/"], ["kit"]])}` +
    pageHead("Kit", { aside: seg("Theme", THEMES.map((t) => ({ label: t[0].toUpperCase() + t.slice(1), on: t === theme, attrs: ` data-theme-pick="${t}"` }))) }) +
    `<p class="hint">Each component of <code>docs/design.md</code>, drawn by its own helper. Pin a note on a specimen with the annotate tool.</p>` +
    `<section class="kit-spec" data-annotate="kit/every"><h3>Every component</h3><div class="kit-rules md">${md(section(doc, "Every component"))}</div></section>` +

    `<h2 class="kit-h">Foundations</h2>` +
    spec("colour", "Colour", `<div class="kit-swatches" data-tokens="colour"></div>`, "Every colour token on <code>:root</code>, read from the stylesheet.", "") +
    spec("type", "Type", `<div data-tokens="type"></div>`, "", "") +
    spec("space", "Space and shape", `<div class="kit-row" data-tokens="space"></div><div class="kit-row" data-tokens="radius"></div>`, "", "") +

    `<h2 class="kit-h">Structure</h2>` +
    spec("page-head", "Page head", pageHead("Jobs", { count: 128, aside: filterBar([{ label: "Window", bare: true, name: "w", value: "week", options: ["Hour", "Day", "Week", "Month"].map((l) => ({ value: l.toLowerCase(), label: l })) }]) })) +
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

    `<h2 class="kit-h">Labels</h2>` +
    spec("badge", "Badge", row(...["open", "running", "landed", "waiting", "failed", "parked", "dropped"].map(badge)) + row(...["critical", "high", "medium", "low"].map(priorityBadge)) + row(tag("any text"), tag("with a title", "need", "the title"))) +
    spec("chip", "Chip", chips(["ui", "design", "a-long-label-name"])) +

    `<h2 class="kit-h">Actions</h2>` +
    spec("button", "Button", row(actButton("Retry"), actButton("Land", {}, { primary: true }), actButton("Drop", {}, { cls: "warn" }), `<button class="act" type="button" disabled>Disabled</button>`)) +
    spec("command", "Command", row(cmd("aleph issue list aleph"), cmd("bun test", { primary: true, hint: "in the worktree" }))) +
    spec("filter", "Filter bar", filterBar([
      { label: "Status", name: "status", value: "open", options: ["open", "done", "dropped"] },
      { label: "Project", name: "project", data: true, value: "", options: [{ value: "", label: "All" }, "aleph", "sidetone"] },
    ])) +
    spec("pager", "Pager", pager(50, 345) + pager(345, 345)) +
    spec("row-actions", "Row actions", `<div><p>An item's text.</p><div class="actions">${actButton("Retry")}${actButton("Drop", {}, { cls: "warn" })}<span class="act-msg" role="alert">Dropped.</span></div></div>`) +
    spec("form-message", "Form message", `<div class="actions">${actButton("Retry")}<span class="act-msg" role="alert">Retry failed: the job is already running.</span></div>`) +
    spec("confirm", "Two-click confirm", row(`<button class="act ask" type="button">Drop a1700? Click again</button>`, `<span class="choice"><input class="reason" name="reason" placeholder="Why?" aria-label="Reason"> <button class="act ask" type="button">Confirm</button></span>`),
      "The second state of each: the first click shows it, and it goes back after 5 seconds.") +
    spec("disclosure", "Disclosure", `<details><summary>Closed by default</summary><p>The body of a fold.</p></details><details open><summary>Open by default</summary><p>The body of a fold.</p></details>` + clamp(`<p>${"A long text that clamps. ".repeat(30)}</p>`)) +

    `<h2 class="kit-h">Text</h2>` +
    spec("markdown", "Markdown and code", `<div class="md">${md(MD)}</div>`) +
    spec("diff", "Diff", `<div class="diff-panel">${diffHtml(DIFF)}</div>`) +
    `<h2 class="kit-h">Controls</h2>` +
    spec("states", "Empty state", empty("Nothing waits for you.", "An Ask shows here when the factory needs you.") + loading("jobs") + error("The jobs did not load.")) +
    `</div>`;
}

/** The custom properties of every `:root` rule in the page's stylesheets, in order, without the kit and Web Awesome bridges. */
function rootTokens() {
  const names = new Set();
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const r of rules) if (r.selectorText === ":root") for (const p of r.style) if (p.startsWith("--") && !/^--(wa|kit)-/.test(p)) names.add(p);
  }
  return [...names];
}

function drawTokens(root) {
  const css = getComputedStyle(document.documentElement), names = rootTokens(), val = (n) => css.getPropertyValue(n).trim();
  const fill = (kind, html) => { const el = root.querySelector(`[data-tokens="${kind}"]`); if (el) el.innerHTML = html; };
  fill("colour", names.filter((n) => CSS.supports("color", val(n))).map((n) =>
    `<div class="kit-swatch"><i style="background:var(${n})"></i><code>${n}</code><span class="quiet">${val(n)}</span></div>`).join(""));
  fill("type", names.filter((n) => n.startsWith("--fs-")).map((n) =>
    `<p style="font-size:var(${n})"><code>${n}</code> ${val(n)}: The factory landed 12 issues.</p>`).join("") +
    ["--display", "--sans", "--mono", "--num"].map((n) => `<p style="font-family:var(${n})"><code>${n}</code> The factory landed 12 issues, 0123456789.</p>`).join(""));
  fill("space", names.filter((n) => n.startsWith("--sp-")).map((n) =>
    `<div class="kit-tok"><i style="width:var(${n});height:var(${n});background:var(--series-1)"></i><code>${n}</code></div>`).join(""));
  fill("radius", names.filter((n) => n.startsWith("--r-")).map((n) =>
    `<div class="kit-tok"><i style="width:48px;height:32px;border:1px solid var(--ink-2);border-radius:var(${n})"></i><code>${n}</code></div>`).join(""));
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
