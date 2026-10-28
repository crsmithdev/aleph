// Sessions, Session and Turn: the conversations Langfuse recorded. One module
// holds the three views; sessions-session.js and sessions-turn.js re-export
// the last two, because the page reads one `view` per file.
import { chips, empty, error, esc, filterBar, idLink, money, pageHead, pager, when } from "../lib.js";

const dur = (ms) => (ms == null ? "" : ms < 1000 ? `${ms} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`);
const down = (d) => `<div class="page">${error(`Langfuse is unreachable: ${d.error}`, "Check that Langfuse is running and LANGFUSE_* is set in ~/.aleph/.env, then reload.")}</div>`;
const langfuse = (base, traceId) => (base && traceId ? `<a href="${esc(base)}/trace/${esc(traceId)}">Open in Langfuse</a>` : "");
const line = (s) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
const href = (path) => `#${path}`;

// The list's filters and page size live here, so the 60 s refresh keeps them.
const state = { project: "", q: "", shown: 50 };

const visible = (d) => {
  const q = state.q.trim().toLowerCase();
  return d.sessions.filter((s) => (!state.project || s.project === state.project) && (!q || (s.firstPrompt ?? "").toLowerCase().includes(q)));
};

function sessionsBody(d) {
  const all = visible(d);
  if (!all.length) return empty(d.sessions.length ? "No session matches." : "No session in the last 7 days.", d.sessions.length ? "Clear the project or the search." : "Sessions appear when the hooks send traces to Langfuse.");
  // Columns: id, title (the first prompt), project, labels (kinds), numbers, times last.
  const rows = all.slice(0, state.shown).map((s) =>
    `<tr><td>${idLink(s.id.slice(0, 8), href(`/sessions/${encodeURIComponent(s.id)}`))}</td>` +
    `<td class="wide" title="${esc(s.firstPrompt)}">${esc(s.firstPrompt)}</td><td>${esc(s.project)}</td>` +
    `<td>${chips(s.taskTypes)}</td><td class="num">${s.turns}</td><td class="num">${esc(money(s.cost))}</td>` +
    `<td class="time">${esc(when(s.start))}</td><td class="time">${esc(when(s.last))}</td></tr>`).join("");
  return `<div class="tscroll"><table class="tbl"><thead><tr><th>Session</th><th>First prompt</th><th>Project</th><th>Kinds</th><th class="num">Turns</th><th class="num">Cost</th><th>Started</th><th>Last</th></tr></thead><tbody>${rows}</tbody></table></div>` +
    pager(state.shown, all.length);
}

export function renderSessions(d) {
  if (!d || d.error) return down(d ?? { error: "no answer" });
  const projects = [...new Set(d.sessions.map((s) => s.project).filter(Boolean))].sort();
  if (state.project && !projects.includes(state.project)) state.project = "";
  return `<div class="page">${pageHead("Sessions", { count: visible(d).length })}` +
    filterBar([
      { label: "Project", name: "project", options: [{ value: "", label: "All" }, ...projects], value: state.project },
      { label: "Search", name: "q", search: true, value: state.q, placeholder: "First prompt" },
    ]) + `<div class="sess-body">${sessionsBody(d)}</div></div>`;
}

// Filters and "Show more" redraw the table and count in place; the search box keeps its focus.
export function mountSessions(root, d) {
  if (!d || d.error) return;
  const body = root.querySelector(".sess-body");
  if (!body) return;
  const redraw = () => {
    body.innerHTML = sessionsBody(d);
    const c = root.querySelector(".ph .count");
    if (c) c.textContent = String(visible(d).length);
  };
  const set = (name, value) => { state[name] = value; state.shown = 50; redraw(); };
  root.querySelector('.fbar input[name="q"]')?.addEventListener("input", (e) => set("q", e.target.value));
  root.querySelector('.fbar select[name="project"]')?.addEventListener("change", (e) => set("project", e.target.value));
  root.querySelector('.fbar .seg[data-name="project"]')?.addEventListener("click", (e) => {
    const b = e.target.closest?.("button[data-value]");
    if (!b) return;
    root.querySelectorAll('.fbar .seg[data-name="project"] button').forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    set("project", b.dataset.value);
  });
  body.addEventListener("click", (e) => {
    const b = e.target.closest?.("button[data-more]");
    if (!b) return;
    state.shown += Number(b.dataset.more);
    redraw();
  });
}

export function renderSession(d) {
  if (!d || d.error) return down(d ?? { error: "no answer" });
  // Columns: turn (id), prompt (title), output, model, numbers, time last.
  const rows = d.turns.map((t) =>
    `<tr><td class="num"><a href="${esc(href(`/sessions/${encodeURIComponent(d.id)}/turns/${t.n}`))}">${t.n}</a></td>` +
    `<td class="wide" title="${esc(t.prompt)}">${esc(t.prompt)}</td><td>${esc(line(t.output))}</td><td>${esc(t.model ?? "")}</td><td class="num">${t.tools}</td>` +
    `<td class="num">${esc(dur(t.durationMs))}</td><td class="num">${esc(money(t.cost))}</td><td class="time">${esc(when(t.start))}</td></tr>`).join("");
  const aside = [idLink(d.id.slice(0, 8), href(`/sessions/${encodeURIComponent(d.id)}`)), langfuse(d.base, d.turns[0]?.traceId)].filter(Boolean).join(" ");
  return `<div class="page"><p class="quiet"><a href="#/sessions">Sessions</a></p>${pageHead(d.project, { count: d.turns.length, aside })}` +
    `${d.taskTypes?.length ? `<p>${chips(d.taskTypes)}</p>` : ""}` +
    `<div class="tscroll"><table class="tbl"><thead><tr><th class="num">Turn</th><th>Prompt</th><th>Output</th><th>Model</th><th class="num">Tools</th><th class="num">Duration</th><th class="num">Cost</th><th>Started</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

// One row per observation, children after their parent and indented by depth; input and output fold under the name.
function obsRows(o, depth) {
  const detail = [
    o.recall ? `candidates ${esc(o.recall.candidates ?? "?")}, asked ${esc(o.recall.asked ?? "?")}, kept ${esc(o.recall.kept ?? "?")}` : "",
    o.verify ? `${esc(o.verify.kind ?? "")} ${esc(o.verify.verdict ?? "")}` : "",
    o.model ? esc(o.model) : "",
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
  return `<div class="page"><p class="quiet"><a href="#/sessions">Sessions</a> / ${idLink(d.id.slice(0, 8), href(`/sessions/${sid}`))}</p>` +
    pageHead(`Turn ${d.n} of ${d.total}`, { aside: [nav(d.n - 1, "Previous"), nav(d.n + 1, "Next"), langfuse(d.base, d.traceId)].filter(Boolean).join(" ") }) +
    `<dl class="facts"><div><dt>Started</dt><dd>${esc(when(d.start))}</dd></div><div><dt>Cost</dt><dd>${esc(money(d.cost))}</dd></div><div><dt>Duration</dt><dd>${esc(dur(d.durationMs))}</dd></div></dl>` +
    `<h2>Prompt</h2><pre>${esc(d.prompt)}</pre><h2>Output</h2><pre>${esc(d.output)}</pre><h2>Observations</h2>` +
    (d.observations.length ? `<div class="tscroll"><table class="tbl"><thead><tr><th>Kind</th><th>Name</th><th>Detail</th><th class="num">Duration</th></tr></thead><tbody>${d.observations.map((o) => obsRows(o, 0)).join("")}</tbody></table></div>` : empty("No observation in this turn.")) + `</div>`;
}

export const view = { path: "/sessions", title: "Sessions", group: "claude", order: 0, api: "/api/sessions", refresh: 60, render: renderSessions, mount: mountSessions };
export const sessionView = { path: "/sessions/:id", title: "Session", group: "claude", order: 0, api: "/api/sessions/:id", render: renderSession };
export const turnView = { path: "/sessions/:id/turns/:n", title: "Turn", group: "claude", order: 0, api: "/api/sessions/:id/turns/:n", render: renderTurn };
