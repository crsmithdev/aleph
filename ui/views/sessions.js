// Sessions, Session and Turn: the conversations Langfuse recorded. One module
// holds the three views; sessions-session.js and sessions-turn.js re-export
// the last two, because the page reads one `view` per file.
import { chips, empty, error, esc, filterBar, idLink, money, pageHead, pager, shortModel, when } from "../lib.js";

const dur = (ms) => (ms == null ? "" : ms < 1000 ? `${ms} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`);
const down = (d) => `<div class="page">${error(`Langfuse is unreachable: ${d.error}`, "Check that Langfuse is running and LANGFUSE_* is set in ~/.aleph/.env, then reload.")}</div>`;
const langfuse = (base, traceId) => (base && traceId ? `<a href="${esc(base)}/trace/${esc(traceId)}">Open in Langfuse</a>` : "");
const line = (s) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
const href = (path) => `#${path}`;

// The search text and page size live here, so the 60 s refresh keeps them; Project and Window live in the hash.
const state = { q: "", shown: 50 };

const visible = (d) => {
  const q = state.q.trim().toLowerCase();
  return d.sessions.filter((s) => !q || (s.firstPrompt ?? "").toLowerCase().includes(q));
};

const DAYS = [{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }];
const windowOf = (query) => (DAYS.some((o) => o.value === query?.get("days")) ? query.get("days") : "7");

/** The session's id link: the job name when it is a factory session, else the id's first 8 characters; the title is the full id. */
const sessionLink = (s) =>
  idLink(s.label ?? s.id.slice(0, 8), href(`/sessions/${encodeURIComponent(s.id)}`)).replace('<a class="idl"', `<a class="idl" title="${esc(s.id)}"`);

function sessionsBody(d, days) {
  const all = visible(d);
  if (!all.length) return empty(d.sessions.length ? "No session matches." : `No session in the last ${days} days.`, d.sessions.length ? "Clear the search." : "Sessions appear when the hooks send traces to Langfuse.");
  // Columns: id, title (the first prompt), project, labels (kinds), numbers, times last.
  const rows = all.slice(0, state.shown).map((s) =>
    `<tr><td>${sessionLink(s)}</td>` +
    `<td class="wide" title="${esc(s.firstPrompt)}">${esc(s.firstPrompt)}</td><td>${esc(s.project)}</td>` +
    `<td>${chips(s.taskTypes)}</td><td class="num">${s.turns}</td><td class="num">${esc(money(s.cost))}</td>` +
    `<td class="time">${esc(when(s.start))}</td><td class="time">${esc(when(s.last))}</td></tr>`).join("");
  return `<div class="tscroll"><table class="tbl"><thead><tr><th>Session</th><th>First prompt</th><th>Project</th><th>Kinds</th><th class="num">Turns</th><th class="num">Cost</th><th>Started</th><th>Last</th></tr></thead><tbody>${rows}</tbody></table></div>` +
    pager(state.shown, all.length);
}

export function renderSessions(d, _params, query = new URLSearchParams()) {
  if (!d || d.error) return down(d ?? { error: "no answer" });
  const projects = [...new Set([...(d.projects ?? []), ...d.sessions.map((s) => s.project).filter(Boolean)])].sort();
  const days = windowOf(query);
  return `<div class="page">${pageHead("Sessions", { count: visible(d).length })}` +
    filterBar([
      { label: "Project", name: "project", options: [{ value: "", label: "All" }, ...projects], value: projects.includes(query?.get("project")) ? query.get("project") : "" },
      { label: "Window", name: "days", options: DAYS, value: days },
      { label: "Search", name: "q", search: true, value: state.q, placeholder: "First prompt" },
    ]) + `<div class="sess-body">${sessionsBody(d, days)}</div></div>`;
}

// Project and Window write the hash; the search and "Show more" redraw the table and count in place, so the search box keeps its focus.
export function mountSessions(root, d, query = new URLSearchParams()) {
  if (!d || d.error) return;
  const body = root.querySelector(".sess-body");
  if (!body) return;
  const days = windowOf(query);
  const redraw = () => {
    body.innerHTML = sessionsBody(d, days);
    const c = root.querySelector(".ph .count");
    if (c) c.textContent = String(visible(d).length);
  };
  const go = (name, value) => {
    const q = new URLSearchParams();
    for (const k of ["days", "project"]) if (query.get(k)) q.set(k, query.get(k));
    if (value) q.set(name, value); else q.delete(name);
    location.hash = `#/sessions${q.toString() ? `?${q}` : ""}`;
  };
  root.querySelector('.fbar input[name="q"]')?.addEventListener("input", (e) => { state.q = e.target.value; state.shown = 50; redraw(); });
  root.onchange = (e) => { if (e.target.matches?.(".fbar select")) go(e.target.name, e.target.value); };
  root.onclick = (e) => {
    const seg = e.target.closest?.(".fbar .seg button");
    if (seg) return go(seg.parentElement.dataset.name, seg.dataset.value);
    const b = e.target.closest?.("button[data-more]");
    if (!b) return;
    state.shown += Number(b.dataset.more);
    redraw();
  };
}

export function renderSession(d) {
  if (!d || d.error) return down(d ?? { error: "no answer" });
  // Columns: turn (id), prompt (title), output, model, numbers, time last.
  const rows = d.turns.map((t) =>
    `<tr><td class="num"><a href="${esc(href(`/sessions/${encodeURIComponent(d.id)}/turns/${t.n}`))}">${t.n}</a></td>` +
    `<td class="wide" title="${esc(t.prompt)}">${esc(t.prompt)}</td><td>${esc(line(t.output))}</td><td>${esc(shortModel(t.model))}</td><td class="num">${t.tools}</td>` +
    `<td class="num">${esc(dur(t.durationMs))}</td><td class="num">${esc(money(t.cost))}</td><td class="time">${esc(when(t.start))}</td></tr>`).join("");
  const aside = [sessionLink(d), langfuse(d.base, d.turns[0]?.traceId)].filter(Boolean).join(" ");
  return `<div class="page"><p class="quiet"><a href="#/sessions">← Sessions</a></p>${pageHead(d.project, { count: d.turns.length, aside })}` +
    `${d.taskTypes?.length ? `<p>${chips(d.taskTypes)}</p>` : ""}` +
    `<div class="tscroll"><table class="tbl"><thead><tr><th class="num">Turn</th><th>Prompt</th><th>Output</th><th>Model</th><th class="num">Tools</th><th class="num">Duration</th><th class="num">Cost</th><th>Started</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

// One row per observation, children after their parent and indented by depth; input and output fold under the name.
function obsRows(o, depth) {
  const detail = [
    o.recall ? `candidates ${esc(o.recall.candidates ?? "?")}, asked ${esc(o.recall.asked ?? "?")}, kept ${esc(o.recall.kept ?? "?")}` : "",
    o.verify ? `${esc(o.verify.kind ?? "")} ${esc(o.verify.verdict ?? "")}` : "",
    o.model ? esc(shortModel(o.model)) : "",
    o.error ? `Error: ${esc(o.error)}` : "",
  ].filter(Boolean).join("; ");
  const fold = (label, text) => (text ? `<details><summary>${label}</summary><pre>${esc(text)}</pre></details>` : "");
  return `<tr><td><span class="badge ${o.error ? "stuck" : "quiet"}">${esc(o.kind)}</span></td>` +
    `<td style="padding-left:${depth * 16}px"><strong>${esc(o.name)}</strong>${fold("Input", o.input)}${fold("Output", o.output)}</td>` +
    `<td>${detail}</td><td class="num">${esc(dur(o.durationMs))}</td></tr>` + o.children.map((c) => obsRows(c, depth + 1)).join("");
}

export function renderTurn(d) {
  if (!d || d.error) return down(d ?? { error: "no answer" });
  const sid = encodeURIComponent(d.id);
  const nav = (n, label) => (n >= 1 && n <= d.total ? `<a href="${esc(href(`/sessions/${sid}/turns/${n}`))}">${label}</a>` : "");
  return `<div class="page"><p class="quiet"><a href="#/sessions">← Sessions</a> / ${sessionLink(d)}</p>` +
    pageHead(`Turn ${d.n} of ${d.total}`, { aside: [nav(d.n - 1, "Previous"), nav(d.n + 1, "Next"), langfuse(d.base, d.traceId)].filter(Boolean).join(" ") }) +
    `<dl class="facts"><div><dt>Started</dt><dd>${esc(when(d.start))}</dd></div><div><dt>Cost</dt><dd>${esc(money(d.cost))}</dd></div><div><dt>Duration</dt><dd>${esc(dur(d.durationMs))}</dd></div></dl>` +
    `<h2>Prompt</h2><pre>${esc(d.prompt)}</pre><h2>Output</h2><pre>${esc(d.output)}</pre><h2>Observations</h2>` +
    (d.observations.length ? `<div class="tscroll"><table class="tbl"><thead><tr><th>Kind</th><th>Name</th><th>Detail</th><th class="num">Duration</th></tr></thead><tbody>${d.observations.map((o) => obsRows(o, 0)).join("")}</tbody></table></div>` : empty("No observation in this turn.")) + `</div>`;
}

export const view = { path: "/sessions", title: "Sessions", group: "claude", order: 0, api: (_params, q = new URLSearchParams()) => {
    const out = new URLSearchParams();
    for (const k of ["days", "project"]) if (q.get(k)) out.set(k, q.get(k));
    return out.toString() ? `/api/sessions?${out}` : "/api/sessions";
  }, refresh: 60, render: renderSessions, mount: mountSessions };
export const sessionView = { path: "/sessions/:id", title: "Session", group: "claude", order: 0, api: "/api/sessions/:id", render: renderSession };
export const turnView = { path: "/sessions/:id/turns/:n", title: "Turn", group: "claude", order: 0, api: "/api/sessions/:id/turns/:n", render: renderTurn };
