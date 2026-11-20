// Draws index.html and one page per hook from the real UI helpers and this week's hook data: `bun docs/mocks/hooks/gen.ts`.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { barList, barRow, codeText, crumb, dataTable, empty, esc, facts, filterBar, heads, legendHtml, meter, notice, pageHead, tag } from "../../../ui/views/lib/html.js";
import { detailPanel, renderKpis } from "../../../ui/views/lib/timeline.js";

const here = import.meta.dir;
type Hold = { t: string; sid: string; hook: string; kind: string; who: string; out: string; why: string };
type Err = { cause: string; n: number; sessions: number; hooks: string[]; events: string[]; last: string };
const holds: Hold[] = JSON.parse(readFileSync(join(here, "holds.json"), "utf8"));
const errors: Err[] = JSON.parse(readFileSync(join(here, "errors.json"), "utf8"));

// Outcome of a hold, in the order the meter draws them: the useful first.
const OUTS = [
  ["caught", "Caught", "o-caught", "done"],
  ["handoff", "Handoff", "o-handoff", "done"],
  ["held up", "Held up", "o-held", "quiet"],
  ["false", "False", "o-false", "error"],
  ["no reply", "No reply", "o-none", "need"],
  ["no effect", "No effect", "o-dead", "parked"],
] as const;
const outOf = (k: string) => OUTS.find((o) => o[0] === k)!;
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });
const n = (xs: Hold[], f: (h: Hold) => boolean) => xs.filter(f).length;

// Nav: the router's markup (ui/views/lib/router.js), with Hooks added to Claude.
const NAV: [string, string, string, boolean?][] = [["head", "Factory", ""], ["gauge-high", "Status", "#/"], ["shield-halved", "Automation", "#/automation"], ["robot", "Agents", "#/factory/agents"], ["list-check", "Issues", "#/issues"], ["stopwatch", "Jobs", "#/factory/jobs"], ["lightbulb", "Ideas", "#/ideas"], ["magnifying-glass-chart", "Explore", "#/explore"], ["head", "Claude", ""], ["comments", "Sessions", "#/sessions"], ["brain", "Memory", "#/memory"], ["plug", "Hooks", "#/hooks", true]];
const nav = `<ul>${NAV.map(([icon, title, href, on]) => icon === "head" ? `<li class="head">${title}</li>` : `<li><a href="${href}" title="${title}"${on ? ' aria-current="page"' : ""}><wa-icon name="${icon}" aria-hidden="true"></wa-icon><span class="lbl">${title}</span></a></li>`).join("")}</ul>`;

// KPIs: what the holds bought, and what failed.
const kpis = renderKpis([
  { k: "Holds", v: String(holds.length) },
  { k: "Caught", v: String(n(holds, (h) => h.out === "caught")) },
  { k: "False", v: String(n(holds, (h) => h.out === "false")) },
  { k: "No Effect", v: String(n(holds, (h) => h.out === "no effect")) },
  { k: "Errors", v: String(errors.reduce((s, e) => s + e.n, 0)) },
]);

// Holds by hook and kind: who was held, and the outcome split as one meter per row.
const groups = new Map<string, Hold[]>();
for (const h of holds) groups.set(`${h.hook}\0${h.kind}`, [...(groups.get(`${h.hook}\0${h.kind}`) ?? []), h]);
const KIND: Record<string, string> = { judged: "judged", "unbacked hash": "hash", "doc-claim": "doc claim", "new-copy": "new copy", boundary: "boundary", "boundary+new-copy": "both", "compacted, handoff": "compacted" };
const byHook = [...groups.entries()].sort((a, b) => b[1].length - a[1].length).map(([key, xs]) => {
  const [hook, kind] = key.split("\0");
  const parts = OUTS.map(([k, , cls]) => ({ pct: (100 * n(xs, (h) => h.out === k)) / xs.length, cls }));
  const label = OUTS.map(([k, name]) => `${name} ${n(xs, (h) => h.out === k)}`).join(", ");
  return `<tr><td><button type="button" class="link" data-show="${esc(hook)}" data-kind="${esc(kind)}" title="Show these holds">${esc(hook)}</button></td><td>${esc(KIND[kind] ?? kind)}</td><td class="num">${xs.length}</td>` +
    `<td class="num">${n(xs, (h) => h.who === "interactive")}</td><td class="num">${n(xs, (h) => h.who !== "interactive")}</td>` +
    `<td class="wide">${meter(parts, label)}</td>` +
    OUTS.map(([k]) => `<td class="num">${n(xs, (h) => h.out === k) || ""}</td>`).join("") + `</tr>`;
});
const holdTable = legendHtml(OUTS.map(([, name, cls]) => [name, cls])) +
  dataTable(heads(["Hook", "Kind", "Holds", "Interactive", "Workers", "Outcome", ...OUTS.map((o) => o[1])], ["Holds", "Interactive", "Workers", ...OUTS.map((o) => o[1])]), byHook.join(""));

// Per day: holds as a bar list, oldest first.
const days = new Map<string, number>();
for (const h of [...holds].reverse()) { const d = new Date(h.t).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/Los_Angeles" }); days.set(d, (days.get(d) ?? 0) + 1); }
const most = Math.max(...days.values());
const perDay = barList([...days.entries()].map(([d, c]) => barRow(esc(d), (100 * c) / most, String(c), { top: c === most })).join(""));

// Errors by cause, with the fix that removes each.
const FIX: Record<string, string> = {
  "Moved hook file": "Stub or stable entry",
  "Worktree gone (worker)": "Keep until worker ends",
  "Worktree gone (cwd)": "Fixed d90a0602 (one way)",
  "No bun on PATH": "Probe session",
  Cancelled: "Interrupt",
};
const errRows = errors.map((e) => `<tr><td>${esc(e.cause)}</td><td class="wide" title="${esc(e.hooks.join(", "))}">${esc(e.hooks.join(", "))}</td><td>${esc(e.events.join(", "))}</td>` +
  `<td class="num">${e.n}</td><td class="num">${e.sessions}</td><td>${esc(FIX[e.cause] ?? "")}</td><td class="time">${esc(when(e.last))}</td></tr>`).join("");
const errTable = dataTable(heads(["Cause", "Hooks", "Event", "Errors", "Sessions", "Fix", "Last"], ["Errors", "Sessions"]), errRows);

// The hooks: hooks/hooks.json, with whether a factory worker runs each and its holds this week.
const SKIPS = new Set(["verify gate", "context gate", "one way"]);
type Hook = { args?: string[]; command?: string; statusMessage?: string; timeout?: number; async?: boolean };
const cfg = JSON.parse(readFileSync(join(here, "../../../hooks/hooks.json"), "utf8")).hooks as Record<string, { matcher?: string; hooks: Hook[] }[]>;
const hooks = Object.entries(cfg).flatMap(([ev, gs]) => gs.flatMap((g) => g.hooks.map((h) => {
  const args = (h.args ?? []).map((a) => a.replace("${CLAUDE_PLUGIN_ROOT}/", ""));
  const file = args.find((a) => a.endsWith(".ts")) ?? "";
  const name = h.statusMessage ?? file.split("/").pop()!.replace(".ts", "");
  // The app's route would be #/hooks/<event>/<name>; the mock has one file per hook.
  const href = `hook-${`${ev}-${name}`.replace(/\W+/g, "-").toLowerCase()}.html`;
  const cmd = [h.command, ...args.filter((a) => !a.startsWith("-c") && !a.includes("guard did not run") && a !== "guard")].filter(Boolean).join(" ");
  return { ev, name, file, href, cmd, matcher: g.matcher ?? "", mode: h.async ? "async" : "", timeout: h.timeout, skips: SKIPS.has(name), mine: ev === "Stop" ? holds.filter((x) => x.hook === name) : [] };
})));
const all = hooks.length;
const workers = (skips: boolean) => (skips ? tag("skips", "quiet") : tag("runs", "run"));
const inv = hooks.map((h) => `<tr><td>${esc(h.ev)}</td><td><a href="${h.href}">${esc(h.name)}</a></td><td>${h.matcher ? codeText(`\`${h.matcher}\``) : ""}</td><td>${codeText(`\`${h.file}\``)}</td>` +
  `<td>${h.mode}</td><td class="num">${h.timeout ?? ""}</td><td>${workers(h.skips)}</td><td class="num">${h.mine.length || ""}</td></tr>`).join("");
const invTable = dataTable(heads(["Event", "Hook", "Matcher", "File", "Mode", "Timeout s", "Workers", "Holds"], ["Timeout s", "Holds"]), inv);

// The event log of holds, newest first. Every hold is in the page; the filters hide rows. A hook's page drops the Hook column and filter.
const uniq = (xs: Hold[], f: (h: Hold) => string) => [...new Set(xs.map(f))];
const holdsLog = (xs: Hold[], hookCol = true) => {
  const rows = xs.map((h) => {
    const [, name, , t] = outOf(h.out);
    return `<tr data-who="${h.who === "interactive" ? "interactive" : "workers"}" data-hook="${esc(h.hook)}" data-kind="${esc(h.kind)}" data-out="${esc(h.out)}"><td class="time lead">${esc(when(h.t))}</td><td><a class="idl" href="#/sessions/${h.sid}">${h.sid.slice(0, 8)}</a></td>${hookCol ? `<td>${esc(h.hook)}</td>` : ""}<td>${esc(KIND[h.kind] ?? h.kind)}</td><td>${esc(h.who)}</td><td>${tag(name, t)}</td><td class="wide" title="${esc(h.why)}">${esc(h.why)}</td></tr>`;
  }).join("");
  return filterBar([
    { label: "Who", bare: true, name: "who", options: [{ value: "", label: "All" }, { value: "interactive", label: "Interactive" }, { value: "workers", label: "Workers" }] },
    ...(hookCol ? [{ label: "Hook", name: "hook", data: true, options: [{ value: "", label: "All Hooks" }, ...uniq(xs, (h) => h.hook)] }] : []),
    { label: "Kind", name: "kind", data: true, options: [{ value: "", label: "All Kinds" }, ...uniq(xs, (h) => h.kind).map((k) => ({ value: k, label: KIND[k] ?? k }))] },
    { label: "Outcome", name: "out", data: true, options: [{ value: "", label: "All Outcomes" }, ...OUTS.map(([k, nm]) => ({ value: k, label: nm }))] },
  ]) + `<div id="holds-log">${dataTable(heads(["Time", "Session", ...(hookCol ? ["Hook"] : []), "Kind", "Who", "Outcome", "Reason"]), rows)}</div>`;
};

// The mock's only behaviour: filter the log. The app would wire this in the view.
const script = `<script>
const v = document.getElementById("view"), f = {};
const apply = () => { let c = 0; for (const r of v.querySelectorAll("#holds-log tbody tr")) { const on = Object.entries(f).every(([k, x]) => !x || r.dataset[k] === x); r.hidden = !on; c += on; } v.querySelector("#holds .dp-aside").textContent = c; };
const set = (k, x) => { f[k] = x; const s = v.querySelector(\`select[name="\${k}"]\`); if (s) s.value = x; };
v.addEventListener("change", (e) => { if (e.target.matches(".fbar select")) { f[e.target.name] = e.target.value; apply(); } });
v.addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.closest(".seg[data-name]")) { for (const x of b.parentElement.children) x.setAttribute("aria-pressed", x === b); f[b.parentElement.dataset.name] = b.dataset.value; apply(); }
  else if (b.dataset.show !== undefined) { f.who = ""; for (const x of v.querySelectorAll(".seg[data-name=who] button")) x.setAttribute("aria-pressed", x.dataset.value === ""); if (b.dataset.show) set("hook", b.dataset.show); set("kind", b.dataset.kind ?? ""); set("out", ""); apply(); document.getElementById("holds").scrollIntoView({ behavior: "smooth" }); }
});
</script>`;

const head = readFileSync(join(here, "../../../ui/index.html"), "utf8").split("</head>")[0]
  .replace(/<script src="\/vendor[^>]*><\/script>\n/, "").replace('href="/app.css"', 'href="app.css"');
// Outcome colours: tokens of app.css, one per outcome; "held up" is a pass that cost a turn, so it stays quiet.
const style = `<style>.o-caught{background:var(--done)}.o-handoff{background:var(--done);opacity:.55}.o-held{background:var(--muted)}.o-false{background:var(--error)}.o-none{background:var(--need)}.o-dead{background:var(--rule)}.hooks .tbl td.wide .meter{min-width:160px}.hooks details.src{margin-top:var(--sp-8)}.hooks details.src summary{cursor:pointer;display:flex;gap:var(--sp-10);align-items:baseline}.hooks details.src pre{max-height:40em;overflow:auto;margin:var(--sp-6) 0 0;padding:var(--sp-8) var(--sp-10);background:var(--surface);border:1px solid var(--rule);border-radius:var(--r-tag);font:var(--fs-xs)/1.5 var(--mono);white-space:pre}</style>`;
const write = (file: string, title: string, page: string) => writeFileSync(join(here, file), `${head.replace("<title>aleph</title>", `<title>${esc(title)} · aleph</title>`)}${style}</head>\n<body>\n<div class="shell">\n<nav class="side" aria-label="Views"><a class="mark" href="#/"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="39" fill="none" stroke="currentColor" stroke-width="12"/><circle cx="35.5" cy="64.5" r="20" fill="currentColor"/></svg>aleph</a><div id="nav">${nav}</div></nav>\n<main><div id="view">${page}</div></main>\n</div>\n${script}\n</body></html>\n`);

write("index.html", "Hooks", `<div class="page dp-page hooks">` +
  pageHead("Hooks", { count: String(all), aside: "Last 7 days" }) +
  notice("one way changed Nov 19 (d90a0602): workers skip it, and it counts only the session's own files.") +
  kpis +
  detailPanel("Holds by Hook", String(holds.length), holdTable) +
  detailPanel("Holds by Day", String(holds.length), perDay) +
  detailPanel("Errors by Cause", String(errors.reduce((s, e) => s + e.n, 0)), errTable) +
  detailPanel("Hooks", String(all), invTable) +
  detailPanel("Holds", String(holds.length), holdsLog(holds), "holds") +
  `</div>`);

// A hook's page: its facts, its holds (kinds, days, log), its errors and its source.
const root = join(here, "../../..");
const srcOf = (file: string) => {
  if (!file || file.startsWith("cli/")) return [];
  const body = readFileSync(join(root, file), "utf8");
  const deps = [...body.matchAll(/from "(\.{1,2}\/[^"]+\.ts)"/g)].map((m) => join(file, "..", m[1]));
  return [[file, body], ...deps.map((d) => [d, readFileSync(join(root, d), "utf8")])] as [string, string][];
};
for (const h of hooks) {
  const xs = h.mine;
  const kinds = new Map<string, Hold[]>();
  for (const x of xs) kinds.set(x.kind, [...(kinds.get(x.kind) ?? []), x]);
  const kindRows = [...kinds.entries()].sort((a, b) => b[1].length - a[1].length).map(([k, ys]) =>
    `<tr><td><button type="button" class="link" data-show="" data-kind="${esc(k)}" title="Show these holds">${esc(KIND[k] ?? k)}</button></td><td class="num">${ys.length}</td><td class="num">${n(ys, (y) => y.who === "interactive")}</td><td class="num">${n(ys, (y) => y.who !== "interactive")}</td>` +
    `<td class="wide">${meter(OUTS.map(([o, , cls]) => ({ pct: (100 * n(ys, (y) => y.out === o)) / ys.length, cls })), OUTS.map(([o, nm]) => `${nm} ${n(ys, (y) => y.out === o)}`).join(", "))}</td>` +
    OUTS.map(([o]) => `<td class="num">${n(ys, (y) => y.out === o) || ""}</td>`).join("") + `</tr>`).join("");
  const dayMap = new Map<string, number>();
  for (const x of [...xs].reverse()) { const d = new Date(x.t).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/Los_Angeles" }); dayMap.set(d, (dayMap.get(d) ?? 0) + 1); }
  const top = Math.max(0, ...dayMap.values());
  const errs = errors.filter((e) => e.hooks.includes(h.name));
  const errHtml = errs.length ? dataTable(heads(["Cause", "Event", "Errors (all hooks)", "Sessions", "Fix", "Last"], ["Errors (all hooks)", "Sessions"]),
    errs.map((e) => `<tr><td>${esc(e.cause)}</td><td>${esc(e.events.join(", "))}</td><td class="num">${e.n}</td><td class="num">${e.sessions}</td><td>${esc(FIX[e.cause] ?? "")}</td><td class="time">${esc(when(e.last))}</td></tr>`).join("")) : empty();
  const src = srcOf(h.file);
  const srcHtml = src.length ? src.map(([f, t], i) => `<details class="src"${i ? "" : " open"}><summary><code>${esc(f)}</code><span class="quiet">${t.split("\n").length} lines</span></summary><pre>${esc(t)}</pre></details>`).join("") : empty("The whole CLI");
  write(h.href, h.name, `<div class="page dp-page hooks">` +
    crumb("index.html", [["hooks", "index.html"], [h.ev], [h.name]]) +
    pageHead(h.name, { count: h.ev, aside: "Last 7 days" }) +
    facts([["Event", esc(h.ev)], ["Matcher", h.matcher ? codeText(`\`${h.matcher}\``) : "all"], ["Command", codeText(`\`${h.cmd}\``)], ["Mode", h.mode || "sync"], ["Timeout", `${h.timeout ?? ""} s`], ["Workers", workers(h.skips)]]) +
    (xs.length ? renderKpis([{ k: "Holds", v: String(xs.length) }, ...OUTS.filter(([o]) => n(xs, (y) => y.out === o)).map(([o, nm]) => ({ k: nm, v: String(n(xs, (y) => y.out === o)) }))]) +
      detailPanel("Holds by Kind", String(kinds.size), legendHtml(OUTS.map(([, nm, cls]) => [nm, cls])) + dataTable(heads(["Kind", "Holds", "Interactive", "Workers", "Outcome", ...OUTS.map((o) => o[1])], ["Holds", "Interactive", "Workers", ...OUTS.map((o) => o[1])]), kindRows)) +
      detailPanel("Holds by Day", String(xs.length), barList([...dayMap.entries()].map(([d, c]) => barRow(esc(d), (100 * c) / top, String(c), { top: c === top })).join(""))) +
      detailPanel("Holds", String(xs.length), holdsLog(xs, false), "holds")
      : detailPanel("Holds", "0", empty())) +
    detailPanel("Errors", String(errs.reduce((s, e) => s + e.n, 0)), errHtml) +
    detailPanel("Source", String(src.length), srcHtml) +
    `</div>`);
}
console.log(`wrote index.html and ${hooks.length} hook pages`);
