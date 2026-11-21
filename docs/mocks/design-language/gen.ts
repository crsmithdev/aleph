// Draws the design-language mock: the Language panel of the aleph-tools dock over real aleph pages, and the two separate pages.
// `bun docs/mocks/design-language/gen.ts`. The pages use the real UI helpers and ui/app.css. The dock is drawn by hand after
// ~/aleph-tools/dock.js, which is not in this repo. Counts of places are measured in ui/views (README, Data); counts marked there are invented.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { actButton, card, cell, clamp, codeText, dataTable, editable, esc, field, fold, form, heads, legendHtml, meter, moreFold, pageHead, rowAct, row, seg, statCard, subHead, tag, tiles, inputBox, setting, settings } from "../../../ui/views/lib/html.js";
import { count, day } from "../../../ui/views/lib/format.js";

const here = import.meta.dir;
const root = join(here, "../../..");
const designMd = readFileSync(join(root, "docs/design.md"), "utf8").split("\n");
const appCss = readFileSync(join(root, "ui/app.css"), "utf8");

// ---- Real counts from docs/design.md and ui/app.css ----
const section = (from: string, to: string) => { const a = designMd.findIndex((l) => l === from), b = designMd.findIndex((l, i) => i > a && l === to); return designMd.slice(a, b < 0 ? undefined : b); };
// A drafted rule is a bullet or a table row of the doc (a header row and a separator row do not count).
const bullets = (ls: string[]) => ls.filter((l, i) => l.startsWith("- ") || (l.startsWith("| ") && !ls[i + 1]?.startsWith("|---"))).length;
const comps = (ls: string[]) => ls.filter((l) => l.startsWith("#### ")).length;
const groupOf = (name: string, next: string) => { const ls = section(name, next); return { parts: comps(ls), rules: bullets(ls) }; };
const rootBlock = appCss.slice(appCss.indexOf(":root {"), appCss.indexOf("\n}", appCss.indexOf(":root {")));
const tokens = [...rootBlock.matchAll(/(?:^|[;{\s])(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]);
const byPrefix = (re: RegExp) => tokens.filter((t) => re.test(t)).length;
const TOKEN_GROUPS = [
  ["Colour", tokens.filter((t) => !/^--(fs|fw|sp|r|wa|dock|ctl|bar|dim|sans|mono|display|metric|measure|gap|dur|ease)/.test(t)).length, "Foundations, Colour"],
  ["Type", byPrefix(/^--(fs|fw|sans|mono|display|metric)/), "Foundations, Type"],
  ["Space and shape", byPrefix(/^--(sp|r-|gap|ctl|bar|dim|measure)/), "Foundations, Space and shape"],
] as const;
const COMP_GROUPS = [["Structure", "### Structure", "### Data"], ["Data", "### Data", "### Lists of items"], ["Lists of items", "### Lists of items", "### Labels"], ["Labels", "### Labels", "### Actions"],
  ["Actions", "### Actions", "### Text"], ["Text", "### Text", "### Controls"], ["Controls", "### Controls", "## States"]].map(([n, a, b]) => ({ name: n, ...groupOf(a, b) }));
const PATTERN_GROUPS = [["Values", "### Values", "### Words"], ["Words", "### Words", "## Components"], ["States", "## States", "## Layout"], ["Layout", "## Layout", "## Views"]].map(([n, a, b]) => ({ name: n, ...groupOf(a, b), rules: bullets(section(a, b)) }));
const PARTS = COMP_GROUPS.reduce((s, g) => s + g.parts, 0);
const principles = section("## Principles", "### Rules").filter((l) => /^\d\. \*\*/.test(l)).map((l) => l.replace(/^\d\. \*\*(.*?)\*\*.*/, "$1").replace(/\.$/, ""));
const deviations = section("## Deviations", "## Appendix").filter((l) => l.startsWith("| ") && !l.startsWith("| Deviation") && !l.startsWith("|---")).length;

// ---- The aleph chrome, as the canon mock draws it ----
const opt = (label: string, on = false) => ({ label, on, attrs: "" });
const NAV: [string, string, string][] = [["head", "Factory", ""], ["gauge-high", "Status", "#"], ["shield-halved", "Automation", "#"], ["robot", "Agents", "#"], ["list-check", "Issues", "proposal.html"], ["stopwatch", "Jobs", "#"], ["head", "Claude", ""], ["comments", "Sessions", "#"], ["plug", "Hooks", "index.html"], ["brain", "Memory", "#"], ["palette", "Language", "guide.html"]];
const nav = (cur: string) => `<ul>${NAV.map(([icon, title, href]) => icon === "head" ? `<li class="head">${title}</li>` : `<li><a href="${href}"${title === cur ? ' aria-current="page"' : ""}><wa-icon name="${icon}" aria-hidden="true"></wa-icon><span class="lbl">${title}</span></a></li>`).join("")}</ul>`;
const head = readFileSync(join(root, "ui/index.html"), "utf8").split("</head>")[0]
  .replace(/<script src="\/vendor[^>]*><\/script>\n/, "").replace('href="/app.css"', 'href="app.css"');

// The state bar is the mock's only frame. Queue, Split and Exception share one page and switch by hash.
const VIEWS = [["queue", "Queue", "index.html#queue"], ["split", "Split", "index.html#split"], ["proposal", "Proposal", "proposal.html"], ["exception", "Exception", "index.html#exception"], ["first-run", "First run", "first-run.html"], ["guide", "Guide", "guide.html"]];
const bar = (on: string) => `<nav class="flow" aria-label="Views">${VIEWS.map(([k, t, h], i) => `<a href="${h}" data-view="${k}"${k === on ? ' aria-current="true"' : ""}><b>${i + 1}</b> ${t}</a>`).join("")}</nav>`;

// The dock after aleph-tools/dock.js: a column of round buttons in the corner; a widget's panel opens to the left of its button.
const fabs = (open: boolean, n: number) => `<div class="dock"><button type="button" class="fab lang" aria-pressed="${open}" aria-label="Language" title="Language"><span>Aa</span><i class="count">${n}</i></button>` +
  `<button type="button" class="fab" aria-label="Annotate" title="Annotate">&#9998;</button></div>`;
const write = (file: string, cur: string, view: string, state: string, body: string, dock = "") => writeFileSync(join(here, file), `${head.replace("<title>aleph</title>", `<title>${cur} · design language mock</title>`)}<link rel="stylesheet" href="mock.css"></head>\n` +
  `<body data-state="${state}">\n<div class="shell">\n<nav class="side" aria-label="Views"><a class="mark" href="#/"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="39" fill="none" stroke="currentColor" stroke-width="12"/><circle cx="35.5" cy="64.5" r="20" fill="currentColor"/></svg>aleph</a><div id="nav">${nav(cur)}</div></nav>\n` +
  `<main><div id="view">${bar(view)}${body}</div></main>\n</div>\n${dock}<script src="mock.js"></script>\n</body></html>\n`);

// ---- Evidence crops: real helpers draw each variant ----
const crop = (label: string, html: string, note = "") => `<figure class="crop"><div class="shot">${html}</div><figcaption><b>${esc(label)}</b>${note ? ` <span class="m">${esc(note)}</span>` : ""}</figcaption></figure>`;
const FOLD_ITEMS = Array.from({ length: 13 }, (_, i) => `Item ${i + 1}`);
const V_FOLD = fold("3 more", `<ul class="tight"><li>Item 11</li><li>Item 12</li><li>Item 13</li></ul>`);
const V_CHEV = dataTable("", row([`<td><button class="fold" type="button" aria-expanded="false" aria-label="Parts of Large">&#9656;</button> Large</td>`, cell("3 models", { num: true })]));
const LONG = "The hook held the stop because the reply claimed a hash that no command in this session had printed, so the claim had no backing.";
const V_CLAMP = `<div class="chat"><div class="msg">${clamp(`<p>${LONG}</p>`)}</div></div>`;
const variants = [
  { id: "fold", name: "Fold", code: "`fold()` `<details>`", n: 27, crop: V_FOLD, where: "27 call sites, one per section or detail block" },
  { id: "chev", name: "Row chevron", code: "`button.fold` by hand", n: 2, crop: V_CHEV, where: "`ui/views/issues.js:187`, `ui/views/factory-agents.js:80`" },
  { id: "clamp", name: "Show more", code: "`clamp()` button", n: 3, crop: V_CLAMP, where: "`ui/views/session.js:37`, `ui/views/gates.js:190`, `ui/views/lib/timeline.js:135`" },
];
const SPLIT_PLACES = variants.reduce((s, v) => s + v.n, 0);

const T_TA = `<textarea name="text" rows="3" aria-label="Note"></textarea>`;
const SAMPLE_TA = `<textarea rows="3">Pin it above the tabs.</textarea>`;
const E_CHECK = `<label class="field"><input type="checkbox" name="group" checked> Group</label>`;
const KIND_BTN = `<table class="tbl"><tbody><tr><td><button type="button" class="link">hash</button></td><td class="num">${count(18)}</td></tr></tbody></table>`;

// ---- The Language panel of the dock: queue items ----
const ANS = (rec = "") => `<div class="ans" role="group" aria-label="Answer">${["Change UI", "Change language", "Record exception"].map((a) => `<button type="button" data-ans="${a}"${a === rec ? ' class="rec"' : ""}>${a}</button>`).join("")}</div>`;
type Item = { id: string; kind: "drift" | "split" | "gap" | "orphan"; title: string; rule: string; places: number; evidence: string; extra?: string; open?: string; rec?: string };
const KINDTONE = { drift: "error", split: "need", gap: "run", orphan: "quiet" } as const;
const KINDTIP = { drift: "The UI breaks a rule", split: "One job done two or more ways", gap: "A recurring thing with no rule", orphan: "A rule nothing uses" } as const;
const ITEMS: Item[] = [
  { id: "d-0412", kind: "split", title: "Reveal hidden detail", rule: "Disclosure", places: SPLIT_PLACES, open: "split", rec: "Change language",
    evidence: `<div class="crops">${variants.map((v) => crop(v.name, v.crop, String(v.n))).join("")}</div>` },
  { id: "d-0415", kind: "drift", title: "A data cell never holds a button", rule: "Table", places: 5, rec: "Record exception",
    evidence: `<div class="crops">${crop("Kind cell", KIND_BTN, "hooks.js:46")}<p class="m">Judged, not exact. 5 places: <code>hooks.js</code>, <code>jobs.js</code> ×2, <code>session.js</code>, <code>context-panel.js</code>.</p></div>` },
  { id: "d-0418", kind: "gap", title: "Text area and checkbox by hand", rule: "none", places: 5, open: "proposal", rec: "Change language",
    evidence: `<div class="crops">${crop("Textarea", `<div class="field-shot">${T_TA}</div>`, "3")}${crop("Checkbox", E_CHECK, "2")}</div>` },
  { id: "d-0409", kind: "orphan", title: "Long list: moreFold()", rule: "Disclosure", places: 0, rec: "Change language",
    evidence: `<div class="crops">${crop("moreFold()", moreFold(FOLD_ITEMS, (x: string) => x, 3), "0 pages")}<p class="m">The Design page and a test only.</p></div>` },
];
const itemHtml = (it: Item) => `<li class="q" data-kind="${it.kind}" id="${it.id}"><div class="qh">${tag(it.kind, KINDTONE[it.kind], KINDTIP[it.kind])}<b>${esc(it.title)}</b><span class="places" title="Places touched">${it.places}</span></div>` +
  `<p class="m"><code>${it.id}</code> · Rule: ${esc(it.rule)}${it.open ? ` · <a href="${it.open === "split" ? "#split" : "proposal.html"}" class="open">Open</a>` : ""}</p>${it.evidence}${ANS(it.rec)}</li>`;

// A fix the agent made alone: exact drift, one commit, before and after.
const OUTC: [string, string][] = [["o-caught", "Caught"], ["o-none", "No Reply"], ["o-dead", "No Effect"]];
const KINDS: [string, number, number, number, number][] = [["hash", 41, 29, 9, 3], ["doc claim", 17, 12, 0, 5], ["new copy", 9, 4, 5, 0]];
const meterOf = (r: (typeof KINDS)[number]) => meter(r.slice(2).map((n, i) => ({ pct: (100 * (n as number)) / r[1], cls: OUTC[i][0] })), `caught ${r[2]}, no reply ${r[3]}, no effect ${r[4]}`);
const holdTable = (fixed: boolean) => dataTable(heads(["Kind", "No Reply"], ["No Reply"]),
  KINDS.map((r) => row([`<td>${esc(r[0])}</td>`, ...r.slice(3, 4).map((n) => cell(fixed ? count(n as number) : (n ? String(n) : ""), { num: true }))])).join(""));
const FIXED = `<li class="q done" id="d-0403"><div class="qh">${tag("drift", "error", KINDTIP.drift)}<b>Every integer through count()</b><span class="places" title="Places touched">7</span></div>` +
  `<p class="m"><code>d-0403</code> · Rule: Values · fixed alone · <a href="#" class="sha">c4e91b2</a> · tests pass</p>` +
  `<div class="crops ba">${crop("Before", holdTable(false), "zero blank")}${crop("After", holdTable(true), "zero shows 0")}</div>` +
  `<div class="ans"><button type="button">Revert</button></div></li>`;

const queuePanel = `<div class="pop" role="dialog" aria-label="Language"><header><b>Language</b><span class="m">aleph · survey of Hooks</span><span class="n">${ITEMS.length + 1}</span></header>` +
  `<h3 class="sub-head">Fixed alone</h3><ul class="qs">${FIXED}</ul><h3 class="sub-head">Queue</h3>` +
  `<ul class="qs">${[...ITEMS].sort((a, b) => b.places - a.places).map(itemHtml).join("")}</ul>` +
  `<footer class="m">Sorted by places. Whole UI on request.<button type="button">Survey all</button></footer></div>`;

// ---- Split: variants side by side, counts, recommendation, answers ----
const splitPanel = `<div class="pop wide" role="dialog" aria-label="Split"><header><a href="#queue" class="back" aria-label="Back to the queue">&laquo;</a><b>Reveal hidden detail</b>${tag("split", "need", KINDTIP.split)}<span class="places" title="Places touched">${SPLIT_PLACES}</span></header>` +
  `<p class="m"><code>d-0412</code> · Rule: Disclosure · ${variants.length} variants</p>` +
  `<div class="vs">${variants.map((v) => `<section class="v"><div class="vc">${v.crop}</div><div class="vi"><h4>${v.name} <b class="vn">${v.n}</b></h4><p class="m">${codeText(v.code)}</p>` +
    `${meter((100 * v.n) / SPLIT_PLACES, `${v.n} of ${SPLIT_PLACES} places`)}<p class="m">${codeText(v.where)}</p></div></section>`).join("")}</div>` +
  `<div class="rec-box"><b>Recommend: Change language</b><p>Three jobs, not one. A block hides under <code>fold()</code>. A row opens its parts with the chevron. Long text clamps. Name each job and give the chevron a helper.</p><p class="m">Judged. UI changes: 0 places. Rule changes: 1 new, 1 edited.</p></div>` +
  `${ANS("Change language")}</div>`;

// ---- Exception: place, rule, reason ----
const excPanel = `<div class="pop wide" role="dialog" aria-label="Record exception"><header><a href="#queue" class="back" aria-label="Back to the queue">&laquo;</a><b>Record exception</b>${tag("drift", "error", KINDTIP.drift)}</header>` +
  `<form class="stack" data-ui="exception"><dl class="facts"><div><dt>Place</dt><dd><code>ui/views/hooks.js:46</code></dd></div><div><dt>Rule</dt><dd><a href="guide.html#r-table-button">Table</a>: a data cell never holds a button</dd></div><div><dt>Difference</dt><dd><code>d-0415</code></dd></div></dl>` +
  `<div class="crops">${crop("The place", KIND_BTN, "Kind cell")}</div>` +
  `<label class="field">Reason<textarea name="reason" rows="3" required>The kind name sets the log filter. The row has no other action.</textarea></label>` +
  `<p class="note">Only you can grant an exception. The agent writes no reason.</p>` +
  `<p class="m warn">This rule has 2 exceptions. Many exceptions on one rule become a finding against the rule.</p>` +
  `<div class="acts"><button type="button" data-back="#queue">Cancel</button><button type="submit" class="primary act">Record</button></div></form></div>`;

// ---- The Hooks page the queue sits on ----
const holdsByKind = (kindBtn: boolean) => legendHtml(OUTC.map(([cls, n]) => [n, cls])) + dataTable(heads(["Kind", "Holds", "Outcome", "Caught", "No Reply", "No Effect", "Action"], ["Holds", "Caught", "No Reply", "No Effect"]),
  KINDS.map((r, i) => row([kindBtn ? `<td${i === 0 ? ' class="target"' : ""}><button type="button" class="link" data-kind="${esc(r[0])}">${esc(r[0])}</button>${i === 0 ? `<span class="pin" data-n="2" tabindex="0" aria-label="Difference d-0415: a data cell holds a button">2</span>` : ""}</td>` : `<td>${esc(r[0])}</td>`,
    cell(count(r[1]), { num: true }), `<td>${meterOf(r)}</td>`, ...r.slice(2).map((n) => cell(count(n as number), { num: true })), rowAct("Show", { kind: r[0] })]).replace("<tr>", `<tr${i === 0 ? ' id="p-kind"' : ""}>`)).join(""));
const HOOKS: [string, string, number, number, number][] = [["verify-gate", "Stop", 31, 4, 27], ["handoff-saved", "Stop", 22, 0, 22], ["context-gate", "UserPromptSubmit", 14, 3, 11]];
const holdsByHook = dataTable(heads(["Hook", "Event", "Holds", "Interactive", "Workers"], ["Holds", "Interactive", "Workers"]),
  HOOKS.map(([n, ev, h, i, w]) => row([`<td><a href="#">${n}</a></td>`, cell(ev), cell(count(h), { num: true }), cell(count(i), { num: true }), cell(count(w), { num: true })])).join(""));
const hooksPage = `<div class="page">${pageHead("Hooks", { aside: seg("Window", [opt("24h"), opt("7d", true), opt("30d")]) })}` +
  card("Holds by Kind", holdsByKind(true), { count: "67" }) + card("Holds by Hook", holdsByHook, { count: "3" }) + `</div>`;

write("index.html", "Hooks", "queue", "queue", hooksPage,
  `<div class="st s-queue">${queuePanel}</div><div class="st s-split">${splitPanel}</div><div class="st s-exception">${excPanel}</div>${fabs(true, ITEMS.length + 1)}`);

// ---- Proposal: the Issue page, with the textarea the gap touches ----
const NOTES: [string, string][] = [["Nov 19", "Pinned in the card head; tabs stay where they are."], ["Nov 20", "Herald alert needs the same pin on the phone width."]];
const issuePage = `<div class="page live">${pageHead("Pin herald alerts above its tabs", { aside: tag("running", "run") })}` +
  card("Notes", `<ul class="notes">${NOTES.map(([d, t]) => `<li><span class="m">${d}</span> ${esc(t)}</li>`).join("")}</ul>` +
    form("issue-note", [field("Add a note", T_TA)], "Add note")) +
  card("View", settings("View", [setting("Group by parent", `<label class="field"><input type="checkbox" name="group" checked> Group</label>`)])) + `</div>`;
const PLACES: [string, string, string][] = [["ui/views/issues.js:501", "Add a note", "none"], ["ui/views/issues.js:629", "Edit text", "none"], ["ui/views/memory.js:303", "Memory editor", "font mono to sans"]];
const part = (k: string, shown: string, editor: string) => `<div class="part"><dt>${k}</dt><dd class="editable">${editable(shown, editor)}<button type="button" data-editor="start" class="act small">Edit</button><button type="button" data-editor="cancel" class="act small">Done</button></dd></div>`;
const proposalPanel = `<div class="pop wide" role="dialog" aria-label="Proposal"><header><a href="index.html#queue" class="back" aria-label="Back to the queue">&laquo;</a><b>Proposal</b>${tag("gap", "run", KINDTIP.gap)}<span class="m">from <code>d-0418</code></span></header>` +
  `<label class="say">You<input value="Text areas look the same everywhere" aria-label="Tell the agent"><button type="button">Send</button></label>` +
  `<dl class="parts">${part("Name", "Textarea", inputBox("name", "Textarea"))}${part("Use", "Two or more lines of free text. Not for one line: use <code>inputBox()</code>.", `<textarea rows="2">Two or more lines of free text. Not for one line: use inputBox().</textarea>`)}` +
    `${part("Reason", "One look and one size on every page.", inputBox("why", "One look and one size on every page."))}` +
    `${part("Class", tag("rule", "run"), seg("Class", [opt("Rule", true), opt("Advice")]))}${part("Test", "Machine check: no <code>&lt;textarea</code> outside <code>textarea()</code>", `<select aria-label="Test"><option>Machine check</option><option>Do and don't pair</option><option>None (advice)</option></select>`)}` +
    `${part("Home", "Shared component <code>textarea()</code>, token <code>--area-fs</code>", `<select aria-label="Home"><option>Token or component</option><option>Check</option><option>Prose</option></select>`)}</dl>` +
  `<h3 class="sub-head">Specimen</h3><div class="spec"><div class="do"><span class="tagline m">Do</span>${field("Add a note", SAMPLE_TA)}</div><div class="dont"><span class="tagline m">Don't</span>${field("Memory editor", SAMPLE_TA)}</div></div>` +
  `<h3 class="sub-head">Live token</h3><label class="say">Text size<select id="area-fs" aria-label="Text size token"><option value="var(--fs-xs)">--fs-xs</option><option value="var(--fs-sm)" selected>--fs-sm</option><option value="var(--fs-md)">--fs-md</option></select><span class="m">Live on the page</span></label>` +
  `<h3 class="sub-head">Places</h3><table class="tbl"><tbody>${PLACES.map(([p, w, c]) => `<tr><td><code>${p}</code></td><td>${esc(w)}</td><td class="m">${esc(c)}</td></tr>`).join("")}</tbody></table>` +
  `<div class="conflict" role="note"><b>Conflict: Markdown and code</b><p>The Memory editor shows source in <code>--mono</code> <code>--fs-xs</code> (<code>ui/app.css:1474</code>). The new rule sets sans.</p>` +
  `<div class="ans"><button type="button" class="rec">Scope the rule to prose</button><button type="button">Edit the old rule</button></div></div>` +
  `<footer><span class="m">One commit: rule, helper, check.</span><button type="button" class="act">Discard</button><button type="button" class="act primary">Approve</button></footer></div>`;
write("proposal.html", "Issues", "proposal", "proposal", issuePage, `<div class="st s-proposal">${proposalPanel}</div>${fabs(true, ITEMS.length + 1)}`);

// ---- First run: the language drafted by layer ----
const pending = new Set(["Actions"]); // a group with an open split waits for the answer
const APPROVED = new Set(["Colour", "Type", "Labels"]);
const groupRow = (layer: string, name: string, n: number, src: string, split = false) => row([`<td>${esc(name)}</td>`, cell(`${n} ${layer === "Tokens" ? "tokens" : "rules"}`), cell(src),
  `<td>${tag("adopted as found", "quiet", "Agreed groups carry the mark until you edit them")}</td>`,
  `<td class="acts">${split ? tag("1 split", "need", "Answer the split first") : ""} ${actButton(APPROVED.has(name) ? "Approved" : "Approve", { group: `${layer}:${name}` }, { kind: "small" }).replace("<button", split ? "<button disabled" : APPROVED.has(name) ? "<button disabled" : "<button")}</td>`]);
const layerCard = (title: string, rows: string, n: number) => card(title, dataTable(heads(["Group", "Drafted", "Source", "Mark", "Action"]), rows), { count: String(n) });
const tokenRows = TOKEN_GROUPS.map(([n, c, s]) => groupRow("Tokens", n, c, s)).join("");
const compRows = COMP_GROUPS.map((g) => groupRow("Components", g.name, g.rules, `Components, ${g.name} · ${g.parts} parts`, pending.has(g.name))).join("");
const patRows = PATTERN_GROUPS.map((g) => groupRow("Patterns", g.name, g.rules, g.name === "Values" || g.name === "Words" ? `Content, ${g.name}` : g.name)).join("");
const SPLITS = [
  { id: "d-0412", q: "Reveal hidden detail", v: variants.map((v) => [v.name, v.n] as [string, number]), places: "27 sections, 2 rows, 3 long texts" },
  { id: "d-0421", q: "Name of a time column", v: [["Started, Updated, Committed", 16], ["Time", 3]] as [string, number][], places: "`memory.js:228`, `hooks.js:106`, `lib/investigation.js:37` say Time" },
  { id: "d-0422", q: "A date with no time", v: [["Oct 28", 1], ["10/28", 1]] as [string, number][], places: "`day()` in `lib/format.js`; `dayOf()` in `lib/memory-health.js`" },
];
const splitCardHtml = (s: (typeof SPLITS)[number], i: number) => `<li class="fsplit" data-split="${s.id}"><div class="qh">${tag("split", "need", KINDTIP.split)}<b>${esc(s.q)}</b><code>${s.id}</code></div>` +
  `<div class="fv">${s.v.map(([n, c]) => `<span>${esc(n)} <b class="num">${c}</b></span>`).join("")}</div><p class="m">${codeText(s.places)}</p>` +
  `<div class="ans" role="group" aria-label="Answer">${s.v.map(([n]) => `<button type="button" data-pick="${esc(n)}">${esc(n.split(",")[0])}</button>`).join("")}<button type="button" data-pick="other">Other</button></div></li>`;
const SOURCE_MAP: [string, string][] = [["Foundations", "Tokens"], ["Components", "Components"], ["Content", "Patterns"], ["States, Layout", "Patterns"]];
const firstRun = `<div class="page">${pageHead("First run", { count: "aleph", aside: `<span class="m"><b id="approved">${APPROVED.size}</b> of ${TOKEN_GROUPS.length + COMP_GROUPS.length + PATTERN_GROUPS.length} groups approved · <b id="answered">0</b> of ${SPLITS.length} splits answered</span>` })}` +
  card("First draft", `<dl class="facts"><div><dt>Source</dt><dd><code>docs/design.md</code> · ${designMd.length} lines</dd></div><div><dt>Stylesheet</dt><dd><code>ui/app.css</code> · ${appCss.split("\n").length} lines · ${tokens.length} tokens</dd></div>` +
    `<div><dt>Read as</dt><dd>${SOURCE_MAP.map(([a, b]) => `${esc(a)} &rarr; ${esc(b)}`).join(" · ")}</dd></div><div><dt>Principles</dt><dd>${principles.length}, as advice or rules</dd></div></dl>`, { aside: tag("from docs/design.md", "quiet") }) +
  layerCard("Tokens", tokenRows, TOKEN_GROUPS.length) + layerCard("Components", compRows, COMP_GROUPS.length) + layerCard("Patterns", patRows, PATTERN_GROUPS.length) +
  card("Splits to answer", `<ul class="fsplits">${SPLITS.map(splitCardHtml).join("")}</ul>`, { count: String(SPLITS.length) }) + `</div>`;
write("first-run.html", "Language", "first-run", "first-run", firstRun, fabs(false, ITEMS.length + 1));

// ---- Guide: every rule, and the measure ----
type Rule = { layer: string; name: string; cls: "rule" | "advice"; test: string; home: string; why: string; mark?: string; exc: number; id?: string; orphan?: boolean };
const RULES: Rule[] = [
  { layer: "Tokens", name: "A colour is a token", cls: "rule", test: "machine: `inventory.ts` literals", home: "token", why: "Both themes follow.", mark: "adopted as found", exc: 3 },
  { layer: "Tokens", name: "A size, radius or space is a token", cls: "rule", test: "machine: `inventory.ts` literals", home: "token", why: "One edit moves every page.", mark: "adopted as found", exc: 0 },
  { layer: "Tokens", name: "Text 4.5:1, a mark 3:1", cls: "rule", test: "machine: `ui/error-contrast.test.ts`", home: "check", why: "Readable in both themes.", exc: 0 },
  { layer: "Tokens", name: "A number is tabular", cls: "rule", test: "machine: grep `font-variant-numeric`", home: "token", why: "Digits line up.", mark: "adopted as found", exc: 0 },
  { layer: "Components", name: "Helpers build the parts", cls: "rule", test: "machine: `inventory.ts` helper-bypass", home: "component", why: "A fix in one helper fixes every page.", mark: "adopted as found", exc: deviations },
  { layer: "Components", name: "A value goes through its helper", cls: "rule", test: "machine: `count()` `dur()` `when()`", home: "component", why: "One format per value.", mark: "adopted as found", exc: 0 },
  { layer: "Components", name: "A bad count uses badCount()", cls: "rule", test: "pair: rendered do and don't", home: "component", why: "Errors read red above 0.", exc: 0 },
  { layer: "Components", name: "A data cell never holds a button", cls: "rule", test: "pair: rendered do and don't", home: "component", why: "A row action has one place.", exc: 2, id: "r-table-button" },
  { layer: "Components", name: "Long list: moreFold() after 10", cls: "rule", test: "pair: rendered do and don't", home: "component", why: "A long list stays short.", exc: 0, orphan: true },
  { layer: "Components", name: "Meaning is a tone", cls: "rule", test: "machine: `tone()` states", home: "component", why: "One state, one colour.", mark: "adopted as found", exc: 1 },
  { layer: "Patterns", name: "An empty state is empty()", cls: "rule", test: "pair: rendered do and don't", home: "component", why: "Same words on every page.", mark: "adopted as found", exc: 0 },
  { layer: "Patterns", name: "A missing value is miss(reason)", cls: "rule", test: "pair: rendered do and don't", home: "component", why: "The reason sits in a title.", mark: "adopted as found", exc: 0 },
  { layer: "Patterns", name: "Be terse: one or two words", cls: "advice", test: "none", home: "prose", why: "Do not fill a space.", mark: "adopted as found", exc: 0 },
  { layer: "Patterns", name: "Keep a fold closed", cls: "advice", test: "none", home: "prose", why: "Detail waits for the reader.", mark: "adopted as found", exc: 0 },
];
const FLAG = 3; // many exceptions on one rule become a finding against the rule: the mock marks it at this count (invented)
const ruleRow = (r: Rule) => `<tr data-class="${r.cls}"${r.id ? ` id="${r.id}"` : ""}><td class="wide">${esc(r.name)}</td><td>${tag(r.cls, r.cls === "rule" ? "run" : "quiet")}</td><td>${codeText(r.test)}</td><td>${r.home}</td><td>${esc(r.why)}</td>` +
  `<td>${r.mark ? tag(r.mark, "quiet") : ""}${r.orphan ? tag("orphan", "quiet", KINDTIP.orphan) : ""}${r.exc >= FLAG ? tag("finding", "need", "Many exceptions: a finding against the rule") : ""}</td>${cell(count(r.exc), { num: true })}</tr>`;
const layers = ["Tokens", "Components", "Patterns"];
const ruleTables = layers.map((l) => `<section class="layer">${subHead(l)}${dataTable(heads(["Rule", "Class", "Test", "Home", "Reason", "Marks", "Exceptions"], ["Exceptions"]), RULES.filter((r) => r.layer === l).map(ruleRow).join(""))}</section>`).join("");
const TESTED = Math.round(PARTS * 0.6); // invented
const WEEKS: [string, number, number][] = [["2026-10-26", 6, 21], ["2026-11-02", 9, 20], ["2026-11-09", 8, 11], ["2026-11-16", 11, 9]]; // invented
const measure = tiles("Measure", [
  statCard({ k: "Notes per page", v: (WEEKS[3][2] / WEEKS[3][1]).toFixed(1), note: `was ${(WEEKS[0][2] / WEEKS[0][1]).toFixed(1)}`, title: "Design notes from you per agent-built page, this week" }),
  statCard({ k: "Survey", v: "4 open", note: "not clean", title: "Open differences after the last survey" }),
  statCard({ k: "Coverage", v: `${TESTED} of ${PARTS}`, note: "parts tested", title: "Parts with a rule that has a test" }),
  statCard({ k: "Your time", v: "18 min", note: "this week", title: "Minutes spent in the queue" }),
].join(""));
const weekTable = dataTable(heads(["Week of", "Pages", "Notes", "Per page"], ["Pages", "Notes", "Per page"]), WEEKS.map(([w, p, n]) => row([cell(day(`${w}T12:00:00`, new Date("2026-11-21T12:00:00"))), cell(count(p), { num: true }), cell(count(n), { num: true }), cell((n / p).toFixed(1), { num: true })])).join(""), { fit: true });
const guide = `<div class="page">${pageHead("Language", { count: "aleph", aside: seg("Show", [opt("All", true), opt("Rules"), opt("Advice")], ' id="cls"') })}${measure}` +
  card("Design notes", weekTable, { aside: tag("per agent-built page", "quiet") }) +
  card("Rules", ruleTables, { count: String(RULES.length), aside: `<span class="m">${RULES.filter((r) => r.cls === "rule").length} rules · ${RULES.filter((r) => r.cls === "advice").length} advice</span>` }) + `</div>`;
write("guide.html", "Language", "guide", "guide", guide, fabs(false, ITEMS.length + 1));

console.log("wrote index.html, proposal.html, first-run.html and guide.html");
