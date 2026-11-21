// Builds the UI re-think mock from data.public.json: one page per pages/<id>.ts, the overview, and a copy of
// ui/app.css. Run: bun docs/mocks/ui-rethink/build.ts
import { card, chip, dataTable, empty, esc, heads, idLink, inputBox, md, row, sectionHead, subHead } from "../../../ui/views/lib/html.js";
import { count, dur, money, pct, plural } from "../../../ui/views/lib/format.js";
import { attention, band, built, charts, columns, doc, factsLine, frame, inspector, legend, lines, list, liveHref, pageHead, rows, settingRows, sidebar, type Attention, type Page, type Series } from "./kit.ts";
import { flowFigures, groups } from "./pages/issues.ts";

const dir = import.meta.dir, d = await Bun.file(`${dir}/data.public.json`).json();
const files = [...new Bun.Glob("pages/*.ts").scanSync(dir)].sort();
const pages: Page[] = (await Promise.all(files.map(async (f) => {
  const { page } = await import(`${dir}/${f}`);
  if (page.id !== f.slice(6, -3)) throw new Error(`${f} exports the page "${page.id}": a page's id is its file name.`);
  return page as Page;
}))).sort((a, b) => a.order - b.order);

for (const p of pages) await Bun.write(`${dir}/${p.id}.html`, frame(p, pages, d));
await Bun.write(`${dir}/app.css`, Bun.file(`${dir}/../../../ui/app.css`));

// ---- The overview ----

/** A section of README.md, by its heading. */
const readme = await Bun.file(`${dir}/README.md`).text();
const part = (title: string) => readme.split(/^## /m).find((s) => s.startsWith(`${title}\n`))!.slice(title.length + 1);
const section = (title: string, body: string, aside = "") => `<section aria-label="${esc(title)}">${sectionHead(title, { aside })}${body}</section>`;
const find = (id: string) => pages.find((p) => p.id === id)!;
const allRows = pages.flatMap((p) => p.attention(d));

/** Each part of the grammar drawn once, from the snapshot, as a page uses it. */
function grammar() {
  const hooks = d.hooks.byHook.slice(0, 4).map((h: any, i: number) => ({
    // A hook can hold under two kinds, so its name alone is not a key.
    key: `${h.event}/${h.hook}/${i}`, lead: `<span class="idp">${esc(h.event)}</span>`, main: `<span class="t">${esc(h.hook)}</span>${chip(h.kind)}`,
    cells: [esc(count(h.holds))], text: `${h.event} ${h.hook}`, data: { kind: h.kind },
    inspect: inspector({ id: h.event, title: h.hook, rows: [["Holds", esc(count(h.holds))], ["Interactive", esc(count(h.interactive))], ["Workers", esc(count(h.workers))]], href: `${liveHref(find("hooks"))}/${h.event}/${h.hook}` }),
  }));
  const caps = d.automation.caps;
  const limits = settingRows("Limits", [
    { label: "Live jobs", id: "cap-live", control: inputBox("live", caps.live, { id: "cap-live", type: "number" }), hint: `${count(caps.liveNow)} now` },
    { label: "Job time", id: "cap-job", control: inputBox("jobSeconds", caps.jobSeconds, { id: "cap-job", type: "number" }), hint: dur(caps.jobSeconds) },
  ]);
  const runs: Series[] = [{ name: "runs", color: "series-1", values: d.jobs.days.map((x: any) => x.runs) }];
  const cost: Series[] = [{ name: "cost", color: "series-2", values: d.agents.days.map((x: any) => Object.values<number>(x.cost).reduce((n, c) => n + c, 0)) }];
  const day = (ms: number) => new Date(ms).toLocaleDateString("en-US", { weekday: "short" });
  const r = d.agents.rates;
  const spec = (name: string, body: string, wide = false) => `<div${wide ? ' class="wide"' : ""}>${subHead(name)}${body}</div>`;
  return `<div class="rt-spec">` +
    spec("Page head", pageHead(find("issues"))) +
    spec("Attention rows", attention([allRows.find((x) => x.tone === "error")!, allRows.find((x) => x.tone === "need")!])) +
    spec("Facts line", factsLine([[count(d.sessions.who.you.n), "sessions"], [money(d.sessions.who.you.cost), "yours"], [money(d.sessions.who.factory.cost), "factory"], [money(d.sessions.who.headless.cost), "headless"]])) +
    spec("Figure band", band([{ k: "Success", v: pct(r.success * 100), cmp: `${pct(r.baseline * 100)} baseline`, trend: r.success >= r.baseline ? "good" : "warn" }, { k: "First Pass", v: pct(r.firstPass * 100), cmp: `${pct(d.jobs.firstPass * 100)} of jobs` }])) +
    spec("List surface, rows and inspector", list({ label: "Hooks", search: "Search hooks", filters: [{ label: "Kind", name: "kind", options: [...new Set<string>(d.hooks.byHook.map((h: any) => h.kind))] }], groups: [{ title: "Hold", count: count(d.hooks.byHook.length), heads: ["Holds"], rows: hooks }] }), true) +
    spec("Setting rows", card("Limits", limits)) +
    spec("Charts, 2 across", charts([card("Runs per Day", columns(d.jobs.days.map((x: any) => day(x.at)), runs), { aside: legend(runs) }), card("Cost per Day", lines(d.agents.days.map((x: any) => day(x.at)), cost, { fmt: money }), { aside: legend(cost) })]), true) +
    `</div>`;
}

/** The map of the seven pages: views, attention rows from the data, the mock page and the live route. */
function pageMap() {
  const att = (rs: Attention[]) => (rs.length ? rs.map((x) => `<div><span class="event-dot ${x.tone === "need" ? "warning" : x.tone}" aria-hidden="true"></span>${esc(x.text)}</div>`).join("") : `<span class="quiet">none</span>`);
  const body = pages.map((p) => row([
    `<td><a href="${p.id}.html">${esc(p.title)}</a>${built(p) ? "" : ` <span class="quiet">not built</span>`}</td>`, `<td>${esc(p.group)}</td>`,
    `<td>${esc(p.views.map((v) => v.label).join(" · "))}</td>`, `<td class="wide">${att(p.attention(d))}</td>`, `<td>${idLink(`#/${p.route}`, liveHref(p))}</td>`,
  ])).join("");
  return `<div class="card rt-map">${dataTable(heads(["Page", "Group", "Views", "Attention", "Live"]), body)}</div>`;
}

/** Each open choice of the README drawn both ways, the recommended way first. */
function choices() {
  const two = (a: [string, string], b: [string, string]) => `<div class="rt-two"><div>${subHead(a[0])}${a[1]}</div><div>${subHead(b[0])}${b[1]}</div></div>`;
  const byJob: [string, string[]][] = [["Work", ["issues", "jobs", "sessions"]], ["System", ["automation", "agents", "memory", "hooks"]]];
  const I = d.issues, faster = I.closedWeek >= I.filed;
  const say = `<p class="rt-say">Issues close ${faster ? "faster" : "slower"} than they are filed: ${count(I.closedWeek)} closed, ${count(I.filed)} filed. Time to close is ${dur(I.p50)}, ${I.p50 > I.p50Before ? "up" : "down"} from ${dur(I.p50Before)}.</p>`;
  const closed = groups(d)[2], few = { ...closed, rows: closed.rows.slice(0, 5), more: undefined };
  const raw = (key: string) => I.closed.find((x: any) => x.id === key);
  const jobs = (x: any) => (Array.isArray(x.runs) ? x.runs.length : x.runs);
  const kept = { ...few, heads: ["Notes", "Jobs", ...few.heads], rows: few.rows.map((r) => ({ ...r, cells: [esc(count(raw(r.key).notes)), esc(count(jobs(raw(r.key)))), ...r.cells] })) };
  return two(["1. Factory and Claude (recommended)", sidebar(pages, d, "issues")], ["Work and System", sidebar(pages, d, "issues", byJob)]) +
    two(["2. A figure band (recommended)", band(flowFigures(d))], ["One sentence, as Status", say]) +
    two(["3. Notes and Jobs cut (recommended)", card("", rows([few], { select: false }), { label: "Closed issues" })], ["Notes and Jobs kept", card("", rows([kept], { select: false }), { label: "Closed issues" })]);
}

/** A scaled frame of each page at 1440 px, or a placeholder for a page not built yet. */
const shots = () => `<div class="rt-shots">${pages.map((p) => `<figure><figcaption><a href="${p.id}.html">${esc(p.title)}</a><span>${esc(p.views.map((v) => v.label).join(" · "))}</span></figcaption>` +
  (built(p) ? `<a class="shot" href="${p.id}.html"><iframe src="${p.id}.html?thumb" title="${esc(p.title)}" tabindex="-1" scrolling="no"></iframe></a>` : `<div class="shot none">${empty("Not built")}</div>`) + `</figure>`).join("")}</div>`;

const overview = `<div class="page rt-over"><header class="ph"><h1>UI Re-think</h1><span class="count">${plural(pages.length, "page")}</span></header>` +
  section("What Is Wrong", `<div class="md">${md(part("What is wrong today"))}</div>`) +
  section("Page Grammar", grammar(), "each part once") +
  section("Pages", pageMap()) +
  section("Open Choices", choices()) +
  section("Pages Drawn", shots(), "1440 px") + `</div>`;
await Bun.write(`${dir}/index.html`, doc("UI re-think", pages, "index", overview));
console.log(`${pages.map((p) => `${p.id}.html`).join(", ")} and index.html written`);
