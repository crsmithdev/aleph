// The Context tab of the Memory page, on /api/context: a picker for the session and its request, the fill of the
// selected request as a bar, the fill of every request as a chart, and the parts the request holds. A part is exact
// when the endpoint says so (from API usage) and est. otherwise (chars ÷ 4). The Tools and Tool results rows unfold
// into each tool and each call; a call's input loads its result text. Every other part unfolds into its items, and
// the compact summary into its text.
import { get } from "../router.js";
import { card, count, dataTable, empty, error, esc, goQuery, hashQuery, heads, loadingLine, setQuery, tag } from "../lib.js";

const SERIES = ["--series-1", "--series-2", "--series-3", "--chart-6", "--chart-7", "--run", "--need", "--done"];
const colour = (i) => `var(${SERIES[i % SERIES.length]})`;
const how = (h) => (h === "exact" ? tag("exact", "done") : tag("est.", "need"));
const pick = (requests, n) => requests.find((r) => r.n === Number(n)) ?? requests.at(-1);
const share = (n, of) => `${(n / Math.max(of, 1) * 100).toFixed(1)}%`;
/** The keys of the open folds, so a redraw for another request keeps them open. */
const opened = new Set();
const fold = (key, summary, body) => `<details data-key="${esc(key)}"${opened.has(key) ? " open" : ""}><summary>${summary}</summary>${body}</details>`;

function byTool(tools, total) {
  const rows = [...tools].sort((a, b) => b.tokens - a.tokens).map((t) =>
    `<tr><td class="mono wide" title="${esc(t.name)}">${esc(t.name)}</td><td>${esc(t.name.match(/^mcp__(.+?)__/)?.[1] ?? "built-in")}</td><td class="num">${count(t.tokens)}</td><td class="num">${share(t.tokens, total)}</td></tr>`);
  return fold("tools", "By tool", dataTable(heads(["Tool", "Server", "Tokens", "Share"], ["Tokens", "Share"]), rows.join("")));
}

/** The calls the request holds, those after its `since`, by tool and then by call. */
function byCall(calls, r, total) {
  const groups = new Map();
  for (const c of calls) if (c.n > r.since && c.n <= r.n) groups.set(c.tool, [...(groups.get(c.tool) ?? []), c]);
  const sum = (cs) => cs.reduce((s, c) => s + c.tokens, 0);
  return [...groups].sort((a, b) => sum(b[1]) - sum(a[1])).map(([tool, cs]) => {
    const rows = cs.sort((a, b) => b.tokens - a.tokens).map((c) =>
      `<tr><td class="num">${c.n}</td><td class="mono wide" title="${esc(c.input)}"><button type="button" class="link" data-call="${esc(c.id)}">${esc(c.input)}</button></td><td class="num">${count(c.tokens)}</td><td>${how(c.how)}</td></tr>`);
    return fold(`calls:${tool}`, `${esc(tool)}<span class="peek" title="${count(cs.length)} calls · ${count(sum(cs))} · ${share(sum(cs), total)}">${count(cs.length)} calls · ${count(sum(cs))} · ${share(sum(cs), total)}</span>`,
      dataTable(heads(["Request", "Input", "Tokens", "How"], ["Request", "Tokens"]), rows.join("")) + `<pre class="stat" data-result hidden style="max-height:360px;overflow:auto"></pre>`);
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
  return fold(`items:${p.rec}`, BY[p.rec] ?? "By item", dataTable(heads(["Item", "Count", "Tokens", "Share"], ["Count", "Tokens", "Share"]), rows.join("")));
}

function summary(summaries, r) {
  const s = summaries.find((x) => x.n === r.since);
  return s ? fold("summary", "Text", `<pre class="stat" style="max-height:360px;overflow:auto;white-space:pre-wrap">${esc(s.text)}</pre>`) : "";
}

function picker(m, id, session, r) {
  const last = session.requests.length;
  const opts = m.sessions.map((s) => `<option value="${esc(s.id)}"${s.id === id ? " selected" : ""}>${esc(`${s.id.slice(0, 8)} · ${s.updated.slice(0, 10)} · ${s.project}`)}</option>`).join("");
  const step = (label, n) => `<button type="button" data-n="${n}"${n < 1 || n > last || n === r.n ? " disabled" : ""}>${label}</button>`;
  return `<div style="display:flex;flex-wrap:wrap;gap:16px;align-items:center"><label class="ctx-session">Session <select id="ctx-session" name="session">${opts}</select></label>` +
    `<span>Request ${step("Previous", r.n - 1)} <strong>${r.n}</strong> of ${last} ${step("Next", r.n + 1)} ${step("Latest", last)}</span></div>`;
}

function fillBar(r, limit) {
  const segs = r.parts.map((p, i) => `<i style="width:${(p.tokens / limit * 100).toFixed(2)}%;background:${colour(i)}" title="${esc(p.name)}"></i>`).join("");
  const key = r.parts.map((p, i) => `<span><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${colour(i)}"></i> ${esc(p.name)}</span>`).join("");
  const u = r.usage;
  return card("Fill of request " + r.n, `<p><strong>${count(r.fill)}</strong> of ${count(limit)} tokens · ${(r.fill / limit * 100).toFixed(1)}% ${how("exact")}</p>` +
    `<p class="quiet">input ${count(u.input)} · cache read ${count(u.cacheRead)} · cache write ${count(u.cacheWrite)} · output ${count(u.output)}</p>` +
    `<div style="display:flex;height:22px;border-radius:6px;overflow:hidden;background:var(--sunk)" role="img" aria-label="Context fill by part">${segs}</div><p class="quiet" style="display:flex;flex-wrap:wrap;gap:16px">${key}</p>`);
}

function chart(requests, r, limit) {
  const bars = requests.map((x, i) => {
    const cut = i && x.fill < requests[i - 1].fill;
    return `<button type="button" data-n="${x.n}" aria-label="request ${x.n}, ${count(x.fill)} tokens${cut ? ", after a compaction" : ""}"` +
      ` aria-pressed="${x === r}" style="flex:1;min-width:0;padding:0;border:0;background:${x === r ? "var(--stuck)" : "var(--run)"};height:${Math.min(x.fill / limit, 1) * 100}%${cut ? ";outline:1px dashed var(--stuck)" : ""}"></button>`;
  }).join("");
  return card("Fill per request", `<div style="display:flex;align-items:flex-end;gap:2px;height:170px;border-bottom:1px solid var(--rule)">${bars}</div><p class="quiet">Click a bar to inspect that request. A dashed bar follows a compaction.</p>`);
}

function parts(r, s) {
  const more = (p) => p.rec === "prompt_snapshot.tools" ? (s.tools.length ? byTool(s.tools, p.tokens) : "") : p.rec === "tool_result" ? byCall(s.calls, r, p.tokens)
    : p.rec === "isCompactSummary" ? summary(s.summaries, r) : byItem(s.items, r, p);
  const rows = r.parts.map((p) => [p, more(p)]).map(([p, m]) => `<tr><td>${esc(p.name)}</td><td class="mono">${esc(p.rec)}</td><td class="num">${count(p.tokens)}</td><td>${how(p.how)}</td></tr>` +
    (m ? `<tr><td colspan="4">${m}</td></tr>` : ""));
  rows.push(`<tr><td><strong>Total</strong></td><td class="mono">message.usage</td><td class="num"><strong>${count(r.fill)}</strong></td><td>${how("exact")}</td></tr>`);
  return card(`What is in request ${r.n}`, dataTable(heads(["Part", "Record", "Tokens", "How"], ["Tokens"]), rows.join("")) +
    `<p class="quiet">The fixed parts sum to the fill of request 1. With an Anthropic key, count_tokens counts each one and Other holds the rest. Without a key, the split is est. Each tool, and each item of a part, is its share of the part by chars, est. A message part is the usage of its request minus the usage of the request before it, exact unless one gap held more than one kind of record.</p>`);
}

/** The body of the tab: `m` is the /api/context body, with `session` the /api/context/:id body once loaded; `o.n` the request. */
export function renderContext(m, o = {}) {
  if (!m.sessions.length) return empty();
  if (!m.session) return `<div id="ctx-body">${loadingLine("the session")}</div>`;
  if (!m.session.requests.length) return `<div id="ctx-body">${empty()}</div>`;
  const r = pick(m.session.requests, o.n);
  return `<div id="ctx-body">${picker(m, m.session.id, m.session, r)}${fillBar(r, m.session.window)}${chart(m.session.requests, r, m.session.window)}${parts(r, m.session)}</div>`;
}

/** Load the selected session (the newest by default) and draw it; a pick of a request redraws without loading. */
export async function mountContext(root, m, query) {
  if (!m.sessions.length) return;
  const id = query.get("session") || m.sessions[0].id;
  const draw = () => { root.querySelector("#ctx-body").outerHTML = renderContext({ ...m, session }, { n: hashQuery().get("n") }); };
  let session;
  try {
    const res = await get(`/api/context/${encodeURIComponent(id)}`, "ctx-session");
    if (!res) return;
    session = await res.json();
    if (!res.ok) throw new Error(session.error ?? `answered ${res.status}`);
  } catch (e) { root.querySelector("#ctx-body").innerHTML = error(`Could not load the session: ${e.message}`); return; }
  draw();
  root.onclick = async (e) => {
    const b = e.target.closest?.("#ctx-body button[data-n]");
    if (b && !b.disabled) { setQuery({ n: b.dataset.n }); draw(); }
    const c = e.target.closest?.("#ctx-body button[data-call]");
    if (!c) return;
    const pre = c.closest("details").querySelector("pre[data-result]");
    pre.hidden = false;
    pre.textContent = "Loading…";
    try {
      const res = await get(`/api/context/${encodeURIComponent(id)}/calls/${encodeURIComponent(c.dataset.call)}`, "ctx-call");
      if (!res) return;
      const x = await res.json();
      if (!res.ok) throw new Error(x.error ?? `answered ${res.status}`);
      pre.textContent = `${x.tool} ${JSON.stringify(x.input)}\n\n${x.text}`;
    } catch (err) { pre.textContent = `Could not load the call: ${err.message}`; }
  };
  root.addEventListener("toggle", (e) => {
    const k = e.target.dataset?.key;
    if (k) e.target.open ? opened.add(k) : opened.delete(k);
  }, true);
  root.onchange = (e) => { if (e.target.id === "ctx-session") goQuery({ session: e.target.value, n: "" }); };
}
