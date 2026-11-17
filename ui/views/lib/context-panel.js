// The Context tab of the Memory page, on /api/context: a picker for the session and its request, the fill of the
// selected request as a bar, the fill of every request as a chart, and the parts the request holds. A part is exact
// when the endpoint says so (from API usage) and est. otherwise (chars ÷ 4). The Tools and Tool results rows unfold
// into each tool and each call; a call's input loads its result text. Every other part unfolds into its items, and
// the compact summary into its text.
import { get } from "./router.js";
import { goQuery, hashQuery, keep, kept, setQuery } from "./address.js";
import { panelOf } from "./chart.js";
import { count, pct, plural, when } from "./format.js";
import { actButton, card, chip, dataTable, empty, error, esc, field, fold, heads, list, legendHtml, loadingLine, meter, pagedTable, selectBox } from "./html.js";

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
      `<tr><td class="num">${count(c.n)}</td><td class="mono wide" title="${esc(c.input)}"><button type="button" class="link" data-call="${esc(c.id)}">${esc(c.input)}</button></td><td class="num">${count(c.tokens)}</td><td>${how(c.how)}</td></tr>`);
    return kfold(`calls:${tool}`, `${esc(tool)}<span class="peek" title="${plural(cs.length, "call")} · ${count(sum(cs))} · ${share(sum(cs), total)}">${plural(cs.length, "call")} · ${count(sum(cs))} · ${share(sum(cs), total)}</span>`,
      pagedTable(heads(["Request", "Input", "Tokens", "How"], ["Request", "Tokens"]), rows) + `<div data-result hidden></div>`);
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

function picker(m, id, session, r) {
  const last = session.requests.length;
  const opts = m.sessions.map((s) => ({ value: s.id, label: `${s.id.slice(0, 8)} · ${when(s.updated)} · ${s.project}` }));
  // actButton() has no disabled option: the attribute goes on its markup.
  const step = (label, n) => { const b = actButton(label, { n }); return n < 1 || n > last || n === r.n ? b.replace("<button", "<button disabled") : b; };
  return `<div class="actions">${field("Session", selectBox("Session", "session", opts, id, { id: "ctx-session" }))}` +
    `<span>Request ${step("Previous", r.n - 1)} <strong>${count(r.n)}</strong> of ${count(last)} ${step("Next", r.n + 1)} ${step("Latest", last)}</span></div>`;
}

/** The class of the nth part's segment and swatch: the series colours, then `--muted` for the eighth. */
const series = (i) => `c-s${i % 8 + 1}`;

function fillBar(r, limit) {
  const u = r.usage;
  return card("Fill of Request " + r.n, `<p><strong>${count(r.fill)}</strong> of ${count(limit)} tokens · ${pct(r.fill / limit * 100)} ${how("exact")}</p>` +
    `<p class="quiet">input ${count(u.input)} · cache read ${count(u.cacheRead)} · cache write ${count(u.cacheWrite)} · output ${count(u.output)}</p>` +
    meter(r.parts.map((p, i) => ({ pct: p.tokens / limit * 100, cls: series(i) })), "Context fill by part") + legendHtml(r.parts.map((p, i) => [p.name, series(i)])));
}

/** The frame of the fill of each request: the selected one in --ink, one that follows a compaction dashed. A click picks it. */
export const fillFrame = (requests, r) => ({
  measure: { name: "Fill per Request", unit: "count", agg: "max" },
  over: { kind: "time", window: "week" },
  by: { keys: [{ key: "fill", name: "fill" }] },
  rows: requests.map((x, i) => ({ name: String(x.n), fill: x.fill, on: x === r, dashed: i > 0 && x.fill < requests[i - 1].fill, pick: x.n })),
  form: "columns",
  legend: false,
});

function parts(r, s) {
  const more = (p) => p.rec === "prompt_snapshot.tools" ? (s.tools.length ? byTool(s.tools, p.tokens) : "") : p.rec === "tool_result" ? byCall(s.calls, r, p.tokens)
    : p.rec === "isCompactSummary" ? summary(s.summaries, r) : byItem(s.items, r, p);
  const rows = r.parts.map((p) => [p, more(p)]).map(([p, m]) => `<tr><td>${esc(p.name)}</td><td class="mono">${esc(p.rec)}</td><td class="num">${count(p.tokens)}</td><td>${how(p.how)}</td></tr>` +
    (m ? `<tr><td colspan="4">${m}</td></tr>` : ""));
  rows.push(`<tr><td><strong>Total</strong></td><td class="mono">message.usage</td><td class="num"><strong>${count(r.fill)}</strong></td><td>${how("exact")}</td></tr>`);
  return card(`What Is in Request ${r.n}`, dataTable(heads(["Part", "Record", "Tokens", "How"], ["Tokens"]), rows.join("")));
}

/** The session the tab loaded last, through keep(): `{ n, session }`, with `n` the request of the query it was loaded for. */
const KEPT = "memory.context";
/** The kept session when the query names it (or none, for the newest) and the same request, else null: a redraw then needs no load. */
export function held(m, query) {
  const k = kept(KEPT, null);
  return k && k.session?.id === (query.get("session") || m.sessions[0]?.id) && k.n === (query.get("n") ?? "") ? k.session : null;
}

/** The body of the tab: `m` is the /api/context body, with `session` the /api/context/:id body once loaded; `o.n` the request. */
export function renderContext(m, o = {}) {
  if (!m.sessions.length) return empty();
  if (!m.session) return `<div id="ctx-body">${loadingLine("the session")}</div>`;
  if (!m.session.requests.length) return `<div id="ctx-body">${empty()}</div>`;
  const r = pick(m.session.requests, o.n);
  return `<div id="ctx-body">${list(`${picker(m, m.session.id, m.session, r)}${fillBar(r, m.session.window)}${panelOf("memory/fill", fillFrame(m.session.requests, r))}${parts(r, m.session)}`)}</div>`;
}

/** Load the selected session (the newest by default) and draw it; a pick of a request redraws without loading. */
export async function mountContext(root, m, query) {
  if (!m.sessions.length) return;
  const id = query.get("session") || m.sessions[0].id;
  // The chart panel draws once its element has a frame.
  const plot = () => {
    const el = root.querySelector('aleph-chart[key="memory/fill"]');
    if (el) el.frame = fillFrame(session.requests, pick(session.requests, hashQuery().get("n")));
  };
  const draw = () => { root.querySelector("#ctx-body").outerHTML = renderContext({ ...m, session }, { n: hashQuery().get("n") }); plot(); };
  const go = (n) => { setQuery({ n }); keep(KEPT, { n, session }); draw(); };
  let session = held(m, query);
  if (!session) {
    try {
      const res = await get(`/api/context/${encodeURIComponent(id)}`, "ctx-session");
      if (!res) return;
      session = await res.json();
      if (!res.ok) throw new Error(session.error ?? `answered ${res.status}`);
    } catch (e) { root.querySelector("#ctx-body").innerHTML = error("Could not load the session.", { detail: e.message }); return; }
    keep(KEPT, { n: query.get("n") ?? "", session });
    draw();
  } else plot();
  // A click on a bar of the chart. A property holds the handler, so each mount replaces the last one's, as for onclick.
  if (root._pick) root.removeEventListener("chartpick", root._pick);
  root._pick = (e) => go(String(e.detail));
  root.addEventListener("chartpick", root._pick);
  root.onclick = async (e) => {
    const b = e.target.closest?.("#ctx-body button[data-n]");
    if (b && !b.disabled) go(b.dataset.n);
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
  root.onchange = (e) => { if (e.target.id === "ctx-session") goQuery({ session: e.target.value, n: "" }); };
}
