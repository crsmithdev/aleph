// Draws the canon mock: the whole flow inside the annotate card, on the pages where the controls live.
// `bun docs/mocks/canon/gen.ts`. The pages use the real UI helpers and ui/app.css; the annotate card is drawn by hand
// after ~/aleph-tools/annotate.js, which is not in this repo.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { codeText, dataTable, esc, pageHead, seg, setting, statCard, subHead, tiles, card } from "../../../ui/views/lib/html.js";

const here = import.meta.dir;

// The control canonicalized: the Show toggle of the Herald card's Active pane (ui/views/now.js:212).
const opt = (label: string, on = false) => ({ label, on, attrs: "" });
const toggle = seg("Show", [opt("Issues", true), opt("Jobs")]);
const rows = (xs: [string, string][]) => dataTable("", xs.map(([id, t]) => `<tr><td><a href="#">${id}</a></td><td class="wide">${esc(t)}</td></tr>`).join(""));
const RUNNING: [string, string][] = [["a1431", "Pin herald alerts above its tabs"], ["a1436", "Give the herdr status panel a window"]];
const QUEUED: [string, string][] = [["a1440", "Match the Hooks pages to the v3 mock"], ["a1442", "Fetch the full history in the CI checkout"]];

// The features, named by token only. A raw value with no token would be its own class: "No token".
type F = { name: string; canon: string; cls: "match" | "new" | "conflict"; rule?: string; pick: "keep" | "drop" | "edit" };
const FEATURES: F[] = [
  { name: "Height", canon: "`--ctl-h`", cls: "match", rule: "Filter bar 2", pick: "keep" },
  { name: "Frame", canon: "border `--rule`, radius `--r-ctl`", cls: "match", rule: "Filter bar 2", pick: "keep" },
  { name: "Dividers", canon: "`--rule` between options", cls: "new", pick: "keep" },
  { name: "Text", canon: "`--sans` `--fs-sm` `--muted`; hover `--ink`", cls: "match", rule: "Filter bar 2", pick: "keep" },
  { name: "Pressed", canon: "`--fw-strong` `--ink` on `--rule-2`", cls: "match", rule: "Filter bar 3", pick: "keep" },
  { name: "Padding", canon: "`--sp-12` each side", cls: "new", pick: "keep" },
  { name: "Focus", canon: "`--focus` ring, inside", cls: "new", pick: "keep" },
  { name: "Labels", canon: "one or two words", cls: "new", pick: "keep" },
  { name: "Count", canon: "two to five; more is a select", cls: "new", pick: "edit" },
  { name: "Place", canon: "bare, outside a filter bar", cls: "conflict", rule: "Filter bar: Use", pick: "drop" },
];
const CLS = { match: ["Doc", "done"], new: ["New", "need"], conflict: ["Conflict", "error"] } as const;
const featRow = (f: F) => `<li data-pick="${f.pick}"><span class="fn">${f.name}</span><span class="fc">${codeText(f.canon)}</span>` +
  `<span class="badge ${CLS[f.cls][1]}" title="${esc(f.rule ?? "Not in docs/design.md")}">${CLS[f.cls][0]}</span>` +
  `<span class="picks">${[["keep", "✓", "Keep"], ["drop", "✕", "Drop"], ["edit", "✎", "Edit"]].map(([k, g, t]) => `<button type="button" data-pick="${k}" title="${t}" aria-pressed="${k === f.pick}">${g}</button>`).join("")}</span></li>`;

// The annotate card in each state. Its chips are the widget's actions with Canon added.
const ACTIONS = ["Delete", "Move", "Refit", "Explain", "Canon"];
const chips = (on: string) => `<div class="chips">${ACTIONS.map((a) => `<button type="button" aria-pressed="${a === on}"${a === "Canon" ? ' class="new"' : ""}>${a}</button>`).join("")}</div>`;
const sel = `<code>#herald section[data-pane=active] .seg</code>`;
const tag = `<span class="tag">Canon</span>`;
const CARD: Record<string, string> = {
  // 1: hover and the quick actions.
  1: `<div class="ann menu">${ACTIONS.map((a, i) => `<button type="button"${a === "Canon" ? ' class="new" data-go="2"' : ""}>${a}<kbd>${"DMREC"[i]}</kbd></button>`).join("")}</div>`,
  // 2: the note is saved; the agent reads the control.
  2: `<div class="ann edit">${chips("Canon")}${sel}<div class="replies"><p><b>agent</b> <i class="spin"></i> reading style, DOM and source</p></div></div>`,
  // 3: the agent's reading, decided row by row in the card.
  3: `<div class="ann edit wide">${chips("Canon")}<div class="ch"><b>Segmented control</b><span class="badge need">New</span><code>seg()</code></div>` +
    `<p class="sub">Controls · 7 call sites · 3 off canon</p><ol class="feats">${FEATURES.map(featRow).join("")}</ol>` +
    `<label class="edit-row">Count <input value="Two to five options; more go in a select"></label>` +
    `<details><summary>Doc change · +24 −2</summary><p>Adds <b>Segmented control</b> under Controls in <code>docs/design.md</code>; Filter bar 2 and 3 point to it. Adds its specimen to <code>#/design</code>.</p></details>` +
    `<textarea class="answer" placeholder="Reply"></textarea><div class="acts"><button type="button" class="del">Deny</button><button type="button" class="save" data-go="4">Approve</button></div></div>`,
  // 4: approved. The note is resolved and docks in the annotate panel; the off-canon controls get agent pins where they live.
  4: `<div class="ann edit">${chips("Canon")}<div class="ch"><b>Segmented control</b><span class="badge done">Canon</span></div>` +
    `<div class="replies"><p><b>you</b> Approve; count two to five</p><p><b>agent</b> Wrote Segmented control, 9 rules. Pinned 3 off canon:</p></div>` +
    `<ul class="offs"><li><a href="#" data-go="pin">Status</a> this toggle: outside a filter bar</li><li><a href="automation.html">Automation</a> rule form: wires <code>aria-pressed</code> by hand</li><li><a href="#" data-go="pin">Status</a> KPI tiles: similar?</li></ul>` +
    `<div class="acts"><button type="button" class="del">Reopen</button><button type="button" class="save">Fix all 3</button></div></div>`,
};
// 5: browse. Hover a control in annotate mode to see its canon; the panel lists every canon.
const hoverChip = `<div class="ann chip-tip"><b>Segmented control</b> ${tag}<br><code>--ctl-h</code> <code>--r-ctl</code> <code>--fs-sm</code><br><span class="m">7 uses · 1 off</span> <a href="#">Guide</a></div>`;
const panel = `<div class="ann pop"><div class="head"><b>Annotations</b>${seg("List", [opt("Notes"), opt("Canon", true)])}</div>` +
  `<ul class="canons">${[["Segmented control", "seg()", 1], ["Button", "actButton()", 0], ["Card", "card()", 1], ["Badge", "tag()", 0], ["Table", "dataTable()", 3]].map(([n, h, off]) =>
    `<li><b>${n}</b> <code>${h}</code>${off ? `<span class="badge error">${off} off</span>` : `<span class="badge done">ok</span>`}</li>`).join("")}</ul>` +
  `<p class="m">Hover a control to see its canon. C on a control with no canon starts one.</p></div>`;

// Agent pins on the page: each opens the same card with Fix or Not one.
const pin = (n: number, body: string) => `<span class="pin st s4p" data-n="${n}" tabindex="0">${n}<span class="ann edit pin-card">${tag}${body}</span></span>`;
const pinHerald = pin(1, `<p><b>Off canon:</b> a bare toggle as a filter. Canon: in <code>filterBar()</code>.</p><div class="acts"><button class="del">Not one</button><button class="save">Fix</button></div>`);
const pinTiles = pin(3, `<p><b>Similar?</b> Pressable tiles found by shape. Is this a segmented control?</p><div class="acts"><button class="del">No</button><button class="save">Yes</button></div>`);

// The state switch is the mock's only frame; each state shows its own card.
const STATES = [["1", "Pick"], ["2", "Read"], ["3", "Decide"], ["4", "Pinned"], ["5", "Browse"]];
const bar = (on: string) => `<nav class="flow" aria-label="States">${STATES.map(([k, t]) => `<button type="button" data-go="${k}"${k === on ? ' aria-current="true"' : ""}><b>${k}</b> ${t}</button>`).join("")}<a href="automation.html">Another page</a></nav>`;
const st = (k: string, html: string) => `<div class="st s${k}">${html}</div>`;

const NAV: [string, string, string][] = [["head", "Factory", ""], ["gauge-high", "Status", "index.html"], ["shield-halved", "Automation", "automation.html"], ["robot", "Agents", "#"], ["list-check", "Issues", "#"], ["stopwatch", "Jobs", "#"], ["head", "Claude", ""], ["comments", "Sessions", "#"], ["brain", "Memory", "#"]];
const nav = (cur: string) => `<ul>${NAV.map(([icon, title, href]) => icon === "head" ? `<li class="head">${title}</li>` : `<li><a href="${href}"${title === cur ? ' aria-current="page"' : ""}><wa-icon name="${icon}" aria-hidden="true"></wa-icon><span class="lbl">${title}</span></a></li>`).join("")}</ul>`;
const head = readFileSync(join(here, "../../../ui/index.html"), "utf8").split("</head>")[0]
  .replace(/<script src="\/vendor[^>]*><\/script>\n/, "").replace('href="/app.css"', 'href="app.css"');
const dock = `<div class="ann-dock"><span class="fab">&#9998;</span><span class="count">3</span></div>`;
const write = (file: string, cur: string, state: string, page: string) => writeFileSync(join(here, file), `${head.replace("<title>aleph</title>", `<title>${cur} · canon mock</title>`)}<link rel="stylesheet" href="mock.css"></head>\n` +
  `<body data-state="${state}">\n<div class="shell">\n<nav class="side" aria-label="Views"><a class="mark" href="#/"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="39" fill="none" stroke="currentColor" stroke-width="12"/><circle cx="35.5" cy="64.5" r="20" fill="currentColor"/></svg>aleph</a><div id="nav">${nav(cur)}</div></nav>\n` +
  `<main><div id="view">${bar(state)}${page}</div></main>\n</div>\n${dock}<script src="mock.js"></script>\n</body></html>\n`);

// Status: the whole flow on the toggle, in place.
const kpis = tiles("Summary", [statCard({ k: "Running", v: "2", key: "running", on: true }), statCard({ k: "Queued", v: "2", key: "queued" }), statCard({ k: "Landed", v: "14", key: "landed" })].join(""));
write("index.html", "Status", "1", `<div class="page">` + pageHead("Status") +
  `<div class="tiles-wrap">${kpis}${pinTiles}</div>` +
  card("Herald", `<div class="target"><span class="hover-hint st s5">${hoverChip}</span>${toggle}${pinHerald}` +
    ["1", "2", "3"].map((k) => st(k, CARD[k])).join("") + `</div>` + subHead("Running") + rows(RUNNING) + subHead("Queued") + rows(QUEUED),
    { aside: seg("Herald", [opt("Events"), opt("Active", true), opt("Inspector")]), cls: "herald-card" }) +
  `<div class="st s4 docked">${CARD[4]}</div>` + st("5", panel) + `</div>`);

// Automation: another page. The agent's pin waits on the rule form; open it to Fix or say Not one.
const ruleSeg = seg("If no answer", [opt("Keep waiting"), opt("Take the pick", true), opt("Drop")]);
write("automation.html", "Automation", "4", `<div class="page">` + pageHead("Automation") +
  card("Rule: merge conflict", `<div class="settings">${setting("Decides", seg("Who decides", [opt("Director", true), opt("User")]))}` +
    setting("If no answer", `<span class="target">${ruleSeg}<span class="pin open" data-n="2">2<span class="ann edit pin-card">${tag}` +
      `<p><b>Off canon:</b> the view sets <code>aria-pressed</code> by hand (<code>gates.js:263</code>). Canon: <code>wireSeg()</code>.</p>` +
      `<p class="m">Look: on canon. Tokens: all match.</p><div class="acts"><button class="del">Not one</button><button class="save">Fix</button></div></span></span></span>`) + `</div>`) +
  `</div>`);

console.log("wrote index.html and automation.html");
