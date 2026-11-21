// The Context tab of a session page, on /api/context/:id: the request picker, tiles for the selected request (its fill
// against the compaction trigger, the memory share, the fixed overhead, the cache hit, the compactions), the fill of
// every request by part group as a chart, and the parts the request holds with their growth since the last
// compaction. A part is exact when the endpoint says so (from API usage) and est. otherwise (chars ÷ 4). The Tools and
// Tool results rows unfold into each tool and each call; a call's input loads its result text. Every other part
// unfolds into its items, and the compact summary into its text.
import { get } from "./router.js";
import { hashQuery, keep, kept, setQuery } from "./address.js";
import { panelOf } from "./chart.js";
import { count, pct, plural } from "./format.js";
import { actButton, card, chip, dataTable, empty, error, esc, fold, heads, list, loadingLine, pagedTable, rowAct, statCard, tiles } from "./html.js";

const how = (h) => chip(h === "exact" ? "exact" : "est.");
const pick = (requests, n) => requests.find((r) => r.n === Number(n)) ?? requests.at(-1);
const share = (n, of) => pct(n / Math.max(of, 1) * 100);
/** A fold that keeps its open state under `context.<key>`, so a redraw for another request keeps it. */
const kfold = (key, summary, body) => fold(summary, body, { keep: `context.${key}` });

function byTool(tools, total) {
  const rows = [...tools].sort((a, b) => b.tokens - a.tokens).map((t) =>
    `<tr><td class="mono wide" title="${esc(t.name)}">${esc(t.name)}</td><td>${esc(t.name.match(/^mcp__(.+?)__/)?.[1] ?? "built-in")}</td><td class="num">${count(t.tokens)}</td><td class="num">${share(t.tokens, total)}</td></tr>`);
  return kfold("tools", "By tool", pagedTable(heads(["Tool", "Server", "Tokens", "Share"], ["Tokens", "Share"]), rows));
}

/** The calls the request holds, those after its `since`, by tool and then by call. */
function byCall(calls, r, total) {
  const groups = new Map();
  for (const c of calls) if (c.n > r.since && c.n <= r.n) groups.set(c.tool, [...(groups.get(c.tool) ?? []), c]);
  const sum = (cs) => cs.reduce((s, c) => s + c.tokens, 0);
  return [...groups].sort((a, b) => sum(b[1]) - sum(a[1])).map(([tool, cs]) => {
    const rows = cs.sort((a, b) => b.tokens - a.tokens).map((c) =>
      `<tr><td class="num">${count(c.n)}</td><td class="mono wide" title="${esc(c.input)}">${esc(c.input)}</td><td class="num">${count(c.tokens)}</td><td>${how(c.how)}</td>${rowAct("Show", { call: c.id })}</tr>`);
    return kfold(`calls:${tool}`, `${esc(tool)}<span class="peek" title="${plural(cs.length, "call")} · ${count(sum(cs))} · ${share(sum(cs), total)}">${plural(cs.length, "call")} · ${count(sum(cs))} · ${share(sum(cs), total)}</span>`,
      pagedTable(heads(["Request", "Input", "Tokens", "How", "Action"], ["Request", "Tokens"]), rows) + `<div data-result hidden></div>`);
  }).join("");
}

/** What each part's items are, by the part's record. */
const BY = {
  prompt_snapshot: "By heading", "attachment instructions": "By file", hook_additional_context: "By hook", "rest of request 1": "By kind",
  user: "By kind", assistant: "By block", attachment: "By type", "hook UserPromptSubmit": "By offer",
};

/** A part's items that the request holds, by name: fixed items (n 1) always, message items after its `since`. */
function byItem(items, r, p) {
  const groups = new Map();
  for (const i of items) {
    if (i.rec !== p.rec || i.n !== 1 && (i.n <= r.since || i.n > r.n)) continue;
    const g = groups.get(i.name) ?? { count: 0, tokens: 0 };
    groups.set(i.name, { count: g.count + 1, tokens: g.tokens + i.tokens });
  }
  if (!groups.size) return "";
  const rows = [...groups].sort((a, b) => b[1].tokens - a[1].tokens).map(([name, g]) =>
    `<tr><td class="wide" title="${esc(name)}">${esc(name)}</td><td class="num">${count(g.count)}</td><td class="num">${count(g.tokens)}</td><td class="num">${share(g.tokens, p.tokens)}</td></tr>`);
  return kfold(`items:${p.rec}`, BY[p.rec] ?? "By item", pagedTable(heads(["Item", "Count", "Tokens", "Share"], ["Count", "Tokens", "Share"]), rows));
}

function summary(summaries, r) {
  const s = summaries.find((x) => x.n === r.since);
  return s ? kfold("summary", "Text", `<pre class="stat tall">${esc(s.text)}</pre>`) : "";
}

function picker(session, r) {
  const last = session.requests.length;
  // actButton() has no disabled option: the attribute goes on its markup.
  const step = (label, n) => { const b = actButton(label, { n }); return n < 1 || n > last || n === r.n ? b.replace("<button", "<button disabled") : b; };
  return `<div class="actions"><span>Request ${step("Previous", r.n - 1)} <strong>${count(r.n)}</strong> of ${count(last)} ${step("Next", r.n + 1)} ${step("Latest", last)}</span></div>`;
}

/** The chart's part groups, each with the records of the parts it sums. */
// prettier-ignore
const GROUPS = [
  ["fixed", "Fixed: system, tools, instructions", ["prompt_snapshot", "prompt_snapshot.tools", "attachment instructions"]],
  ["other", "Other (rest of request 1)", ["rest of request 1"]],
  ["results", "Tool results", ["tool_result"]],
  ["memory", "Memory: start context, recall offers", ["hook_additional_context", "hook UserPromptSubmit"]],
  ["attach", "Attachments", ["attachment"]],
  ["talk", "Conversation, compact summary", ["user", "assistant", "isCompactSummary"]],
];
const sumOf = (r, recs) => r.parts.filter((p) => recs.includes(p.rec)).reduce((n, p) => n + p.tokens, 0);
/** The requests whose fill fell below 60% of the request before: a compaction. */
const compactions = (requests) => requests.filter((x, i) => i > 0 && x.fill < 0.6 * requests[i - 1].fill);

/** The frame of the fill of each request by part group: the selected one in --ink. A click picks it. */
export const fillFrame = (requests, r) => ({
  measure: { name: "Fill per Request by Part", unit: "count", agg: "max" },
  over: { kind: "time", window: "week" },
  by: { keys: GROUPS.map(([key, name]) => ({ key, name })) },
  rows: requests.map((x) => ({ name: String(x.n), ...Object.fromEntries(GROUPS.map(([key, , recs]) => [key, sumOf(x, recs)])), on: x === r, pick: x.n })),
});

/** The tiles of request `r`: fill against the compaction trigger, memory share, fixed overhead, cache hit, compactions. */
function kpis(s, r) {
  const u = r.usage, mem = sumOf(r, GROUPS[3][2]), fixed = sumOf(r, GROUPS[0][2]), cuts = compactions(s.requests), last = cuts.at(-1);
  const before = last && s.requests.find((x) => x.n === last.n - 1);
  return tiles("Context", [
    statCard({ k: "Fill", v: count(r.fill), v2: count(s.trigger), q: ["tokens", "compaction trigger"] }),
    statCard({ k: "Memory share", v: pct((mem / r.fill) * 100), note: `${count(mem)} tokens of fill` }),
    statCard({ k: "Fixed overhead", v: count(fixed), note: `${pct((fixed / r.fill) * 100)} of fill` }),
    statCard({ k: "Cache hit", v: pct((u.cacheRead / Math.max(r.fill, 1)) * 100), note: `${count(u.cacheWrite)} written` }),
    statCard({ k: "Compactions", v: count(cuts.length), note: last ? `request ${last.n}: ${count(before.fill)} to ${count(last.fill)}` : "" }),
  ].join(""));
}

function parts(r, s) {
  const more = (p) => p.rec === "prompt_snapshot.tools" ? (s.tools.length ? byTool(s.tools, p.tokens) : "") : p.rec === "tool_result" ? byCall(s.calls, r, p.tokens)
    : p.rec === "isCompactSummary" ? summary(s.summaries, r) : byItem(s.items, r, p);
  // Growth since the last compaction: tokens now less the part's tokens at the compaction's request (request 1 when none).
  const base = s.requests.find((x) => x.n === r.since) ?? s.requests[0], then = (rec) => base.parts.filter((p) => p.rec === rec).reduce((n, p) => n + p.tokens, 0);
  const change = (n) => (n > 0 ? `+${count(n)}` : count(n));
  const row = (name, tokens, grew, h, bold = false) => { const b = (x) => (bold ? `<strong>${x}</strong>` : x); return `<tr><td>${b(esc(name))}</td><td class="num">${b(count(tokens))}</td><td class="num">${share(tokens, r.fill)}</td><td class="num">${change(grew)}</td><td>${how(h)}</td></tr>`; };
  const rows = r.parts.map((p) => [p, more(p)]).map(([p, m]) => row(p.name, p.tokens, p.tokens - then(p.rec), p.how) + (m ? `<tr><td colspan="5">${m}</td></tr>` : ""));
  const mem = GROUPS[3][2], memNow = sumOf(r, mem);
  rows.push(row("Memory, start context and offers", memNow, memNow - sumOf(base, mem), "exact"), row("Total", r.fill, r.fill - base.fill, r.parts.some((p) => p.how !== "exact") ? "est" : "exact", true));
  return card(`What Is in Request ${count(r.n)}`, dataTable(heads(["Part", "Tokens", "Share of fill", `Change since request ${base.n}`, "How"], ["Tokens", "Share of fill", `Change since request ${base.n}`]), rows.join("")), { aside: "Share is of fill" });
}

/** The session the tab loaded last, through keep(): `{ n, session }`, with `n` the request of the query it was loaded for. */
const KEPT = "session.context";
/** The kept session when it is `id` and the query names the same request, else null: a redraw then needs no load. */
function held(id, query) {
  const k = kept(KEPT, null);
  return k && k.session?.id === id && k.n === (query.get("n") ?? "") ? k.session : null;
}

/** The body of the tab: `s` is the /api/context/:id body, or null while it loads; `o.n` the request. */
export function renderContext(s, o = {}) {
  if (!s) return `<div id="ctx-body">${loadingLine("the context")}</div>`;
  if (!s.requests.length) return `<div id="ctx-body">${empty()}</div>`;
  const r = pick(s.requests, o.n);
  return `<div id="ctx-body">${list(`${picker(s, r)}${kpis(s, r)}${panelOf("session/fill", fillFrame(s.requests, r))}${parts(r, s)}`)}</div>`;
}

/** Load session `id`'s context and draw it; a pick of a request redraws without loading. */
export async function mountContext(root, id, query) {
  // The chart panel draws once its element has a frame.
  const plot = () => {
    const el = root.querySelector('aleph-chart[key="session/fill"]');
    if (el) el.frame = fillFrame(session.requests, pick(session.requests, hashQuery().get("n")));
  };
  const draw = () => { root.querySelector("#ctx-body").outerHTML = renderContext(session, { n: hashQuery().get("n") }); plot(); };
  const go = (n) => { setQuery({ n }); keep(KEPT, { n, session }); draw(); };
  let session = held(id, query);
  if (!session) {
    try {
      const res = await get(`/api/context/${encodeURIComponent(id)}`, "ctx-session");
      if (!res) return;
      session = await res.json();
      if (!res.ok) throw new Error(session.error ?? `answered ${res.status}`);
    } catch (e) { root.querySelector("#ctx-body").innerHTML = error("Could not load the context.", { detail: e.message }); return; }
    keep(KEPT, { n: query.get("n") ?? "", session });
  }
  draw();
  // A click on a bar of the chart. A property holds the handler, so each mount replaces the last one's, as for onclick.
  if (root._pick) root.removeEventListener("chartpick", root._pick);
  root._pick = (e) => go(String(e.detail));
  root.addEventListener("chartpick", root._pick);
  // The session page's onclick runs its tabs, so the context's clicks take a listener of their own, replaced as above.
  if (root._ctx) root.removeEventListener("click", root._ctx);
  root._ctx = async (e) => {
    const b = e.target.closest?.("#ctx-body button[data-n]");
    if (b && !b.disabled) return go(b.dataset.n);
    const c = e.target.closest?.("#ctx-body button[data-call]");
    if (!c) return;
    const out = c.closest("details").querySelector("[data-result]");
    out.hidden = false;
    out.innerHTML = loadingLine("the call");
    try {
      const res = await get(`/api/context/${encodeURIComponent(id)}/calls/${encodeURIComponent(c.dataset.call)}`, "ctx-call");
      if (!res) return;
      const x = await res.json();
      if (!res.ok) throw new Error(x.error ?? `answered ${res.status}`);
      out.innerHTML = `<pre class="stat tall">${esc(`${x.tool} ${JSON.stringify(x.input)}\n\n${x.text}`)}</pre>`;
    } catch (err) { out.innerHTML = error("Could not load the call.", { detail: err.message }); }
  };
  root.addEventListener("click", root._ctx);
}
