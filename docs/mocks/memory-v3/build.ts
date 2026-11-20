// Builds the memory v3 mocks from data.json (the live /api/memory, /processes and /log of 2026-11-20) with the UI's own
// helpers, so each board uses the real markup of app.css. Run: bun docs/mocks/memory-v3/build.ts
import { badge, barList, barRow, card, dataTable, empty, esc, facts, filterBar, heads, list, meter, note, pageHead, statCard, subHead, tag, tiles } from "../../../ui/views/lib/html.js";
import { count } from "../../../ui/views/lib/format.js";

const dir = import.meta.dir, m = await Bun.file(`${dir}/data.json`).json();
const NOW = Date.parse(`${m.asof}T12:00:00`), DAY = 86_400_000;
const B = (n: number) => `${count(n)} B`;
const link = (t: string) => `<a href="#">${esc(t)}</a>`;
const byTitle = new Map(m.notes.map((n: any) => [n.title, n]));
const offers = (t: string, d = 30) => ((byTitle.get(t) as any)?.history ?? []).slice(-d).reduce((a: number, b: number) => a + b, 0);
const ago = (s?: string) => (s ? `${Math.round((NOW - Date.parse(s)) / DAY)} d` : "never");
const fresh = (n: any) => (n.problems ? "lint" : !n.read ? "never" : NOW - Date.parse(n.read) <= 7 * DAY ? "use" : "stale");
const STATUS: Record<string, [string, string]> = { use: ["in use", "done"], stale: ["stale", "quiet"], never: ["never offered", "need"], lint: ["lint", "error"] };

const aleph = m.start.aleph, left = aleph.budget - aleph.bytes;
const core = aleph.core.filter((c: any) => c.kept).map((c: any) => ({ ...c, offers: offers(c.title, 8) }));
const refused = m.lint.refuse.length, late = m.stale.filter((s: any) => s.over > 30).length;
const offered = m.notes.filter((n: any) => n.read && NOW - Date.parse(n.read) <= 7 * DAY).length;
const never = m.notes.filter((n: any) => !n.read).length;
const days = Object.entries(m.days) as [string, any][];
const week = days.filter(([d]) => NOW - Date.parse(d) <= 7 * DAY).reduce((a, [, x]) => a + x.write, 0);
const kinds = Object.entries(m.notes.reduce((a: any, n: any) => ((a[n.kind] = (a[n.kind] ?? 0) + 1), a), {})).sort((a: any, b: any) => b[1] - a[1]) as [string, number][];

const scopeBar = `<div class="fbar"><div class="fg"><span class="fl">Scope</span><select aria-label="Scope"><option>All</option>${m.scopes.map((s: string) => `<option>${esc(s)}</option>`).join("")}</select></div></div>`;
const head = (tabs: string[] | null, on = "") => pageHead("Memory", { count: count(m.total), aside: scopeBar }) +
  (tabs ? `<nav class="vtabs">${tabs.map((t) => `<a href="#"${t === on ? ' aria-current="page"' : ""}>${t}</a>`).join("")}</nav>` : "");

/** The Needs-you strip. The budget item replaces "core lines cut": since 1697e58c a write that grows the scope is refused, so nothing is cut. */
const needs = () => `<div class="mstrip" role="status"><b>Needs you</b>` +
  [[left < 200, "budget", "need", `aleph ${B(left)} left`], [refused > 0, "refused", "error", `${refused} findings refused`], [late > 0, "re-check", "need", `${late} notes over 30 d late`]]
    .filter(([on]) => on).map(([, k, t, text]) => `<a href="#">${tag(k as string, t as string)} ${esc(text as string)}</a>`).join("") + `</div>`;

/** The budget of each start context: a bar per scope, the bytes used and the bytes left. */
const budgets = () => barList(Object.entries(m.start).map(([k, x]: [string, any]) => barRow(esc(k), (x.bytes / x.budget) * 100, `${B(x.bytes)} / ${B(x.budget)}`, { top: x.budget - x.bytes < 200 })).join(""));

/** Every kept core line of a scope, fewest offers first: the rows to trim when a write is refused. */
const coreTable = (rows = core, cols = true) => dataTable(heads(cols ? ["Core line", "Scope", "Offers, 8 d", "Last offered", "Bytes"] : ["Core line", "Offers, 8 d", "Bytes"], ["Offers, 8 d", "Bytes"]),
  [...rows].sort((a, b) => a.offers - b.offers || b.bytes - a.bytes).map((c) => `<tr><td class="wide" title="${esc(c.core)}">${link(c.title)}</td>${cols ? `<td>${esc(c.scope)}</td>` : ""}<td class="num">${count(c.offers)}</td>${cols ? `<td class="time">${ago((byTitle.get(c.title) as any)?.read)}</td>` : ""}<td class="num">${B(c.bytes)}</td></tr>`).join(""));

const startParts = () => dataTable(heads(["Part", "Bytes"], ["Bytes"]),
  [["MEMORY.md", aleph.memory], [`Core lines · ${core.length}`, core.reduce((a: number, c: any) => a + c.bytes, 0)]]
    .map(([k, n]) => `<tr><td>${k}</td><td class="num">${B(n as number)}</td></tr>`).join("") + `<tr><td><strong>Total sent</strong></td><td class="num"><strong>${B(aleph.bytes)}</strong></td></tr>`);

const lintCard = () => {
  const by = Object.entries([...m.lint.refuse.map((f: any) => ({ ...f, r: 1 })), ...m.lint.warn].reduce((a: any, f: any) => ((a[f.rule] ??= []).push(f), a), {})).sort((a: any, b: any) => b[1].length - a[1].length) as [string, any[]][];
  const fix: Record<string, string> = { dangling: "fix or remove the link", schema: "core must be one line", stale: "re-check, then update the date", orphan: "link it from a note", overlap: "merge or split" };
  return card("Lint", dataTable(heads(["Rule", "Findings", "Fix"], ["Findings"]), by.map(([r, fs]) => `<tr><td><code>${esc(r)}</code>${fs.some((f) => f.r) ? " (refused)" : ""}</td><td class="num">${count(fs.length)}</td><td class="wide">${esc(fix[r] ?? "")}</td></tr>`).join("")), { count: count(m.lint.refuse.length + m.lint.warn.length) });
};

const staleCard = () => {
  const top = m.stale.slice(0, 6), most = Math.max(...top.map((s: any) => s.over));
  return card("Re-check", barList(top.map((s: any) => barRow(link(s.note), (s.over / most) * 100, `+${count(s.over)} d of ${count(s.window)}`)).join("")) + note(`${m.stale.length - top.length} more`), { count: count(m.stale.length) });
};

const tileRow = () => tiles("Health", [
  statCard({ k: "Start context", v: B(left), note: `left of ${B(aleph.budget)}` }),
  statCard({ k: "Offered, 7 days", v: count(offered), v2: count(m.total), q: ["offered", "notes"] }),
  statCard({ k: "Never offered", v: count(never) }),
  statCard({ k: "Unoffered reads", v: count(m.misses.unoffered_reads), note: "7 days" }),
  statCard({ k: "Lint findings", v: count(refused + m.lint.warn.length), note: `${count(refused)} refused` }),
  statCard({ k: "Writes, 7 days", v: count(week) }),
].join(""));

/** The maintainer's steps: when each ran and what it did. The episode writer and corrections mining are gone (c3d6e604). */
const maintCard = () => card("Maintainer", dataTable(heads(["Step", "Runs", "Last", "Result"]), m.steps.map((s: any) => `<tr><td>${esc(s.name)}</td><td>${esc(s.runs)}</td><td class="time">${ago(s.last)}</td><td class="wide" title="${esc(s.result)}">${esc(s.detail ?? s.result)}</td></tr>`).join("")));

const writesCard = (n = 8) => card("Recent Writes", `<ul class="mrows">${m.writes.slice(0, n).map((w: any) => `<li class="mrow"><div class="mh"><b>${esc(w.text.split(" — ")[0].replace(/\[\[|\]\]/g, ""))}</b><span class="quiet">${esc(w.at.slice(0, 10))}</span></div><p class="mm">${esc(w.text.split(" — ")[1] ?? "")}</p></li>`).join("")}</ul>`, { count: count(m.writes.length) });

const noteRows = (xs: any[]) => xs.map((n) => `<tr><td class="wide">${link(n.title)}</td><td>${esc(n.kind)}</td><td>${esc(n.scope)}</td><td class="num">${count(offers(n.title))}</td><td class="time">${ago(n.read)}</td><td class="time">${esc(n.updated)}</td><td>${tag(...STATUS[fresh(n)])}</td></tr>`).join("");
const notesTable = (xs: any[]) => dataTable(heads(["Note", "Kind", "Scope", "Offers, 30 d", "Last offered", "Updated", "Status"], ["Offers, 30 d"]), noteRows(xs));
const topNotes = [...m.notes].sort((a, b) => offers(b.title) - offers(a.title)).slice(0, 14);
const kindBar = filterBar([{ label: "Kind", name: "kind", value: "", options: [{ value: "", label: `All ${count(m.total)}` }, ...kinds.map(([k, n]) => ({ value: k, label: `${k} ${count(n)}` }))] },
  { label: "Freshness", name: "fresh", value: "", options: [{ value: "", label: "All" }, { value: "use", label: `Offered in 7 days ${count(offered)}` }, { value: "never", label: `Never offered ${count(never)}` }, { value: "lint", label: "Lint" }] }]);
const search = `<div class="fbar"><div class="fg"><input type="search" placeholder="Search memory" aria-label="Search memory" style="min-width:320px"></div></div>`;

const page = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Merriweather:wght@400;700&family=Work+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<link href="https://cdnjs.cloudflare.com/ajax/libs/hack-font/3.3.0/web/hack.min.css" rel="stylesheet">
<link rel="stylesheet" href="app.css"></head><body><main><div class="page">${body}</div></main></body></html>`;

const boards: Record<string, [string, string]> = {
  "a-headroom.html": ["A · Headroom", head(["Notes", "Health", "Log"], "Health") + needs() + list(tileRow() +
    card("Start Context", budgets() + subHead("Trim first: fewest offers") + coreTable() + subHead("What the aleph session receives") + startParts(), { aside: "aleph" }) +
    `<div class="pair">${lintCard()}${staleCard()}</div>`)],
  "b-two-tiers.html": ["B · Two tiers", head(["Notes", "Health", "Log"], "Notes") + needs() + list(
    `<div class="pair">${card("Every Session", `<p class="lede">MEMORY.md and the core lines. Sent at the start of each session.</p>` + barList(barRow("aleph", (aleph.bytes / aleph.budget) * 100, `${B(aleph.bytes)} / ${B(aleph.budget)}`, { top: true })) +
      facts([["MEMORY.md", B(aleph.memory)], ["Core lines", `${core.length}`], ["Left", B(left)]]) + coreTable(core, false), { count: count(core.length + 1) })}` +
    `${card("On Recall", `<p class="lede">The wiki notes. Offered when a prompt matches them.</p>` + search + kindBar + notesTable(topNotes.slice(0, 12)), { count: count(m.total) })}</div>`)],
  "c-one-page.html": ["C · One page", head(null) + needs() + list(tileRow() +
    `<div class="pair">${card("Start Context", budgets() + subHead("Trim first") + coreTable(core.slice(0, 8), false), { aside: "aleph" })}${maintCard()}</div>` +
    card("Notes", search + kindBar + notesTable(topNotes), { count: count(m.total) }) +
    `<div class="pair">${writesCard()}${lintCard()}</div>`)],
};

for (const [file, [title, body]] of Object.entries(boards)) await Bun.write(`${dir}/${file}`, page(`Memory · ${title}`, body));
await Bun.write(`${dir}/index.html`, page("Memory v3 mocks", pageHead("Memory v3 mocks") + `<ul>${Object.entries(boards).map(([f, [t]]) => `<li><a href="${f}">${esc(t)}</a></li>`).join("")}</ul>`));
console.log(Object.keys(boards).join(" "));
