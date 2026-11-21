// Draws the canonicalize mock, one page per step, from the real UI helpers: `bun docs/mocks/canon/gen.ts`.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { actButton, card, codeText, dataTable, diffHtml, empty, esc, facts, filterBar, heads, legendHtml, md, pageHead, seg, statCard, subHead, tag, tiles } from "../../../ui/views/lib/html.js";
import { detailPanel, renderKpis } from "../../../ui/views/lib/timeline.js";

const here = import.meta.dir;

// The steps of the flow, in order; each is one page of the mock.
const STEPS = [
  ["1-select.html", "Select"],
  ["2-extract.html", "Extract"],
  ["3-review.html", "Review"],
  ["4-apply.html", "Apply"],
  ["5-guide.html", "Guide"],
];
const flow = (on: string) => `<nav class="flow" aria-label="Steps"><a href="index.html"${on === "index.html" ? ' aria-current="page"' : ""}>Overview</a>` +
  STEPS.map(([f, t], i) => `<a href="${f}"${f === on ? ' aria-current="page"' : ""}><b>${i + 1}</b> ${t}</a>`).join("") + `</nav>`;

// The control canonicalized in the mock: the Active pane's toggle of the Herald card (ui/views/now.js:212).
const toggle = (mode = "issues") => seg("Show", [["issues", "Issues"], ["jobs", "Jobs"]].map(([k, label]) => ({ label, on: k === mode, attrs: ` data-active="${k}"` })));
const rows = (xs: [string, string][]) => dataTable("", xs.map(([id, t]) => `<tr><td><a href="#">${id}</a></td><td class="wide">${esc(t)}</td></tr>`).join(""));
const herald = (body: string) => card("Herald", body, { aside: seg("Herald", [{ label: "Events", on: false, attrs: "" }, { label: "Active", on: true, attrs: "" }, { label: "Inspector", on: false, attrs: "" }]), cls: "herald-card" });
const RUNNING: [string, string][] = [["a1431", "Pin herald alerts above its tabs"], ["a1436", "Give the herdr status panel a window"]];
const QUEUED: [string, string][] = [["a1440", "Match the Hooks pages to the v3 mock"], ["a1442", "Fetch the full history in the CI checkout"]];
const activePane = (ctl: string) => ctl + subHead("Running") + rows(RUNNING) + subHead("Queued") + rows(QUEUED);

// The features the agent reads off the control. Each has a class against docs/design.md: match, new or conflict.
type Feature = { id: string; name: string; value: string; from: string; cls: "match" | "new" | "conflict"; rule?: string; why: string; pick: "keep" | "drop" | "edit" };
const FEATURES: Feature[] = [
  { id: "f1", name: "Height", value: "`--ctl-h` (28px)", from: "computed `height: 28px`", cls: "match", rule: "Filter bar, part 2", why: "Every control in a row is 28px high.", pick: "keep" },
  { id: "f2", name: "Frame", value: "1px `--rule` border, `--r-ctl` (6px) radius", from: "computed border, radius", cls: "match", rule: "Filter bar, part 2", why: "", pick: "keep" },
  { id: "f3", name: "Dividers", value: "1px `--rule` between options, none before the first", from: "`.seg button + button`", cls: "new", why: "No rule says how options are split.", pick: "keep" },
  { id: "f4", name: "Text", value: "`--sans` `--fs-sm` (13px), `--muted`; `--ink` on hover", from: "computed font, color", cls: "match", rule: "Filter bar, part 2", why: "", pick: "keep" },
  { id: "f5", name: "Pressed", value: "`--fw-strong`, `--ink` on `--rule-2`, `aria-pressed=\"true\"`", from: "computed, DOM attribute", cls: "match", rule: "Filter bar, part 3", why: "", pick: "keep" },
  { id: "f6", name: "Padding", value: "0 `--sp-12` per option", from: "computed `padding: 0 12px`", cls: "new", why: "", pick: "keep" },
  { id: "f7", name: "Overflow", value: "One line; scrolls inside itself", from: "`overflow-x: auto`, `white-space: nowrap`", cls: "match", rule: "Filter bar, part 2", why: "", pick: "keep" },
  { id: "f8", name: "Name", value: "`role=\"group\"` with an `aria-label`", from: "DOM", cls: "new", why: "A screen reader names the group.", pick: "keep" },
  { id: "f9", name: "Labels", value: "One or two words per option", from: "text: Issues, Jobs", cls: "new", why: "Seen on 7 of 7 call sites.", pick: "keep" },
  { id: "f10", name: "Count", value: "Two options", from: "DOM: 2 buttons", cls: "new", why: "Too narrow: sites use 2 to 6.", pick: "edit" },
  { id: "f11", name: "Place", value: "A bare control above the lists it filters", from: "`now.js:212`, outside `filterBar()`", cls: "conflict", rule: "Filter bar: Use", why: "A filter of a table goes in a filter bar.", pick: "drop" },
  { id: "f12", name: "Wiring", value: "`wireSeg()` sets `aria-pressed`; the view does not", from: "`now.js`, `gates.js:263` set it by hand", cls: "new", why: "Code: one `wireSeg()` in place of three hand-wired copies.", pick: "keep" },
];
const CLS = { match: ["Matches", "done"], new: ["New", "need"], conflict: ["Conflicts", "error"] } as const;
const ctag = (c: Feature["cls"]) => tag(CLS[c][0], CLS[c][1]);
const pick = (f: Feature) => seg(`Decide ${f.name}`, [["keep", "Keep"], ["drop", "Drop"], ["edit", "Edit"]].map(([k, l]) => ({ label: l, on: k === f.pick, attrs: ` data-pick="${k}"` })), ` data-feature="${f.id}"`);

// The controls that look like the canon: exact ones call seg(); similar ones the crawl found by shape and style.
type Match = { id: string; page: string; place: string; src: string; kind: "exact" | "similar"; off: string[]; guess?: string; on: boolean };
const MATCHES: Match[] = [
  { id: "m1", page: "Jobs, Issues, Sessions", place: "Filter bar", src: "ui/views/lib/html.js:274", kind: "exact", off: [], on: false },
  { id: "m2", page: "Now, Issue", place: "Tabs", src: "ui/views/lib/html.js:285", kind: "exact", off: [], on: false },
  { id: "m3", page: "Now", place: "Herald, Active: Show", src: "ui/views/now.js:212", kind: "exact", off: ["Bare control as a filter, outside `filterBar()`"], on: true },
  { id: "m4", page: "Automation", place: "Rule form: Decides, If no answer", src: "ui/views/gates.js:142", kind: "exact", off: ["Sets `aria-pressed` by hand (`gates.js:263`)", "`data-field` on the group, not `data-name`"], on: true },
  { id: "m5", page: "Every chart", place: "Chart form, icons", src: "ui/views/lib/chart.js:134", kind: "exact", off: [], on: false },
  { id: "m6", page: "Every page", place: "Annotate: note actions", src: "~/aleph-tools/annotate.js:297", kind: "similar", guess: "Likely", off: ["Own colours, not tokens", "Radius 4px, not `--r-ctl`", "Gaps between options, not dividers", "Height 24px, not `--ctl-h`"], on: true },
  { id: "m7", page: "Now", place: "KPI tiles you can press", src: "ui/views/lib/html.js:447", kind: "similar", guess: "Unlikely", off: ["A metric card, not a choice of options"], on: false },
];

// The pages. Each is the app's shell with this mock's step bar on top.
const NAV: [string, string, string][] = [["head", "Factory", ""], ["gauge-high", "Status", "#/"], ["shield-halved", "Automation", "#/automation"], ["robot", "Agents", "#/factory/agents"], ["list-check", "Issues", "#/issues"], ["stopwatch", "Jobs", "#/factory/jobs"], ["lightbulb", "Ideas", "#/ideas"], ["magnifying-glass-chart", "Explore", "#/explore"], ["head", "Claude", ""], ["comments", "Sessions", "#/sessions"], ["brain", "Memory", "#/memory"], ["plug", "Hooks", "#/hooks"]];
const nav = `<ul>${NAV.map(([icon, title, href]) => icon === "head" ? `<li class="head">${title}</li>` : `<li><a href="${href}" title="${title}"><wa-icon name="${icon}" aria-hidden="true"></wa-icon><span class="lbl">${title}</span></a></li>`).join("")}</ul>`;
const head = readFileSync(join(here, "../../../ui/index.html"), "utf8").split("</head>")[0]
  .replace(/<script src="\/vendor[^>]*><\/script>\n/, "").replace('href="/app.css"', 'href="app.css"');
const style = `<link rel="stylesheet" href="mock.css">`;
const script = `<script src="mock.js"></script>`;
const write = (file: string, title: string, page: string) => writeFileSync(join(here, file), `${head.replace("<title>aleph</title>", `<title>${esc(title)} · canon mock</title>`)}${style}</head>\n<body>\n<div class="shell">\n<nav class="side" aria-label="Views"><a class="mark" href="#/"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="39" fill="none" stroke="currentColor" stroke-width="12"/><circle cx="35.5" cy="64.5" r="20" fill="currentColor"/></svg>aleph</a><div id="nav">${nav}</div></nav>\n<main><div id="view">${flow(file)}${page}</div></main>\n</div>\n${script}\n</body></html>\n`);

// The annotate widget, drawn by hand: the dock widget is not in this repo. Its look copies ~/aleph-tools/annotate.js.
const menu = `<div class="ann-menu card-ann" role="menu"><button type="button">Delete<kbd>D</kbd></button><button type="button">Move<kbd>M</kbd></button><button type="button">Refit<kbd>R</kbd></button><button type="button">Explain<kbd>E</kbd></button>` +
  `<a class="new" href="2-extract.html" role="menuitem">Canon<kbd>C</kbd></a></div>`;
const dock = (n: number) => `<div class="ann-dock"><span class="fab on">&#9998;</span><span class="count">${n}</span></div>`;

// Overview: the loop and what stays fixed.
write("index.html", "Canonicalize", `<div class="page">` + pageHead("Canonicalize a control", { aside: "Mock · 2026-11-20" }) +
  card("The loop", md(
    `1. **Select.** In annotate mode, press a control on any page and choose **Canon** (key C).\n` +
    `2. **Extract.** An agent opens the page in playwright and reads the control's computed style, DOM shape, text and source helper. It names the component class.\n` +
    `3. **Review.** Each feature comes back as one claim, classed against \`docs/design.md\`: matches, new or conflicts. You keep, drop or edit each one. Approve writes the doc entry and its specimen.\n` +
    `4. **Apply.** The agent lists the controls that match the canon: exact ones by helper call site, similar ones by a crawl. You confirm the similar ones and pick what to fix. A job fixes them on a branch and posts before and after shots.\n` +
    `5. **Guide.** \`#/design\` lists each canon with its specimen, its features, where it is used and what breaks it. In annotate mode, hover a control to see its canon.`)) +
  card("Fixed", md(
    `- **Notes:** the canon request is a note of kind \`canon\` in \`~/.aleph/annotations.json\`, through \`shelf note\`. No new store.\n` +
    `- **Doc:** \`docs/design.md\` stays the one place a rule is written. The guide page reads it, as \`#/design\` does now.\n` +
    `- **Code:** a canon names one helper. Apply moves look-alikes onto that helper, so the fix is in one place.\n` +
    `- **Changes:** every doc or code change is a branch and a job, so Deny or Discard drops it.`)) +
  card("Example", `<p>Every step of this mock follows one control: the Show toggle of the Herald card's Active pane, <code>ui/views/now.js:212</code>. It is a <code>seg()</code>, and the doc has no Segmented control entry: its rules sit inside Filter bar and Tabs.</p>` +
    `<div class="specimen">${toggle()}</div>`) +
  `</div>`);

// 1 Select: the Now page with annotate on, the toggle outlined and the quick actions open.
write("1-select.html", "Select", `<div class="page">` + pageHead("Status", { aside: "Annotate on" }) +
  `<p class="hint">Annotate mode is on. The pointer is on the Show toggle; the outline is the element the note will pin to. Press <kbd>C</kbd> or pick <b>Canon</b>.</p>` +
  herald(`<div class="ann-target">${activePane(`<span class="ann-glow">${toggle()}${menu}</span>`)}</div>`) +
  dock(3) + `</div>`);

// 2 Extract: the note's thread with the agent's reading of the control.
const styles: [string, string, string][] = [
  ["height", "28px", "--ctl-h"], ["border", "1px solid #DCD9EC", "--rule"], ["border-radius", "6px", "--r-ctl"], ["font", "400 13px Work Sans", "--sans --fs-sm"],
  ["color", "#62688A", "--muted"], ["button padding", "0 12px", "--sp-12"], ["pressed background", "#E8E6F3", "--rule-2"], ["pressed weight", "600", "--fw-strong"],
  ["overflow-x", "auto", ""], ["focus outline", "2px #7E57C2, -2px offset", "--focus"],
];
const dom = `<div class="seg" role="group" aria-label="Show">
  <button type="button" data-active="issues" aria-pressed="true">Issues</button>
  <button type="button" data-active="jobs" aria-pressed="false">Jobs</button>
</div>`;
write("2-extract.html", "Extract", `<div class="page">` + pageHead("Canon: Show toggle", { count: "reading", aside: "Note mwq81 · now" }) +
  renderKpis([{ k: "Class", v: "Segmented control", text: true }, { k: "Helper", v: "<code>seg()</code>", text: true }, { k: "Call sites", v: "7" }, { k: "Features", v: "12" }]) +
  `<div class="two">` +
  card("Note", `<ol class="thread"><li><b>you</b> Canon <span class="quiet">on <code>#herald section[data-pane=active] .seg</code></span></li>` +
    `<li class="agent"><b>agent</b> Opened <code>#/</code> at 1280px, light and dark. Read the computed style, the DOM and the source.</li>` +
    `<li class="agent"><b>agent</b> This is <code>seg()</code> (<code>ui/views/lib/html.js:259</code>), called at <code>ui/views/now.js:212</code>. The doc has no entry for it: its rules sit in Filter bar and Tabs. Proposed class: <b>Segmented control</b>, under Controls.</li>` +
    `<li class="agent"><b>agent</b> 12 features: 6 match a rule, 5 are new, 1 conflicts. Review is on the shelf. <a href="3-review.html">Open</a></li></ol>`) +
  card("Source", facts([["Helper", codeText("`seg(label, items, attrs)`")], ["Defined", codeText("`ui/views/lib/html.js:259`")], ["Called", codeText("`ui/views/now.js:212`")], ["CSS", codeText("`ui/app.css:1029` to `:1034`")], ["Doc", "Filter bar parts 2, 3; Tabs part 1"]])) +
  `</div>` +
  detailPanel("Computed style", "10", dataTable(heads(["Property", "Value", "Token"]), styles.map(([p, v, t]) => `<tr><td>${p}</td><td><code>${esc(v)}</code></td><td>${t ? `<code>${t}</code>` : `<span class="quiet">none</span>`}</td></tr>`).join(""))) +
  detailPanel("DOM", "3 nodes", `<pre class="code">${esc(dom)}</pre>`) +
  detailPanel("Seen", "2 themes", `<div class="design-row"><div class="specimen">${toggle()}</div><div class="specimen dark" data-theme="dark">${toggle("jobs")}</div></div>`) +
  `</div>`);

// 3 Review: the shelf item. Each feature with its class and a Keep / Drop / Edit pick; the doc diff the kept ones make.
const counts = (c: Feature["cls"]) => FEATURES.filter((f) => f.cls === c).length;
const featRow = (f: Feature) => `<tr data-row="${f.id}" data-pick="${f.pick}"><td><b>${esc(f.name)}</b></td>` +
  `<td>${codeText(f.value)}${f.pick === "edit" ? `<div class="edit-box"><input value="Two to five options; more go in a select" aria-label="${esc(f.name)}"></div>` : ""}</td><td class="quiet">${codeText(f.from)}</td><td>${ctag(f.cls)}${f.rule ? `<div class="quiet">${esc(f.rule)}</div>` : ""}${f.why ? `<div class="why">${codeText(f.why)}</div>` : ""}</td><td class="acts">${pick(f)}</td></tr>`;
const docDiff = `--- a/docs/design.md
+++ b/docs/design.md
@@ -1268,6 +1268,30 @@ ### Controls
+#### Segmented control
+
+A segmented control picks one of a fixed set of options.
+
+**Use:** for two to five options the reader switches between. **Not for:** options from the data; use a select.
+
+| Helper | Reference |
+|---|---|
+| \`seg(label, items, attrs)\`; \`wireSeg(root, onPick)\` | \`ui/views/now.js\` |
+
+| # | Part | Holds | Optional | Style |
+|---|---|---|---|---|
+| 1 | Group | The options, \`role="group"\` with an \`aria-label\` | | border \`--rule\`, radius \`--r-ctl\`; \`--ctl-h\` high; scrolls inside itself |
+| 2 | Option | One or two words, or an icon with its label as \`title\` | | \`--sans\` \`--fs-sm\`, \`--muted\`; padding 0 \`--sp-12\`; 1px \`--rule\` before each but the first |
+| 3 | Pressed option | The option in use, \`aria-pressed="true"\` | | \`--fw-strong\`, \`--ink\` on \`--rule-2\` |
+
+- Two to five options; more go in a select.
+- Wire the clicks with \`wireSeg()\`. Do not set \`aria-pressed\` in the view.
+
@@ -1281,8 +1305,8 @@ #### Filter bar
-| 2 | Segmented control | A fixed set of options | | \`--sans\` \`--fs-sm\`, \`--muted\`, border \`--rule\`, radius \`--r-ctl\`; \`--ctl-h\` high; scrolls inside itself |
-| 3 | Pressed option | The option in use | | \`--fw-strong\`, \`--ink\` on \`--rule-2\` |
+| 2 | Segmented control | A fixed set of options | | See Segmented control |`;
write("3-review.html", "Review", `<div class="page">` +
  `<div class="shelf-bar"><span class="shelf-mark">shelf</span><span>Canon: Segmented control</span><span class="quiet">from note mwq81 · 12 features</span></div>` +
  pageHead("Segmented control", { count: "12", aside: "Controls · <code>seg()</code>" }) +
  `<div class="specimen">${toggle()} ${seg("Chart form", [{ label: "Columns", icon: "chart-column", on: true, attrs: "" }, { label: "Lines", icon: "chart-line", on: false, attrs: "" }])} ${seg("If no answer", [{ label: "Keep waiting", on: false, attrs: "" }, { label: "Take the pick", on: true, attrs: "" }, { label: "Drop", on: false, attrs: "" }])}</div>` +
  legendHtml([[`Matches ${counts("match")}`, "lg-done"], [`New ${counts("new")}`, "lg-need"], [`Conflicts ${counts("conflict")}`, "lg-error"]]) +
  card("Features", dataTable(heads(["Feature", "Canon", "Read from", "Against the doc", ""]), FEATURES.map(featRow).join(""), { id: "features" }), { count: "12", aside: `<span id="tally"></span>` }) +
  card("Conflict", md(`**Place** conflicts with Filter bar, Use: "for the filters of one table". The Show toggle filters two lists but sits outside \`filterBar()\`.\n\n` +
    `- **Drop** (picked): the canon leaves place out; Apply lists \`now.js:212\` as a deviation and moves it into a filter bar.\n- **Keep**: the canon allows a bare toggle; the Filter bar rule gets an exception.`)) +
  detailPanel("Doc change", "+24 −2", `<div class="diff-panel">${diffHtml(docDiff)}</div>`) +
  detailPanel("Specimen", "#/design", `<p class="hint">Approve adds <code>spec("seg", "Segmented control", …)</code> to <code>ui/views/design.js</code> under Controls, with the three variants on this page.</p>`) +
  `<div class="decide">${actButton("Approve", { go: "4-apply.html" }, { primary: true })}${actButton("Deny")}<textarea placeholder="Reply to the agent" aria-label="Reply"></textarea></div>` +
  `</div>`);

// 4 Apply: the controls that match the canon, their deviations, the pick, then the job's before and after.
const offList = (m: Match) => m.off.length ? `<ul class="off">${m.off.map((o) => `<li>${codeText(o)}</li>`).join("")}</ul>` : `<span class="quiet">none</span>`;
const matchRow = (m: Match) => `<tr><td><input type="checkbox" data-fix="${m.id}"${m.on ? " checked" : ""}${m.off.length ? "" : " disabled"} aria-label="Fix ${esc(m.place)}"></td>` +
  `<td><b>${esc(m.place)}</b><div class="quiet">${esc(m.page)}</div></td><td><code>${esc(m.src)}</code></td>` +
  `<td>${m.kind === "exact" ? tag("Exact", "done", "Calls seg()") : tag(m.guess!, m.guess === "Likely" ? "need" : "quiet", "Found by shape and style; confirm")}</td><td class="num">${m.off.length || ""}</td><td>${offList(m)}</td>` +
  `<td class="acts">${m.kind === "similar" ? seg(`Is ${m.place} a segmented control`, [{ label: "Yes", on: m.guess === "Likely", attrs: "" }, { label: "No", on: m.guess !== "Likely", attrs: "" }]) : ""}</td></tr>`;
const annChips = `<div class="ann-chips"><button aria-pressed="true">Refit</button><button aria-pressed="false">Explain</button><button aria-pressed="false">Move</button></div>`;
const ba = (title: string, before: string, after: string, notes: string) => `<div class="ba"><h4>${esc(title)}</h4><div class="ba-row"><figure><figcaption>Before</figcaption><div class="specimen">${before}</div></figure><figure><figcaption>After</figcaption><div class="specimen">${after}</div></figure></div><p class="quiet">${codeText(notes)}</p></div>`;
const wireDiff = `--- a/ui/views/gates.js
+++ b/ui/views/gates.js
@@ -258,9 +258,6 @@
-    const pick = e.target.closest?.("form.rule-form .seg button");
-    if (pick) {
-      for (const b of pick.parentElement.children) b.setAttribute("aria-pressed", String(b === pick));
-      if (pick.parentElement.dataset.field === "wait") for (const el of [pick.form.elements.n, pick.form.elements.unit]) el.disabled = pick.dataset.value === "wait";
-      return;
-    }
+  wireSeg(f, (name, value, form) => { if (name === "wait") for (const el of [form.elements.n, form.elements.unit]) el.disabled = value === "wait"; });`;
write("4-apply.html", "Apply", `<div class="page">` + pageHead("Apply: Segmented control", { count: "7", aside: "Canon approved · 11 features" }) +
  renderKpis([{ k: "Matches", v: "7" }, { k: "Exact", v: "5" }, { k: "Similar", v: "2" }, { k: "Off Canon", v: "3" }, { k: "Deviations", v: "8" }]) +
  card("Matches", `<p class="hint">Exact: calls <code>seg()</code>. Similar: the crawl of 14 pages found it by DOM shape and computed style. A similar match needs your Yes before a fix.</p>` +
    dataTable(heads(["", "Place", "Source", "Match", "Off", "Deviations", "Is it one?"], ["Off"]), MATCHES.map(matchRow).join(""), { id: "matches" }), { count: "7" }) +
  `<div class="decide">${actButton("Fix 3", { fix: "" }, { primary: true })}<span class="quiet">Starts job <a href="#">canon-seg-1</a> on branch <code>fix/canon-seg</code></span></div>` +
  subHead("Job canon-seg-1: landed for review") +
  ba("Herald, Active: Show", toggle(), filterBar([{ label: "Show", name: "active", options: [{ value: "issues", label: "Issues" }, { value: "jobs", label: "Jobs" }] }]), "Moved into `filterBar()`; the label Show is now visible. `ui/views/now.js:212`.") +
  ba("Annotate: note actions", annChips, seg("Action", [{ label: "Refit", on: true, attrs: "" }, { label: "Explain", on: false, attrs: "" }, { label: "Move", on: false, attrs: "" }]), "The widget takes the app's tokens through the dock bridge. `~/aleph-tools/annotate.js:297`.") +
  ba("Automation, rule form", seg("If no answer", [{ label: "Keep waiting", on: false, attrs: "" }, { label: "Take the pick", on: true, attrs: "" }, { label: "Drop", on: false, attrs: "" }]), seg("If no answer", [{ label: "Keep waiting", on: false, attrs: "" }, { label: "Take the pick", on: true, attrs: "" }, { label: "Drop", on: false, attrs: "" }]), "No change to the look. The wiring moves to `wireSeg()`.") +
  detailPanel("Code change", "3 files · +31 −19", `<div class="diff-panel">${diffHtml(wireDiff)}</div>`) +
  `<div class="decide">${actButton("Land", {}, { primary: true })}${actButton("Discard")}</div>` +
  `</div>`);

// 5 Guide: #/design as the guide's browser. Contents with a count of what breaks each canon; one entry open.
const GROUPS: [string, [string, number, boolean?][]][] = [
  ["Foundations", [["Colour", 0], ["Type", 2], ["Space and shape", 0]]],
  ["Structure", [["Page head", 0], ["Card", 1], ["Detail panel", 0], ["KPI strip", 0]]],
  ["Data", [["Metric card", 0], ["Table", 3], ["Chart panel", 0], ["Meter", 0]]],
  ["Labels", [["Badge", 0], ["Chip", 1], ["Status light", 0]]],
  ["Actions", [["Button", 0], ["Link button", 0], ["Two-click confirm", 0]]],
  ["Controls", [["Filter bar", 0], ["Segmented control", 0, true], ["Tabs", 0], ["Select", 0], ["Search box", 0]]],
];
const contents = `<nav class="guide-toc" aria-label="Components"><input type="search" placeholder="Find a component" aria-label="Find a component">` +
  GROUPS.map(([g, xs]) => `<h4>${g}</h4><ul>${xs.map(([n, off, on]) => `<li><a href="#"${on ? ' aria-current="true"' : ""}>${n}${off ? `<span class="badge error">${off}</span>` : ""}${on ? `<span class="badge need">New</span>` : ""}</a></li>`).join("")}</ul>`).join("") + `</nav>`;
const kept = FEATURES.filter((f) => f.pick !== "drop");
const used: [string, string, string, string][] = [
  ["Jobs, Issues, Sessions", "Filter bar", "ui/views/lib/html.js:274", "ok"], ["Now, Issue", "Tabs", "ui/views/lib/html.js:285", "ok"], ["Now", "Herald, Active: Show", "ui/views/now.js:212", "ok"],
  ["Automation", "Rule form", "ui/views/gates.js:142", "ok"], ["Every chart", "Chart form", "ui/views/lib/chart.js:134", "ok"], ["Every page", "Annotate: note actions", "~/aleph-tools/annotate.js:297", "ok"],
];
const history = [["2026-11-20", "Canon from note mwq81", "11 kept, 1 dropped"], ["2026-11-20", "Applied by canon-seg-1", "3 fixed"], ["2026-11-20", "Count edited", "Two to five options"]];
const hoverDemo = `<div class="hover-demo"><p class="hint">Annotate mode on another page. Hover a control to see its canon.</p>` +
  `<div class="hd-row"><span class="hd-item">${seg("Window", [{ label: "Day", on: true, attrs: "" }, { label: "Week", on: false, attrs: "" }, { label: "Month", on: false, attrs: "" }])}<span class="hd-tip card-ann"><b>Segmented control</b> <span class="badge done">Canon</span><br><span class="quiet">seg() · 0 off</span><br><a href="#">Open in guide</a></span></span>` +
  `<span class="hd-item">${actButton("Retry")}<span class="hd-tip card-ann"><b>Button</b> <span class="badge done">Canon</span><br><span class="quiet">actButton() · 0 off</span><br><a href="#">Open in guide</a></span></span>` +
  `<span class="hd-item"><span class="chip">fable</span><span class="hd-tip card-ann"><b>Chip</b> <span class="badge error">1 off</span><br><span class="quiet">radius 6px, canon <code>--r-tag</code></span><br><a href="#">Canon it</a> · <a href="#">Fix</a></span></span></div></div>`;
write("5-guide.html", "Guide", `<div class="page guide">` + pageHead("Design", { aside: "38 components · 7 off canon" }) +
  `<div class="guide-wrap">${contents}<div class="guide-body">` +
  `<div class="entry-head"><h2>Segmented control</h2><span class="badge need">New</span><span class="quiet">Controls · <code>seg()</code> · approved 2026-11-20</span><span class="spacer"></span>${actButton("Canon again", {}, { kind: "small" })}${actButton("Edit", {}, { kind: "small" })}</div>` +
  `<p>A segmented control picks one of a fixed set of options. <b>Use:</b> for two to five options the reader switches between. <b>Not for:</b> options from the data; use a select.</p>` +
  card("Specimen", `<div class="design-row"><div class="specimen">${toggle()}</div><div class="specimen">${seg("Chart form", [{ label: "Columns", icon: "chart-column", on: true, attrs: "" }, { label: "Lines", icon: "chart-line", on: false, attrs: "" }, { label: "Table", icon: "table", on: false, attrs: "" }])}</div><div class="specimen">${seg("If no answer", [{ label: "Keep waiting", on: false, attrs: "" }, { label: "Take the pick", on: true, attrs: "" }, { label: "Drop", on: false, attrs: "" }])}</div><div class="specimen dark" data-theme="dark">${toggle("jobs")}</div></div>`) +
  card("Canon", dataTable(heads(["Feature", "Canon"]), kept.map((f) => `<tr><td>${esc(f.name)}</td><td>${codeText(f.pick === "edit" ? "Two to five options; more go in a select" : f.value)}</td></tr>`).join("")), { count: String(kept.length) }) +
  card("Used on", dataTable(heads(["Page", "Place", "Source", ""]), used.map(([p, pl, s]) => `<tr><td>${p}</td><td>${pl}</td><td><code>${s}</code></td><td>${tag("On canon", "done")} <a href="#">Show</a></td></tr>`).join("")), { count: String(used.length) }) +
  card("History", dataTable(heads(["Day", "Change", ""]), history.map(([d, c, x]) => `<tr><td class="time">${d}</td><td>${c}</td><td class="quiet">${x}</td></tr>`).join("")), { count: "3" }) +
  card("Hover to see the canon", hoverDemo) +
  `</div></div></div>`);

console.log("wrote index.html and 5 step pages");
