// The Context tab of the Memory page, on /api/context: a picker for the session and its request, the fill of the
// selected request as a bar, the fill of every request as a chart, and the parts the request holds. A part is exact
// when the endpoint says so (from API usage) and est. otherwise (chars ÷ 4).
import { get } from "../router.js";
import { card, count, dataTable, empty, error, esc, goQuery, hashQuery, heads, loadingLine, setQuery, tag } from "../lib.js";

const LIMIT = 200_000;
const SERIES = ["--series-1", "--series-2", "--series-3", "--chart-6", "--chart-7", "--run", "--need", "--done"];
const colour = (i) => `var(${SERIES[i % SERIES.length]})`;
const how = (h) => (h === "exact" ? tag("exact", "done") : tag("est.", "need"));
const pick = (requests, n) => requests.find((r) => r.n === Number(n)) ?? requests.at(-1);

function picker(m, id, session, r) {
  const last = session.requests.length;
  const opts = m.sessions.map((s) => `<option value="${esc(s.id)}"${s.id === id ? " selected" : ""}>${esc(`${s.id.slice(0, 8)} · ${s.updated.slice(0, 10)} · ${s.project}`)}</option>`).join("");
  const step = (label, n) => `<button type="button" data-n="${n}"${n < 1 || n > last || n === r.n ? " disabled" : ""}>${label}</button>`;
  return `<div style="display:flex;flex-wrap:wrap;gap:16px;align-items:center"><label class="ctx-session">Session <select id="ctx-session" name="session">${opts}</select></label>` +
    `<span>Request ${step("Previous", r.n - 1)} <strong>${r.n}</strong> of ${last} ${step("Next", r.n + 1)} ${step("Latest", last)}</span></div>`;
}

function fillBar(r) {
  const segs = r.parts.map((p, i) => `<i style="width:${(p.tokens / LIMIT * 100).toFixed(2)}%;background:${colour(i)}" title="${esc(p.name)}"></i>`).join("");
  const key = r.parts.map((p, i) => `<span><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${colour(i)}"></i> ${esc(p.name)}</span>`).join("");
  const u = r.usage;
  return card("Fill of request " + r.n, `<p><strong>${count(r.fill)}</strong> of ${count(LIMIT)} tokens · ${(r.fill / LIMIT * 100).toFixed(1)}% ${how("exact")}</p>` +
    `<p class="quiet">input ${count(u.input)} · cache read ${count(u.cacheRead)} · cache write ${count(u.cacheWrite)} · output ${count(u.output)}</p>` +
    `<div style="display:flex;height:22px;border-radius:6px;overflow:hidden;background:var(--sunk)" role="img" aria-label="Context fill by part">${segs}</div><p class="quiet" style="display:flex;flex-wrap:wrap;gap:16px">${key}</p>`);
}

function chart(requests, r) {
  const bars = requests.map((x, i) => {
    const cut = i && x.fill < requests[i - 1].fill;
    return `<button type="button" data-n="${x.n}" aria-label="request ${x.n}, ${count(x.fill)} tokens${cut ? ", after a compaction" : ""}"` +
      ` aria-pressed="${x === r}" style="flex:1;min-width:0;padding:0;border:0;background:${x === r ? "var(--stuck)" : "var(--run)"};height:${Math.min(x.fill / LIMIT, 1) * 100}%${cut ? ";outline:1px dashed var(--stuck)" : ""}"></button>`;
  }).join("");
  return card("Fill per request", `<div style="display:flex;align-items:flex-end;gap:2px;height:170px;border-bottom:1px solid var(--rule)">${bars}</div><p class="quiet">Click a bar to inspect that request. A dashed bar follows a compaction.</p>`);
}

function parts(r) {
  const rows = r.parts.map((p) => `<tr><td>${esc(p.name)}</td><td class="mono">${esc(p.rec)}</td><td class="num">${count(p.tokens)}</td><td>${how(p.how)}</td></tr>`);
  rows.push(`<tr><td><strong>Total</strong></td><td class="mono">message.usage</td><td class="num"><strong>${count(r.fill)}</strong></td><td>${how("exact")}</td></tr>`);
  return card(`What is in request ${r.n}`, dataTable(heads(["Part", "Record", "Tokens", "How"], ["Tokens"]), rows.join("")) +
    `<p class="quiet">The fixed parts sum to the fill of request 1. With an Anthropic key, count_tokens counts each one and Other holds the rest. Without a key, the split is est. A message part is the usage of its request minus the usage of the request before it, exact unless one gap held more than one kind of record.</p>`);
}

/** The body of the tab: `m` is the /api/context body, with `session` the /api/context/:id body once loaded; `o.n` the request. */
export function renderContext(m, o = {}) {
  if (!m.sessions.length) return empty();
  if (!m.session) return `<div id="ctx-body">${loadingLine("the session")}</div>`;
  if (!m.session.requests.length) return `<div id="ctx-body">${empty()}</div>`;
  const r = pick(m.session.requests, o.n);
  return `<div id="ctx-body">${picker(m, m.session.id, m.session, r)}${fillBar(r)}${chart(m.session.requests, r)}${parts(r)}</div>`;
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
  root.onclick = (e) => {
    const b = e.target.closest?.("#ctx-body button[data-n]");
    if (b && !b.disabled) { setQuery({ n: b.dataset.n }); draw(); }
  };
  root.onchange = (e) => { if (e.target.id === "ctx-session") goQuery({ session: e.target.value, n: "" }); };
}
